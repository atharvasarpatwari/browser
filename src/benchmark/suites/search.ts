// ─────────────────────────────────────────────────────────────────────────────
// BENCHMARK SUITE — Search subsystem (index query, omnibox pipeline, classify + rank, archive persistence)
//
// The "Performance Gate" of the search-engine plan (§6): searching must feel instant.
//   · classify + rank a result list ........................ p95 < 2.5 ms
//   · one keystroke through the local omnibox pipeline ..... p95 < 16 ms (one 60 Hz frame)
//   · Bm25Index.search over a 10,000-page archive .......... p95 < 15 ms
//   · the same with typo tolerance (fuzzy) ................. p95 < 15 ms
//   · saving one new page into a 10,000-page archive ....... p95 < 50 ms
//   · loading the archive: decoding one shard, restoring one slice of pages ... p95 < 16 ms each (a frame)
// The corpus is deterministic (seeded PRNG, Zipf-distributed vocabulary), so runs are comparable.
// ─────────────────────────────────────────────────────────────────────────────

import { bench, benchAsync, summarize, suite } from '../runner';
import type { BenchmarkResult, SuiteResult } from '../runner';
import { Bm25Index } from '../../browser/search/bm25-index';
import type { IndexableDocument, PersistedDoc } from '../../browser/search/bm25-index';
import { MemoryIndexStorage } from '../../browser/search/archive-storage';
import { PersonalSearchArchive } from '../../browser/search/search-archive';
import { META_ID, RESTORE_SLICE, SHARD_SIZE, decodeShard, encodeMeta, encodeShard, shardId, shardOf } from '../../browser/search/archive-shards';
import { classifyQuery } from '../../browser/omnibox/query-classifier';
import type { OmniboxResult } from '../../browser/omnibox/omnibox';
import { arrangeResults } from '../../ui/components/omnibox-controller';
import type { OmniboxViewPort } from '../../ui/components/omnibox-controller';
import { SearchSubsystem } from '../../ui/components/search-subsystem';
import { AddressBar } from '../../ui/components/address-bar/address-bar';

/** p95 latency budgets, in milliseconds. */
export const SEARCH_BUDGETS = {
  classifyAndRank: 2.5,
  keystroke: 16,
  indexQuery: 15,
  typoQuery: 15,
  /** Saving blocks the main thread for this long at most; the whole-snapshot save it replaced took ~380 ms at this size. */
  archiveSave: 50,
  /** Loading yields between slices; each slice (parsing a shard, restoring a few dozen pages) must fit in one frame. */
  archiveLoadSlice: 16,
} as const;

export const CORPUS_SIZE = 10_000;
export const VOCABULARY_SIZE = 50_000;
const HISTORY_SIZE = 5_000;
const BOOKMARK_SIZE = 500;
const TAB_COUNT = 30;
const BASE_TIME = Date.UTC(2026, 9, 1);

// ─── Deterministic corpus ───────────────────────────────────────────────────

/** mulberry32: a tiny seeded PRNG, so every run builds the identical corpus. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CONSONANTS = 'bcdfghjklmnprstvwz';
const VOWELS = 'aeiou';
const SYLLABLES: string[] = [];
for (const c of CONSONANTS) for (const v of VOWELS) SYLLABLES.push(c + v);

/** `count` distinct pronounceable pseudo-words: three digits encode the rank, a hashed lead syllable spreads the prefixes. */
export function buildVocabulary(count: number): string[] {
  const n = SYLLABLES.length;
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    const lead = Math.imul(i + 1, 2654435761) >>> 0;
    words.push(SYLLABLES[lead % n]! + SYLLABLES[Math.floor(i / (n * n)) % n]! + SYLLABLES[Math.floor(i / n) % n]! + SYLLABLES[i % n]!);
  }
  return words;
}

/** Zipf-like rank in [0, size): P(rank) ∝ 1 / (rank + 1), the shape of real word frequencies. */
const zipfRank = (random: () => number, size: number): number => Math.min(size - 1, Math.floor(Math.pow(size, random())) - 1);

export interface Query { readonly shape: string; readonly text: string }

export interface SearchCorpus {
  readonly index: Bm25Index;
  readonly words: readonly string[];
  /** Index queries covering common, mid-frequency and rare terms, multi-term queries and typed prefixes. */
  readonly queries: readonly Query[];
  /** Queries with a misspelled word that no page contains, to run with `fuzzy: true`. */
  readonly typoQueries: readonly Query[];
  /** Every prefix of a few typed phrases — what the address bar sees keystroke by keystroke. */
  readonly keystrokes: readonly string[];
}

function makeDocument(i: number, random: () => number, words: readonly string[]): IndexableDocument {
  const pick = (): string => words[zipfRank(random, words.length)]!;
  const phrase = (length: number): string => Array.from({ length }, pick).join(' ');
  return {
    url: `https://site${i % 997}.example.com/page/${i}`,
    title: phrase(4 + (i % 5)),
    headings: [
      { level: 1, text: phrase(3) },
      { level: 2, text: phrase(4) },
      { level: 2, text: phrase(4) },
      { level: 3, text: phrase(3) },
    ],
    description: phrase(18),
    body: phrase(150),
    visitedAt: BASE_TIME - i * 60_000,
  };
}

function buildQueries(words: readonly string[], random: () => number): Query[] {
  const common = (): string => words[Math.floor(random() * 30)]!;
  const mid = (): string => words[500 + Math.floor(random() * 1000)]!;
  const rare = (): string => words[30_000 + Math.floor(random() * 15_000)]!;
  const queries: Query[] = [];
  const add = (shape: string, make: () => string, copies = 6): void => {
    for (let i = 0; i < copies; i++) queries.push({ shape, text: make() });
  };
  add('1 common term', common);
  add('1 mid term', mid);
  add('1 rare term', rare);
  add('2 terms', () => `${common()} ${mid()}`);
  add('3 terms', () => `${common()} ${mid()} ${rare()}`);
  add('2-char prefix of a common term', () => common().slice(0, 2));
  add('3-char prefix of a common term', () => common().slice(0, 3));
  add('4-char prefix of a mid term', () => mid().slice(0, 4));
  add('term + 4-char prefix', () => `${common()} ${mid().slice(0, 4)}`);
  return queries;
}

/** `word` with one typo that keeps its first letter: two neighbouring letters swapped, one dropped, or one replaced. */
export function misspell(word: string, kind: 'swap' | 'drop' | 'replace'): string {
  const at = 2;
  if (kind === 'swap') return word.slice(0, at) + word[at + 1] + word[at] + word.slice(at + 2);
  if (kind === 'drop') return word.slice(0, at) + word.slice(at + 1);
  return word.slice(0, at) + (word[at] === 'z' ? 'b' : 'z') + word.slice(at + 1);
}

function buildTypoQueries(index: Bm25Index, words: readonly string[], random: () => number): Query[] {
  const common = (): string => words[Math.floor(random() * 30)]!;
  const typo = (kind: 'swap' | 'drop' | 'replace'): string => {
    for (;;) { // a real typo: a word no page contains and no page word starts with
      const word = misspell(words[500 + Math.floor(random() * 1000)]!, kind);
      if (index.search(word, { limit: 1 }).length === 0) return word;
    }
  };
  const queries: Query[] = [];
  const add = (shape: string, make: () => string, copies = 6): void => {
    for (let i = 0; i < copies; i++) queries.push({ shape, text: make() });
  };
  add('1 misspelled mid term (swapped letters)', () => typo('swap'));
  add('1 misspelled mid term (dropped letter)', () => typo('drop'));
  add('1 misspelled mid term (wrong letter)', () => typo('replace'));
  add('common term + misspelled mid term', () => `${common()} ${typo('swap')}`);
  return queries;
}

let cached: SearchCorpus | null = null;

/** The 10,000-page archive index and its query sets. Built once per process (a few seconds). */
export function buildSearchCorpus(): SearchCorpus {
  if (cached) return cached;
  const random = seededRandom(0x5eed);
  const words = buildVocabulary(VOCABULARY_SIZE);
  const index = new Bm25Index();
  for (let i = 0; i < CORPUS_SIZE; i++) index.upsert(makeDocument(i, random, words));

  const typed = [`${words[3]!} ${words[800]!}`, `${words[12]!} ${words[2400]!} ${words[31_000]!}`, `${words[1]!} ${words[400]!}`, words[5]!];
  const keystrokes = typed.flatMap((phrase) => Array.from({ length: phrase.length }, (_, k) => phrase.slice(0, k + 1)));
  cached = { index, words, queries: buildQueries(words, random), typoQueries: buildTypoQueries(index, words, random), keystrokes };
  return cached;
}

let stagedRecords: ReadonlyMap<string, string> | null = null;

/** A storage holding the corpus as the archive writes it (shard records + meta): a profile after browsing 10,000 pages. The records are built once. */
export function stageArchive(corpus: SearchCorpus): MemoryIndexStorage {
  if (!stagedRecords) {
    const byShard = new Map<number, PersistedDoc[]>();
    for (const doc of corpus.index.toPersisted()) {
      const shard = shardOf(doc[6]);
      const docs = byShard.get(shard) ?? [];
      docs.push(doc);
      byShard.set(shard, docs);
    }
    const records = new Map<string, string>([...byShard].map(([shard, docs]) => [shardId(shard), encodeShard(docs)]));
    records.set(META_ID, encodeMeta({ next: corpus.index.nextSeq, removed: [] }));
    stagedRecords = records;
  }
  const storage = new MemoryIndexStorage();
  for (const [id, data] of stagedRecords) storage.records.set(id, data);
  return storage;
}

// ─── Omnibox pipeline (real controller + providers; fake history/bookmark sources) ────────────────────────

/** An address bar to drive instead of the default model-only one (e.g. a real view in a DOM). */
export interface PipelineUi {
  readonly bar: AddressBar;
  readonly view: OmniboxViewPort;
}

export interface Pipeline {
  /** One keystroke through the model: the typing event, classification, every local provider, merge and rank. */
  type(text: string): Promise<void>;
  /** Resolves when the omnibox has finished the keystroke that was just typed (for callers that type into a real input). */
  settled(): Promise<unknown>;
  /** Rows shown after the last keystroke. */
  readonly rows: () => readonly OmniboxResult[];
  isBang(keyword: string): boolean;
  dispose(): void;
}

/** The subsystem over 5k history entries, 500 bookmarks, 30 tabs and the 10k archive, on a model-only address bar unless `ui` says otherwise. */
export async function createPipeline(corpus: SearchCorpus, ui?: PipelineUi): Promise<Pipeline> {
  const random = seededRandom(0xb00c);
  const phrase = (length: number): string => Array.from({ length }, () => corpus.words[zipfRank(random, corpus.words.length)]!).join(' ');

  const history = Array.from({ length: HISTORY_SIZE }, (_, i) => {
    const title = phrase(3);
    const url = `https://site${i % 997}.example.com/h/${i}`;
    return {
      entry: { id: `h${i}`, url, title, visitCount: 1 + (i % 40), typedCount: i % 7, lastVisitTime: BASE_TIME - i * 90_000 },
      haystack: `${title} ${url}`.toLowerCase(),
    };
  });
  const bookmarks = Array.from({ length: BOOKMARK_SIZE }, (_, i) => {
    const title = phrase(2);
    return { entry: { id: `b${i}`, title, url: `https://marks${i % 50}.example.org/${i}`, iconUrl: null, folder: false }, haystack: title.toLowerCase() };
  });
  const tabs = Array.from({ length: TAB_COUNT }, (_, i) => ({
    id: `t${i}`, title: phrase(3), url: `https://tabs${i}.example.net/`, active: i === 0,
  }));

  const storage = stageArchive(corpus);

  const subsystem = new SearchSubsystem({
    settings: () => ({
      getBoolean: (key, fallback = false) => (key === 'enableSearchSuggestions' ? false : fallback), // no network
      getString: (_key, fallback = '') => fallback,
    }),
    history: () => ({
      query: async ({ query = '', maxResults = 10 }) => ({
        entries: history.filter((h) => h.haystack.includes(query.toLowerCase())).slice(0, maxResults).map((h) => h.entry),
      }),
    }),
    bookmarks: () => ({ search: async (q) => bookmarks.filter((b) => b.haystack.includes(q.toLowerCase())).map((b) => b.entry) }),
    listTabs: () => tabs,
    isIncognito: () => false,
    defaultEngine: () => ({ name: 'Nova', searchUrl: (q) => `nova://search?q=${encodeURIComponent(q)}` }),
    normalizeUrl: (raw) => (/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`),
    archiveStorage: storage,
  });
  await subsystem.archive.load();

  const noop = (): void => undefined;
  const bar = ui?.bar ?? new AddressBar();
  subsystem.attach(bar, ui?.view ?? {
    setSubmitInterceptor: noop, setResultHandler: noop, setRowActionHandler: noop, setQueryBadge: noop,
  }, {
    open: noop, search: noop, switchTab: noop, runAction: noop, research: noop, copy: noop, fill: noop, deleteHistory: noop,
  });

  // The controller starts the omnibox call synchronously inside the typing event; keep its promise to await completion.
  let pending: Promise<unknown> = Promise.resolve();
  const original = subsystem.omnibox.onInputChanged.bind(subsystem.omnibox);
  subsystem.omnibox.onInputChanged = (...args) => (pending = original(...args));
  let shown: readonly OmniboxResult[] = [];
  bar.on('resultsChanged', (event) => { shown = (event as { readonly results: readonly OmniboxResult[] }).results; });

  return {
    async type(text) {
      bar.setDraft(text);
      await pending;
    },
    settled: () => pending,
    rows: () => shown,
    isBang: (keyword) => subsystem.bangs.has(keyword),
    dispose: () => subsystem.dispose(),
  };
}

// ─── The suite ──────────────────────────────────────────────────────────────

/** Names the gates look up in the suite's results. */
export const BENCH_NAMES = {
  indexQuery: 'Bm25Index.search · 10,000 pages · all query shapes',
  typoQuery: 'Bm25Index.search · 10,000 pages · typo queries (fuzzy)',
  classifyAndRank: 'classifyQuery + arrangeResults · typical candidate rows',
  keystroke: 'omnibox keystroke · local providers · 10,000-page archive',
  archiveSave: 'archive save · one new page · 10,000-page archive',
  archiveDecodeShard: `archive load · decode one shard (${SHARD_SIZE} pages)`,
  archiveRestoreSlice: `archive load · restore ${RESTORE_SLICE} pages into the index`,
  archiveLoadAll: `archive load · all ${CORPUS_SIZE / SHARD_SIZE} shards · ${CORPUS_SIZE.toLocaleString('en-US')} pages (background)`,
  snapshotSave: 'before sharding · save = toSnapshot + JSON.stringify',
  snapshotLoad: 'before sharding · load = JSON.parse + fromSnapshot',
} as const;

export interface Gate { readonly name: string; readonly bench: string; readonly budgetMs: number }

export const SEARCH_GATES: readonly Gate[] = [
  { name: 'Index query (10,000 pages)', bench: BENCH_NAMES.indexQuery, budgetMs: SEARCH_BUDGETS.indexQuery },
  { name: 'Typo-tolerant query', bench: BENCH_NAMES.typoQuery, budgetMs: SEARCH_BUDGETS.typoQuery },
  { name: 'Classify + rank', bench: BENCH_NAMES.classifyAndRank, budgetMs: SEARCH_BUDGETS.classifyAndRank },
  { name: 'Keystroke → ranked rows', bench: BENCH_NAMES.keystroke, budgetMs: SEARCH_BUDGETS.keystroke },
  { name: 'Archive save, one new page', bench: BENCH_NAMES.archiveSave, budgetMs: SEARCH_BUDGETS.archiveSave },
  { name: 'Archive load, decode a shard', bench: BENCH_NAMES.archiveDecodeShard, budgetMs: SEARCH_BUDGETS.archiveLoadSlice },
  { name: 'Archive load, restore a slice', bench: BENCH_NAMES.archiveRestoreSlice, budgetMs: SEARCH_BUDGETS.archiveLoadSlice },
];

export interface SuiteSize {
  /** Measured calls per benchmark (default 1500). */
  readonly iterations?: number;
  readonly warmup?: number;
}

/**
 * Saving and restoring the 10,000-page archive. The save is timed alone (the page is indexed first, outside the clock)
 * and runs at the archive's size limit, so every new page also evicts the oldest — the steady state of a full archive.
 * The `before sharding` rows measure what a save and a load used to cost: the whole index as one JSON string.
 */
async function persistenceBenchmarks(corpus: SearchCorpus, warmup: number, iterations: number): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];
  const config = { isEnabled: () => true, isIncognito: () => false, saveDelayMs: 60 * 60_000 }; // saves only when flushed here

  const storage = stageArchive(corpus);
  const archive = new PersonalSearchArchive({ storage, ...config });
  await archive.load();
  const random = seededRandom(0xa11c);
  const saves: number[] = [];
  let lastUrl = '';
  for (let i = 0; i < warmup + iterations; i++) {
    // The newest page of all: an older one would be evicted the moment it arrived (the archive is at its limit) and nothing would be saved.
    const page = { ...makeDocument(CORPUS_SIZE + i, random, corpus.words), visitedAt: BASE_TIME + i * 60_000 };
    lastUrl = page.url;
    archive.indexNow(page);
    const start = performance.now();
    await archive.flush();
    if (i >= warmup) saves.push(performance.now() - start);
  }
  archive.dispose();
  const newest = [...storage.records.keys()].filter((id) => id.startsWith('shard:')).sort().pop()!;
  if (!decodeShard(storage.records.get(newest)!)?.some((d) => d[0] === lastUrl)) throw new Error('the archive-save benchmark did not save the pages it indexed');
  results.push(summarize(BENCH_NAMES.archiveSave, saves, warmup));

  const shard = stageArchive(corpus).records.get(shardId(4))!;
  results.push(bench(BENCH_NAMES.archiveDecodeShard, () => { decodeShard(shard); }, { warmup: 10, iterations: 60, measureHeap: false }));
  const slice = decodeShard(shard)!.slice(0, RESTORE_SLICE);
  results.push(bench(BENCH_NAMES.archiveRestoreSlice, () => {
    const index = new Bm25Index();
    for (const page of slice) index.addPersisted(page);
  }, { warmup: 10, iterations: 60, measureHeap: false }));

  results.push(await benchAsync(BENCH_NAMES.archiveLoadAll, async () => {
    const loaded = new PersonalSearchArchive({ storage: stageArchive(corpus), ...config });
    await loaded.load();
    loaded.dispose();
  }, { warmup: 0, iterations: 3, measureHeap: false }));

  let snapshot = '';
  results.push(bench(BENCH_NAMES.snapshotSave, () => { snapshot = JSON.stringify(corpus.index.toSnapshot()); }, { warmup: 1, iterations: 3, measureHeap: false }));
  results.push(bench(BENCH_NAMES.snapshotLoad, () => { Bm25Index.fromSnapshot(JSON.parse(snapshot)); }, { warmup: 1, iterations: 3, measureHeap: false }));
  return results;
}

export async function searchSuite(size: SuiteSize = {}): Promise<SuiteResult> {
  const started = performance.now();
  const OPTIONS = { warmup: size.warmup ?? 200, iterations: size.iterations ?? 1500, measureHeap: false } as const;
  const corpus = buildSearchCorpus();
  const benchmarks: BenchmarkResult[] = [];

  // Index queries: every shape together (the gate) and one by one (where the time goes).
  let q = 0;
  benchmarks.push(bench(BENCH_NAMES.indexQuery, () => { corpus.index.search(corpus.queries[q++ % corpus.queries.length]!.text); }, OPTIONS));
  for (const shape of new Set(corpus.queries.map((x) => x.shape))) {
    const texts = corpus.queries.filter((x) => x.shape === shape).map((x) => x.text);
    let i = 0;
    benchmarks.push(bench(`  Bm25Index.search · ${shape}`, () => { corpus.index.search(texts[i++ % texts.length]!); }, OPTIONS));
  }

  // Typo tolerance: misspelled words, searched with `fuzzy: true` (the omnibox and the search page do).
  let t = 0;
  benchmarks.push(bench(BENCH_NAMES.typoQuery, () => { corpus.index.search(corpus.typoQueries[t++ % corpus.typoQueries.length]!.text, { fuzzy: true }); }, OPTIONS));
  for (const shape of new Set(corpus.typoQueries.map((x) => x.shape))) {
    const texts = corpus.typoQueries.filter((x) => x.shape === shape).map((x) => x.text);
    let i = 0;
    benchmarks.push(bench(`  Bm25Index.search (fuzzy) · ${shape}`, () => { corpus.index.search(texts[i++ % texts.length]!, { fuzzy: true }); }, OPTIONS));
  }

  benchmarks.push(...await persistenceBenchmarks(corpus, OPTIONS.warmup, OPTIONS.iterations));

  // The omnibox, typed keystroke by keystroke.
  const pipeline = await createPipeline(corpus);
  try {
    const rowsFor = new Map<string, readonly OmniboxResult[]>();
    for (const text of corpus.keystrokes) { await pipeline.type(text); rowsFor.set(text, pipeline.rows()); }

    let k = 0;
    benchmarks.push(await benchAsync(BENCH_NAMES.keystroke, async () => { await pipeline.type(corpus.keystrokes[k++ % corpus.keystrokes.length]!); }, OPTIONS));

    let c = 0;
    benchmarks.push(bench(BENCH_NAMES.classifyAndRank, () => {
      const text = corpus.keystrokes[c++ % corpus.keystrokes.length]!;
      const classified = classifyQuery(text, { isBang: (keyword) => pipeline.isBang(keyword) });
      arrangeResults(rowsFor.get(text) ?? [], text, classified.intent);
    }, OPTIONS));
  } finally {
    pipeline.dispose();
  }

  return { name: 'Search subsystem', benchmarks, totalMs: performance.now() - started };
}
