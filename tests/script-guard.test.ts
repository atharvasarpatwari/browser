import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ScriptGuard, ScriptGuardError, DEFAULT_SCRIPT_GUARD_CONFIG } from '../src/browser/engine/script-guard';

describe('ScriptGuard', () => {
  let guard: ScriptGuard;

  beforeEach(() => {
    vi.restoreAllMocks();
    guard = new ScriptGuard();
  });

  // ── exec (sync) ─────────────────────────────────────────────────────────────

  describe('exec', () => {
    it('should return success with value', async () => {
      const result = await guard.exec(() => 42);
      expect(result.completed).toBe(true);
      expect(result.value).toBe(42);
    });

    it('should return failure for thrown error', async () => {
      const result = await guard.exec(() => { throw new Error('boom'); });
      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(ScriptGuardError);
    });

    it('should track instruction count via tick()', () => {
      guard.tick();
      guard.tick();
      guard.tick();
      expect(guard.getInstructionCount()).toBe(3);
    });

    it('should track stack depth', () => {
      guard.pushFrame('main');
      expect(guard.getStackDepth()).toBe(1);
      guard.pushFrame('inner');
      expect(guard.getStackDepth()).toBe(2);
      guard.popFrame();
      expect(guard.getStackDepth()).toBe(1);
    });
  });

  // ── tick / instruction limit ────────────────────────────────────────────────

  describe('instruction limit', () => {
    it('should throw ScriptGuardError when instruction limit exceeded', () => {
      const g = new ScriptGuard({ maxInstructions: 5, enabled: true });
      // Ticks 1-4 succeed, tick 5 throws (count becomes 5 >= 5)
      g.tick(); g.tick(); g.tick(); g.tick(); // 4 ticks OK
      expect(() => g.tick()).toThrow(ScriptGuardError); // 5th tick throws
    });

    it('should set triggered and reason on instruction limit', () => {
      const g = new ScriptGuard({ maxInstructions: 2, enabled: true });
      g.tick(); // count=1, ok
      try { g.tick(); } catch {} // count=2, 2>=2 → throws
      expect(g.isTriggered()).toBe(true);
      expect(g.getTerminationReason()).toBe('instruction-limit');
    });
  });

  // ── pushFrame / popFrame ────────────────────────────────────────────────────

  describe('pushFrame / popFrame', () => {
    it('should throw on stack overflow', () => {
      const g = new ScriptGuard({ maxStackDepth: 2, enabled: true });
      g.pushFrame('a');
      g.pushFrame('b');
      expect(() => g.pushFrame('c')).toThrow(ScriptGuardError);
    });

    it('should set triggered on stack overflow', () => {
      const g = new ScriptGuard({ maxStackDepth: 1, enabled: true });
      g.pushFrame('a');
      try { g.pushFrame('b'); } catch {}
      expect(g.isTriggered()).toBe(true);
      expect(g.getTerminationReason()).toBe('stack-overflow');
    });

    it('should correctly track stack depth', () => {
      guard.pushFrame('a');
      guard.pushFrame('b');
      guard.popFrame();
      expect(guard.getStackDepth()).toBe(1);
    });
  });

  // ── disabled mode ───────────────────────────────────────────────────────────

  describe('disabled mode', () => {
    it('should skip all limits when disabled', () => {
      const g = new ScriptGuard({ enabled: false });
      g.tick();
      g.tick();
      expect(g.getInstructionCount()).toBe(0);
      expect(g.isTriggered()).toBe(false);
    });

    it('should still execute function when disabled', async () => {
      const g = new ScriptGuard({ enabled: false });
      const result = await g.exec(() => 42);
      expect(result.completed).toBe(true);
      expect(result.value).toBe(42);
    });
  });

  // ── reset ───────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should reset all counters', () => {
      guard.tick();
      guard.pushFrame('a');
      guard.reset();
      expect(guard.getInstructionCount()).toBe(0);
      expect(guard.getStackDepth()).toBe(0);
      expect(guard.isTriggered()).toBe(false);
      expect(guard.getTerminationReason()).toBeNull();
    });
  });

  // ── config ──────────────────────────────────────────────────────────────────

  describe('config', () => {
    it('should use default config', () => {
      const g = new ScriptGuard();
      const config = g.getConfig();
      expect(config.maxExecutionMs).toBe(DEFAULT_SCRIPT_GUARD_CONFIG.maxExecutionMs);
      expect(config.maxInstructions).toBe(DEFAULT_SCRIPT_GUARD_CONFIG.maxInstructions);
    });

    it('should override config', () => {
      const g = new ScriptGuard({ maxExecutionMs: 1000 });
      expect(g.getConfig().maxExecutionMs).toBe(1000);
    });

    it('getConfig should return copy', () => {
      const config = guard.getConfig() as { maxExecutionMs: number };
      config.maxExecutionMs = 999;
      expect(guard.getConfig().maxExecutionMs).not.toBe(999);
    });
  });

  // ── ScriptGuardError ────────────────────────────────────────────────────────

  describe('ScriptGuardError', () => {
    it('should have correct properties', () => {
      const err = new ScriptGuardError('timeout', 5000, 5001);
      expect(err.name).toBe('ScriptGuardError');
      expect(err.reason).toBe('timeout');
      expect(err.limit).toBe(5000);
      expect(err.actual).toBe(5001);
      expect(err.message).toContain('timeout');
    });

    it('should handle all termination reasons', () => {
      const reasons: Array<ScriptGuardError['reason']> = [
        'timeout', 'instruction-limit', 'stack-overflow', 'memory-limit', 'manual',
      ];
      for (const reason of reasons) {
        const err = new ScriptGuardError(reason, 0, 0);
        expect(err.reason).toBe(reason);
      }
    });
  });

  // ── dispose ─────────────────────────────────────────────────────────────────

  describe('dispose', () => {
    it('should reset all state', () => {
      guard.tick();
      guard.pushFrame('a');
      guard.dispose();
      expect(guard.getInstructionCount()).toBe(0);
      expect(guard.isTriggered()).toBe(false);
    });
  });
});
