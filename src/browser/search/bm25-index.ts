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
}

interface DocRecord {
  url: string;
  title: string;
  snippet: string;
  length: number;
  visitedAt: number;
  hash: string;
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

const K1 = 1.2;
const B = 0.75;
// Field weights are baked into the stored term frequencies at index time.
const WEIGHT = { title: 5, h1: 3, h2: 2, h3: 1.5, meta: 2, body: 1 } as const;
const MAX_BODY_CHARS = 100_000;
const SNIPPET_SOURCE_CHARS = 2000;
const SNIPPET_LENGTH = 200;
const MAX_PREFIX_EXPANSIONS = 20;
const PREFIX_FACTOR = 0.6;

/** FNV-1a, 32-bit — cheap change detection for re-visited pages. */
function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
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
 */
class Bm25Index {
  private docs: DocRecord[] = [];
  private postings = new Map<string, Postings>();
  private urlToId = new Map<string, number>();
  private totalLength = 0;
  private liveCount = 0;
  private tombstones = 0;

  get size(): number { return this.liveCount; }
  get termCount(): number { return this.postings.size; }

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
    this.docs.push({
      url: doc.url,
      title: doc.title,
      snippet: lead.slice(0, SNIPPET_SOURCE_CHARS),
      length,
      visitedAt: doc.visitedAt,
      hash: Bm25Index.hashOf(doc),
      live: true,
    });
    for (const [term, tf] of tfs) {
      let p = this.postings.get(term);
      if (!p) { p = { ids: [], tfs: [] }; this.postings.set(term, p); }
      p.ids.push(id);
      p.tfs.push(tf);
    }
    this.urlToId.set(canonicalUrl(doc.url), id);
    this.totalLength += length;
    this.liveCount++;
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
    this.urlToId.clear();
    this.totalLength = 0;
    this.liveCount = 0;
    this.tombstones = 0;
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
      for (const [term, p] of this.postings) {
        if (term !== slot[0]!.term && term.startsWith(lastWord)) expansions.push([term, p.ids.length]);
      }
      expansions.sort((a, b) => b[1] - a[1]);
      for (const [term] of expansions.slice(0, MAX_PREFIX_EXPANSIONS)) slot.push({ term, factor: PREFIX_FACTOR });
    }

    const n = this.liveCount;
    const avgLength = this.totalLength / n || 1;
    const scores = new Map<number, number>();
    const matched = new Map<number, number>();

    for (const slot of slots) {
      const best = new Map<number, number>();
      for (const { term, factor } of slot) {
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
          const prev = best.get(id);
          if (prev === undefined || c > prev) best.set(id, c);
        }
      }
      for (const [id, c] of best) {
        scores.set(id, (scores.get(id) ?? 0) + c);
        matched.set(id, (matched.get(id) ?? 0) + 1);
      }
    }

    const ranked = [...scores.entries()]
      .map(([id, score]) => ({ id, score, matched: matched.get(id)! }))
      .sort((a, b) => b.matched - a.matched || b.score - a.score || b.id - a.id)
      .slice(0, limit);

    const termSet = new Set(slots.flat().map((s) => s.term));
    return ranked.map(({ id, score, matched: m }) => {
      const d = this.docs[id]!;
      const snippet = buildSnippet(d.snippet, termSet, prefix);
      return {
        url: d.url, title: d.title, snippet: snippet.text, highlights: snippet.highlights,
        score, visitedAt: d.visitedAt, matchedTerms: m, totalTerms: terms.length,
      };
    });
  }

  /** Drops tombstoned documents and renumbers ids. */
  compact(): void {
    const remap = new Map<number, number>();
    const docs: DocRecord[] = [];
    this.docs.forEach((d, oldId) => {
      if (d.live) { remap.set(oldId, docs.length); docs.push(d); }
    });
    for (const [term, p] of this.postings) {
      const ids: number[] = [];
      const tfs: number[] = [];
      p.ids.forEach((oldId, i) => {
        const newId = remap.get(oldId);
        if (newId !== undefined) { ids.push(newId); tfs.push(p.tfs[i]!); }
      });
      if (ids.length === 0) this.postings.delete(term);
      else { p.ids = ids; p.tfs = tfs; }
    }
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
      index.docs.push({ url: t[0], title: t[1], snippet: t[2], length: t[3], visitedAt: t[4], hash: t[5], live: true });
    }
    for (const entry of snap.postings) {
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !Array.isArray(entry[1]) || !Array.isArray(entry[2])
        || entry[1].length !== entry[2].length) return new Bm25Index();
      if (entry[1].some((id) => typeof id !== 'number' || id < 0 || id >= index.docs.length)) return new Bm25Index();
      index.postings.set(entry[0], { ids: entry[1], tfs: entry[2] });
    }
    index.docs.forEach((d, id) => {
      index.urlToId.set(canonicalUrl(d.url), id);
      index.totalLength += d.length;
    });
    index.liveCount = index.docs.length;
    return index;
  }
}

export { Bm25Index, hashText, buildSnippet };
export type { IndexableDocument, IndexableHeading, SearchHit, SearchOptions, IndexSnapshot };
