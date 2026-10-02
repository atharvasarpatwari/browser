import type { IDisposable } from '../../app/dependency-container';

/** Highlight rectangle in page coordinates. */
interface FindRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface FindMatch {
  readonly index: number;
  readonly text: string;
  /** Surrounding page text, whitespace-collapsed. */
  readonly context: string;
  /** Offset of the match in the searchable page text. */
  readonly position: number;
  /** One rectangle per text run the match touches; empty when the source has no geometry. */
  readonly rects: readonly FindRect[];
}

/** A positioned piece of page text (the layout engine emits one per word and per space). */
interface FindRun {
  readonly text: string;
  readonly x: number;
  /** Text baseline. */
  readonly y: number;
  readonly fontSize: number;
  /** Advance width of the run when known; estimated from the font size otherwise. */
  readonly width?: number;
}

/** Runs belonging to one layout box (a paragraph, heading, cell…). A match never spans two blocks. */
interface FindBlock {
  readonly runs: readonly FindRun[];
}

interface FindTextSource {
  getBlocks(): readonly FindBlock[];
}

interface FindOptions {
  readonly caseSensitive?: boolean;
  readonly wholeWord?: boolean;
  /** Treat the query as a regular expression. */
  readonly regex?: boolean;
}

interface FindResult {
  readonly matches: FindMatch[];
  readonly activeIndex: number;
  readonly total: number;
  readonly query: string;
  /** Set when the query could not be used (invalid regular expression). */
  readonly error?: string;
  /** True when matching stopped at the safety cap. */
  readonly truncated?: boolean;
}

type FindEventKind = 'search' | 'navigated' | 'cleared';
interface FindEvent {
  readonly kind: FindEventKind;
  readonly result: FindResult;
}

type FindEventHandler = (event: FindEvent) => void;

interface IFindInPage extends IDisposable {
  find(query: string, options?: FindOptions): FindResult;
  /** Re-runs the last query against the current page text (after a repaint). */
  refresh(): FindResult;
  findNext(): FindMatch | null;
  findPrevious(): FindMatch | null;
  clear(): void;
  getActiveMatch(): FindMatch | null;
  getMatches(): readonly FindMatch[];
  getMatchCount(): number;
  getCurrentIndex(): number;
  /** Vertical position of every match as a 0–1 fraction of `pageHeight` (scrollbar tick marks). */
  getMatchTicks(pageHeight: number): number[];
  onEvent(handler: FindEventHandler): () => void;
}

const MAX_MATCHES = 5000;
const MAX_CORPUS_CHARS = 2_000_000;
const CONTEXT_CHARS = 40;
// Layout places the baseline 0.8 em below the line top and uses a 1.2 em line box.
const ASCENT = 0.8;
const LINE_HEIGHT = 1.2;
const ESTIMATED_CHAR_WIDTH = 0.55;

interface Segment {
  readonly start: number;
  readonly end: number;
  readonly run: FindRun;
}

const EMPTY_SOURCE: FindTextSource = { getBlocks: () => [] };

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Joins a block's runs into one string. The layout engine already emits explicit space runs between
 * words on a line, so runs are concatenated as-is; a space is inserted only where a wrap to a new
 * line left the words touching.
 */
function buildCorpus(source: FindTextSource): { text: string; segments: Segment[]; truncated: boolean } {
  let text = '';
  const segments: Segment[] = [];
  let truncated = false;

  for (const block of source.getBlocks()) {
    if (block.runs.length === 0) continue;
    if (text.length > MAX_CORPUS_CHARS) { truncated = true; break; }
    if (text.length > 0) text += '\n'; // blocks are never joined into one phrase

    let prev: FindRun | null = null;
    for (const run of block.runs) {
      if (run.text.length === 0) continue;
      if (prev && !/\s$/.test(prev.text) && !/^\s/.test(run.text) && Math.abs(run.y - prev.y) >= prev.fontSize * 0.5) {
        text += ' ';
      }
      segments.push({ start: text.length, end: text.length + run.text.length, run });
      text += run.text;
      prev = run;
    }
  }
  return { text, segments, truncated };
}

function buildPattern(query: string, options: FindOptions): RegExp {
  let body = options.regex ? query : escapeRegex(query.trim().replace(/\s+/g, ' ')).replace(/ /g, ' +');
  if (options.wholeWord) body = `(?<![\\p{L}\\p{N}_])(?:${body})(?![\\p{L}\\p{N}_])`;
  return new RegExp(body, options.caseSensitive ? 'gu' : 'giu');
}

function rectOf(seg: Segment, start: number, end: number): FindRect {
  const { run } = seg;
  const from = Math.max(start, seg.start) - seg.start;
  const to = Math.min(end, seg.end) - seg.start;
  const length = run.text.length;
  const width = run.width ?? length * run.fontSize * ESTIMATED_CHAR_WIDTH;
  return {
    x: run.x + (from / length) * width,
    y: run.y - run.fontSize * ASCENT,
    width: ((to - from) / length) * width,
    height: run.fontSize * LINE_HEIGHT,
  };
}

function contextOf(text: string, start: number, end: number): string {
  const from = Math.max(0, start - CONTEXT_CHARS);
  const to = Math.min(text.length, end + CONTEXT_CHARS);
  const slice = text.slice(from, to).replace(/\s+/g, ' ').trim();
  return (from > 0 ? '...' : '') + slice + (to < text.length ? '...' : '');
}

/**
 * Find-in-page over the page's positioned text. Case-insensitive by default; supports whole-word
 * and regular-expression modes. ponytail: a pathological user regex runs synchronously over the page
 * text (capped at 2M chars / 5000 matches); move to a worker if that ever hangs the UI.
 */
class FindInPage implements IFindInPage {
  private matches: FindMatch[] = [];
  private activeIndex = -1;
  private _query = '';
  private _options: FindOptions = {};
  private handlers = new Set<FindEventHandler>();

  constructor(private readonly source: FindTextSource = EMPTY_SOURCE) {}

  find(query: string, options: FindOptions = {}): FindResult {
    const hadMatches = this.matches.length > 0;
    this.reset();
    if (!query.trim()) {
      const result = this.snapshot();
      if (hadMatches) this.emit({ kind: 'cleared', result });
      return result;
    }

    this._query = query;
    this._options = options;
    const outcome = this.search(query, options);
    this.matches = outcome.matches;
    this.activeIndex = this.matches.length > 0 ? 0 : -1;

    const result = this.snapshot(outcome);
    this.emit({ kind: 'search', result });
    return result;
  }

  refresh(): FindResult {
    if (!this._query) return this.snapshot();
    const previous = this.activeIndex;
    const outcome = this.search(this._query, this._options);
    this.matches = outcome.matches;
    this.activeIndex = this.matches.length === 0 ? -1 : Math.min(Math.max(previous, 0), this.matches.length - 1);
    const result = this.snapshot(outcome);
    this.emit({ kind: 'search', result });
    return result;
  }

  findNext(): FindMatch | null {
    return this.step(1);
  }

  findPrevious(): FindMatch | null {
    return this.step(-1);
  }

  clear(): void {
    this.reset();
    this.emit({ kind: 'cleared', result: this.snapshot() });
  }

  getActiveMatch(): FindMatch | null {
    return this.activeIndex >= 0 && this.activeIndex < this.matches.length ? this.matches[this.activeIndex]! : null;
  }

  getMatches(): readonly FindMatch[] { return this.matches; }
  getMatchCount(): number { return this.matches.length; }
  getCurrentIndex(): number { return this.activeIndex; }

  getMatchTicks(pageHeight: number): number[] {
    if (!(pageHeight > 0)) return [];
    const ticks: number[] = [];
    for (const m of this.matches) {
      const first = m.rects[0];
      if (first) ticks.push(Math.min(1, Math.max(0, first.y / pageHeight)));
    }
    return ticks;
  }

  onEvent(handler: FindEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  dispose(): void {
    this.reset();
    this.handlers.clear();
  }

  private reset(): void {
    this.matches = [];
    this.activeIndex = -1;
    this._query = '';
    this._options = {};
  }

  private step(direction: 1 | -1): FindMatch | null {
    const n = this.matches.length;
    if (n === 0) return null;
    this.activeIndex = (this.activeIndex + direction + n) % n;
    this.emit({ kind: 'navigated', result: this.snapshot() });
    return this.matches[this.activeIndex]!;
  }

  private snapshot(outcome?: { error?: string; truncated?: boolean }): FindResult {
    return {
      matches: [...this.matches],
      activeIndex: this.activeIndex,
      total: this.matches.length,
      query: this._query,
      ...(outcome?.error ? { error: outcome.error } : {}),
      ...(outcome?.truncated ? { truncated: true } : {}),
    };
  }

  private search(query: string, options: FindOptions): { matches: FindMatch[]; error?: string; truncated?: boolean } {
    let pattern: RegExp;
    try {
      pattern = buildPattern(query, options);
    } catch (err) {
      return { matches: [], error: err instanceof SyntaxError ? 'Invalid regular expression' : 'Invalid query' };
    }

    const corpus = buildCorpus(this.source);
    const matches: FindMatch[] = [];
    let truncated = corpus.truncated;
    let seg = 0; // matches arrive in increasing order, so the segment cursor only moves forward

    for (;;) {
      const m = pattern.exec(corpus.text);
      if (m === null) break;
      if (m[0].length === 0) { pattern.lastIndex++; continue; }
      if (matches.length >= MAX_MATCHES) { truncated = true; break; }

      const start = m.index;
      const end = start + m[0].length;
      while (seg < corpus.segments.length && corpus.segments[seg]!.end <= start) seg++;
      const rects: FindRect[] = [];
      for (let s = seg; s < corpus.segments.length && corpus.segments[s]!.start < end; s++) {
        rects.push(rectOf(corpus.segments[s]!, start, end));
      }
      matches.push({ index: matches.length, text: m[0], context: contextOf(corpus.text, start, end), position: start, rects });
    }
    return { matches, ...(truncated ? { truncated } : {}) };
  }

  private emit(event: FindEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }
}

export { FindInPage };
export type {
  IFindInPage, FindMatch, FindOptions, FindResult, FindEvent, FindEventKind, FindEventHandler,
  FindRect, FindRun, FindBlock, FindTextSource,
};
