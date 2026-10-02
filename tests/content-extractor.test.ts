import { describe, it, expect } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomDocument, DomElement, DomNode, DomTextNode } from '../src/browser/rendering/dom-tree';
import { extractIndexableDocument } from '../src/browser/search/content-extractor';

const parser = new HtmlParser();
const build = (html: string): DomDocument => new DomTree().buildFromHtml(parser.parse(html).document);
const extract = (html: string, url = 'https://example.com/page') => extractIndexableDocument(build(html), url, 123);
const LOREM = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore. '.repeat(3);

// Hand-built nodes for shapes the HTML parser can't produce faithfully (unclosed foreign content, very deep trees).
const el = (tagName: string, children: DomNode[] = []): DomElement =>
  ({ nodeType: 'element', tagName, attributes: new Map<string, string>(), children, parent: null }) as unknown as DomElement;
const textNode = (text: string): DomTextNode =>
  ({ nodeType: 'text', text, children: [], parent: null }) as unknown as DomTextNode;
const manualDoc = (body: DomElement): DomDocument => {
  const html = el('html', [el('head'), body]);
  return { nodeType: 'document', children: [html], parent: null, htmlElement: html, headElement: null, bodyElement: body } as unknown as DomDocument;
};

describe('extractIndexableDocument', () => {
  it('extracts title, description, headings and readable body, dropping boilerplate', () => {
    const doc = extract(`<html><head><title>My   Page</title>
      <meta name="description" content="A short   description">
      <script>var tracking = 1;</script><style>p { color: red }</style></head>
      <body><nav>Home About Contact</nav>
      <h1>Main heading</h1><p>${LOREM}</p><h2>Sub heading</h2><p>More text here</p><h3>Third</h3>
      <footer>Copyright junk</footer><script>alert('x')</script></body></html>`);
    expect(doc).not.toBeNull();
    expect(doc!.url).toBe('https://example.com/page');
    expect(doc!.visitedAt).toBe(123);
    expect(doc!.title).toBe('My Page');
    expect(doc!.description).toBe('A short description');
    expect(doc!.headings).toEqual([
      { level: 1, text: 'Main heading' }, { level: 2, text: 'Sub heading' }, { level: 3, text: 'Third' },
    ]);
    expect(doc!.body).toContain('Lorem ipsum');
    expect(doc!.body).toContain('More text here');
    for (const junk of ['Home About', 'Copyright junk', 'alert', 'tracking', 'color: red']) {
      expect(doc!.body).not.toContain(junk);
    }
  });

  it('prefers <main> over the rest of the page', () => {
    const doc = extract(`<body><div>Sidebar chatter that is not the point</div><main><p>${LOREM}</p></main></body>`);
    expect(doc!.body).toContain('Lorem ipsum');
    expect(doc!.body).not.toContain('Sidebar chatter');
  });

  it('prefers <article> when there is no <main>', () => {
    const doc = extract(`<body><div>Comments section noise</div><article><p>${LOREM}</p></article></body>`);
    expect(doc!.body).toContain('Lorem ipsum');
    expect(doc!.body).not.toContain('Comments section noise');
  });

  it('skips hidden content', () => {
    const doc = extract(`<body>
      <div hidden>secret one</div><div aria-hidden="true">decor two</div>
      <div style="display: none">gone three</div><div style="color:red; visibility:hidden">invisible four</div>
      <p>${LOREM}</p></body>`);
    for (const hidden of ['secret one', 'decor two', 'gone three', 'invisible four']) {
      expect(doc!.body).not.toContain(hidden);
    }
    expect(doc!.body).toContain('Lorem ipsum');
  });

  it('skips <noscript> content and headings inside navigation', () => {
    const doc = extract(`<body><nav><h2>Menu heading</h2></nav><noscript>enable javascript</noscript>
      <h2>Real heading</h2><p>${LOREM}</p></body>`);
    expect(doc!.headings).toEqual([{ level: 2, text: 'Real heading' }]);
    for (const junk of ['enable javascript', 'Menu heading']) expect(doc!.body).not.toContain(junk);
  });

  it('skips non-text subtrees such as <svg> and <template>', () => {
    const doc = manualDoc(el('body', [
      el('svg', [textNode('vector label')]),
      el('template', [textNode('tpl text')]),
      el('p', [textNode(LOREM)]),
    ]));
    const result = extractIndexableDocument(doc, 'https://x.test/', 1)!;
    expect(result.body).toContain('Lorem ipsum');
    expect(result.body).not.toContain('vector label');
    expect(result.body).not.toContain('tpl text');
  });

  it('does not repeat the <title> in the body and copes with a duplicated <body>', () => {
    const doc = extract(`<html><head><title>Unique Title Words</title>
      <meta name="description" content="d"></head><body><p>${LOREM}</p></body></html>`);
    expect(doc!.title).toBe('Unique Title Words');
    expect(doc!.body).toContain('Lorem ipsum');
    expect(doc!.body).not.toContain('Unique Title Words');
  });

  it('indexes pretty-printed pages, whose content the tree builder nests under a stray <head>', () => {
    // Whitespace between <html> and <head> makes the engine's tree builder emit html(head, body(head(title, h1, p))).
    const html = `<!doctype html>\n<html>\n<head><title>Pretty Printed</title></head>\n<body>\n<h1>Heading</h1><p>${LOREM}</p>\n</body>\n</html>`;
    const doc = extract(html);
    expect(doc!.title).toBe('Pretty Printed');
    expect(doc!.headings).toEqual([{ level: 1, text: 'Heading' }]);
    expect(doc!.body).toContain('Lorem ipsum');
    expect(doc!.body).not.toContain('Pretty Printed');
    // same page without the whitespace: same result
    expect(extract(html.replace(/\n/g, ''))!.body).toBe(doc!.body);
  });

  it('never indexes pages with a password field', () => {
    expect(extract(`<body><form><input type="password" name="p"></form><p>${LOREM}</p></body>`)).toBeNull();
    expect(extract(`<body><form><input TYPE="Password"></form><p>${LOREM}</p></body>`)).toBeNull();
    expect(extract(`<body><form><input type="text"></form><p>${LOREM}</p></body>`)).not.toBeNull();
  });

  it('respects robots noindex', () => {
    expect(extract(`<head><meta name="robots" content="noindex, nofollow"></head><body><p>${LOREM}</p></body>`)).toBeNull();
    expect(extract(`<head><meta name="ROBOTS" content="NoIndex"></head><body><p>${LOREM}</p></body>`)).toBeNull();
    expect(extract(`<head><meta name="robots" content="index, follow"></head><body><p>${LOREM}</p></body>`)).not.toBeNull();
  });

  it('falls back to og:description, with name=description taking precedence', () => {
    const og = extract(`<head><meta property="og:description" content="OG text"></head><body><p>${LOREM}</p></body>`);
    expect(og!.description).toBe('OG text');
    const both = extract(`<head><meta property="og:description" content="OG text"><meta name="description" content="Plain"></head><body><p>${LOREM}</p></body>`);
    expect(both!.description).toBe('Plain');
  });

  it('falls back from <title> to the first h1 to the URL', () => {
    expect(extract(`<body><h1>Heading title</h1><p>${LOREM}</p></body>`)!.title).toBe('Heading title');
    expect(extract(`<body><p>${LOREM}</p></body>`, 'https://example.com/untitled')!.title).toBe('https://example.com/untitled');
  });

  it('skips pages with nothing worth indexing, but keeps heading-only and description-only pages', () => {
    expect(extract('<html><body><p>hi</p></body></html>')).toBeNull();
    expect(extract('<body></body>')).toBeNull();
    expect(extract('<body><h1>Hello</h1></body>')).not.toBeNull();
    expect(extract('<head><meta name="description" content="only a description"></head><body></body>')).not.toBeNull();
  });

  it('caps headings and body size', () => {
    const many = Array.from({ length: 60 }, (_, i) => `<h2>Heading ${i}</h2>`).join('');
    expect(extract(`<body>${many}<p>${LOREM}</p></body>`)!.headings).toHaveLength(50);
    const huge = extract(`<body><p>${'word '.repeat(60_000)}</p></body>`)!;
    expect(huge.body.length).toBeLessThanOrEqual(100_000);
    expect(huge.body.length).toBeGreaterThan(90_000);
  });

  it('collapses whitespace in the body', () => {
    const doc = extract(`<body><p>${LOREM}</p><p>alpha\n\n   beta\t\tgamma</p></body>`);
    expect(doc!.body).toContain('alpha beta gamma');
    expect(doc!.body).not.toMatch(/\s{2,}/);
  });

  it('survives pathologically deep documents (iterative traversal)', () => {
    let node: DomNode = el('p', [textNode(LOREM)]);
    for (let i = 0; i < 20_000; i++) node = el('div', [node]);
    const doc = manualDoc(el('body', [node]));
    expect(extractIndexableDocument(doc, 'https://deep.test/', 1)!.body).toContain('Lorem ipsum');
  });
});
