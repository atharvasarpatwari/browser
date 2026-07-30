import { describe, it, expect } from 'vitest';
import { buildUsedStyle } from '../src/browser/rendering/css5/used-style';

describe('buildUsedStyle', () => {
  it('should resolve display and position defaults', () => {
    const u = buildUsedStyle(new Map(), 1000, 800, 16);
    expect(u.display).toBe('inline');
    expect(u.position).toBe('static');
  });

  it('should resolve explicit display and position', () => {
    const u = buildUsedStyle(new Map([
      ['display', 'block'],
      ['position', 'absolute'],
    ]), 1000, 800, 16);
    expect(u.display).toBe('block');
    expect(u.position).toBe('absolute');
  });

  it('should resolve px values', () => {
    const u = buildUsedStyle(new Map([
      ['margin-top', '10px'],
      ['margin-right', '20px'],
    ]), 1000, 800, 16);
    expect(u.marginTop).toBe(10);
    expect(u.marginRight).toBe(20);
  });

  it('should resolve unitless numbers as px', () => {
    const u = buildUsedStyle(new Map([
      ['margin-bottom', '5'],
    ]), 1000, 800, 16);
    expect(u.marginBottom).toBe(5);
  });

  it('should return 0 for auto margins', () => {
    const u = buildUsedStyle(new Map([
      ['margin-left', 'auto'],
    ]), 1000, 800, 16);
    expect(u.marginLeft).toBe(0);
  });

  it('should resolve percentage margins relative to container width', () => {
    const u = buildUsedStyle(new Map([
      ['margin-top', '10%'],
    ]), 1000, 800, 16);
    expect(u.marginTop).toBe(100);
  });

  it('should resolve em values', () => {
    const u = buildUsedStyle(new Map([
      ['font-size', '20px'],
      ['padding-left', '2em'],
    ]), 1000, 800, 16);
    expect(u.paddingLeft).toBe(40);
  });

  it('should resolve rem values', () => {
    const u = buildUsedStyle(new Map([
      ['padding-right', '3rem'],
    ]), 1000, 800, 16);
    expect(u.paddingRight).toBe(48);
  });

  it('should resolve vw and vh', () => {
    const u = buildUsedStyle(new Map([
      ['padding-top', '5vw'],
      ['padding-bottom', '10vh'],
    ]), 1000, 800, 16);
    expect(u.paddingTop).toBe(50);
    expect(u.paddingBottom).toBe(80);
  });

  it('should resolve pt values', () => {
    const u = buildUsedStyle(new Map([
      ['margin-top', '12pt'],
    ]), 1000, 800, 16);
    expect(u.marginTop).toBeCloseTo(16, 1);
  });

  it('should resolve border-width keywords', () => {
    const u = buildUsedStyle(new Map([
      ['border-top-style', 'solid'],
      ['border-top-width', 'thin'],
      ['border-right-style', 'solid'],
      ['border-right-width', 'medium'],
      ['border-bottom-style', 'solid'],
      ['border-bottom-width', 'thick'],
    ]), 1000, 800, 16);
    expect(u.borderTopWidth).toBe(1);
    expect(u.borderRightWidth).toBe(3);
    expect(u.borderBottomWidth).toBe(5);
  });

  it('should return 0 for border-width when border-style is none', () => {
    const u = buildUsedStyle(new Map([
      ['border-top-style', 'none'],
      ['border-top-width', '10px'],
      ['border-left-style', 'hidden'],
      ['border-left-width', '10px'],
    ]), 1000, 800, 16);
    expect(u.borderTopWidth).toBe(0);
    expect(u.borderLeftWidth).toBe(0);
  });

  it('should use default border-style of none when not set', () => {
    const u = buildUsedStyle(new Map(), 1000, 800, 16);
    expect(u.borderTopWidth).toBe(0);
    expect(u.borderRightWidth).toBe(0);
    expect(u.borderBottomWidth).toBe(0);
    expect(u.borderLeftWidth).toBe(0);
  });

  it('should return null for auto width', () => {
    const u = buildUsedStyle(new Map([
      ['width', 'auto'],
    ]), 1000, 800, 16);
    expect(u.width).toBeNull();
  });

  it('should resolve explicit width', () => {
    const u = buildUsedStyle(new Map([
      ['width', '200px'],
    ]), 1000, 800, 16);
    expect(u.width).toBe(200);
  });

  it('should resolve height', () => {
    const u = buildUsedStyle(new Map([
      ['height', '100px'],
    ]), 1000, 800, 16);
    expect(u.height).toBe(100);
  });

  it('should resolve box-shadow as string', () => {
    const u = buildUsedStyle(new Map([
      ['box-shadow', '0 0 5px rgba(0,0,0,0.5)'],
    ]), 1000, 800, 16);
    expect(u.boxShadow).toBe('0 0 5px rgba(0,0,0,0.5)');
  });

  it('should resolve font-size keyword defaults to 16', () => {
    const u = buildUsedStyle(new Map(), 1000, 800, 16);
    expect(u.fontSize).toBe(16);
  });

  it('should resolve font-size from px', () => {
    const u = buildUsedStyle(new Map([
      ['font-size', '18px'],
    ]), 1000, 800, 16);
    expect(u.fontSize).toBe(18);
  });

  it('should resolve line-height normal', () => {
    const u = buildUsedStyle(new Map(), 1000, 800, 16);
    expect(u.lineHeight).toBe('normal');
  });

  it('should resolve line-height percentage', () => {
    const u = buildUsedStyle(new Map([
      ['line-height', '150%'],
      ['font-size', '20px'],
    ]), 1000, 800, 16);
    expect(u.lineHeight).toBe(30);
  });

  it('should resolve line-height number multiplier', () => {
    const u = buildUsedStyle(new Map([
      ['line-height', '1.5'],
      ['font-size', '20px'],
    ]), 1000, 800, 16);
    expect(u.lineHeight).toBe(30);
  });

  it('should resolve font-weight keywords', () => {
    const u1 = buildUsedStyle(new Map([['font-weight', 'bold']]), 1000, 800, 16);
    expect(u1.fontWeight).toBe(700);

    const u2 = buildUsedStyle(new Map([['font-weight', 'normal']]), 1000, 800, 16);
    expect(u2.fontWeight).toBe(400);

    const u3 = buildUsedStyle(new Map([['font-weight', 'lighter']]), 1000, 800, 16);
    expect(u3.fontWeight).toBe(300);
  });

  it('should resolve font-weight numeric', () => {
    const u = buildUsedStyle(new Map([['font-weight', '600']]), 1000, 800, 16);
    expect(u.fontWeight).toBe(600);
  });

  it('should resolve box-sizing', () => {
    const u = buildUsedStyle(new Map([['box-sizing', 'border-box']]), 1000, 800, 16);
    expect(u.boxSizing).toBe('border-box');
  });

  it('should resolve z-index', () => {
    const u1 = buildUsedStyle(new Map([['z-index', '10']]), 1000, 800, 16);
    expect(u1.zIndex).toBe(10);

    const u2 = buildUsedStyle(new Map(), 1000, 800, 16);
    expect(u2.zIndex).toBe('auto');

    const u3 = buildUsedStyle(new Map([['z-index', 'auto']]), 1000, 800, 16);
    expect(u3.zIndex).toBe('auto');
  });

  it('should resolve opacity', () => {
    const u = buildUsedStyle(new Map([['opacity', '0.5']]), 1000, 800, 16);
    expect(u.opacity).toBe(0.5);
  });

  it('should resolve visibility', () => {
    const u = buildUsedStyle(new Map([['visibility', 'hidden']]), 1000, 800, 16);
    expect(u.visibility).toBe('hidden');
  });

  it('should resolve max-width/max-height none to null', () => {
    const u = buildUsedStyle(new Map(), 1000, 800, 16);
    expect(u.maxWidth).toBeNull();
    expect(u.maxHeight).toBeNull();
  });

  it('should resolve max-width in px', () => {
    const u = buildUsedStyle(new Map([['max-width', '800px']]), 1000, 800, 16);
    expect(u.maxWidth).toBe(800);
  });

  it('should resolve min-width/min-height defaults to 0', () => {
    const u = buildUsedStyle(new Map(), 1000, 800, 16);
    expect(u.minWidth).toBe(0);
    expect(u.minHeight).toBe(0);
  });
});
