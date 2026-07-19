import { describe, it, expect, beforeEach } from 'vitest';
import { Lexer } from '../src/browser/js/lexer';
import { TokenType, type Token, tokenTypeName } from '../src/browser/js/tokens';
import { Parser } from '../src/browser/js/parser';
import { Interpreter } from '../src/browser/js/interpreter';
import { Environment, createObject, createNativeFunction, type JSValue, type JSObject, type JSFunction, callJSFunction, setGlobalCaller } from '../src/browser/js/values';
import { EventLoop, bindTimers } from '../src/browser/js/event-loop';
import { createDocumentBinding, wrapElement, createEventObject } from '../src/browser/js/dom-bindings';
import { runJS, createGlobalEnv } from '../src/browser/js/index';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';

function evalJS(source: string, env?: Environment): JSValue {
  const tokens = new Lexer(source).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const interp = new Interpreter(env);
  return interp.run(program);
}

function evalJSWithEnv(source: string): { value: JSValue; env: Environment } {
  const env = new Environment(null);
  const tokens = new Lexer(source).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const interp = new Interpreter(env);
  const value = interp.run(program);
  return { value, env };
}

describe('Lexer', () => {
  it('should tokenize keywords as Identifier tokens with keyword values', () => {
    const tokens = new Lexer('var x = 1').tokenize();
    const meaningful = tokens.filter(t => t.type !== TokenType.Whitespace && t.type !== TokenType.Newline && t.type !== TokenType.EOF);
    expect(meaningful[0].type).toBe(TokenType.Var);
    expect(meaningful[0].value).toBe('var');
  });

  it('should tokenize numbers', () => {
    const tokens = new Lexer('42 3.14').tokenize();
    const nums = tokens.filter(t => t.type === TokenType.Number);
    expect(nums.length).toBe(2);
    expect(nums[0].value).toBe('42');
    expect(nums[1].value).toBe('3.14');
  });

  it('should tokenize strings', () => {
    const tokens = new Lexer('"hello" \'world\'').tokenize();
    const strs = tokens.filter(t => t.type === TokenType.String);
    expect(strs.length).toBe(2);
  });

  it('should handle comments as whitespace', () => {
    const tokens = new Lexer('42 /* block */ 7').tokenize();
    const meaningful = tokens.filter(t =>
      t.type !== TokenType.Whitespace && t.type !== TokenType.Newline && t.type !== TokenType.EOF
    );
    expect(meaningful.length).toBe(2);
    expect(meaningful[0].type).toBe(TokenType.Number);
    expect(meaningful[1].type).toBe(TokenType.Number);
  });

  it('should tokenize braces', () => {
    const tokens = new Lexer('{}').tokenize();
    const meaningful = tokens.filter(t =>
      t.type !== TokenType.Whitespace && t.type !== TokenType.Newline && t.type !== TokenType.EOF
    );
    expect(meaningful[0].type).toBe(TokenType.LBrace);
    expect(meaningful[1].type).toBe(TokenType.RBrace);
  });

  it('should tokenize spread operator', () => {
    const tokens = new Lexer('...x').tokenize();
    const meaningful = tokens.filter(t =>
      t.type !== TokenType.Whitespace && t.type !== TokenType.Newline && t.type !== TokenType.EOF
    );
    expect(meaningful[0].type).toBe(TokenType.Ellipsis);
  });

  it('should tokenize arrow function', () => {
    const tokens = new Lexer('() => 42').tokenize();
    const meaningful = tokens.filter(t =>
      t.type !== TokenType.Whitespace && t.type !== TokenType.Newline && t.type !== TokenType.EOF
    );
    expect(meaningful[2].type).toBe(TokenType.Arrow);
  });

  it('should tokenize operators', () => {
    const tokens = new Lexer('+ - * % ** ++ -- === !==').tokenize();
    const meaningful = tokens.filter(t =>
      t.type !== TokenType.Whitespace && t.type !== TokenType.Newline && t.type !== TokenType.EOF
    );
    expect(meaningful[0].type).toBe(TokenType.Plus);
    expect(meaningful[1].type).toBe(TokenType.Minus);
    expect(meaningful[2].type).toBe(TokenType.Star);
    expect(meaningful[3].type).toBe(TokenType.Percent);
    expect(meaningful[4].type).toBe(TokenType.StarStar);
    expect(meaningful[5].type).toBe(TokenType.PlusPlus);
    expect(meaningful[6].type).toBe(TokenType.MinusMinus);
    expect(meaningful[7].type).toBe(TokenType.EqualEqualEqual);
    expect(meaningful[8].type).toBe(TokenType.BangEqualEqual);
  });

  it('should tokenize slash as division after expression tokens', () => {
    const tokens = new Lexer('x / y').tokenize();
    const meaningful = tokens.filter(t =>
      t.type !== TokenType.Whitespace && t.type !== TokenType.Newline && t.type !== TokenType.EOF
    );
    expect(meaningful[0].type).toBe(TokenType.Identifier);
    expect(meaningful[1].type).toBe(TokenType.Slash);
    expect(meaningful[2].type).toBe(TokenType.Identifier);
  });

  it('should tokenize regex literals', () => {
    const tokens = new Lexer('/abc/gi').tokenize();
    const meaningful = tokens.filter(t =>
      t.type !== TokenType.Whitespace && t.type !== TokenType.Newline && t.type !== TokenType.EOF
    );
    expect(meaningful[0].type).toBe(TokenType.RegExp);
    expect(meaningful[0].value).toBe('/abc/gi');
  });

  it('should tokenize regex after keyword', () => {
    const tokens = new Lexer('return /test/').tokenize();
    const meaningful = tokens.filter(t =>
      t.type !== TokenType.Whitespace && t.type !== TokenType.Newline && t.type !== TokenType.EOF
    );
    expect(meaningful[0].type).toBe(TokenType.Return);
    expect(meaningful[1].type).toBe(TokenType.RegExp);
    expect(meaningful[1].value).toBe('/test/');
  });

  it('should tokenize regex after assignment', () => {
    const tokens = new Lexer('x = /pattern/g').tokenize();
    const meaningful = tokens.filter(t =>
      t.type !== TokenType.Whitespace && t.type !== TokenType.Newline && t.type !== TokenType.EOF
    );
    expect(meaningful[0].type).toBe(TokenType.Identifier);
    expect(meaningful[1].type).toBe(TokenType.Equal);
    expect(meaningful[2].type).toBe(TokenType.RegExp);
    expect(meaningful[2].value).toBe('/pattern/g');
  });

  it('should tokenize regex with character class', () => {
    const tokens = new Lexer('/[a-z]+/').tokenize();
    const meaningful = tokens.filter(t =>
      t.type !== TokenType.Whitespace && t.type !== TokenType.Newline && t.type !== TokenType.EOF
    );
    expect(meaningful[0].type).toBe(TokenType.RegExp);
    expect(meaningful[0].value).toBe('/[a-z]+/');
  });

  it('should tokenize semicolons', () => {
    const tokens = new Lexer(';').tokenize();
    const meaningful = tokens.filter(t =>
      t.type !== TokenType.Whitespace && t.type !== TokenType.Newline && t.type !== TokenType.EOF
    );
    expect(meaningful[0].type).toBe(TokenType.Semicolon);
  });
});

describe('Lexer - Template Literals', () => {
  it('should tokenize simple template literal (no expressions)', () => {
    const tokens = new Lexer('`hello world`').tokenize();
    const meaningful = tokens.filter(t => t.type !== TokenType.Whitespace && t.type !== TokenType.EOF);
    expect(meaningful[0].type).toBe(TokenType.TemplateEnd);
    expect(meaningful[0].value).toBe('hello world');
  });

  it('should tokenize template literal with one expression', () => {
    const tokens = new Lexer('`hello ${name}`').tokenize();
    const meaningful = tokens.filter(t => t.type !== TokenType.Whitespace && t.type !== TokenType.EOF);
    expect(meaningful[0].type).toBe(TokenType.TemplateHead);
    expect(meaningful[0].value).toBe('hello ');
    expect(meaningful[1].type).toBe(TokenType.Identifier);
    expect(meaningful[1].value).toBe('name');
    expect(meaningful[2].type).toBe(TokenType.TemplateTail);
    expect(meaningful[2].value).toBe('');
  });

  it('should tokenize template literal with multiple expressions', () => {
    const tokens = new Lexer('`${a} and ${b}`').tokenize();
    const meaningful = tokens.filter(t => t.type !== TokenType.Whitespace && t.type !== TokenType.EOF);
    expect(meaningful[0].type).toBe(TokenType.TemplateHead);
    expect(meaningful[0].value).toBe('');
    expect(meaningful[1].type).toBe(TokenType.Identifier);
    expect(meaningful[1].value).toBe('a');
    expect(meaningful[2].type).toBe(TokenType.TemplateMiddle);
    expect(meaningful[2].value).toBe(' and ');
    expect(meaningful[3].type).toBe(TokenType.Identifier);
    expect(meaningful[3].value).toBe('b');
    expect(meaningful[4].type).toBe(TokenType.TemplateTail);
    expect(meaningful[4].value).toBe('');
  });
});

describe('Parser - Template Literals', () => {
  it('should parse simple template literal', () => {
    const lexer = new Lexer('`hello`');
    const parser = new Parser([], lexer);
    const program = parser.parse();
    expect(program.body.length).toBe(1);
    const expr = (program.body[0] as any).expression;
    expect(expr.type).toBe('TemplateLiteral');
    expect(expr.quasis.length).toBe(1);
    expect(expr.quasis[0].value).toBe('hello');
    expect(expr.expressions.length).toBe(0);
  });

  it('should parse template literal with expression', () => {
    const lexer = new Lexer('`hello ${name}`');
    const parser = new Parser([], lexer);
    const program = parser.parse();
    const expr = (program.body[0] as any).expression;
    expect(expr.type).toBe('TemplateLiteral');
    expect(expr.quasis.length).toBe(2);
    expect(expr.quasis[0].value).toBe('hello ');
    expect(expr.quasis[1].value).toBe('');
    expect(expr.expressions.length).toBe(1);
    expect(expr.expressions[0].type).toBe('Identifier');
    expect(expr.expressions[0].name).toBe('name');
  });

  it('should parse template literal with multiple expressions', () => {
    const lexer = new Lexer('`${a} and ${b}`');
    const parser = new Parser([], lexer);
    const program = parser.parse();
    const expr = (program.body[0] as any).expression;
    expect(expr.quasis.length).toBe(3);
    expect(expr.quasis[0].value).toBe('');
    expect(expr.quasis[1].value).toBe(' and ');
    expect(expr.quasis[2].value).toBe('');
    expect(expr.expressions.length).toBe(2);
  });

  it('should parse template with complex expressions', () => {
    const lexer = new Lexer('`${a + b}`');
    const parser = new Parser([], lexer);
    const program = parser.parse();
    const expr = (program.body[0] as any).expression;
    expect(expr.expressions[0].type).toBe('BinaryExpression');
    expect(expr.expressions[0].operator).toBe('+');
  });
});

describe('Parser', () => {
  it('should parse variable declarations', () => {
    const tokens = new Lexer('var x = 42;').tokenize();
    const program = new Parser(tokens).parse();
    expect(program.body.length).toBe(1);
    expect(program.body[0].type).toBe('VariableDeclaration');
  });

  it('should parse function declarations', () => {
    const tokens = new Lexer('function add(a, b) { return a + b; }').tokenize();
    const program = new Parser(tokens).parse();
    expect(program.body.length).toBe(1);
    expect(program.body[0].type).toBe('FunctionDeclaration');
  });

  it('should parse if statements', () => {
    const tokens = new Lexer('if (true) { x = 1; } else { x = 2; }').tokenize();
    const program = new Parser(tokens).parse();
    expect(program.body[0].type).toBe('IfStatement');
  });

  it('should parse while loops', () => {
    const tokens = new Lexer('while (false) { break; }').tokenize();
    const program = new Parser(tokens).parse();
    expect(program.body[0].type).toBe('WhileStatement');
  });

  it('should parse for loops', () => {
    const tokens = new Lexer('for (var i = 0; i < 10; i++) { continue; }').tokenize();
    const program = new Parser(tokens).parse();
    expect(program.body[0].type).toBe('ForStatement');
  });

  it('should parse arrow functions', () => {
    const tokens = new Lexer('var f = (x) => x * 2;').tokenize();
    const program = new Parser(tokens).parse();
    expect(program.body[0].type).toBe('VariableDeclaration');
  });

  it('should parse class declarations', () => {
    const tokens = new Lexer('class Foo { constructor() { this.x = 1; } bar() { return this.x; } }').tokenize();
    const program = new Parser(tokens).parse();
    expect(program.body[0].type).toBe('ClassDeclaration');
  });

  it('should parse try/catch/finally', () => {
    const tokens = new Lexer('try { x(); } catch (e) { } finally { }').tokenize();
    const program = new Parser(tokens).parse();
    expect(program.body[0].type).toBe('TryStatement');
  });

  it('should parse switch/case', () => {
    const tokens = new Lexer('switch (x) { case 1: break; default: break; }').tokenize();
    const program = new Parser(tokens).parse();
    expect(program.body[0].type).toBe('SwitchStatement');
  });

  it('should parse object literals', () => {
    const tokens = new Lexer('var obj = { a: 1, b: "two" };').tokenize();
    const program = new Parser(tokens).parse();
    expect(program.body[0].type).toBe('VariableDeclaration');
  });

  it('should parse array literals', () => {
    const tokens = new Lexer('var arr = [1, 2, 3];').tokenize();
    const program = new Parser(tokens).parse();
    expect(program.body[0].type).toBe('VariableDeclaration');
  });
});

describe('Interpreter — expressions', () => {
  it('should evaluate number literals', () => {
    expect(evalJS('42')).toBe(42);
    expect(evalJS('3.14')).toBe(3.14);
  });

  it('should evaluate string literals', () => {
    expect(evalJS('"hello"')).toBe('hello');
    expect(evalJS("'world'")).toBe('world');
  });

  it('should evaluate boolean literals', () => {
    expect(evalJS('true')).toBe(true);
    expect(evalJS('false')).toBe(false);
  });

  it('should evaluate null and undefined', () => {
    expect(evalJS('null')).toBe(null);
    expect(evalJS('undefined')).toBe(undefined);
  });

  it('should evaluate arithmetic', () => {
    expect(evalJS('2 + 3')).toBe(5);
    expect(evalJS('10 - 4')).toBe(6);
    expect(evalJS('3 * 7')).toBe(21);
    expect(evalJS('10 / 3')).toBeCloseTo(3.333, 2);
    expect(evalJS('10 % 3')).toBe(1);
    expect(evalJS('2 ** 10')).toBe(1024);
  });

  it('should evaluate comparison', () => {
    expect(evalJS('5 > 3')).toBe(true);
    expect(evalJS('3 > 5')).toBe(false);
    expect(evalJS('5 < 3')).toBe(false);
    expect(evalJS('5 === 5')).toBe(true);
    expect(evalJS('5 === "5"')).toBe(false);
    expect(evalJS('5 == "5"')).toBe(true);
    expect(evalJS('5 !== 5')).toBe(false);
  });

  it('should evaluate logical operators', () => {
    expect(evalJS('true && true')).toBe(true);
    expect(evalJS('true && false')).toBe(false);
    expect(evalJS('false || true')).toBe(true);
    expect(evalJS('false || false')).toBe(false);
    expect(evalJS('!true')).toBe(false);
    expect(evalJS('!0')).toBe(true);
  });

  it('should evaluate ternary operator', () => {
    expect(evalJS('true ? 1 : 2')).toBe(1);
    expect(evalJS('false ? 1 : 2')).toBe(2);
  });

  it('should evaluate member access', () => {
    expect(evalJS('var o = {a: 1}; o.a')).toBe(1);
    expect(evalJS('var o = {b: {c: 2}}; o.b.c')).toBe(2);
  });

  it('should evaluate computed member access', () => {
    expect(evalJS('var arr = [10, 20, 30]; arr[1]')).toBe(20);
  });

  it('should evaluate function calls', () => {
    expect(evalJS('var add = function(a, b) { return a + b; }; add(3, 4)')).toBe(7);
  });

  it('should evaluate unary operators', () => {
    expect(evalJS('var x = 5; -x')).toBe(-5);
    expect(evalJS('typeof 42')).toBe('number');
    expect(evalJS('typeof "hi"')).toBe('string');
    expect(evalJS('typeof undefined')).toBe('undefined');
    expect(evalJS('typeof null')).toBe('object');
  });

  it('should evaluate update expressions', () => {
    expect(evalJS('var x = 0; x++; x')).toBe(1);
    expect(evalJS('var x = 0; ++x')).toBe(1);
    expect(evalJS('var x = 5; x--; x')).toBe(4);
  });

  it('should evaluate assignment operators', () => {
    expect(evalJS('var x = 10; x += 5; x')).toBe(15);
    expect(evalJS('var x = 10; x -= 3; x')).toBe(7);
    expect(evalJS('var x = 10; x *= 2; x')).toBe(20);
    expect(evalJS('var x = 10; x /= 4; x')).toBe(2.5);
    expect(evalJS('var x = 10; x %= 3; x')).toBe(1);
  });

  it('should evaluate destructuring', () => {
    expect(evalJS('var [a, b] = [1, 2]; a + b')).toBe(3);
    expect(evalJS('var {x, y} = {x: 10, y: 20}; x + y')).toBe(30);
  });
});

describe('Interpreter — statements', () => {
  it('should handle var declarations', () => {
    const { value } = evalJSWithEnv('var x = 10; x');
    expect(value).toBe(10);
  });

  it('should handle let declarations', () => {
    expect(evalJS('let x = 5; x')).toBe(5);
  });

  it('should handle const declarations', () => {
    expect(evalJS('const x = 99; x')).toBe(99);
  });

  it('should handle if/else', () => {
    expect(evalJS('var x = 0; if (true) { x = 1; } else { x = 2; } x')).toBe(1);
    expect(evalJS('var x = 0; if (false) { x = 1; } else { x = 2; } x')).toBe(2);
    expect(evalJS('var x = 0; if (false) { x = 1; } x')).toBe(0);
  });

  it('should handle while loops', () => {
    expect(evalJS('var i = 0; var s = 0; while (i < 5) { s += i; i++; } s')).toBe(10);
  });

  it('should handle do-while loops', () => {
    expect(evalJS('var i = 0; do { i++; } while (i < 5); i')).toBe(5);
  });

  it('should handle for loops', () => {
    expect(evalJS('var s = 0; for (var i = 0; i < 5; i++) { s += i; } s')).toBe(10);
  });

  it('should handle for-in loops', () => {
    expect(evalJS('var o = {a: 1, b: 2}; var keys = []; for (var k in o) { keys.push(k); } keys.join(",")')).toBe('a,b');
  });

  it('should handle for-of loops', () => {
    expect(evalJS('var arr = [10, 20, 30]; var s = 0; for (var x of arr) { s += x; } s')).toBe(60);
  });

  it('should handle break and continue', () => {
    expect(evalJS('var i = 0; while (true) { if (i === 3) break; i++; } i')).toBe(3);
    expect(evalJS('var s = 0; for (var i = 0; i < 10; i++) { if (i % 2 === 0) continue; s += i; } s')).toBe(25);
  });

  it('should handle switch/case', () => {
    expect(evalJS('var x = 2; var r = 0; switch (x) { case 1: r = 10; break; case 2: r = 20; break; case 3: r = 30; break; } r')).toBe(20);
  });

  it('should handle try/catch', () => {
    expect(evalJS('var r = 0; try { throw 42; } catch (e) { r = e; } r')).toBe(42);
  });

  it('should handle try/finally', () => {
    expect(evalJS('var r = 0; try { r = 1; } finally { r = 2; } r')).toBe(2);
  });

  it('should handle throw', () => {
    expect(() => evalJS('throw "error"')).toThrow();
  });
});

describe('Interpreter — functions', () => {
  it('should declare and call named functions', () => {
    expect(evalJS('function add(a, b) { return a + b; } add(3, 4)')).toBe(7);
  });

  it('should handle function expressions', () => {
    expect(evalJS('var f = function(x) { return x * x; }; f(5)')).toBe(25);
  });

  it('should handle arrow functions', () => {
    expect(evalJS('var f = (x) => x + 1; f(9)')).toBe(10);
    expect(evalJS('var f = (a, b) => a * b; f(3, 4)')).toBe(12);
  });

  it('should handle closures', () => {
    expect(evalJS(`
      function makeCounter() {
        var count = 0;
        return function() { count++; return count; };
      }
      var c = makeCounter();
      c(); c(); c();
    `)).toBe(3);
  });

  it('should handle nested function calls', () => {
    expect(evalJS(`
      function double(x) { return x * 2; }
      function triple(x) { return x * 3; }
      double(triple(5))
    `)).toBe(30);
  });

  it('should handle recursive functions', () => {
    expect(evalJS(`
      function factorial(n) {
        if (n <= 1) return 1;
        return n * factorial(n - 1);
      }
      factorial(5)
    `)).toBe(120);
  });

  it('should handle higher-order functions', () => {
    expect(evalJS(`
      function apply(f, x) { return f(x); }
      apply(function(x) { return x + 10; }, 5)
    `)).toBe(15);
  });

  it('should handle IIFE', () => {
    expect(evalJS('(function() { return 42; })()')).toBe(42);
  });
});

describe('Interpreter — objects', () => {
  it('should create and access objects', () => {
    expect(evalJS('var o = {x: 1, y: 2}; o.x + o.y')).toBe(3);
  });

  it('should set properties', () => {
    expect(evalJS('var o = {}; o.x = 10; o.x')).toBe(10);
  });

  it('should handle nested objects', () => {
    expect(evalJS('var o = {a: {b: {c: 42}}}; o.a.b.c')).toBe(42);
  });

  it('should handle computed property access', () => {
    expect(evalJS('var o = {foo: 1}; var k = "foo"; o[k]')).toBe(1);
  });

  it('should handle spread in objects', () => {
    expect(evalJS('var a = {x: 1}; var b = {...a, y: 2}; b.x + b.y')).toBe(3);
  });
});

describe('Interpreter — arrays', () => {
  it('should create and access arrays', () => {
    expect(evalJS('var a = [10, 20, 30]; a[1]')).toBe(20);
  });

  it('should handle array length', () => {
    expect(evalJS('[1, 2, 3].length')).toBe(3);
  });

  it('should handle push', () => {
    expect(evalJS('var a = [1, 2]; a.push(3); a.length')).toBe(3);
  });

  it('should handle pop', () => {
    expect(evalJS('var a = [1, 2, 3]; a.pop()')).toBe(3);
  });

  it('should handle map', () => {
    expect(evalJS('[1, 2, 3].map(function(x) { return x * 2; }).join(",")')).toBe('2,4,6');
  });

  it('should handle filter', () => {
    expect(evalJS('[1, 2, 3, 4, 5].filter(function(x) { return x > 3; }).join(",")')).toBe('4,5');
  });

  it('should handle reduce', () => {
    expect(evalJS('[1, 2, 3, 4].reduce(function(acc, x) { return acc + x; }, 0)')).toBe(10);
  });

  it('should handle find', () => {
    expect(evalJS('[1, 2, 3, 4].find(function(x) { return x > 2; })')).toBe(3);
  });

  it('should handle indexOf', () => {
    expect(evalJS('[10, 20, 30].indexOf(20)')).toBe(1);
  });

  it('should handle includes', () => {
    expect(evalJS('[1, 2, 3].includes(2)')).toBe(true);
    expect(evalJS('[1, 2, 3].includes(4)')).toBe(false);
  });

  it('should handle join', () => {
    expect(evalJS('["a", "b", "c"].join("-")')).toBe('a-b-c');
  });

  it('should handle slice', () => {
    expect(evalJS('[1, 2, 3, 4, 5].slice(1, 3).join(",")')).toBe('2,3');
  });

  it('should handle concat', () => {
    expect(evalJS('[1, 2].concat([3, 4]).join(",")')).toBe('1,2,3,4');
  });

  it('should handle reverse', () => {
    expect(evalJS('[1, 2, 3].reverse().join(",")')).toBe('3,2,1');
  });

  it('should handle sort', () => {
    expect(evalJS('[3, 1, 2].sort().join(",")')).toBe('1,2,3');
  });
});

describe('Interpreter — classes', () => {
  it('should create and use classes', () => {
    expect(evalJS(`
      class Dog {
        constructor(name) { this.name = name; }
        bark() { return this.name + " says woof"; }
      }
      var d = new Dog("Rex");
      d.bark()
    `)).toBe('Rex says woof');
  });

  it('should handle class inheritance', () => {
    expect(evalJS(`
      class Animal {
        constructor(name) { this.name = name; }
        speak() { return this.name + " speaks"; }
      }
      class Cat extends Animal {
        speak() { return this.name + " meows"; }
      }
      var c = new Cat("Whiskers");
      c.speak()
    `)).toBe('Whiskers meows');
  });

  it('should handle super calls', () => {
    expect(evalJS(`
      class Base {
        constructor(x) { this.x = x; }
        getX() { return this.x; }
      }
      class Derived extends Base {
        constructor(x, y) { super(x); this.y = y; }
      }
      var d = new Derived(10, 20);
      d.x + d.y
    `)).toBe(30);
  });
});

describe('Interpreter — built-in functions', () => {
  it('should handle parseInt', () => {
    expect(evalJS('parseInt("42")')).toBe(42);
    expect(evalJS('parseInt("ff", 16)')).toBe(255);
  });

  it('should handle parseFloat', () => {
    expect(evalJS('parseFloat("3.14")')).toBe(3.14);
  });

  it('should handle isNaN', () => {
    expect(evalJS('isNaN(NaN)')).toBe(true);
    expect(evalJS('isNaN(42)')).toBe(false);
  });

  it('should handle Math functions', () => {
    expect(evalJS('Math.floor(3.7)')).toBe(3);
    expect(evalJS('Math.ceil(3.2)')).toBe(4);
    expect(evalJS('Math.round(3.5)')).toBe(4);
    expect(evalJS('Math.abs(-5)')).toBe(5);
    expect(evalJS('Math.max(1, 2, 3)')).toBe(3);
    expect(evalJS('Math.min(1, 2, 3)')).toBe(1);
    expect(evalJS('Math.sqrt(16)')).toBe(4);
    expect(evalJS('Math.pow(2, 10)')).toBe(1024);
  });

  it('should handle String methods', () => {
    expect(evalJS('"hello".length')).toBe(5);
    expect(evalJS('"hello".toUpperCase()')).toBe('HELLO');
    expect(evalJS('"HELLO".toLowerCase()')).toBe('hello');
    expect(evalJS('"hello world".split(" ").join("-")')).toBe('hello-world');
    expect(evalJS('"hello".indexOf("ell")')).toBe(1);
    expect(evalJS('"hello".slice(1, 3)')).toBe('el');
    expect(evalJS('"hello".replace("l", "r")')).toBe('herlo');
    expect(evalJS('"  hello  ".trim()')).toBe('hello');
    expect(evalJS('"hello".includes("ell")')).toBe(true);
    expect(evalJS('"hello".startsWith("he")')).toBe(true);
    expect(evalJS('"hello".endsWith("lo")')).toBe(true);
  });

  it('should handle JSON', () => {
    expect(evalJS('JSON.parse("{\\"x\\": 1}").x')).toBe(1);
    expect(evalJS('JSON.stringify({a: 1, b: 2})')).toBe('{"a":1,"b":2}');
  });

  it('should handle encodeURI/decodeURI', () => {
    expect(evalJS('encodeURI("hello world")')).toBe('hello%20world');
    expect(evalJS('decodeURI("hello%20world")')).toBe('hello world');
  });
});

describe('Interpreter — scope and closures', () => {
  it('should handle variable scoping', () => {
    expect(evalJS('var x = 1; function f() { var x = 2; } f(); x')).toBe(1);
  });

  it('should handle closures capturing outer scope', () => {
    expect(evalJS(`
      function makeAdder(n) {
        return function(x) { return x + n; };
      }
      var add5 = makeAdder(5);
      add5(3)
    `)).toBe(8);
  });

  it('should handle nested closures', () => {
    expect(evalJS(`
      function outer() {
        var a = 1;
        function middle() {
          var b = 2;
          function inner() {
            return a + b;
          }
          return inner();
        }
        return middle();
      }
      outer()
    `)).toBe(3);
  });

  it('should handle var hoisting', () => {
    expect(evalJS('f(); function f() { return 42; }')).toBe(42);
  });
});

describe('Interpreter — miscellaneous', () => {
  it('should handle typeof', () => {
    expect(evalJS('typeof 42')).toBe('number');
    expect(evalJS('typeof "hi"')).toBe('string');
    expect(evalJS('typeof true')).toBe('boolean');
    expect(evalJS('typeof null')).toBe('object');
    expect(evalJS('typeof undefined')).toBe('undefined');
  });

  it('should handle instanceof', () => {
    expect(evalJS('[] instanceof Array')).toBe(true);
    expect(evalJS('42 instanceof Array')).toBe(false);
  });
});

describe('EventLoop', () => {
  let loop: EventLoop;

  beforeEach(() => {
    loop = new EventLoop();
  });

  it('should schedule and run a task', () => {
    let result = 0;
    loop.schedule(() => { result = 42; }, 0);
    loop.runOnce();
    expect(result).toBe(42);
  });

  it('should not run a task before its delay', () => {
    let result = 0;
    loop.schedule(() => { result = 42; }, 10000);
    loop.runOnce(Date.now());
    expect(result).toBe(0);
  });

  it('should run a recurring task', () => {
    let count = 0;
    loop.schedule(() => { count++; }, 0, true);
    loop.runOnce(Date.now());
    loop.runOnce(Date.now());
    loop.runOnce(Date.now());
    expect(count).toBe(3);
    expect(loop.pendingCount).toBe(1);
  });

  it('should clear a timer', () => {
    let called = false;
    const id = loop.schedule(() => { called = true; }, 0);
    loop.clearTimer(id);
    loop.runOnce();
    expect(called).toBe(false);
  });

  it('should handle requestAnimationFrame', () => {
    let called = false;
    loop.requestAnimationFrame(() => { called = true; });
    loop.runOnce();
    expect(called).toBe(true);
  });
});

describe('runJS', () => {
  function makeMinimalDoc() {
    return {
      domId: 'doc-1', nodeType: 'document' as const, parent: null,
      children: [], htmlElement: null, headElement: null, bodyElement: null,
    };
  }
  function makeMinimalDomTree(doc: any) {
    return {
      buildFromHtml: () => doc, getNodeById: () => null, getElementById: () => null,
      getElementsByTagName: () => [], querySelector: () => null, querySelectorAll: () => [],
      insertBefore: () => {}, appendChild: () => {}, removeChild: () => {},
      setAttribute: () => {}, removeAttribute: () => {}, setTextContent: () => {},
      setComputedStyle: () => {}, setLayoutBox: () => {}, getMutations: () => [],
      clearMutations: () => {}, getDocument: () => doc, dispose: () => {},
    };
  }

  it('should run simple JS and return value', () => {
    const doc = makeMinimalDoc();
    const result = runJS('2 + 3', { document: doc, domTree: makeMinimalDomTree(doc) as any });
    expect(result.value).toBe(5);
    expect(result.error).toBeUndefined();
  });

  it('should return error for syntax errors', () => {
    const doc = makeMinimalDoc();
    const result = runJS('function {', { document: doc, domTree: makeMinimalDomTree(doc) as any });
    expect(result.error).toBeTruthy();
  });

  it('should have access to Math', () => {
    const doc = makeMinimalDoc();
    const result = runJS('Math.PI', { document: doc, domTree: makeMinimalDomTree(doc) as any });
    expect(result.value).toBeCloseTo(Math.PI);
  });

  it('should have access to JSON', () => {
    const doc = makeMinimalDoc();
    const result = runJS('JSON.stringify({a: 1})', { document: doc, domTree: makeMinimalDomTree(doc) as any });
    expect(result.value).toBe('{"a":1}');
  });

  it('should handle complex programs', () => {
    const doc = makeMinimalDoc();
    const result = runJS(`
      function fibonacci(n) {
        if (n <= 1) return n;
        return fibonacci(n - 1) + fibonacci(n - 2);
      }
      fibonacci(10)
    `, { document: doc, domTree: makeMinimalDomTree(doc) as any });
    expect(result.value).toBe(55);
  });

  it('should handle setTimeout', () => {
    const doc = makeMinimalDoc();
    const eventLoop = new EventLoop();
    const result = runJS('var id = setTimeout(function() { }, 100); id', {
      document: doc, domTree: makeMinimalDomTree(doc) as any, eventLoop,
    });
    expect(result.error).toBeUndefined();
    expect(typeof result.value).toBe('number');
  });

  it('should evaluate simple template literal', () => {
    const doc = makeMinimalDoc();
    const result = runJS('`hello world`', { document: doc, domTree: makeMinimalDomTree(doc) as any });
    expect(result.value).toBe('hello world');
    expect(result.error).toBeUndefined();
  });

  it('should evaluate template literal with expression', () => {
    const doc = makeMinimalDoc();
    const result = runJS('var name = "Nova"; `hello ${name}`', { document: doc, domTree: makeMinimalDomTree(doc) as any });
    expect(result.value).toBe('hello Nova');
    expect(result.error).toBeUndefined();
  });

  it('should evaluate template literal with arithmetic', () => {
    const doc = makeMinimalDoc();
    const result = runJS('`2 + 3 = ${2 + 3}`', { document: doc, domTree: makeMinimalDomTree(doc) as any });
    expect(result.value).toBe('2 + 3 = 5');
    expect(result.error).toBeUndefined();
  });

  it('should evaluate template literal with multiple expressions', () => {
    const doc = makeMinimalDoc();
    const result = runJS('var a = "A"; var b = "B"; `${a} and ${b}`', { document: doc, domTree: makeMinimalDomTree(doc) as any });
    expect(result.value).toBe('A and B');
    expect(result.error).toBeUndefined();
  });

  it('should evaluate empty template literal', () => {
    const doc = makeMinimalDoc();
    const result = runJS('``', { document: doc, domTree: makeMinimalDomTree(doc) as any });
    expect(result.value).toBe('');
    expect(result.error).toBeUndefined();
  });
});

describe('callJSFunction', () => {
  it('should call native functions directly', () => {
    const fn = createNativeFunction('test', (_this, args) => {
      return (args[0] as number) + (args[1] as number);
    });
    const result = callJSFunction(fn, undefined, [3, 4]);
    expect(result).toBe(7);
  });

  it('should call non-native functions via interpreter', () => {
    const env = new Environment(null);
    const interp = new Interpreter(env);
    interp.run(new Parser(new Lexer('function add(a, b) { return a + b; }').tokenize()).parse());
    const fn = env.get('add') as JSFunction;
    setGlobalCaller(interp);
    const result = callJSFunction(fn, undefined, [3, 4]);
    setGlobalCaller(null);
    expect(result).toBe(7);
  });
});

describe('createEventObject', () => {
  it('should create an event object with type and target', () => {
    const target = createObject(null);
    const evt = createEventObject('click', target);
    expect(evt.properties.get('type')?.value).toBe('click');
    expect(evt.properties.get('target')?.value).toBe(target);
    expect(evt.properties.get('preventDefault')).toBeTruthy();
    expect(evt.properties.get('stopPropagation')).toBeTruthy();
  });

  it('should include bubbles and cancelable options', () => {
    const target = createObject(null);
    const evt = createEventObject('click', target, { bubbles: true, cancelable: true });
    expect(evt.properties.get('bubbles')?.value).toBe(true);
    expect(evt.properties.get('cancelable')?.value).toBe(true);
  });
});

describe('Event Propagation via JS Engine', () => {

  function setupDom(html: string) {
    const parser = new HtmlParser();
    const tree = new DomTree();
    const result = parser.parse(html);
    const doc = tree.buildFromHtml(result.document);
    return { doc, tree };
  }

  function runWithDom(source: string, html: string) {
    const { doc, tree } = setupDom(html);
    const r = runJS(source, { document: doc, domTree: tree });
    if (r.error) console.log('JS ERROR:', r.error.message);
    return r;
  }

  it('should fire addEventListener callback on dispatchEvent', () => {
    const r = runWithDom(`
      var result = [];
      var p = document.querySelector('p');
      p.addEventListener('click', function(e) { result.push('clicked'); });
      var evt = document.createEvent('click');
      p.dispatchEvent(evt);
      result.length;
    `, '<html><body><p>Hello</p></body></html>');
    expect(r.value).toBe(1);
  });

  it('should fire listeners in order', () => {
    const r = runWithDom(`
      var result = [];
      var p = document.querySelector('p');
      p.addEventListener('click', function(e) { result.push('a'); });
      p.addEventListener('click', function(e) { result.push('b'); });
      var evt = document.createEvent('click');
      p.dispatchEvent(evt);
      result.join(',');
    `, '<html><body><p>Hello</p></body></html>');
    expect(r.value).toBe('a,b');
  });

  it('should support removeEventListener', () => {
    const r = runWithDom(`
      var result = [];
      var p = document.querySelector('p');
      function handler(e) { result.push('clicked'); }
      p.addEventListener('click', handler);
      p.removeEventListener('click', handler);
      var evt = document.createEvent('click');
      p.dispatchEvent(evt);
      result.length;
    `, '<html><body><p>Hello</p></body></html>');
    expect(r.value).toBe(0);
  });

  it('should propagate to parent (bubble phase)', () => {
    const r = runWithDom(`
      var result = [];
      var p = document.querySelector('p');
      var div = document.querySelector('div');
      div.addEventListener('click', function(e) { result.push('div'); });
      p.addEventListener('click', function(e) { result.push('p'); });
      var evt = document.createEvent('click', true);
      p.dispatchEvent(evt);
      result.join(',');
    `, '<html><body><div><p>Click me</p></div></body></html>');
    expect(r.value).toBe('p,div');
  });

  it('should support capture phase (parents fire before target)', () => {
    const r = runWithDom(`
      var result = [];
      var p = document.querySelector('p');
      var div = document.querySelector('div');
      var body = document.querySelector('body');
      body.addEventListener('click', function(e) { result.push('body-capture'); }, true);
      div.addEventListener('click', function(e) { result.push('div-capture'); }, true);
      p.addEventListener('click', function(e) { result.push('p'); });
      var evt = document.createEvent('click', true);
      p.dispatchEvent(evt);
      result.join(',');
    `, '<html><body><div><p>Click</p></div></body></html>');
    expect(r.value).toBe('body-capture,div-capture,p');
  });

  it('should support full capture-target-bubble cycle', () => {
    const r = runWithDom(`
      var result = [];
      var p = document.querySelector('p');
      var div = document.querySelector('div');
      div.addEventListener('click', function(e) { result.push('div-capture'); }, true);
      div.addEventListener('click', function(e) { result.push('div-bubble'); });
      p.addEventListener('click', function(e) { result.push('p'); });
      var evt = document.createEvent('click', true);
      p.dispatchEvent(evt);
      result.join(',');
    `, '<html><body><div><p>Click</p></div></body></html>');
    expect(r.value).toBe('div-capture,p,div-bubble');
  });

  it('should stop propagation on stopPropagation()', () => {
    const r = runWithDom(`
      var result = [];
      var p = document.querySelector('p');
      var div = document.querySelector('div');
      p.addEventListener('click', function(e) { result.push('p'); e.stopPropagation(); });
      div.addEventListener('click', function(e) { result.push('div'); });
      var evt = document.createEvent('click', true);
      p.dispatchEvent(evt);
      result.join(',');
    `, '<html><body><div><p>Click</p></div></body></html>');
    expect(r.value).toBe('p');
  });

  it('should support preventDefault()', () => {
    const r = runWithDom(`
      var p = document.querySelector('p');
      p.addEventListener('click', function(e) { e.preventDefault(); });
      var evt = document.createEvent('click', true, true);
      var result = p.dispatchEvent(evt);
      result;
    `, '<html><body><p>Click</p></body></html>');
    expect(r.value).toBe(false);
  });

  it('should set target and currentTarget on event', () => {
    const r = runWithDom(`
      var result = '';
      var p = document.querySelector('p');
      p.addEventListener('click', function(e) {
        result = e.eventPhase + ':' + (e.currentTarget === e.target);
      });
      var evt = document.createEvent('click');
      p.dispatchEvent(evt);
      result;
    `, '<html><body><p>Click</p></body></html>');
    expect(r.value).toBe('2:true');
  });
});
