import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { Interpreter } from '../src/browser/js/interpreter';
import { Environment } from '../src/browser/js/values';

function runAndDebug(source: string): unknown {
  const tokens = new Lexer(source).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const env = new Environment(null);
  env.markFunctionScope();
  const interp = new Interpreter(env);
  return interp.run(program);
}

describe('debug', () => {
  it('simple expression', () => {
    expect(runAndDebug('42')).toBe(42);
  });
  it('var decl in function scope env', () => {
    expect(runAndDebug('var x = 42')).toBe(undefined);
  });
  it('var x = 42; x - function scope env', () => {
    expect(runAndDebug('var x = 42; x')).toBe(42);
  });
  it('object literal access', () => {
    expect(runAndDebug('var o = {a: 1}; o.a')).toBe(1);
  });
  it('function call', () => {
    expect(runAndDebug('function f() { return 99; } f()')).toBe(99);
  });
});
