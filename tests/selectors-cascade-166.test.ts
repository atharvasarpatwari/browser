/**
 * 1.66: a 72-case probe of selectors and the cascade (58 passed). Fixes: Tailwind-style escaped
 * class names, :has() relative selectors, -n+B / "of S" / only-child / :lang / form-state
 * pseudo-classes, :empty with text, stylesheet !important vs inline, and @layer ordering.
 */
import { describe, expect, it, vi } from 'vitest';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import { PageRenderer } from '../src/browser/engine/page-renderer';

async function page(css: string, html: string) {
  const domTree = new DomTree();
  const r = new PageRenderer({ htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine: new PaintEngine(), svgDecode: async () => null,
    resourceLoader: { loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn().mockResolvedValue(''), loadScript: vi.fn().mockResolvedValue(''), loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn() },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() } } as never);
  r.setViewport(600, 760, 1);
  await r.render({ url: 'http://t.local/', statusCode: 200, contentType: 'text/html', headers: new Map(), loadedAt: 0,
    body: `<html><head><style>${css}</style></head><body>${html}</body></html>` } as never, new AbortController().signal);
  return { domTree, r, frame: () => (r as unknown as { reflowController: { processFrame(): void } }).reflowController.processFrame() };
}

// [name, css, html, id, property, expected computed value]
const CASES: Array<[string, string, string, string, string, string]> = [
  ['nth-child(2n+1)', 'li:nth-child(2n+1){display:flex}', '<ul><li>a</li><li>b</li><li id="t">c</li></ul>', 't', 'display', 'flex'],
  ['nth-child(odd) not even', 'li:nth-child(odd){display:flex}', '<ul><li>a</li><li id="t">b</li></ul>', 't', 'display', 'list-item'],
  ['nth-child(even)', 'li:nth-child(even){display:flex}', '<ul><li>a</li><li id="t">b</li></ul>', 't', 'display', 'flex'],
  ['nth-child(n+3)', 'li:nth-child(n+3){display:flex}', '<ul><li>a</li><li>b</li><li id="t">c</li></ul>', 't', 'display', 'flex'],
  ['nth-child(-n+2)', 'li:nth-child(-n+2){display:flex}', '<ul><li>a</li><li id="t">b</li><li>c</li></ul>', 't', 'display', 'flex'],
  ['nth-last-child(1)', 'li:nth-last-child(1){display:flex}', '<ul><li>a</li><li id="t">b</li></ul>', 't', 'display', 'flex'],
  ['nth-of-type(2)', 'p:nth-of-type(2){display:flex}', '<div><span>s</span><p>a</p><span>s</span><p id="t">b</p></div>', 't', 'display', 'flex'],
  ['first-of-type', 'p:first-of-type{display:flex}', '<div><span>s</span><p id="t">a</p><p>b</p></div>', 't', 'display', 'flex'],
  ['last-of-type', 'p:last-of-type{display:flex}', '<div><p>a</p><p id="t">b</p><span>s</span></div>', 't', 'display', 'flex'],
  ['only-child', 'p:only-child{display:flex}', '<div><p id="t">a</p></div>', 't', 'display', 'flex'],
  ['first-child', 'p:first-child{display:flex}', '<div><p id="t">a</p><p>b</p></div>', 't', 'display', 'flex'],
  ['last-child', 'p:last-child{display:flex}', '<div><p>a</p><p id="t">b</p></div>', 't', 'display', 'flex'],
  ['nth-child(2 of .x)', 'p:nth-child(2 of .x){display:flex}', '<div><p class="x">a</p><p>b</p><p class="x" id="t">c</p></div>', 't', 'display', 'flex'],
  [':not(.x)', 'p:not(.x){display:flex}', '<p id="t">a</p>', 't', 'display', 'flex'],
  [':not(.a, .b)', 'p:not(.a, .b){display:flex}', '<p id="t" class="c">a</p>', 't', 'display', 'flex'],
  [':has(> img)', 'div:has(> img){display:flex}', '<div id="t"><img alt=""></div>', 't', 'display', 'flex'],
  [':has(.x) deep', 'section:has(.x){display:flex}', '<section id="t"><div><b class="x">x</b></div></section>', 't', 'display', 'flex'],
  [':has(+ p)', 'h2:has(+ p){display:flex}', '<h2 id="t">h</h2><p>p</p>', 't', 'display', 'flex'],
  ['[href^=https]', 'a[href^="https"]{display:flex}', '<a id="t" href="https://x.test">a</a>', 't', 'display', 'flex'],
  ['[href$=.pdf]', 'a[href$=".pdf"]{display:flex}', '<a id="t" href="/f.pdf">a</a>', 't', 'display', 'flex'],
  ['[href*=ex]', 'a[href*="ex"]{display:flex}', '<a id="t" href="/next">a</a>', 't', 'display', 'flex'],
  ['[class~=b]', '[class~="b"]{display:flex}', '<p id="t" class="a b c">a</p>', 't', 'display', 'flex'],
  ['[lang|=en]', '[lang|="en"]{display:flex}', '<p id="t" lang="en-GB">a</p>', 't', 'display', 'flex'],
  ['[type=TEXT i]', 'input[type="TEXT" i]{display:flex}', '<input id="t" type="text">', 't', 'display', 'flex'],
  ['[data-state=open] unquoted', '[data-state=open]{display:flex}', '<p id="t" data-state="open">a</p>', 't', 'display', 'flex'],
  ['~ sibling', 'h2 ~ p{display:flex}', '<h2>h</h2><span>s</span><p id="t">p</p>', 't', 'display', 'flex'],
  ['+ adjacent not', 'h2 + p{display:flex}', '<h2>h</h2><span>s</span><p id="t">p</p>', 't', 'display', 'block'],
  [':empty', 'div:empty{display:flex}', '<div id="t"></div>', 't', 'display', 'flex'],
  [':empty with comment', 'div:empty{display:flex}', '<div id="t"><!-- c --></div>', 't', 'display', 'flex'],
  [':root', ':root{--d:flex} p{display:var(--d)}', '<p id="t">a</p>', 't', 'display', 'flex'],
  [':where() is 0 specificity', ':where(#t){display:flex} p{display:grid}', '<p id="t">a</p>', 't', 'display', 'grid'],
  [':is() takes max specificity', ':is(#t, .y){display:flex} p.z{display:grid}', '<p id="t" class="z">a</p>', 't', 'display', 'flex'],
  [':checked + span', 'input:checked + span{display:flex}', '<input type="checkbox" checked><span id="t">s</span>', 't', 'display', 'flex'],
  [':disabled', 'button:disabled{display:flex}', '<button id="t" disabled>b</button>', 't', 'display', 'flex'],
  [':any-link', 'a:any-link{display:flex}', '<a id="t" href="/x">a</a>', 't', 'display', 'flex'],
  [':placeholder-shown', 'input:placeholder-shown{display:flex}', '<input id="t" placeholder="p">', 't', 'display', 'flex'],
  [':required', 'input:required{display:flex}', '<input id="t" required>', 't', 'display', 'flex'],
  [':lang(fr)', 'p:lang(fr){display:flex}', '<div lang="fr"><p id="t">a</p></div>', 't', 'display', 'flex'],
  ['id beats class', '#t{display:flex} .c{display:grid}', '<p id="t" class="c">a</p>', 't', 'display', 'flex'],
  ['later wins on tie', '.c{display:flex} .d{display:grid}', '<p id="t" class="c d">a</p>', 't', 'display', 'grid'],
  ['inline beats id', '#t{display:flex}', '<p id="t" style="display:grid">a</p>', 't', 'display', 'grid'],
  ['!important beats inline', 'p{display:flex !important}', '<p id="t" style="display:grid">a</p>', 't', 'display', 'flex'],
  ['var fallback', 'p{display:var(--missing, grid)}', '<p id="t">a</p>', 't', 'display', 'grid'],
  ['var inherited from parent', '.w{--d:flex} p{display:var(--d)}', '<div class="w"><p id="t">a</p></div>', 't', 'display', 'flex'],
  ['var nested fallback', 'p{display:var(--a, var(--b, flex))}', '<p id="t">a</p>', 't', 'display', 'flex'],
  ['@media min-width', '@media (min-width: 500px){p{display:flex}}', '<p id="t">a</p>', 't', 'display', 'flex'],
  ['@media max-width not', '@media (max-width: 500px){p{display:flex}}', '<p id="t">a</p>', 't', 'display', 'block'],
  ['@media range >=', '@media (width >= 500px){p{display:flex}}', '<p id="t">a</p>', 't', 'display', 'flex'],
  ['@media range <', '@media (width < 500px){p{display:flex}}', '<p id="t">a</p>', 't', 'display', 'block'],
  ['@media portrait', '@media (orientation: portrait){p{display:flex}}', '<p id="t">a</p>', 't', 'display', 'flex'],
  ['@media not print', '@media not print{p{display:flex}}', '<p id="t">a</p>', 't', 'display', 'flex'],
  ['@media print not', '@media print{p{display:flex}}', '<p id="t">a</p>', 't', 'display', 'block'],
  ['@supports', '@supports (display: grid){p{display:flex}}', '<p id="t">a</p>', 't', 'display', 'flex'],
  ['@supports not', '@supports not (display: grid){p{display:flex}}', '<p id="t">a</p>', 't', 'display', 'block'],
  ['@layer order', '@layer a, b; @layer b{p{display:flex}} @layer a{p{display:grid}}', '<p id="t">a</p>', 't', 'display', 'flex'],
  ['unlayered beats layered', '@layer a{#t{display:grid}} p{display:flex}', '<p id="t">a</p>', 't', 'display', 'flex'],
  ['nesting &', '.c{ & .k{display:flex} }', '<div class="c"><p id="t" class="k">a</p></div>', 't', 'display', 'flex'],
  ['nesting implicit', '.c{ .k{display:flex} }', '<div class="c"><p id="t" class="k">a</p></div>', 't', 'display', 'flex'],
  ['nesting &.x', '.c{ &.x{display:flex} }', '<p id="t" class="c x">a</p>', 't', 'display', 'flex'],
  ['initial', 'p{display:initial}', '<p id="t">a</p>', 't', 'display', 'inline'],
  ['unset non-inherited', 'p{display:unset}', '<p id="t">a</p>', 't', 'display', 'inline'],
  ['revert to UA', 'p{display:flex} p{display:revert}', '<p id="t">a</p>', 't', 'display', 'block'],
  ['inherit', 'div{display:flex} p{display:inherit}', '<div><p id="t">a</p></div>', 't', 'display', 'flex'],
  ['uppercase property', 'p{DISPLAY:flex}', '<p id="t">a</p>', 't', 'display', 'flex'],
  ['shorthand then longhand', 'p{margin:10px;margin-left:5px}', '<p id="t">a</p>', 't', 'margin-left', '5px'],
  ['longhand then shorthand', 'p{margin-left:5px;margin:10px}', '<p id="t">a</p>', 't', 'margin-left', '10px'],
  ['comment inside block', 'p{/* x */display:flex/* y */}', '<p id="t">a</p>', 't', 'display', 'flex'],
  ['forgiving :is with invalid', ':is(p, ::-webkit-bogus-x){display:flex}', '<p id="t">a</p>', 't', 'display', 'flex'],
  ['attribute value with space', '[title="a b"]{display:flex}', '<p id="t" title="a b">a</p>', 't', 'display', 'flex'],
  ['escaped class', '.md\\:flex{display:flex}', '<p id="t" class="md:flex">a</p>', 't', 'display', 'flex'],
  ['class with slash (tailwind)', '.w-1\\/2{display:flex}', '<p id="t" class="w-1/2">a</p>', 't', 'display', 'flex'],
  [':empty not with text', 'div:empty{display:flex}', '<div id="t">x</div>', 't', 'display', 'block'],
  ['layered !important beats unlayered !important', '@layer a{p{display:flex !important}} p{display:grid !important}', '<p id="t">a</p>', 't', 'display', 'flex'],
  ['@layer statement after a layer', '@layer x{p{display:grid}} @layer y, z; @layer z{p{display:flex}} @layer y{p{display:block}}', '<p id="t">a</p>', 't', 'display', 'flex'],
  ['escaped responsive class in @media', '@media (min-width: 500px){.md\\:flex{display:flex}}', '<p id="t" class="md:flex">a</p>', 't', 'display', 'flex'],
];


describe('selectors and the cascade', () => {
  it.each(CASES)('%s', async (_name, css, html, id, prop, want) => {
    const { domTree, r } = await page(css, html);
    expect(domTree.getElementById(id)?.computedStyle?.get(prop)).toBe(want);
    r.dispose();
  });

  it('tapping a checkbox restyles input:checked + span', async () => {
    const { domTree, r, frame } = await page('input:checked + span{display:flex}', '<input id="c" type="checkbox"><span id="t">s</span>');
    frame();
    expect(domTree.getElementById('t')!.computedStyle!.get('display')).toBe('inline');
    const box = domTree.getElementById('c')!;
    box.formChecked = true; // what a tap's toggleControl does
    r.repaintElement(box);
    frame();
    expect(domTree.getElementById('t')!.computedStyle!.get('display')).toBe('flex');
    r.dispose();
  });

  it('escaped class names survive the stylesheet round trip', () => {
    const sheet = new CssParser().parseStylesheet('.md\\:flex{display:flex} .w-1\\/2{width:50%} .\\31 0{x:y}');
    expect(sheet.rules.map((rule) => rule.selector)).toEqual(['*.md\\:flex', '*.w-1\\/2', '*.\\31 0']);
  });
});
