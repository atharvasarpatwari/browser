import { describe, it } from 'vitest';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { Interpreter } from '../src/browser/js/interpreter';
import { Environment } from '../src/browser/js/values';

describe('trace', () => {
  it('trace var x = 42; x', () => {
    const source = 'var x = 42; x';
    const tokens = new Lexer(source).tokenize();
    const parser = new Parser(tokens);
    const program = parser.parse();
    console.log('AST body types:', program.body.map((s: any) => s.type));
    console.log('AST body:', JSON.stringify(program.body, null, 2));
    const env = new Environment(null);
    env.markFunctionScope();
    const interp = new Interpreter(env);
    const result = interp.run(program);
    console.log('Result:', result);
    console.log('Result type:', typeof result);
  });
});
