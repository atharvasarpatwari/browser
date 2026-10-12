import { describe, it, expect, beforeEach } from 'vitest';
import { BookmarkBar } from '../src/ui/components/bookmark-bar/bookmark-bar';
import { BookmarkBarView } from '../src/ui/components/bookmark-bar/bookmark-bar.view';
import type { BookmarkBarEventUnion } from '../src/ui/components/bookmark-bar/bookmark-bar';

function createDomContainer(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

function keydown(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('BookmarkBarView keyboard navigation', () => {
  let bar: BookmarkBar;
  let view: BookmarkBarView;
  let container: HTMLElement;
  let events: BookmarkBarEventUnion[];

  beforeEach(async () => {
    bar = new BookmarkBar();
    await bar.addBookmark('Example', 'https://example.com');
    await bar.addFolder('My Folder');

    view = new BookmarkBarView(bar);
    container = createDomContainer();
    view.attach(container);
    events = [];
    view.setEventHandler((e) => { events.push(e); });
    view.update(bar.state);
  });

  function items(): HTMLElement[] {
    // Scoped to .nova-bookbar-items (not the whole container) since the
    // back/add-bookmark buttons also use the .nova-bk-item class.
    return [...container.querySelectorAll('.nova-bookbar-items > .nova-bk-item, .nova-bookbar-items > .nova-bk-folder')] as HTMLElement[];
  }

  it('makes every item focusable with role="button"', () => {
    const els = items();
    expect(els).toHaveLength(2);
    for (const el of els) {
      expect(el.tabIndex).toBe(0);
      expect(el.getAttribute('role')).toBe('button');
    }
  });

  it('Enter activates a bookmark item (click-equivalent)', () => {
    const bookmarkEl = items().find(el => el.classList.contains('nova-bk-item'))!;
    keydown(bookmarkEl, 'Enter');
    expect(events).toContainEqual(expect.objectContaining({ kind: 'bookmarkClicked' }));
  });

  it('Space activates a folder item (click-equivalent)', async () => {
    const folderEl = items().find(el => el.classList.contains('nova-bk-folder'))!;
    keydown(folderEl, ' ');
    // navigateIntoFolder is async; let its microtask settle.
    await Promise.resolve();
    expect(events).toContainEqual(expect.objectContaining({ kind: 'folderClicked' }));
  });

  it('does nothing on Enter/Space when keyboard nav is disabled', () => {
    view.setKeyboardNavEnabled(false);
    const bookmarkEl = items().find(el => el.classList.contains('nova-bk-item'))!;
    keydown(bookmarkEl, 'Enter');
    expect(events).toHaveLength(0);
  });

  it('other keys are ignored', () => {
    const bookmarkEl = items().find(el => el.classList.contains('nova-bk-item'))!;
    keydown(bookmarkEl, 'a');
    expect(events).toHaveLength(0);
  });
});
