import type { ISharedService } from '../../app/app-shell';
import type { IBookmarkStore, BookmarkEntry, BookmarkQuery } from '../storage/bookmark-store';
import { InMemoryBookmarkStore } from '../storage/bookmark-store';
import { BookmarkValidator } from './bookmark-validator';

type BookmarkServiceEventType =
  | 'bookmarkCreated' | 'bookmarkRemoved' | 'bookmarkUpdated'
  | 'folderCreated' | 'folderRemoved' | 'bookmarkMoved';

interface BookmarkServiceEvent {
  readonly kind: BookmarkServiceEventType;
}

interface BookmarkCreatedEvent extends BookmarkServiceEvent {
  readonly kind: 'bookmarkCreated';
  readonly bookmark: BookmarkEntry;
}

interface BookmarkRemovedEvent extends BookmarkServiceEvent {
  readonly kind: 'bookmarkRemoved';
  readonly id: string;
  readonly url: string | null;
}

interface BookmarkUpdatedEvent extends BookmarkServiceEvent {
  readonly kind: 'bookmarkUpdated';
  readonly id: string;
  readonly changes: Partial<Pick<BookmarkEntry, 'title' | 'url' | 'iconUrl'>>;
}

interface FolderCreatedEvent extends BookmarkServiceEvent {
  readonly kind: 'folderCreated';
  readonly folder: BookmarkEntry;
}

interface FolderRemovedEvent extends BookmarkServiceEvent {
  readonly kind: 'folderRemoved';
  readonly id: string;
  readonly count: number;
}

interface BookmarkMovedEvent extends BookmarkServiceEvent {
  readonly kind: 'bookmarkMoved';
  readonly id: string;
  readonly newParentId: string | null;
}

type BookmarkServiceEventUnion =
  | BookmarkCreatedEvent
  | BookmarkRemovedEvent
  | BookmarkUpdatedEvent
  | FolderCreatedEvent
  | FolderRemovedEvent
  | BookmarkMovedEvent;

interface IBookmarkService extends ISharedService {
  addBookmark(title: string, url: string, options?: { parentId?: string; iconUrl?: string }): Promise<BookmarkEntry>;
  addFolder(title: string, parentId?: string): Promise<BookmarkEntry>;
  getBookmark(id: string): Promise<BookmarkEntry | null>;
  getBookmarkByUrl(url: string): Promise<BookmarkEntry | null>;
  getChildren(parentId?: string | null): Promise<readonly BookmarkEntry[]>;
  getTree(): Promise<readonly BookmarkEntry[]>;
  search(query: string): Promise<readonly BookmarkEntry[]>;
  updateBookmark(id: string, changes: Partial<Pick<BookmarkEntry, 'title' | 'url' | 'iconUrl'>>): Promise<BookmarkEntry | null>;
  moveBookmark(id: string, newParentId: string | null): Promise<boolean>;
  removeBookmark(id: string): Promise<boolean>;
  removeFolder(id: string): Promise<number>;
  isBookmarked(url: string): Promise<boolean>;
  readonly totalBookmarks: number;
  readonly totalFolders: number;
  on(type: BookmarkServiceEventType, handler: (event: BookmarkServiceEventUnion) => void): void;
  off(type: BookmarkServiceEventType, handler: (event: BookmarkServiceEventUnion) => void): void;
}

type BookmarkServiceEventHandler = (event: BookmarkServiceEventUnion) => void;

class BookmarkServiceEventBus {
  private readonly channels = new Map<BookmarkServiceEventType, Set<BookmarkServiceEventHandler>>();

  on(type: BookmarkServiceEventType, handler: BookmarkServiceEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: BookmarkServiceEventType, handler: BookmarkServiceEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: BookmarkServiceEventUnion): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[BookmarkService] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

class BookmarkService implements IBookmarkService {
  readonly name = 'BookmarkService';

  private readonly store: IBookmarkStore;
  private readonly bus = new BookmarkServiceEventBus();
  private readonly validator = new BookmarkValidator();
  private _initialized = false;

  constructor(store: IBookmarkStore = new InMemoryBookmarkStore()) {
    this.store = store;
  }

  async initialize(): Promise<void> {
    this._initialized = true;
  }

  async shutdown(): Promise<void> {
    this.bus.dispose();
    this.validator.dispose();
    this._initialized = false;
  }

  async addBookmark(title: string, url: string, options?: { parentId?: string; iconUrl?: string }): Promise<BookmarkEntry> {
    const validation = this.validator.validateBookmark(url, title);
    if (!validation.valid) {
      throw new Error(`Invalid bookmark: ${validation.error}`);
    }

    const existing = await this.findByUrl(validation.sanitizedUrl);
    if (existing) return existing;

    const bookmark = await this.store.create({
      parentId: options?.parentId,
      title: validation.sanitizedTitle,
      url: validation.sanitizedUrl,
      iconUrl: options?.iconUrl,
    });

    this.bus.emit({ kind: 'bookmarkCreated', bookmark });
    return bookmark;
  }

  async addFolder(title: string, parentId?: string): Promise<BookmarkEntry> {
    const folder = await this.store.createFolder(title, parentId ?? null);
    this.bus.emit({ kind: 'folderCreated', folder });
    return folder;
  }

  async getBookmark(id: string): Promise<BookmarkEntry | null> {
    return this.store.get(id);
  }

  async getBookmarkByUrl(url: string): Promise<BookmarkEntry | null> {
    const results = await this.store.query({ query: url });
    return results.find(r => r.url === url) ?? null;
  }

  async getChildren(parentId?: string | null): Promise<readonly BookmarkEntry[]> {
    return this.store.getChildren(parentId ?? null);
  }

  async getTree(): Promise<readonly BookmarkEntry[]> {
    return this.store.getTree();
  }

  async search(query: string): Promise<readonly BookmarkEntry[]> {
    return this.store.query({ query });
  }

  async updateBookmark(id: string, changes: Partial<Pick<BookmarkEntry, 'title' | 'url' | 'iconUrl'>>): Promise<BookmarkEntry | null> {
    if (changes.url !== undefined) {
      const urlResult = this.validator.validateUrl(changes.url);
      if (!urlResult.valid) throw new Error(`Invalid URL: ${urlResult.error}`);
      changes = { ...changes, url: urlResult.sanitized };
    }
    if (changes.title !== undefined) {
      const titleResult = this.validator.validateTitle(changes.title);
      if (!titleResult.valid) throw new Error(`Invalid title: ${titleResult.error}`);
      changes = { ...changes, title: titleResult.sanitized };
    }

    const updated = await this.store.update(id, changes);
    if (updated) {
      this.bus.emit({ kind: 'bookmarkUpdated', id, changes });
    }
    return updated;
  }

  async moveBookmark(id: string, newParentId: string | null): Promise<boolean> {
    const result = await this.store.move(id, newParentId);
    if (result) {
      this.bus.emit({ kind: 'bookmarkMoved', id, newParentId });
    }
    return result;
  }

  async removeBookmark(id: string): Promise<boolean> {
    const entry = await this.store.get(id);
    if (!entry) return false;
    const result = await this.store.remove(id);
    if (result) {
      this.bus.emit({ kind: 'bookmarkRemoved', id, url: entry.url });
    }
    return result;
  }

  async removeFolder(id: string): Promise<number> {
    const count = await this.store.removeFolderTree(id);
    if (count > 0) {
      this.bus.emit({ kind: 'folderRemoved', id, count });
    }
    return count;
  }

  async isBookmarked(url: string): Promise<boolean> {
    const bookmark = await this.findByUrl(url);
    return bookmark !== null;
  }

  get totalBookmarks(): number {
    return this.store.totalBookmarks;
  }

  get totalFolders(): number {
    return this.store.totalFolders;
  }

  on(type: BookmarkServiceEventType, handler: BookmarkServiceEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: BookmarkServiceEventType, handler: BookmarkServiceEventHandler): void {
    this.bus.off(type, handler);
  }

  private async findByUrl(url: string): Promise<BookmarkEntry | null> {
    const results = await this.store.query({ query: url });
    return results.find(r => r.url === url) ?? null;
  }
}

export { BookmarkService, BookmarkServiceEventBus };
export type { IBookmarkService, BookmarkServiceEventUnion, BookmarkServiceEventType };
