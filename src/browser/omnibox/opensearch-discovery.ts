import type { DomDocument, DomElement, DomNode } from '../rendering/dom-tree';
import { hasSearchPlaceholder } from './search-template';

/** A search engine advertised by a page via an OpenSearch 1.1 description document. */
interface DiscoveredEngine {
  readonly name: string;
  readonly description: string;
  /** `text/html` GET template containing `{searchTerms}`. */
  readonly searchUrl: string;
  /** `application/x-suggestions+json` GET template, when offered. */
  readonly suggestUrl?: string;
  readonly icon?: string;
  readonly descriptorUrl: string;
  /** Suggested `!keyword`, derived from the host. */
  readonly keyword: string;
}

interface OpenSearchLink {
  readonly href: string;
  readonly title: string;
}

const OPENSEARCH_TYPE = 'application/opensearchdescription+xml';
const MAX_DESCRIPTOR_CHARS = 100_000;
const MAX_LINKS = 3;

/** `<link rel="search" type="application/opensearchdescription+xml" href=… title=…>` in document order. */
function findOpenSearchLinks(doc: DomDocument, pageUrl: string): OpenSearchLink[] {
  const out: OpenSearchLink[] = [];
  const seen = new Set<string>();
  const stack: DomNode[] = [doc];
  while (stack.length > 0 && out.length < MAX_LINKS) {
    const node = stack.pop()!;
    if (node.nodeType === 'element') {
      const el = node as DomElement;
      if (el.tagName === 'link'
        && (el.attributes.get('rel') ?? '').toLowerCase().split(/\s+/).includes('search')
        && (el.attributes.get('type') ?? '').toLowerCase() === OPENSEARCH_TYPE) {
        const href = el.attributes.get('href');
        if (href) {
          try {
            const url = new URL(href, pageUrl);
            if ((url.protocol === 'https:' || url.protocol === 'http:') && !seen.has(url.href)) {
              seen.add(url.href);
              out.push({ href: url.href, title: (el.attributes.get('title') ?? '').trim() });
            }
          } catch { /* unusable href */ }
        }
      }
    }
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
  return out;
}

const ENTITIES: Readonly<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_m, dec: string, hex: string, named: string) => {
    if (named) return ENTITIES[named.toLowerCase()]!;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

const NS = String.raw`(?:[\w.-]+:)?`;

function textOf(xml: string, tag: string): string {
  const m = new RegExp(`<${NS}${tag}\\b[^>]*>([\\s\\S]*?)</${NS}${tag}\\s*>`, 'i').exec(xml);
  return m ? decodeEntities(m[1]!.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()) : '';
}

function attrOf(tagSource: string, name: string): string {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tagSource);
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : '';
}

const GENERIC_LABELS: ReadonlySet<string> = new Set(['www', 'search', 'find', 's', 'm', 'api', 'en', 'web']);

/** First four letters of the host's most distinctive label: `search.brave.com` → `brav`. */
function deriveKeyword(name: string, host: string): string {
  const labels = host.toLowerCase().split('.');
  const label = labels.find((l) => !GENERIC_LABELS.has(l)) ?? labels[0] ?? '';
  const base = (label || name).toLowerCase().replace(/[^a-z0-9]/g, '');
  return base.slice(0, 4) || 'se';
}

/**
 * Reads an OpenSearch 1.1 description. Returns null unless it offers a usable `text/html` GET search
 * template on an allowed scheme. Never throws; the descriptor is data, so nothing in it is executed.
 */
function parseOpenSearchDescription(xml: string, descriptorUrl: string): DiscoveredEngine | null {
  if (xml.length > MAX_DESCRIPTOR_CHARS || !new RegExp(`<${NS}OpenSearchDescription\\b`, 'i').test(xml)) return null;

  let base: URL;
  try { base = new URL(descriptorUrl); } catch { return null; }
  const allowed = base.protocol === 'http:' ? ['https:', 'http:'] : ['https:'];
  // Resolves a (possibly relative) template against the descriptor URL. Placeholders are swapped for
  // inert tokens while the URL parser runs (it would percent-encode braces in a path) and restored after.
  const resolve = (template: string): string | null => {
    if (!hasSearchPlaceholder(template)) return null;
    const placeholders: string[] = [];
    const probe = template.replace(/\{[^}]*\}/g, (m) => {
      placeholders.push(m);
      return `novaph${placeholders.length - 1}x`;
    });
    try {
      const url = new URL(probe, base);
      // Never let the query (or any placeholder) choose the host, and never embed credentials.
      if (!allowed.includes(url.protocol) || /novaph/i.test(url.host) || url.username || url.password) return null;
      return url.href.replace(/novaph(\d+)x/gi, (_m, i: string) => placeholders[Number(i)] ?? '');
    } catch { return null; }
  };

  let searchUrl: string | null = null;
  let suggestUrl: string | null = null;
  for (const m of xml.matchAll(new RegExp(`<${NS}Url\\b([^>]*)>`, 'gi'))) {
    const tag = m[1]!;
    const type = attrOf(tag, 'type').toLowerCase();
    const method = (attrOf(tag, 'method') || 'GET').toUpperCase();
    const template = attrOf(tag, 'template');
    if (method !== 'GET' || !template) continue;
    if (type.startsWith('text/html') && !searchUrl) searchUrl = resolve(template);
    else if (type === 'application/x-suggestions+json' && !suggestUrl) suggestUrl = resolve(template);
  }
  if (!searchUrl) return null;

  let icon: string | undefined;
  for (const m of xml.matchAll(new RegExp(`<${NS}Image\\b[^>]*>([\\s\\S]*?)</${NS}Image\\s*>`, 'gi'))) {
    const value = decodeEntities(m[1]!.trim());
    if (/^data:image\//i.test(value) || /^https?:\/\//i.test(value)) { icon = value; break; }
  }

  const name = textOf(xml, 'ShortName').slice(0, 60);
  if (!name) return null;
  return {
    name,
    description: textOf(xml, 'Description').slice(0, 200),
    searchUrl,
    ...(suggestUrl ? { suggestUrl } : {}),
    ...(icon ? { icon } : {}),
    descriptorUrl: base.href,
    keyword: deriveKeyword(name, new URL(searchUrl.replace(/\{[^}]*\}/g, 'x')).hostname),
  };
}

interface DiscoveryDeps {
  /** Credential-less GET returning the response body, or null on any failure. */
  fetchText(url: string): Promise<string | null>;
}

/** Finds, fetches and parses the OpenSearch descriptors a page advertises. Failures are skipped. */
async function discoverOpenSearchEngines(
  doc: DomDocument, pageUrl: string, deps: DiscoveryDeps,
): Promise<DiscoveredEngine[]> {
  const found: DiscoveredEngine[] = [];
  for (const link of findOpenSearchLinks(doc, pageUrl)) {
    try {
      const xml = await deps.fetchText(link.href);
      const engine = xml ? parseOpenSearchDescription(xml, link.href) : null;
      if (engine) found.push(engine);
    } catch { /* an unreachable descriptor is simply not offered */ }
  }
  return found;
}

export { findOpenSearchLinks, parseOpenSearchDescription, discoverOpenSearchEngines, decodeEntities };
export type { DiscoveredEngine, OpenSearchLink, DiscoveryDeps };
