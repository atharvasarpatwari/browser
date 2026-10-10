import { describe, it, expect } from 'vitest';
import {
  detectInstantAnswer, evaluateExpression, convertUnits, parseColor, formatNumber, InstantAnswerProvider,
} from '../src/browser/omnibox/instant-answers';

describe('evaluateExpression', () => {
  it.each<[string, number]>([
    ['2+2', 4],
    ['2 + 3 * 4', 14],
    ['(2+3)*4', 20],
    ['2^3^2', 512],
    ['-2^2', -4],
    ['2^-1', 0.5],
    ['10 % 3', 1],
    ['sqrt(144)+12*4', 60],
    ['2*pi', 2 * Math.PI],
    ['sin(0)', 0],
    ['cos(0)+1', 2],
    ['abs(-5)+1', 6],
    ['log(1000)', 3],
    ['ln(e)+1', 2],
    ['floor(2.7)+ceil(2.1)', 5],
    ['2**10', 1024],
    ['6 ÷ 3', 2],
    ['3 × 4', 12],
    ['1e3+1', 1001],
    ['.5+.5', 1],
    ['0.1+0.2', 0.3],
  ])('%s = %d', (expr, expected) => {
    expect(evaluateExpression(expr)).toBeCloseTo(expected, 10);
  });

  it.each([
    '', '   ', 'abc', '2+', '(2+3', '2+3)', '*2', '2 3', '1/0', '0/0', 'sqrt(-1)',
    '42', '-5', 'pi', 'e', '2e',
    '2024-01-15', '1/2/2024', '31.12.2024',
  ])('rejects %j (invalid, non-finite, trivial or date-like)', (expr) => {
    expect(evaluateExpression(expr)).toBeNull();
  });

  it.each([
    'constructor(1)', 'process.exit()', 'alert(1)', '__proto__', 'toString(2)', 'Math.sqrt(4)',
    'eval("1+1")', 'import("x")', '2+2; 3', '"a"+"b"',
  ])('never executes or resolves %j', (expr) => {
    expect(evaluateExpression(expr)).toBeNull();
  });

  it('bounds input length and nesting depth', () => {
    expect(evaluateExpression('1+'.repeat(150) + '1')).toBeNull();
    expect(evaluateExpression('('.repeat(100) + '1+1' + ')'.repeat(100))).toBeNull();
    expect(evaluateExpression('('.repeat(20) + '1+1' + ')'.repeat(20))).toBe(2);
  });
});

describe('formatNumber', () => {
  it('hides float noise and negative zero', () => {
    expect(formatNumber(0.1 + 0.2)).toBe('0.3');
    expect(formatNumber(-0)).toBe('0');
    expect(formatNumber(1 / 3)).toBe('0.333333333333');
    expect(formatNumber(1e21)).toBe('1e+21');
  });
});

describe('convertUnits', () => {
  it('converts temperatures through kelvin', () => {
    expect(convertUnits('72 F to C')!.result).toBeCloseTo(22.2222, 3);
    expect(convertUnits('100 c to f')!.result).toBeCloseTo(212, 10);
    expect(convertUnits('0 k to c')!.result).toBeCloseTo(-273.15, 10);
    expect(convertUnits('-40 f in c')!.result).toBeCloseTo(-40, 10);
  });

  it('converts linear units within a category', () => {
    expect(convertUnits('5 km to mi')!.result).toBeCloseTo(3.10686, 4);
    expect(convertUnits('1,000 m to km')!.result).toBeCloseTo(1, 10);
    expect(convertUnits('10 cm in in')!.result).toBeCloseTo(3.93701, 4);
    expect(convertUnits('5 in to cm')!.result).toBeCloseTo(12.7, 10);
    expect(convertUnits('1 gb to mb')!.result).toBeCloseTo(1000, 10);
    expect(convertUnits('1 gib to mib')!.result).toBeCloseTo(1024, 10);
    expect(convertUnits('60 mph to km/h')!.result).toBeCloseTo(96.56064, 4);
    expect(convertUnits('2 hours to min')!.result).toBeCloseTo(120, 10);
    expect(convertUnits('1 lb to oz')!.result).toBeCloseTo(16, 4);
    expect(convertUnits('1 gallon to cups')!.result).toBeCloseTo(16, 3);
  });

  it('labels the units canonically', () => {
    const r = convertUnits('72 f to c')!;
    expect(r.from).toBe('°F');
    expect(r.to).toBe('°C');
  });

  it('rejects mismatched, unknown, and currency conversions', () => {
    expect(convertUnits('5 kg to km')).toBeNull();
    expect(convertUnits('5 foo to bar')).toBeNull();
    expect(convertUnits('100 usd in eur')).toBeNull();
    expect(convertUnits('how many km to mi')).toBeNull();
  });
});

describe('parseColor', () => {
  it('parses hex, rgb() and hsl()', () => {
    expect(parseColor('#ff5500')).toEqual({ r: 255, g: 85, b: 0 });
    expect(parseColor('#FFF')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3 });
    expect(parseColor('hsl(120, 100%, 50%)')).toEqual({ r: 0, g: 255, b: 0 });
  });

  it('rejects out-of-range and malformed colors', () => {
    expect(parseColor('#ggg')).toBeNull();
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('rgb(300, 0, 0)')).toBeNull();
    expect(parseColor('hsl(400, 10%, 10%)')).toBeNull();
    expect(parseColor('red')).toBeNull();
  });
});

describe('detectInstantAnswer', () => {
  it('detects math', () => {
    expect(detectInstantAnswer('sqrt(144) + 12 * 4')).toEqual({
      kind: 'math', value: '60', detail: 'sqrt(144) + 12 * 4 = 60',
    });
  });

  it('detects unit conversions', () => {
    const a = detectInstantAnswer('72 F to C')!;
    expect(a.kind).toBe('unit');
    expect(a.value).toBe('22.2222222222 °C');
    expect(a.detail).toBe('72 °F = 22.2222222222 °C');
  });

  it('detects colors with a swatch', () => {
    expect(detectInstantAnswer('#ff5500')).toEqual({
      kind: 'color', value: '#ff5500', detail: 'rgb(255, 85, 0) · hsl(20, 100%, 50%)', swatch: '#ff5500',
    });
    expect(detectInstantAnswer('#fff')!.detail).toBe('rgb(255, 255, 255) · hsl(0, 0%, 100%)');
    expect(detectInstantAnswer('rgb(255, 0, 0)')!.value).toBe('#ff0000');
  });

  it.each(['', 'hello world', 'iphone 15 pro max', 'react 18 docs', '42', 'github.com', 'pi'])(
    'leaves ordinary query %j alone',
    (q) => { expect(detectInstantAnswer(q)).toBeNull(); },
  );
});

describe('InstantAnswerProvider', () => {
  const provider = new InstantAnswerProvider();

  it('returns a single copyable answer row on top', () => {
    const [r, ...rest] = provider.getSuggestions('2+2');
    expect(rest).toHaveLength(0);
    expect(r).toMatchObject({
      type: 'answer', id: 'answer:math', text: '4', description: '2+2 = 4',
      hint: 'Copy', action: 'copy', score: 100, source: 'instant-answers',
    });
  });

  it('carries the swatch for colors', () => {
    expect(provider.getSuggestions('#ff5500')[0]!.meta).toEqual({ swatch: '#ff5500' });
  });

  it('returns nothing for ordinary queries', () => {
    expect(provider.getSuggestions('how to bake bread')).toEqual([]);
  });
});
