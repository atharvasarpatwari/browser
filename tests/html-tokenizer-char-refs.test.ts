/**
 * Character references (§13.2.5.72–80). Inside attribute values they went to the text buffer, so
 * `href="?a=1&amp;b=2"` lost its `&` and emitted it as text after the tag; in <head> that text
 * closed the head, and Wikipedia rendered as "&&&" with its content in a third <body>.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Html5Tokenizer } from '../src/browser/rendering/html5-tokenizer';
import { HtmlParser } from '../src/browser/rendering/html-parser';

const attrs = (html: string) => {
  const t = new Html5Tokenizer().tokenize(html).find((x) => x.kind === 'open' || x.kind === 'selfclose')!;
  return Object.fromEntries(t.attrs!);
};
const text = (html: string) => new Html5Tokenizer().tokenize(html).filter((t) => t.kind === 'text').map((t) => t.data).join('');

describe('character references', () => {
  it('decode into the attribute value, not page text', () => {
    expect(attrs('<a href="/a?x=1&amp;y=2" title=\'&lt;b&gt;\' data-n=&#65;&#x42;>')).toEqual({ href: '/a?x=1&y=2', title: '<b>', 'data-n': 'AB' });
    expect(text('<a href="?x&amp;y">t</a>')).toBe('t');
  });

  it('keep legacy no-semicolon names literal in attributes when = or a letter follows', () => {
    expect(attrs('<a href="?a=1&copy=2&notit=3&amp">').href).toBe('?a=1&copy=2&notit=3&');
  });

  it('decode in text, without swallowing the next character', () => {
    expect(text('<p>a &amp; b &copy 2 &notit; &bogus; & x</p>')).toBe('a & b © 2 ¬it; &bogus; & x');
  });

  it('tags carry no empty-named attribute; a duplicate keeps the first value', () => {
    expect(attrs('<input type=text type=password>')).toEqual({ type: 'text' });
  });

  it('a real Wikipedia page keeps one <body> with its content and search form', () => {
    const html = readFileSync('tests/fixtures/wikipedia-search-2026/index.html', 'utf8');
    const doc = (new HtmlParser().parse(html) as unknown as { document: { htmlElement: { children: { nodeType: string; tagName?: string }[] } } }).document;
    const kids = doc.htmlElement.children.filter((c) => c.nodeType === 'element').map((c) => c.tagName);
    expect(kids).toEqual(['head', 'body']);
    expect(html).toContain('action="/w/index.php"');
  });
});
