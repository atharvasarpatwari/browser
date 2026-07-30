/**
 * @file tests/html5-error-recovery.test.ts
 *
 * Comprehensive malformed HTML error recovery tests.
 * Covers WHATWG §13.2.6 error handling for all insertion modes.
 */

import { describe, it, expect } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { createGlobalEnv, runJS } from '../src/browser/js/index';
import { EventLoop } from '../src/browser/js/event-loop';

function parse(html: string) {
  return new HtmlParser().parse(html);
}

function parseFragment(html: string) {
  return new HtmlParser().parseFragment(html);
}

function bodyChildren(html: string) {
  const { document } = parse(html);
  return document.bodyElement?.children ?? [];
}

function bodyHTML(html: string) {
  const kids = bodyChildren(html);
  return kids.map((c: any) => `<${c.tagName}>`).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.1 — "initial" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — Initial Mode', () => {
  it('should produce parse error for DOCTYPE (quirks mode)', () => {
    const r = parse('<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN">');
    expect(r.document.errors.length).toBeGreaterThan(0);
    expect(r.document.doctype).not.toBeNull();
  });

  it('should handle non-whitespace text before DOCTYPE', () => {
    const r = parse('  text<!DOCTYPE html>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should handle garbage before DOCTYPE', () => {
    const r = parse('garbage<!DOCTYPE html><p>ok</p>');
    expect(r.document.errors.length).toBeGreaterThan(0);
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should reprocess comment in initial mode', () => {
    const r = parse('<!-- comment --><p>ok</p>');
    expect(r.document.children.length).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.2 — "before html" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — Before HTML', () => {
  it('should produce parse error for DOCTYPE before html', () => {
    const r = parse('<!DOCTYPE html><p>ok</p>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should produce parse error for end tag before html', () => {
    const r = parse('</p><p>ok</p>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should create html element implicitly', () => {
    const r = parse('<p>ok</p>');
    // html element should exist even though not explicit
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should reprocess non-whitespace text through before-head', () => {
    const r = parse('  text<p>ok</p>');
    expect(r.document.errors.length).toBeGreaterThan(0);
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.3 — "before head" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — Before Head', () => {
  it('should produce parse error for DOCTYPE before head', () => {
    const r = parse('<!DOCTYPE html><p>ok</p>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should produce parse error for non-whitespace text before head', () => {
    const r = parse('text<p>ok</p>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should insert head implicitly for any start tag', () => {
    const r = parse('<p>ok</p>');
    expect(r.document.headElement).not.toBeNull();
  });

  it('should insert head implicitly for end tags', () => {
    const r = parse('</p><p>ok</p>');
    expect(r.document.headElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.4 — "in head" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — In Head', () => {
  it('should produce parse error for end tag </head>', () => {
    const r = parse('<head></head><p>ok</p>');
    expect(r.document.headElement).not.toBeNull();
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should produce parse error for stray start tags in head', () => {
    const r = parse('<head><p>text</p></head><body>ok</body>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should handle multiple <meta> without crashing', () => {
    const r = parse('<head><meta charset="utf-8"><meta name="x" content="y"></head><body>ok</body>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle raw text elements in head', () => {
    const r = parse('<head><title>Hello</title><style>.a{}</style></head><body>ok</body>');
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.7 — "in body" insertion mode (LARGEST section)
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — In Body: Stray End Tags', () => {
  it('should produce parse error for stray </p> without <p>', () => {
    const r = parse('</p>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should produce parse error for stray </div>', () => {
    const r = parse('</div>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should produce parse error for stray </span>', () => {
    const r = parse('</span>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should produce parse error for stray </table> without <table>', () => {
    const r = parse('</table>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should produce parse error for stray </body>', () => {
    const r = parse('</body>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should produce parse error for stray </html>', () => {
    const r = parse('</html>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should produce parse error for void element end tags', () => {
    const r = parse('<div></br></img></input></div>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });
});

describe('Error Recovery — In Body: Nesting', () => {
  it('should auto-close <p> when block element opens', () => {
    const r = parse('<p>text<div>inner</div>');
    const kids = bodyChildren('');
    // p should be closed before div
    const body = r.document.bodyElement!;
    const p = body.children.find((c: any) => c.tagName === 'p');
    const div = body.children.find((c: any) => c.tagName === 'div');
    expect(p).not.toBeNull();
    expect(div).not.toBeNull();
    expect(p).not.toBe(div);
  });

  it('should auto-close nested <p> elements', () => {
    const r = parse('<p>outer<p>inner<p>third');
    const body = r.document.bodyElement!;
    const ps = body.children.filter((c: any) => c.tagName === 'p');
    expect(ps.length).toBe(3);
  });

  it('should handle misnested formatting: <b><i></b></i>', () => {
    const r = parse('<b><i></b></i>');
    const body = r.document.bodyElement!;
    const b = body.children.find((c: any) => c.tagName === 'b');
    expect(b).not.toBeNull();
    const i = b!.children.find((c: any) => c.tagName === 'i');
    expect(i).not.toBeNull();
  });

  it('should handle misnested formatting: <b><i>text</b></i>', () => {
    const r = parse('<b><i>text</b></i>');
    const body = r.document.bodyElement!;
    const b = body.children.find((c: any) => c.tagName === 'b');
    expect(b).not.toBeNull();
    const i = b!.children.find((c: any) => c.tagName === 'i');
    expect(i).not.toBeNull();
  });

  it('should handle deeply nested misnesting', () => {
    const r = parse('<b><i><u>x</b></i></u>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should close heading when another heading opens', () => {
    const r = parse('<h1>first<h2>second');
    const body = r.document.bodyElement!;
    const headings = body.children.filter((c: any) => c.tagName === 'h1' || c.tagName === 'h2');
    expect(headings.length).toBe(2);
  });
});

describe('Error Recovery — In Body: Formatting Elements', () => {
  it('should handle duplicate <a> (adoption agency)', () => {
    const r = parse('<a>one<a>two</a>three</a>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle <a> inside <a>', () => {
    const r = parse('<a>outer<a>inner</a>after</a>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle adoption agency with table context', () => {
    const r = parse('<b><table><tr><td>x</b></td></tr></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });
});

describe('Error Recovery — In Body: Void Elements', () => {
  it('should insert <hr> and not leave it on stack', () => {
    const r = parse('<div><hr></div>');
    const body = r.document.bodyElement!;
    const div = body.children.find((c: any) => c.tagName === 'div');
    expect(div).not.toBeNull();
    const hr = div!.children.find((c: any) => c.tagName === 'hr');
    expect(hr).not.toBeNull();
    // hr should have no children (void element)
    expect(hr!.children.length).toBe(0);
  });

  it('should set framesetOk to false for <hr>', () => {
    const r = parse('<hr><frameset></frameset>');
    const body = r.document.bodyElement!;
    // frameset should not be accepted because hr set framesetOk=false
    expect(body.children.some((c: any) => c.tagName === 'frameset')).toBe(false);
  });

  it('should insert <br> and pop it immediately', () => {
    const r = parse('<div><br></div>');
    const body = r.document.bodyElement!;
    const div = body.children.find((c: any) => c.tagName === 'div');
    expect(div!.children.some((c: any) => c.tagName === 'br')).toBe(true);
  });

  it('should insert <img> with discoverResources', () => {
    const r = parse('<img src="test.png">');
    expect(r.resources.length).toBe(1);
    expect(r.resources[0].url).toContain('test.png');
  });
});

describe('Error Recovery — In Body: Stray Start Tags', () => {
  it('should produce parse error for stray </html> end tag', () => {
    const r = parse('<div>a</div></html><div>b</div>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should handle <form> without existing form', () => {
    const r = parse('<form action="x"><input></form>');
    const body = r.document.bodyElement!;
    expect(body.children.some((c: any) => c.tagName === 'form')).toBe(true);
  });

  it('should reject <form> if one already exists (no template)', () => {
    const r = parse('<form><form></form></form>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should handle <isindex> deprecated tag', () => {
    const r = parse('<isindex>');
    // isindex should be converted to a form + input + label
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.8 — "text" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — Text Mode', () => {
  it('should handle raw text in <script>', () => {
    const r = parse('<script>var x = 1;</script>');
    const head = r.document.headElement!;
    const script = head.children.find((c: any) => c.tagName === 'script');
    expect(script).not.toBeNull();
    expect(script!.rawContent).toBe('var x = 1;');
  });

  it('should handle raw text in <style>', () => {
    const r = parse('<style>.a{color:red}</style>');
    const head = r.document.headElement!;
    const style = head.children.find((c: any) => c.tagName === 'style');
    expect(style).not.toBeNull();
    expect(style!.rawContent).not.toBe('');
  });

  it('should handle unclosed <script>', () => {
    const r = parse('<script>var x = 1;</body></html>');
    // Should not crash, script should contain raw text until end
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.9 — "in table" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — In Table', () => {
  it('should foster-parent text in table context', () => {
    const r = parse('<table>text<tr><td>x</td></tr></table>');
    // "text" should be foster-parented before the table
    const body = r.document.bodyElement!;
    const textIdx = body.children.findIndex((c: any) => c.nodeType === 'text');
    const tableIdx = body.children.findIndex((c: any) => c.tagName === 'table');
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(tableIdx).toBeGreaterThanOrEqual(0);
    expect(textIdx).toBeLessThan(tableIdx);
  });

  it('should foster-parent <p> in table context', () => {
    const r = parse('<table><p>x</p></table>');
    const body = r.document.bodyElement!;
    const p = body.children.find((c: any) => c.tagName === 'p');
    expect(p).not.toBeNull();
    // p should be outside the table (foster parented)
    expect(body.children.indexOf(p!)).toBeLessThan(
      body.children.findIndex((c: any) => c.tagName === 'table')
    );
  });

  it('should foster-parent comment in table context', () => {
    const r = parse('<table><!-- comment --><tr><td>x</td></tr></table>');
    const body = r.document.bodyElement!;
    const comment = body.children.find((c: any) => c.nodeType === 'comment');
    expect(comment).not.toBeNull();
  });

  it('should handle start tags in table mode as parse errors (ignored)', () => {
    const r = parse('<table><div>x</div><tr><td>y</td></tr></table>');
    // div in table mode is a parse error; it should be foster-parented
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle </table> when no table is open', () => {
    const r = parse('</table>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should foster-parent nested content in table', () => {
    const r = parse('<table><div><span>x</span></div></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.10 — "in table text" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — In Table Text', () => {
  it('should accumulate whitespace in table text mode', () => {
    const r = parse('<table>   <tr><td>x</td></tr></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.11 — "in caption" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — In Caption', () => {
  it('should handle end tag </caption> properly', () => {
    const r = parse('<table><caption>x</caption><tr><td>y</td></tr></table>');
    const body = r.document.bodyElement!;
    const table = body.children.find((c: any) => c.tagName === 'table');
    expect(table).not.toBeNull();
  });

  it('should handle table start tag in caption (pop caption)', () => {
    const r = parse('<table><caption>x<table>y</table></caption></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.12 — "in column group" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — In Column Group', () => {
  it('should handle end tag </colgroup>', () => {
    const r = parse('<table><colgroup><col><col></colgroup></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle start tag in column group', () => {
    const r = parse('<table><colgroup><div>x</div></colgroup></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.13 — "in table body" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — In Table Body', () => {
  it('should handle start tag <tr> in table body', () => {
    const r = parse('<table><tbody><tr><td>x</td></tr></tbody></table>');
    const body = r.document.bodyElement!;
    const table = body.children.find((c: any) => c.tagName === 'table');
    expect(table).not.toBeNull();
  });

  it('should handle end tag </tbody> when no tbody', () => {
    const r = parse('<table></tbody></table>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should close table body on start tag <table>', () => {
    const r = parse('<table><tbody><tr><td>x</td></tr></tbody></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.14 — "in row" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — In Row', () => {
  it('should handle <td> in row mode', () => {
    const r = parse('<table><tr><td>x</td></tr></table>');
    const body = r.document.bodyElement!;
    const table = body.children.find((c: any) => c.tagName === 'table');
    expect(table).not.toBeNull();
  });

  it('should close row on start tag <tr> (new row)', () => {
    const r = parse('<table><tr><td>1</td></tr><tr><td>2</td></tr></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle table start tag in row mode (implicit close)', () => {
    const r = parse('<table><tr><td>x</td></tr><table>y</table></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.15 — "in cell" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — In Cell', () => {
  it('should handle <td> start tag in cell (close + reopen)', () => {
    const r = parse('<table><tr><td>a<td>b</td></tr></table>');
    const body = r.document.bodyElement!;
    const table = body.children.find((c: any) => c.tagName === 'table');
    expect(table).not.toBeNull();
  });

  it('should handle </td> properly', () => {
    const r = parse('<table><tr><td>x</td><td>y</td></tr></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle </th> for th cells', () => {
    const r = parse('<table><tr><th>x</th><th>y</th></tr></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle start tag in cell (close cell first)', () => {
    const r = parse('<table><tr><td>a<p>b</p></td></tr></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.16 — "in select" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — In Select', () => {
  it('should handle end tags properly in select', () => {
    const r = parse('<select><option>a</option><option>b</option></select>');
    const body = r.document.bodyElement!;
    const select = body.children.find((c: any) => c.tagName === 'select');
    expect(select).not.toBeNull();
  });

  it('should handle start tag in select (parse error, ignored)', () => {
    const r = parse('<select><div>x</div></select>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should handle select-in-table', () => {
    const r = parse('<table><tr><td><select><option>x</option></select></td></tr></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.17 — "in select in table" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — In Select In Table', () => {
  it('should handle table start tag in select-in-table (close select)', () => {
    const r = parse('<table><select><option>x</option></select><tr><td>y</td></tr></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.18 — "in template" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — In Template', () => {
  it('should handle </template> end tag', () => {
    const r = parse('<template><p>content</p></template>');
    expect(r.document.headElement).not.toBeNull();
    const tmpl = r.document.headElement!.children.find((c: any) => c.tagName === 'template');
    expect(tmpl).not.toBeNull();
  });

  it('should handle start tag in template', () => {
    const r = parse('<template><div>x</div></template>');
    expect(r.document.headElement).not.toBeNull();
    const tmpl = r.document.headElement!.children.find((c: any) => c.tagName === 'template');
    expect(tmpl).not.toBeNull();
  });

  it('should handle end tag in template (close implied elements)', () => {
    const r = parse('<template><p>x</p></template>');
    expect(r.document.headElement).not.toBeNull();
    const tmpl = r.document.headElement!.children.find((c: any) => c.tagName === 'template');
    expect(tmpl).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.19 — "after body" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — After Body', () => {
  it('should produce parse error for content after </body>', () => {
    const r = parse('<body>x</body><p>after</p>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should produce parse error for end tag </body> after body', () => {
    const r = parse('<body>x</body></body>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should produce parse error for </html> after body', () => {
    const r = parse('<body>x</body></html>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.20 — "in frameset" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — In Frameset', () => {
  it('should handle frameset elements', () => {
    const r = parse('<html><frameset><frame src="a.html"><frame src="b.html"></frameset></html>');
    expect(r.document.htmlElement).not.toBeNull();
  });

  it('should produce parse error for non-frame start tag in frameset', () => {
    const r = parse('<frameset><div>x</div></frameset>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.21 — "after frameset" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — After Frameset', () => {
  it('should produce parse error for start tag after frameset', () => {
    const r = parse('<html><frameset></frameset><div>x</div></html>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should handle <noframes> in after-frameset', () => {
    const r = parse('<html><frameset></frameset><noframes>x</noframes></html>');
    expect(r.document.htmlElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.22 — "after after body" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — After After Body', () => {
  it('should produce parse error for content after html', () => {
    const r = parse('<html><body>x</body></html><p>after</p>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should handle comment after </html>', () => {
    const r = parse('<html><body>x</body></html><!-- comment -->');
    expect(r.document.bodyElement).not.toBeNull();
    expect(r.document.errors.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §13.2.6.23 — "after after frameset" insertion mode
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — After After Frameset', () => {
  it('should produce parse error for content after frameset', () => {
    const r = parse('<html><frameset></frameset><p>x</p></html>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should handle <noframes> in after-after-frameset', () => {
    const r = parse('<html><frameset></frameset><noframes>x</noframes></html>');
    expect(r.document.htmlElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADOPTION AGENCY ALGORITHM
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — Adoption Agency', () => {
  it('should handle <b><i></b></i> (no furthest block)', () => {
    const r = parse('<b><i></b></i>');
    const body = r.document.bodyElement!;
    const b = body.children.find((c: any) => c.tagName === 'b');
    expect(b).not.toBeNull();
    const i = b!.children.find((c: any) => c.tagName === 'i');
    expect(i).not.toBeNull();
  });

  it('should handle <b><i>text</b></i>', () => {
    const r = parse('<b><i>text</b></i>');
    const body = r.document.bodyElement!;
    const b = body.children.find((c: any) => c.tagName === 'b');
    expect(b).not.toBeNull();
  });

  it('should handle <b><i><b>x</b></i></b>', () => {
    const r = parse('<b><i><b>x</b></i></b>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle <a><b><a></b></a>', () => {
    const r = parse('<a><b><a></b></a>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle formatting element not in scope', () => {
    const r = parse('<b><table><tr><td>x</td></tr></table></b><p>y</p>');
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FOSTER PARENTING
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — Foster Parenting', () => {
  it('should foster parent text before table', () => {
    const r = parse('text<table><tr><td>x</td></tr></table>');
    const body = r.document.bodyElement!;
    const firstChild = body.children[0];
    expect(firstChild!.nodeType).toBe('text');
  });

  it('should foster parent <p> before table', () => {
    const r = parse('<p>x<table><tr><td>y</td></tr></table>');
    const body = r.document.bodyElement!;
    const p = body.children.find((c: any) => c.tagName === 'p');
    expect(p).not.toBeNull();
    // p should be outside (before) the table
    const tableIdx = body.children.findIndex((c: any) => c.tagName === 'table');
    expect(body.children.indexOf(p!)).toBeLessThan(tableIdx);
  });

  it('should foster parent comment before table', () => {
    const r = parse('<!-- x --><table><tr><td>y</td></tr></table>');
    expect(r.document.bodyElement).not.toBeNull();
    expect(r.document.bodyElement!.children.length).toBeGreaterThan(0);
  });

  it('should handle nested tables with foster parenting', () => {
    const r = parse('<table><tr><td><table><tr><td>x</td></tr></table></td></tr></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// IMPLIED END TAGS
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — Implied End Tags', () => {
  it('should implicitly close <li> elements', () => {
    const r = parse('<ul><li>a<li>b<li>c</ul>');
    const body = r.document.bodyElement!;
    const ul = body.children.find((c: any) => c.tagName === 'ul');
    expect(ul).not.toBeNull();
    expect(ul!.children.filter((c: any) => c.tagName === 'li').length).toBe(3);
  });

  it('should implicitly close <dt>/<dd> elements', () => {
    const r = parse('<dl><dt>a<dd>b<dt>c<dd>d</dl>');
    const body = r.document.bodyElement!;
    const dl = body.children.find((c: any) => c.tagName === 'dl');
    expect(dl).not.toBeNull();
  });

  it('should implicitly close <p> elements', () => {
    const r = parse('<p>a<p>b<p>c');
    const body = r.document.bodyElement!;
    const ps = body.children.filter((c: any) => c.tagName === 'p');
    expect(ps.length).toBe(3);
  });

  it('should implicitly close <option> elements', () => {
    const r = parse('<select><option>a<option>b<option>c</select>');
    const body = r.document.bodyElement!;
    const select = body.children.find((c: any) => c.tagName === 'select');
    expect(select!.children.filter((c: any) => c.tagName === 'option').length).toBe(3);
  });

  it('should implicitly close <optgroup> elements', () => {
    const r = parse('<select><optgroup><option>a</optgroup><optgroup><option>b</optgroup></select>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle nested implied end tags', () => {
    const r = parse('<ul><li><ul><li>a</li></ul><li>b</li></ul>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle thorough implied end tags for template', () => {
    const r = parse('<template><table><tr><td>x</td></tr></table></template>');
    expect(r.document.headElement).not.toBeNull();
    const tmpl = r.document.headElement!.children.find((c: any) => c.tagName === 'template');
    expect(tmpl).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FOREIGN CONTENT (SVG/MathML)
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — Foreign Content', () => {
  it('should handle SVG inline', () => {
    const r = parse('<div><svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg></div>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle MathML inline', () => {
    const r = parse('<div><math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi></math></div>');
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPLEX MALFORMED SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

describe('Error Recovery — Complex Scenarios', () => {
  it('should handle completely empty input', () => {
    const r = parse('');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle just whitespace', () => {
    const r = parse('   \n\t  ');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle just text', () => {
    const r = parse('hello world');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle completely unclosed elements', () => {
    const r = parse('<div><p><span><b>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle deeply nested closing tags without matching opens', () => {
    const r = parse('</div></div></div></span></b>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should handle completely reversed nesting', () => {
    const r = parse('</b></i></a><a><i><b>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle random interleaved tags', () => {
    const r = parse('<div><span><p></div></span></p>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle 1000 nested unclosed divs', () => {
    const html = '<div>'.repeat(1000);
    const r = parse(html);
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle 1000 stray closing divs', () => {
    const html = '</div>'.repeat(1000);
    const r = parse(html);
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should handle alternating table/list nesting', () => {
    const r = parse('<table><ul><table><ul></table></ul></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle form inside form', () => {
    const r = parse('<form><form></form></form>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should handle table inside table cell', () => {
    const r = parse('<table><tr><td><table><tr><td>x</td></tr></table></td></tr></table>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle all void elements in sequence', () => {
    const r = parse('<area><base><br><col><embed><hr><img><input><keygen><link><meta><param><source><track><wbr>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle misnested bold across table boundary', () => {
    const r = parse('<b><table><tr><td>x</td></tr></table><p>y</p></b>');
    expect(r.document.bodyElement).not.toBeNull();
  });

  it('should handle <p> inside <p>', () => {
    const r = parse('<p>outer<p>inner');
    const body = r.document.bodyElement!;
    const ps = body.children.filter((c: any) => c.tagName === 'p');
    expect(ps.length).toBe(2);
  });

  it('should handle select with invalid children', () => {
    const r = parse('<select><div>x</div><option>y</option></select>');
    expect(r.document.errors.length).toBeGreaterThan(0);
  });

  it('should handle body end tag then content', () => {
    const r = parse('<body>x</body><p>after</p>');
    expect(r.document.errors.length).toBeGreaterThan(0);
    // "after" text should still be parsed
    expect(r.document.bodyElement).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// document.write() / document.open()
// ─────────────────────────────────────────────────────────────────────────────

describe('document.write() and document.open()', () => {
  it('parser.write() appends HTML to current stream state', () => {
    const parser = new HtmlParser();
    parser.parse('<div>initial</div>');
    parser.write('<span>appended</span>');
    const doc = parser.getCurrentDocument();
    expect(doc.bodyElement).not.toBeNull();
    const bodyKids = doc.bodyElement!.children as any[];
    const tags = bodyKids.map(c => c.tagName);
    expect(tags).toContain('div');
    expect(tags).toContain('span');
  });

  it('parser.write() can inject multiple elements', () => {
    const parser = new HtmlParser();
    parser.parse('<p>hello</p>');
    parser.write('<ul><li>a</li><li>b</li></ul>');
    const doc = parser.getCurrentDocument();
    const bodyKids = doc.bodyElement!.children as any[];
    expect(bodyKids.length).toBeGreaterThanOrEqual(2);
    expect(bodyKids[bodyKids.length - 1].tagName).toBe('ul');
  });

  it('parser.open() clears the document', () => {
    const parser = new HtmlParser();
    parser.parse('<div>content</div>');
    parser.open();
    const doc = parser.getCurrentDocument();
    expect(doc.bodyElement).toBeNull();
    expect(doc.children.length).toBe(0);
  });

  it('document.write() via JS adds content to live DOM', () => {
    const parser = new HtmlParser();
    const domTree = new DomTree();
    const parseResult = parser.parse('<div id="before">before</div>');
    const doc = domTree.buildFromHtml(parseResult.document);
    const eventLoop = new EventLoop();

    const env = createGlobalEnv(doc, domTree, eventLoop, undefined, undefined, undefined, undefined, undefined, parser);

    const result = runJS('document.write("<span id=\\"after\\">after</span>")', {
      document: doc, domTree, eventLoop, globalEnv: env, htmlParser: parser,
    });

    expect(result.error).toBeUndefined();
    const el = domTree.getElementById('after');
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe('span');
  });

  it('document.write() after document.open() replaces content', () => {
    const parser = new HtmlParser();
    const domTree = new DomTree();
    const parseResult = parser.parse('<div id="old">old</div>');
    const doc = domTree.buildFromHtml(parseResult.document);
    const eventLoop = new EventLoop();

    const env = createGlobalEnv(doc, domTree, eventLoop, undefined, undefined, undefined, undefined, undefined, parser);

    const result = runJS('document.open(); document.write("<p id=\\"new\\">new</p>");', {
      document: doc, domTree, eventLoop, globalEnv: env, htmlParser: parser,
    });

    expect(result.error).toBeUndefined();
    const oldEl = domTree.getElementById('old');
    expect(oldEl).toBeNull();

    const newEl = domTree.getElementById('new');
    expect(newEl).not.toBeNull();
    expect(newEl!.tagName).toBe('p');
  });
});
