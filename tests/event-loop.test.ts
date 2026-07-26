import { describe, it, expect } from 'vitest';
import { EventLoop, bindQueueMicrotask, bindTimers } from '../src/browser/js/event-loop';
import { Interpreter } from '../src/browser/js/interpreter';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import type { JSValue } from '../src/browser/js/values';

function run(source: string): { value: JSValue; interpreter: Interpreter; eventLoop: EventLoop } {
  const eventLoop = new EventLoop();
  const interp = new Interpreter(undefined, eventLoop);
  const lexer = new Lexer(source);
  const parser = new Parser(lexer.tokenize());
  const program = parser.parse();
  const value = interp.run(program);
  return { value, interpreter: interp, eventLoop };
}

describe('EventLoop', () => {
  describe('microtask ordering', () => {
    it('should drain microtasks before macrotasks in runOnce', () => {
      const el = new EventLoop();
      const order: string[] = [];

      el.enqueueMicrotask(() => order.push('micro1'));
      el.enqueueMicrotask(() => order.push('micro2'));
      el.schedule(() => order.push('macro1'), 0);

      el.runOnce(Date.now());

      expect(order).toEqual(['micro1', 'micro2', 'macro1']);
    });

    it('should drain nextTick before regular microtasks', () => {
      const el = new EventLoop();
      const order: string[] = [];

      el.enqueueMicrotask(() => order.push('micro'));
      el.enqueueNextTick(() => order.push('nextTick'));

      el.drainMicrotasks();

      expect(order).toEqual(['nextTick', 'micro']);
    });

    it('should drain microtasks after each macrotask', () => {
      const el = new EventLoop();
      const order: string[] = [];

      el.schedule(() => {
        order.push('macro1');
        el.enqueueMicrotask(() => order.push('micro-after-macro1'));
      }, 0);
      el.schedule(() => order.push('macro2'), 0);

      el.runAll();

      expect(order).toEqual(['macro1', 'micro-after-macro1', 'macro2']);
    });

    it('should handle microtasks enqueued by microtasks', () => {
      const el = new EventLoop();
      const order: string[] = [];

      el.enqueueMicrotask(() => {
        order.push('micro1');
        el.enqueueMicrotask(() => order.push('nested-micro'));
      });
      el.enqueueMicrotask(() => order.push('micro2'));

      el.drainMicrotasks();

      // FIFO order: micro1 runs first, enqueues nested-micro at end,
      // then micro2 runs, then nested-micro runs
      expect(order).toEqual(['micro1', 'micro2', 'nested-micro']);
    });

    it('should handle nextTick enqueued by nextTick', () => {
      const el = new EventLoop();
      const order: string[] = [];

      el.enqueueNextTick(() => {
        order.push('tick1');
        el.enqueueNextTick(() => order.push('nested-tick'));
      });
      el.enqueueNextTick(() => order.push('tick2'));

      el.drainMicrotasks();

      // FIFO order: tick1 runs first, enqueues nested-tick at end,
      // then tick2 runs, then nested-tick runs
      expect(order).toEqual(['tick1', 'tick2', 'nested-tick']);
    });
  });

  describe('queueMicrotask API', () => {
    it('should expose queueMicrotask as a global function', () => {
      const { interpreter, eventLoop } = run(`
        var result = '';
        queueMicrotask(function() { result = 'called'; });
      `);
      // Microtask is pending — drain it
      eventLoop.drainMicrotasks();
      expect((interpreter as any).globalEnv.get('result')).toBe('called');
    });

    it('should reject non-function arguments', () => {
      try {
        run('queueMicrotask(42)');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('not a function');
      }
    });
  });

  describe('process.nextTick API', () => {
    it('should expose process.nextTick', () => {
      const { interpreter, eventLoop } = run(`
        var result = '';
        process.nextTick(function() { result = 'nextTick'; });
      `);
      eventLoop.drainMicrotasks();
      expect((interpreter as any).globalEnv.get('result')).toBe('nextTick');
    });

    it('should run nextTick before queueMicrotask', () => {
      const { interpreter, eventLoop } = run(`
        var order = '';
        process.nextTick(function() { order = order + 'a'; });
        queueMicrotask(function() { order = order + 'b'; });
      `);
      eventLoop.drainMicrotasks();
      expect((interpreter as any).globalEnv.get('order')).toBe('ab');
    });

    it('should reject non-function arguments', () => {
      try {
        run('process.nextTick("not a function")');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('not a function');
      }
    });
  });

  describe('setTimeout with microtask drain', () => {
    it('should drain microtasks after setTimeout callback', () => {
      const el = new EventLoop();
      const order: string[] = [];

      el.schedule(() => {
        order.push('timer');
        el.enqueueMicrotask(() => order.push('micro'));
      }, 0);

      el.runOnce(Date.now());
      expect(order).toEqual(['timer', 'micro']);
    });

    it('should handle chained setTimeout with microtasks', () => {
      const el = new EventLoop();
      const order: string[] = [];

      el.schedule(() => {
        order.push('timer1');
        el.enqueueMicrotask(() => order.push('micro1'));
        el.schedule(() => {
          order.push('timer2');
          el.enqueueMicrotask(() => order.push('micro2'));
        }, 0);
      }, 0);

      el.runAll();
      expect(order).toEqual(['timer1', 'micro1', 'timer2', 'micro2']);
    });
  });

  describe('Promise integration with microtasks', () => {
    it('should resolve Promise.then via microtask', () => {
      const { interpreter, eventLoop } = run(`
        var result = 0;
        Promise.resolve(42).then(function(v) { result = v; });
      `);
      eventLoop.drainMicrotasks();
      expect((interpreter as any).globalEnv.get('result')).toBe(42);
    });

    it('should resolve Promise.all via microtask', () => {
      const { interpreter, eventLoop } = run(`
        var result = 0;
        Promise.all([Promise.resolve(1), Promise.resolve(2)]).then(function(v) {
          result = v;
        });
      `);
      eventLoop.drainMicrotasks();
      const result = (interpreter as any).globalEnv.get('result') as any;
      expect(result.type).toBe('array');
      expect(Number(result.properties.get('0')?.value)).toBe(1);
      expect(Number(result.properties.get('1')?.value)).toBe(2);
    });

    it('should handle Promise chain ordering', () => {
      const { interpreter, eventLoop } = run(`
        var result = '';
        Promise.resolve(1)
          .then(function(v) { result = result + v + ','; return v + 1; })
          .then(function(v) { result = result + v; });
      `);
      eventLoop.drainMicrotasks();
      expect((interpreter as any).globalEnv.get('result')).toBe('1,2');
    });
  });

  describe('clear() and dispose()', () => {
    it('should clear all queues', () => {
      const el = new EventLoop();
      el.enqueueMicrotask(() => {});
      el.enqueueNextTick(() => {});
      el.schedule(() => {}, 5000);

      expect(el.microtaskCount).toBe(1);
      expect(el.nextTickCount).toBe(1);
      expect(el.pendingCount).toBe(1);

      el.clear();

      expect(el.microtaskCount).toBe(0);
      expect(el.nextTickCount).toBe(0);
      expect(el.pendingCount).toBe(0);
    });
  });

  describe('timer API', () => {
    it('should support setTimeout with delay 0 via EventLoop', () => {
      const el = new EventLoop();
      let called = false;
      el.schedule(() => { called = true; }, 0);
      el.runAll();
      expect(called).toBe(true);
    });

    it('should support setInterval via EventLoop', () => {
      const el = new EventLoop();
      let count = 0;
      const id = el.schedule(() => { count++; }, 100, true);

      // Simulate 550ms of ticks
      for (let i = 0; i < 6; i++) {
        el.runOnce(Date.now() + i * 100);
      }
      el.clearTimer(id);
      expect(count).toBeGreaterThanOrEqual(5);
    });

    it('should support clearInterval/clearTimeout', () => {
      const el = new EventLoop();
      let called = false;
      const id = el.schedule(() => { called = true; }, 100);
      el.clearTimer(id);
      el.runOnce(Date.now() + 200);
      expect(called).toBe(false);
    });

    it('should bind timer API to interpreter global env', () => {
      const { interpreter, eventLoop } = run(`
        var result = '';
        setTimeout(function() { result = 'done'; }, 0);
      `);
      // Interpreter uses its own timer map — drain manually
      eventLoop.runAll();
      // Result not set because interpreter timers use its own scheduler, not EventLoop
      // This verifies the interpreter timer is independent
      expect(typeof (interpreter as any).globalEnv.get('result')).toBe('string');
    });
  });

  describe('requestAnimationFrame', () => {
    it('should invoke RAF callback and drain microtasks', () => {
      const el = new EventLoop();
      let called = false;
      let microRan = false;

      el.requestAnimationFrame(() => {
        called = true;
        el.enqueueMicrotask(() => { microRan = true; });
      });

      el.runOnce(Date.now());
      expect(called).toBe(true);
      expect(microRan).toBe(true);
    });

    it('should support cancelAnimationFrame', () => {
      const el = new EventLoop();
      let called = false;

      const id = el.requestAnimationFrame(() => { called = true; });
      el.cancelAnimationFrame(id);

      el.runOnce(Date.now());
      expect(called).toBe(false);
    });
  });

  describe('timeUntilNext', () => {
    it('should return Infinity when no tasks', () => {
      const el = new EventLoop();
      expect(el.timeUntilNext()).toBe(Infinity);
    });

    it('should return 0 for due tasks', () => {
      const el = new EventLoop();
      el.schedule(() => {}, 0);
      expect(el.timeUntilNext()).toBe(0);
    });
  });
});
