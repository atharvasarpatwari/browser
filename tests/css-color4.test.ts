/**
 * CSS Color 4 colours (RC-8 of doc/2026-10-21-nova-android-1.26-end-user-test-results.md): oklch()
 * and friends used to parse as black, so iana.org's footer drew black text on black.
 */
import { describe, expect, it } from 'vitest';
import { parseColor, isParsableColor } from '../src/browser/rendering/rasterizer';

const near = (actual: { r: number; g: number; b: number; a: number }, r: number, g: number, b: number, a = 1) => {
  expect(Math.abs(actual.r - r)).toBeLessThanOrEqual(2);
  expect(Math.abs(actual.g - g)).toBeLessThanOrEqual(2);
  expect(Math.abs(actual.b - b)).toBeLessThanOrEqual(2);
  expect(actual.a).toBeCloseTo(a, 2);
};

describe('CSS Color 4', () => {
  it('oklch / oklab', () => {
    near(parseColor('oklch(62.8% 0.2577 29.23)'), 255, 0, 0);       // sRGB red
    near(parseColor('oklch(0.866 0.295 142.5)'), 0, 255, 0);        // sRGB lime
    near(parseColor('oklch(1 0 0)'), 255, 255, 255);
    near(parseColor('oklch(0 0 0 / 50%)'), 0, 0, 0, 0.5);
    near(parseColor('oklab(0.452 -0.032 -0.312)'), 0, 0, 255);      // sRGB blue
    const iana = parseColor('oklch(0.685 0.01 286)');                // iana.org footer text: a light grey
    expect(iana.r).toBeGreaterThan(140);
    expect(Math.abs(iana.r - iana.b)).toBeLessThan(20);
  });

  it('lab / lch / hwb / color(srgb)', () => {
    near(parseColor('lab(54.29 80.82 69.89)'), 255, 0, 0);
    near(parseColor('lch(54.29 106.84 40.85)'), 255, 0, 0);
    near(parseColor('lab(100 0 0)'), 255, 255, 255);
    near(parseColor('hwb(120 0% 0%)'), 0, 255, 0);
    near(parseColor('hwb(0 100% 0%)'), 255, 255, 255);
    near(parseColor('color(srgb 1 0.5 0)'), 255, 128, 0);
    near(parseColor('color(srgb 0 0 1 / 0.25)'), 0, 0, 255, 0.25);
  });

  it('is reported parsable; nonsense still is not', () => {
    expect(isParsableColor('oklch(0.685 0.01 286)')).toBe(true);
    expect(isParsableColor('lab(50 0 0)')).toBe(true);
    expect(isParsableColor('oklch(banana)')).toBe(false);
  });
});
