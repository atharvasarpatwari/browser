import type { DomDocument, DomElement, DomNode, DomTextNode } from '../rendering/dom-tree';
import type { IndexableDocument, IndexableHeading } from './bm25-index';

/** Subtrees that are never page content (boilerplate, non-text, or form chrome). */
const SKIP_TAGS: ReadonlySet<string> = new Set([
  'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'embed',
  'nav', 'footer', 'aside', 'select', 'option', 'button', 'textarea',
]);

/** Never part of the readable body (their text is captured separately as title/description). */
const NON_BODY_TAGS: ReadonlySet<string> = new Set(['head', 'title']);

const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i;
const MAX_BODY_CHARS = 100_000;
const MAX_HEADINGS = 50;
const MIN_USEFUL_CHARS = 100;

const isElement = (n: DomNode): n is DomElement => n.nodeType === 'element';
const isText = (n: DomNode): n is DomTextNode => n.nodeType === 'text';
const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

function isHidden(el: DomElement): boolean {
  return el.attributes.has('hidden')
    || el.attributes.get('aria-hidden') === 'true'
    || HIDDEN_STYLE.test(el.attributes.get('style') ?? '');
}

/** Visible text under `root` in document order, skipping boilerplate subtrees (iterative: safe on deep DOMs). */
function textOf(root: DomNode, limit: number): string {
  const parts: string[] = [];
  let size = 0;
  const stack: DomNode[] = [root];
  while (stack.length > 0 && size < limit) {
    const node = stack.pop()!;
    if (isText(node)) {
      parts.push(node.text);
      size += node.text.length;
      continue;
    }
    if (node !== root && isElement(node)
      && (SKIP_TAGS.has(node.tagName) || NON_BODY_TAGS.has(node.tagName) || isHidden(node))) continue;
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }
  return collapse(parts.join(' ')).slice(0, limit);
}

/**
 * Pulls indexable content out of the engine's parsed DOM. Returns null for pages that must not be
 * indexed — login-style pages (password field), `robots: noindex`, or pages with nothing to read.
 */
function extractIndexableDocument(doc: DomDocument, url: string, visitedAt: number): IndexableDocument | null {
  let title = '';
  let description = '';
  let ogDescription = '';
  let main: DomElement | null = null;
  const headings: IndexableHeading[] = [];

  const stack: DomNode[] = [doc];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (isElement(node)) {
      const tag = node.tagName;
      if (tag === 'input' && node.attributes.get('type')?.toLowerCase() === 'password') return null;
      if (SKIP_TAGS.has(tag) || (isHidden(node) && tag !== 'html' && tag !== 'body')) continue;
      if (tag === 'meta') {
        const name = (node.attributes.get('name') ?? '').toLowerCase();
        const content = node.attributes.get('content') ?? '';
        if (name === 'robots' && /\bnoindex\b/i.test(content)) return null;
        if (name === 'description' && !description) description = collapse(content);
        if (node.attributes.get('property') === 'og:description' && !ogDescription) ogDescription = collapse(content);
      } else if (tag === 'title' && !title) {
        title = collapse(textOf(node, 500));
      } else if ((tag === 'h1' || tag === 'h2' || tag === 'h3') && headings.length < MAX_HEADINGS) {
        const text = collapse(textOf(node, 300));
        if (text) headings.push({ level: Number(tag[1]) as 1 | 2 | 3, text });
      } else if ((tag === 'main' || tag === 'article') && !main) {
        main = node;
      }
    }
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
  }

  // Whole document, not `bodyElement`: the tree builder can emit more than one <body>.
  const body = textOf(main ?? doc, MAX_BODY_CHARS);
  const meta = description || ogDescription;
  if (body.length < MIN_USEFUL_CHARS && headings.length === 0 && !meta) return null;

  return {
    url,
    title: title || headings.find((h) => h.level === 1)?.text || url,
    headings,
    description: meta,
    body,
    visitedAt,
  };
}

export { extractIndexableDocument };
