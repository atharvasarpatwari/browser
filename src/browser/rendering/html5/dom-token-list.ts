import type { DomElement, IDomTree } from '../dom-tree';
import {
  type JSValue, type JSObject,
  createObject, createNativeFunction, toString, toBoolean,
} from '../../js/values';

// ─────────────────────────────────────────────────────────────────────────────
// DOMTokenList — WHATWG DOM spec § 7.1
//
// Wraps a JSObject exposed to the JS engine and a backing DomElement +
// IDomTree pair used for reading / writing the element's "class" attribute.
// ─────────────────────────────────────────────────────────────────────────────

function tokenize(raw: string): string[] {
  const tokens = raw.split(/\s+/);
  const result: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] !== '') result.push(tokens[i]);
  }
  return result;
}

function validateToken(token: string): void {
  if (token === '') throw new SyntaxError("The token provided must not be empty.");
  if (/\s/.test(token)) throw new SyntaxError("The token provided must not contain ASCII whitespace characters.");
}

export class DOMTokenList {
  readonly obj: JSObject;
  private _el: DomElement;
  private _domTree: IDomTree;
  private _tokens: string[] = [];

  constructor(el: DomElement, domTree: IDomTree) {
    this._el = el;
    this._domTree = domTree;
    this._tokens = tokenize(this._el.attributes.get('class') ?? '');

    this.obj = createObject(null);
    this._bindMethods();
    this._bindGettersSetters();
  }

  // ── Internal sync ───────────────────────────────────────────────────────

  private _parseTokens(): void {
    this._tokens = tokenize(this._el.attributes.get('class') ?? '');
  }

  private _flush(): void {
    this._domTree.setAttribute(this._el, 'class', this._tokens.join(' '));
  }

  private _indexOf(token: string): number {
    for (let i = 0; i < this._tokens.length; i++) {
      if (this._tokens[i] === token) return i;
    }
    return -1;
  }

  // ── Method binding ──────────────────────────────────────────────────────

  private _bindMethods(): void {
    const self = this; // eslint-disable-line @typescript-eslint/no-this-alias

    this.obj.properties.set('add', {
      value: createNativeFunction('add', (_this, args) => {
        for (let i = 0; i < args.length; i++) {
          const t = toString(args[i]);
          validateToken(t);
          self._parseTokens();
          if (self._indexOf(t) === -1) self._tokens.push(t);
        }
        self._flush();
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    this.obj.properties.set('remove', {
      value: createNativeFunction('remove', (_this, args) => {
        self._parseTokens();
        for (let i = 0; i < args.length; i++) {
          const t = toString(args[i]);
          if (t === '' || /\s/.test(t)) continue;
          const idx = self._indexOf(t);
          if (idx !== -1) self._tokens.splice(idx, 1);
        }
        self._flush();
        return undefined;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    this.obj.properties.set('toggle', {
      value: createNativeFunction('toggle', (_this, args) => {
        const token = toString(args[0]);
        validateToken(token);
        self._parseTokens();
        const has = self._indexOf(token) !== -1;
        let force: boolean | undefined;
        if (args[1] !== undefined) {
          force = toBoolean(args[1]);
        }
        if (has && (force === undefined || force === false)) {
          self._tokens.splice(self._indexOf(token), 1);
          self._flush();
          return false;
        }
        if (!has && (force === undefined || force === true)) {
          self._tokens.push(token);
          self._flush();
          return true;
        }
        return has;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    this.obj.properties.set('contains', {
      value: createNativeFunction('contains', (_this, args) => {
        const token = toString(args[0]);
        self._parseTokens();
        return self._indexOf(token) !== -1;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    this.obj.properties.set('replace', {
      value: createNativeFunction('replace', (_this, args) => {
        const oldToken = toString(args[0]);
        const newToken = toString(args[1]);
        validateToken(newToken);
        self._parseTokens();
        const idx = self._indexOf(oldToken);
        if (idx === -1) return false;
        if (self._indexOf(newToken) !== -1 && idx !== self._indexOf(newToken)) {
          self._tokens.splice(idx, 1);
        } else {
          self._tokens[idx] = newToken;
        }
        self._flush();
        return true;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    this.obj.properties.set('item', {
      value: createNativeFunction('item', (_this, args) => {
        const index = args[0] === undefined ? 0 : Math.trunc(Number(args[0]));
        self._parseTokens();
        if (index < 0 || index >= self._tokens.length) return null;
        return self._tokens[index];
      }),
      writable: true, enumerable: true, configurable: true,
    });

    this.obj.properties.set('toString', {
      value: createNativeFunction('toString', () => {
        self._parseTokens();
        return self._tokens.join(' ');
      }),
      writable: true, enumerable: true, configurable: true,
    });
  }

  // ── Getters / setters / numeric indexing ────────────────────────────────

  private _bindGettersSetters(): void {
    const self = this; // eslint-disable-line @typescript-eslint/no-this-alias

    // value getter/setter
    this.obj.properties.set('value', {
      value: self._el.attributes.get('class') ?? '',
      writable: true, enumerable: true, configurable: true,
      getter: createNativeFunction('get value', () => {
        self._parseTokens();
        return self._tokens.join(' ');
      }),
      setter: createNativeFunction('set value', (_this, args) => {
        const val = toString(args[0]);
        self._tokens = tokenize(val);
        self._flush();
        return undefined;
      }),
    });

    // length getter
    this.obj.properties.set('length', {
      value: 0,
      writable: false, enumerable: true, configurable: false,
      getter: createNativeFunction('get length', () => {
        self._parseTokens();
        return self._tokens.length;
      }),
    });

    // Numeric index access (0, 1, 2 …)
    this.obj.properties.set('getTokenByIndex', {
      value: createNativeFunction('getTokenByIndex', (_this, args) => {
        const index = args[0] === undefined ? 0 : Math.trunc(Number(args[0]));
        self._parseTokens();
        if (index < 0 || index >= self._tokens.length) return undefined;
        return self._tokens[index];
      }),
      writable: true, enumerable: true, configurable: true,
    });

    this.obj.properties.set('setTokenByIndex', {
      value: createNativeFunction('setTokenByIndex', (_this, args) => {
        const index = Math.trunc(Number(args[0]));
        const value = toString(args[1]);
        self._parseTokens();
        if (index < 0 || index >= self._tokens.length) return false;
        validateToken(value);
        self._tokens[index] = value;
        self._flush();
        return true;
      }),
      writable: true, enumerable: true, configurable: true,
    });

    // Symbol.iterator — yields each token as { value, done } via a generator-style object
    this.obj.properties.set(Symbol.iterator as unknown as string, {
      value: createNativeFunction('[Symbol.iterator]', () => {
        self._parseTokens();
        const tokens = self._tokens.slice();
        let idx = 0;
        const iteratorObj = createObject(null);
        iteratorObj.properties.set('next', {
          value: createNativeFunction('next', () => {
            if (idx >= tokens.length) {
              const doneObj = createObject(null);
              doneObj.properties.set('value', { value: undefined, writable: true, enumerable: true, configurable: true });
              doneObj.properties.set('done', { value: true, writable: true, enumerable: true, configurable: true });
              return doneObj;
            }
            const resultObj = createObject(null);
            resultObj.properties.set('value', { value: tokens[idx], writable: true, enumerable: true, configurable: true });
            resultObj.properties.set('done', { value: false, writable: true, enumerable: true, configurable: true });
            idx++;
            return resultObj;
          }),
          writable: true, enumerable: true, configurable: true,
        });
        return iteratorObj;
      }),
      writable: true, enumerable: false, configurable: true,
    });
  }

  // ── Public helpers ──────────────────────────────────────────────────────

  get length(): number {
    this._parseTokens();
    return this._tokens.length;
  }

  get value(): string {
    this._parseTokens();
    return this._tokens.join(' ');
  }
}
