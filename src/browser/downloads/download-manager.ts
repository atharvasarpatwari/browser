import type { ISharedService } from '../../app/app-shell';
type DownloadState = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';

interface DownloadItem {
  readonly id: string;
  url: string;
  filename: string;
  path: string;
  mimeType: string;
  totalBytes: number;
  receivedBytes: number;
  state: DownloadState;
  error: string | null;
  readonly createdAt: number;
  completedAt: number | null;
  readonly sourceUrl: string;
  readonly referrer: string | null;
}

type DownloadEventType =
  | 'downloadCreated' | 'downloadProgress' | 'downloadCompleted'
  | 'downloadFailed' | 'downloadCancelled' | 'downloadPaused';

interface DownloadCreatedEvent {
  readonly kind: 'downloadCreated';
  readonly item: DownloadItem;
}

interface DownloadProgressEvent {
  readonly kind: 'downloadProgress';
  readonly id: string;
  readonly receivedBytes: number;
  readonly totalBytes: number;
  readonly percent: number;
}

interface DownloadCompletedEvent {
  readonly kind: 'downloadCompleted';
  readonly id: string;
  readonly path: string;
}

interface DownloadFailedEvent {
  readonly kind: 'downloadFailed';
  readonly id: string;
  readonly error: string;
}

interface DownloadCancelledEvent {
  readonly kind: 'downloadCancelled';
  readonly id: string;
}

interface DownloadPausedEvent {
  readonly kind: 'downloadPaused';
  readonly id: string;
}

type DownloadEvent =
  | DownloadCreatedEvent
  | DownloadProgressEvent
  | DownloadCompletedEvent
  | DownloadFailedEvent
  | DownloadCancelledEvent
  | DownloadPausedEvent;

interface IDownloadManager extends ISharedService {
  readonly items: readonly DownloadItem[];
  readonly activeCount: number;
  download(url: string, options?: DownloadOptions): Promise<DownloadItem>;
  pause(id: string): Promise<boolean>;
  resume(id: string): Promise<boolean>;
  cancel(id: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  getItem(id: string): DownloadItem | null;
  clearCompleted(): Promise<number>;
  on(type: DownloadEventType, handler: (event: DownloadEvent) => void): void;
  off(type: DownloadEventType, handler: (event: DownloadEvent) => void): void;
}

interface DownloadOptions {
  filename?: string;
  path?: string;
  referrer?: string;
}

let _downloadSeq = 0;
function nextDownloadId(): string {
  return `dl-${Date.now()}-${(++_downloadSeq).toString(36)}`;
}

type DownloadEventHandler = (event: DownloadEvent) => void;

class DownloadManagerEventBus {
  private readonly channels = new Map<DownloadEventType, Set<DownloadEventHandler>>();

  on(type: DownloadEventType, handler: DownloadEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: DownloadEventType, handler: DownloadEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: DownloadEvent): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[DownloadManager] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

function suggestedFilename(url: string, mimeType: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length > 0) {
      const last = segments[segments.length - 1]!;
      if (last.includes('.')) return last;
    }
  } catch { /* extension not available */ }
  const ext = mimeType.split('/')[1] ?? 'bin';
  return `download.${ext}`;
}

class DownloadManager implements IDownloadManager {
  readonly name = 'DownloadManager';

  private readonly _items = new Map<string, DownloadItem>();
  private readonly bus = new DownloadManagerEventBus();
  private _initialized = false;

  get items(): readonly DownloadItem[] {
    return [...this._items.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  get activeCount(): number {
    return [...this._items.values()].filter(
      i => i.state === 'queued' || i.state === 'downloading',
    ).length;
  }

  async initialize(): Promise<void> {
    this._initialized = true;
  }

  async shutdown(): Promise<void> {
    for (const item of this._items.values()) {
      if (item.state === 'downloading' || item.state === 'queued') {
        (item as { state: DownloadState }).state = 'cancelled';
      }
    }
    this.bus.dispose();
    this._initialized = false;
  }

  async download(url: string, options?: DownloadOptions): Promise<DownloadItem> {
    const id = nextDownloadId();
    const filename = options?.filename ?? suggestedFilename(url, 'application/octet-stream');
    const path = options?.path ?? `./downloads/${filename}`;

    const item: DownloadItem = {
      id,
      url,
      filename,
      path,
      mimeType: 'application/octet-stream',
      totalBytes: 0,
      receivedBytes: 0,
      state: 'queued',
      error: null,
      createdAt: Date.now(),
      completedAt: null,
      sourceUrl: url,
      referrer: options?.referrer ?? null,
    };

    this._items.set(id, item);
    this.bus.emit({ kind: 'downloadCreated', item });

    this.startDownload(id).catch(() => {});
    return item;
  }

  private async startDownload(id: string): Promise<void> {
    const item = this._items.get(id);
    if (!item) return;

    (item as { state: DownloadState }).state = 'downloading';

    try {
      const response = await fetch(item.url);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Response body is not readable');

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) : 0;
      (item as { totalBytes: number }).totalBytes = total;

      const chunks: Uint8Array[] = [];
      let received = 0;

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        received += value.length;
        (item as { receivedBytes: number }).receivedBytes = received;

        const percent = total > 0 ? (received / total) * 100 : 0;
        this.bus.emit({ kind: 'downloadProgress', id, receivedBytes: received, totalBytes: total, percent });
      }

      (item as { state: DownloadState }).state = 'completed';
      (item as { completedAt: number | null }).completedAt = Date.now();
      this.bus.emit({ kind: 'downloadCompleted', id, path: item.path });
    } catch (err) {
      if (item.state === 'cancelled') {
        this.bus.emit({ kind: 'downloadCancelled', id });
        return;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      (item as { state: DownloadState }).state = 'failed';
      (item as { error: string | null }).error = errorMessage;
      this.bus.emit({ kind: 'downloadFailed', id, error: errorMessage });
    }
  }

  async pause(id: string): Promise<boolean> {
    const item = this._items.get(id);
    if (!item || item.state !== 'downloading') return false;
    (item as { state: DownloadState }).state = 'paused';
    this.bus.emit({ kind: 'downloadPaused', id });
    return true;
  }

  async resume(id: string): Promise<boolean> {
    const item = this._items.get(id);
    if (!item || item.state !== 'paused') return false;
    this.startDownload(id).catch(() => {});
    return true;
  }

  async cancel(id: string): Promise<boolean> {
    const item = this._items.get(id);
    if (!item) return false;
    if (item.state === 'completed') return false;
    (item as { state: DownloadState }).state = 'cancelled';
    this.bus.emit({ kind: 'downloadCancelled', id });
    return true;
  }

  async remove(id: string): Promise<boolean> {
    return this._items.delete(id);
  }

  getItem(id: string): DownloadItem | null {
    return this._items.get(id) ?? null;
  }

  async clearCompleted(): Promise<number> {
    let count = 0;
    for (const [id, item] of this._items) {
      if (item.state === 'completed' || item.state === 'failed' || item.state === 'cancelled') {
        this._items.delete(id);
        count++;
      }
    }
    return count;
  }

  on(type: DownloadEventType, handler: DownloadEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: DownloadEventType, handler: DownloadEventHandler): void {
    this.bus.off(type, handler);
  }
}

export { DownloadManager, DownloadManagerEventBus, suggestedFilename };
export type { IDownloadManager, DownloadItem, DownloadState, DownloadEvent, DownloadEventType, DownloadOptions };
