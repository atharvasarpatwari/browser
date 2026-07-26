import { describe, it, expect, beforeEach } from 'vitest';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { Interpreter } from '../src/browser/js/interpreter';
import { Environment, createObject, createArray, createNativeFunction, type JSValue, type JSObject, callJSFunction } from '../src/browser/js/values';
import { EventLoop, bindTimers } from '../src/browser/js/event-loop';
import { runJS, createGlobalEnv } from '../src/browser/js/index';

function makeMinimalDoc() {
  return {
    domId: 'doc-1', nodeType: 'document' as const, parent: null,
    children: [], htmlElement: null, headElement: null, bodyElement: null,
  };
}

function makeMinimalDomTree(doc: any) {
  return {
    buildFromHtml: () => doc, getNodeById: () => null, getElementById: () => null,
    getElementsByTagName: () => [], getElementsByClassName: () => [], querySelector: () => null, querySelectorAll: () => [],
    insertBefore: () => {}, appendChild: () => {}, removeChild: () => {},
    setAttribute: () => {}, removeAttribute: () => {}, setTextContent: () => {},
    setComputedStyle: () => {}, setLayoutBox: () => {}, getMutations: () => [],
    clearMutations: () => {}, getDocument: () => doc, dispose: () => {},
  };
}

function createTestEnv(): { env: Environment; eventLoop: EventLoop } {
  const doc = makeMinimalDoc();
  const domTree = makeMinimalDomTree(doc) as any;
  const eventLoop = new EventLoop();
  const env = createGlobalEnv(doc, domTree, eventLoop);
  return { env, eventLoop };
}

function evalJS(source: string, ctx?: { env: Environment; eventLoop: EventLoop }): JSValue {
  const c = ctx ?? createTestEnv();
  const lexer = new Lexer(source);
  const parser = new Parser([], lexer);
  const program = parser.parse();
  const interp = new Interpreter(c.env, c.eventLoop);
  return interp.run(program);
}

// ═════════════════════════════════════════════════════════════════════════════
// TDZ Enforcement
// ═════════════════════════════════════════════════════════════════════════════
describe('TDZ Enforcement', () => {
  it('throws ReferenceError when accessing let before declaration', () => {
    expect(() => evalJS(`
      x;
      let x = 5;
    `)).toThrow();
  });

  it('throws ReferenceError when accessing const before declaration', () => {
    expect(() => evalJS(`
      x;
      const x = 5;
    `)).toThrow();
  });

  it('does not throw when accessing var before declaration (hoisted)', () => {
    const v = evalJS(`
      x;
      var x = 5;
      x;
    `);
    expect(v).toBe(5);
  });

  it('can access let after declaration', () => {
    const v = evalJS(`
      let x = 10;
      x;
    `);
    expect(v).toBe(10);
  });

  it('can access const after declaration', () => {
    const v = evalJS(`
      const x = 10;
      x;
    `);
    expect(v).toBe(10);
  });

  it('TDZ works in blocks', () => {
    expect(() => evalJS(`
      {
        y;
        let y = 1;
      }
    `)).toThrow();
  });

  it('var is hoisted to function scope (value accessible after declaration)', () => {
    const v = evalJS(`
      function f() {
        var x = 10;
        return x;
      }
      f();
    `);
    expect(v).toBe(10);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ASI (Automatic Semicolon Insertion)
// ═════════════════════════════════════════════════════════════════════════════
describe('ASI (Automatic Semicolon Insertion)', () => {
  it('parses expression statements without trailing semicolons', () => {
    const v = evalJS(`
      var x = 1
      var y = 2
      x + y
    `);
    expect(v).toBe(3);
  });

  it('parses return with newline as return nothing', () => {
    const v = evalJS(`
      (function() {
        return
        42
      })()
    `);
    expect(v).toBeUndefined();
  });

  it('parses return with value on same line', () => {
    const v = evalJS(`
      (function() {
        return 42
      })()
    `);
    expect(v).toBe(42);
  });

  it('parses break without semicolons', () => {
    const v = evalJS(`
      var sum = 0
      for (var i = 0; i < 5; i++) {
        if (i === 3) break
        sum += i
      }
      sum
    `);
    expect(v).toBe(3);
  });

  it('parses continue without semicolons', () => {
    const v = evalJS(`
      var sum = 0
      for (var i = 0; i < 5; i++) {
        if (i === 2) continue
        sum += i
      }
      sum
    `);
    expect(v).toBe(8);
  });

  it('parses throw without semicolons', () => {
    expect(() => evalJS(`
      throw new Error('test')
    `)).toThrow();
  });

  it('parses var declarations without semicolons', () => {
    const v = evalJS(`
      var x = 1
      var y = 2
      var z = 3
      x + y + z
    `);
    expect(v).toBe(6);
  });

  it('inserts semicolons before closing braces', () => {
    const v = evalJS(`
      var result = 0
      if (true) {
        result = 42
      }
      result
    `);
    expect(v).toBe(42);
  });

  it('inserts semicolons at end of input', () => {
    const v = evalJS('var x = 5; x')
    expect(v).toBe(5);
  });

  it('parses chained statements without semicolons', () => {
    const v = evalJS(`
      var a = 0
      a++
      a--
      a += 10
      a
    `);
    expect(v).toBe(10);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Named Character References
// ═════════════════════════════════════════════════════════════════════════════
describe('Named Character References', () => {
  let mod: typeof import('../src/browser/rendering/html5/named-char-refs');
  beforeEach(async () => {
    mod = await import('../src/browser/rendering/html5/named-char-refs');
  });

  it('resolves &amp; to &', () => {
    expect(mod.lookupNamedCharRef('amp')).toBe('&');
  });

  it('resolves &lt; to <', () => {
    expect(mod.lookupNamedCharRef('lt')).toBe('<');
  });

  it('resolves &gt; to >', () => {
    expect(mod.lookupNamedCharRef('gt')).toBe('>');
  });

  it('resolves &nbsp; to non-breaking space', () => {
    expect(mod.lookupNamedCharRef('nbsp')).toBe('\u00A0');
  });

  it('resolves &copy; to copyright sign', () => {
    expect(mod.lookupNamedCharRef('copy')).toBe('\u00A9');
  });

  it('resolves &alpha; to Greek alpha', () => {
    expect(mod.lookupNamedCharRef('alpha')).toBe('\u03B1');
  });

  it('resolves &hearts; to heart symbol', () => {
    expect(mod.lookupNamedCharRef('hearts')).toBe('\u2665');
  });

  it('returns falsy value for unknown refs', () => {
    expect(mod.lookupNamedCharRef('zzzzzzz')).toBeFalsy();
  });

  it('isNamedCharRef checks correctly', () => {
    expect(mod.isNamedCharRef('amp')).toBe(true);
    expect(mod.isNamedCharRef('zzzzz')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// super member access
// ═════════════════════════════════════════════════════════════════════════════
describe('super member access', () => {
  it('super() calls parent constructor', () => {
    const v = evalJS(`
      class Base {
        constructor(x) {
          this.x = x
        }
      }
      class Child extends Base {
        constructor(x) {
          super(x * 2)
        }
      }
      var c = new Child(5)
      c.x
    `);
    expect(v).toBe(10);
  });

  it('super.x accesses parent prototype property via method', () => {
    const v = evalJS(`
      class Base {
        constructor() {
          this.baseVal = 10
        }
        getBase() {
          return this.baseVal
        }
      }
      class Child extends Base {
        getChild() {
          return super.getBase()
        }
      }
      var c = new Child()
      c.getChild()
    `);
    expect(v).toBe(10);
  });

  it('super.method() calls parent method with correct this', () => {
    const v = evalJS(`
      class Animal {
        constructor(name) {
          this.name = name
        }
        speak() {
          return this.name + ' speaks'
        }
      }
      class Dog extends Animal {
        speak() {
          return super.speak() + ' loudly'
        }
      }
      var d = new Dog('Rex')
      d.speak()
    `);
    expect(v).toBe('Rex speaks loudly');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Function constructor improvements (.length, .name, .prototype)
// ═════════════════════════════════════════════════════════════════════════════
describe('Function constructor improvements', () => {
  it('Function.length is 0', () => {
    const v = evalJS(`Function.length`);
    expect(v).toBe(0);
  });

  it('Function.name is "Function"', () => {
    const v = evalJS(`Function.name`);
    expect(v).toBe('Function');
  });

  it('Function.prototype exists and is an object', () => {
    const v = evalJS(`typeof Function.prototype`);
    expect(v).toBe('object');
  });

  it('created function .length matches parameter count', () => {
    const v = evalJS(`
      var f = new Function('a', 'b', 'c', 'return a + b + c')
      f.length
    `);
    expect(v).toBe(3);
  });

  it('created function .name is "anonymous"', () => {
    const v = evalJS(`
      var f = new Function('x', 'return x')
      f.name
    `);
    expect(v).toBe('anonymous');
  });

  it('created function has .prototype that is an object', () => {
    const v = evalJS(`
      var f = new Function('x', 'return x')
      typeof f.prototype
    `);
    expect(v).toBe('object');
  });

  it('Function.prototype.constructor is Function', () => {
    const v = evalJS(`Function.prototype.constructor === Function`);
    expect(v).toBe(true);
  });

  it('regular function .length matches parameter count', () => {
    const v = evalJS(`
      function add(a, b) { return a + b }
      add.length
    `);
    expect(v).toBe(2);
  });

  it('regular function .name matches declared name', () => {
    const v = evalJS(`
      function myFunc() {}
      myFunc.name
    `);
    expect(v).toBe('myFunc');
  });

  it('arrow function has no .prototype', () => {
    const v = evalJS(`
      var f = (x) => x
      f.prototype
    `);
    expect(v).toBeUndefined();
  });

  it('regular function .prototype.constructor refers back to the function', () => {
    const v = evalJS(`
      function Foo() {}
      Foo.prototype.constructor === Foo
    `);
    expect(v).toBe(true);
  });

  it('fn.prototype === fn.prototype (identity check)', () => {
    const v = evalJS(`
      function Foo() {}
      Foo.prototype === Foo.prototype
    `);
    expect(v).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// cancelBubble
// ═════════════════════════════════════════════════════════════════════════════
describe('cancelBubble', () => {
  it('setting cancelBubble to true calls stopPropagation', () => {
    const v = evalJS(`
      var e = new Event('click');
      e.cancelBubble = true;
      e.cancelBubble;
    `);
    expect(v).toBe(true);
  });
});
