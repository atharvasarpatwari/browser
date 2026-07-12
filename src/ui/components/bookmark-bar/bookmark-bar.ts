import type { IDisposable } from '../../../app/dependency-container';
import type { IBookmarkService, BookmarkEntry } from '../../../browser/bookmarks/bookmark-services';
import { BookmarkService } from '../../../browser/bookmarks/bookmark-services';
import { BookmarkValidator } from '../../../browser/bookmarks/bookmark-validator';

type BookmarkBarEventType =
  | 'bookmarkClicked' | 'addBookmark' | 'removeBookmark'
  | 'editBookmark' | 'folderClicked' | 'addFolder';

interface BookmarkBarEvent {
  readonly kind: BookmarkBarEventType;
}

interface BookmarkClickedEvent extends BookmarkBarEvent {
  readonly kind: 'bookmarkClicked';
  readonly bookmark: BookmarkEntry;
}

interface AddBookmarkEvent extends BookmarkBarEvent {
  readonly kind: 'addBookmark';
  readonly title: string;
  readonly url: string;
}

interface RemoveBookmarkEvent extends BookmarkBarEvent {
  readonly kind: 'removeBookmark';
  readonly bookmarkId: string;
}

interface EditBookmarkEvent extends BookmarkBarEvent {
  readonly kind: 'editBookmark';
  readonly bookmarkId: string;
  readonly title: string;
  readonly url: string;
}

interface FolderClickedEvent extends BookmarkBarEvent {
  readonly kind: 'folderClicked';
  readonly folder: BookmarkEntry;
}

interface AddFolderEvent extends BookmarkBarEvent {
  readonly kind: 'addFolder';
  readonly name: string;
}

type BookmarkBarEventUnion =
  | BookmarkClickedEvent
  | AddBookmarkEvent
  | RemoveBookmarkEvent
  | EditBookmarkEvent
  | FolderClickedEvent
  | AddFolderEvent;

interface BookmarkBarState {
  readonly items: readonly BookmarkEntry[];
  readonly activeFolderId: string | null;
}

interface IBookmarkBar extends IDisposable {
  readonly state: BookmarkBarState;
  addBookmark(title: string, url: string, parentId?: string): Promise<BookmarkEntry>;
  removeBookmark(id: string): Promise<boolean>;
  updateBookmark(id: string, title: string, url: string): Promise<boolean>;
  addFolder(name: string, parentId?: string): Promise<BookmarkEntry>;
  removeFolder(id: string): Promise<boolean>;
  navigateIntoFolder(folderId: string): Promise<void>;
  navigateUp(): Promise<void>;
  loadBookmarks(): Promise<void>;
  isBookmarked(url: string): Promise<boolean>;
  on(type: BookmarkBarEventType, handler: (event: BookmarkBarEventUnion) => void): void;
  off(type: BookmarkBarEventType, handler: (event: BookmarkBarEventUnion) => void): void;
}

type BookmarkBarEventHandler = (event: BookmarkBarEventUnion) => void;

class BookmarkBarEventBus {
  private readonly channels = new Map<BookmarkBarEventType, Set<BookmarkBarEventHandler>>();
  private emitCount = 0;
  private readonly maxEmitRate = 100;

  on(type: BookmarkBarEventType, handler: BookmarkBarEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: BookmarkBarEventType, handler: BookmarkBarEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: BookmarkBarEventUnion): void {
    this.emitCount++;
    if (this.emitCount > this.maxEmitRate) return;
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[BookmarkBar] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  resetRateLimit(): void { this.emitCount = 0; }

  dispose(): void { this.channels.clear(); this.emitCount = 0; }
}

class BookmarkBar implements IBookmarkBar {
  private readonly service: IBookmarkService;
  private readonly validator: BookmarkValidator;
  private readonly bus = new BookmarkBarEventBus();
  private _items: BookmarkEntry[] = [];
  private _activeFolderId: string | null = null;

  constructor(service?: IBookmarkService) {
    this.service = service ?? new BookmarkService();
    this.validator = new BookmarkValidator();
  }

  get state(): BookmarkBarState {
    return {
      items: [...this._items],
      activeFolderId: this._activeFolderId,
    };
  }

  async loadBookmarks(): Promise<void> {
    const items = await this.service.getChildren(this._activeFolderId);
    this._items = [...items];
  }

  async addBookmark(title: string, url: string, parentId?: string): Promise<BookmarkEntry> {
    const validation = this.validator.validateBookmark(url, title);
    if (!validation.valid) throw new Error(`Invalid bookmark: ${validation.error}`);

    const bookmark = await this.service.addBookmark(
      validation.sanitizedTitle,
      validation.sanitizedUrl,
      { parentId: parentId ?? this._activeFolderId ?? undefined },
    );
    this.bus.emit({ kind: 'addBookmark', title: validation.sanitizedTitle, url: validation.sanitizedUrl });
    await this.loadBookmarks();
    return bookmark;
  }

  async removeBookmark(id: string): Promise<boolean> {
    const result = await this.service.removeBookmark(id);
    if (result) {
      this.bus.emit({ kind: 'removeBookmark', bookmarkId: id });
      await this.loadBookmarks();
    }
    return result;
  }

  async updateBookmark(id: string, title: string, url: string): Promise<boolean> {
    const validation = this.validator.validateBookmark(url, title);
    if (!validation.valid) throw new Error(`Invalid bookmark: ${validation.error}`);

    const updated = await this.service.updateBookmark(id, {
      title: validation.sanitizedTitle,
      url: validation.sanitizedUrl,
    });
    if (updated) {
      this.bus.emit({ kind: 'editBookmark', bookmarkId: id, title: validation.sanitizedTitle, url: validation.sanitizedUrl });
      await this.loadBookmarks();
      return true;
    }
    return false;
  }

  async addFolder(name: string, parentId?: string): Promise<BookmarkEntry> {
    const titleResult = this.validator.validateTitle(name);
    if (!titleResult.valid) throw new Error(`Invalid folder name: ${titleResult.error}`);

    const folder = await this.service.addFolder(
      titleResult.sanitized,
      parentId ?? this._activeFolderId ?? undefined,
    );
    this.bus.emit({ kind: 'addFolder', name: titleResult.sanitized });
    await this.loadBookmarks();
    return folder;
  }

  async removeFolder(id: string): Promise<boolean> {
    const count = await this.service.removeFolder(id);
    if (count > 0) await this.loadBookmarks();
    return count > 0;
  }

  async navigateIntoFolder(folderId: string): Promise<void> {
    this._activeFolderId = folderId;
    await this.loadBookmarks();
  }

  async navigateUp(): Promise<void> {
    if (!this._activeFolderId) return;
    const folder = await this.service.getBookmark(this._activeFolderId);
    this._activeFolderId = folder?.parentId ?? null;
    await this.loadBookmarks();
  }

  async isBookmarked(url: string): Promise<boolean> {
    return this.service.isBookmarked(url);
  }

  on(type: BookmarkBarEventType, handler: BookmarkBarEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: BookmarkBarEventType, handler: BookmarkBarEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    this.bus.dispose();
    this.validator.dispose();
    this._items.length = 0;
  }
}

export { BookmarkBar, BookmarkBarEventBus };
export type {
  IBookmarkBar,
  BookmarkBarState,
  BookmarkBarEventUnion,
  BookmarkBarEventType,
};
