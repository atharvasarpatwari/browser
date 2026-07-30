import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  VariableService,
  FunctionService,
  ClosureService,
  ClassService,
  ModuleService,
  AsyncService,
  PromiseService,
} from '../src/browser/media';

describe('VariableService', () => {
  let service: VariableService;

  beforeEach(() => { service = new VariableService(); });
  afterEach(() => { service.dispose(); });

  it('starts with global scope', () => {
    expect(service.currentScope).toBeGreaterThan(0);
  });

  it('declares variables', () => {
    const r = service.declare('x', 'let');
    expect(r.name).toBe('x');
    expect(r.kind).toBe('let');
    expect(r.initialized).toBe(false);
  });

  it('sets and gets variables', () => {
    service.declare('x', 'let');
    service.set('x', 42);
    const r = service.get('x');
    expect(r.found).toBe(true);
    expect(r.value).toBe(42);
  });

  it('const cannot be reassigned', () => {
    service.declare('x', 'const');
    expect(service.set('x', 1)).toBe(true);
    expect(service.set('x', 2)).toBe(false);
  });

  it('scope chain resolution', () => {
    service.declare('x', 'let');
    service.set('x', 'global');
    const block = service.createScope('block');
    service.declare('y', 'let', block);
    service.set('y', 'block', block);
    expect(service.get('x', block).value).toBe('global');
    expect(service.get('y', block).value).toBe('block');
  });

  it('has checks existence', () => {
    service.declare('x', 'let');
    expect(service.has('x')).toBe(true);
    expect(service.has('nonexistent')).toBe(false);
  });

  it('delete removes variable', () => {
    service.declare('x', 'var');
    expect(service.delete('x')).toBe(true);
    expect(service.has('x')).toBe(false);
  });

  it('createScope and destroyScope', () => {
    const sid = service.createScope('block');
    expect(service.getScope(sid)?.type).toBe('block');
    service.destroyScope(sid);
    expect(service.getScope(sid)).toBeUndefined();
  });

  it('dump returns all values', () => {
    service.declare('a', 'let');
    service.set('a', 1);
    service.declare('b', 'let');
    service.set('b', 2);
    const d = service.dump();
    expect(d.a).toBe(1);
    expect(d.b).toBe(2);
  });

  it('emits declared event', () => {
    const h = vi.fn(); service.onEvent(h);
    service.declare('x', 'let');
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'declared' }));
  });

  it('emits set event', () => {
    service.declare('x', 'let');
    const h = vi.fn(); service.onEvent(h);
    service.set('x', 1);
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'set' }));
  });

  it('emits scope_created event', () => {
    const h = vi.fn(); service.onEvent(h);
    service.createScope('block');
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'scope_created' }));
  });

  it('dispose clears all', () => {
    service.declare('x', 'let');
    service.dispose();
    expect(service.has('x')).toBe(false);
  });
});

describe('FunctionService', () => {
  let service: FunctionService;

  beforeEach(() => { service = new FunctionService(); });
  afterEach(() => { service.dispose(); });

  it('defines a function', () => {
    const id = service.define('add', ['a', 'b'], 'return a + b');
    const info = service.getInfo(id);
    expect(info?.name).toBe('add');
    expect(info?.arity).toBe(2);
  });

  it('calls a function', () => {
    const id = service.define('add', ['a', 'b'], 'return 3');
    const r = service.call(id, undefined, [1, 2]);
    expect(r.success).toBe(true);
    expect(r.value).toBe(3);
  });

  it('returns error for unknown function', () => {
    const r = service.call(999);
    expect(r.success).toBe(false);
    expect(r.error).toContain('not found');
  });

  it('tracks call stack', () => {
    const id1 = service.define('outer', [], '');
    const id2 = service.define('inner', [], '');
    service.call(id1);
    service.call(id2);
    const stack = service.getCallStack();
    expect(stack.length).toBe(2);
    expect(stack[0]?.name).toBe('outer');
    expect(stack[1]?.name).toBe('inner');
  });

  it('getStats returns stats', () => {
    const id = service.define('f', [], '');
    service.call(id);
    const stats = service.getStats();
    expect(stats.totalDefined).toBe(1);
    expect(stats.totalCalls).toBe(1);
  });

  it('remove deletes a function', () => {
    const id = service.define('f', [], '');
    expect(service.remove(id)).toBe(true);
    expect(service.getInfo(id)).toBeUndefined();
  });

  it('clear removes all', () => {
    service.define('a', [], '');
    service.define('b', [], '');
    service.clear();
    expect(service.getStats().totalDefined).toBe(0);
  });

  it('emits defined event', () => {
    const h = vi.fn(); service.onEvent(h);
    service.define('f', [], '');
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'defined' }));
  });

  it('emits called and returned events', () => {
    const h = vi.fn(); service.onEvent(h);
    const id = service.define('f', [], 'return 1');
    service.call(id);
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'called' }));
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'returned' }));
  });

  it('dispose clears all', () => {
    service.define('f', [], '');
    service.dispose();
    expect(service.getStats().totalDefined).toBe(0);
  });
});

describe('ClosureService', () => {
  let service: ClosureService;

  beforeEach(() => { service = new ClosureService(); });
  afterEach(() => { service.dispose(); });

  it('creates a closure', () => {
    const id = service.createClosure('counter', ['count'], { count: 0 });
    const info = service.getClosure(id);
    expect(info?.fn).toBe('counter');
    expect(info?.capturedVars).toEqual(['count']);
    expect(info?.isAlive).toBe(true);
  });

  it('invokes a closure', () => {
    const id = service.createClosure('greet', ['name'], { name: 'world' });
    const r = service.invoke(id);
    expect(r.success).toBe(true);
  });

  it('returns error for unknown closure', () => {
    const r = service.invoke(999);
    expect(r.success).toBe(false);
  });

  it('captureVariable captures into closure', () => {
    const id = service.createClosure('fn', ['x']);
    expect(service.captureVariable(id, 'x', 42)).toBe(true);
    const captured = service.getCaptured(id);
    expect(captured.x).toBe(42);
  });

  it('updateCaptured updates captured variable', () => {
    const id = service.createClosure('fn', ['x'], { x: 1 });
    service.updateCaptured(id, 'x', 2);
    const captured = service.getCaptured(id);
    expect(captured.x).toBe(2);
  });

  it('getStats returns stats', () => {
    service.createClosure('a', []);
    service.createClosure('b', ['x'], { x: 1 });
    const stats = service.getStats();
    expect(stats.totalClosures).toBe(2);
    expect(stats.totalCapturedVars).toBe(1);
  });

  it('emits created event', () => {
    const h = vi.fn(); service.onEvent(h);
    service.createClosure('fn', []);
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'created' }));
  });

  it('emits invoked event', () => {
    const h = vi.fn(); service.onEvent(h);
    const id = service.createClosure('fn', []);
    service.invoke(id);
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'invoked' }));
  });

  it('dispose clears all', () => {
    service.createClosure('fn', []);
    service.dispose();
    expect(service.getStats().totalClosures).toBe(0);
  });

  it('clear emits collected events', () => {
    service.createClosure('a', []);
    service.createClosure('b', []);
    const h = vi.fn(); service.onEvent(h);
    service.clear();
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'collected' }));
  });
});

describe('ClassService', () => {
  let service: ClassService;

  beforeEach(() => { service = new ClassService(); });
  afterEach(() => { service.dispose(); });

  it('defines a class', () => {
    const id = service.define('Person', undefined, ['constructor', 'greet']);
    const info = service.getClass(id);
    expect(info?.name).toBe('Person');
    expect(info?.methods).toEqual(['constructor', 'greet']);
  });

  it('defines class with inheritance', () => {
    const parent = service.define('Animal', undefined, ['speak']);
    const child = service.define('Dog', 'Animal', ['bark']);
    const info = service.getClass(child);
    expect(info?.parent).toBe('Animal');
  });

  it('instantiates a class', () => {
    const id = service.define('Point', undefined, ['constructor']);
    const r = service.instantiate(id, [1, 2]);
    expect(r.success).toBe(true);
    expect(r.instanceId).toBeGreaterThan(0);
  });

  it('instance has class reference', () => {
    const id = service.define('Car', undefined, ['constructor']);
    const r = service.instantiate(id);
    expect((r.instance as Record<string, unknown>).__class).toBe('Car');
  });

  it('getInstances returns instances', () => {
    const id = service.define('A', undefined, []);
    service.instantiate(id);
    service.instantiate(id);
    const instances = service.getInstances(id);
    expect(instances.length).toBe(2);
  });

  it('getStats returns stats', () => {
    service.define('A', undefined, ['m1', 'm2']);
    service.define('B', 'A', ['m3']);
    const stats = service.getStats();
    expect(stats.totalClasses).toBe(2);
    expect(stats.inheritanceDepth).toBeGreaterThanOrEqual(1);
  });

  it('remove deletes class and instances', () => {
    const id = service.define('A', undefined, []);
    service.instantiate(id);
    expect(service.remove(id)).toBe(true);
    expect(service.getClass(id)).toBeUndefined();
  });

  it('emits defined event', () => {
    const h = vi.fn(); service.onEvent(h);
    service.define('C', undefined, []);
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'defined' }));
  });

  it('emits instantiated event', () => {
    const id = service.define('C', undefined, []);
    const h = vi.fn(); service.onEvent(h);
    service.instantiate(id);
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'instantiated' }));
  });

  it('dispose clears all', () => {
    service.define('A', undefined, []);
    service.dispose();
    expect(service.getStats().totalClasses).toBe(0);
  });
});

describe('ModuleService', () => {
  let service: ModuleService;

  beforeEach(() => { service = new ModuleService(); });
  afterEach(() => { service.dispose(); });

  it('defines a module', () => {
    const id = service.define('math', ['add', 'sub']);
    const info = service.getModule(id);
    expect(info?.name).toBe('math');
    expect(info?.exports).toEqual(['add', 'sub']);
  });

  it('imports a defined module', () => {
    service.define('utils', ['format']);
    const r = service.import('utils');
    expect(r.success).toBe(true);
    expect(r.moduleId).toBeGreaterThan(0);
  });

  it('returns error for unresolvable module', () => {
    const r = service.import('nonexistent');
    expect(r.success).toBe(false);
  });

  it('link orders modules topologically', () => {
    const a = service.define('a', []);
    const b = service.define('b', []);
    service.import('a', 'b');
    const result = service.link();
    expect(result.success).toBe(true);
    expect(result.order).toBeDefined();
  });

  it('evaluates a module', () => {
    const id = service.define('config', ['VERSION'], 'export const VERSION = "1.0";');
    const r = service.evaluate(id);
    expect(r.success).toBe(true);
    expect(r.exports?.VERSION).toBe('1.0');
  });

  it('circular import detection', () => {
    service.define('a', []);
    service.define('b', []);
    service.import('a', 'b');
    service.import('b', 'a');
    const h = vi.fn(); service.onEvent(h);
    service.link();
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'circular' }));
  });

  it('getModules returns all modules', () => {
    service.define('a', []);
    service.define('b', []);
    expect(service.getModules().length).toBe(2);
  });

  it('getStats returns stats', () => {
    service.define('a', []);
    service.define('b', ['x']);
    service.evaluate(service.getModule(1)!.id);
    const stats = service.getStats();
    expect(stats.totalModules).toBe(2);
  });

  it('remove deletes a module', () => {
    const id = service.define('tmp', []);
    expect(service.remove(id)).toBe(true);
    expect(service.getModule(id)).toBeUndefined();
  });

  it('setResolveHook allows custom resolution', () => {
    service.setResolveHook((specifier: string) => {
      if (specifier === './foo') return 'foo';
      return null;
    });
    service.define('foo', []);
    const r = service.resolve('./foo', 'main');
    expect(r?.name).toBe('foo');
  });

  it('emits defined event', () => {
    const h = vi.fn(); service.onEvent(h);
    service.define('m', []);
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'defined' }));
  });

  it('emits evaluated event', () => {
    const id = service.define('m', []);
    const h = vi.fn(); service.onEvent(h);
    service.evaluate(id);
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'evaluated' }));
  });

  it('dispose clears all', () => {
    service.define('m', []);
    service.dispose();
    expect(service.getStats().totalModules).toBe(0);
  });
});

describe('AsyncService', () => {
  let service: AsyncService;

  beforeEach(() => { service = new AsyncService(); });
  afterEach(() => { service.dispose(); });

  it('starts an async operation', () => {
    const handle = service.start('fetchData', ['/api']);
    expect(handle.status).toBe('pending');
    expect(handle.fn).toBe('fetchData');
  });

  it('resolve completes an operation', () => {
    const handle = service.start('task');
    service.resolve(handle.id, 'done');
    const op = service.getOperation(handle.id);
    expect(op?.status).toBe('resolved');
    expect(op?.result).toBe('done');
  });

  it('reject fails an operation', () => {
    const handle = service.start('task');
    service.reject(handle.id, 'failed');
    const op = service.getOperation(handle.id);
    expect(op?.status).toBe('rejected');
    expect(op?.error).toBe('failed');
  });

  it('await returns result', () => {
    const handle = service.start('task');
    service.resolve(handle.id, 42);
    const r = service.await(handle.id);
    expect(r.success).toBe(true);
    expect(r.value).toBe(42);
  });

  it('getPending returns pending operations', () => {
    service.start('slow');
    expect(service.getPending().length).toBeGreaterThanOrEqual(1);
  });

  it('getStats returns stats', () => {
    service.start('a');
    service.start('b');
    const stats = service.getStats();
    expect(stats.totalStarted).toBe(2);
  });

  it('setScheduler uses custom scheduler', () => {
    const calls: string[] = [];
    service.setScheduler((fn: () => void) => { calls.push('scheduled'); fn(); });
    service.start('task');
    expect(calls).toContain('scheduled');
  });

  it('emits started event', () => {
    const h = vi.fn(); service.onEvent(h);
    service.start('task');
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'started' }));
  });

  it('emits resolved event', () => {
    const handle = service.start('task');
    const h = vi.fn(); service.onEvent(h);
    service.resolve(handle.id, 'ok');
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'resolved' }));
  });

  it('emits rejected event', () => {
    const handle = service.start('task');
    const h = vi.fn(); service.onEvent(h);
    service.reject(handle.id, 'err');
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rejected' }));
  });

  it('dispose clears all', () => {
    service.start('task');
    service.dispose();
    expect(service.getStats().totalStarted).toBe(0);
  });
});

describe('PromiseService', () => {
  let service: PromiseService;

  beforeEach(() => { service = new PromiseService(); });
  afterEach(() => { service.dispose(); });

  it('creates a pending promise', () => {
    const p = service.create();
    expect(p.state).toBe('pending');
    expect(typeof p.id).toBe('number');
  });

  it('resolve creates fulfilled promise', () => {
    const p = service.resolve(42);
    expect(p.state).toBe('fulfilled');
    expect(service.getResult(p.id)).toBe(42);
  });

  it('reject creates rejected promise', () => {
    const p = service.reject('error');
    expect(p.state).toBe('rejected');
  });

  it('then chains on fulfilled', () => {
    const p = service.resolve(1);
    const p2 = service.then(p.id, (v) => (v as number) + 1);
    expect(service.getState(p2.id)).toBe('fulfilled');
    expect(service.getResult(p2.id)).toBe(2);
  });

  it('then chains on rejected with error handler', () => {
    const p = service.reject('fail');
    const p2 = service.then(p.id, undefined, (r) => `caught: ${r}`);
    expect(service.getState(p2.id)).toBe('fulfilled');
    expect(service.getResult(p2.id)).toBe('caught: fail');
  });

  it('all resolves when all fulfill', () => {
    const p1 = service.resolve(1);
    const p2 = service.resolve(2);
    const all = service.all([p1.id, p2.id]);
    expect(service.getState(all.id)).toBe('fulfilled');
    const result = service.getResult(all.id) as unknown[];
    expect(result).toEqual([1, 2]);
  });

  it('all rejects on first rejection', () => {
    const p1 = service.resolve(1);
    const p2 = service.reject('fail');
    const all = service.all([p1.id, p2.id]);
    expect(service.getState(all.id)).toBe('rejected');
  });

  it('allSettled settles all', () => {
    const p1 = service.resolve(1);
    const p2 = service.reject('err');
    const s = service.allSettled([p1.id, p2.id]);
    expect(service.getState(s.id)).toBe('fulfilled');
    const result = service.getResult(s.id) as Array<{ status: string }>;
    expect(result[0]?.status).toBe('fulfilled');
    expect(result[1]?.status).toBe('rejected');
  });

  it('race resolves with first', () => {
    const slow = service.create();
    const fast = service.resolve('winner');
    const r = service.race([slow.id, fast.id]);
    expect(service.getState(r.id)).toBe('fulfilled');
    expect(service.getResult(r.id)).toBe('winner');
  });

  it('any resolves with first fulfilled', () => {
    const p1 = service.reject('fail');
    const p2 = service.resolve('ok');
    const a = service.any([p1.id, p2.id]);
    expect(service.getState(a.id)).toBe('fulfilled');
    expect(service.getResult(a.id)).toBe('ok');
  });

  it('getStats returns stats', () => {
    service.resolve(1);
    service.reject('err');
    service.create();
    const stats = service.getStats();
    expect(stats.totalCreated).toBe(3);
    expect(stats.fulfilled).toBe(1);
    expect(stats.rejected).toBe(1);
    expect(stats.pending).toBe(1);
  });

  it('emits created event', () => {
    const h = vi.fn(); service.onEvent(h);
    service.create();
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'created' }));
  });

  it('emits fulfilled event', () => {
    const h = vi.fn(); service.onEvent(h);
    service.resolve(42);
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'fulfilled' }));
  });

  it('emits rejected event', () => {
    const h = vi.fn(); service.onEvent(h);
    service.reject('err');
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rejected' }));
  });

  it('emits chained event on then', () => {
    const p = service.resolve(1);
    const h = vi.fn(); service.onEvent(h);
    service.then(p.id, (v) => v);
    expect(h).toHaveBeenCalledWith(expect.objectContaining({ kind: 'chained' }));
  });

  it('dispose clears all', () => {
    service.resolve(1);
    service.dispose();
    expect(service.getStats().totalCreated).toBe(0);
  });
});
