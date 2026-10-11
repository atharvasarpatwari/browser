/**
 * @file src/browser/crawler/link-extractor.ts
 *
 * Pulls `<a href>` + anchor text out of already-parsed anchor elements.
 * Confirmed by investigation: no link-graph/anchor-text extraction existed
 * anywhere in the repo before this.
 */

import type { DomElement, DomNode, DomTextNode } from '../rendering/dom-tree';

export interface ExtractedLink {
  readonly href: string;
  readonly anchorText: string;
}

const MAX_ANCHOR_TEXT_CHARS = 200;
const isText = (n: DomNode): n is DomTextNode => n.nodeType === 'text';

function anchorText(el: DomElement): string {
  const parts: string[] = [];
  const stack: DomNode[] = [el];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (isText(node)) parts.push(node.text);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_ANCHOR_TEXT_CHARS);
}

/** Resolves each anchor's `href` against `baseUrl`, skipping non-navigable links. */
export function extractLinks(anchors: readonly DomElement[], baseUrl: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  for (const a of anchors) {
    const href = a.attributes.get('href');
    if (!href) continue;
    const trimmed = href.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    if (/^(javascript|mailto|tel):/i.test(trimmed)) continue;

    let resolved: URL;
    try {
      resolved = new URL(trimmed, baseUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
    resolved.hash = ''; // fragment-only differences are the same crawl target

    links.push({ href: resolved.toString(), anchorText: anchorText(a) });
  }
  return links;
}
