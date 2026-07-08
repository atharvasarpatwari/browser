import { describe, it, expect } from 'vitest';
import { HtmlParser, NodeType, getElementsByTagName, decodeHtmlEntities } from '../src/browser/rendering/html-parser';

describe('HtmlParser', () => {
  const parser = new HtmlParser();

  it('should parse a simple HTML document', () => {
    const result = parser.parse('<html><head></head><body><p>Hello</p></body></html>');
    expect(result.document.nodeType).toBe(NodeType.Document);
    expect(result.document.htmlElement).not.toBeNull();
    expect(result.document.headElement).not.toBeNull();
    expect(result.document.bodyElement).not.toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should find elements by tag name', () => {
    const result = parser.parse('<html><body><p>1</p><p>2</p><div><p>3</p></div></body></html>');
    const paragraphs = getElementsByTagName(result.document, 'p');
    expect(paragraphs).toHaveLength(3);
  });

  it('should discover link resources', () => {
    const result = parser.parse('<html><head><link rel="stylesheet" href="/style.css"></head></html>', 'https://example.com');
    expect(result.resources.length).toBeGreaterThan(0);
    expect(result.resources[0]!.kind).toBe('stylesheet');
  });

  it('should discover script resources', () => {
    const result = parser.parse('<html><head><script src="/app.js"></script></head></html>', 'https://example.com');
    const scripts = result.resources.filter(r => r.kind === 'script');
    expect(scripts.length).toBeGreaterThan(0);
  });

  it('should discover image resources', () => {
    const result = parser.parse('<html><body><img src="/photo.jpg"></body></html>', 'https://example.com');
    const imgs = result.resources.filter(r => r.kind === 'image');
    expect(imgs.length).toBeGreaterThan(0);
  });

  it('should parse void elements without children', () => {
    const result = parser.parse('<html><body><br><img src="a.jpg"><input></body></html>');
    const brs = getElementsByTagName(result.document, 'br');
    expect(brs[0]!.isVoid).toBe(true);
    expect(brs[0]!.children).toHaveLength(0);
  });

  it('should handle raw-text elements like <script>', () => {
    const result = parser.parse('<html><body><script>const x = 1;</script></body></html>');
    const scripts = getElementsByTagName(result.document, 'script');
    expect(scripts[0]!.isRawText).toBe(true);
    expect(scripts[0]!.rawContent).toBe('const x = 1;');
  });

  it('should handle DOCTYPE', () => {
    const result = parser.parse('<!DOCTYPE html><html></html>');
    expect(result.document.hasDoctype).toBe(true);
    expect(result.document.doctype).not.toBeNull();
    expect(result.document.doctype!.name).toBe('html');
  });

  it('should extract meta charset', () => {
    const result = parser.parse('<html><head><meta charset="utf-8"></head></html>');
    expect(result.document.metaCharset).toBe('utf-8');
  });

  it('should produce parse errors for truly malformed input gracefully', () => {
    const result = parser.parse('<html><body><p>unclosed');
    expect(result.document.children.length).toBeGreaterThan(0);
  });

  it('should parse comment nodes', () => {
    const result = parser.parse('<html><body><!-- comment --><p>text</p></body></html>');
    expect(result.document.bodyElement).not.toBeNull();
  });

  it('parseFragment should return children without document wrapper', () => {
    const nodes = parser.parseFragment('<p>a</p><p>b</p>');
    expect(nodes).toHaveLength(2);
    expect(nodes[0]!.nodeType).toBe(NodeType.Element);
    if (nodes[0]!.nodeType === NodeType.Element) {
      expect((nodes[0] as any).tagName).toBe('p');
    }
  });

  it('should handle attributes with single quotes', () => {
    const result = parser.parse('<html><body><div class=\'my-class\'></div></body></html>');
    const divs = getElementsByTagName(result.document, 'div');
    expect(divs[0]!.attributes.get('class')).toBe('my-class');
  });

  it('should handle attributes without quotes', () => {
    const result = parser.parse('<html><body><div id=main></div></body></html>');
    const divs = getElementsByTagName(result.document, 'div');
    expect(divs[0]!.attributes.get('id')).toBe('main');
  });

  it('should resolve relative URLs using baseUrl', () => {
    const result = parser.parse('<html><head><link rel="stylesheet" href="/style.css"></head></html>', 'https://example.com');
    expect(result.resources[0]!.url).toBe('https://example.com/style.css');
  });

  it('should detect render-blocking resources in <head>', () => {
    const result = parser.parse('<html><head><link rel="stylesheet" href="style.css"></head><body></body></html>', 'https://example.com');
    expect(result.resources[0]!.blocking).toBe(true);
  });

  it('should detect deferred scripts', () => {
    const result = parser.parse('<html><head><script defer src="app.js"></script></head></html>', 'https://example.com');
    const scripts = result.resources.filter(r => r.kind === 'script');
    expect(scripts[0]!.deferred).toBe(true);
  });

  it('should detect async scripts as deferred', () => {
    const result = parser.parse('<html><head><script async src="app.js"></script></head></html>', 'https://example.com');
    const scripts = result.resources.filter(r => r.kind === 'script');
    expect(scripts[0]!.deferred).toBe(true);
  });

  it('should ignore self-closing tag trailing slash', () => {
    const result = parser.parse('<html><body><br/><img src="a.jpg"/></body></html>');
    const brs = getElementsByTagName(result.document, 'br');
    expect(brs).toHaveLength(1);
  });
});

describe('decodeHtmlEntities', () => {
  it('should decode &amp; to &', () => {
    expect(decodeHtmlEntities('&amp;')).toBe('&');
  });

  it('should decode &lt; and &gt;', () => {
    expect(decodeHtmlEntities('&lt;div&gt;')).toBe('<div>');
  });

  it('should decode &quot;', () => {
    expect(decodeHtmlEntities('&quot;hello&quot;')).toBe('"hello"');
  });

  it('should decode &apos; and &#39;', () => {
    expect(decodeHtmlEntities('&apos;hello&apos;')).toBe("'hello'");
    expect(decodeHtmlEntities('&#39;hello&#39;')).toBe("'hello'");
  });
});
