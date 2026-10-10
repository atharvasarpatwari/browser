import { describe, it, expect } from 'vitest';
import { Bm25Index } from '../src/browser/search/bm25-index';
import type { IndexableDocument, SearchOptions } from '../src/browser/search/bm25-index';
import { buildVocabulary, seededRandom } from '../src/benchmark/suites/search';
import { ReferenceBm25Index } from './helpers/bm25-reference';

/**
 * The index was optimised (prefix buckets instead of a vocabulary scan, dense score arrays instead of Maps, a bounded
 * top-k instead of sorting every scored page). Rankings must not have moved: the same random upserts, replacements
 * and removals — including the compactions they trigger — go to the live index and to a frozen copy of the original
 * algorithm, and every answer must be identical down to the last bit of each score.
 */
describe('Bm25Index ≡ the original algorithm', () => {
  // Every answer builds a snippet per hit, so the big limits are only used on the final comparison of a run.
  const OPTION_SETS: SearchOptions[] = [{}, { limit: 1 }, { limit: 3 }, { prefix: false }, { limit: 5, prefix: false }];
  const FINAL_OPTION_SETS: SearchOptions[] = [...OPTION_SETS, { limit: 50 }, { limit: 10_000 }];

  function run(seed: number, opts: { vocabulary: number; urls: number; operations: number }): void {
    const random = seededRandom(seed);
    const words = buildVocabulary(opts.vocabulary);
    // Skewed picks (small ranks far more often), like real text, so some terms are in nearly every page.
    const word = (): string => words[Math.min(words.length - 1, Math.floor(Math.pow(words.length, random())) - 1)]!;
    const phrase = (n: number): string => Array.from({ length: n }, word).join(' ');
    const doc = (url: string, i: number): IndexableDocument => ({
      url,
      title: phrase(2 + Math.floor(random() * 4)),
      headings: random() < 0.6 ? [{ level: (1 + Math.floor(random() * 3)) as 1 | 2 | 3, text: phrase(3) }] : [],
      description: random() < 0.7 ? phrase(10) : '',
      body: phrase(10 + Math.floor(random() * 60)),
      visitedAt: 1_000 + i,
    });

    const live = new Bm25Index();
    const ref = new ReferenceBm25Index();
    const queries = (): string[] => {
      const out: string[] = [];
      for (let q = 0; q < 3; q++) {
        const w = word();
        out.push(w, w.slice(0, 2), w.slice(0, 3), w.slice(0, 5), `${word()} ${word()}`, `${word()} ${w.slice(0, 3)}`, `${word()} ${word()} ${word()}`);
      }
      out.push('', '   ', 'zzzzzzzzzz', `${word()} zzzzzzzzzz`, 'the', word().toUpperCase());
      return out;
    };
    /** Collects every disagreement, so a failure names the query and options instead of dumping two huge arrays. */
    const compare = (label: string, subject: Bm25Index, sets: SearchOptions[]): void => {
      const mismatches: string[] = [];
      const all = queries();
      for (const options of sets) {
        for (const q of (options.limit ?? 0) > 100 ? all.slice(0, 7) : all) { // a huge limit means a snippet for every page: fewer queries
          if (JSON.stringify(subject.search(q, options)) !== JSON.stringify(ref.search(q, options))) mismatches.push(`"${q}" ${JSON.stringify(options)}`);
        }
      }
      expect(mismatches, `${label}: queries whose answers differ`).toEqual([]);
      expect(subject.size, `${label}: size`).toBe(ref.size);
    };

    for (let i = 0; i < opts.operations; i++) {
      const url = `https://site${Math.floor(random() * opts.urls)}.example.com/p`;
      if (random() < 0.28) {
        expect(live.remove(url)).toBe(ref.remove(url));
      } else {
        const d = doc(url, i);
        expect(live.upsert(d)).toBe(ref.upsert(d));
      }
      if (i % 150 === 149) compare(`seed ${seed}, after ${i + 1} operations`, live, OPTION_SETS);
    }
    compare(`seed ${seed}, final`, live, FINAL_OPTION_SETS);

    // Persistence: a snapshot restores an index that answers identically (the lookup structures are rebuilt).
    ref.compact(); // toSnapshot() compacts; ids renumber but ranking order among live pages does not change
    const restored = Bm25Index.fromSnapshot(JSON.parse(JSON.stringify(live.toSnapshot())));
    compare(`seed ${seed}, restored from a snapshot`, restored, FINAL_OPTION_SETS);
  }

  it.each([1, 2, 3, 4])('agrees through random upserts, replacements, removals and compactions (seed %i)', (seed) => {
    run(seed, { vocabulary: 400, urls: 260, operations: 750 });
  });

  it('agrees on a tiny vocabulary where nearly every page contains every term', () => {
    run(77, { vocabulary: 12, urls: 150, operations: 450 });
  });

  it('agrees when pages are only ever added (no tombstones)', () => {
    run(101, { vocabulary: 300, urls: 100_000, operations: 300 });
  });
}, 120_000);
