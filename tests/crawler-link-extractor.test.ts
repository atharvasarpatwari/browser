import { describe, it, expect } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { extractLinks } from '../src/browser/crawler/link-extractor';

function parseLinks(html: string, baseUrl: string) {
  const { document } = new HtmlParser().parse(html);
  const tree = new DomTree();
  tree.buildFromHtml(document);
  const anchors = tree.getElementsByTagName('a');
  return extractLinks(anchors, baseUrl);
}

describe('extractLinks', () => {
  it('resolves a relative href against the base URL', () => {
    const links = parseLinks(`<a href="/docs/intro">Intro</a>`, 'https://a.com/page');
    expect(links).toEqual([{ href: 'https://a.com/docs/intro', anchorText: 'Intro' }]);
  });

  it('collects anchor text from nested markup', () => {
    const links = parseLinks(`<a href="/x"><span>Nested</span> text</a>`, 'https://a.com/');
    expect(links[0]!.anchorText).toBe('Nested text');
  });

  it('strips the fragment so #section differences do not create distinct links', () => {
    const links = parseLinks(`<a href="/page#section2">Jump</a>`, 'https://a.com/');
    expect(links[0]!.href).toBe('https://a.com/page');
  });

  it('skips fragment-only, javascript:, mailto:, and tel: links', () => {
    const links = parseLinks(
      `<a href="#top">Top</a><a href="javascript:void(0)">JS</a><a href="mailto:a@b.com">Mail</a><a href="tel:12345">Tel</a>`,
      'https://a.com/',
    );
    expect(links).toEqual([]);
  });

  it('skips a link with no href', () => {
    const links = parseLinks(`<a>No href</a>`, 'https://a.com/');
    expect(links).toEqual([]);
  });

  it('skips a malformed href that cannot be resolved', () => {
    const links = parseLinks(`<a href="http://[::not-valid">Bad</a>`, 'https://a.com/');
    expect(links).toEqual([]);
  });

  it('resolves multiple links including an absolute cross-domain one', () => {
    const links = parseLinks(
      `<a href="/local">Local</a><a href="https://other.com/page">External</a>`,
      'https://a.com/',
    );
    expect(links.map((l) => l.href)).toEqual(['https://a.com/local', 'https://other.com/page']);
  });
});
