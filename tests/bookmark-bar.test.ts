import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BookmarkBar, BookmarkBarEventBus } from '../src/ui/components/bookmark-bar/bookmark-bar';

describe('BookmarkBar', () => {
  let bar: BookmarkBar;

  beforeEach(() => {
    bar = new BookmarkBar();
  });

  it('should have empty initial state', () => {
    expect(bar.state.items).toEqual([]);
    expect(bar.state.activeFolderId).toBeNull();
  });

  it('should add a bookmark', async () => {
    const bm = await bar.addBookmark('Example', 'https://example.com');
    expect(bm.title).toBe('Example');
    expect(bm.url).toBe('https://example.com');
  });

  it('should emit addBookmark event', async () => {
    const handler = vi.fn();
    bar.on('addBookmark', handler);
    await bar.addBookmark('Example', 'https://example.com');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'addBookmark', title: 'Example', url: 'https://example.com' })
    );
  });

  it('should remove a bookmark', async () => {
    const bm = await bar.addBookmark('Example', 'https://example.com');
    const removed = await bar.removeBookmark(bm.id);
    expect(removed).toBe(true);
  });

  it('should emit removeBookmark event', async () => {
    const bm = await bar.addBookmark('Example', 'https://example.com');
    const handler = vi.fn();
    bar.on('removeBookmark', handler);
    await bar.removeBookmark(bm.id);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'removeBookmark', bookmarkId: bm.id })
    );
  });

  it('should return false when removing nonexistent bookmark', async () => {
    expect(await bar.removeBookmark('nonexistent')).toBe(false);
  });

  it('should update a bookmark', async () => {
    const bm = await bar.addBookmark('Example', 'https://example.com');
    const updated = await bar.updateBookmark(bm.id, 'New Title', 'https://new.com');
    expect(updated).toBe(true);
  });

  it('should return false when updating nonexistent bookmark', async () => {
    expect(await bar.updateBookmark('nonexistent', 'Title', 'https://url.com')).toBe(false);
  });

  it('should add a folder', async () => {
    const folder = await bar.addFolder('Work');
    expect(folder.title).toBe('Work');
    expect(folder.folder).toBe(true);
  });

  it('should add bookmark to folder', async () => {
    const folder = await bar.addFolder('Work');
    const bm = await bar.addBookmark('Example', 'https://example.com', folder.id);
    expect(bm.parentId).toBe(folder.id);
  });

  it('should navigate into folder and back', async () => {
    const folder = await bar.addFolder('Work');
    await bar.addBookmark('Root Bookmark', 'https://root.com');
    await bar.addBookmark('Folder Bookmark', 'https://folder.com', folder.id);

    await bar.navigateIntoFolder(folder.id);
    expect(bar.state.activeFolderId).toBe(folder.id);

    await bar.navigateUp();
    expect(bar.state.activeFolderId).toBeNull();
  });

  it('isBookmarked should detect bookmarked URLs', async () => {
    await bar.addBookmark('Example', 'https://example.com');
    expect(await bar.isBookmarked('https://example.com')).toBe(true);
    expect(await bar.isBookmarked('https://other.com')).toBe(false);
  });

  it('should validate URL schemes', async () => {
    await expect(bar.addBookmark('Bad', 'javascript:alert(1)')).rejects.toThrow('Invalid bookmark');
    await expect(bar.addBookmark('Bad', 'data:text/html,<h1>hi</h1>')).rejects.toThrow('Invalid bookmark');
  });

  it('dispose should clean up', async () => {
    await bar.addBookmark('Example', 'https://example.com');
    bar.dispose();
    expect(bar.state.items).toEqual([]);
  });
});

describe('BookmarkBarEventBus', () => {
  it('should emit events to registered handlers', () => {
    const bus = new BookmarkBarEventBus();
    const handler = vi.fn();
    bus.on('bookmarkClicked', handler);
    bus.emit({ kind: 'bookmarkClicked', bookmark: { id: '1', title: 'T', url: 'U', folder: false, parentId: null, children: [], createdAt: 0 } });
    expect(handler).toHaveBeenCalledTimes(1);
    bus.dispose();
  });

  it('off should remove a handler', () => {
    const bus = new BookmarkBarEventBus();
    const handler = vi.fn();
    bus.on('removeBookmark', handler);
    bus.off('removeBookmark', handler);
    bus.emit({ kind: 'removeBookmark', bookmarkId: '1' });
    expect(handler).not.toHaveBeenCalled();
    bus.dispose();
  });

  it('dispose should clear all channels', () => {
    const bus = new BookmarkBarEventBus();
    const handler = vi.fn();
    bus.on('addBookmark', handler);
    bus.dispose();
    bus.emit({ kind: 'addBookmark', title: '', url: '' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should respect rate limit', () => {
    const bus = new BookmarkBarEventBus();
    const handler = vi.fn();
    bus.on('bookmarkClicked', handler);
    for (let i = 0; i < 110; i++) {
      bus.emit({ kind: 'bookmarkClicked', bookmark: { id: '1', title: 'T', url: 'U', folder: false, parentId: null, children: [], createdAt: 0 } });
    }
    expect(handler).toHaveBeenCalledTimes(100);
    bus.dispose();
  });
});
