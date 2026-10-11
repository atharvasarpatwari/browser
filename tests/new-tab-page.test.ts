import { describe, it, expect, vi } from 'vitest';
import { NewTabPage } from '../src/ui/pages/new-tab-page';
import type { BookmarkEntry } from '../src/browser/storage/bookmark-store';

function createContainer(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

function bookmark(id: string, title: string, url: string): BookmarkEntry {
  return {
    id, parentId: null, title, url, iconUrl: null,
    addedTime: Date.now(), lastModifiedTime: Date.now(),
    children: [], folder: false, synced: false,
  };
}

describe('NewTabPage (unit)', () => {
  it('delivers events only to handlers registered for that event kind', () => {
    // Regression test: on()/emit() used to ignore the event kind entirely
    // and broadcast every event to every handler, so an 'add' tileAction
    // (which also carries a `url`) silently triggered the 'navigate'
    // handler too, navigating the tab away when a tile was merely added.
    const page = new NewTabPage();
    const container = createContainer();
    page.mount(container);

    const navigateHandler = vi.fn();
    const tileActionHandler = vi.fn();
    page.on('navigate', navigateHandler);
    page.on('tileAction', tileActionHandler);

    const addUrlInput = container.querySelector('[data-role="add-url"]') as HTMLInputElement;
    const addNameInput = container.querySelector('[data-role="add-name"]') as HTMLInputElement;
    const addForm = container.querySelector('[data-role="add-form"]') as HTMLFormElement;
    addNameInput.value = 'Example';
    addUrlInput.value = 'example.com';
    addForm.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(tileActionHandler).toHaveBeenCalledTimes(1);
    expect(tileActionHandler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'tileAction', action: 'add', title: 'Example', url: 'https://example.com' }),
    );
    expect(navigateHandler).not.toHaveBeenCalled();

    page.dispose();
  });

  it('off() stops a handler from receiving further events of that kind', () => {
    const page = new NewTabPage();
    const container = createContainer();
    page.mount(container);

    const handler = vi.fn();
    page.on('navigate', handler);
    page.off('navigate', handler);

    const searchForm = container.querySelector('[data-role="search-form"]') as HTMLFormElement;
    const searchInput = container.querySelector('[data-role="search-input"]') as HTMLInputElement;
    searchInput.value = 'hello world';
    searchForm.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handler).not.toHaveBeenCalled();
    page.dispose();
  });

  it('search submits a plain query as a search-engine URL', () => {
    const page = new NewTabPage();
    const container = createContainer();
    page.mount(container);
    page.setSearchEngine('bing');

    const handler = vi.fn();
    page.on('navigate', handler);
    const searchForm = container.querySelector('[data-role="search-form"]') as HTMLFormElement;
    const searchInput = container.querySelector('[data-role="search-input"]') as HTMLInputElement;
    searchInput.value = 'nova browser';
    searchForm.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'navigate', url: 'https://www.bing.com/search?q=nova%20browser' }),
    );
    page.dispose();
  });

  it('search submits a URL-shaped query directly as navigation', () => {
    const page = new NewTabPage();
    const container = createContainer();
    page.mount(container);

    const handler = vi.fn();
    page.on('navigate', handler);
    const searchForm = container.querySelector('[data-role="search-form"]') as HTMLFormElement;
    const searchInput = container.querySelector('[data-role="search-input"]') as HTMLInputElement;
    searchInput.value = 'example.com';
    searchForm.dispatchEvent(new Event('submit', { cancelable: true }));

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'navigate', url: 'https://example.com' }),
    );
    page.dispose();
  });

  it('renders real bookmarks in the rail and quick-links grid', () => {
    const page = new NewTabPage();
    const container = createContainer();
    page.mount(container);
    page.setBookmarks([bookmark('b1', 'My Bookmark', 'https://example.org')]);

    expect(container.querySelector('[data-role="rail"]')!.textContent).toContain('My Bookmark');
    expect(container.querySelector('[data-role="ql-track"]')!.textContent).toContain('My Bookmark');
    page.dispose();
  });

  it('clicking a bookmark tile emits a navigate event with its url', () => {
    const page = new NewTabPage();
    const container = createContainer();
    page.mount(container);
    page.setBookmarks([bookmark('b1', 'My Bookmark', 'https://example.org')]);

    const handler = vi.fn();
    page.on('navigate', handler);
    const tile = Array.from(container.querySelectorAll('.ntp-tile')).find(t => t.textContent?.includes('My Bookmark'))!;
    tile.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'navigate', url: 'https://example.org' }));
    page.dispose();
  });

  it('removing a tile emits a remove tileAction, not a navigate', () => {
    const page = new NewTabPage();
    const container = createContainer();
    page.mount(container);
    page.setBookmarks([bookmark('b1', 'My Bookmark', 'https://example.org')]);

    const navigateHandler = vi.fn();
    const tileActionHandler = vi.fn();
    page.on('navigate', navigateHandler);
    page.on('tileAction', tileActionHandler);

    const removeBtn = container.querySelector('.ntp-remove-btn') as HTMLButtonElement;
    removeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(tileActionHandler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'tileAction', action: 'remove', url: 'https://example.org' }),
    );
    expect(navigateHandler).not.toHaveBeenCalled();
    page.dispose();
  });

  it('unmount clears the container and mount can be called again', () => {
    const page = new NewTabPage();
    const container = createContainer();
    page.mount(container);
    expect(container.children.length).toBeGreaterThan(0);
    page.unmount();
    expect(container.children.length).toBe(0);
    expect(page.isMounted).toBe(false);
  });
});
