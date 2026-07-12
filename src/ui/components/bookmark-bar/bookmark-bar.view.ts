import type { IDisposable } from '../../../app/dependency-container';
import type { BookmarkEntry } from '../../../browser/bookmarks/bookmark-services';
import type { IBookmarkBar, BookmarkBarState, BookmarkBarEventUnion } from './bookmark-bar';

interface BookmarkBarViewConfig {
  readonly containerId: string;
  readonly maxVisible: number;
  readonly showAddButton: boolean;
  readonly showBackButton: boolean;
}

const DEFAULT_VIEW_CONFIG: BookmarkBarViewConfig = {
  containerId: 'bookmark-bar',
  maxVisible: 50,
  showAddButton: true,
  showBackButton: true,
};

interface IBookmarkBarView extends IDisposable {
  readonly element: HTMLElement | null;
  attach(container: HTMLElement): void;
  detach(): void;
  update(state: BookmarkBarState): void;
  setEventHandler(handler: (event: BookmarkBarEventUnion) => void): void;
}

class BookmarkBarView implements IBookmarkBarView {
  private readonly config: BookmarkBarViewConfig;
  private readonly model: IBookmarkBar;
  private container: HTMLElement | null = null;
  private itemsContainer: HTMLElement | null = null;
  private backButton: HTMLElement | null = null;
  private addButton: HTMLElement | null = null;
  private eventHandler: ((event: BookmarkBarEventUnion) => void) | null = null;

  constructor(model: IBookmarkBar, config?: Partial<BookmarkBarViewConfig>) {
    this.model = model;
    this.config = { ...DEFAULT_VIEW_CONFIG, ...config };
  }

  get element(): HTMLElement | null {
    return this.container;
  }

  attach(container: HTMLElement): void {
    this.container = container;
    this.build();
  }

  detach(): void {
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this.itemsContainer = null;
    this.backButton = null;
    this.addButton = null;
  }

  update(state: BookmarkBarState): void {
    this.renderItems(state);
  }

  setEventHandler(handler: (event: BookmarkBarEventUnion) => void): void {
    this.eventHandler = handler;
  }

  private build(): void {
    if (!this.container) return;
    this.container.innerHTML = '';
    this.container.className = 'bookmark-bar';
    this.container.style.cssText = 'display:flex;align-items:center;padding:2px 8px;background:var(--bg-elevated);border-bottom:1px solid var(--border-subtle);flex-shrink:0;gap:2px;overflow-x:auto;height:26px;';

    if (this.config.showBackButton) {
      this.backButton = document.createElement('button');
      this.backButton.className = 'bookmark-back-btn';
      this.backButton.textContent = '←';
      this.backButton.title = 'Back to parent folder';
      this.backButton.style.cssText = 'border:none;background:none;color:var(--text-tertiary);font-size:13px;cursor:pointer;padding:2px 6px;border-radius:var(--radius-sm);line-height:1;transition:all var(--t-fast);flex-shrink:0;display:none;font-family:inherit;';
      this.backButton.addEventListener('click', async () => {
        await this.model.navigateUp();
        await this.model.loadBookmarks();
      });
      this.container.appendChild(this.backButton);
    }

    this.itemsContainer = document.createElement('div');
    this.itemsContainer.className = 'bookmark-bar-items';
    this.itemsContainer.style.cssText = 'display:flex;align-items:center;gap:2px;flex:1;overflow-x:auto;min-width:0;';
    this.container.appendChild(this.itemsContainer);

    if (this.config.showAddButton) {
      this.addButton = document.createElement('button');
      this.addButton.className = 'bookmark-add-btn';
      this.addButton.textContent = '+';
      this.addButton.title = 'Add bookmark';
      this.addButton.style.cssText = 'border:none;background:none;color:var(--text-tertiary);font-size:14px;cursor:pointer;padding:2px 6px;border-radius:var(--radius-sm);line-height:1;transition:all var(--t-fast);flex-shrink:0;font-family:inherit;';
      this.addButton.addEventListener('mouseenter', () => {
        if (this.addButton) this.addButton.style.color = 'var(--text-primary)';
      });
      this.addButton.addEventListener('mouseleave', () => {
        if (this.addButton) this.addButton.style.color = 'var(--text-tertiary)';
      });
      this.addButton.addEventListener('click', () => {
        this.dispatchEvent({ kind: 'addBookmark', title: '', url: '' });
      });
      this.container.appendChild(this.addButton);
    }

    void this.model.loadBookmarks().then(() => {
      this.renderItems(this.model.state);
    });
  }

  private renderItems(state: BookmarkBarState): void {
    if (!this.itemsContainer) return;

    if (this.backButton) {
      this.backButton.style.display = state.activeFolderId ? 'block' : 'none';
    }

    this.itemsContainer.innerHTML = '';
    const items = state.items.slice(0, this.config.maxVisible);

    for (const item of items) {
      if (item.folder) {
        const folderEl = document.createElement('div');
        folderEl.className = 'bm-item bm-folder';
        folderEl.style.cssText = 'padding:2px 9px;font-size:11px;color:var(--text-secondary);cursor:pointer;border-radius:var(--radius-sm);transition:all var(--t-fast);display:flex;align-items:center;gap:4px;font-weight:500;white-space:nowrap;';
        folderEl.textContent = `📁 ${item.title}`;
        folderEl.addEventListener('click', async () => {
          this.dispatchEvent({ kind: 'folderClicked', folder: item });
          await this.model.navigateIntoFolder(item.id);
        });
        folderEl.addEventListener('mouseenter', () => {
          folderEl.style.background = 'var(--bg-overlay)';
          folderEl.style.color = 'var(--text-primary)';
        });
        folderEl.addEventListener('mouseleave', () => {
          folderEl.style.background = 'none';
          folderEl.style.color = 'var(--text-secondary)';
        });
        this.itemsContainer.appendChild(folderEl);
      } else {
        const bmEl = document.createElement('div');
        bmEl.className = 'bm-item';
        bmEl.style.cssText = 'padding:2px 9px;font-size:11px;color:var(--text-secondary);cursor:pointer;border-radius:var(--radius-sm);transition:all var(--t-fast);display:flex;align-items:center;gap:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;';
        const displayTitle = item.title || (item.url ? this.safeGetHostname(item.url) : 'Untitled');
        bmEl.textContent = displayTitle;
        bmEl.title = `${item.title}\n${item.url ?? ''}`;
        bmEl.addEventListener('click', () => {
          if (item.url) {
            this.dispatchEvent({ kind: 'bookmarkClicked', bookmark: item });
          }
        });
        bmEl.addEventListener('mouseenter', () => {
          bmEl.style.background = 'var(--bg-overlay)';
          bmEl.style.color = 'var(--text-primary)';
        });
        bmEl.addEventListener('mouseleave', () => {
          bmEl.style.background = 'none';
          bmEl.style.color = 'var(--text-secondary)';
        });
        this.itemsContainer.appendChild(bmEl);
      }

      if (items.indexOf(item) < items.length - 1) {
        const sep = document.createElement('div');
        sep.className = 'bm-sep';
        sep.style.cssText = 'width:1px;height:14px;background:var(--border-subtle);margin:0 3px;flex-shrink:0;';
        this.itemsContainer.appendChild(sep);
      }
    }
  }

  private safeGetHostname(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  }

  private dispatchEvent(event: BookmarkBarEventUnion): void {
    if (this.eventHandler) {
      this.eventHandler(event);
    }
  }

  dispose(): void {
    this.detach();
    this.eventHandler = null;
  }
}

export { BookmarkBarView, DEFAULT_VIEW_CONFIG };
export type { IBookmarkBarView, BookmarkBarViewConfig };
