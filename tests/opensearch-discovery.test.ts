import { describe, it, expect, vi, afterEach } from 'vitest';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { DomDocument } from '../src/browser/rendering/dom-tree';
import {
  findOpenSearchLinks, parseOpenSearchDescription, discoverOpenSearchEngines, decodeEntities, fetchTextWithGlobalFetch,
} from '../src/browser/omnibox/opensearch-discovery';

const page = (head: string): DomDocument => new DomTree().buildFromHtml(new HtmlParser().parse(`<html><head>${head}</head><body></body></html>`).document);
const DESCRIPTOR_URL = 'https://www.example.com/opensearch.xml';
const desc = (inner: string, root = 'OpenSearchDescription') =>
  `<?xml version="1.0" encoding="UTF-8"?><${root} xmlns="http://a9.com/-/spec/opensearch/1.1/">${inner}</${root}>`;

const FULL = desc(`
  <ShortName>Example Search</ShortName>
  <Description>Search &amp; discover on Example</Description>
  <Image width="16" height="16" type="image/x-icon">https://www.example.com/favicon.ico</Image>
  <Url type="text/html" method="get" template="https://www.example.com/search?q={searchTerms}&amp;hl={language}"/>
  <Url type="application/x-suggestions+json" template="https://www.example.com/suggest?q={searchTerms}"/>`);

describe('findOpenSearchLinks', () => {
  it('finds advertised descriptors, resolving relative URLs and ignoring everything else', () => {
    const doc = page(
      '<link rel="search" type="application/opensearchdescription+xml" href="/opensearch.xml" title=" Example ">'
      + '<link rel="stylesheet" href="/s.css">'
      + '<link rel="SEARCH" type="Application/OpenSearchDescription+XML" href="https://other.test/os.xml">'
      + '<link rel="search" type="text/html" href="/x">'
      + '<link rel="search" type="application/opensearchdescription+xml" href="javascript:alert(1)">'
      + '<link rel="search" type="application/opensearchdescription+xml" href="/opensearch.xml">'
      + '<link rel="search" type="application/opensearchdescription+xml">',
    );
    expect(findOpenSearchLinks(doc, 'https://example.com/index.html')).toEqual([
      { href: 'https://example.com/opensearch.xml', title: 'Example' },
      { href: 'https://other.test/os.xml', title: '' },
    ]);
  });

  it('accepts rel lists containing "search" and caps the number of links', () => {
    const many = Array.from({ length: 6 }, (_, i) => `<link rel="alternate search" type="application/opensearchdescription+xml" href="/os${i}.xml">`).join('');
    expect(findOpenSearchLinks(page(many), 'https://example.com/')).toHaveLength(3);
  });

  it('returns nothing for pages without descriptors', () => {
    expect(findOpenSearchLinks(page('<title>x</title>'), 'https://example.com/')).toEqual([]);
  });
});

describe('parseOpenSearchDescription', () => {
  it('reads a complete descriptor', () => {
    expect(parseOpenSearchDescription(FULL, DESCRIPTOR_URL)).toEqual({
      name: 'Example Search',
      description: 'Search & discover on Example',
      searchUrl: 'https://www.example.com/search?q={searchTerms}&hl={language}',
      suggestUrl: 'https://www.example.com/suggest?q={searchTerms}',
      icon: 'https://www.example.com/favicon.ico',
      descriptorUrl: DESCRIPTOR_URL,
      keyword: 'exam',
    });
  });

  it('handles namespace prefixes, single-quoted attributes and CDATA', () => {
    const xml = '<os:OpenSearchDescription xmlns:os="http://a9.com/-/spec/opensearch/1.1/">'
      + '<os:ShortName><![CDATA[Prefixed & Co]]></os:ShortName>'
      + "<os:Url type='text/html; charset=utf-8' template='https://p.test/?q={searchTerms}'/></os:OpenSearchDescription>";
    expect(parseOpenSearchDescription(xml, 'https://p.test/os.xml')).toMatchObject({
      name: 'Prefixed & Co', searchUrl: 'https://p.test/?q={searchTerms}',
    });
  });

  it('resolves relative templates and keeps placeholders in the path intact', () => {
    const rel = desc('<ShortName>R</ShortName><Url type="text/html" template="/search?q={searchTerms}"/>');
    expect(parseOpenSearchDescription(rel, DESCRIPTOR_URL)!.searchUrl).toBe('https://www.example.com/search?q={searchTerms}');
    const path = desc('<ShortName>P</ShortName><Url type="text/html" template="https://example.com/find/{searchTerms}/page"/>');
    expect(parseOpenSearchDescription(path, DESCRIPTOR_URL)!.searchUrl).toBe('https://example.com/find/{searchTerms}/page');
  });

  it('ignores POST URLs and uses a later GET one', () => {
    const post = desc('<ShortName>P</ShortName><Url type="text/html" method="POST" template="https://example.com/post"><Param name="q" value="{searchTerms}"/></Url>');
    expect(parseOpenSearchDescription(post, DESCRIPTOR_URL)).toBeNull();
    const both = desc('<ShortName>B</ShortName><Url type="text/html" method="POST" template="https://example.com/post"/><Url type="text/html" template="https://example.com/?q={searchTerms}"/>');
    expect(parseOpenSearchDescription(both, DESCRIPTOR_URL)!.searchUrl).toBe('https://example.com/?q={searchTerms}');
  });

  it('decodes XML entities in every field', () => {
    const xml = desc('<ShortName>A &#38; B &#x41; &lt;i&gt;</ShortName><Url type="text/html" template="https://example.com/?a=1&amp;q={searchTerms}"/>');
    const e = parseOpenSearchDescription(xml, DESCRIPTOR_URL)!;
    expect(e.name).toBe('A & B A <i>');
    expect(e.searchUrl).toBe('https://example.com/?a=1&q={searchTerms}');
    expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;&#65;&#x42;&#0;&#x110000;')).toBe('&<>"\'AB');
  });

  it('bounds name and description lengths', () => {
    const xml = desc(`<ShortName>${'n'.repeat(100)}</ShortName><Description>${'d'.repeat(500)}</Description><Url type="text/html" template="https://example.com/?q={searchTerms}"/>`);
    const e = parseOpenSearchDescription(xml, DESCRIPTOR_URL)!;
    expect(e.name).toHaveLength(60);
    expect(e.description).toHaveLength(200);
  });

  it('accepts only safe icons', () => {
    const icon = (value: string) => parseOpenSearchDescription(
      desc(`<ShortName>I</ShortName><Image>${value}</Image><Url type="text/html" template="https://example.com/?q={searchTerms}"/>`), DESCRIPTOR_URL,
    )!.icon;
    expect(icon('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(icon('https://example.com/i.png')).toBe('https://example.com/i.png');
    expect(icon('javascript:alert(1)')).toBeUndefined();
    expect(icon('data:text/html,<script>')).toBeUndefined();
    expect(icon('/relative.png')).toBeUndefined();
  });

  it('derives a keyword from the most distinctive host label', () => {
    const kw = (url: string) => parseOpenSearchDescription(
      desc(`<ShortName>K</ShortName><Url type="text/html" template="${url}"/>`), 'https://x.test/os.xml',
    )!.keyword;
    expect(kw('https://search.brave.com/search?q={searchTerms}')).toBe('brav');
    expect(kw('https://duckduckgo.com/?q={searchTerms}')).toBe('duck');
    expect(kw('https://www.ab.example/?q={searchTerms}')).toBe('ab');
  });

  describe('rejects descriptors that are unusable or unsafe', () => {
    const tpl = (template: string, base = DESCRIPTOR_URL) =>
      parseOpenSearchDescription(desc(`<ShortName>T</ShortName><Url type="text/html" template="${template}"/>`), base);

    it('wrong or missing structure', () => {
      expect(parseOpenSearchDescription('', DESCRIPTOR_URL)).toBeNull();
      expect(parseOpenSearchDescription('<html><body>nope</body></html>', DESCRIPTOR_URL)).toBeNull();
      expect(parseOpenSearchDescription(desc('<Url type="text/html" template="https://example.com/?q={searchTerms}"/>'), DESCRIPTOR_URL)).toBeNull(); // no ShortName
      expect(parseOpenSearchDescription(desc('<ShortName>No url</ShortName>'), DESCRIPTOR_URL)).toBeNull();
      expect(parseOpenSearchDescription(desc('<ShortName>Only suggestions</ShortName><Url type="application/x-suggestions+json" template="https://example.com/s?q={searchTerms}"/>'), DESCRIPTOR_URL)).toBeNull();
    });

    it('templates that cannot carry a query', () => {
      expect(tpl('https://example.com/static')).toBeNull();
      expect(tpl('https://example.com/?q={count}')).toBeNull();
    });

    it('dangerous schemes, credentials and host-controlling placeholders', () => {
      expect(tpl('javascript:alert({searchTerms})')).toBeNull();
      expect(tpl('data:text/html,{searchTerms}')).toBeNull();
      expect(tpl('http://example.com/?q={searchTerms}')).toBeNull(); // https descriptor must not downgrade
      expect(tpl('https://user:pw@example.com/?q={searchTerms}')).toBeNull();
      expect(tpl('https://{searchTerms}.evil.com/')).toBeNull();
      expect(tpl('https://{searchTerms}/')).toBeNull();
    });

    it('allows http templates only from an http descriptor', () => {
      expect(tpl('http://example.com/?q={searchTerms}', 'http://example.com/os.xml')).not.toBeNull();
    });

    it('oversized descriptors', () => {
      expect(parseOpenSearchDescription(FULL + ' '.repeat(100_001), DESCRIPTOR_URL)).toBeNull();
    });

    it('an unparseable descriptor URL', () => {
      expect(parseOpenSearchDescription(FULL, 'not a url')).toBeNull();
    });
  });
});

describe('discoverOpenSearchEngines', () => {
  const doc = page(
    '<link rel="search" type="application/opensearchdescription+xml" href="/ok.xml">'
    + '<link rel="search" type="application/opensearchdescription+xml" href="/missing.xml">'
    + '<link rel="search" type="application/opensearchdescription+xml" href="/throws.xml">'
    + '<link rel="search" type="application/opensearchdescription+xml" href="/garbage.xml">',
  );

  it('returns the engines it could fetch and parse, skipping failures', async () => {
    const fetchText = vi.fn(async (url: string): Promise<string | null> => {
      if (url.endsWith('/ok.xml')) return FULL;
      if (url.endsWith('/missing.xml')) return null;
      if (url.endsWith('/throws.xml')) throw new Error('network down');
      return 'this is not xml';
    });
    const engines = await discoverOpenSearchEngines(doc, 'https://www.example.com/', { fetchText });
    expect(engines.map((e) => e.name)).toEqual(['Example Search']);
    expect(engines[0]!.descriptorUrl).toBe('https://www.example.com/ok.xml');
    expect(fetchText).toHaveBeenCalledTimes(3); // 3-link cap: ok, missing, throws
  });

  it('returns nothing when the page advertises nothing', async () => {
    const fetchText = vi.fn();
    expect(await discoverOpenSearchEngines(page(''), 'https://example.com/', { fetchText })).toEqual([]);
    expect(fetchText).not.toHaveBeenCalled();
  });
});

describe('fetchTextWithGlobalFetch', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  const respond = (init: { ok: boolean; status?: number; body?: string }) => {
    const fetchMock = vi.fn(async (_url: string, _options?: RequestInit) => ({
      ok: init.ok, status: init.status ?? (init.ok ? 200 : 500), text: async () => init.body ?? '',
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('reads the body with a credential-less, referrer-less, uncached GET', async () => {
    const fetchMock = respond({ ok: true, body: FULL });
    const signal = new AbortController().signal;
    await expect(fetchTextWithGlobalFetch(DESCRIPTOR_URL, signal)).resolves.toBe(FULL);
    expect(fetchMock).toHaveBeenCalledWith(DESCRIPTOR_URL, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  });

  it('rejects on an HTTP error, so the caller reports "couldn\'t add" instead of parsing an error page', async () => {
    respond({ ok: false, status: 404, body: '<html>not found</html>' });
    await expect(fetchTextWithGlobalFetch(DESCRIPTOR_URL, new AbortController().signal)).rejects.toThrow('descriptor HTTP 404');
  });

  it('rejects when the network call does', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(fetchTextWithGlobalFetch(DESCRIPTOR_URL, new AbortController().signal)).rejects.toThrow('Failed to fetch');
  });
});
