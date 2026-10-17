import { ASCENT, buildCorpus, rectOf, runWidth } from './find-in-page';
import type { FindRect, FindTextSource, Segment } from './find-in-page';

const WORD_CHAR = /[\p{L}\p{N}_]/u;
/** Below the baseline a line box reaches this far (layout uses a 1.2 em line box, 0.8 em above the baseline). */
const DESCENT = 0.4;

/**
 * A text selection over a page that is only a bitmap: two offsets into the page's searchable text (the same text
 * find-in-page searches), so it needs no DOM nodes and survives a repaint. Geometry comes from the layout's text
 * runs; the page text is re-read when `refresh()` is called (a new gesture, a repaint).
 */
class PageSelection {
  private corpus: { text: string; segments: Segment[] } | null = null;
  private anchor = 0;
  private focus = 0;

  constructor(private readonly source: FindTextSource) {}

  /** Re-reads the page text (layout changed). The selection offsets are kept. */
  refresh(): void {
    this.corpus = null;
    const length = this.data().text.length;
    this.anchor = Math.min(this.anchor, length);
    this.focus = Math.min(this.focus, length);
  }

  get isEmpty(): boolean { return this.anchor === this.focus; }

  /** The selected text; blocks (paragraphs, cells…) are separated by a line break. */
  text(): string {
    const [start, end] = this.range();
    return this.data().text.slice(start, end);
  }

  /** One rectangle per run the selection touches, in page-bitmap coordinates. */
  rects(): FindRect[] {
    const [start, end] = this.range();
    if (start === end) return [];
    return this.data().segments.filter((s) => s.end > start && s.start < end).map((s) => rectOf(s, start, end));
  }

  /** Whether the page point lies on selected text. */
  contains(x: number, y: number): boolean {
    return this.rects().some((r) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height);
  }

  /** The text offset nearest the page point: the line the point is on (or nearest), then the character within it. */
  caretAt(x: number, y: number): number | null {
    let best: Segment | null = null;
    let bestScore = Infinity;
    for (const seg of this.data().segments) {
      const { run } = seg;
      const top = run.y - run.fontSize * ASCENT;
      const bottom = run.y + run.fontSize * DESCENT;
      const width = runWidth(run);
      const dy = y < top ? top - y : y > bottom ? y - bottom : 0;
      const dx = x < run.x ? run.x - x : x > run.x + width ? x - (run.x + width) : 0;
      const score = dy * 1000 + dx; // the line decides first, then the horizontal distance
      if (score < bestScore) { bestScore = score; best = seg; }
    }
    if (!best) return null;
    const width = runWidth(best.run);
    const within = Math.round(((x - best.run.x) / width) * best.run.text.length);
    return best.start + Math.max(0, Math.min(best.run.text.length, within));
  }

  /** Starts a new selection at `offset` (empty until extended). */
  start(offset: number): void {
    this.anchor = this.focus = offset;
  }

  extendTo(offset: number): void {
    this.focus = offset;
  }

  selectWord(offset: number): void {
    const text = this.data().text;
    let start = offset;
    let end = offset;
    while (start > 0 && WORD_CHAR.test(text[start - 1]!)) start--;
    while (end < text.length && WORD_CHAR.test(text[end]!)) end++;
    this.anchor = start;
    this.focus = end;
  }

  /** The whole block (paragraph, cell…) around `offset`. */
  selectBlock(offset: number): void {
    const text = this.data().text;
    const before = text.lastIndexOf('\n', Math.max(0, offset - 1));
    const after = text.indexOf('\n', offset);
    this.anchor = before === -1 ? 0 : before + 1;
    this.focus = after === -1 ? text.length : after;
  }

  selectAll(): void {
    this.anchor = 0;
    this.focus = this.data().text.length;
  }

  clear(): void {
    this.anchor = this.focus = 0;
    this.corpus = null;
  }

  private range(): [number, number] {
    return this.anchor <= this.focus ? [this.anchor, this.focus] : [this.focus, this.anchor];
  }

  private data(): { text: string; segments: Segment[] } {
    return (this.corpus ??= buildCorpus(this.source));
  }
}

export { PageSelection };
