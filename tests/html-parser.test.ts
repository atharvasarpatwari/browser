import { describe, it, expect } from 'vitest';
import { HtmlParser, NodeType, getElementsByTagName, decodeHtmlEntities, type HtmlElement, type HtmlNode } from '../src/browser/rendering/html-parser';

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

  // ──────────────────────────────────────────────────────────────────────────
  // Helper: get text content of an element
  // ──────────────────────────────────────────────────────────────────────────
  function textOf(el: HtmlElement): string {
    let result = '';
    for (const child of el.children) {
      if (child.nodeType === NodeType.Text) {
        result += (child as any).text;
      } else if (child.nodeType === NodeType.Element) {
        result += textOf(child as HtmlElement);
      }
    }
    return result;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ADOPTION AGENCY ALGORITHM — misnested formatting tags
  // ──────────────────────────────────────────────────────────────────────────

  describe('Adoption Agency Algorithm', () => {
    it('should handle <b><i></b></i> — <i> stays inside <b> per spec (no furthest block)', () => {
      const result = parser.parse('<html><body><b><i></b></i></body></html>');
      const body = result.document.bodyElement!;
      const b = getElementsByTagName(body, 'b')[0]!;
      const i = getElementsByTagName(body, 'i')[0]!;
      // When </b> fires, <i> is not special so there's no furthest block.
      // Step 4.8: pop stack up to <b>, but <i> stays as child of <b> in DOM.
      // </i> is ignored because <i> is no longer in the stack.
      expect(b.children).toHaveLength(1);
      expect(b.children[0]).toBe(i);
    });

    it('should handle <b><i>text</b></i> — text ends up in <i> after <b>', () => {
      const result = parser.parse('<html><body><b><i>text</b></i></body></html>');
      const body = result.document.bodyElement!;
      const i = getElementsByTagName(body, 'i')[0]!;
      expect(textOf(i)).toBe('text');
    });

    it('should handle <b><i><b>x</b></i></b> — nested same-tag formatting', () => {
      const result = parser.parse('<html><body><b><i><b>x</b></i></b></body></html>');
      const body = result.document.bodyElement!;
      // The outer <b> closes, then inner <b> creates new, <i> reparents
      const bs = getElementsByTagName(body, 'b');
      expect(bs.length).toBeGreaterThanOrEqual(1);
      // x should be present somewhere
      expect(textOf(body)).toBe('x');
    });

    it('should handle <a><b><a></b></a> — adopt nested <a>', () => {
      const result = parser.parse('<html><body><a><b><a>x</a></b></a></body></html>');
      const body = result.document.bodyElement!;
      const text = textOf(body);
      expect(text).toBe('x');
    });

    it('should handle deeply nested misnesting', () => {
      const result = parser.parse(
        '<html><body><b><i><u><b></u></i></b></body></html>'
      );
      const body = result.document.bodyElement!;
      // Should not crash; structure should be valid
      expect(body.children.length).toBeGreaterThan(0);
    });

    it('should handle formatting element not in scope', () => {
      // <table> breaks scope, so <b> inside table is not in scope
      const result = parser.parse(
        '<html><body><b><table><b></b></table></b></body></html>'
      );
      const body = result.document.bodyElement!;
      // Should not crash, table structure should exist
      const tables = getElementsByTagName(body, 'table');
      expect(tables).toHaveLength(1);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // FOSTER PARENTING — misnested table content
  // ──────────────────────────────────────────────────────────────────────────

  describe('Foster Parenting', () => {
    it('should foster parent text before table', () => {
      const result = parser.parse('<html><body><table>A</table></body></html>');
      const body = result.document.bodyElement!;
      const table = getElementsByTagName(body, 'table')[0]!;
      // Text "A" should be foster parented before the table
      const tableIdx = body.children.indexOf(table);
      expect(tableIdx).toBeGreaterThan(0);
      // There should be a text node before the table
      const beforeTable = body.children.slice(0, tableIdx);
      const textBefore = beforeTable
        .filter(n => n.nodeType === NodeType.Text)
        .map(n => (n as any).text)
        .join('');
      expect(textBefore).toBe('A');
    });

    it('should foster parent paragraph before table', () => {
      const result = parser.parse(
        '<html><body><table><p>text</p></table></body></html>'
      );
      const body = result.document.bodyElement!;
      const paragraphs = getElementsByTagName(body, 'p');
      expect(paragraphs).toHaveLength(1);
      expect(textOf(paragraphs[0])).toBe('text');
    });

    it('should foster parent div before table', () => {
      const result = parser.parse(
        '<html><body><table><div>content</div></table></body></html>'
      );
      const body = result.document.bodyElement!;
      const divs = getElementsByTagName(body, 'div');
      expect(divs).toHaveLength(1);
      expect(textOf(divs[0])).toBe('content');
    });

    it('should foster parent mixed content before table', () => {
      const result = parser.parse(
        '<html><body><table>text<div>more</div>trailing</table></body></html>'
      );
      const body = result.document.bodyElement!;
      const table = getElementsByTagName(body, 'table')[0]!;
      const tableIdx = body.children.indexOf(table);
      // Content before table: text + div
      const beforeTable = body.children.slice(0, tableIdx);
      expect(beforeTable.length).toBeGreaterThan(0);
      // div should be in the foster parented content
      const divs = beforeTable.filter(
        n => n.nodeType === NodeType.Element && (n as HtmlElement).tagName === 'div'
      );
      expect(divs).toHaveLength(1);
    });

    it('should foster parent comment before table', () => {
      const result = parser.parse(
        '<html><body><table><!-- foster --></table></body></html>'
      );
      const body = result.document.bodyElement!;
      const table = getElementsByTagName(body, 'table')[0]!;
      const tableIdx = body.children.indexOf(table);
      const beforeTable = body.children.slice(0, tableIdx);
      const comments = beforeTable.filter(
        n => n.nodeType === NodeType.Comment
      );
      expect(comments).toHaveLength(1);
    });

    it('should handle table row/cell tags outside table context (parse error, ignored)', () => {
      // <tr>/<td> without a table are parse errors in inBody and ignored
      const result = parser.parse(
        '<html><body><tr><td>cell</td></tr></body></html>'
      );
      const body = result.document.bodyElement!;
      // <tr> and <td> start tags are ignored in inBody (parse errors)
      // Only the text content survives
      expect(textOf(body)).toContain('cell');
    });

    it('should handle nested tables with foster parenting', () => {
      const result = parser.parse(
        '<html><body><table>A<table>B</table>C</table></body></html>'
      );
      const body = result.document.bodyElement!;
      const tables = getElementsByTagName(body, 'table');
      expect(tables.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // IMPLIED END TAGS
  // ──────────────────────────────────────────────────────────────────────────

  describe('Implied End Tags', () => {
    it('should implicitly close <li> elements', () => {
      const result = parser.parse(
        '<html><body><ul><li>1<li>2<li>3</ul></body></html>'
      );
      const body = result.document.bodyElement!;
      const lis = getElementsByTagName(body, 'li');
      expect(lis).toHaveLength(3);
      expect(textOf(lis[0])).toBe('1');
      expect(textOf(lis[1])).toBe('2');
      expect(textOf(lis[2])).toBe('3');
    });

    it('should implicitly close <dt> and <dd> elements', () => {
      const result = parser.parse(
        '<html><body><dl><dt>a<dd>b<dt>c<dd>d</dl></body></html>'
      );
      const body = result.document.bodyElement!;
      const dts = getElementsByTagName(body, 'dt');
      const dds = getElementsByTagName(body, 'dd');
      expect(dts).toHaveLength(2);
      expect(dds).toHaveLength(2);
      expect(textOf(dts[0])).toBe('a');
      expect(textOf(dds[0])).toBe('b');
      expect(textOf(dts[1])).toBe('c');
      expect(textOf(dds[1])).toBe('d');
    });

    it('should implicitly close <p> elements', () => {
      const result = parser.parse(
        '<html><body><p>first<p>second</body></html>'
      );
      const body = result.document.bodyElement!;
      const ps = getElementsByTagName(body, 'p');
      expect(ps).toHaveLength(2);
      expect(textOf(ps[0])).toBe('first');
      expect(textOf(ps[1])).toBe('second');
    });

    it('should implicitly close <option> elements', () => {
      const result = parser.parse(
        '<html><body><select><option>a<option>b</select></body></html>'
      );
      const body = result.document.bodyElement!;
      const opts = getElementsByTagName(body, 'option');
      expect(opts).toHaveLength(2);
      expect(textOf(opts[0])).toBe('a');
      expect(textOf(opts[1])).toBe('b');
    });

    it('should implicitly close <optgroup> elements', () => {
      const result = parser.parse(
        '<html><body><select><optgroup><option>x</optgroup><optgroup><option>y</optgroup></select></body></html>'
      );
      const body = result.document.bodyElement!;
      const groups = getElementsByTagName(body, 'optgroup');
      expect(groups).toHaveLength(2);
    });

    it('should handle nested implied end tags', () => {
      const result = parser.parse(
        '<html><body><ul><li><p>item1</p><li>item2</ul></body></html>'
      );
      const body = result.document.bodyElement!;
      const lis = getElementsByTagName(body, 'li');
      expect(lis).toHaveLength(2);
    });

    it('should handle <option> inside <select> with implicit close', () => {
      const result = parser.parse(
        '<html><body><select><option>1<option>2<option>3</select></body></html>'
      );
      const body = result.document.bodyElement!;
      const opts = getElementsByTagName(body, 'option');
      expect(opts).toHaveLength(3);
      expect(textOf(opts[0])).toBe('1');
      expect(textOf(opts[1])).toBe('2');
      expect(textOf(opts[2])).toBe('3');
    });

    it('should handle <p> implied close before block elements', () => {
      const result = parser.parse(
        '<html><body><p>text<div>more</div></body></html>'
      );
      const body = result.document.bodyElement!;
      const ps = getElementsByTagName(body, 'p');
      const divs = getElementsByTagName(body, 'div');
      expect(ps).toHaveLength(1);
      expect(divs).toHaveLength(1);
      expect(textOf(ps[0])).toBe('text');
      expect(textOf(divs[0])).toBe('more');
    });

    it('should handle thorough implied end tags for table content in template', () => {
      const result = parser.parse(
        '<html><body><template><table><tr><td>x</td></tr></table></template></body></html>'
      );
      // Should not crash; template should contain the table structure
      expect(result.document.bodyElement).not.toBeNull();
    });

    it('should handle implied end tags with complex nesting', () => {
      const result = parser.parse(
        '<html><body><dl><dt>a<dd>b<dd>c<dt>d</dl></body></html>'
      );
      const body = result.document.bodyElement!;
      const dts = getElementsByTagName(body, 'dt');
      const dds = getElementsByTagName(body, 'dd');
      expect(dts).toHaveLength(2);
      expect(dds).toHaveLength(2);
    });
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
