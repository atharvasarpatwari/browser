import type { IDisposable } from '../../app/dependency-container';

interface BookmarkEntry {
  readonly id: string;
  parentId: string | null;
  title: string;
  url: string | null;
  iconUrl: string | null;
  addedTime: number;
  lastModifiedTime: number;
  readonly children: BookmarkEntry[];
  readonly folder: boolean;
  readonly synced: boolean;
}

interface BookmarkQuery {
  readonly query?: string;
  readonly folderId?: string;
  readonly folderOnly?: boolean;
}

interface IBookmarkStore extends IDisposable {
  create(options: {
    parentId?: string | null;
    title: string;
    url?: string;
    iconUrl?: string;
  }): Promise<BookmarkEntry>;
  createFolder(title: string, parentId?: string | null): Promise<BookmarkEntry>;
  get(id: string): Promise<BookmarkEntry | null>;
  getChildren(parentId: string | null): Promise<readonly BookmarkEntry[]>;
  getTree(): Promise<readonly BookmarkEntry[]>;
  query(options: BookmarkQuery): Promise<readonly BookmarkEntry[]>;
  update(id: string, changes: Partial<Pick<BookmarkEntry, 'title' | 'url' | 'iconUrl'>>): Promise<BookmarkEntry | null>;
  move(id: string, newParentId: string | null, index?: number): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  removeFolderTree(id: string): Promise<number>;
  readonly totalBookmarks: number;
  readonly totalFolders: number;
}

let _bookmarkSeq = 0;
function nextBookmarkId(): string {
  return `bm-${Date.now()}-${(++_bookmarkSeq).toString(36)}`;
}

class InMemoryBookmarkStore implements IBookmarkStore {
  private readonly entries = new Map<string, BookmarkEntry>();

  async create(options: {
    parentId?: string | null;
    title: string;
    url?: string;
    iconUrl?: string;
  }): Promise<BookmarkEntry> {
    const now = Date.now();
    const id = nextBookmarkId();
    const parentId = options.parentId ?? null;

    const entry: BookmarkEntry = {
      id,
      parentId,
      title: options.title,
      url: options.url ?? null,
      iconUrl: options.iconUrl ?? null,
      addedTime: now,
      lastModifiedTime: now,
      children: [],
      folder: false,
      synced: false,
    };

    this.entries.set(id, entry);
    if (parentId) {
      const parent = this.entries.get(parentId);
      if (parent) {
        (parent.children as BookmarkEntry[]).push(entry);
      }
    }

    return entry;
  }

  async createFolder(title: string, parentId?: string | null): Promise<BookmarkEntry> {
    const now = Date.now();
    const id = nextBookmarkId();
    const pId = parentId ?? null;

    const folder: BookmarkEntry = {
      id,
      parentId: pId,
      title,
      url: null,
      iconUrl: null,
      addedTime: now,
      lastModifiedTime: now,
      children: [],
      folder: true,
      synced: false,
    };

    this.entries.set(id, folder);
    if (pId) {
      const parent = this.entries.get(pId);
      if (parent) {
        (parent.children as BookmarkEntry[]).push(folder);
      }
    }

    return folder;
  }

  async get(id: string): Promise<BookmarkEntry | null> {
    return this.entries.get(id) ?? null;
  }

  async getChildren(parentId: string | null): Promise<readonly BookmarkEntry[]> {
    return [...this.entries.values()]
      .filter(e => e.parentId === parentId)
      .sort((a, b) => a.addedTime - b.addedTime);
  }

  async getTree(): Promise<readonly BookmarkEntry[]> {
    return this.getChildren(null);
  }

  async query(options: BookmarkQuery): Promise<readonly BookmarkEntry[]> {
    let results = [...this.entries.values()];

    if (options.folderOnly) {
      results = results.filter(e => e.folder);
    }

    if (options.query) {
      const q = options.query.toLowerCase();
      results = results.filter(
        e => e.title.toLowerCase().includes(q) ||
             (e.url && e.url.toLowerCase().includes(q)),
      );
    }

    if (options.folderId) {
      const folder = this.entries.get(options.folderId);
      if (folder?.folder) {
        return folder.children;
      }
      return [];
    }

    return results.sort((a, b) => a.addedTime - b.addedTime);
  }

  async update(
    id: string,
    changes: Partial<Pick<BookmarkEntry, 'title' | 'url' | 'iconUrl'>>,
  ): Promise<BookmarkEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;

    const updated: BookmarkEntry = {
      ...entry,
      ...changes,
      lastModifiedTime: Date.now(),
    };

    this.entries.set(id, updated);
    return updated;
  }

  async move(id: string, newParentId: string | null, _index?: number): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;

    const oldParent = entry.parentId ? this.entries.get(entry.parentId) : null;
    if (oldParent) {
      const idx = oldParent.children.findIndex(c => c.id === id);
      if (idx !== -1) (oldParent.children as BookmarkEntry[]).splice(idx, 1);
    }

    (entry as { parentId: string | null }).parentId = newParentId;

    if (newParentId) {
      const newParent = this.entries.get(newParentId);
      if (newParent) {
        (newParent.children as BookmarkEntry[]).push(entry);
      }
    }

    return true;
  }

  async remove(id: string): Promise<boolean> {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (!entry.folder && entry.parentId) {
      const parent = this.entries.get(entry.parentId);
      if (parent) {
        const idx = parent.children.findIndex(c => c.id === id);
        if (idx !== -1) (parent.children as BookmarkEntry[]).splice(idx, 1);
      }
    }
    return this.entries.delete(id);
  }

  async removeFolderTree(id: string): Promise<number> {
    const folder = this.entries.get(id);
    if (!folder || !folder.folder) return 0;

    let count = 0;
    const toRemove = [id];
    while (toRemove.length > 0) {
      const currentId = toRemove.pop()!;
      const current = this.entries.get(currentId);
      if (!current) continue;

      for (const child of current.children) {
        toRemove.push(child.id);
      }

      if (current.parentId) {
        const parent = this.entries.get(current.parentId);
        if (parent) {
          const idx = parent.children.findIndex(c => c.id === current.id);
          if (idx !== -1) (parent.children as BookmarkEntry[]).splice(idx, 1);
        }
      }

      this.entries.delete(currentId);
      count++;
    }

    return count;
  }

  get totalBookmarks(): number {
    return [...this.entries.values()].filter(e => !e.folder).length;
  }

  get totalFolders(): number {
    return [...this.entries.values()].filter(e => e.folder).length;
  }

  dispose(): void {
    this.entries.clear();
  }
}

export { InMemoryBookmarkStore };
export type { IBookmarkStore, BookmarkEntry, BookmarkQuery };
