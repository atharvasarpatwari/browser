import type { IDisposable } from '../../app/dependency-container';

interface IFileSystemAccessService extends IDisposable {
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileHandle[]>;
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileHandle>;
  showDirectoryPicker(options?: DirectoryPickerOptions): Promise<DirectoryHandle>;
  getOriginPrivateDirectory(): Promise<DirectoryHandle>;
  isSupported: boolean;
  onEvent(handler: FileSystemEventHandler): () => void;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  types?: FilePickerType[];
  excludeAcceptAllOption?: boolean;
  startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: FilePickerType[];
  excludeAcceptAllOption?: boolean;
  startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

interface DirectoryPickerOptions {
  startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

interface FilePickerType {
  description?: string;
  accept: Record<string, string[]>;
}

interface FileHandle {
  readonly name: string;
  readonly kind: 'file';
  getFile(): Promise<File>;
  createWritable(options?: FileWritableOptions): Promise<WritableStream>;
  isSameEntry(other: FileHandle): Promise<boolean>;
}

interface DirectoryHandle {
  readonly name: string;
  readonly kind: 'directory';
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, FileHandle | DirectoryHandle]>;
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<FileHandle | DirectoryHandle>;
  isSameEntry(other: DirectoryHandle): Promise<boolean>;
}

interface FileWritableOptions {
  keepExistingData?: boolean;
}

type FileSystemEventKind = 'file-opened' | 'file-saved' | 'directory-opened' | 'error';
type FileSystemEventHandler = (event: FileSystemEvent) => void;

interface FileSystemEvent {
  readonly kind: FileSystemEventKind;
  readonly data?: Record<string, unknown>;
}

class InMemoryFileHandle implements FileHandle {
  readonly name: string;
  readonly kind: 'file' = 'file';
  private _content: Uint8Array;

  constructor(name: string, content?: Uint8Array) {
    this.name = name;
    this._content = content ?? new Uint8Array(0);
  }

  async getFile(): Promise<File> {
    return new File([this._content], this.name);
  }

  async createWritable(_options?: FileWritableOptions): Promise<WritableStream> {
    const self = this;
    return new WritableStream({
      write(chunk) {
        const buffer = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk);
        self._content = buffer;
      },
    });
  }

  async isSameEntry(other: FileHandle): Promise<boolean> {
    return this === other;
  }
}

class InMemoryDirectoryHandle implements DirectoryHandle {
  readonly name: string;
  readonly kind: 'directory' = 'directory';
  private _entries = new Map<string, FileHandle | DirectoryHandle>();

  constructor(name: string) {
    this.name = name;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandle> {
    const existing = this._entries.get(name);
    if (existing && existing.kind === 'file') return existing as FileHandle;
    if (options?.create) {
      const handle = new InMemoryFileHandle(name);
      this._entries.set(name, handle);
      return handle;
    }
    throw new DOMException(`File "${name}" not found`, 'NotFoundError');
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandle> {
    const existing = this._entries.get(name);
    if (existing && existing.kind === 'directory') return existing as DirectoryHandle;
    if (options?.create) {
      const handle = new InMemoryDirectoryHandle(name);
      this._entries.set(name, handle);
      return handle;
    }
    throw new DOMException(`Directory "${name}" not found`, 'NotFoundError');
  }

  async removeEntry(name: string, _options?: { recursive?: boolean }): Promise<void> {
    this._entries.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, FileHandle | DirectoryHandle]> {
    for (const [name, handle] of this._entries) {
      yield [name, handle];
    }
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const name of this._entries.keys()) {
      yield name;
    }
  }

  async *values(): AsyncIterableIterator<FileHandle | DirectoryHandle> {
    for (const handle of this._entries.values()) {
      yield handle;
    }
  }

  async isSameEntry(other: DirectoryHandle): Promise<boolean> {
    return this === other;
  }
}

class FileSystemAccessService implements IFileSystemAccessService {
  private _handlers = new Set<FileSystemEventHandler>();

  get isSupported(): boolean {
    return true;
  }

  async showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileHandle[]> {
    const count = options?.multiple ? 3 : 1;
    const result: FileHandle[] = [];
    for (let i = 0; i < count; i++) {
      result.push(new InMemoryFileHandle(`file_${i}.txt`));
    }
    this.emit({ kind: 'file-opened', data: { count: result.length } });
    return result;
  }

  async showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileHandle> {
    const name = options?.suggestedName ?? 'untitled.txt';
    const handle = new InMemoryFileHandle(name);
    this.emit({ kind: 'file-saved', data: { name } });
    return handle;
  }

  async showDirectoryPicker(_options?: DirectoryPickerOptions): Promise<DirectoryHandle> {
    const handle = new InMemoryDirectoryHandle('picked-directory');
    this.emit({ kind: 'directory-opened', data: { name: 'picked-directory' } });
    return handle;
  }

  async getOriginPrivateDirectory(): Promise<DirectoryHandle> {
    return new InMemoryDirectoryHandle('origin-private');
  }

  onEvent(handler: FileSystemEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: FileSystemEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
  }
}

export { FileSystemAccessService, InMemoryFileHandle, InMemoryDirectoryHandle };
export type { IFileSystemAccessService, FileHandle, DirectoryHandle, FilePickerType, OpenFilePickerOptions, SaveFilePickerOptions, DirectoryPickerOptions, FileWritableOptions, FileSystemEvent, FileSystemEventKind, FileSystemEventHandler };
