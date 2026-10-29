/**
 * End-to-end paint check on a copy of example.com at phone width — the page where the
 * Android build showed a box outline round every block, first letters clipped at the left
 * edge, a missing <h1>, and (traced here) a link box as tall as the page.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { PageRenderer } from '../src/browser/engine/page-renderer';
import type { PageRendererDependencies } from '../src/browser/engine/page-renderer';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { CssParser } from '../src/browser/rendering/css-parser';
import { LayoutEngine } from '../src/browser/rendering/layout-engine';
import { PaintEngine } from '../src/browser/rendering/paint-engine';
import type { DomElement } from '../src/browser/rendering/dom-tree';

const PAGE = readFileSync(path.resolve(__dirname, 'fixtures/example-domain.html'), 'utf8');

async function renderAtPhoneWidth(page = PAGE, script = '', sheets: Record<string, string> = {}) {
  const domTree = new DomTree();
  const paintEngine = new PaintEngine();
  const renderer = new PageRenderer({
    htmlParser: new HtmlParser(), domTree, cssParser: new CssParser(), layoutEngine: new LayoutEngine(), paintEngine,
    resourceLoader: {
      loadResource: vi.fn(), loadBatch: vi.fn(), loadStylesheet: vi.fn(async (url: string) => sheets[url] ?? ''), loadScript: vi.fn().mockResolvedValue(script),
      loadImage: vi.fn(), getPriority: vi.fn(), setMaxConcurrent: vi.fn(), on: vi.fn(), off: vi.fn(), dispose: vi.fn(),
    },
    prioritizer: { submit: vi.fn(), submitBatch: vi.fn(), submitPreload: vi.fn(), submitPrefetch: vi.fn(), submitPreconnect: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
  } as unknown as PageRendererDependencies);
  renderer.setViewport(412, 800, 1);
  await renderer.render({
    url: 'https://example.com/', statusCode: 200, contentType: 'text/html', body: page,
    headers: new Map([['content-type', 'text/html']]), loadedAt: Date.now(),
  }, new AbortController().signal);
  const texts = paintEngine.compositeFrame().filter((c) => c.type === 'fillText').map((c) => c.params as [string, number, number, number]);
  const all: DomElement[] = [];
  const walk = (n: DomElement) => { all.push(n); for (const c of n.children ?? []) if ((c as DomElement).tagName) walk(c as DomElement); };
  walk(domTree.getDocument()!.bodyElement as DomElement);
  return { texts, find: (tag: string) => all.find((n) => n.tagName.toLowerCase() === tag)!, paintEngine };
}

describe('example.com at phone width', () => {
  it('paints only body content: no <title>/<style> text', async () => {
    const { texts } = await renderAtPhoneWidth();
    const painted = texts.map((t) => t[0]).join('');
    expect(painted).toContain('Example');
    expect(painted).not.toContain('background-color');
    expect(painted.split('Example').length - 1).toBe(1); // the <h1>, not also the <title>
  });

  it('draws text inside its box, not at x=0', async () => {
    const { texts, find } = await renderAtPhoneWidth();
    const h1 = find('h1').layoutBox!;
    const [, x] = texts.find((t) => t[0] === 'Example')!;
    expect(h1.x).toBeGreaterThan(0);
    expect(x).toBeCloseTo(h1.x, 0);
  });

  it('draws no border where border-style is none', async () => {
    const { find } = await renderAtPhoneWidth();
    expect(find('div').computedStyle?.get('border-top-width')).toBe('0px');
    expect(find('a').layoutBox!.borderLeft).toBe(0);
  });

  it('gives the inline link a line-sized box, not one reaching from the top of the page', async () => {
    const { find } = await renderAtPhoneWidth();
    expect(find('a').layoutBox!.height).toBeLessThan(40);
  });

  it('collapses source indentation inside a paragraph to a single space', async () => {
    // Source: "You may use this" + newline + 4-space indent + "domain in literature"; same line at 412px.
    const { texts } = await renderAtPhoneWidth();
    const i = texts.findIndex((t) => t[0] === 'this');
    const [, thisX, thisY, thisW] = texts[i]!;
    const domain = texts.slice(i).find((t) => t[0] === 'domain')!;
    expect(domain[2]).toBe(thisY);
    expect(domain[1] - (thisX + thisW)).toBeLessThan(8); // one space at 16px, not five
  });
});

describe('text-align', () => {
  const page = (align: string) => `<html><head><style>
    body { margin: 0; } h1 { text-align: ${align}; font-size: 20px; margin: 0; } .wrap { padding: 0 10px; }
  </style></head><body><div class="wrap"><h1>Hi</h1></div></body></html>`;
  const hiRun = async (align: string) => {
    const { texts, find } = await renderAtPhoneWidth(page(align));
    const [, x, , w] = texts.find((t) => t[0] === 'Hi')!;
    return { x, w, box: find('h1').layoutBox! };
  };

  it('left/start keeps the line at the content edge', async () => {
    const { x, box } = await hiRun('left');
    expect(x).toBeCloseTo(box.x, 0);
  });

  it('center puts the line in the middle of the content box', async () => {
    const { x, w, box } = await hiRun('center');
    expect(x + w / 2).toBeCloseTo(box.x + box.width / 2, 0);
  });

  it('right/end puts the line against the right content edge', async () => {
    for (const align of ['right', 'end']) {
      const { x, w, box } = await hiRun(align);
      expect(x + w).toBeCloseTo(box.x + box.width, 0);
    }
  });

  it('is inherited: a centred parent centres its children', async () => {
    const { texts, find } = await renderAtPhoneWidth(`<html><head><style>body{margin:0;text-align:center} p{margin:0}</style></head><body><p>Hi</p></body></html>`);
    const [, x, , w] = texts.find((t) => t[0] === 'Hi')!;
    const p = find('p').layoutBox!;
    expect(x + w / 2).toBeCloseTo(p.x + p.width / 2, 0);
  });
});

describe('canvas background (CSS Backgrounds §2.11.2)', () => {
  const canvasFill = (pe: PaintEngine) =>
    pe.compositeFrame().find((c) => c.type === 'setFillStyle')!.params[0];

  it('a short page fills the rest of the screen with the body background, not white', async () => {
    const { paintEngine, find } = await renderAtPhoneWidth();
    expect(canvasFill(paintEngine)).toBe(find('body').computedStyle?.get('background-color'));
  });

  it('the root element background wins over the body', async () => {
    const { paintEngine } = await renderAtPhoneWidth('<html style="background:rgb(1, 2, 3)"><body style="background:rgb(9, 9, 9)"><p>x</p></body></html>');
    expect(canvasFill(paintEngine)).toBe('rgb(1, 2, 3)');
  });

  it('stays white when neither sets a background', async () => {
    const { paintEngine } = await renderAtPhoneWidth('<html><body><p>x</p></body></html>');
    expect(canvasFill(paintEngine)).toBe('#ffffff');
  });
});

describe('inline elements flow inside the line', () => {
  const PARA = `<html><head><style>body{margin:0} p{margin:0} a{color:rgb(0, 0, 200)}</style></head>
    <body><p>Read <a href="#">more</a> here and <b>bold</b> too.</p></body></html>`;

  it('keeps a sentence with a link and <b> on one line, words in order', async () => {
    const { texts } = await renderAtPhoneWidth(PARA);
    const words = texts.filter((t) => t[0].trim()).sort((a, b) => a[1] - b[1]);
    expect(words.map((t) => t[0])).toEqual(['Read', 'more', 'here', 'and', 'bold', 'too.']); // "too." is one word since 1.40
    expect(new Set(words.map((t) => Math.round(t[2]))).size).toBe(1);
  });

  it('paints the link text in the link colour and gives the link a word-sized box', async () => {
    const { paintEngine, find } = await renderAtPhoneWidth(PARA);
    const cmds = paintEngine.compositeFrame();
    const i = cmds.findIndex((c) => c.type === 'fillText' && c.params[0] === 'more');
    const fill = cmds.slice(0, i).reverse().find((c) => c.type === 'setFillStyle')!;
    expect(fill.params[0]).toBe('rgb(0, 0, 200)');
    const a = find('a').layoutBox!;
    const [, x, , w] = cmds[i]!.params as [string, number, number, number];
    expect(a.x).toBeCloseTo(x, 0);
    expect(a.width).toBeCloseTo(w, 0);
    expect(a.height).toBeLessThan(40);
  });
});

describe('the 2026 example.com (light-dark(), functional colours)', () => {
  // Real page as served on 2026-10-18; it rendered as a black screen on the phone in 1.13.
  const REAL = readFileSync(path.resolve(__dirname, 'fixtures/example-com-2026/index.html'), 'utf8').replace('<script src=/s.js></script>', '');

  it('fills the canvas with the light value of html{background:light-dark(#eee,#222)}, not black', async () => {
    const { paintEngine, find } = await renderAtPhoneWidth(REAL);
    const fill = paintEngine.compositeFrame().find((c) => c.type === 'setFillStyle')!.params[0];
    expect(fill).toBe('#eee');
    expect(find('p')).toBeTruthy();
  });

  it('keeps functional values whole in the background shorthand', async () => {
    const { find } = await renderAtPhoneWidth(`<html><body>
      <p id="a" style="background: rgb(1, 2, 3)">a</p>
      <p id="b" style="background: linear-gradient(to right, red, blue)">b</p></body></html>`);
    const ps = [find('p')];
    expect(ps[0]!.computedStyle?.get('background-color')).toBe('rgb(1, 2, 3)');
  });
});

describe('rasterizer colours', () => {
  it('parses hsl()/hsla() instead of drawing them black', async () => {
    const { parseColor } = await import('../src/browser/rendering/rasterizer');
    expect(parseColor('hsl(120, 100%, 50%)')).toEqual({ r: 0, g: 255, b: 0, a: 1 });
    expect(parseColor('hsla(0, 100%, 50%, 0.5)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
    expect(parseColor('hsl(240deg 100% 50% / 25%)')).toEqual({ r: 0, g: 0, b: 255, a: 0.25 });
  });
});

describe('inline style shorthands', () => {
  it('expands style="margin/padding/border/background" into longhands', async () => {
    const { find } = await renderAtPhoneWidth(`<html><body style="margin:0">
      <div style="margin: 0 auto; width: 200px; padding: 8px 4px; border: 2px solid rgb(1, 2, 3); background: rgb(9, 8, 7)">x</div></body></html>`);
    const s = find('div').computedStyle!;
    expect([s.get('margin-left'), s.get('padding-top'), s.get('padding-left')]).toEqual(['auto', '8px', '4px']);
    expect([s.get('border-top-width'), s.get('border-top-style'), s.get('background-color')]).toEqual(['2px', 'solid', 'rgb(9, 8, 7)']);
    const box = find('div').layoutBox!;
    expect(box.x).toBeGreaterThan(50); // centred by margin: 0 auto
  });
});

describe('block widths: auto margins, max-width, margins with width:auto', () => {
  const box = async (css: string) => {
    const { find } = await renderAtPhoneWidth(`<html><head><style>body{margin:0} div{${css}}</style></head><body><div>x</div></body></html>`);
    return find('div').layoutBox!;
  };

  it('margin: 0 auto centres a fixed-width box', async () => {
    const b = await box('width: 200px; margin: 0 auto; box-sizing: content-box');
    expect(b.width).toBe(200);
    expect(b.x).toBeCloseTo((412 - 200) / 2, 0);
  });

  it('max-width caps an auto-width box, and auto margins centre it', async () => {
    const b = await box('max-width: 300px; margin: 0 auto');
    expect(b.width).toBe(300);
    expect(b.x).toBeCloseTo(56, 0);
  });

  it('width:auto leaves room for the margins instead of overflowing', async () => {
    const b = await box('margin: 0 20px');
    expect(b.x).toBe(20);
    expect(b.width).toBe(412 - 40);
  });

  it('margin-left: auto pushes the box right', async () => {
    const b = await box('width: 100px; margin-left: auto; box-sizing: content-box');
    expect(b.x + b.width).toBeCloseTo(412, 0);
  });

  it('min-width wins over a smaller max-width-capped width', async () => {
    const b = await box('max-width: 100px; min-width: 150px');
    expect(b.width).toBe(150);
  });
});

describe('the 2026 example.com script (s.js), loaded as <script src>', () => {
  it('runs without errors and adds the translations, the link and the icon', async () => {
    const html = readFileSync(path.resolve(__dirname, 'fixtures/example-com-2026/index.html'), 'utf8');
    const js = readFileSync(path.resolve(__dirname, 'fixtures/example-com-2026/s.js'), 'utf8');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { find, texts } = await renderAtPhoneWidth(html, js);
      expect(errors.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[ScriptEngine]'))).toEqual([]);
      const body = find('body');
      const kids = body.children.filter((c): c is DomElement => c.nodeType === 'element').map((c) => c.tagName.toLowerCase());
      // style + svg prepended, the English <p> moved first, 5 translations, the link
      expect(kids.filter((t) => t === 'p')).toHaveLength(6);
      expect(kids).toContain('a');
      expect(kids.slice(0, 2)).toEqual(['style', 'svg']);
      expect(texts.some((t) => t[0] === 'Learn')).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });
});

describe('styles added by scripts, link colour, underlines', () => {
  it('applies a <style> a script inserts (example.com s.js: p+p { font-size: .875em; opacity: .6 })', async () => {
    const { find } = await renderAtPhoneWidth(`<html><body><p id="a">a</p><p id="b">b</p>
      <script>document.body.insertAdjacentHTML('afterbegin', '<style>p+p{font-size:10px;color:rgb(1, 2, 3)}</style>')</script></body></html>`);
    const ps = find('body').children.filter((c): c is DomElement => c.nodeType === 'element').filter((c) => c.tagName === 'p');
    expect(ps[1]!.computedStyle?.get('font-size')).toBe('10px');
    expect(ps[1]!.computedStyle?.get('color')).toBe('rgb(1, 2, 3)');
    expect(ps[0]!.computedStyle?.get('font-size')).not.toBe('10px');
  });

  it('paints an unstyled link in link blue, not black', async () => {
    const { paintEngine } = await renderAtPhoneWidth('<html><body><p><a href="/x">Link</a></p></body></html>');
    const cmds = paintEngine.compositeFrame();
    const i = cmds.findIndex((c) => c.type === 'fillText' && c.params[0] === 'Link');
    const fill = cmds.slice(0, i).reverse().find((c) => c.type === 'setFillStyle')!;
    expect(fill.params[0]).toBe('#0000ee');
  });

  it('underlines link text under the baseline, across the run width', async () => {
    const { paintEngine } = await renderAtPhoneWidth('<html><body style="margin:0"><p style="margin:0"><a href="/x">Link</a> plain</p></body></html>');
    const cmds = paintEngine.compositeFrame();
    const i = cmds.findIndex((c) => c.type === 'fillText' && c.params[0] === 'Link');
    const [, x, y, w] = cmds[i]!.params as [string, number, number, number];
    const line = cmds.slice(i + 1).find((c) => c.type === 'fillRect')!;
    const [lx, ly, lw, lh] = line.params as number[];
    expect(lx).toBeCloseTo(x, 0);
    expect(lw).toBeCloseTo(w, 0);
    expect(ly).toBeGreaterThan(y);
    expect(lh).toBeGreaterThanOrEqual(1);
    // "plain" is not underlined
    const j = cmds.findIndex((c) => c.type === 'fillText' && c.params[0] === 'plain');
    expect(cmds[j + 1]?.type).not.toBe('fillRect');
  });
});

describe('opacity', () => {
  it('fades an element\'s text with its opacity (example.com: p+p { opacity: .6 })', async () => {
    const { paintEngine } = await renderAtPhoneWidth('<html><body><p style="opacity:0.5">Faded</p><p>Solid</p></body></html>');
    const cmds = paintEngine.compositeFrame();
    const alphaBefore = (word: string) => {
      const i = cmds.findIndex((c) => c.type === 'fillText' && c.params[0] === word);
      const a = cmds.slice(0, i).reverse().find((c) => c.type === 'setGlobalAlpha');
      return a ? (a.params[0] as number) : 1;
    };
    expect(alphaBefore('Faded')).toBeCloseTo(0.5, 2);
    expect(alphaBefore('Solid')).toBe(1);
  });
});

describe('external stylesheets (<link rel=stylesheet>)', () => {
  // They were recorded as "__external__" placeholders and never fetched: most real sites,
  // which keep their CSS in files, rendered unstyled.
  it('fetches the sheet (resolved against the page URL) and applies its rules', async () => {
    const { find } = await renderAtPhoneWidth(
      '<html><head><link rel="stylesheet" href="/css/site.css"></head><body><p>x</p></body></html>', '',
      { 'https://example.com/css/site.css': 'p { color: rgb(0, 100, 0); font-size: 22px }' });
    expect(find('p').computedStyle?.get('color')).toBe('rgb(0, 100, 0)');
    expect(find('p').computedStyle?.get('font-size')).toBe('22px');
  });

  it('keeps cascade order: a later <style> overrides the linked sheet, and survives scripts', async () => {
    const { find } = await renderAtPhoneWidth(
      '<html><head><link rel="stylesheet" href="a.css"><style>p { color: rgb(9, 9, 9) }</style></head><body><p>x</p><script>1</script></body></html>', '1',
      { 'https://example.com/a.css': 'p { color: rgb(0, 100, 0); font-weight: 700 }' });
    expect(find('p').computedStyle?.get('color')).toBe('rgb(9, 9, 9)');
    expect(find('p').computedStyle?.get('font-weight')).toBe('700');
  });
});

describe('@import and <link media>', () => {
  it('loads @import-ed sheets (relative to the importing sheet), before the importer\'s own rules', async () => {
    const { find } = await renderAtPhoneWidth(
      '<html><head><link rel="stylesheet" href="/css/main.css"></head><body><p>x</p></body></html>', '',
      {
        'https://example.com/css/main.css': '@import url("base.css");\np { color: rgb(1, 1, 1) }',
        'https://example.com/css/base.css': 'p { color: rgb(2, 2, 2); font-size: 21px }',
      });
    expect(find('p').computedStyle?.get('font-size')).toBe('21px');      // from the import
    expect(find('p').computedStyle?.get('color')).toBe('rgb(1, 1, 1)');  // importer wins: it comes later
  });

  it('applies an @import media list and a <link media> only when they match', async () => {
    const { find } = await renderAtPhoneWidth(
      `<html><head>
        <link rel="stylesheet" href="/print.css" media="print">
        <link rel="stylesheet" href="/phone.css" media="(max-width: 600px)">
        <link rel="stylesheet" href="/i.css"></head><body><p>x</p><h1>h</h1></body></html>`, '',
      {
        'https://example.com/print.css': 'p { color: rgb(9, 0, 0) }',
        'https://example.com/phone.css': 'p { font-size: 13px }',
        'https://example.com/i.css': '@import "wide.css" (min-width: 2000px);',
        'https://example.com/wide.css': 'h1 { color: rgb(0, 9, 0) }',
      });
    expect(find('p').computedStyle?.get('color')).not.toBe('rgb(9, 0, 0)');
    expect(find('p').computedStyle?.get('font-size')).toBe('13px');
    expect(find('h1').computedStyle?.get('color')).not.toBe('rgb(0, 9, 0)');
  });

  it('survives an @import cycle', async () => {
    const { find } = await renderAtPhoneWidth(
      '<html><head><link rel="stylesheet" href="/a.css"></head><body><p>x</p></body></html>', '',
      { 'https://example.com/a.css': '@import "b.css"; p { font-size: 19px }', 'https://example.com/b.css': '@import "a.css";' });
    expect(find('p').computedStyle?.get('font-size')).toBe('19px');
  });
});

describe('CSS5 parser @import', () => {
  it('reads url("…"), url(…) and "…" forms, with a media list', async () => {
    const { CssParser: Css5 } = await import('../src/browser/rendering/css5/parser');
    const rules = new Css5().parseStylesheet('@import url("a.css");\n@import url(b.css) screen and (max-width: 600px);\n@import \'c.css\';\np{}').rules;
    const imports = rules.flatMap((r) => (r.type === 'import' ? [r] : []));
    expect(imports.map((i) => i.url)).toEqual(['a.css', 'b.css', 'c.css']);
    expect(imports[1]!.mediaQueries[0]).toMatchObject({ mediaType: 'screen' });
    expect(imports[1]!.mediaQueries[0]!.features).toHaveLength(1);
    expect(rules.some((r) => r.type === 'style')).toBe(true);
  });
});

describe('font-size units (iana.org rendered 100% text at 100px)', () => {
  const sizes = async (css: string, html: string) => {
    const { find, texts } = await renderAtPhoneWidth(`<html><head><style>${css}</style></head><body>${html}</body></html>`);
    return { find, texts };
  };

  it('a percentage is relative to the parent font size, not a pixel count', async () => {
    const { texts } = await sizes('body { font-size: 20px } p { font-size: 100% } span { font-size: 50% }', '<p>Hi <span>small</span></p>');
    const cmdsFont = texts.find((t) => t[0] === 'Hi');
    expect(cmdsFont).toBeTruthy();
    const { paintEngine } = await renderAtPhoneWidth('<html><head><style>body{font-size:20px} p{font-size:100%} span{font-size:50%}</style></head><body><p>Hi <span>small</span></p></body></html>');
    const fonts = paintEngine.compositeFrame().filter((c) => c.type === 'setFont').map((c) => String(c.params[0]));
    expect(fonts.some((f) => / 20px /.test(f))).toBe(true);
    expect(fonts.some((f) => / 10px /.test(f))).toBe(true);
    expect(fonts.some((f) => / 100px /.test(f))).toBe(false);
  });

  it('rem is relative to the root font size, em to the parent', async () => {
    const { paintEngine } = await renderAtPhoneWidth('<html style="font-size:10px"><body style="font-size:30px"><p style="font-size:2rem">r</p><p style="font-size:0.5em">e</p></body></html>');
    const fonts = paintEngine.compositeFrame().filter((c) => c.type === 'setFont').map((c) => String(c.params[0]));
    expect(fonts.some((f) => / 20px /.test(f))).toBe(true);  // 2rem = 2 x 10px
    expect(fonts.some((f) => / 15px /.test(f))).toBe(true);  // 0.5em of 30px
  });
});

describe('inherited relative font sizes do not compound', () => {
  it('a span inside font-size:2em (or 150%) draws at the parent size, not twice it', async () => {
    const { paintEngine } = await renderAtPhoneWidth('<html><body style="font-size:16px"><div style="font-size:2em"><span>a</span></div><div style="font-size:150%"><b>b</b></div></body></html>');
    const fontBefore = (word: string) => {
      const cmds = paintEngine.compositeFrame();
      const i = cmds.findIndex((c) => c.type === 'fillText' && c.params[0] === word);
      return String(cmds.slice(0, i).reverse().find((c) => c.type === 'setFont')!.params[0]);
    };
    expect(fontBefore('a')).toMatch(/ 32px /);
    expect(fontBefore('b')).toMatch(/ 24px /);
  });
});
