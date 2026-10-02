import { describe, it, expect, vi } from 'vitest';
import { FindInPage } from '../src/browser/navigation-controls/find-in-page';
import type { FindBlock, FindEvent, FindRun, FindTextSource } from '../src/browser/navigation-controls/find-in-page';

const run = (text: string, x = 0, y = 12.8, extra: Partial<FindRun> = {}): FindRun => ({ text, x, y, fontSize: 16, ...extra });
const source = (blocks: FindBlock[]): FindTextSource => ({ getBlocks: () => blocks });
const single = (text: string): FindTextSource => source([{ runs: [run(text)] }]);

describe('FindInPage — matching', () => {
  const text = 'The quick brown fox jumps over the lazy dog. The End.';

  it('is case-insensitive by default and reports the original text', () => {
    const f = new FindInPage(single(text));
    const r = f.find('the');
    expect(r.total).toBe(3);
    expect(r.matches.map((m) => m.text)).toEqual(['The', 'the', 'The']);
    expect(r.matches.map((m) => m.position)).toEqual([0, 31, 45]);
    expect(r.activeIndex).toBe(0);
    expect(r.query).toBe('the');
  });

  it('honours caseSensitive', () => {
    const f = new FindInPage(single(text));
    expect(f.find('the', { caseSensitive: true }).total).toBe(1);
    expect(f.find('The', { caseSensitive: true }).total).toBe(2);
  });

  it('honours wholeWord, including at the edges of the text and next to punctuation', () => {
    const f = new FindInPage(single('cat concatenate cat. cat, (cat) catalog'));
    expect(f.find('cat').total).toBe(6);
    expect(f.find('cat', { wholeWord: true }).total).toBe(4);
    expect(new FindInPage(single('ünï ünïcode')).find('ünï', { wholeWord: true }).total).toBe(1);
  });

  it('supports regular expressions', () => {
    const f = new FindInPage(single('call 555-1234 or 555-9876 now'));
    const r = f.find('\\d{3}-\\d{4}', { regex: true });
    expect(r.matches.map((m) => m.text)).toEqual(['555-1234', '555-9876']);
    expect(f.find('(?<=or )\\d+', { regex: true }).matches[0]!.text).toBe('555');
  });

  it('reports invalid regular expressions instead of throwing', () => {
    const f = new FindInPage(single('anything'));
    const r = f.find('(unclosed', { regex: true });
    expect(r.total).toBe(0);
    expect(r.error).toBe('Invalid regular expression');
    expect(f.getActiveMatch()).toBeNull();
  });

  it('skips empty regex matches instead of looping forever', () => {
    const f = new FindInPage(single('abc'));
    expect(f.find('x*', { regex: true }).total).toBe(0);
    expect(f.find('b*', { regex: true }).matches.map((m) => m.text)).toEqual(['b']);
  });

  it('treats regex metacharacters literally in plain mode', () => {
    const f = new FindInPage(single('1+1=2 (really) [maybe] a.b a*b'));
    expect(f.find('1+1').total).toBe(1);
    expect(f.find('(really)').total).toBe(1);
    expect(f.find('[maybe]').total).toBe(1);
    expect(f.find('a.b').total).toBe(1);
    expect(f.find('a*b').total).toBe(1);
  });

  it('matches across runs of spacing and trims the query', () => {
    const f = new FindInPage(single('hello world'));
    expect(f.find('  hello    world  ').total).toBe(1);
    expect(f.find('   ').total).toBe(0);
    expect(f.find('').total).toBe(0);
  });

  it('provides context with ellipses', () => {
    const long = `${'a'.repeat(100)} needle ${'b'.repeat(100)}`;
    const m = new FindInPage(single(long)).find('needle').matches[0]!;
    expect(m.context.startsWith('...')).toBe(true);
    expect(m.context.endsWith('...')).toBe(true);
    expect(m.context).toContain('needle');
    expect(new FindInPage(single('short needle text')).find('needle').matches[0]!.context).toBe('short needle text');
  });

  it('caps the number of matches', () => {
    const r = new FindInPage(single('a '.repeat(6000))).find('a');
    expect(r.total).toBe(5000);
    expect(r.truncated).toBe(true);
    expect(new FindInPage(single('a a')).find('a').truncated).toBeUndefined();
  });
});

describe('FindInPage — how runs become searchable text', () => {
  it('matches phrases that span the layout engine\'s per-word runs', () => {
    const f = new FindInPage(source([{ runs: [run('Hello', 0), run(' ', 22), run('World', 24.2)] }]));
    const r = f.find('hello world');
    expect(r.total).toBe(1);
    expect(r.matches[0]!.rects).toHaveLength(3);
  });

  it('joins words that wrapped onto a new line with a space', () => {
    const f = new FindInPage(source([{ runs: [run('fox', 0, 12.8), run('jumps', 0, 32)] }]));
    expect(f.find('fox jumps').total).toBe(1);
  });

  it('does not invent a space between touching words on the same line', () => {
    const f = new FindInPage(source([{ runs: [run('jumps', 0), run('over', 40)] }]));
    expect(f.find('jumpsover').total).toBe(1);
    expect(f.find('jumps over').total).toBe(0);
  });

  it('never matches across blocks', () => {
    const f = new FindInPage(source([{ runs: [run('end of one')] }, { runs: [run('start of two', 0, 40)] }]));
    expect(f.find('one start').total).toBe(0);
    expect(f.find('end of one').total).toBe(1);
    expect(f.find('start of two').total).toBe(1);
  });

  it('ignores empty blocks and empty runs', () => {
    const f = new FindInPage(source([{ runs: [] }, { runs: [run(''), run('word')] }, { runs: [] }]));
    expect(f.find('word').total).toBe(1);
  });

  it('reads the source afresh on every search', () => {
    let blocks: FindBlock[] = [{ runs: [run('first page')] }];
    const f = new FindInPage({ getBlocks: () => blocks });
    expect(f.find('first').total).toBe(1);
    blocks = [{ runs: [run('second page')] }];
    expect(f.find('first').total).toBe(0);
    expect(f.find('second').total).toBe(1);
  });

  it('finds nothing without a source', () => {
    expect(new FindInPage().find('anything').total).toBe(0);
  });
});

describe('FindInPage — highlight geometry', () => {
  it('maps a partial match to a proportional slice of the run', () => {
    const f = new FindInPage(source([{ runs: [run('abcdef', 100, 50, { fontSize: 10, width: 60 })] }]));
    const [rect] = f.find('cd').matches[0]!.rects;
    expect(rect!.x).toBeCloseTo(120, 10);
    expect(rect!.y).toBeCloseTo(42, 10);
    expect(rect!.width).toBeCloseTo(20, 10);
    expect(rect!.height).toBeCloseTo(12, 10);
  });

  it('estimates the width when the source does not know it', () => {
    const f = new FindInPage(source([{ runs: [run('abcd', 0, 10, { fontSize: 10 })] }]));
    const [rect] = f.find('abcd').matches[0]!.rects;
    expect(rect!.width).toBeCloseTo(4 * 10 * 0.55, 10);
  });

  it('returns one rectangle per run a match touches', () => {
    const f = new FindInPage(source([{ runs: [run('ab', 0, 10, { width: 20 }), run('cd', 20, 10, { width: 20 })] }]));
    const rects = f.find('bc').matches[0]!.rects;
    expect(rects).toHaveLength(2);
    expect(rects[0]).toMatchObject({ x: 10, width: 10 });
    expect(rects[1]).toMatchObject({ x: 20, width: 10 });
  });

  it('keeps geometry correct for many matches in one pass', () => {
    const runs = Array.from({ length: 200 }, (_, i) => run(i % 2 ? ' ' : 'word', i * 10, 20, { width: 10 }));
    const matches = new FindInPage(source([{ runs }])).find('word').matches;
    expect(matches).toHaveLength(100);
    expect(matches[0]!.rects[0]!.x).toBe(0);
    expect(matches[99]!.rects[0]!.x).toBe(1980);
  });

  it('computes scrollbar tick positions as page fractions', () => {
    // baselines 112.8 / 512.8 put the 16px line tops at exactly 100 / 500
    const f = new FindInPage(source([
      { runs: [run('hit', 0, 112.8)] },
      { runs: [run('miss', 0, 400)] },
      { runs: [run('hit', 0, 512.8)] },
    ]));
    f.find('hit');
    const ticks = f.getMatchTicks(1000);
    expect(ticks).toHaveLength(2);
    expect(ticks[0]).toBeCloseTo(0.1, 5);
    expect(ticks[1]).toBeCloseTo(0.5, 5);
    expect(f.getMatchTicks(0)).toEqual([]);
    expect(f.getMatchTicks(50)).toEqual([1, 1]); // clamped to the page
  });
});

describe('FindInPage — navigation and events', () => {
  const make = () => new FindInPage(single('one two one two one'));

  it('steps forward and backward with wrap-around', () => {
    const f = make();
    f.find('one');
    expect(f.getCurrentIndex()).toBe(0);
    expect(f.findNext()!.index).toBe(1);
    expect(f.findNext()!.index).toBe(2);
    expect(f.findNext()!.index).toBe(0);
    expect(f.findPrevious()!.index).toBe(2);
    expect(f.getActiveMatch()!.position).toBe(16);
    expect(f.getMatches()).toHaveLength(3);
  });

  it('returns null when there is nothing to step through', () => {
    const f = make();
    expect(f.findNext()).toBeNull();
    f.find('absent');
    expect(f.findPrevious()).toBeNull();
    expect(f.getCurrentIndex()).toBe(-1);
  });

  it('emits search, navigated and cleared events', () => {
    const f = make();
    const events: FindEvent[] = [];
    f.onEvent((e) => events.push(e));
    f.find('one');
    f.findNext();
    f.clear();
    expect(events.map((e) => e.kind)).toEqual(['search', 'navigated', 'cleared']);
    expect(events[0]!.result.total).toBe(3);
    expect(events[1]!.result.activeIndex).toBe(1);
    expect(events[2]!.result).toMatchObject({ total: 0, activeIndex: -1, query: '' });
  });

  it('emits cleared when an active search is replaced by an empty query', () => {
    const f = make();
    f.find('one');
    const handler = vi.fn();
    f.onEvent(handler);
    f.find('');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cleared' }));
    f.find('');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('supports unsubscribing and survives throwing handlers', () => {
    const f = make();
    const good = vi.fn();
    f.onEvent(() => { throw new Error('boom'); });
    const off = f.onEvent(good);
    f.find('one');
    expect(good).toHaveBeenCalledTimes(1);
    off();
    f.find('two');
    expect(good).toHaveBeenCalledTimes(1);
  });

  it('refresh() re-runs the query against changed text and keeps the active match where possible', () => {
    let text = 'one one one';
    const f = new FindInPage({ getBlocks: () => [{ runs: [run(text)] }] });
    f.find('one');
    f.findNext();
    f.findNext();
    expect(f.getCurrentIndex()).toBe(2);
    text = 'one one';
    const r = f.refresh();
    expect(r.total).toBe(2);
    expect(f.getCurrentIndex()).toBe(1); // clamped
    text = 'nothing';
    expect(f.refresh().total).toBe(0);
    expect(f.getCurrentIndex()).toBe(-1);
  });

  it('refresh() with no active query is a no-op result', () => {
    expect(make().refresh()).toMatchObject({ total: 0, query: '' });
  });

  it('keeps the previous options when refreshing', () => {
    let text = 'Word word';
    const f = new FindInPage({ getBlocks: () => [{ runs: [run(text)] }] });
    f.find('word', { caseSensitive: true });
    text = 'Word word word';
    expect(f.refresh().total).toBe(2);
  });

  it('dispose() clears state and listeners', () => {
    const f = make();
    const handler = vi.fn();
    f.onEvent(handler);
    f.find('one');
    handler.mockClear();
    f.dispose();
    expect(f.getMatchCount()).toBe(0);
    f.find('one');
    expect(handler).not.toHaveBeenCalled();
  });
});
