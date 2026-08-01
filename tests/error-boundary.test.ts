import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ErrorBoundary, ChainedErrorBoundary, DEFAULT_BOUNDARY_CONFIG } from '../src/browser/engine/error-boundary';

describe('ErrorBoundary', () => {
  let boundary: ErrorBoundary;

  beforeEach(() => {
    vi.restoreAllMocks();
    boundary = new ErrorBoundary({ name: 'test', logErrors: false });
  });

  // ── exec (sync) ─────────────────────────────────────────────────────────────

  describe('exec', () => {
    it('should return success with value', () => {
      const result = boundary.exec(() => 42);
      expect(result.success).toBe(true);
      expect(result.value).toBe(42);
      expect(result.attempts).toBe(1);
    });

    it('should return failure with error', () => {
      const result = boundary.exec(() => { throw new Error('boom'); });
      expect(result.success).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toBe('boom');
      expect(result.attempts).toBe(1);
    });

    it('should record error in history', () => {
      boundary.exec(() => { throw new Error('test'); });
      expect(boundary.getErrorCount()).toBe(1);
      expect(boundary.hasErrors()).toBe(true);
    });

    it('should pass context string', () => {
      boundary.exec(() => { throw new Error('test'); }, 'rendering');
      const history = boundary.getErrorHistory();
      expect(history[0]!.context).toBe('rendering');
    });

    it('should handle non-Error thrown values', () => {
      const result = boundary.exec(() => { throw 'string-error'; });
      expect(result.success).toBe(false);
      expect(result.error!.message).toBe('string-error');
    });

    it('should return duration > 0', () => {
      const result = boundary.exec(() => 42);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── exec with retry ─────────────────────────────────────────────────────────

  describe('exec with retry strategy', () => {
    it('should retry and succeed on second attempt', () => {
      const retryBoundary = new ErrorBoundary({
        name: 'retry-test',
        strategy: 'retry',
        maxRetries: 2,
        retryBaseMs: 1,
        logErrors: false,
      });

      let attempt = 0;
      const result = retryBoundary.exec(() => {
        attempt++;
        if (attempt === 1) throw new Error('first fail');
        return 'success';
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe('success');
      expect(result.attempts).toBe(2);
    });

    it('should exhaust all retries and fail', () => {
      const retryBoundary = new ErrorBoundary({
        name: 'retry-exhaust',
        strategy: 'retry',
        maxRetries: 2,
        retryBaseMs: 1,
        logErrors: false,
      });

      const result = retryBoundary.exec(() => { throw new Error('always fail'); });
      expect(result.success).toBe(false);
      expect(result.attempts).toBe(3); // 1 original + 2 retries
    });
  });

  // ── execAsync ───────────────────────────────────────────────────────────────

  describe('execAsync', () => {
    it('should return success with async value', async () => {
      const result = await boundary.execAsync(async () => 42);
      expect(result.success).toBe(true);
      expect(result.value).toBe(42);
    });

    it('should return failure for async error', async () => {
      const result = await boundary.execAsync(async () => { throw new Error('async boom'); });
      expect(result.success).toBe(false);
      expect(result.error!.message).toBe('async boom');
    });

    it('should retry async operations', async () => {
      const retryBoundary = new ErrorBoundary({
        name: 'async-retry',
        strategy: 'retry',
        maxRetries: 2,
        retryBaseMs: 1,
        logErrors: false,
      });

      let attempt = 0;
      const result = await retryBoundary.execAsync(async () => {
        attempt++;
        if (attempt === 1) throw new Error('first fail');
        return 'async success';
      });

      expect(result.success).toBe(true);
      expect(result.value).toBe('async success');
    });

    it('should timeout async operations', async () => {
      const timeoutBoundary = new ErrorBoundary({
        name: 'timeout-test',
        strategy: 'fail-fast',
        attemptTimeoutMs: 50,
        logErrors: false,
      });

      const result = await timeoutBoundary.execAsync(async () => {
        await new Promise(r => setTimeout(r, 200));
        return 'should not reach';
      });

      expect(result.success).toBe(false);
    });
  });

  // ── Strategies ──────────────────────────────────────────────────────────────

  describe('strategies', () => {
    it('fail-fast should not retry', () => {
      const ff = new ErrorBoundary({ strategy: 'fail-fast', logErrors: false });
      let count = 0;
      ff.exec(() => { count++; throw new Error('fail'); });
      expect(count).toBe(1);
    });

    it('swallow should return failure but not throw', () => {
      const sw = new ErrorBoundary({ strategy: 'swallow', logErrors: false });
      const result = sw.exec(() => { throw new Error('swallowed'); });
      expect(result.success).toBe(false);
    });
  });

  // ── Error history ───────────────────────────────────────────────────────────

  describe('error history', () => {
    it('should track error count', () => {
      boundary.exec(() => { throw new Error('e1'); });
      boundary.exec(() => { throw new Error('e2'); });
      expect(boundary.getErrorCount()).toBe(2);
    });

    it('should clear history', () => {
      boundary.exec(() => { throw new Error('e1'); });
      boundary.clearHistory();
      expect(boundary.getErrorCount()).toBe(0);
      expect(boundary.hasErrors()).toBe(false);
    });

    it('should bound history to 100 entries', () => {
      const b = new ErrorBoundary({ logErrors: false });
      for (let i = 0; i < 150; i++) {
        b.exec(() => { throw new Error(`e${i}`); });
      }
      expect(b.getErrorHistory().length).toBeLessThanOrEqual(100);
      expect(b.getErrorCount()).toBe(150);
    });
  });

  // ── Config ──────────────────────────────────────────────────────────────────

  describe('config', () => {
    it('should use default config', () => {
      const b = new ErrorBoundary();
      const config = b.getConfig();
      expect(config.name).toBe(DEFAULT_BOUNDARY_CONFIG.name);
      expect(config.strategy).toBe('fail-fast');
      expect(config.maxRetries).toBe(3);
    });

    it('should override config', () => {
      const b = new ErrorBoundary({ name: 'custom', maxRetries: 5 });
      expect(b.getConfig().name).toBe('custom');
      expect(b.getConfig().maxRetries).toBe(5);
    });

    it('getConfig should return copy', () => {
      const config = boundary.getConfig() as { name: string };
      config.name = 'mutated';
      expect(boundary.getConfig().name).toBe('test');
    });
  });

  // ── Dispose ─────────────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('should clear all state', () => {
      boundary.exec(() => { throw new Error('e1'); });
      boundary.dispose();
      expect(boundary.getErrorCount()).toBe(0);
      expect(boundary.getErrorHistory()).toHaveLength(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHAINED ERROR BOUNDARY
// ─────────────────────────────────────────────────────────────────────────────

describe('ChainedErrorBoundary', () => {
  it('should succeed on first boundary', () => {
    const b1 = new ErrorBoundary({ name: 'b1', strategy: 'fail-fast', logErrors: false });
    const b2 = new ErrorBoundary({ name: 'b2', strategy: 'fail-fast', logErrors: false });
    const chain = new ChainedErrorBoundary([b1, b2]);
    const result = chain.exec(() => 42);
    expect(result.success).toBe(true);
    expect(result.value).toBe(42);
  });

  it('should fall through to second boundary on failure', () => {
    const b1 = new ErrorBoundary({ name: 'b1', strategy: 'fail-fast', logErrors: false });
    const b2 = new ErrorBoundary({ name: 'b2', strategy: 'fail-fast', logErrors: false });
    const chain = new ChainedErrorBoundary([b1, b2]);

    let callCount = 0;
    const result = chain.exec(() => {
      callCount++;
      if (callCount === 1) throw new Error('first boundary fail');
      return 'recovered';
    });
    expect(result.success).toBe(true);
    expect(result.value).toBe('recovered');
  });

  it('should fail when all boundaries exhausted', () => {
    const b1 = new ErrorBoundary({ name: 'b1', strategy: 'fail-fast', logErrors: false });
    const b2 = new ErrorBoundary({ name: 'b2', strategy: 'fail-fast', logErrors: false });
    const chain = new ChainedErrorBoundary([b1, b2]);
    const result = chain.exec(() => { throw new Error('always fail'); });
    expect(result.success).toBe(false);
  });

  it('should aggregate error history from all boundaries', () => {
    const b1 = new ErrorBoundary({ name: 'b1', strategy: 'fail-fast', logErrors: false });
    const b2 = new ErrorBoundary({ name: 'b2', strategy: 'fail-fast', logErrors: false });
    const chain = new ChainedErrorBoundary([b1, b2]);

    chain.exec(() => { throw new Error('e1'); });
    chain.exec(() => { throw new Error('e2'); });

    // Each exec() goes through b1 (records error) then b2 (records error) = 2 per call
    expect(chain.getErrorCount()).toBe(4);
    expect(chain.getErrorHistory()).toHaveLength(4);
  });

  it('should clear history across all boundaries', () => {
    const b1 = new ErrorBoundary({ name: 'b1', strategy: 'fail-fast', logErrors: false });
    const b2 = new ErrorBoundary({ name: 'b2', strategy: 'fail-fast', logErrors: false });
    const chain = new ChainedErrorBoundary([b1, b2]);

    chain.exec(() => { throw new Error('e1'); });
    chain.clearHistory();
    expect(chain.getErrorCount()).toBe(0);
  });

  it('should dispose all boundaries', () => {
    const b1 = new ErrorBoundary({ name: 'b1', strategy: 'fail-fast', logErrors: false });
    const b2 = new ErrorBoundary({ name: 'b2', strategy: 'fail-fast', logErrors: false });
    const chain = new ChainedErrorBoundary([b1, b2]);

    chain.exec(() => { throw new Error('e1'); });
    chain.dispose();
    expect(chain.getErrorCount()).toBe(0);
  });

  it('should report hasErrors across chain', () => {
    const b1 = new ErrorBoundary({ name: 'b1', strategy: 'fail-fast', logErrors: false });
    const b2 = new ErrorBoundary({ name: 'b2', strategy: 'fail-fast', logErrors: false });
    const chain = new ChainedErrorBoundary([b1, b2]);

    expect(chain.hasErrors()).toBe(false);
    chain.exec(() => { throw new Error('e1'); });
    expect(chain.hasErrors()).toBe(true);
  });

  it('should work with async operations', async () => {
    const b1 = new ErrorBoundary({ name: 'b1', strategy: 'fail-fast', logErrors: false });
    const b2 = new ErrorBoundary({ name: 'b2', strategy: 'fail-fast', logErrors: false });
    const chain = new ChainedErrorBoundary([b1, b2]);

    let callCount = 0;
    const result = await chain.execAsync(async () => {
      callCount++;
      if (callCount === 1) throw new Error('first fail');
      return 'async recovered';
    });
    expect(result.success).toBe(true);
    expect(result.value).toBe('async recovered');
  });
});
