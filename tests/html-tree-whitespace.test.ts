/**
 * Real pages put newlines between <html>, <head> and its children. Those used to
 * push <head> into <body> (so <title>/<style> text was painted as page content):
 * "before html" re-processed the <html> tag (opening an implied <head>), and
 * whitespace in "in head"/"after head" fell through to "anything else".
 */
import { describe, expect, it } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import type { HtmlElement } from '../src/browser/rendering/html5/dom';
import { getUserAgentDefaults } from '../src/browser/rendering/css5/cascade';

/** html(head(title),body(p)) style outline of the element tree. */
function outline(el: HtmlElement | null): string {
  if (!el) return '';
  const kids = el.children.filter((c): c is HtmlElement => 'tagName' in c);
  return kids.length ? `${el.tagName}(${kids.map(outline).join(',')})` : el.tagName;
}

const tree = (html: string) => outline(new HtmlParser().parse(html).document.htmlElement);

describe('HTML tree building with whitespace between head tags', () => {
  it.each([
    ['no whitespace', '<html><head><title>T</title></head><body><p>x</p></body></html>'],
    ['newline after <html>', '<html>\n<head><title>T</title></head><body><p>x</p></body></html>'],
    ['indented head', '<html><head>\n  <title>T</title>\n</head><body><p>x</p></body></html>'],
    ['newline after </head>', '<html><head><title>T</title></head>\n<body><p>x</p></body></html>'],
    ['typical page', '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8" />\n  <title>T</title>\n</head>\n<body>\n<p>x</p>\n</body>\n</html>\n'],
  ])('%s', (_name, html) => {
    expect(tree(html).replace('head(meta,title)', 'head(title)')).toBe('html(head(title),body(p))');
  });

  it('keeps the attributes of <html> on <html>, not on an implied <head>', () => {
    const doc = new HtmlParser().parse('<html lang="en">\n<head></head><body></body></html>').document;
    expect(doc.headElement?.attributes.get('lang')).toBeUndefined();
    expect(doc.htmlElement?.attributes.get('lang')).toBe('en');
  });

  it('ignores a stray </head> after the head instead of popping <html>', () => {
    expect(tree('<html><head><title>T</title></head></head><body><p>x</p></body></html>')).toBe('html(head(title),body(p))');
  });
});

describe('UA stylesheet: elements that never render', () => {
  it.each(['head', 'title', 'style', 'script', 'meta', 'link', 'base', 'template', 'noscript'])('%s is display:none', (tag) => {
    expect(getUserAgentDefaults(tag).get('display')).toBe('none');
  });
});

describe('raw text elements (script/style/title/textarea)', () => {
  // emitTag reset the tokenizer to DATA right after entering SCRIPT_DATA/RAWTEXT/RCDATA, so
  // `if (a<b)` in an inline script opened a tag "b)" that swallowed the rest of the page.
  const parse = (html: string) => new HtmlParser().parse(html).document;
  // The tree builder keeps raw-text element contents on `rawContent` (DomTree turns it into a text child).
  const textOf = (el: HtmlElement | undefined) => (el as { rawContent?: string } | undefined)?.rawContent ?? '';

  it('keeps a "<" comparison inside <script> as script text, not a tag', () => {
    const doc = parse('<html><body><script>if (a<b) x();</script><p>after</p></body></html>');
    expect(tree('<html><body><script>if (a<b) x();</script><p>after</p></body></html>')).toBe('html(head,body(script,p))');
    const script = doc.bodyElement?.children.find((c): c is HtmlElement => 'tagName' in c && c.tagName === 'script');
    expect(textOf(script)).toBe('if (a<b) x();');
  });

  it('keeps HTML inside a script string out of the DOM', () => {
    expect(tree('<html><body><script>var s="<p>x</p><a href=y>L</a>";</script></body></html>')).toBe('html(head,body(script))');
  });

  it('treats <style>, <title> and <textarea> contents as text', () => {
    expect(tree('<html><head><title>a<b>c</title><style>a::before{content:"<i>"}</style></head><body><textarea><b>x</b></textarea></body></html>'))
      .toBe('html(head(title,style),body(textarea))');
  });
});
