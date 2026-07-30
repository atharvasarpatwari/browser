import type { IDisposable } from '../../app/dependency-container';

interface IOPFSService extends IDisposable {
  getRoot(): Promise<OPFSDirectoryHandle>;
  estimate(): Promise<StorageEstimate>;
  requestQuota(bytes: number): Promise<boolean>;
  onEvent(handler: OPFSEventHandler): () => void;
}

interface StorageEstimate {
  readonly quota: number;
  readonly usage: number;
}

interface OPFSDirectoryHandle {
  readonly name: string;
  readonly kind: 'directory';
  getFileHandle(name: string, options?: { create?: boolean }): Promise<OPFSFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OPFSDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterableIterator<[string, OPFSFileHandle | OPFSDirectoryHandle]>;
  keys(): AsyncIterableIterator<string>;
  values(): AsyncIterableIterator<OPFSFileHandle | OPFSDirectoryHandle>;
}

interface OPFSFileHandle {
  readonly name: string;
  readonly kind: 'file';
  getFile(): Promise<File>;
  createWritable(options?: OPFSFileWritableOptions): Promise<OPFSWritableStream>;
  getSize(): Promise<number>;
}

interface OPFSFileWritableOptions {
  keepExistingData?: boolean;
}

interface OPFSWritableStream {
  write(data: BufferSource | string): Promise<void>;
  seek(position: number): Promise<void>;
  truncate(size: number): Promise<void>;
  close(): Promise<void>;
}

type OPFSEventKind = 'file-created' | 'file-deleted' | 'directory-created' | 'directory-deleted' | 'quota-exceeded';
type OPFSEventHandler = (event: OPFSEvent) => void;

interface OPFSEvent {
  readonly kind: OPFSEventKind;
  readonly data?: Record<string, unknown>;
}

const DEFAULT_QUOTA = 50 * 1024 * 1024;

class OPFSWritableStreamImpl implements OPFSWritableStream {
  private _buffer: Uint8Array;

  constructor(initial: Uint8Array = new Uint8Array(0)) {
    this._buffer = new Uint8Array(initial);
  }

  async write(data: BufferSource | string): Promise<void> {
    const encoded = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data as ArrayBuffer);
    const newBuf = new Uint8Array(this._buffer.length + encoded.length);
    newBuf.set(this._buffer);
    newBuf.set(encoded, this._buffer.length);
    this._buffer = newBuf;
  }

  async seek(position: number): Promise<void> {
    if (position > this._buffer.length) {
      const newBuf = new Uint8Array(position);
      newBuf.set(this._buffer);
      this._buffer = newBuf;
    }
  }

  async truncate(size: number): Promise<void> {
    if (size < this._buffer.length) {
      this._buffer = this._buffer.slice(0, size);
    }
  }

  async close(): Promise<void> {
  }

  getBuffer(): Uint8Array {
    return this._buffer;
  }
}

class OPFSFileHandleImpl implements OPFSFileHandle {
  readonly name: string;
  readonly kind: 'file' = 'file';
  private _data: Uint8Array;

  constructor(name: string, data?: Uint8Array) {
    this.name = name;
    this._data = data ?? new Uint8Array(0);
  }

  async getFile(): Promise<File> {
    return new File([this._data], this.name);
  }

  async createWritable(options?: OPFSFileWritableOptions): Promise<OPFSWritableStream> {
    const stream = new OPFSWritableStreamImpl(options?.keepExistingData ? this._data : undefined);
    const originalResolve = stream.close.bind(stream);
    stream.close = async () => {
      await originalResolve();
      this._data = stream.getBuffer();
    };
    return stream;
  }

  async getSize(): Promise<number> {
    return this._data.length;
  }
}

class OPFSDirectoryHandleImpl implements OPFSDirectoryHandle {
  readonly name: string;
  readonly kind: 'directory' = 'directory';
  private _entries = new Map<string, OPFSFileHandle | OPFSDirectoryHandle>();

  constructor(name: string) {
    this.name = name;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<OPFSFileHandle> {
    const existing = this._entries.get(name);
    if (existing && existing.kind === 'file') return existing as OPFSFileHandle;
    if (options?.create) {
      const handle = new OPFSFileHandleImpl(name);
      this._entries.set(name, handle);
      return handle;
    }
    throw new DOMException(`File "${name}" not found`, 'NotFoundError');
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<OPFSDirectoryHandle> {
    const existing = this._entries.get(name);
    if (existing && existing.kind === 'directory') return existing as OPFSDirectoryHandle;
    if (options?.create) {
      const handle = new OPFSDirectoryHandleImpl(name);
      this._entries.set(name, handle);
      return handle;
    }
    throw new DOMException(`Directory "${name}" not found`, 'NotFoundError');
  }

  async removeEntry(name: string, _options?: { recursive?: boolean }): Promise<void> {
    this._entries.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, OPFSFileHandle | OPFSDirectoryHandle]> {
    for (const [name, handle] of this._entries) {
      yield [name, handle];
    }
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const name of this._entries.keys()) {
      yield name;
    }
  }

  async *values(): AsyncIterableIterator<OPFSFileHandle | OPFSDirectoryHandle> {
    for (const handle of this._entries.values()) {
      yield handle;
    }
  }
}

class OPFSService implements IOPFSService {
  private _root: OPFSDirectoryHandleImpl;
  private _usage = 0;
  private _quota = DEFAULT_QUOTA;
  private _handlers = new Set<OPFSEventHandler>();

  constructor() {
    this._root = new OPFSDirectoryHandleImpl('root');
  }

  async getRoot(): Promise<OPFSDirectoryHandle> {
    return this._root;
  }

  async estimate(): Promise<StorageEstimate> {
    return { quota: this._quota, usage: this._usage };
  }

  async requestQuota(bytes: number): Promise<boolean> {
    if (bytes <= this._quota - this._usage) {
      this._usage += bytes;
      return true;
    }
    this.emit({ kind: 'quota-exceeded', data: { requested: bytes, available: this._quota - this._usage } });
    return false;
  }

  onEvent(handler: OPFSEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: OPFSEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._usage = 0;
  }
}

export { OPFSService, OPFSDirectoryHandleImpl, OPFSFileHandleImpl, OPFSWritableStreamImpl };
export type { IOPFSService, OPFSDirectoryHandle, OPFSFileHandle, OPFSWritableStream, StorageEstimate, OPFSFileWritableOptions, OPFSEvent, OPFSEventKind, OPFSEventHandler };
