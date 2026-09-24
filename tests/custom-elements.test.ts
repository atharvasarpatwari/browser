import { describe, it, expect } from 'vitest';
import { Interpreter } from '../src/browser/js/interpreter';
import { Environment } from '../src/browser/js/values';
import { EventLoop } from '../src/browser/js/event-loop';
import { Lexer } from '../src/browser/js/lexer';
import { Parser } from '../src/browser/js/parser';
import { createDocumentBinding } from '../src/browser/js/dom-bindings';
import { createCustomElementRegistry, createHTMLElementClass } from '../src/browser/js/custom-elements';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';

function createTestEnv() {
  const parsed = new HtmlParser().parse('<html><body></body></html>');
  const domTree = new DomTree();
  const doc = domTree.buildFromHtml(parsed.document);
  const eventLoop = new EventLoop();
  const interp = new Interpreter(undefined, eventLoop);
  const env = (interp as any).globalEnv as Environment;
  env.setLocal('document', createDocumentBinding(doc, domTree));
  env.setLocal('HTMLElement', createHTMLElementClass());
  env.setLocal('customElements', createCustomElementRegistry(eventLoop));
  return { interp, env, eventLoop };
}

async function flushAll(el: EventLoop) {
  let consecutiveEmpty = 0;
  for (let i = 0; i < 50 && consecutiveEmpty < 5; i++) {
    await new Promise<void>(r => setTimeout(r, 5));
    el.drainMicrotasks();
    consecutiveEmpty = el.microtaskCount === 0 ? consecutiveEmpty + 1 : 0;
  }
}

async function run(source: string) {
  const { interp, env, eventLoop } = createTestEnv();
  const lexer = new Lexer(source);
  const parser = new Parser([], lexer);
  const program = parser.parse();
  interp.run(program);
  await flushAll(eventLoop);
  return { env, eventLoop };
}

describe('Custom Elements (window.customElements, HTMLElement)', () => {
  it('defines a class, upgrades on createElement, and runs its real constructor', async () => {
    const { env } = await run(`
      class MyWidget extends HTMLElement {
        constructor() {
          super();
          this.built = true;
        }
        greet() { return 'hi from ' + this.tagName; }
      }
      customElements.define('my-widget', MyWidget);
      var el = document.createElement('my-widget');
      var built = el.built;
      var greeting = el.greet();
      var tag = el.tagName;
    `);
    expect(env.get('built')).toBe(true);
    expect(env.get('greeting')).toBe('hi from MY-WIDGET');
    expect(env.get('tag')).toBe('MY-WIDGET');
  });

  it('fires connectedCallback on appendChild and disconnectedCallback on removeChild', async () => {
    const { env } = await run(`
      var log = [];
      class Logger extends HTMLElement {
        connectedCallback() { log.push('connected'); }
        disconnectedCallback() { log.push('disconnected'); }
      }
      customElements.define('log-widget', Logger);
      var el = document.createElement('log-widget');
      var beforeAppend = log.length;
      document.body.appendChild(el);
      var afterAppend = log.join(',');
      document.body.removeChild(el);
      var afterRemove = log.join(',');
    `);
    expect(env.get('beforeAppend')).toBe(0);
    expect(env.get('afterAppend')).toBe('connected');
    expect(env.get('afterRemove')).toBe('connected,disconnected');
  });

  it('only fires attributeChangedCallback for observed attributes, with correct old/new values', async () => {
    const { env } = await run(`
      var changes = [];
      class Counter extends HTMLElement {
        static get observedAttributes() { return ['data-count']; }
        attributeChangedCallback(name, oldValue, newValue) {
          changes.push(name + '|' + oldValue + '|' + newValue);
        }
      }
      customElements.define('count-widget', Counter);
      var el = document.createElement('count-widget');
      el.setAttribute('data-count', '5');
      el.setAttribute('unobserved', 'ignored');
      el.setAttribute('data-count', '6');
      var n = changes.length;
      var first = changes[0];
      var second = changes[1];
    `);
    expect(env.get('n')).toBe(2);
    expect(env.get('first')).toBe('data-count|null|5');
    expect(env.get('second')).toBe('data-count|5|6');
  });

  it('retroactively upgrades an element created before its class was defined', async () => {
    const { env } = await run(`
      var el = document.createElement('later-widget');
      var beforeDefine = typeof el.laterMethod;
      class LaterWidget extends HTMLElement {
        laterMethod() { return 'now defined'; }
      }
      customElements.define('later-widget', LaterWidget);
      var afterDefine = el.laterMethod();
    `);
    expect(env.get('beforeDefine')).toBe('undefined');
    expect(env.get('afterDefine')).toBe('now defined');
  });

  it('customElements.get returns the class or undefined', async () => {
    const { env } = await run(`
      class Foo extends HTMLElement {}
      customElements.define('foo-el', Foo);
      var found = customElements.get('foo-el') === Foo;
      var missing = customElements.get('nope-el');
    `);
    expect(env.get('found')).toBe(true);
    expect(env.get('missing')).toBeUndefined();
  });

  it('whenDefined resolves immediately if already defined, and later if not', async () => {
    const { env } = await run(`
      class Early extends HTMLElement {}
      customElements.define('early-el', Early);
      var earlyResolved = false;
      var lateResolved = false;
      customElements.whenDefined('early-el').then(function () { earlyResolved = true; });
      customElements.whenDefined('late-el').then(function () { lateResolved = true; });
      class Late extends HTMLElement {}
      customElements.define('late-el', Late);
    `);
    expect(env.get('earlyResolved')).toBe(true);
    expect(env.get('lateResolved')).toBe(true);
  });

  it('rejects an invalid (non-hyphenated) name and a duplicate definition', async () => {
    const { env } = await run(`
      var noHyphenError = null;
      var dupError = null;
      try { customElements.define('nohyphen', class extends HTMLElement {}); }
      catch (e) { noHyphenError = String(e); }
      class Once extends HTMLElement {}
      customElements.define('once-el', Once);
      try { customElements.define('once-el', class extends HTMLElement {}); }
      catch (e) { dupError = String(e); }
    `);
    expect(env.get('noHyphenError')).toMatch(/hyphen/i);
    expect(env.get('dupError')).toMatch(/already been used/i);
  });
});
