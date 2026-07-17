import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { Interpreter } from '../src/browser/js/interpreter';

function evalJS(source: string) {
  const tokens = new Lexer(source).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const interp = new Interpreter();
  return interp.run(program);
}

// Test 1: Classes
console.log('=== Class test ===');
try {
  const r1 = evalJS(`
    class Dog {
      constructor(name) { this.name = name; }
      bark() { return this.name + " says woof"; }
    }
    var d = new Dog("Rex");
    d.bark()
  `);
  console.log('class bark:', JSON.stringify(r1));
} catch (e) {
  console.log('class error:', e);
}

// Test 1b: simpler class
try {
  const r1b = evalJS(`
    class Foo {
      constructor() { this.x = 42; }
      getX() { return this.x; }
    }
    var f = new Foo();
    f.x
  `);
  console.log('class simple:', JSON.stringify(r1b));
} catch (e) {
  console.log('class simple error:', e);
}

// Test 1c: check if constructor runs
try {
  const r1c = evalJS(`
    class Dog {
      constructor(name) { this.name = name; }
    }
    var d = new Dog("Rex");
    d.name
  `);
  console.log('class ctor:', JSON.stringify(r1c));
} catch (e) {
  console.log('class ctor error:', e);
}

// Test 1d: manual new with object literal
try {
  const r1d = evalJS(`
    function Dog(name) { this.name = name; }
    var d = new Dog("Rex");
    d.name
  `);
  console.log('func ctor:', JSON.stringify(r1d));
} catch (e) {
  console.log('func ctor error:', e);
}

// Test 1e: simple new expression
try {
  const r1e = evalJS(`
    class A { constructor() { this.x = 1; } }
    new A().x
  `);
  console.log('new A().x:', JSON.stringify(r1e));
} catch (e) {
  console.log('new A() error:', e);
}

// Test 1f: parse class and check AST
try {
  const tokens = new Lexer('class Dog { constructor(name) { this.name = name; } bark() { return this.name; } }').tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const classDecl = program.body[0] as any;
  console.log('class type:', classDecl.type);
  console.log('class id:', classDecl.id?.name);
  console.log('class body type:', classDecl.body?.type);
  console.log('class body length:', classDecl.body?.body?.length);
  for (const m of classDecl.body?.body || []) {
    console.log('  method:', m.type, m.kind, m.key?.name, 'params:', m.value?.params?.length);
  }
} catch (e) {
  console.log('parse error:', e);
}

// Test 1g: Debug evalNew by checking what evalExpr returns for class name
try {
  const src = `
    class A { constructor() { this.x = 1; } }
    typeof A
  `;
  const tokens = new Lexer(src).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const interp = new Interpreter();
  const result = interp.run(program);
  console.log('typeof A:', JSON.stringify(result));
} catch (e) {
  console.log('typeof A error:', e);
}

// Test 1h: Step through class construction
try {
  const src = `
    class A { constructor() { this.x = 1; } }
    var a = new A();
    a.x
  `;
  const tokens = new Lexer(src).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  // Check AST of new expression
  const varDecl = program.body[1] as any;
  const init = varDecl.declarations[0].init;
  console.log('new expr type:', init.type, 'callee:', init.callee?.name);
  
  const interp = new Interpreter();
  const result = interp.run(program);
  console.log('a.x:', JSON.stringify(result));
} catch (e) {
  console.log('class construction error:', e.message, e.stack?.split('\n')[0]);
}

// Test 1i: Check if function constructors work
try {
  const src = `
    function Foo(x) { this.x = x; }
    var f = new Foo(42);
    f.x
  `;
  const tokens = new Lexer(src).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const interp = new Interpreter();
  const result = interp.run(program);
  console.log('func new:', JSON.stringify(result));
} catch (e) {
  console.log('func new error:', e.message, e.stack?.split('\n')[0]);
}

// Test 1j: Minimal new - trace into evalNew
try {
  const src = `new Object()`;
  const tokens = new Lexer(src).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const interp = new Interpreter();
  const result = interp.run(program);
  console.log('new Object():', typeof result, result === null ? 'null' : JSON.stringify(result));
} catch (e) {
  console.log('new Object error:', e.message);
}

// Test 1k: class A new directly - check that constructor is found
try {
  const src = `class X { constructor() {} } new X()`;
  const tokens = new Lexer(src).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const interp = new Interpreter();
  const result = interp.run(program);
  console.log('new X():', typeof result, JSON.stringify(result));
} catch (e) {
  console.log('new X error:', e.message, e.stack?.split('\n').slice(0,3).join(' | '));
}

// Test JSON.parse specifically
try {
  const src = 'JSON.parse("{\\"x\\": 1}").x';
  console.log('source:', src);
  const tokens = new Lexer(src).tokenize();
  console.log('tokens:', tokens.map(t => t.value).join(' '));
  const parser = new Parser(tokens);
  const program = parser.parse();
  const interp = new Interpreter();
  const result = interp.run(program);
  console.log('json parse .x:', JSON.stringify(result));
} catch (e) {
  console.log('json parse error:', e.message);
}

// Test JSON.stringify  
try {
  const src = 'JSON.stringify({a: 1, b: 2})';
  const tokens = new Lexer(src).tokenize();
  const parser = new Parser(tokens);
  const program = parser.parse();
  const interp = new Interpreter();
  const result = interp.run(program);
  console.log('json stringify:', JSON.stringify(result));
} catch (e) {
  console.log('json stringify error:', e.message);
}

// Test 2: JSON.stringify
console.log('=== JSON test ===');
try {
  const r2 = evalJS('JSON.stringify({a: 1})');
  console.log('json stringify:', JSON.stringify(r2));
} catch (e) {
  console.log('json error:', e);
}

// Test 3: JSON.parse
console.log('=== JSON.parse test ===');
try {
  const r3 = evalJS('JSON.parse("{\\"x\\": 1}").x');
  console.log('json parse:', JSON.stringify(r3));
} catch (e) {
  console.log('json parse error:', e);
}

// Test 4: String.replace
console.log('=== String.replace test ===');
try {
  const r4 = evalJS('"hello".replace("l", "r")');
  console.log('replace:', JSON.stringify(r4));
} catch (e) {
  console.log('replace error:', e);
}

// Test 5: Destructuring
console.log('=== Destructuring test ===');
try {
  const r5 = evalJS('var [a, b] = [1, 2]; a + b');
  console.log('destructuring:', JSON.stringify(r5));
} catch (e) {
  console.log('destructuring error:', e);
}
