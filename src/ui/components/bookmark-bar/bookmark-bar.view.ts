import type { IDisposable } from '../../../app/dependency-container';
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

const ICON_FOLDER =
  '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2a1.5 1.5 0 0 1 1.06.44L8.5 3.7h4.5a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5h-10a1.5 1.5 0 0 1-1.5-1.5z"/></svg>';

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

    if (this.config.showBackButton) {
      this.backButton = document.createElement('button');
      this.backButton.setAttribute('type', 'button');
      this.backButton.className = 'nova-bk-item';
      this.backButton.textContent = '←';
      this.backButton.title = 'Back to parent folder';
      this.backButton.style.display = 'none';
      this.backButton.addEventListener('click', async () => {
        await this.model.navigateUp();
        await this.model.loadBookmarks();
      });
      this.container.appendChild(this.backButton);
    }

    this.itemsContainer = document.createElement('div');
    this.itemsContainer.className = 'nova-bookbar-items';
    this.itemsContainer.style.cssText = 'display:flex;align-items:center;gap:var(--sp-1);flex:1;min-width:0;overflow:hidden;';
    this.container.appendChild(this.itemsContainer);

    if (this.config.showAddButton) {
      this.addButton = document.createElement('button');
      this.addButton.setAttribute('type', 'button');
      this.addButton.className = 'nova-bk-item';
      this.addButton.textContent = '+';
      this.addButton.title = 'Add bookmark';
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
      this.backButton.style.display = state.activeFolderId ? 'flex' : 'none';
    }

    this.itemsContainer.innerHTML = '';
    const items = state.items.slice(0, this.config.maxVisible);

    for (const item of items) {
      if (item.folder) {
        const folderEl = document.createElement('div');
        folderEl.className = 'nova-bk-folder';
        folderEl.title = item.title;
        folderEl.innerHTML = ICON_FOLDER;
        const span = document.createElement('span');
        span.textContent = item.title;
        folderEl.appendChild(span);
        folderEl.addEventListener('click', async () => {
          this.dispatchEvent({ kind: 'folderClicked', folder: item });
          await this.model.navigateIntoFolder(item.id);
        });
        this.itemsContainer.appendChild(folderEl);
      } else {
        const bmEl = document.createElement('div');
        bmEl.className = 'nova-bk-item';
        const displayTitle = item.title || (item.url ? this.safeGetHostname(item.url) : 'Untitled');
        const span = document.createElement('span');
        span.textContent = displayTitle;
        bmEl.appendChild(span);
        bmEl.title = `${item.title}\n${item.url ?? ''}`;
        bmEl.addEventListener('click', () => {
          if (item.url) {
            this.dispatchEvent({ kind: 'bookmarkClicked', bookmark: item });
          }
        });
        this.itemsContainer.appendChild(bmEl);
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