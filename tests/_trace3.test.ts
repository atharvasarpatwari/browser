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

function evalJSAst(source: string): unknown {
  const tokens = new Lexer(source).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  return program;
}

describe('trace3', () => {
  it('AST for obj', () => {
    const ast = evalJSAst('var o = {x: 1, y: 2}; o.x + o.y');
    console.log(JSON.stringify(ast.body[0], null, 2));
    console.log('---');
    console.log(JSON.stringify(ast.body[1], null, 2));
  });
  it('var o = {x:1}; o.x', () => {
    console.log('Result:', evalJS('var o = {x: 1}; o.x'));
  });
  it('var o = {}; o.x = 10; o.x', () => {
    console.log('Result:', evalJS('var o = {}; o.x = 10; o.x'));
  });
  it('{x: 1, y: 2}', () => {
    console.log('Result:', evalJS('{x: 1, y: 2}'));
  });
  it('function add', () => {
    const ast = evalJSAst('function add(a, b) { return a + b; } add(3, 4)');
    console.log('AST:', JSON.stringify(ast.body, null, 2));
  });
});
