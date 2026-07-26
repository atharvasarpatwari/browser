import { describe, it, expect } from 'vitest';
import {
  hasMathFunctions,
  evaluateMathExpression,
  resolveMathFunctions,
} from '../src/browser/rendering/css5/math-functions.js';

describe('CSS Math Functions', () => {
  // ─────────────────────────────────────────────────────────────────────────
  // hasMathFunctions()
  // ─────────────────────────────────────────────────────────────────────────

  describe('hasMathFunctions()', () => {
    it('detects calc()', () => {
      expect(hasMathFunctions('calc(10px + 5px)')).toBe(true);
      expect(hasMathFunctions('width: calc(100% - 20px)')).toBe(true);
    });

    it('detects min()', () => {
      expect(hasMathFunctions('min(100px, 50%)')).toBe(true);
    });

    it('detects max()', () => {
      expect(hasMathFunctions('max(100px, 50%)')).toBe(true);
    });

    it('detects clamp()', () => {
      expect(hasMathFunctions('clamp(10px, 50%, 100px)')).toBe(true);
    });

    it('returns false for plain values', () => {
      expect(hasMathFunctions('10px')).toBe(false);
      expect(hasMathFunctions('red')).toBe(false);
      expect(hasMathFunctions('#fff')).toBe(false);
      expect(hasMathFunctions('auto')).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // evaluateMathExpression()
  // ─────────────────────────────────────────────────────────────────────────

  describe('evaluateMathExpression()', () => {
    it('evaluates simple addition', () => {
      expect(evaluateMathExpression('10px + 5px')).toBe('15px');
    });

    it('evaluates simple subtraction', () => {
      expect(evaluateMathExpression('20px - 5px')).toBe('15px');
    });

    it('evaluates multiplication', () => {
      expect(evaluateMathExpression('10px * 3')).toBe('30px');
    });

    it('evaluates division', () => {
      expect(evaluateMathExpression('30px / 3')).toBe('10px');
    });

    it('evaluates complex expression with precedence', () => {
      expect(evaluateMathExpression('10px + 5px * 2')).toBe('20px');
    });

    it('evaluates parenthesized expression', () => {
      expect(evaluateMathExpression('(10px + 5px) * 2')).toBe('30px');
    });

    it('evaluates nested parentheses', () => {
      expect(evaluateMathExpression('((10px + 5px) * 2) + 10px')).toBe('40px');
    });

    it('evaluates min() with same units', () => {
      expect(evaluateMathExpression('min(100px, 50px)')).toBe('50px');
    });

    it('evaluates max() with same units', () => {
      expect(evaluateMathExpression('max(100px, 50px)')).toBe('100px');
    });

    it('evaluates clamp() with same units', () => {
      expect(evaluateMathExpression('clamp(10px, 50px, 100px)')).toBe('50px');
    });

    it('evaluates clamp() clamping to min', () => {
      expect(evaluateMathExpression('clamp(10px, 5px, 100px)')).toBe('10px');
    });

    it('evaluates clamp() clamping to max', () => {
      expect(evaluateMathExpression('clamp(10px, 200px, 100px)')).toBe('100px');
    });

    it('evaluates em units with context', () => {
      expect(
        evaluateMathExpression('2em * 2', { fontSize: 16 })
      ).toBe('4em');
    });

    it('evaluates min() with mixed units via context', () => {
      expect(
        evaluateMathExpression('min(100px, 10em)', { fontSize: 16 })
      ).toBe('100px');
    });

    it('evaluates negative numbers', () => {
      expect(evaluateMathExpression('10px + -5px')).toBe('5px');
    });

    it('evaluates percentage', () => {
      expect(evaluateMathExpression('50% + 25%')).toBe('75%');
    });

    it('returns null for division by zero', () => {
      expect(evaluateMathExpression('10px / 0')).toBeNull();
    });

    it('returns null for mixed incompatible units in addition', () => {
      // calc(100% - 20px) can't be evaluated without knowing the percentage reference
      expect(evaluateMathExpression('100% - 20px')).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // resolveMathFunctions()
  // ─────────────────────────────────────────────────────────────────────────

  describe('resolveMathFunctions()', () => {
    it('resolves calc() in a value string', () => {
      expect(resolveMathFunctions('calc(10px + 5px)')).toBe('15px');
    });

    it('resolves calc() with nested parentheses', () => {
      expect(resolveMathFunctions('calc((10px + 5px) * 2)')).toBe('30px');
    });

    it('resolves min() in a value string', () => {
      expect(resolveMathFunctions('min(100px, 50px)')).toBe('50px');
    });

    it('resolves max() in a value string', () => {
      expect(resolveMathFunctions('max(100px, 50px)')).toBe('100px');
    });

    it('resolves clamp() in a value string', () => {
      expect(resolveMathFunctions('clamp(10px, 50px, 100px)')).toBe('50px');
    });

    it('leaves mixed-unit expressions as-is', () => {
      expect(resolveMathFunctions('calc(100% - 20px)')).toBe('calc(100% - 20px)');
    });

    it('leaves plain values unchanged', () => {
      expect(resolveMathFunctions('10px')).toBe('10px');
      expect(resolveMathFunctions('red')).toBe('red');
      expect(resolveMathFunctions('auto')).toBe('auto');
    });

    it('resolves calc() with em units using context', () => {
      expect(
        resolveMathFunctions('calc(1em + 8px)', { fontSize: 16 })
      ).toBe('24px');
    });

    it('resolves min() with three arguments', () => {
      expect(resolveMathFunctions('min(100px, 50px, 75px)')).toBe('50px');
    });

    it('resolves max() with three arguments', () => {
      expect(resolveMathFunctions('max(100px, 50px, 75px)')).toBe('100px');
    });

    it('resolves nested calc in min()', () => {
      expect(resolveMathFunctions('min(calc(10px + 5px), 20px)')).toBe('15px');
    });

    it('resolves nested calc in max()', () => {
      expect(resolveMathFunctions('max(calc(10px + 5px), 20px)')).toBe('20px');
    });

    it('resolves multiple math functions in one value', () => {
      expect(resolveMathFunctions('calc(10px + 5px) calc(20px - 5px)')).toBe('15px 15px');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Integration with resolveComputedValue()
  // ─────────────────────────────────────────────────────────────────────────

  describe('Integration', () => {
    it('calc() values are resolved during computed value resolution', async () => {
      const { resolveComputedValue } = await import('../src/browser/rendering/css5/computed-value-resolver.js');
      expect(resolveComputedValue('width', 'calc(100px + 50px)')).toBe('150px');
    });

    it('calc() with multiplication', async () => {
      const { resolveComputedValue } = await import('../src/browser/rendering/css5/computed-value-resolver.js');
      expect(resolveComputedValue('margin', 'calc(10px * 3)')).toBe('30px');
    });

    it('calc() mixed units pass through for layout', async () => {
      const { resolveComputedValue } = await import('../src/browser/rendering/css5/computed-value-resolver.js');
      expect(resolveComputedValue('width', 'calc(100% - 20px)')).toBe('calc(100% - 20px)');
    });

    it('min() resolves during computed value resolution', async () => {
      const { resolveComputedValue } = await import('../src/browser/rendering/css5/computed-value-resolver.js');
      expect(resolveComputedValue('width', 'min(100px, 50px)')).toBe('50px');
    });

    it('max() resolves during computed value resolution', async () => {
      const { resolveComputedValue } = await import('../src/browser/rendering/css5/computed-value-resolver.js');
      expect(resolveComputedValue('width', 'max(100px, 50px)')).toBe('100px');
    });

    it('clamp() resolves during computed value resolution', async () => {
      const { resolveComputedValue } = await import('../src/browser/rendering/css5/computed-value-resolver.js');
      expect(resolveComputedValue('width', 'clamp(10px, 50px, 100px)')).toBe('50px');
    });
  });
});
