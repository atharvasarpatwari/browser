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
  /** Download speed in bytes/sec (rolling average) */
  speedBytesPerSec: number;
  /** Estimated seconds remaining */
  etaSeconds: number;
  /** Whether this download supports resume (server sends Accept-Ranges) */
  supportsResume: boolean;
  /** MIME type category: 'video', 'audio', 'image', 'document', 'archive', 'executable', 'other' */
  fileTypeCategory: string;
}

type DownloadEventType =
  | 'downloadCreated' | 'downloadProgress' | 'downloadCompleted'
  | 'downloadFailed' | 'downloadCancelled' | 'downloadPaused'
  | 'downloadResumed' | 'downloadRemoved' | 'batchCompleted';

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
  readonly speedBytesPerSec: number;
  readonly etaSeconds: number;
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

interface DownloadResumedEvent {
  readonly kind: 'downloadResumed';
  readonly id: string;
}

interface DownloadRemovedEvent {
  readonly kind: 'downloadRemoved';
  readonly id: string;
}

interface BatchCompletedEvent {
  readonly kind: 'batchCompleted';
  readonly count: number;
}

type DownloadEvent =
  | DownloadCreatedEvent
  | DownloadProgressEvent
  | DownloadCompletedEvent
  | DownloadFailedEvent
  | DownloadCancelledEvent
  | DownloadPausedEvent
  | DownloadResumedEvent
  | DownloadRemovedEvent
  | BatchCompletedEvent;

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
  /** Pause all active downloads */
  pauseAll(): Promise<number>;
  /** Resume all paused downloads */
  resumeAll(): Promise<number>;
  /** Cancel all active/paused downloads */
  cancelAll(): Promise<number>;
  /** Get download speed (bytes/sec) */
  getSpeed(id: string): number;
  /** Get ETA in seconds */
  getEta(id: string): number;
  /** Get total download speed across all active */
  getTotalSpeed(): number;
  /** Get duplicate check: has this URL already been queued? */
  hasUrl(url: string): boolean;
  /** Get items by state */
  getItemsByState(state: DownloadState): readonly DownloadItem[];
  /** Get items by file type category */
  getItemsByCategory(category: string): readonly DownloadItem[];
  /** Get download summary stats */
  getStats(): DownloadStats;
}

interface DownloadOptions {
  filename?: string;
  path?: string;
  referrer?: string;
  /** Whether to skip duplicate URL check */
  allowDuplicate?: boolean;
  /** Request headers */
  headers?: Record<string, string>;
}

interface DownloadStats {
  total: number;
  active: number;
  paused: number;
  completed: number;
  failed: number;
  cancelled: number;
  totalBytesReceived: number;
  totalBytesExpected: number;
  overallSpeedBytesPerSec: number;
  averageEtaSeconds: number;
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

function categorizeMime(mimeType: string): string {
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.includes('pdf') || mimeType.includes('document') || mimeType.includes('text/')) return 'document';
  if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('gzip') || mimeType.includes('rar') || mimeType.includes('7z')) return 'archive';
  if (mimeType.includes('executable') || mimeType.includes('x-msdownload') || mimeType.includes('appimage')) return 'executable';
  return 'other';
}

class SpeedTracker {
  private samples: { bytes: number; time: number }[] = [];
  private lastBytes = 0;
  private lastTime = 0;

  addSample(bytes: number, time: number): void {
    this.samples.push({ bytes, time });
    if (this.samples.length > 10) this.samples.shift();
  }

  reset(): void {
    this.samples = [];
    this.lastBytes = 0;
    this.lastTime = 0;
  }

  getSpeed(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0]!;
    const last = this.samples[this.samples.length - 1]!;
    const dt = (last.time - first.time) / 1000;
    if (dt <= 0) return 0;
    const db = last.bytes - first.bytes;
    return db / dt;
  }

  getEta(receivedBytes: number, totalBytes: number): number {
    const speed = this.getSpeed();
    if (speed <= 0 || totalBytes <= 0) return 0;
    const remaining = totalBytes - receivedBytes;
    return remaining / speed;
  }
}

class DownloadManager implements IDownloadManager {
  readonly name = 'DownloadManager';

  private readonly _items = new Map<string, DownloadItem>();
  private readonly bus = new DownloadManagerEventBus();
  private readonly speedTrackers = new Map<string, SpeedTracker>();
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
    this.speedTrackers.clear();
    this._initialized = false;
  }

  async download(url: string, options?: DownloadOptions): Promise<DownloadItem> {
    // Duplicate detection
    if (!options?.allowDuplicate) {
      for (const item of this._items.values()) {
        if (item.url === url && (item.state === 'queued' || item.state === 'downloading' || item.state === 'paused')) {
          return item;
        }
      }
    }

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
      speedBytesPerSec: 0,
      etaSeconds: 0,
      supportsResume: false,
      fileTypeCategory: 'other',
    };

    this._items.set(id, item);
    this.speedTrackers.set(id, new SpeedTracker());
    this.bus.emit({ kind: 'downloadCreated', item });

    this.startDownload(id, options?.headers).catch(() => {});
    return item;
  }

  private async startDownload(id: string, headers?: Record<string, string>): Promise<void> {
    const item = this._items.get(id);
    if (!item) return;

    (item as { state: DownloadState }).state = 'downloading';
    const tracker = this.speedTrackers.get(id);

    try {
      const fetchHeaders: Record<string, string> = { ...headers };
      // Add Range header for resume
      if (item.receivedBytes > 0 && item.supportsResume) {
        fetchHeaders['Range'] = `bytes=${item.receivedBytes}-`;
      }

      const response = await fetch(item.url, { headers: fetchHeaders });

      // Detect resume support
      const acceptRanges = response.headers.get('accept-ranges');
      const contentRange = response.headers.get('content-range');
      if (acceptRanges === 'bytes' || contentRange) {
        (item as { supportsResume: boolean }).supportsResume = true;
      }

      // Detect MIME type from Content-Type
      const ct = response.headers.get('content-type');
      if (ct) {
        (item as { mimeType: string }).mimeType = ct.split(';')[0]?.trim() ?? ct;
        (item as { fileTypeCategory: string }).fileTypeCategory = categorizeMime(ct);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('Response body is not readable');

      const contentLength = response.headers.get('content-length');
      const total = contentLength ? parseInt(contentLength, 10) + item.receivedBytes : 0;
      (item as { totalBytes: number }).totalBytes = total;

      const chunks: Uint8Array[] = [];
      let received = item.receivedBytes;
      const startTime = Date.now();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (item.state === 'cancelled' || item.state === 'paused') break;

        chunks.push(value);
        received += value.length;
        (item as { receivedBytes: number }).receivedBytes = received;

        // Speed tracking
        if (tracker) {
          tracker.addSample(received, Date.now());
          const speed = tracker.getSpeed();
          const eta = tracker.getEta(received, total);
          (item as { speedBytesPerSec: number }).speedBytesPerSec = speed;
          (item as { etaSeconds: number }).etaSeconds = eta;
        }

        const percent = total > 0 ? (received / total) * 100 : 0;
        this.bus.emit({
          kind: 'downloadProgress',
          id,
          receivedBytes: received,
          totalBytes: total,
          percent,
          speedBytesPerSec: item.speedBytesPerSec,
          etaSeconds: item.etaSeconds,
        });
      }

      if (item.state === 'paused') {
        this.bus.emit({ kind: 'downloadPaused', id });
        return;
      }

      (item as { state: DownloadState }).state = 'completed';
      (item as { completedAt: number | null }).completedAt = Date.now();
      if (tracker) tracker.reset();
      this.bus.emit({ kind: 'downloadCompleted', id, path: item.path });
    } catch (err) {
      if (item.state === 'cancelled') {
        this.bus.emit({ kind: 'downloadCancelled', id });
        return;
      }
      if (item.state === 'paused') {
        this.bus.emit({ kind: 'downloadPaused', id });
        return;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      (item as { state: DownloadState }).state = 'failed';
      (item as { error: string | null }).error = errorMessage;
      if (tracker) tracker.reset();
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
    (item as { state: DownloadState }).state = 'queued';
    (item as { error: string | null }).error = null;
    this.bus.emit({ kind: 'downloadResumed', id });
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
    const deleted = this._items.delete(id);
    if (deleted) {
      this.speedTrackers.delete(id);
      this.bus.emit({ kind: 'downloadRemoved', id });
    }
    return deleted;
  }

  getItem(id: string): DownloadItem | null {
    return this._items.get(id) ?? null;
  }

  async clearCompleted(): Promise<number> {
    let count = 0;
    for (const [id, item] of this._items) {
      if (item.state === 'completed' || item.state === 'failed' || item.state === 'cancelled') {
        this._items.delete(id);
        this.speedTrackers.delete(id);
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

  // ── Enhanced methods ──

  async pauseAll(): Promise<number> {
    let count = 0;
    for (const item of this._items.values()) {
      if (item.state === 'downloading' || item.state === 'queued') {
        (item as { state: DownloadState }).state = 'paused';
        this.bus.emit({ kind: 'downloadPaused', id: item.id });
        count++;
      }
    }
    return count;
  }

  async resumeAll(): Promise<number> {
    let count = 0;
    for (const item of this._items.values()) {
      if (item.state === 'paused') {
        (item as { state: DownloadState }).state = 'queued';
        this.bus.emit({ kind: 'downloadResumed', id: item.id });
        this.startDownload(item.id).catch(() => {});
        count++;
      }
    }
    return count;
  }

  async cancelAll(): Promise<number> {
    let count = 0;
    for (const item of this._items.values()) {
      if (item.state !== 'completed' && item.state !== 'cancelled') {
        (item as { state: DownloadState }).state = 'cancelled';
        this.bus.emit({ kind: 'downloadCancelled', id: item.id });
        count++;
      }
    }
    return count;
  }

  getSpeed(id: string): number {
    return this._items.get(id)?.speedBytesPerSec ?? 0;
  }

  getEta(id: string): number {
    return this._items.get(id)?.etaSeconds ?? 0;
  }

  getTotalSpeed(): number {
    let total = 0;
    for (const item of this._items.values()) {
      if (item.state === 'downloading') {
        total += item.speedBytesPerSec;
      }
    }
    return total;
  }

  hasUrl(url: string): boolean {
    for (const item of this._items.values()) {
      if (item.url === url && (item.state === 'queued' || item.state === 'downloading' || item.state === 'paused')) {
        return true;
      }
    }
    return false;
  }

  getItemsByState(state: DownloadState): readonly DownloadItem[] {
    return [...this._items.values()].filter(i => i.state === state);
  }

  getItemsByCategory(category: string): readonly DownloadItem[] {
    return [...this._items.values()].filter(i => i.fileTypeCategory === category);
  }

  getStats(): DownloadStats {
    const all = [...this._items.values()];
    return {
      total: all.length,
      active: all.filter(i => i.state === 'downloading' || i.state === 'queued').length,
      paused: all.filter(i => i.state === 'paused').length,
      completed: all.filter(i => i.state === 'completed').length,
      failed: all.filter(i => i.state === 'failed').length,
      cancelled: all.filter(i => i.state === 'cancelled').length,
      totalBytesReceived: all.reduce((s, i) => s + i.receivedBytes, 0),
      totalBytesExpected: all.reduce((s, i) => s + i.totalBytes, 0),
      overallSpeedBytesPerSec: this.getTotalSpeed(),
      averageEtaSeconds: all.filter(i => i.state === 'downloading' && i.etaSeconds > 0)
        .reduce((s, i, _, arr) => s + i.etaSeconds / arr.length, 0),
    };
  }
}

export { DownloadManager, DownloadManagerEventBus, suggestedFilename, categorizeMime, SpeedTracker };
export type { IDownloadManager, DownloadItem, DownloadState, DownloadEvent, DownloadEventType, DownloadOptions, DownloadStats };
