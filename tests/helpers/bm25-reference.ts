// A frozen copy of `Bm25Index` as it was at 1dc6ed3 (before the search was optimised): the straightforward
// Map-based scoring, a full scan of the vocabulary for prefix expansion, and a full sort of every scored page.
// `tests/bm25-equivalence.test.ts` drives it and the live index with the same random operations and requires
// identical answers, so the optimised index can never drift from the ranking this one defines. Do not "improve" it.

import { canonicalUrl } from '../../src/browser/omnibox/omnibox';
import { parseQuery, tokenize } from '../../src/browser/search/tokenizer';
import { buildSnippet, hashText } from '../../src/browser/search/bm25-index';
import type { IndexableDocument, SearchHit, SearchOptions } from '../../src/browser/search/bm25-index';

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

const K1 = 1.2;
const B = 0.75;
const WEIGHT = { title: 5, h1: 3, h2: 2, h3: 1.5, meta: 2, body: 1 } as const;
const MAX_BODY_CHARS = 100_000;
const SNIPPET_SOURCE_CHARS = 2000;
const MAX_PREFIX_EXPANSIONS = 20;
const PREFIX_FACTOR = 0.6;

class ReferenceBm25Index {
  private docs: DocRecord[] = [];
  private postings = new Map<string, Postings>();
  private urlToId = new Map<string, number>();
  private totalLength = 0;
  private liveCount = 0;
  private tombstones = 0;

  get size(): number { return this.liveCount; }

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
      hash: hashText(`${doc.title}\n${doc.description}\n${doc.body.slice(0, MAX_BODY_CHARS)}`),
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
}

export { ReferenceBm25Index };
