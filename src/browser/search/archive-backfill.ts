import type { IDisposable } from '../../app/dependency-container';
import type { IndexableDocument } from './bm25-index';
import { extractIndexableDocument } from './content-extractor';
import { HtmlParser } from '../rendering/html-parser';
import { DomTree } from '../rendering/dom-tree';

/**
 * Fills the personal archive from pages the user visited or saved before indexing was on: history (newest first), then
 * bookmarks. One page at a time with a pause between them, a cap per session, and nothing it has already indexed or
 * ruled out is fetched again (resuming is free: the archive and the skip list remember). Stops on its own when indexing
 * is not allowed (setting off, private window) and backs off when the network keeps failing.
 *
 * Fetching a history entry again is a GET with the user's cookies, so addresses that act when opened (sign-out,
 * unsubscribe, confirm, reset, payment, one-time tokens) are never fetched.
 */

interface BackfillCandidate {
  readonly url: string;
  readonly title: string;
  /** When it was visited (history) or saved (bookmarks): what the results page shows as "Visited …". */
  readonly visitedAt: number;
}

interface FetchedDocument {
  readonly statusCode: number;
  readonly contentType: string;
  readonly body: string;
}

interface BackfillArchive {
  canIndex(url: string): boolean;
  has(url: string): boolean;
  indexNow(doc: IndexableDocument): boolean;
}

interface SkipStore {
  has(url: string): boolean;
  add(url: string): void;
}

interface ArchiveBackfillDeps {
  candidates(): Promise<readonly BackfillCandidate[]>;
  fetchDocument(url: string, signal: AbortSignal): Promise<FetchedDocument>;
  readonly archive: BackfillArchive;
  /** Pages that cannot be indexed (not HTML, an error, a login page, risky): never fetched again. */
  readonly skipped: SkipStore;
  readonly gapMs?: number;
  readonly maxFetchesPerSession?: number;
  readonly timeoutMs?: number;
  /** Consecutive network failures before the run stops (offline). */
  readonly maxFailures?: number;
  readonly sleep?: (ms: number) => Promise<void>;
}

type BackfillState = 'idle' | 'running' | 'paused' | 'done' | 'stopped';

interface BackfillStats {
  readonly state: BackfillState;
  /** Candidates looked at so far (indexed, already indexed, or skipped). */
  readonly done: number;
  readonly total: number;
  /** Pages this run added to the archive. */
  readonly indexed: number;
  /** Why a run stopped early ('offline', 'disabled', 'limit'), else null. */
  readonly reason: string | null;
}

/** Addresses that act when opened, or carry a one-time secret: never re-fetched. */
const RISKY_URL = /log-?out|sign-?out|sign-?off|unsubscribe|opt-?out|delete|remove|confirm|verif|activat|reset|passw|token|otp|auth|oauth|callback|session|checkout|cart|payment|\/pay\b|invite|magic|download|export|print/i;
const MAX_BODY_CHARS = 2_000_000;

const sleepMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Whether a history or bookmark address may be fetched again in the background. */
function isBackfillable(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (u.username || u.password) return false;
  return !RISKY_URL.test(u.pathname + u.search);
}

class ArchiveBackfill implements IDisposable {
  private state: BackfillState = 'idle';
  private reason: string | null = null;
  private done = 0;
  private total = 0;
  private indexed = 0;
  private fetches = 0;
  private list: readonly BackfillCandidate[] = [];
  private position = 0;
  private controller: AbortController | null = null;
  private readonly handlers = new Set<() => void>();
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: ArchiveBackfillDeps) {
    this.sleep = deps.sleep ?? sleepMs;
  }

  stats(): BackfillStats {
    return { state: this.state, done: this.done, total: this.total, indexed: this.indexed, reason: this.reason };
  }

  onChange(handler: () => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  /** Starts (or restarts after a stop) a run over the current history and bookmarks. No-op while one is running or paused. */
  async start(): Promise<void> {
    if (this.state === 'running' || this.state === 'paused') return;
    const controller = new AbortController();
    this.controller?.abort();
    this.controller = controller;
    this.reason = null;
    this.setState('running');
    try {
      const seen = new Set<string>();
      this.list = (await this.deps.candidates()).filter((c) => !seen.has(c.url) && (seen.add(c.url), true));
    } catch {
      this.list = [];
    }
    if (controller.signal.aborted) return;
    this.position = 0;
    this.done = 0;
    this.indexed = 0;
    this.total = this.list.length;
    this.emit();
    await this.run(controller);
  }

  pause(): void {
    if (this.state !== 'running') return;
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused' || !this.controller) return;
    this.setState('running');
    void this.run(this.controller);
  }

  dispose(): void {
    this.controller?.abort();
    this.controller = null;
    this.handlers.clear();
    this.state = 'idle';
  }

  private async run(controller: AbortController): Promise<void> {
    const gap = this.deps.gapMs ?? 1500;
    const cap = this.deps.maxFetchesPerSession ?? 300;
    const maxFailures = this.deps.maxFailures ?? 5;
    let failures = 0;
    while (this.position < this.list.length) {
      if (controller.signal.aborted || this.state !== 'running') return;
      const page = this.list[this.position]!;
      if (!this.deps.archive.canIndex(page.url)) {
        // http(s) only: a nova:/about: entry just moves on; a setting turned off or a private window stops the run.
        if (/^https?:/i.test(page.url)) return this.stop('disabled');
        this.advance();
        continue;
      }
      if (this.deps.archive.has(page.url) || this.deps.skipped.has(page.url) || !isBackfillable(page.url)) {
        this.advance();
        continue;
      }
      if (this.fetches >= cap) return this.stop('limit');
      this.fetches++;
      const outcome = await this.indexOne(page, controller.signal);
      if (controller.signal.aborted) return;
      if (outcome === 'failed') {
        if (++failures >= maxFailures) return this.stop('offline');
      } else {
        failures = 0;
      }
      this.advance();
      await this.sleep(gap);
    }
    if (!controller.signal.aborted) this.setState('done');
  }

  /** 'indexed' | 'skipped' (not indexable: remembered) | 'failed' (network: tried again next session). */
  private async indexOne(page: BackfillCandidate, outer: AbortSignal): Promise<'indexed' | 'skipped' | 'failed'> {
    const local = new AbortController();
    const onAbort = (): void => local.abort();
    outer.addEventListener('abort', onAbort);
    const timer = setTimeout(() => local.abort(), this.deps.timeoutMs ?? 15_000);
    try {
      const res = await this.deps.fetchDocument(page.url, local.signal);
      const html = /html/i.test(res.contentType) || res.contentType === '';
      if (res.statusCode < 200 || res.statusCode >= 300 || !html || res.body.length > MAX_BODY_CHARS) {
        this.deps.skipped.add(page.url);
        return 'skipped';
      }
      const doc = new DomTree().buildFromHtml(new HtmlParser().parse(res.body).document);
      const extracted = extractIndexableDocument(doc, page.url, page.visitedAt);
      if (!extracted) {
        this.deps.skipped.add(page.url);
        return 'skipped';
      }
      // The extractor falls back to the address when a page has no title or h1; the history entry's title is better.
      const titled = extracted.title === page.url && page.title ? { ...extracted, title: page.title } : extracted;
      if (this.deps.archive.indexNow(titled)) this.indexed++;
      return 'indexed';
    } catch {
      return 'failed';
    } finally {
      clearTimeout(timer);
      outer.removeEventListener('abort', onAbort);
    }
  }

  private advance(): void {
    this.position++;
    this.done++;
    this.emit();
  }

  private stop(reason: string): void {
    this.reason = reason;
    this.setState('stopped');
  }

  private setState(state: BackfillState): void {
    this.state = state;
    this.emit();
  }

  private emit(): void {
    for (const h of this.handlers) {
      try { h(); } catch { /* a listener's problem */ }
    }
  }
}

/** The skip list in localStorage (best effort: unavailable storage just means pages are retried next session). */
function localSkipStore(key = 'nova.archive.backfill.skipped', max = 5000): SkipStore {
  let urls: string[] = [];
  try { urls = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]; } catch { urls = []; }
  const set = new Set(Array.isArray(urls) ? urls : []);
  return {
    has: (url) => set.has(url),
    add: (url) => {
      set.add(url);
      if (set.size > max) set.delete(set.values().next().value!);
      try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* storage full or blocked */ }
    },
  };
}

export { ArchiveBackfill, isBackfillable, localSkipStore };
export type { ArchiveBackfillDeps, BackfillCandidate, BackfillStats, BackfillState, FetchedDocument, SkipStore };
