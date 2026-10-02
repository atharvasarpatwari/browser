import { describe, it, expect } from 'vitest';
import {
  parseNetscapeBookmarks,
  generateNetscapeBookmarks,
  buildTreeFromService,
  importIntoService,
  type ParsedBookmarkNode,
} from '../src/browser/bookmarks/bookmark-html-format';
import { BookmarkService } from '../src/browser/bookmarks/bookmark-services';

describe('Netscape bookmark format — generate/parse round trip', () => {
  it('round-trips a nested tree through generate -> parse', () => {
    const tree: ParsedBookmarkNode[] = [
      { type: 'bookmark', title: 'Nova Docs', url: 'https://example.test/docs' },
      {
        type: 'folder',
        title: 'Work',
        children: [
          { type: 'bookmark', title: 'Inbox', url: 'https://example.test/inbox' },
          { type: 'folder', title: 'Nested', children: [
            { type: 'bookmark', title: 'Deep link', url: 'https://example.test/deep' },
          ] },
        ],
      },
      // A folder NOT last at its level — regression case for the dt/dd
      // tree-builder gap documented in bookmark-html-format.ts: without an
      // explicit </DT>, this sibling would wrongly parse back nested
      // inside "Work" instead of as a top-level sibling.
      { type: 'bookmark', title: 'After the folder', url: 'https://example.test/after' },
    ];

    const html = generateNetscapeBookmarks(tree);
    expect(html).toContain('<!DOCTYPE NETSCAPE-Bookmark-file-1>');

    const parsed = parseNetscapeBookmarks(html);
    expect(parsed).toEqual(tree);
  });

  it('escapes and unescapes titles with special characters', () => {
    const tree: ParsedBookmarkNode[] = [
      { type: 'bookmark', title: 'Cats & "Dogs" <3', url: 'https://example.test/?a=1&b=2' },
    ];
    const html = generateNetscapeBookmarks(tree);
    const parsed = parseNetscapeBookmarks(html);
    expect(parsed).toEqual(tree);
  });

  it('parses a realistic real-world Netscape bookmark file snippet (explicit </DT> closing tags, as many real browser exports include despite the spec making them optional)', () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks Menu</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000">Folder A</H3></DT>
    <DL><p>
        <DT><A HREF="https://a.example/" ADD_DATE="1700000001">Site A</A></DT>
    </DL><p>
    <DT><A HREF="https://b.example/" ADD_DATE="1700000002">Site B</A></DT>
</DL><p>`;

    const parsed = parseNetscapeBookmarks(html);
    expect(parsed).toEqual([
      { type: 'folder', title: 'Folder A', children: [
        { type: 'bookmark', title: 'Site A', url: 'https://a.example/' },
      ] },
      { type: 'bookmark', title: 'Site B', url: 'https://b.example/' },
    ]);
  });

  it('parses the same structure correctly without explicit </DT> closing tags (the legacy/traditional style, since the tokenizer keys off <DL>/</DL> nesting, not DT closing, unlike an approach built on the general HTML tree builder would need to)', () => {
    const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<DL><p>
    <DT><H3>Folder A</H3>
    <DL><p>
        <DT><A HREF="https://a.example/">Site A</A>
    </DL><p>
    <DT><A HREF="https://b.example/">Site B</A>
</DL><p>`;

    const parsed = parseNetscapeBookmarks(html);
    expect(parsed).toEqual([
      { type: 'folder', title: 'Folder A', children: [
        { type: 'bookmark', title: 'Site A', url: 'https://a.example/' },
      ] },
      { type: 'bookmark', title: 'Site B', url: 'https://b.example/' },
    ]);
  });

  it('returns an empty array for a file with no bookmarks', () => {
    expect(parseNetscapeBookmarks('<html><body>not a bookmark file</body></html>')).toEqual([]);
  });
});

describe('buildTreeFromService / importIntoService — real BookmarkService, no mocks', () => {
  it('exports the real service tree, and importIntoService recreates an equivalent structure elsewhere', async () => {
    const service = new BookmarkService();
    await service.addBookmark('Top-level', 'https://example.test/top');
    const work = await service.addFolder('Work');
    await service.addBookmark('Inbox', 'https://example.test/inbox', { parentId: work.id });

    const exported = await buildTreeFromService(service);
    expect(exported).toEqual([
      { type: 'bookmark', title: 'Top-level', url: 'https://example.test/top' },
      { type: 'folder', title: 'Work', children: [
        { type: 'bookmark', title: 'Inbox', url: 'https://example.test/inbox' },
      ] },
    ]);

    // Simulates importing a file from elsewhere (distinct URLs) — BookmarkService.addBookmark
    // de-dupes globally by URL and returns the existing entry in place rather than creating a
    // second copy, so re-importing the exact same URLs wouldn't land them under the new folder.
    const incoming: ParsedBookmarkNode[] = [
      { type: 'bookmark', title: 'External', url: 'https://external.test/page' },
      { type: 'folder', title: 'Other', children: [
        { type: 'bookmark', title: 'External Nested', url: 'https://external.test/nested' },
      ] },
    ];
    const imported = await service.addFolder('Imported');
    await importIntoService(service, incoming, imported.id);

    const reExported = await buildTreeFromService(service, imported.id);
    expect(reExported).toEqual(incoming);
  });
});
