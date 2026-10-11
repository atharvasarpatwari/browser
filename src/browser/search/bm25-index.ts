import { canonicalUrl } from '../omnibox/omnibox';
import { parseQuery, scanTokens, tokenize } from './tokenizer';

interface IndexableHeading {
  readonly level: 1 | 2 | 3;
  readonly text: string;
}

interface IndexableDocument {
  readonly url: string;
  readonly title: string;
  readonly headings: readonly IndexableHeading[];
  readonly description: string;
  readonly body: string;
  readonly visitedAt: number;
}

interface SearchHit {
  readonly url: string;
  readonly title: string;
  /** Plain text (never HTML) — render with the `highlights` ranges, escaping as usual. */
  readonly snippet: string;
  readonly highlights: ReadonlyArray<readonly [number, number]>;
  readonly score: number;
  readonly visitedAt: number;
  /** How many of the query's terms this page contains. */
  readonly matchedTerms: number;
  readonly totalTerms: number;
}

interface SearchOptions {
  readonly limit?: number;
  /** Treat the last typed word as a prefix (as-you-type). Default true. */
  readonly prefix?: boolean;
  /**
   * Tolerate typos: a query word of 4+ letters that no page contains also matches words one typo away (a missing,
   * extra, wrong or swapped letter; same first letter). Words that exist are never fuzzed. Default false.
   */
  readonly fuzzy?: boolean;
}

interface DocRecord {
  url: string;
  title: string;
  snippet: string;
  length: number;
  visitedAt: number;
  hash: string;
  /** Never reused, never renumbered (unlike the dense id): what persistence refers to a page by. */
  seq: number;
  live: boolean;
}

interface Postings {
  ids: number[];
  tfs: number[];
}

type DocTuple = [url: string, title: string, snippet: string, length: number, visitedAt: number, hash: string];
interface IndexSnapshot {
  readonly v: 1;
  readonly docs: DocTuple[];
  readonly postings: Array<[term: string, ids: number[], tfs: number[]]>;
}

/** One page as persisted: its record plus its term vector (parallel `terms` / field-weighted `tfs`), so it is restored without tokenising. */
type PersistedDoc = [
  url: string, title: string, snippet: string, length: number, visitedAt: number, hash: string,
  seq: number, terms: string[], tfs: number[],
];

/** What happened to the index, reported to the observer set with `observe()` (not for restores: `addPersisted` is silent). */
type IndexMutation =
  | { readonly type: 'add'; readonly doc: PersistedDoc }
  | { readonly type: 'remove'; readonly seq: number }
  | { readonly type: 'clear' };

const K1 = 1.2;
const B = 0.75;
// Field weights are baked into the stored term frequencies at index time.
const WEIGHT = { title: 5, h1: 3, h2: 2, h3: 1.5, meta: 2, body: 1 } as const;
const MAX_BODY_CHARS = 100_000;
const SNIPPET_SOURCE_CHARS = 2000;
const SNIPPET_LENGTH = 200;
const MAX_PREFIX_EXPANSIONS = 20;
const PREFIX_FACTOR = 0.6;
const MIN_FUZZY_CHARS = 4;
const MAX_FUZZY_EXPANSIONS = 5;
/** Below a prefix match, so a page with the word as typed always outranks one with a near miss. */
const FUZZY_FACTOR = 0.5;
/** Terms are bucketed by their first characters, so a typed prefix scans one bucket instead of the whole vocabulary. */
const PREFIX_BUCKET_CHARS = 2;
/** Beyond this many results (or when they are a large share of the matches) sorting everything beats a bounded selection. */
const TOP_K_MAX = 64;

/** FNV-1a, 32-bit — cheap change detection for re-visited pages. */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function tailsEqual(a: string, i: number, b: string, j: number): boolean {
  if (a.length - i !== b.length - j) return false;
  for (; i < a.length; i++, j++) if (a.charCodeAt(i) !== b.charCodeAt(j)) return false;
  return true;
}

/** True when `a` and `b` differ by exactly one inserted, missing or wrong letter, or two swapped neighbours. No allocation: it runs over a whole bucket of terms. */
function oneEditApart(a: string, b: string): boolean {
  const la = a.length;
  const lb = b.length;
  if (la - lb > 1 || lb - la > 1 || a === b) return false;
  const min = la < lb ? la : lb;
  let i = 0;
  while (i < min && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  if (la === lb) {
    return tailsEqual(a, i + 1, b, i + 1)
      || (i + 1 < la && a.charCodeAt(i) === b.charCodeAt(i + 1) && a.charCodeAt(i + 1) === b.charCodeAt(i) && tailsEqual(a, i + 2, b, i + 2));
  }
  return la > lb ? tailsEqual(a, i + 1, b, i) : tailsEqual(a, i, b, i + 1);
}

function buildSnippet(
  source: string, terms: ReadonlySet<string>, prefix: string | null,
): { text: string; highlights: Array<[number, number]> } {
  const tokens = scanTokens(source, { stopWords: false });
  const hits = tokens.filter((t) => terms.has(t.term) || (prefix !== null && t.norm.startsWith(prefix)));
  const first = hits[0];
  if (!first) {
    const text = source.slice(0, SNIPPET_LENGTH).trim();
    return { text: text + (source.length > SNIPPET_LENGTH ? '…' : ''), highlights: [] };
  }

  let start = Math.max(0, first.start - 60);
  if (start > 0) {
    const space = source.indexOf(' ', start);
    if (space !== -1 && space < first.start) start = space + 1;
  }
  const end = Math.min(source.length, start + SNIPPET_LENGTH);
  const lead = start > 0 ? '…' : '';
  const text = lead + source.slice(start, end).trim() + (end < source.length ? '…' : '');

  const seen = new Set<string>();
  const highlights: Array<[number, number]> = [];
  for (const t of hits) {
    if (t.start < start || t.end > end) continue;
    const range: [number, number] = [t.start - start + lead.length, t.end - start + lead.length];
    const key = `${range[0]}:${range[1]}`;
    if (!seen.has(key)) { seen.add(key); highlights.push(range); }
  }
  return { text, highlights };
}

/**
 * In-memory inverted index ranked with BM25 (k1 = 1.2, b = 0.75). Postings are parallel arrays
 * (doc id, field-weighted term frequency). Removal tombstones the document; the index compacts
 * itself once tombstones pile up.
 *
 * Search cost is kept flat as the archive grows: typed prefixes look in a bucket of terms that share
 * their first characters, scoring accumulates into dense per-document arrays (ids are small integers),
 * and only the requested number of best pages is selected rather than sorting every match. The ranking
 * is exactly the straightforward algorithm's (see tests/bm25-equivalence.test.ts).
 */
class Bm25Index {
  private docs: DocRecord[] = [];
  private postings = new Map<string, Postings>();
  /** First-characters → the terms (in `postings` order) that start with them. */
  private prefixIndex = new Map<string, string[]>();
  private urlToId = new Map<string, number>();
  private totalLength = 0;
  private liveCount = 0;
  private tombstones = 0;
  private seqCounter = 0;
  private observer: ((mutation: IndexMutation) => void) | null = null;

  get size(): number { return this.liveCount; }
  get termCount(): number { return this.postings.size; }
  /** The sequence number the next page will get; only ever grows. */
  get nextSeq(): number { return this.seqCounter; }

  /** Reports every later add / remove / clear (one observer; `null` stops). */
  observe(observer: ((mutation: IndexMutation) => void) | null): void { this.observer = observer; }

  /** Makes sure no page ever gets a sequence number below `next` (restoring pages that were since removed). */
  reserveSeq(next: number): void { if (next > this.seqCounter) this.seqCounter = next; }

  has(url: string): boolean { return this.urlToId.has(canonicalUrl(url)); }

  getRecord(url: string): { hash: string; visitedAt: number } | undefined {
    const id = this.urlToId.get(canonicalUrl(url));
    const d = id === undefined ? undefined : this.docs[id];
    return d ? { hash: d.hash, visitedAt: d.visitedAt } : undefined;
  }

  /** Content hash an `upsert` of `doc` would store (lets callers skip unchanged pages). */
  static hashOf(doc: Pick<IndexableDocument, 'title' | 'description' | 'body'>): string {
    return hashText(`${doc.title}\n${doc.description}\n${doc.body.slice(0, MAX_BODY_CHARS)}`);
  }

  /** Adds or replaces the document for `doc.url`. Returns false when it has no indexable text. */
  upsert(doc: IndexableDocument): boolean {
    const body = doc.body.slice(0, MAX_BODY_CHARS);
    const tfs = new Map<string, number>();
    let length = 0;
    const add = (text: string, weight: number): void => {
      for (const term of tokenize(text)) {
        tfs.set(term, (tfs.get(term) ?? 0) + weight);
        length++;
      }
    };
    add(doc.title, WEIGHT.title);
    for (const h of doc.headings) add(h.text, h.level === 1 ? WEIGHT.h1 : h.level === 2 ? WEIGHT.h2 : WEIGHT.h3);
    add(doc.description, WEIGHT.meta);
    add(body, WEIGHT.body);

    this.remove(doc.url);
    if (tfs.size === 0) return false;

    const id = this.docs.length;
    const lead = [doc.description, body].filter(Boolean).join(' ').replace(/\s+/g, ' ');
    const record: DocRecord = {
      url: doc.url,
      title: doc.title,
      snippet: lead.slice(0, SNIPPET_SOURCE_CHARS),
      length,
      visitedAt: doc.visitedAt,
      hash: Bm25Index.hashOf(doc),
      seq: this.seqCounter++,
      live: true,
    };
    this.docs.push(record);
    for (const [term, tf] of tfs) {
      let p = this.postings.get(term);
      if (!p) { p = { ids: [], tfs: [] }; this.postings.set(term, p); this.indexTerm(term); }
      p.ids.push(id);
      p.tfs.push(tf);
    }
    this.urlToId.set(canonicalUrl(doc.url), id);
    this.totalLength += length;
    this.liveCount++;
    this.observer?.({
      type: 'add',
      doc: [record.url, record.title, record.snippet, length, record.visitedAt, record.hash, record.seq, [...tfs.keys()], [...tfs.values()]],
    });
    return true;
  }

  remove(url: string): boolean {
    const key = canonicalUrl(url);
    const id = this.urlToId.get(key);
    if (id === undefined) return false;
    const d = this.docs[id]!;
    d.live = false;
    this.urlToId.delete(key);
    this.totalLength -= d.length;
    this.liveCount--;
    this.tombstones++;
    this.observer?.({ type: 'remove', seq: d.seq });
    if (this.tombstones > Math.max(100, this.liveCount / 4)) this.compact();
    return true;
  }

  /** Removes the `count` least recently visited pages. */
  removeOldest(count: number): number {
    const live = this.docs.filter((d) => d.live).sort((a, b) => a.visitedAt - b.visitedAt).slice(0, count);
    for (const d of live) this.remove(d.url);
    return live.length;
  }

  clear(): void {
    this.docs = [];
    this.postings.clear();
    this.prefixIndex.clear();
    this.urlToId.clear();
    this.totalLength = 0;
    this.liveCount = 0;
    this.tombstones = 0;
    this.observer?.({ type: 'clear' });
  }

  /**
   * Restores one persisted page without tokenising or reporting it. A page already present under the same address
   * is replaced when this copy is newer and ignored otherwise. Returns whether the page was added.
   */
  addPersisted(page: PersistedDoc): boolean {
    const [url, title, snippet, length, visitedAt, hash, seq, terms, tfs] = page;
    const key = canonicalUrl(url);
    const existing = this.urlToId.get(key);
    if (existing !== undefined) {
      if (this.docs[existing]!.seq >= seq) return false;
      this.remove(url);
    }
    const id = this.docs.length;
    this.docs.push({ url, title, snippet, length, visitedAt, hash, seq, live: true });
    for (let i = 0; i < terms.length; i++) {
      const term = terms[i]!;
      let p = this.postings.get(term);
      if (!p) { p = { ids: [], tfs: [] }; this.postings.set(term, p); this.indexTerm(term); }
      p.ids.push(id);
      p.tfs.push(tfs[i]!);
    }
    this.urlToId.set(key, id);
    this.totalLength += length;
    this.liveCount++;
    this.reserveSeq(seq + 1);
    return true;
  }

  /** Every page as a persisted record, its term vector rebuilt from the postings (O(postings): for a one-time migration). */
  toPersisted(): PersistedDoc[] {
    this.compact();
    const terms: string[][] = this.docs.map(() => []);
    const tfs: number[][] = this.docs.map(() => []);
    for (const [term, p] of this.postings) {
      for (let i = 0; i < p.ids.length; i++) { terms[p.ids[i]!]!.push(term); tfs[p.ids[i]!]!.push(p.tfs[i]!); }
    }
    return this.docs.map((d, id) => [d.url, d.title, d.snippet, d.length, d.visitedAt, d.hash, d.seq, terms[id]!, tfs[id]!]);
  }

  search(query: string, options: SearchOptions = {}): SearchHit[] {
    const { terms, lastWord } = parseQuery(query);
    if (terms.length === 0 || this.liveCount === 0) return [];

    const limit = options.limit ?? 10;
    const slots: Array<Array<{ term: string; factor: number }>> = terms.map((t) => [{ term: t, factor: 1 }]);

    let prefix: string | null = null;
    if (options.prefix !== false && lastWord !== null && lastWord.length >= 2) {
      prefix = lastWord;
      const slot = slots[slots.length - 1]!;
      const expansions: Array<[string, number]> = [];
      for (const term of this.prefixIndex.get(lastWord.slice(0, PREFIX_BUCKET_CHARS)) ?? []) {
        if (term !== slot[0]!.term && term.startsWith(lastWord)) expansions.push([term, this.postings.get(term)!.ids.length]);
      }
      expansions.sort((a, b) => b[1] - a[1]);
      for (const [term] of expansions.slice(0, MAX_PREFIX_EXPANSIONS)) slot.push({ term, factor: PREFIX_FACTOR });
    }

    if (options.fuzzy) {
      for (const slot of slots) {
        const word = slot[0]!.term;
        // Not a typo when the word exists, when it is a prefix of something (the as-you-type case), or when it is a number.
        if (word.length < MIN_FUZZY_CHARS || slot.length > 1 || this.postings.has(word) || /\d/.test(word)) continue;
        for (const near of this.termsOneEditFrom(word)) slot.push({ term: near, factor: FUZZY_FACTOR });
      }
    }

    const n = this.liveCount;
    const avgLength = this.totalLength / n || 1;
    // Document ids are dense small integers, so scores live in typed arrays rather than Maps.
    const size = this.docs.length;
    const scores = new Float64Array(size);
    const matched = new Uint32Array(size);
    const best = new Float64Array(size);
    const bestFor = new Uint32Array(size); // the slot (1-based) whose `best` entry this is
    const candidates: number[] = [];

    for (let s = 0; s < slots.length; s++) {
      const stamp = s + 1;
      const touched: number[] = [];
      for (const { term, factor } of slots[s]!) {
        const p = this.postings.get(term);
        if (!p) continue;
        let df = p.ids.length;
        if (this.tombstones > 0) {
          df = 0;
          for (const id of p.ids) if (this.docs[id]!.live) df++;
        }
        if (df === 0) continue;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        for (let i = 0; i < p.ids.length; i++) {
          const id = p.ids[i]!;
          const d = this.docs[id]!;
          if (!d.live) continue;
          const tf = p.tfs[i]!;
          const c = factor * idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * d.length) / avgLength)));
          if (bestFor[id] !== stamp) { bestFor[id] = stamp; best[id] = c; touched.push(id); }
          else if (c > best[id]!) best[id] = c;
        }
      }
      for (const id of touched) { // a page counts once per query slot, at its best-matching term of that slot
        if (matched[id] === 0) candidates.push(id);
        scores[id] = scores[id]! + best[id]!;
        matched[id] = matched[id]! + 1;
      }
    }

    // Most query slots matched, then highest score, then the most recently added page.
    const before = (a: number, b: number): boolean =>
      matched[a] !== matched[b] ? matched[a]! > matched[b]! : scores[a] !== scores[b] ? scores[a]! > scores[b]! : a > b;
    let ranked: number[];
    if (Number.isInteger(limit) && limit > 0 && limit <= TOP_K_MAX && limit * 8 < candidates.length) {
      ranked = []; // the `limit` best so far, best first
      for (const id of candidates) {
        if (ranked.length === limit && !before(id, ranked[limit - 1]!)) continue;
        let at = ranked.length === limit ? limit - 1 : ranked.length;
        while (at > 0 && before(id, ranked[at - 1]!)) { ranked[at] = ranked[at - 1]!; at--; }
        ranked[at] = id;
      }
    } else {
      ranked = candidates.sort((a, b) => (before(a, b) ? -1 : 1)).slice(0, limit);
    }

    const termSet = new Set(slots.flat().map((s) => s.term));
    return ranked.map((id) => {
      const d = this.docs[id]!;
      const snippet = buildSnippet(d.snippet, termSet, prefix);
      return {
        url: d.url, title: d.title, snippet: snippet.text, highlights: snippet.highlights,
        score: scores[id]!, visitedAt: d.visitedAt, matchedTerms: matched[id]!, totalTerms: terms.length,
      };
    });
  }

  /** Vocabulary words one typo from `word` that start with the same letter, the most widespread first. */
  private termsOneEditFrom(word: string): string[] {
    const near: Array<[string, number]> = [];
    const first = word.charCodeAt(0);
    for (const [key, bucket] of this.prefixIndex) {
      if (key.charCodeAt(0) !== first) continue;
      for (const term of bucket) if (oneEditApart(word, term)) near.push([term, this.postings.get(term)!.ids.length]);
    }
    near.sort((a, b) => b[1] - a[1]);
    return near.slice(0, MAX_FUZZY_EXPANSIONS).map(([term]) => term);
  }

  private indexTerm(term: string): void {
    const key = term.slice(0, PREFIX_BUCKET_CHARS);
    const bucket = this.prefixIndex.get(key);
    if (bucket) bucket.push(term);
    else this.prefixIndex.set(key, [term]);
  }

  private rebuildPrefixIndex(): void {
    this.prefixIndex.clear();
    for (const term of this.postings.keys()) this.indexTerm(term);
  }

  /** Drops tombstoned documents and renumbers ids. */
  compact(): void {
    const remap = new Map<number, number>();
    const docs: DocRecord[] = [];
    this.docs.forEach((d, oldId) => {
      if (d.live) { remap.set(oldId, docs.length); docs.push(d); }
    });
    let droppedTerms = false;
    for (const [term, p] of this.postings) {
      const ids: number[] = [];
      const tfs: number[] = [];
      p.ids.forEach((oldId, i) => {
        const newId = remap.get(oldId);
        if (newId !== undefined) { ids.push(newId); tfs.push(p.tfs[i]!); }
      });
      if (ids.length === 0) { this.postings.delete(term); droppedTerms = true; }
      else { p.ids = ids; p.tfs = tfs; }
    }
    if (droppedTerms) this.rebuildPrefixIndex();
    this.docs = docs;
    this.urlToId = new Map(docs.map((d, id) => [canonicalUrl(d.url), id]));
    this.tombstones = 0;
  }

  toSnapshot(): IndexSnapshot {
    this.compact();
    return {
      v: 1,
      docs: this.docs.map((d) => [d.url, d.title, d.snippet, d.length, d.visitedAt, d.hash]),
      postings: [...this.postings].map(([term, p]) => [term, p.ids, p.tfs]),
    };
  }

  /** Rebuilds an index from `toSnapshot()` output; anything malformed yields an empty index. */
  static fromSnapshot(data: unknown): Bm25Index {
    const index = new Bm25Index();
    const snap = data as Partial<IndexSnapshot> | null;
    if (!snap || snap.v !== 1 || !Array.isArray(snap.docs) || !Array.isArray(snap.postings)) return index;

    for (const t of snap.docs) {
      if (!Array.isArray(t) || typeof t[0] !== 'string' || typeof t[1] !== 'string' || typeof t[2] !== 'string'
        || typeof t[3] !== 'number' || typeof t[4] !== 'number' || typeof t[5] !== 'string') return new Bm25Index();
      index.docs.push({ url: t[0], title: t[1], snippet: t[2], length: t[3], visitedAt: t[4], hash: t[5], seq: index.docs.length, live: true });
    }
    index.seqCounter = index.docs.length;
    for (const entry of snap.postings) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1]) || !Array.isArray(entry[2])
        || entry[1].length !== entry[2].length) return new Bm25Index();
      if (entry[1].some((id) => typeof id !== 'number' || id < 0 || id >= index.docs.length)) return new Bm25Index();
      index.postings.set(entry[0], { ids: entry[1], tfs: entry[2] });
    }
    index.rebuildPrefixIndex();
    index.docs.forEach((d, id) => {
      index.urlToId.set(canonicalUrl(d.url), id);
      index.totalLength += d.length;
    });
    index.liveCount = index.docs.length;
    return index;
  }
}

export { Bm25Index, hashText, buildSnippet, oneEditApart };
export type { IndexableDocument, IndexableHeading, SearchHit, SearchOptions, IndexSnapshot, PersistedDoc, IndexMutation };
