/**
 * Web page form controls (Round A of doc/2026-10-19-nova-form-controls-plan.md). Before this,
 * an <input> was an invisible, borderless, empty box that nothing could type into, </button>
 * closed nothing, and every inline-block's content was drawn at the page's top-left.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import type { PageRendererDependencies } from '../src/browser/engine/page-renderer';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomElement } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { controlKind, formDataEntries, firstMissingRequired, controlValue } from '../src/browser/rendering/form-controls';
import { BrowserWindowPage } from '../src/ui/pages/browser-window';

async function render(html: string) {
  const domTree = new DomTree();
  const paintEngine = new PaintEngine();
  const renderer = new PageRenderer({
    htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine,
    resourceLoader: {
      loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''),
      loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn(),
    },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
  } as unknown as PageRendererDependencies);
  renderer.setViewport(412, 800, 1);
  await renderer.render({ url: 'https://example.com/page', statusCode: 200, contentType: 'text/html', body: html, headers: new Map(), loadedAt: 0 } as never, new AbortController().signal);
  const q = (sel: string) => domTree.querySelector(sel) as DomElement;
  const cmds = () => paintEngine.compositeFrame();
  const texts = () => cmds().filter((c) => c.type === 'fillText').map((c) => c.params as [string, number, number]);
  return { renderer, domTree, q, cmds, texts };
}

describe('form data and validation', () => {
  it('collects named, enabled controls; checked boxes only; the chosen option; the used submitter', async () => {
    const { q } = await render(`<html><body><form>
      <input name="q" value="cats"><input name="off" value="x" disabled><input value="noname">
      <input type="checkbox" name="safe" checked><input type="checkbox" name="no">
      <input type="radio" name="r" value="a"><input type="radio" name="r" value="b" checked>
      <select name="s"><option value="1">One</option><option selected>Two</option></select>
      <textarea name="t">hello</textarea><input type="hidden" name="h" value="k">
      <button name="go" value="1">Go</button><button name="other" value="2">Other</button>
    </form></body></html>`);
    const form = q('form');
    expect(formDataEntries(form, q('button'))).toEqual([
      ['q', 'cats'], ['safe', 'on'], ['r', 'b'], ['s', 'Two'], ['t', 'hello'], ['h', 'k'], ['go', '1'],
    ]);
  });

  it('stops at the first required control without a value', async () => {
    const { q } = await render('<html><body><form><input name="a" value="x" required><input name="b" required></form></body></html>');
    expect(firstMissingRequired(q('form'))?.attributes.get('name')).toBe('b');
  });

  it('knows each control kind', async () => {
    const { q } = await render('<html><body><input type="password"><input type="email"><input type="submit"><input type="hidden"><textarea></textarea></body></html>');
    expect(['input[type=password]', 'input[type=email]', 'input[type=submit]', 'input[type=hidden]', 'textarea'].map((s) => controlKind(q(s))))
      .toEqual(['password', 'text', 'button', 'hidden', 'textarea']);
  });
});

describe('painting form controls', () => {
  it('a text input has a border, a default width, and shows its value', async () => {
    const { q, texts } = await render('<html><body><input value="hello"></body></html>');
    const box = q('input').layoutBox!;
    expect(box.width).toBeGreaterThan(100); // ~20 characters
    expect(box.borderTop).toBe(1);
    expect(texts().some((t) => t[0] === 'hello' && t[1] >= box.x && t[1] < box.x + box.width)).toBe(true);
  });

  it('shows the placeholder (grey) when empty, dots for passwords, nothing for hidden inputs', async () => {
    const { cmds, texts } = await render('<html><body><input placeholder="Search"><input type="password" value="abc"><input type="hidden" value="secret"></body></html>');
    const all = cmds();
    const i = all.findIndex((c) => c.type === 'fillText' && c.params[0] === 'Search');
    expect(all.slice(0, i).reverse().find((c) => c.type === 'setFillStyle')!.params[0]).toBe('#757575');
    expect(texts().map((t) => t[0])).toContain('•••');
    expect(texts().map((t) => t[0])).not.toContain('secret');
  });

  it('</button> closes the button, and a button sizes to its label on the same line', async () => {
    const { q, texts } = await render('<html><body><input value="q"><button>Go</button><span>after</span></body></html>');
    expect(q('button').children.filter((c) => c.nodeType === 'element')).toHaveLength(0);
    const b = q('button').layoutBox!;
    const input = q('input').layoutBox!;
    expect(b.width).toBeLessThan(60);
    expect(b.y).toBe(input.y);
    const go = texts().find((t) => t[0] === 'Go')!;
    expect(go[1]).toBeGreaterThanOrEqual(b.x);
    expect(go[1]).toBeLessThan(b.x + b.width);
  });

  it('inline-block content is drawn inside its box, on its line', async () => {
    const { q, texts } = await render('<html><body style="margin:0"><div style="height:100px">top</div><p style="margin:0">Before <span style="display:inline-block;padding:4px">PILL</span> after</p></body></html>');
    const span = q('span').layoutBox!;
    const pill = texts().find((t) => t[0] === 'PILL')!;
    expect(span.y).toBeGreaterThanOrEqual(100);
    expect(span.width).toBeLessThan(80); // shrink-to-fit, not the full line
    expect(pill[1]).toBeGreaterThanOrEqual(span.x);
    expect(pill[2]).toBeGreaterThan(span.y);
    expect(texts().find((t) => t[0] === 'after')![2]).toBe(texts().find((t) => t[0] === 'Before')![2]);
  });
});

describe('typing, ticking and submitting (BrowserWindowPage)', () => {
  afterEach(() => document.querySelectorAll('.nova-field-editor').forEach((e) => e.remove()));

  async function pageFor(html: string, hitSelector: string) {
    const r = await render(html);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const page = new BrowserWindowPage({ hideChromeUI: true });
    await page.mount(host);
    const canvas = document.createElement('canvas');
    canvas.width = 412; canvas.height = 800;
    (page as unknown as { contentArea: HTMLElement }).contentArea.appendChild(canvas);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 412, height: 800, right: 412, bottom: 800, x: 0, y: 0, toJSON() {} });
    (page as unknown as { browserEngine: unknown }).browserEngine = {
      getPageLayoutEngine: () => ({ getElementAtPoint: () => r.q(hitSelector) }),
      dispatchPageEvent: (el: DomElement, type: string) => r.renderer.dispatchPageEvent(el, type),
    };
    const navigate = vi.spyOn(page, 'navigate').mockResolvedValue();
    vi.spyOn(page as unknown as { resolveContextUrl: (h: string) => string }, 'resolveContextUrl').mockImplementation((h) => new URL(h, 'https://example.com/page').href);
    return { ...r, page, navigate };
  }

  it('a tap on a text input opens a real field over it; typing updates the page; Enter submits with GET', async () => {
    const { page, q, navigate } = await pageFor('<html><body><form action="/search"><input name="q" placeholder="Search"><input type="hidden" name="lang" value="en"></form></body></html>', 'input[name=q]');
    expect(page.activateAt(10, 10)).toBe('field');
    const field = document.querySelector('.nova-field-editor') as HTMLInputElement;
    expect(field).toBeTruthy();
    expect(field.placeholder).toBe('Search');
    expect(parseFloat(field.style.width)).toBeGreaterThan(100);
    field.value = 'nova browser';
    field.dispatchEvent(new Event('input'));
    expect(controlValue(q('input[name=q]'))).toBe('nova browser');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(navigate).toHaveBeenCalledWith('https://example.com/search?q=nova+browser&lang=en');
    expect(document.querySelector('.nova-field-editor')).toBeNull();
  });

  it('a submit button submits; a checkbox toggles; required blocks; a script can cancel submit', async () => {
    const sub = await pageFor('<html><body><form action="/s"><input name="a" value="1"><button>Go</button></form></body></html>', 'button');
    expect(sub.page.activateAt(10, 10)).toBe('submit');
    expect(sub.navigate).toHaveBeenCalledWith('https://example.com/s?a=1');

    const box = await pageFor('<html><body><input type="checkbox" id="c"></body></html>', '#c');
    box.page.activateAt(10, 10);
    expect(box.q('#c').formChecked).toBe(true);

    const req = await pageFor('<html><body><form action="/s"><input name="a" required><button>Go</button></form></body></html>', 'button');
    req.page.activateAt(10, 10);
    expect(req.navigate).not.toHaveBeenCalled();

    const js = await pageFor(`<html><body><form action="/s"><input name="a" value="1"><button>Go</button></form>
      <script>document.querySelector('form').addEventListener('submit', function (e) { e.preventDefault(); });</script></body></html>`, 'button');
    js.page.activateAt(10, 10);
    expect(js.navigate).not.toHaveBeenCalled();
  });
});

describe('script access to control values', () => {
  it('input.value reads what was typed and can be set', async () => {
    const { q, renderer } = await render(`<html><body><input id="i" value="start"><p id="out"></p>
      <script>
        var i = document.getElementById('i');
        i.addEventListener('input', function () { document.getElementById('out').textContent = 'saw ' + i.value; });
      </script></body></html>`);
    q('#i').formValue = 'typed';
    renderer.dispatchPageEvent(q('#i'), 'input');
    const out = q('#out').children.map((c) => (c as { text?: string }).text ?? '').join('');
    expect(out).toBe('saw typed');
  });
});
