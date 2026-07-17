import { describe, it } from 'vitest';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { Interpreter } from '../src/browser/js/interpreter';
import { Environment } from '../src/browser/js/values';

function evalJS(source: string): unknown {
  const tokens = new Lexer(source).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const e = new Environment(null);
  const interp = new Interpreter(e);
  return interp.run(program);
}

describe('trace2', () => {
  it('var o = {x:1,y:2}; o.x+o.y', () => {
    const result = evalJS('var o = {x: 1, y: 2}; o.x + o.y');
    console.log('Result:', result);
  });
  it('var x = 42; x', () => {
    const result = evalJS('var x = 42; x');
    console.log('Result:', result);
  });
  it('function add(a,b) { return a+b; } add(3,4)', () => {
    const result = evalJS('function add(a, b) { return a + b; } add(3, 4)');
    console.log('Result:', result);
  });
});
