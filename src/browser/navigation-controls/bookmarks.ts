import type { IDisposable } from '../../app/dependency-container';

interface BookmarkItem {
  readonly id: string;
  title: string;
  url: string | null;
  iconUrl: string | null;
  parentId: string | null;
  readonly folder: boolean;
  readonly children: BookmarkItem[];
  readonly addedTime: number;
  lastModifiedTime: number;
}

interface IBookmarksService extends IDisposable {
  getAll(): BookmarkItem[];
  getTree(): BookmarkItem[];
  getById(id: string): BookmarkItem | null;
  getByUrl(url: string): BookmarkItem | null;
  search(query: string): BookmarkItem[];
  add(url: string, title: string, parentId?: string): BookmarkItem;
  addFolder(title: string, parentId?: string): BookmarkItem;
  update(id: string, changes: Partial<Pick<BookmarkItem, 'title' | 'url'>>): boolean;
  remove(id: string): boolean;
  get totalCount(): number;
  onEvent(handler: BookmarksEventHandler): () => void;
}

type BookmarksEventKind = 'created' | 'removed' | 'updated' | 'moved';
interface BookmarksEvent {
  readonly kind: BookmarksEventKind;
  readonly item: BookmarkItem;
}

type BookmarksEventHandler = (event: BookmarksEvent) => void;

interface BookmarkEntryLike {
  readonly id: string;
  title: string;
  url: string | null;
  iconUrl: string | null;
  parentId: string | null;
  readonly folder: boolean;
  readonly children: BookmarkEntryLike[];
  readonly addedTime: number;
  lastModifiedTime: number;
  readonly synced: boolean;
}

interface BookmarkServiceLike {
  getTree(): Promise<readonly BookmarkEntryLike[]>;
  get(id: string): Promise<BookmarkEntryLike | null>;
  getBookmarkByUrl(url: string): Promise<BookmarkEntryLike | null>;
  search(query: string): Promise<readonly BookmarkEntryLike[]>;
  addBookmark(options: { parentId?: string | null; title: string; url?: string; iconUrl?: string }): Promise<BookmarkEntryLike>;
  addFolder(title: string, parentId?: string | null): Promise<BookmarkEntryLike>;
  updateBookmark(id: string, changes: Partial<Pick<BookmarkEntryLike, 'title' | 'url' | 'iconUrl'>>): Promise<BookmarkEntryLike | null>;
  removeBookmark(id: string): Promise<boolean>;
  on(type: string, handler: (...args: unknown[]) => void): void;
  off(type: string, handler: (...args: unknown[]) => void): void;
}

function toItem(e: BookmarkEntryLike): BookmarkItem {
  return {
    id: e.id, title: e.title, url: e.url, iconUrl: e.iconUrl,
    parentId: e.parentId, folder: e.folder,
    children: (e.children ?? []).map(toItem),
    addedTime: e.addedTime, lastModifiedTime: e.lastModifiedTime,
  };
}

class BookmarksService implements IBookmarksService {
  private service: BookmarkServiceLike;
  private handlers = new Set<BookmarksEventHandler>();
  private boundHandlers: Array<() => void> = [];
  private _cached: BookmarkEntryLike[] = [];

  constructor(service: BookmarkServiceLike) {
    this.service = service;
    this.wireEvents();
    this.service.getTree().then(tree => { this._cached = [...tree]; }).catch(() => {});
  }

  get totalCount(): number {
    return this.countItems(this._cached);
  }

  private countItems(items: BookmarkEntryLike[]): number {
    let c = 0;
    for (const item of items) {
      if (!item.folder && item.url) c++;
      if (item.children) c += this.countItems(item.children);
    }
    return c;
  }

  getAll(): BookmarkItem[] {
    return this._cached.map(toItem);
  }

  getTree(): BookmarkItem[] {
    return this._cached.map(toItem);
  }

  getById(id: string): BookmarkItem | null {
    return this.findInTree(this._cached, id);
  }

  private findInTree(items: BookmarkEntryLike[], id: string): BookmarkItem | null {
    for (const item of items) {
      if (item.id === id) return toItem(item);
      if (item.children) {
        const found = this.findInTree(item.children, id);
        if (found) return found;
      }
    }
    return null;
  }

  getByUrl(url: string): BookmarkItem | null {
    const found = this._cached.flatMap(e => this.flatten(e)).find(e => e.url === url);
    return found ? toItem(found) : null;
  }

  private flatten(e: BookmarkEntryLike): BookmarkEntryLike[] {
    return [e, ...(e.children ?? []).flatMap(c => this.flatten(c))];
  }

  search(query: string): BookmarkItem[] {
    const q = query.toLowerCase();
    const results: BookmarkItem[] = [];
    for (const item of this._cached.flatMap(e => this.flatten(e))) {
      if (!item.folder && item.url) {
        if (item.title.toLowerCase().includes(q) || item.url.toLowerCase().includes(q)) {
          results.push(toItem(item));
        }
      }
    }
    return results;
  }

  add(url: string, title: string, parentId?: string): BookmarkItem {
    this.service.addBookmark({ title, url, parentId: parentId ?? null }).then(e => {
      this._cached = [...this._cached];
    }).catch(() => {});
    return { id: '', title, url, iconUrl: null, parentId: parentId ?? null, folder: false, children: [], addedTime: Date.now(), lastModifiedTime: Date.now() };
  }

  addFolder(title: string, parentId?: string): BookmarkItem {
    this.service.addFolder(title, parentId ?? null).then(e => {
      this._cached = [...this._cached];
    }).catch(() => {});
    return { id: '', title, url: null, iconUrl: null, parentId: parentId ?? null, folder: true, children: [], addedTime: Date.now(), lastModifiedTime: Date.now() };
  }

  update(id: string, changes: Partial<Pick<BookmarkItem, 'title' | 'url'>>): boolean {
    this.service.updateBookmark(id, changes).catch(() => {});
    return true;
  }

  remove(id: string): boolean {
    this.service.removeBookmark(id).then(() => {
      this._cached = [...this._cached];
    }).catch(() => {});
    return true;
  }

  private wireEvents(): void {
    const mapKind: Record<string, BookmarksEventKind> = {
      bookmarkCreated: 'created', bookmarkRemoved: 'removed',
      bookmarkUpdated: 'updated', bookmarkMoved: 'moved',
    };
    for (const [type, kind] of Object.entries(mapKind)) {
      const handler = (e: unknown) => {
        const ev = e as { item?: BookmarkEntryLike };
        if (ev?.item) {
          this.emit({ kind, item: toItem(ev.item) });
          this.service.getTree().then(tree => { this._cached = [...tree]; }).catch(() => {});
        }
      };
      this.service.on(type, handler);
      this.boundHandlers.push(() => this.service.off(type, handler));
    }
  }

  onEvent(handler: BookmarksEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: BookmarksEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    for (const unbind of this.boundHandlers) unbind();
    this.boundHandlers.length = 0;
    this.handlers.clear();
    this._cached = [];
  }
}

export { BookmarksService };
export type { IBookmarksService, BookmarkItem, BookmarksEvent, BookmarksEventKind, BookmarksEventHandler, BookmarkServiceLike, BookmarkEntryLike };
