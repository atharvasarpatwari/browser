/**
 * @file tests/wpt/js-apis.test.ts
 *
 * JavaScript API specification compliance tests.
 * Tests ECMAScript built-ins, Web APIs, and Nova-specific API conformance.
 */

import { describe, it, expect } from 'vitest';
import { describeWPT, assertWPT, assertThrows, assertRejects } from './wpt-adapter';

describeWPT('ECMAScript — Object', () => {
  assertWPT('Object.keys returns own enumerable keys', () => {
    const obj = { a: 1, b: 2 };
    return JSON.stringify(Object.keys(obj)) === JSON.stringify(['a', 'b']);
  });

  assertWPT('Object.values returns own enumerable values', () => {
    const obj = { a: 1, b: 2 };
    return JSON.stringify(Object.values(obj)) === JSON.stringify([1, 2]);
  });

  assertWPT('Object.entries returns own enumerable entries', () => {
    const obj = { a: 1 };
    const entries = Object.entries(obj);
    return entries.length === 1 && entries[0][0] === 'a' && entries[0][1] === 1;
  });

  assertWPT('Object.assign copies properties', () => {
    const target = { a: 1 };
    const source = { b: 2 };
    Object.assign(target, source);
    return (target as any).b === 2;
  });

  assertWPT('Object.freeze prevents modifications', () => {
    const obj = { a: 1 };
    Object.freeze(obj);
    // In strict mode (which Vitest uses), this throws TypeError
    try {
      (obj as any).a = 2;
      // If no error, check the value wasn't changed (sloppy mode behavior)
      return obj.a === 1;
    } catch (e) {
      // In strict mode, TypeError is thrown — which means freeze works!
      return true;
    }
  });

  assertWPT('Object.seal prevents adding properties', () => {
    const obj: any = { a: 1 };
    Object.seal(obj);
    // In strict mode (which Vitest uses), this throws TypeError
    try {
      obj.b = 2;
      // If no error, check the property wasn't added (sloppy mode behavior)
      return obj.b === undefined;
    } catch (e) {
      // In strict mode, TypeError is thrown — which means seal works!
      return true;
    }
  });

  assertWPT('Object.create creates with prototype', () => {
    const proto = { greet() { return 'hello'; } };
    const obj = Object.create(proto);
    return obj.greet() === 'hello';
  });

  assertWPT('Object.getOwnPropertyDescriptor returns descriptor', () => {
    const obj = { a: 1 };
    const desc = Object.getOwnPropertyDescriptor(obj, 'a');
    return desc !== undefined && desc.value === 1;
  });
});

describeWPT('ECMAScript — Array', () => {
  assertWPT('Array.isArray identifies arrays', () => {
    return Array.isArray([]) === true && Array.isArray({}) === false;
  });

  assertWPT('Array.prototype.map transforms elements', () => {
    const result = [1, 2, 3].map(x => x * 2);
    return JSON.stringify(result) === JSON.stringify([2, 4, 6]);
  });

  assertWPT('Array.prototype.filter filters elements', () => {
    const result = [1, 2, 3, 4].filter(x => x % 2 === 0);
    return JSON.stringify(result) === JSON.stringify([2, 4]);
  });

  assertWPT('Array.prototype.reduce accumulates', () => {
    const result = [1, 2, 3].reduce((acc, x) => acc + x, 0);
    return result === 6;
  });

  assertWPT('Array.prototype.find finds element', () => {
    const result = [1, 2, 3].find(x => x === 2);
    return result === 2;
  });

  assertWPT('Array.prototype.findIndex finds index', () => {
    const result = [1, 2, 3].findIndex(x => x === 2);
    return result === 1;
  });

  assertWPT('Array.prototype.includes checks membership', () => {
    return [1, 2, 3].includes(2) === true && [1, 2, 3].includes(4) === false;
  });

  assertWPT('Array.prototype.flat flattens', () => {
    const result = [1, [2, 3], [4]].flat();
    return JSON.stringify(result) === JSON.stringify([1, 2, 3, 4]);
  });

  assertWPT('Array.prototype.flatMap maps and flattens', () => {
    const result = [1, 2, 3].flatMap(x => [x, x * 2]);
    return JSON.stringify(result) === JSON.stringify([1, 2, 2, 4, 3, 6]);
  });

  assertWPT('Array.from creates from iterable', () => {
    const result = Array.from('hello');
    return JSON.stringify(result) === JSON.stringify(['h', 'e', 'l', 'l', 'o']);
  });
});

describeWPT('ECMAScript — String', () => {
  assertWPT('String.prototype.includes checks substring', () => {
    return 'hello world'.includes('world') === true;
  });

  assertWPT('String.prototype.startsWith checks prefix', () => {
    return 'hello'.startsWith('hel') === true;
  });

  assertWPT('String.prototype.endsWith checks suffix', () => {
    return 'hello'.endsWith('llo') === true;
  });

  assertWPT('String.prototype.repeat repeats', () => {
    return 'ab'.repeat(3) === 'ababab';
  });

  assertWPT('String.prototype.trim removes whitespace', () => {
    return '  hello  '.trim() === 'hello';
  });

  assertWPT('String.prototype.padStart pads', () => {
    return '5'.padStart(3, '0') === '005';
  });

  assertWPT('String.prototype.padEnd pads', () => {
    return '5'.padEnd(3, '0') === '500';
  });

  assertWPT('String.prototype.replaceAll replaces all', () => {
    return 'aabbcc'.replaceAll('b', 'x') === 'aaxxcc';
  });

  assertWPT('String.prototype.split splits', () => {
    const result = 'a,b,c'.split(',');
    return JSON.stringify(result) === JSON.stringify(['a', 'b', 'c']);
  });

  assertWPT('String.prototype.slice extracts', () => {
    return 'hello'.slice(1, 4) === 'ell';
  });
});

describeWPT('ECMAScript — Map/Set', () => {
  assertWPT('Map set/get works', () => {
    const map = new Map();
    map.set('key', 'value');
    return map.get('key') === 'value';
  });

  assertWPT('Map.has checks existence', () => {
    const map = new Map();
    map.set('key', 'value');
    return map.has('key') === true && map.has('other') === false;
  });

  assertWPT('Map.size reflects count', () => {
    const map = new Map();
    map.set('a', 1);
    map.set('b', 2);
    return map.size === 2;
  });

  assertWPT('Map.delete removes entry', () => {
    const map = new Map();
    map.set('key', 'value');
    map.delete('key');
    return map.has('key') === false;
  });

  assertWPT('Map.clear removes all', () => {
    const map = new Map();
    map.set('a', 1);
    map.clear();
    return map.size === 0;
  });

  assertWPT('Map.forEach iterates', () => {
    const map = new Map();
    map.set('a', 1);
    let sum = 0;
    map.forEach((v) => { sum += v; });
    return sum === 1;
  });

  assertWPT('Map.keys returns iterator', () => {
    const map = new Map();
    map.set('a', 1);
    const keys = [...map.keys()];
    return JSON.stringify(keys) === JSON.stringify(['a']);
  });

  assertWPT('Map.values returns iterator', () => {
    const map = new Map();
    map.set('a', 1);
    const values = [...map.values()];
    return JSON.stringify(values) === JSON.stringify([1]);
  });

  assertWPT('Set add/has works', () => {
    const set = new Set();
    set.add(1);
    return set.has(1) === true && set.has(2) === false;
  });

  assertWPT('Set.size reflects count', () => {
    const set = new Set();
    set.add(1);
    set.add(2);
    set.add(1); // duplicate
    return set.size === 2;
  });

  assertWPT('Set.delete removes entry', () => {
    const set = new Set();
    set.add(1);
    set.delete(1);
    return set.has(1) === false;
  });
});

describeWPT('ECMAScript — Promise', () => {
  assertWPT('Promise.resolve resolves', async () => {
    const result = await Promise.resolve(42);
    return result === 42;
  });

  assertWPT('Promise.reject rejects', async () => {
    try {
      await Promise.reject(new Error('fail'));
      return false;
    } catch (e) {
      return (e as Error).message === 'fail';
    }
  });

  assertWPT('Promise.all resolves all', async () => {
    const result = await Promise.all([Promise.resolve(1), Promise.resolve(2)]);
    return JSON.stringify(result) === JSON.stringify([1, 2]);
  });

  assertWPT('Promise.all rejects if any rejects', async () => {
    try {
      await Promise.all([Promise.resolve(1), Promise.reject(new Error('fail'))]);
      return false;
    } catch (e) {
      return (e as Error).message === 'fail';
    }
  });

  assertWPT('Promise.race resolves with first', async () => {
    const result = await Promise.race([
      new Promise(resolve => setTimeout(() => resolve(1), 10)),
      Promise.resolve(2),
    ]);
    return result === 2;
  });

  assertWPT('Promise.allSettled settles all', async () => {
    const results = await Promise.allSettled([
      Promise.resolve(1),
      Promise.reject(new Error('fail')),
    ]);
    return results.length === 2 &&
      results[0].status === 'fulfilled' &&
      results[1].status === 'rejected';
  });

  assertWPT('Promise.any resolves with first success', async () => {
    const result = await Promise.any([
      Promise.reject(new Error('fail')),
      Promise.resolve(42),
    ]);
    return result === 42;
  });

  assertWPT('Promise chain works', async () => {
    const result = await Promise.resolve(1)
      .then(x => x + 1)
      .then(x => x * 3);
    return result === 6;
  });

  assertWPT('Promise.catch handles rejection', async () => {
    const result = await Promise.reject(new Error('fail'))
      .catch(() => 42);
    return result === 42;
  });
});

describeWPT('ECMAScript — Proxy', () => {
  assertWPT('Proxy get trap intercepts property access', () => {
    const target = { a: 1 };
    const proxy = new Proxy(target, {
      get: (obj, prop) => {
        if (prop === 'a') return 100;
        return Reflect.get(obj, prop);
      },
    });
    return (proxy as any).a === 100;
  });

  assertWPT('Proxy set trap intercepts property set', () => {
    const target: any = {};
    const proxy = new Proxy(target, {
      set: (obj, prop, value) => {
        obj[prop] = value * 2;
        return true;
      },
    });
    (proxy as any).a = 5;
    return target.a === 10;
  });

  assertWPT('Proxy has trap intercepts in operator', () => {
    const target = { a: 1 };
    const proxy = new Proxy(target, {
      has: (obj, prop) => {
        return prop === 'b' || Reflect.has(obj, prop);
      },
    });
    return ('b' in proxy) === true && ('c' in proxy) === false;
  });

  assertWPT('Proxy deleteProperty trap intercepts delete', () => {
    const target: any = { a: 1 };
    const proxy = new Proxy(target, {
      deleteProperty: (obj, prop) => {
        delete obj[prop];
        return true;
      },
    });
    delete (proxy as any).a;
    return target.a === undefined;
  });
});

describeWPT('ECMAScript — Symbol', () => {
  assertWPT('Symbol creates unique value', () => {
    const s1: symbol = Symbol('test');
    const s2: symbol = Symbol('test');
    return s1 !== s2;
  });

  assertWPT('Symbol.for creates global symbol', () => {
    const s1: symbol = Symbol.for('test');
    const s2 = Symbol.for('test');
    return s1 === s2;
  });

  assertWPT('Symbol.iterator is defined', () => {
    return typeof Symbol.iterator === 'symbol';
  });

  assertWPT('Symbol.toPrimitive works', () => {
    const obj = {
      [Symbol.toPrimitive]() { return 42; },
    };
    return (obj as any) + 0 === 42;
  });
});

describeWPT('ECMAScript — Async/Iterator', () => {
  assertWPT('async function returns Promise', () => {
    async function fn() { return 42; }
    const result = fn();
    return result instanceof Promise;
  });

  assertWPT('await resolves Promise', async () => {
    const result = await Promise.resolve(42);
    return result === 42;
  });

  assertWPT('for-await-of iterates async iterable', async () => {
    async function* gen() {
      yield 1;
      yield 2;
      yield 3;
    }
    const results: number[] = [];
    for await (const x of gen()) {
      results.push(x);
    }
    return JSON.stringify(results) === JSON.stringify([1, 2, 3]);
  });

  assertWPT('async generator works', async () => {
    async function* counter() {
      let i = 0;
      while (i < 3) yield i++;
    }
    const results: number[] = [];
    for await (const x of counter()) {
      results.push(x);
    }
    return JSON.stringify(results) === JSON.stringify([0, 1, 2]);
  });
});

describeWPT('Web API — EventTarget', () => {
  assertWPT('addEventListener adds listener', () => {
    let called: boolean = false;
    const target = new EventTarget();
    target.addEventListener('test', () => { called = true; });
    target.dispatchEvent(new Event('test'));
    return called;
  });

  assertWPT('removeEventListener removes listener', () => {
    let count = 0;
    const target = new EventTarget();
    const handler = () => { count++; };
    target.addEventListener('test', handler);
    target.removeEventListener('test', handler);
    target.dispatchEvent(new Event('test'));
    return count === 0;
  });

  assertWPT('addEventListener with once fires once', () => {
    let count = 0;
    const target = new EventTarget();
    target.addEventListener('test', () => { count++; }, { once: true });
    target.dispatchEvent(new Event('test'));
    target.dispatchEvent(new Event('test'));
    return count === 1;
  });

  assertWPT('CustomEvent detail is accessible', () => {
    let receivedDetail: any = null;
    const target = new EventTarget();
    target.addEventListener('test', ((e: CustomEvent) => {
      receivedDetail = e.detail;
    }) as EventListener);
    target.dispatchEvent(new CustomEvent('test', { detail: { data: 42 } }));
    return receivedDetail?.data === 42;
  });
});

describeWPT('Web API — AbortController', () => {
  assertWPT('AbortController.signal is AbortSignal', () => {
    const controller = new AbortController();
    return controller.signal instanceof AbortSignal;
  });

  assertWPT('AbortController.signal.aborted is false initially', () => {
    const controller = new AbortController();
    return controller.signal.aborted === false;
  });

  assertWPT('AbortController.abort() sets aborted', () => {
    const controller = new AbortController();
    controller.abort();
    return controller.signal.aborted === true;
  });

  assertWPT('AbortSignal abort event fires', () => {
    const controller = new AbortController();
    let fired: boolean = false;
    controller.signal.addEventListener('abort', () => { fired = true; });
    controller.abort();
    return fired;
  });
});

describeWPT('Web API — URL', () => {
  assertWPT('URL parses standard URL', () => {
    const url = new URL('https://example.com/path?q=1#hash');
    return url.hostname === 'example.com' && url.pathname === '/path';
  });

  assertWPT('URLSearchParams parses query string', () => {
    const params = new URLSearchParams('a=1&b=2');
    return params.get('a') === '1' && params.get('b') === '2';
  });

  assertWPT('URLSearchParams.append adds param', () => {
    const params = new URLSearchParams();
    params.append('key', 'value');
    return params.get('key') === 'value';
  });

  assertWPT('URLSearchParams.delete removes param', () => {
    const params = new URLSearchParams('key=value');
    params.delete('key');
    return params.get('key') === null;
  });

  assertWPT('URLSearchParams.has checks existence', () => {
    const params = new URLSearchParams('key=value');
    return params.has('key') === true && params.has('other') === false;
  });
});

describeWPT('Web API — TextEncoder/TextDecoder', () => {
  assertWPT('TextEncoder encodes to UTF-8', () => {
    const encoder = new TextEncoder();
    const encoded = encoder.encode('hello');
    return encoded.length === 5 && encoded[0] === 104;
  });

  assertWPT('TextDecoder decodes UTF-8', () => {
    const decoder = new TextDecoder();
    const decoded = decoder.decode(new Uint8Array([104, 101, 108, 108, 111]));
    return decoded === 'hello';
  });

  assertWPT('TextEncoder handles multi-byte', () => {
    const encoder = new TextEncoder();
    const encoded = encoder.encode('€');
    return encoded.length === 3 && encoded[0] === 0xe2;
  });
});
