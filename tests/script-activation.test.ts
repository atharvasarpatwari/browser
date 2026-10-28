/**
 * Navigation started by page scripts: el.click() on a link or submit button, form.submit(),
 * form.requestSubmit(), form.reset(). click() fired the event and did nothing; the form methods
 * did not exist. See doc/2026-10-28-nova-android-1.35-*.md.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runJS } from '../src/browser/js/index';
import { setActivationHandler, type ActivationHandler } from '../src/browser/js/dom-bindings';
import { DomTree, type DomElement } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { BrowserWindowPage } from '../src/ui/pages/browser-window';

const page = (html: string) => {
  const domTree = new DomTree();
  const doc = domTree.buildFromHtml((new HtmlParser().parse(html) as unknown as { document: never }).document);
  return { domTree, run: (src: string) => runJS(src, { document: doc, domTree } as never) };
};

describe('script-initiated activation', () => {
  afterEach(() => setActivationHandler(null));
  const html = '<html><body><a id="l" href="/next">next</a><form id="f" action="/s"><input id="q" name="q" value="orig"><button id="b">Go</button></form></body></html>';

  it('el.click() runs the default action unless a listener cancels it', () => {
    const handler: ActivationHandler = { activate: vi.fn(), submit: vi.fn() };
    setActivationHandler(handler);
    const { domTree, run } = page(html);
    run('document.getElementById("l").click()');
    expect(handler.activate).toHaveBeenCalledWith(domTree.getElementById('l'));

    (handler.activate as ReturnType<typeof vi.fn>).mockClear();
    run('var l = document.getElementById("l"); l.addEventListener("click", function(e){ e.preventDefault(); }); l.click();');
    expect(handler.activate).not.toHaveBeenCalled();
  });

  it('form.submit() skips the submit event; requestSubmit() fires it; reset() restores markup values', () => {
    const handler: ActivationHandler = { activate: vi.fn(), submit: vi.fn() };
    setActivationHandler(handler);
    const { domTree, run } = page(html);
    const form = domTree.getElementById('f')!;
    run('document.getElementById("f").submit()');
    expect(handler.submit).toHaveBeenLastCalledWith(form, null, false);
    run('var f = document.getElementById("f"); f.requestSubmit(document.getElementById("b"))');
    expect(handler.submit).toHaveBeenLastCalledWith(form, domTree.getElementById('b'), true);

    domTree.getElementById('q')!.formValue = 'typed';
    let reset = false;
    run('document.getElementById("f").addEventListener("reset", function(){ window.didReset = true; }); document.getElementById("f").reset(); window.didReset');
    reset = domTree.getElementById('q')!.formValue === undefined;
    expect(reset).toBe(true);
  });
});

describe('BrowserWindowPage.activateElement', () => {
  let container: HTMLElement | undefined;
  afterEach(() => container?.remove());

  it('follows a link and submits a GET form like a tap does', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    const win = new BrowserWindowPage({ hideChromeUI: true });
    await win.mount(container);
    const navigate = vi.spyOn(win, 'navigate').mockResolvedValue(undefined);
    const { domTree } = page('<html><body><a id="l" href="https://example.com/next">n</a><form id="f" action="https://example.com/s"><input name="q" value="cats"><button id="b">Go</button></form></body></html>');

    expect(win.activateElement(domTree.getElementById('l') as DomElement)).toBe('link');
    expect(navigate).toHaveBeenLastCalledWith('https://example.com/next');

    expect(win.activateElement(domTree.getElementById('b') as DomElement)).toBe('submit');
    expect(navigate).toHaveBeenLastCalledWith('https://example.com/s?q=cats');
    await win.unmount?.();
  });
});
