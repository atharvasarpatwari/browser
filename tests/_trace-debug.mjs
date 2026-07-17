import { Lexer } from '../src/browser/js/lexer.ts';
import { Parser } from '../src/browser/js/parser.ts';
import { Interpreter } from '../src/browser/js/interpreter.ts';
import { Environment } from '../src/browser/js/values.ts';

const source = 'var x = 42; x';
const tokens = new Lexer(source).tokenize();
console.log('Tokens:', tokens.map(t => `${t.type}:${t.value}`));
const parser = new Parser(tokens);
const program = parser.parse();
console.log('AST body:', JSON.stringify(program.body, null, 2));
const env = new Environment(null);
env.markFunctionScope();
const interp = new Interpreter(env);
const result = interp.run(program);
console.log('Result:', result);
