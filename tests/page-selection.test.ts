import { describe, it, expect } from 'vitest';
import { PageSelection } from '../src/browser/navigation-controls/page-selection';
import type { FindBlock, FindRun, FindTextSource } from '../src/browser/navigation-controls/find-in-page';

const FS = 16;
const CHAR = 8; // every character is 8 px wide in these fixtures

/** A block of runs the way layout emits them: one per word and per space, 8 px per character, baseline at `y`. */
function block(text: string, x0: number, y: number): FindBlock {
  const runs: FindRun[] = [];
  let x = x0;
  for (const token of text.split(/(\s+)/).filter(Boolean)) {
    runs.push({ text: token, x, y, fontSize: FS, width: token.length * CHAR });
    x += token.length * CHAR;
  }
  return { runs };
}

const source = (blocks: FindBlock[]): FindTextSource & { set(b: FindBlock[]): void } => {
  let current = blocks;
  return { getBlocks: () => current, set: (b) => { current = b; } };
};

// "Hello brave new world" starts at x=10, baseline y=20; "Second paragraph" at x=10, baseline y=60.
const PAGE = (): FindTextSource & { set(b: FindBlock[]): void } => source([block('Hello brave new world', 10, 20), block('Second paragraph', 10, 60)]);
const xOf = (charIndex: number): number => 10 + charIndex * CHAR;

describe('PageSelection', () => {
  it('finds the character under a point: the line first, then the position within it', () => {
    const s = new PageSelection(PAGE());
    expect(s.caretAt(xOf(6), 14)).toBe(6); // before "brave"
    expect(s.caretAt(xOf(6) + 3, 14)).toBe(6); // 3 px into the "b": nearer its left edge
    expect(s.caretAt(xOf(6) + 5, 14)).toBe(7); // nearer its right edge
    expect(s.caretAt(xOf(3), 55)).toBe(21 + 1 + 3); // the second line (after "…world" and a line break)
    expect(s.caretAt(5, 14)).toBe(0); // left of the line
    expect(s.caretAt(900, 14)).toBe(21); // right of the line: its end
    expect(new PageSelection(source([])).caretAt(10, 10)).toBeNull();
  });

  it('a point between lines belongs to the nearer one', () => {
    const s = new PageSelection(PAGE());
    expect(s.caretAt(xOf(2), 30)).toBe(2); // 10 px under the first baseline, far from the second line
    expect(s.caretAt(xOf(2), 44)).toBe(21 + 1 + 2); // closer to the second line
  });

  it('selects by dragging, in either direction', () => {
    const s = new PageSelection(PAGE());
    s.start(s.caretAt(xOf(6), 14)!);
    s.extendTo(s.caretAt(xOf(11), 14)!);
    expect(s.text()).toBe('brave');
    s.start(s.caretAt(xOf(11), 14)!);
    s.extendTo(s.caretAt(xOf(6), 14)!);
    expect(s.text()).toBe('brave');
  });

  it('a drag across blocks keeps their line break', () => {
    const s = new PageSelection(PAGE());
    s.start(s.caretAt(xOf(12), 14)!);
    s.extendTo(s.caretAt(xOf(6), 54)!);
    expect(s.text()).toBe('new world\nSecond');
  });

  it('is empty until it is extended', () => {
    const s = new PageSelection(PAGE());
    s.start(4);
    expect(s.isEmpty).toBe(true);
    expect(s.text()).toBe('');
    expect(s.rects()).toEqual([]);
    s.extendTo(8);
    expect(s.isEmpty).toBe(false);
  });

  it('selects a word, a whole block, or everything', () => {
    const s = new PageSelection(PAGE());
    s.selectWord(s.caretAt(xOf(8), 14)!);
    expect(s.text()).toBe('brave');
    s.selectBlock(s.caretAt(xOf(8), 14)!);
    expect(s.text()).toBe('Hello brave new world');
    s.selectBlock(s.caretAt(xOf(3), 54)!);
    expect(s.text()).toBe('Second paragraph');
    s.selectAll();
    expect(s.text()).toBe('Hello brave new world\nSecond paragraph');
  });

  it('a word stops at punctuation, and a double-click between words selects nothing odd', () => {
    const s = new PageSelection(source([block('well-known, state_of_the_art', 10, 20)]));
    s.selectWord(2);
    expect(s.text()).toBe('well');
    s.selectWord(15);
    expect(s.text()).toBe('state_of_the_art');
  });

  it('gives one rectangle per run it touches, cut at the selection edges', () => {
    const s = new PageSelection(PAGE());
    s.start(2); // inside "Hello"
    s.extendTo(8); // inside "brave": "llo br"
    const rects = s.rects();
    expect(rects).toHaveLength(3); // "Hello", the space, "brave"
    expect(rects[0]).toMatchObject({ x: xOf(2), width: 3 * CHAR });
    expect(rects[2]).toMatchObject({ x: xOf(6), width: 2 * CHAR });
    expect(rects[0]!.y).toBeCloseTo(20 - FS * 0.8, 5);
    expect(rects[0]!.height).toBeCloseTo(FS * 1.2, 5);
  });

  it('knows whether a point is on the selection', () => {
    const s = new PageSelection(PAGE());
    s.selectWord(8); // "brave", x 58..98
    expect(s.contains(70, 14)).toBe(true);
    expect(s.contains(70, 40)).toBe(false); // between the lines
    expect(s.contains(20, 14)).toBe(false); // "Hello"
  });

  it('keeps its offsets across a refresh and clamps them if the page shrank', () => {
    const page = PAGE();
    const s = new PageSelection(page);
    s.selectAll();
    page.set([block('Short', 10, 20)]);
    s.refresh();
    expect(s.text()).toBe('Short');
    s.clear();
    expect(s.isEmpty).toBe(true);
  });
});
