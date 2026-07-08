import { describe, it, expect, vi } from 'vitest';
import { BookmarkService, BookmarkServiceEventBus } from '../src/browser/bookmarks/bookmark-services';
import { InMemoryBookmarkStore } from '../src/browser/storage/bookmark-store';

describe('InMemoryBookmarkStore', () => {
  it('should create a bookmark', async () => {
    const store = new InMemoryBookmarkStore();
    const bm = await store.create({ title: 'Example', url: 'https://example.com' });
    expect(bm.id).toBeTruthy();
    expect(bm.title).toBe('Example');
    expect(bm.url).toBe('https://example.com');
    expect(bm.folder).toBe(false);
    expect(bm.parentId).toBeNull();
    expect(bm.children).toEqual([]);
  });

  it('should create a folder', async () => {
    const store = new InMemoryBookmarkStore();
    const folder = await store.createFolder('My Folder');
    expect(folder.title).toBe('My Folder');
    expect(folder.folder).toBe(true);
    expect(folder.url).toBeNull();
  });

  it('should get bookmark by id', async () => {
    const store = new InMemoryBookmarkStore();
    const bm = await store.create({ title: 'Test', url: 'https://test.com' });
    const found = await store.get(bm.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(bm.id);
  });

  it('should return null for unknown id', async () => {
    const store = new InMemoryBookmarkStore();
    expect(await store.get('nonexistent')).toBeNull();
  });

  it('should get children for a parent', async () => {
    const store = new InMemoryBookmarkStore();
    const folder = await store.createFolder('Folder');
    const bm1 = await store.create({ parentId: folder.id, title: 'Child1', url: 'https://c1.com' });
    const bm2 = await store.create({ parentId: folder.id, title: 'Child2', url: 'https://c2.com' });

    const children = await store.getChildren(folder.id);
    expect(children).toHaveLength(2);
  });

  it('should get root children (parentId = null)', async () => {
    const store = new InMemoryBookmarkStore();
    await store.create({ title: 'Root1', url: 'https://r1.com' });
    await store.create({ title: 'Root2', url: 'https://r2.com' });
    const children = await store.getChildren(null);
    expect(children).toHaveLength(2);
  });

  it('getTree should return root children', async () => {
    const store = new InMemoryBookmarkStore();
    await store.create({ title: 'R1', url: 'https://r1.com' });
    await store.create({ title: 'R2', url: 'https://r2.com' });
    const tree = await store.getTree();
    expect(tree).toHaveLength(2);
  });

  it('query should filter by query string', async () => {
    const store = new InMemoryBookmarkStore();
    await store.create({ title: 'Alpha', url: 'https://alpha.com' });
    await store.create({ title: 'Beta', url: 'https://beta.com' });

    const results = await store.query({ query: 'alpha' });
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('Alpha');
  });

  it('query should filter by folderOnly', async () => {
    const store = new InMemoryBookmarkStore();
    await store.createFolder('Folder1');
    await store.create({ title: 'BM', url: 'https://bm.com' });

    const results = await store.query({ folderOnly: true });
    expect(results).toHaveLength(1);
    expect(results[0]!.folder).toBe(true);
  });

  it('query should filter by folderId', async () => {
    const store = new InMemoryBookmarkStore();
    const folder = await store.createFolder('Folder');
    await store.create({ parentId: folder.id, title: 'C1', url: 'https://c1.com' });
    await store.create({ title: 'Root', url: 'https://root.com' });

    const results = await store.query({ folderId: folder.id });
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe('C1');
  });

  it('query by folderId should return empty for non-folder', async () => {
    const store = new InMemoryBookmarkStore();
    const bm = await store.create({ title: 'NotFolder', url: 'https://nf.com' });
    const results = await store.query({ folderId: bm.id });
    expect(results).toHaveLength(0);
  });

  it('update should modify fields', async () => {
    const store = new InMemoryBookmarkStore();
    const bm = await store.create({ title: 'Old', url: 'https://old.com' });
    const updated = await store.update(bm.id, { title: 'New', url: 'https://new.com' });
    expect(updated!.title).toBe('New');
    expect(updated!.url).toBe('https://new.com');
    expect(updated!.lastModifiedTime).toBeGreaterThanOrEqual(bm.addedTime);
  });

  it('update should return null for missing id', async () => {
    const store = new InMemoryBookmarkStore();
    expect(await store.update('nonexistent', { title: 'X' })).toBeNull();
  });

  it('move should reparent a bookmark', async () => {
    const store = new InMemoryBookmarkStore();
    const folder1 = await store.createFolder('F1');
    const folder2 = await store.createFolder('F2');
    const bm = await store.create({ parentId: folder1.id, title: 'M', url: 'https://m.com' });

    const moved = await store.move(bm.id, folder2.id);
    expect(moved).toBe(true);

    const f1Kids = await store.getChildren(folder1.id);
    expect(f1Kids).toHaveLength(0);

    const f2Kids = await store.getChildren(folder2.id);
    expect(f2Kids).toHaveLength(1);
    expect(f2Kids[0]!.id).toBe(bm.id);
  });

  it('move should return false for missing id', async () => {
    const store = new InMemoryBookmarkStore();
    expect(await store.move('nonexistent', null)).toBe(false);
  });

  it('move to null should make it a root bookmark', async () => {
    const store = new InMemoryBookmarkStore();
    const folder = await store.createFolder('F');
    const bm = await store.create({ parentId: folder.id, title: 'M', url: 'https://m.com' });

    await store.move(bm.id, null);
    expect(bm.parentId).toBeNull();
  });

  it('remove should delete a bookmark', async () => {
    const store = new InMemoryBookmarkStore();
    const bm = await store.create({ title: 'Del', url: 'https://del.com' });
    const removed = await store.remove(bm.id);
    expect(removed).toBe(true);
    expect(await store.get(bm.id)).toBeNull();
  });

  it('remove should return false for missing id', async () => {
    const store = new InMemoryBookmarkStore();
    expect(await store.remove('nonexistent')).toBe(false);
  });

  it('remove should clean up parent children array for non-folder', async () => {
    const store = new InMemoryBookmarkStore();
    const folder = await store.createFolder('F');
    const bm = await store.create({ parentId: folder.id, title: 'C', url: 'https://c.com' });
    await store.remove(bm.id);
    const kids = await store.getChildren(folder.id);
    expect(kids).toHaveLength(0);
  });

  it('removeFolderTree should remove folder and descendants', async () => {
    const store = new InMemoryBookmarkStore();
    const parent = await store.createFolder('Parent');
    const child = await store.createFolder('Child', parent.id);
    await store.create({ parentId: child.id, title: 'Grandchild', url: 'https://gc.com' });
    const unrelated = await store.create({ title: 'Unrelated', url: 'https://other.com' });

    const count = await store.removeFolderTree(parent.id);
    expect(count).toBe(3);
    expect(await store.get(parent.id)).toBeNull();
    expect(await store.get(child.id)).toBeNull();
    expect(await store.get(unrelated.id)).not.toBeNull();
    expect(store.totalBookmarks).toBe(1);
  });

  it('removeFolderTree should return 0 for non-folder', async () => {
    const store = new InMemoryBookmarkStore();
    const bm = await store.create({ title: 'NotFolder', url: 'https://nf.com' });
    expect(await store.removeFolderTree(bm.id)).toBe(0);
  });

  it('removeFolderTree should return 0 for missing id', async () => {
    const store = new InMemoryBookmarkStore();
    expect(await store.removeFolderTree('missing')).toBe(0);
  });

  it('totalBookmarks should count only non-folders', async () => {
    const store = new InMemoryBookmarkStore();
    await store.create({ title: 'B1', url: 'https://b1.com' });
    await store.createFolder('F1');
    await store.create({ title: 'B2', url: 'https://b2.com' });
    expect(store.totalBookmarks).toBe(2);
  });

  it('totalFolders should count only folders', async () => {
    const store = new InMemoryBookmarkStore();
    await store.create({ title: 'B1', url: 'https://b1.com' });
    await store.createFolder('F1');
    await store.createFolder('F2');
    expect(store.totalFolders).toBe(2);
  });

  it('dispose should clear all entries', async () => {
    const store = new InMemoryBookmarkStore();
    await store.create({ title: 'T', url: 'https://t.com' });
    store.dispose();
    expect(store.totalBookmarks).toBe(0);
  });

  it('create with parentId should add to parent children', async () => {
    const store = new InMemoryBookmarkStore();
    const folder = await store.createFolder('F');
    const bm = await store.create({ parentId: folder.id, title: 'C', url: 'https://c.com' });
    expect(folder.children).toContain(bm);
  });

  it('createFolder with parentId should add to parent children', async () => {
    const store = new InMemoryBookmarkStore();
    const parent = await store.createFolder('P');
    const child = await store.createFolder('C', parent.id);
    expect(parent.children).toContain(child);
  });

  it('query should find by url in query', async () => {
    const store = new InMemoryBookmarkStore();
    await store.create({ title: 'Test', url: 'https://special-url.com/page' });
    const results = await store.query({ query: 'special-url' });
    expect(results).toHaveLength(1);
  });
});

describe('BookmarkServiceEventBus', () => {
  it('should emit to registered handlers', () => {
    const bus = new BookmarkServiceEventBus();
    const handler = vi.fn();
    bus.on('bookmarkCreated', handler);
    bus.emit({ kind: 'bookmarkCreated', bookmark: null as any });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should not call handlers of other event types', () => {
    const bus = new BookmarkServiceEventBus();
    const handler = vi.fn();
    bus.on('bookmarkRemoved', handler);
    bus.emit({ kind: 'bookmarkCreated', bookmark: null as any });
    expect(handler).not.toHaveBeenCalled();
  });

  it('off should remove handler', () => {
    const bus = new BookmarkServiceEventBus();
    const handler = vi.fn();
    bus.on('folderCreated', handler);
    bus.off('folderCreated', handler);
    bus.emit({ kind: 'folderCreated', folder: null as any });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should catch handler exceptions gracefully', () => {
    const bus = new BookmarkServiceEventBus();
    bus.on('bookmarkCreated', () => { throw new Error('crash'); });
    expect(() => bus.emit({ kind: 'bookmarkCreated', bookmark: null as any })).not.toThrow();
  });

  it('dispose should clear all channels', () => {
    const bus = new BookmarkServiceEventBus();
    const handler = vi.fn();
    bus.on('bookmarkUpdated', handler);
    bus.dispose();
    bus.emit({ kind: 'bookmarkUpdated', id: '1', changes: {} });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('BookmarkService', () => {
  it('should add a bookmark', async () => {
    const svc = new BookmarkService();
    const bm = await svc.addBookmark('Example', 'https://example.com');
    expect(bm.title).toBe('Example');
    expect(bm.url).toBe('https://example.com');
    expect(svc.totalBookmarks).toBe(1);
  });

  it('should not create duplicate bookmarks by url', async () => {
    const svc = new BookmarkService();
    const bm1 = await svc.addBookmark('Example', 'https://example.com');
    const bm2 = await svc.addBookmark('Example', 'https://example.com');
    expect(bm1.id).toBe(bm2.id);
    expect(svc.totalBookmarks).toBe(1);
  });

  it('should add a folder', async () => {
    const svc = new BookmarkService();
    const folder = await svc.addFolder('My Folder');
    expect(folder.title).toBe('My Folder');
    expect(folder.folder).toBe(true);
    expect(svc.totalFolders).toBe(1);
  });

  it('should get bookmark by id', async () => {
    const svc = new BookmarkService();
    const bm = await svc.addBookmark('Test', 'https://test.com');
    const found = await svc.getBookmark(bm.id);
    expect(found!.id).toBe(bm.id);
  });

  it('should get bookmark by url', async () => {
    const svc = new BookmarkService();
    await svc.addBookmark('Test', 'https://test.com');
    const found = await svc.getBookmarkByUrl('https://test.com');
    expect(found).not.toBeNull();
    expect(found!.url).toBe('https://test.com');
  });

  it('getBookmarkByUrl should return null for missing', async () => {
    const svc = new BookmarkService();
    expect(await svc.getBookmarkByUrl('https://missing.com')).toBeNull();
  });

  it('should get children', async () => {
    const svc = new BookmarkService();
    const folder = await svc.addFolder('Folder');
    await svc.addBookmark('C1', 'https://c1.com', { parentId: folder.id });
    await svc.addBookmark('C2', 'https://c2.com', { parentId: folder.id });
    const children = await svc.getChildren(folder.id);
    expect(children).toHaveLength(2);
  });

  it('should get tree', async () => {
    const svc = new BookmarkService();
    await svc.addBookmark('Root', 'https://root.com');
    const tree = await svc.getTree();
    expect(tree).toHaveLength(1);
  });

  it('should search bookmarks', async () => {
    const svc = new BookmarkService();
    await svc.addBookmark('Alpha', 'https://alpha.com');
    await svc.addBookmark('Beta', 'https://beta.com');
    const results = await svc.search('alpha');
    expect(results).toHaveLength(1);
  });

  it('should update a bookmark', async () => {
    const svc = new BookmarkService();
    const bm = await svc.addBookmark('Old', 'https://old.com');
    const updated = await svc.updateBookmark(bm.id, { title: 'New' });
    expect(updated!.title).toBe('New');
  });

  it('update should return null for missing id', async () => {
    const svc = new BookmarkService();
    expect(await svc.updateBookmark('missing', { title: 'X' })).toBeNull();
  });

  it('should move a bookmark', async () => {
    const svc = new BookmarkService();
    const folder1 = await svc.addFolder('F1');
    const folder2 = await svc.addFolder('F2');
    const bm = await svc.addBookmark('M', 'https://m.com', { parentId: folder1.id });

    const moved = await svc.moveBookmark(bm.id, folder2.id);
    expect(moved).toBe(true);

    const f1Kids = await svc.getChildren(folder1.id);
    expect(f1Kids).toHaveLength(0);
  });

  it('move should return false for missing id', async () => {
    const svc = new BookmarkService();
    expect(await svc.moveBookmark('missing', null)).toBe(false);
  });

  it('should remove a bookmark', async () => {
    const svc = new BookmarkService();
    const bm = await svc.addBookmark('Del', 'https://del.com');
    const removed = await svc.removeBookmark(bm.id);
    expect(removed).toBe(true);
    expect(svc.totalBookmarks).toBe(0);
  });

  it('remove should return false for missing id', async () => {
    const svc = new BookmarkService();
    expect(await svc.removeBookmark('missing')).toBe(false);
  });

  it('should remove a folder', async () => {
    const svc = new BookmarkService();
    const folder = await svc.addFolder('F');
    await svc.addBookmark('C', 'https://c.com', { parentId: folder.id });
    const count = await svc.removeFolder(folder.id);
    expect(count).toBe(2); // folder + child
    expect(svc.totalFolders).toBe(0);
  });

  it('isBookmarked should return true for existing url', async () => {
    const svc = new BookmarkService();
    await svc.addBookmark('Test', 'https://test.com');
    expect(await svc.isBookmarked('https://test.com')).toBe(true);
  });

  it('isBookmarked should return false for missing url', async () => {
    const svc = new BookmarkService();
    expect(await svc.isBookmarked('https://missing.com')).toBe(false);
  });

  it('should emit bookmarkCreated event', async () => {
    const svc = new BookmarkService();
    const handler = vi.fn();
    svc.on('bookmarkCreated', handler);
    await svc.addBookmark('Test', 'https://test.com');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should emit bookmarkRemoved event', async () => {
    const svc = new BookmarkService();
    const handler = vi.fn();
    svc.on('bookmarkRemoved', handler);
    const bm = await svc.addBookmark('Test', 'https://test.com');
    await svc.removeBookmark(bm.id);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bookmarkRemoved', id: bm.id }),
    );
  });

  it('should emit folderCreated event', async () => {
    const svc = new BookmarkService();
    const handler = vi.fn();
    svc.on('folderCreated', handler);
    await svc.addFolder('F');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should emit bookmarkUpdated event', async () => {
    const svc = new BookmarkService();
    const handler = vi.fn();
    svc.on('bookmarkUpdated', handler);
    const bm = await svc.addBookmark('Old', 'https://old.com');
    await svc.updateBookmark(bm.id, { title: 'New' });
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bookmarkUpdated', id: bm.id }),
    );
  });

  it('should emit bookmarkMoved event', async () => {
    const svc = new BookmarkService();
    const handler = vi.fn();
    svc.on('bookmarkMoved', handler);
    const folder = await svc.addFolder('F');
    const bm = await svc.addBookmark('M', 'https://m.com');
    await svc.moveBookmark(bm.id, folder.id);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'bookmarkMoved', id: bm.id }),
    );
  });

  it('should emit folderRemoved event', async () => {
    const svc = new BookmarkService();
    const handler = vi.fn();
    svc.on('folderRemoved', handler);
    const folder = await svc.addFolder('F');
    await svc.removeFolder(folder.id);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'folderRemoved', id: folder.id }),
    );
  });

  it('initialize and shutdown should work', async () => {
    const svc = new BookmarkService();
    await svc.initialize();
    await svc.shutdown();
  });

  it('on/off should register and unregister event handlers', async () => {
    const svc = new BookmarkService();
    const handler = vi.fn();
    svc.on('bookmarkCreated', handler);
    svc.off('bookmarkCreated', handler);
    await svc.addBookmark('Test', 'https://test.com');
    expect(handler).not.toHaveBeenCalled();
  });
});
