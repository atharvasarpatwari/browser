import { describe, it, expect } from 'vitest';
import { Interpreter } from '../src/browser/js/interpreter';
import { Environment, createObject, type JSValue, type JSObject } from '../src/browser/js/values';
import { EventLoop } from '../src/browser/js/event-loop';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { isPromiseObject } from '../src/browser/js/promise';

function run(source: string): { value: JSValue; env: Environment; eventLoop: EventLoop } {
  const eventLoop = new EventLoop();
  const interp = new Interpreter(undefined, eventLoop);
  const lexer = new Lexer(source);
  const parser = new Parser(lexer.tokenize());
  const program = parser.parse();
  const value = interp.run(program);
  return { value, env: (interp as any).globalEnv, eventLoop };
}

describe('Promise', () => {
  describe('constructor', () => {
    it('should create a Promise object', () => {
      const { value } = run('new Promise(() => {})');
      expect(typeof value).toBe('object');
      expect(isPromiseObject(value)).toBe(true);
    });

    it('should execute executor synchronously', () => {
      const { env } = run(`
        var flag = false;
        new Promise(function() { flag = true; });
      `);
      expect(env.get('flag')).toBe(true);
    });

    it('should reject if executor is not a function', () => {
      try {
        run('new Promise(42)');
        expect.unreachable('should have thrown');
      } catch (e) {
        expect((e as Error).message).toContain('not a function');
      }
    });
  });

  describe('.then() — fulfill', () => {
    it('should receive fulfilled value via variable', () => {
      const { env } = run(`
        var result = 0;
        new Promise(function(resolve) { resolve(42); }).then(function(val) { result = val; });
      `);
      expect(env.get('result')).toBe(42);
    });

    it('should chain values via variables', () => {
      const { env } = run(`
        var a = 0, b = 0;
        new Promise(function(resolve) { resolve(1); })
          .then(function(val) { a = val + 1; return a; })
          .then(function(val) { b = val + 1; });
      `);
      expect(env.get('a')).toBe(2);
      expect(env.get('b')).toBe(3);
    });

    it('should handle no-handler case (propagate)', () => {
      const { env } = run(`
        var result = 0;
        new Promise(function(resolve) { resolve(42); })
          .then()
          .then(function(val) { result = val; });
      `);
      expect(env.get('result')).toBe(42);
    });

    it('should handle thenable objects', () => {
      const { env } = run(`
        var result = 0;
        new Promise(function(resolve) {
          resolve({ then: function(cb) { cb(99); } });
        }).then(function(val) { result = val; });
      `);
      expect(env.get('result')).toBe(99);
    });

    it('should call handler as microtask (async)', () => {
      const { env, eventLoop } = run(`
        var called = false;
        new Promise(function(resolve) { resolve(1); }).then(function(val) { called = val; });
      `);
      expect(env.get('called')).toBe(1);
    });
  });

  describe('.then() — reject', () => {
    it('should catch errors in handlers', () => {
      const { env } = run(`
        var caught = '';
        new Promise(function(resolve) { resolve(1); })
          .then(function() { throw 'err'; })
          .catch(function(e) { caught = e; });
      `);
      expect(env.get('caught')).toBe('err');
    });

    it('should propagate rejection to next catch', () => {
      const { env } = run(`
        var caught = '';
        new Promise(function(_, reject) { reject('bad'); })
          .then(function() { return 1; })
          .catch(function(e) { caught = e; });
      `);
      expect(env.get('caught')).toBe('bad');
    });
  });

  describe('.catch()', () => {
    it('should catch rejection', () => {
      const { env } = run(`
        var result = '';
        new Promise(function(_, reject) { reject('err'); })
          .catch(function(e) { result = e; });
      `);
      expect(env.get('result')).toBe('err');
    });

    it('should return a promise', () => {
      const { value } = run(`
        typeof new Promise(function(_, reject) { reject('err'); }).catch(function() {});
      `);
      expect(value).toBe('object');
    });
  });

  describe('.finally()', () => {
    it('should be called on fulfill', () => {
      const { env } = run(`
        var called = false;
        new Promise(function(resolve) { resolve(42); })
          .finally(function() { called = true; });
      `);
      expect(env.get('called')).toBe(true);
    });

    it('should be called on reject', () => {
      const { env } = run(`
        var called = false;
        new Promise(function(_, reject) { reject('err'); })
          .finally(function() { called = true; });
      `);
      expect(env.get('called')).toBe(true);
    });
  });

  describe('Promise.resolve()', () => {
    it('should wrap non-promise value', () => {
      const { value } = run(`
        typeof Promise.resolve(42);
      `);
      expect(value).toBe('object');
    });

    it('should return same promise if already a promise', () => {
      const { value } = run(`
        var p1 = new Promise(function(r) { r(1); });
        Promise.resolve(p1) === p1;
      `);
      expect(value).toBe(true);
    });
  });

  describe('Promise.reject()', () => {
    it('should create a rejected promise', () => {
      const { env } = run(`
        var caught = '';
        Promise.reject('err').catch(function(e) { caught = e; });
      `);
      expect(env.get('caught')).toBe('err');
    });
  });

  describe('Promise.all()', () => {
    it('should resolve when all promises fulfill', () => {
      const { env } = run(`
        var result = '';
        Promise.all([
          Promise.resolve(1),
          Promise.resolve(2),
          Promise.resolve(3),
        ]).then(function(vals) { result = vals.join(','); });
      `);
      expect(env.get('result')).toBe('1,2,3');
    });

    it('should reject if any promise rejects', () => {
      const { env } = run(`
        var caught = '';
        Promise.all([
          Promise.resolve(1),
          Promise.reject('bad'),
          Promise.resolve(3),
        ]).catch(function(e) { caught = e; });
      `);
      expect(env.get('caught')).toBe('bad');
    });

    it('should resolve empty array', () => {
      const { env } = run(`
        var result = '';
        Promise.all([]).then(function(vals) { result = vals.join(','); });
      `);
      expect(env.get('result')).toBe('');
    });

    it('should handle non-promise values', () => {
      const { env } = run(`
        var result = '';
        Promise.all([1, 2, 3]).then(function(vals) { result = vals.join(','); });
      `);
      expect(env.get('result')).toBe('1,2,3');
    });
  });

  describe('Promise.race()', () => {
    it('should resolve with first settled promise', () => {
      const { env } = run(`
        var result = 0;
        Promise.race([
          Promise.resolve(1),
          Promise.resolve(2),
        ]).then(function(val) { result = val; });
      `);
      expect(env.get('result')).toBe(1);
    });

    it('should reject with first rejected promise', () => {
      const { env } = run(`
        var caught = '';
        Promise.race([
          Promise.reject('err'),
          Promise.resolve(2),
        ]).catch(function(e) { caught = e; });
      `);
      expect(env.get('caught')).toBe('err');
    });
  });

  describe('Promise.allSettled()', () => {
    it('should return status objects', () => {
      const { env } = run(`
        var s1 = '';
        var s2 = '';
        Promise.allSettled([
          Promise.resolve(1),
          Promise.reject('err'),
        ]).then(function(vals) {
          s1 = vals[0].status;
          s2 = vals[1].status;
        });
      `);
      expect(env.get('s1')).toBe('fulfilled');
      expect(env.get('s2')).toBe('rejected');
    });
  });

  describe('microtask queue', () => {
    it('should drain microtasks after run()', () => {
      const { env } = run(`
        var log = '';
        Promise.resolve(1).then(function(v) { log = log + 'a'; });
        Promise.resolve(2).then(function(v) { log = log + 'b'; });
      `);
      expect(env.get('log')).toBe('ab');
    });

    it('should handle nested microtasks', () => {
      const { env } = run(`
        var log = '';
        Promise.resolve(1).then(function(v) {
          log = log + 'a';
          Promise.resolve(2).then(function() { log = log + 'c'; });
        });
        Promise.resolve(3).then(function(v) { log = log + 'b'; });
      `);
      expect(env.get('log')).toBe('abc');
    });

    it('should not crash on microtask errors', () => {
      const { env } = run(`
        var result = 0;
        Promise.resolve(1).then(function() { throw 'oops'; });
        Promise.resolve(2).then(function(v) { result = v; });
      `);
      expect(env.get('result')).toBe(2);
    });
  });

  describe('Promise chaining', () => {
    it('should support deep chains via variables', () => {
      const { env } = run(`
        var a = 0, b = 0, c = 0, d = 0;
        Promise.resolve(0)
          .then(function(v) { a = v + 1; return a; })
          .then(function(v) { b = v + 1; return b; })
          .then(function(v) { c = v + 1; return c; })
          .then(function(v) { d = v + 1; });
      `);
      expect(env.get('a')).toBe(1);
      expect(env.get('b')).toBe(2);
      expect(env.get('c')).toBe(3);
      expect(env.get('d')).toBe(4);
    });

    it('should propagate rejections through chains', () => {
      const { env } = run(`
        var result = '';
        Promise.resolve(1)
          .then(function() { throw 'err1'; })
          .then(function(v) { return v + 1; })
          .catch(function(e) { result = e; });
      `);
      expect(env.get('result')).toBe('err1');
    });

    it('should recover from rejection with catch', () => {
      const { env } = run(`
        var result = 0;
        Promise.reject('err')
          .catch(function() { return 42; })
          .then(function(v) { result = v; });
      `);
      expect(env.get('result')).toBe(42);
    });

    it('should handle promise return in then', () => {
      const { env } = run(`
        var result = 0;
        Promise.resolve(1).then(function() {
          return Promise.resolve(99);
        }).then(function(v) { result = v; });
      `);
      expect(env.get('result')).toBe(99);
    });
  });
});
