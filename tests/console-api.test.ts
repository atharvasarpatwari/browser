import { describe, it, expect } from 'vitest';
import { Interpreter } from '../src/browser/js/interpreter';
import { Environment } from '../src/browser/js/values';
import { EventLoop } from '../src/browser/js/event-loop';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { createConsoleObject, getConsoleLog, onConsoleMessage } from '../src/browser/js/console-api';

function createTestEnv() {
  const eventLoop = new EventLoop();
  const interp = new Interpreter(undefined, eventLoop);
  const env = (interp as any).globalEnv as Environment;
  const consoleObj = createConsoleObject();
  env.setLocal('console', consoleObj);
  return { interp, env, consoleObj };
}

function run(source: string, env: Environment, interp: Interpreter) {
  const lexer = new Lexer(source);
  const parser = new Parser([], lexer);
  const program = parser.parse();
  return interp.run(program);
}

describe('console (window.console + getConsoleLog)', () => {
  it('captures log/warn/error/info/debug with the right level, text, and a real timestamp', () => {
    const { interp, env, consoleObj } = createTestEnv();
    const before = Date.now();
    run(`
      console.log('hello');
      console.warn('careful');
      console.error('broken');
      console.info('fyi');
      console.debug('trace me');
    `, env, interp);
    const entries = getConsoleLog(consoleObj);
    expect(entries.map(e => e.level)).toEqual(['log', 'warn', 'error', 'info', 'debug']);
    expect(entries.map(e => e.text)).toEqual(['hello', 'careful', 'broken', 'fyi', 'trace me']);
    for (const e of entries) expect(e.timestamp).toBeGreaterThanOrEqual(before);
  });

  it('joins multiple arguments with a space, like a real console', () => {
    const { interp, env, consoleObj } = createTestEnv();
    run(`console.log('count:', 5, 'items');`, env, interp);
    expect(getConsoleLog(consoleObj)[0].text).toBe('count: 5 items');
  });

  it('formats arrays and objects readably, quoting nested strings but not top-level ones', () => {
    const { interp, env, consoleObj } = createTestEnv();
    run(`
      console.log('plain string');
      console.log([1, 'two', 3]);
      console.log({ a: 1, b: 'two' });
    `, env, interp);
    const [plain, arr, obj] = getConsoleLog(consoleObj);
    expect(plain.text).toBe('plain string');
    expect(arr.text).toBe("[ 1, 'two', 3 ]");
    expect(obj.text).toBe("{ a: 1, b: 'two' }");
  });

  it('does not infinite-loop on a circular object', () => {
    const { interp, env, consoleObj } = createTestEnv();
    run(`
      var o = { name: 'loopy' };
      o.self = o;
      console.log(o);
    `, env, interp);
    expect(getConsoleLog(consoleObj)[0].text).toBe("{ name: 'loopy', self: [Circular] }");
  });

  it('assert only logs (as an error) when the condition is falsy', () => {
    const { interp, env, consoleObj } = createTestEnv();
    run(`
      console.assert(true, 'should not appear');
      console.assert(false, 'this should appear');
    `, env, interp);
    const entries = getConsoleLog(consoleObj);
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('error');
    expect(entries[0].text).toBe('Assertion failed: this should appear');
  });

  it('clear() empties the log', () => {
    const { interp, env, consoleObj } = createTestEnv();
    run(`console.log('one'); console.log('two');`, env, interp);
    expect(getConsoleLog(consoleObj)).toHaveLength(2);
    run(`console.clear();`, env, interp);
    expect(getConsoleLog(consoleObj)).toHaveLength(0);
  });

  it('onConsoleMessage delivers new entries live, for a real-time DevTools panel', () => {
    const { interp, env, consoleObj } = createTestEnv();
    const seen: string[] = [];
    const unsubscribe = onConsoleMessage(consoleObj, (entry) => seen.push(entry.text));
    run(`console.log('first');`, env, interp);
    unsubscribe();
    run(`console.log('second — after unsubscribe');`, env, interp);
    expect(seen).toEqual(['first']);
  });
});
