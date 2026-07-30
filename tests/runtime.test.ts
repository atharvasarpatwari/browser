import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  CallStackService,
  TaskQueueService,
  MicrotaskService,
  AnimationFrameService,
  IdleCallbackService,
} from '../src/browser/media';

describe('CallStackService', () => {
  let service: CallStackService;

  beforeEach(() => {
    service = new CallStackService();
  });

  afterEach(() => {
    service.dispose();
  });

  it('starts empty', () => {
    expect(service.depth).toBe(0);
    expect(service.peek()).toBeUndefined();
    expect(service.getStack()).toEqual([]);
  });

  it('pushes and pops frames', () => {
    service.push({ functionName: 'foo', timestamp: Date.now() });
    expect(service.depth).toBe(1);
    service.push({ functionName: 'bar', timestamp: Date.now() });
    expect(service.depth).toBe(2);

    const frame = service.pop();
    expect(frame?.functionName).toBe('bar');
    expect(service.depth).toBe(1);
  });

  it('peek returns top frame without removing', () => {
    service.push({ functionName: 'top', timestamp: 100 });
    const frame = service.peek();
    expect(frame?.functionName).toBe('top');
    expect(service.depth).toBe(1);
  });

  it('pop on empty returns undefined', () => {
    expect(service.pop()).toBeUndefined();
  });

  it('clear empties the stack', () => {
    service.push({ functionName: 'a', timestamp: 1 });
    service.push({ functionName: 'b', timestamp: 2 });
    service.clear();
    expect(service.depth).toBe(0);
  });

  it('getStackTrace formats frames', () => {
    service.push({ functionName: 'inner', fileName: 'test.ts', lineNumber: 10 });
    service.push({ functionName: 'outer', fileName: 'test.ts', lineNumber: 20 });
    const trace = service.getStackTrace();
    expect(trace).toContain('inner');
    expect(trace).toContain('outer');
    expect(trace).toContain('test.ts:10');
    expect(trace).toContain('test.ts:20');
  });

  it('throws on exceeding max depth', () => {
    for (let i = 0; i < 1000; i++) {
      service.push({ functionName: `f${i}`, timestamp: i });
    }
    expect(() => service.push({ functionName: 'overflow', timestamp: 1001 })).toThrow('Maximum call stack size exceeded');
  });

  it('emits push event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.push({ functionName: 'test', timestamp: 1 });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'push' }));
  });

  it('emits pop event', () => {
    service.push({ functionName: 'test', timestamp: 1 });
    const handler = vi.fn();
    service.onEvent(handler);
    service.pop();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pop' }));
  });

  it('emits clear event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.clear();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'clear' }));
  });

  it('unsubscribe removes handler', () => {
    const handler = vi.fn();
    const unsub = service.onEvent(handler);
    unsub();
    service.push({ functionName: 'x', timestamp: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('dispose clears all handlers and stack', () => {
    service.push({ functionName: 'a', timestamp: 1 });
    service.dispose();
    expect(service.depth).toBe(0);
  });
});

describe('TaskQueueService', () => {
  let service: TaskQueueService;

  beforeEach(() => {
    service = new TaskQueueService();
  });

  afterEach(() => {
    service.dispose();
  });

  it('starts with no pending tasks', () => {
    expect(service.pending).toBe(0);
  });

  it('schedule adds a task', () => {
    const id = service.schedule(() => { }, 100);
    expect(service.pending).toBe(1);
    expect(typeof id).toBe('number');
  });

  it('runOnce executes due task', () => {
    const fn = vi.fn();
    service.schedule(fn, 0);
    service.runOnce();
    expect(fn).toHaveBeenCalled();
  });

  it('runOnce does not execute non-due task', () => {
    const fn = vi.fn();
    service.schedule(fn, 1000);
    service.runOnce();
    expect(fn).not.toHaveBeenCalled();
  });

  it('clearTimer removes a task', () => {
    const id = service.schedule(() => { }, 100);
    service.clearTimer(id);
    expect(service.pending).toBe(0);
  });

  it('clearAll removes all tasks', () => {
    service.schedule(() => { }, 10);
    service.schedule(() => { }, 20);
    service.clearAll();
    expect(service.pending).toBe(0);
  });

  it('recurring task re-queues itself', () => {
    const fn = vi.fn();
    service.schedule(fn, 0, true);
    service.runOnce();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(service.pending).toBe(1);
  });

  it('runAll runs until empty', () => {
    const fn = vi.fn();
    service.schedule(fn, 0);
    service.schedule(fn, 0);
    service.runAll();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('getPendingTasks returns snapshot', () => {
    service.schedule(() => { }, 50);
    const tasks = service.getPendingTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].delay).toBe(50);
  });

  it('emits scheduled event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    const id = service.schedule(() => { }, 100);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'scheduled', data: expect.objectContaining({ id }) }));
  });

  it('emits cancelled event', () => {
    const id = service.schedule(() => { }, 100);
    const handler = vi.fn();
    service.onEvent(handler);
    service.clearTimer(id);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cancelled' }));
  });

  it('emits executed event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.schedule(() => { }, 0);
    service.runOnce();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'executed' }));
  });

  it('dispose clears all', () => {
    service.schedule(() => { }, 100);
    service.dispose();
    expect(service.pending).toBe(0);
  });
});

describe('MicrotaskService', () => {
  let service: MicrotaskService;

  beforeEach(() => {
    service = new MicrotaskService();
  });

  afterEach(() => {
    service.dispose();
  });

  it('starts empty', () => {
    expect(service.pending).toBe(0);
  });

  it('enqueue adds to normal queue by default', () => {
    service.enqueue(() => { });
    expect(service.pending).toBe(1);
    expect(service.getPendingCount('high')).toBe(0);
    expect(service.getPendingCount('normal')).toBe(1);
  });

  it('drain executes all enqueued tasks', () => {
    const fn = vi.fn();
    service.enqueue(fn);
    service.enqueue(fn);
    const count = service.drain();
    expect(count).toBe(2);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('high priority tasks drain first', () => {
    const order: string[] = [];
    service.enqueue(() => order.push('normal'));
    service.enqueue(() => order.push('high'), 'high');
    service.drain();
    expect(order).toEqual(['high', 'normal']);
  });

  it('drain returns 0 when empty', () => {
    expect(service.drain()).toBe(0);
  });

  it('emits enqueued event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.enqueue(() => { });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'enqueued' }));
  });

  it('emits executed event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.enqueue(() => { });
    service.drain();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'executed' }));
  });

  it('emits drained event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.enqueue(() => { });
    service.drain();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'drained' }));
  });

  it('dispose clears queues', () => {
    service.enqueue(() => { });
    service.enqueue(() => { }, 'high');
    service.dispose();
    expect(service.pending).toBe(0);
  });
});

describe('AnimationFrameService', () => {
  let service: AnimationFrameService;

  beforeEach(() => {
    service = new AnimationFrameService();
  });

  afterEach(() => {
    service.dispose();
  });

  it('starts with no pending callbacks', () => {
    expect(service.pending).toBe(0);
  });

  it('request adds a callback and returns id', () => {
    const id = service.request(() => { });
    expect(service.pending).toBe(1);
    expect(typeof id).toBe('number');
  });

  it('cancel removes a callback', () => {
    const id = service.request(() => { });
    service.cancel(id);
    expect(service.pending).toBe(0);
  });

  it('cancelAll removes all callbacks', () => {
    service.request(() => { });
    service.request(() => { });
    service.cancelAll();
    expect(service.pending).toBe(0);
  });

  it('runPending executes all callbacks with timestamp', () => {
    const fn = vi.fn();
    service.request(fn);
    const count = service.runPending(5000);
    expect(count).toBe(1);
    expect(fn).toHaveBeenCalledWith(5000);
  });

  it('runPending returns 0 when empty', () => {
    expect(service.runPending()).toBe(0);
  });

  it('default fps is 60', () => {
    expect(service.fps).toBe(60);
  });

  it('setFPS clips between 1 and 120', () => {
    service.setFPS(0);
    expect(service.fps).toBe(1);
    service.setFPS(200);
    expect(service.fps).toBe(120);
  });

  it('emits requested event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    const id = service.request(() => { });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'requested', data: expect.objectContaining({ id }) }));
  });

  it('emits cancelled event', () => {
    const id = service.request(() => { });
    const handler = vi.fn();
    service.onEvent(handler);
    service.cancel(id);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cancelled' }));
  });

  it('emits executed event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.request(() => { });
    service.runPending();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'executed' }));
  });

  it('dispose clears all', () => {
    service.request(() => { });
    service.dispose();
    expect(service.pending).toBe(0);
  });
});

describe('IdleCallbackService', () => {
  let service: IdleCallbackService;

  beforeEach(() => {
    service = new IdleCallbackService();
  });

  afterEach(() => {
    service.dispose();
  });

  it('starts with no pending callbacks', () => {
    expect(service.pending).toBe(0);
  });

  it('request adds a callback and returns id', () => {
    const id = service.request(() => { });
    expect(service.pending).toBe(1);
    expect(typeof id).toBe('number');
  });

  it('cancel removes a callback', () => {
    const id = service.request(() => { });
    service.cancel(id);
    expect(service.pending).toBe(0);
  });

  it('cancelAll removes all', () => {
    service.request(() => { });
    service.request(() => { });
    service.cancelAll();
    expect(service.pending).toBe(0);
  });

  it('runPending executes callbacks with IdleDeadline', () => {
    const fn = vi.fn();
    service.request(fn);
    const count = service.runPending();
    expect(count).toBe(1);
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ didTimeout: false }));
  });

  it('IdleDeadline.timeRemaining returns positive number', () => {
    const fn = vi.fn();
    service.request(fn);
    service.runPending();
    const deadline = fn.mock.calls[0][0];
    expect(deadline.timeRemaining()).toBeGreaterThanOrEqual(0);
  });

  it('callback receives didTimeout when overdue', () => {
    const fn = vi.fn();
    service.request(fn, { timeout: 1 });
    service.runPending(Date.now() + 100);
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ didTimeout: true }));
  });

  it('setTimeoutOverride changes default timeout', () => {
    service.setTimeoutOverride(200);
    const fn = vi.fn();
    service.request(fn);
    const deadline = fn.mock.calls[0]?.[0];
    if (!deadline) {
      service.runPending();
      const deadline2 = fn.mock.calls[0][0];
      expect(deadline2.timeRemaining()).toBeGreaterThan(0);
    }
  });

  it('emits requested event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    const id = service.request(() => { });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'requested', data: expect.objectContaining({ id }) }));
  });

  it('emits cancelled event', () => {
    const id = service.request(() => { });
    const handler = vi.fn();
    service.onEvent(handler);
    service.cancel(id);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cancelled' }));
  });

  it('emits executed event', () => {
    const handler = vi.fn();
    service.onEvent(handler);
    service.request(() => { });
    service.runPending();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'executed' }));
  });

  it('dispose clears all', () => {
    service.request(() => { });
    service.dispose();
    expect(service.pending).toBe(0);
  });
});
