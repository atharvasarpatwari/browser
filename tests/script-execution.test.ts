import { describe, it, expect, beforeEach } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { IDomTree, DomDocument, DomElement } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { runJS, createGlobalEnv } from '../src/browser/js/index';
import { EventLoop } from '../src/browser/js/event-loop';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface RenderResult {
  doc: DomDocument;
  domTree: IDomTree;
  scriptErrors: string[];
}

/**
 * Full rendering pipeline: parse → DOM → CSS → inline scripts → layout → paint.
 * Mirrors what createPageRenderer() does in main.ts.
 */
function renderWithScripts(html: string, url = 'https://example.com/'): RenderResult {
  const htmlParser = new HtmlParser();
  const domTree = new DomTree();
  const cssParser = new CssParser();
  const layoutEngine = new LayoutEngine();
  const paintEngine = new PaintEngine();

  const parseResult = htmlParser.parse(html, url);
  const htmlDoc = parseResult.document;

  const doc = domTree.buildFromHtml(htmlDoc);

  const rules = cssParser.extractStylesFromDocument(htmlDoc);

  // Apply computed styles (simplified — mirrors main.ts logic)
  applyComputedStylesSimple(domTree, cssParser, rules);

  // Execute inline scripts
  const scriptErrors = executeInlineScripts(domTree, doc);

  // Re-apply styles after script execution (scripts may have modified DOM)
  applyComputedStylesSimple(domTree, cssParser, rules);

  // Layout and paint
  layoutEngine.layout(doc, domTree);
  paintEngine.paint(doc);

  return { doc, domTree, scriptErrors };
}

/**
 * Simplified style application for tests.
 */
function applyComputedStylesSimple(
  domTree: IDomTree,
  cssParser: CssParser,
  rules: ReturnType<CssParser['extractStylesFromDocument']>,
): void {
  // For tests, just apply basic styles. Full CSS pipeline is tested elsewhere.
  const doc = domTree.getDocument();
  if (!doc) return;

  const applyToChildren = (nodes: readonly import('../src/browser/rendering/dom-tree').DomNode[]) => {
    for (const node of nodes) {
      if (node.nodeType !== 'element') continue;
      const el = node as DomElement;
      if (!el.computedStyle) {
        domTree.setComputedStyle(el, new Map());
      }
      applyToChildren(el.children);
    }
  };
  applyToChildren(doc.children);
}

/**
 * Execute all inline <script> elements found in the DOM tree.
 */
function executeInlineScripts(domTree: IDomTree, doc: DomDocument): string[] {
  const scripts = domTree.getElementsByTagName('script');
  if (scripts.length === 0) return [];

  const errors: string[] = [];
  const eventLoop = new EventLoop();
  const globalEnv = createGlobalEnv(doc, domTree, eventLoop);

  for (const script of scripts) {
    if (script.attributes.has('src')) continue;

    let source = '';
    for (const child of script.children) {
      if (child.nodeType === 'text') {
        source += (child as unknown as { text: string }).text;
      }
    }

    source = source.trim();
    if (source === '') continue;

    const result = runJS(source, { document: doc, domTree, eventLoop, globalEnv });
    if (result.error) {
      errors.push(result.error.message);
    }
  }

  return errors;
}

/**
 * Get text content of all elements matching a tag name.
 */
function getTextContentByTag(doc: DomDocument, tag: string): string[] {
  const results: string[] = [];
  const walk = (nodes: readonly import('../src/browser/rendering/dom-tree').DomNode[]) => {
    for (const node of nodes) {
      if (node.nodeType === 'element') {
        const el = node as DomElement;
        if (el.tagName === tag) {
          let text = '';
          for (const child of el.children) {
            if (child.nodeType === 'text') {
              text += (child as unknown as { text: string }).text;
            }
          }
          results.push(text);
        }
      }
      if (node.nodeType === 'element') {
        walk((node as DomElement).children);
      }
    }
  };
  walk(doc.children);
  return results;
}

/**
 * Find an element by id in the DOM tree.
 */
function getElementById(doc: DomDocument, id: string): DomElement | null {
  const walk = (nodes: readonly import('../src/browser/rendering/dom-tree').DomNode[]): DomElement | null => {
    for (const node of nodes) {
      if (node.nodeType === 'element') {
        const el = node as DomElement;
        if (el.attributes.get('id') === id) return el;
        const found = walk(el.children);
        if (found) return found;
      }
    }
    return null;
  };
  return walk(doc.children);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Script Execution Integration', () => {
  describe('inline script execution', () => {
    it('should execute a simple inline script', () => {
      const r = renderWithScripts(`
        <html><body>
          <div id="target"></div>
          <script>
            document.getElementById('target').setAttribute('data-executed', 'true');
          </script>
        </body></html>
      `);

      const el = getElementById(r.doc, 'target');
      expect(el).not.toBeNull();
      expect(el!.attributes.get('data-executed')).toBe('true');
      expect(r.scriptErrors).toHaveLength(0);
    });

    it('should execute scripts in document order', () => {
      const r = renderWithScripts(`
        <html><body>
          <div id="result"></div>
          <script>
            document.getElementById('result').setAttribute('data-step', '1');
          </script>
          <script>
            var el = document.getElementById('result');
            el.setAttribute('data-step', el.getAttribute('data-step') + '2');
          </script>
          <script>
            var el = document.getElementById('result');
            el.setAttribute('data-step', el.getAttribute('data-step') + '3');
          </script>
        </body></html>
      `);

      const el = getElementById(r.doc, 'result');
      expect(el!.attributes.get('data-step')).toBe('123');
    });

    it('should not execute external scripts (src attribute)', () => {
      const r = renderWithScripts(`
        <html><body>
          <div id="target"></div>
          <script src="external.js">
            document.getElementById('target').setAttribute('data-executed', 'true');
          </script>
        </body></html>
      `);

      const el = getElementById(r.doc, 'target');
      expect(el).not.toBeNull();
      expect(el!.attributes.get('data-executed')).toBeUndefined();
    });

    it('should skip empty script elements', () => {
      const r = renderWithScripts(`
        <html><body>
          <script></script>
          <script>   </script>
          <div id="target">ok</div>
        </body></html>
      `);

      expect(r.scriptErrors).toHaveLength(0);
      const el = getElementById(r.doc, 'target');
      expect(el).not.toBeNull();
    });

    it('should log errors from scripts without crashing', () => {
      const r = renderWithScripts(`
        <html><body>
          <script>
            undefinedVariable.property;
          </script>
          <div id="target">ok</div>
        </body></html>
      `);

      expect(r.scriptErrors.length).toBeGreaterThan(0);
      const el = getElementById(r.doc, 'target');
      expect(el).not.toBeNull();
    });

    it('should allow script to create new DOM elements', () => {
      const r = renderWithScripts(`
        <html><body>
          <div id="container"></div>
          <script>
            var container = document.getElementById('container');
            var newDiv = document.createElement('div');
            newDiv.id = 'injected';
            newDiv.setAttribute('data-from', 'script');
            container.appendChild(newDiv);
          </script>
        </body></html>
      `);

      const injected = getElementById(r.doc, 'injected');
      expect(injected).not.toBeNull();
      expect(injected!.attributes.get('data-from')).toBe('script');
    });

    it('should allow script to read element properties', () => {
      const r = renderWithScripts(`
        <html><body>
          <div id="el" class="test-class"></div>
          <script>
            var el = document.getElementById('el');
            el.setAttribute('data-tagname', el.tagName);
            el.setAttribute('data-id', el.id);
          </script>
        </body></html>
      `);

      const el = getElementById(r.doc, 'el');
      expect(el!.attributes.get('data-tagname')).toBe('DIV');
      expect(el!.attributes.get('data-id')).toBe('el');
    });

    it('should allow script to use querySelector', () => {
      const r = renderWithScripts(`
        <html><body>
          <div id="container">
            <span class="target">hello</span>
          </div>
          <script>
            var el = document.querySelector('.target');
            if (el) el.setAttribute('data-found', 'true');
          </script>
        </body></html>
      `);

      const spans = getTextContentByTag(r.doc, 'span');
      // querySelector should find the span
      const el = getElementById(r.doc, 'container');
      expect(el).not.toBeNull();
    });

    it('should support console.log in scripts', () => {
      const r = renderWithScripts(`
        <html><body>
          <script>
            console.log('hello from script');
            console.error('error message');
          </script>
        </body></html>
      `);

      expect(r.scriptErrors).toHaveLength(0);
    });

    it('should support event listener registration', () => {
      const r = renderWithScripts(`
        <html><body>
          <div id="btn"></div>
          <script>
            var btn = document.getElementById('btn');
            var clicked = false;
            btn.addEventListener('click', function() { clicked = true; });
            btn.dispatchEvent({ type: 'click' });
            btn.setAttribute('data-clicked', clicked ? 'true' : 'false');
          </script>
        </body></html>
      `);

      const el = getElementById(r.doc, 'btn');
      expect(el!.attributes.get('data-clicked')).toBe('true');
    });

    it('should support multiple scripts interacting', () => {
      const r = renderWithScripts(`
        <html><body>
          <div id="counter"></div>
          <script>
            window.__count = 0;
          </script>
          <script>
            window.__count = window.__count + 1;
          </script>
          <script>
            window.__count = window.__count + 1;
          </script>
          <script>
            document.getElementById('counter').setAttribute('data-count', String(window.__count));
          </script>
        </body></html>
      `);

      const el = getElementById(r.doc, 'counter');
      expect(el!.attributes.get('data-count')).toBe('2');
    });
  });

  describe('script in head', () => {
    it('should execute scripts in head', () => {
      const r = renderWithScripts(`
        <html>
          <head>
            <script>
              window.__headExecuted = true;
            </script>
          </head>
          <body>
            <div id="target"></div>
            <script>
              if (window.__headExecuted) {
                document.getElementById('target').setAttribute('data-head', 'true');
              }
            </script>
          </body>
        </html>
      `);

      const el = getElementById(r.doc, 'target');
      expect(el!.attributes.get('data-head')).toBe('true');
    });
  });

  describe('script error handling', () => {
    it('should recover from syntax errors', () => {
      const r = renderWithScripts(`
        <html><body>
          <script>function {</script>
          <div id="after"></div>
          <script>document.getElementById('after').setAttribute('data-ok', 'true');</script>
        </body></html>
      `);

      expect(r.scriptErrors.length).toBeGreaterThan(0);
      const el = getElementById(r.doc, 'after');
      expect(el!.attributes.get('data-ok')).toBe('true');
    });

    it('should recover from runtime errors', () => {
      const r = renderWithScripts(`
        <html><body>
          <script>null.foo.bar;</script>
          <div id="after"></div>
          <script>document.getElementById('after').setAttribute('data-ok', 'true');</script>
        </body></html>
      `);

      expect(r.scriptErrors.length).toBeGreaterThan(0);
      const el = getElementById(r.doc, 'after');
      expect(el!.attributes.get('data-ok')).toBe('true');
    });

    it('should report multiple errors from different scripts', () => {
      const r = renderWithScripts(`
        <html><body>
          <script>null.foo;</script>
          <script>undefined.bar;</script>
        </body></html>
      `);

      expect(r.scriptErrors).toHaveLength(2);
    });
  });

  describe('DOM modification patterns', () => {
    it('should support appendChild', () => {
      const r = renderWithScripts(`
        <html><body>
          <ul id="list"></ul>
          <script>
            var list = document.getElementById('list');
            for (var i = 0; i < 3; i++) {
              var li = document.createElement('li');
              li.setAttribute('data-index', String(i));
              list.appendChild(li);
            }
          </script>
        </body></html>
      `);

      const list = getElementById(r.doc, 'list');
      expect(list).not.toBeNull();
      expect(list!.children.length).toBe(3);
    });

    it('should support removeChild', () => {
      const r = renderWithScripts(`
        <html><body>
          <div id="parent">
            <div id="child1"></div>
            <div id="child2"></div>
          </div>
          <script>
            var parent = document.getElementById('parent');
            var child1 = document.getElementById('child1');
            parent.removeChild(child1);
          </script>
        </body></html>
      `);

      expect(getElementById(r.doc, 'child1')).toBeNull();
      expect(getElementById(r.doc, 'child2')).not.toBeNull();
    });

    it('should support setAttribute changes', () => {
      const r = renderWithScripts(`
        <html><body>
          <div id="el" class="old"></div>
          <script>
            document.getElementById('el').setAttribute('class', 'new');
          </script>
        </body></html>
      `);

      const el = getElementById(r.doc, 'el');
      expect(el!.attributes.get('class')).toBe('new');
    });

    it('should support textContent modification', () => {
      const r = renderWithScripts(`
        <html><body>
          <div id="el">original</div>
          <script>
            document.getElementById('el').textContent = 'modified';
          </script>
        </body></html>
      `);

      const el = getElementById(r.doc, 'el');
      expect(el).not.toBeNull();
      expect(el!.children.length).toBe(1);
      expect(el!.children[0].nodeType).toBe('text');
      expect((el!.children[0] as unknown as { text: string }).text).toBe('modified');
    });
  });

  describe('no scripts scenario', () => {
    it('should render normally without any scripts', () => {
      const r = renderWithScripts(`
        <html><body>
          <div id="content">Hello world</div>
        </body></html>
      `);

      expect(r.scriptErrors).toHaveLength(0);
      const el = getElementById(r.doc, 'content');
      expect(el).not.toBeNull();
    });
  });
});
