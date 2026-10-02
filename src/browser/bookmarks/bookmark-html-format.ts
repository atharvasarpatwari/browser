/**
 * The Netscape Bookmark File Format — the universal interop format every
 * real browser uses for bookmark import/export (a nested
 * <DL><p><DT><H3>folder</H3><DL><p>...</DL><p></DT><DT><A HREF=...>...</DL><p>
 * structure).
 *
 * ponytail: parsing does NOT reuse the engine's general HtmlParser/DomTree,
 * despite that being the obvious first instinct ("it's just HTML, reuse the
 * real parser") — tried it first, and confirmed by dumping the real parsed
 * tree that Nova's HTML5 tree builder does not reliably close <dt>/<dl> once
 * more than one folder is nested (a real, pre-existing tree-builder bug,
 * unrelated to this feature and out of scope to fix here). A dedicated
 * token-stream + explicit-stack parser below sidesteps that entirely and is
 * simple precisely because this format's real structure (just DT/H3/A/DL
 * tags in sequence) doesn't need a general tree builder at all — real
 * browsers' own bookmark importers use a dedicated parser for the same
 * reason, not their page-rendering HTML engine.
 */
import type { IBookmarkService } from './bookmark-services';

export type ParsedBookmarkNode =
  | { readonly type: 'bookmark'; readonly title: string; readonly url: string }
  | { readonly type: 'folder'; readonly title: string; readonly children: readonly ParsedBookmarkNode[] };

function unescapeHtml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

type Token =
  | { readonly kind: 'bookmark'; readonly title: string; readonly url: string }
  | { readonly kind: 'folderHeader'; readonly title: string }
  | { readonly kind: 'dlOpen' }
  | { readonly kind: 'dlClose' };

const TOKEN_RE = /<DT>\s*<A\s+[^>]*?HREF="([^"]*)"[^>]*>(.*?)<\/A>|<DT>\s*<H3[^>]*>(.*?)<\/H3>|<DL>|<\/DL>/gis;

function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  for (const m of html.matchAll(TOKEN_RE)) {
    if (m[1] !== undefined) tokens.push({ kind: 'bookmark', url: unescapeHtml(m[1]), title: unescapeHtml((m[2] ?? '').trim()) });
    else if (m[3] !== undefined) tokens.push({ kind: 'folderHeader', title: unescapeHtml(m[3].trim()) });
    else if (m[0].toUpperCase() === '<DL>') tokens.push({ kind: 'dlOpen' });
    else tokens.push({ kind: 'dlClose' });
  }
  return tokens;
}

export function parseNetscapeBookmarks(html: string): ParsedBookmarkNode[] {
  const root: ParsedBookmarkNode[] = [];
  // One stack frame per open <DL> level: the array its children get pushed
  // into, and (for every level but the implicit root) the folder node whose
  // `.children` that array backs.
  const stack: { children: ParsedBookmarkNode[] }[] = [{ children: root }];
  let pendingFolderTitle: string | null = null;

  for (const token of tokenize(html)) {
    switch (token.kind) {
      case 'bookmark':
        stack[stack.length - 1]!.children.push({ type: 'bookmark', title: token.title, url: token.url });
        pendingFolderTitle = null;
        break;
      case 'folderHeader':
        pendingFolderTitle = token.title;
        break;
      case 'dlOpen': {
        if (pendingFolderTitle === null) break; // the outermost wrapping <DL> — already the root frame
        const children: ParsedBookmarkNode[] = [];
        stack[stack.length - 1]!.children.push({ type: 'folder', title: pendingFolderTitle, children });
        stack.push({ children });
        pendingFolderTitle = null;
        break;
      }
      case 'dlClose':
        if (stack.length > 1) stack.pop(); // ignore an unmatched close rather than throwing on a malformed file
        break;
    }
  }

  return root;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function generateNodes(nodes: readonly ParsedBookmarkNode[], indent: string): string {
  const lines: string[] = [];
  for (const node of nodes) {
    if (node.type === 'bookmark') {
      // </DT> is optional per spec (many real exports omit it) but harmless
      // to include, and matches real browsers' own export convention.
      lines.push(`${indent}<DT><A HREF="${escapeHtml(node.url)}">${escapeHtml(node.title)}</A></DT>`);
    } else {
      lines.push(`${indent}<DT><H3>${escapeHtml(node.title)}</H3></DT>`);
      lines.push(`${indent}<DL><p>`);
      lines.push(generateNodes(node.children, indent + '    '));
      lines.push(`${indent}</DL><p>`);
    }
  }
  return lines.join('\n');
}

/** Generates a real Netscape bookmark file from an in-order list of top-level nodes. */
export function generateNetscapeBookmarks(roots: readonly ParsedBookmarkNode[]): string {
  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- This is an automatically generated file. It will be read and overwritten. -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    generateNodes(roots, '    '),
    '</DL><p>',
    '',
  ].join('\n');
}

/**
 * Walks the real BookmarkService tree into export-ready nodes. Recurses via
 * getChildren(id) per folder rather than relying on a pre-populated
 * `.children` field — IBookmarkStore fetches one level at a time, children
 * aren't eagerly embedded.
 */
export async function buildTreeFromService(service: IBookmarkService, parentId: string | null = null): Promise<ParsedBookmarkNode[]> {
  const entries = await service.getChildren(parentId ?? undefined);
  const nodes: ParsedBookmarkNode[] = [];
  for (const entry of entries) {
    if (entry.folder) {
      nodes.push({ type: 'folder', title: entry.title, children: await buildTreeFromService(service, entry.id) });
    } else if (entry.url) {
      nodes.push({ type: 'bookmark', title: entry.title, url: entry.url });
    }
  }
  return nodes;
}

/** Recreates parsed nodes under the given parent folder via the real BookmarkService CRUD. */
export async function importIntoService(service: IBookmarkService, nodes: readonly ParsedBookmarkNode[], parentId: string): Promise<void> {
  for (const node of nodes) {
    if (node.type === 'bookmark') {
      await service.addBookmark(node.title, node.url, { parentId });
    } else {
      const folder = await service.addFolder(node.title, parentId);
      await importIntoService(service, node.children, folder.id);
    }
  }
}
