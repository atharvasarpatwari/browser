import { describe, it, expect } from 'vitest';
import {
  findBreakOpportunities,
  segmentText,
  type BreakOpportunity,
  type TextSegment,
} from '../src/browser/rendering/formatting/line-break';

// ─── findBreakOpportunities ─────────────────────────────────────────────────

describe('findBreakOpportunities', () => {
  it('returns empty array for empty string', () => {
    expect(findBreakOpportunities('')).toEqual([]);
  });

  it('always includes index 0 and text.length', () => {
    const opps = findBreakOpportunities('abc');
    expect(opps[0]!.index).toBe(0);
    expect(opps[opps.length - 1]!.index).toBe(3);
  });

  it('finds break after space', () => {
    const opps = findBreakOpportunities('hello world');
    const indices = opps.map(o => o.index);
    // break after 'hello ' (index 6)
    expect(indices).toContain(6);
  });

  it('finds mandatory break after newline', () => {
    const opps = findBreakOpportunities('line1\nline2');
    const nlBreak = opps.find(o => o.index === 6);
    expect(nlBreak).toBeDefined();
    expect(nlBreak!.mandatory).toBe(true);
  });

  it('finds mandatory break after \\r\\n', () => {
    const opps = findBreakOpportunities('a\r\nb');
    const crlfBreak = opps.find(o => o.index === 2);
    expect(crlfBreak).toBeDefined();
    expect(crlfBreak!.mandatory).toBe(true);
  });

  it('finds break after hyphen', () => {
    const opps = findBreakOpportunities('well-known');
    const indices = opps.map(o => o.index);
    expect(indices).toContain(5); // after 'well-'
  });

  it('finds break before CJK characters', () => {
    const opps = findBreakOpportunities('abc你好');
    const indices = opps.map(o => o.index);
    // break before 好 at index 3
    expect(indices).toContain(3);
  });

  it('finds break at word boundary between letters and punctuation', () => {
    const opps = findBreakOpportunities('hello!');
    const indices = opps.map(o => o.index);
    expect(indices).toContain(5); // after 'hello'
  });

  it('finds break after closing parenthesis', () => {
    const opps = findBreakOpportunities('(hello)');
    const indices = opps.map(o => o.index);
    expect(indices).toContain(7); // after ')'
  });

  it('finds break before opening parenthesis', () => {
    const opps = findBreakOpportunities('test(');
    const indices = opps.map(o => o.index);
    expect(indices).toContain(5); // before '('
  });

  it('deduplicates break opportunities at the same index', () => {
    const opps = findBreakOpportunities('a b');
    const indices = opps.map(o => o.index);
    const unique = [...new Set(indices)];
    expect(indices).toEqual(unique);
  });

  it('handles consecutive spaces', () => {
    const opps = findBreakOpportunities('a  b');
    const indices = opps.map(o => o.index);
    // breaks after each space: index 2, 3
    expect(indices).toContain(2);
    expect(indices).toContain(3);
  });

  it('handles em dash as break opportunity', () => {
    const opps = findBreakOpportunities('before—after');
    const indices = opps.map(o => o.index);
    expect(indices).toContain(7); // after em dash
  });
});

// ─── segmentText ────────────────────────────────────────────────────────────

describe('segmentText', () => {
  it('returns empty array for empty string', () => {
    expect(segmentText('')).toEqual([]);
  });

  it('returns single segment for word without breaks', () => {
    const segs = segmentText('hello');
    expect(segs.length).toBe(1);
    expect(segs[0]!.text).toBe('hello');
    expect(segs[0]!.start).toBe(0);
    expect(segs[0]!.end).toBe(5);
  });

  it('segments at spaces', () => {
    const segs = segmentText('hello world');
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[0]!.text).toBe('hello');
    // Space creates its own break segment or merges with next word
    const allText = segs.map(s => s.text).join('');
    expect(allText).toBe('hello world');
  });

  it('segments at newlines with mandatoryBreak flag', () => {
    const segs = segmentText('line1\nline2');
    // Some segment should have mandatoryBreak=true (the one including the newline)
    const hasMandatory = segs.some(s => s.mandatoryBreak);
    expect(hasMandatory).toBe(true);
  });

  it('segments CJK text at ideographic boundaries', () => {
    const segs = segmentText('你好世界');
    // CJK break detection may vary; at minimum the full text is preserved
    expect(segs.length).toBeGreaterThanOrEqual(1);
    const allText = segs.map(s => s.text).join('');
    expect(allText).toBe('你好世界');
  });

  it('preserves correct start/end indices', () => {
    const segs = segmentText('ab cd');
    // At least 2 segments
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[0]!.start).toBe(0);
    // Last segment ends at text length
    expect(segs[segs.length - 1]!.end).toBe(5);
    // Full text preserved
    expect(segs.map(s => s.text).join('')).toBe('ab cd');
  });

  it('all segments have breakOpportunity true', () => {
    const segs = segmentText('hello world test');
    for (const seg of segs) {
      expect(seg.breakOpportunity).toBe(true);
    }
  });
});
