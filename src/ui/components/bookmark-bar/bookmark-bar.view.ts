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
    this.container.className = 'nova-bookbar';

    if (this.config.showBackButton) {
      this.backButton = document.createElement('button');
      this.backButton.className = 'nova-new-tab';
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
    this.itemsContainer.style.cssText = 'display:flex;align-items:center;gap:2px;flex:1;overflow-x:auto;min-width:0;';
    this.container.appendChild(this.itemsContainer);

    if (this.config.showAddButton) {
      this.addButton = document.createElement('button');
      this.addButton.className = 'nova-new-tab';
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
        folderEl.textContent = `📁 ${item.title}`;
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

      if (items.indexOf(item) < items.length - 1) {
        const sep = document.createElement('div');
        sep.className = 'nova-toolbar-divider';
        sep.style.margin = '0 3px';
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
