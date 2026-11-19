import type { IDisposable } from '../../app/dependency-container';

interface DownloadInfo {
  readonly id: string;
  url: string;
  filename: string;
  mimeType: string;
  totalBytes: number;
  receivedBytes: number;
  state: 'queued' | 'downloading' | 'paused' | 'completed' | 'failed' | 'cancelled';
  error: string | null;
  readonly createdAt: number;
  completedAt: number | null;
  speedBytesPerSec: number;
  etaSeconds: number;
  fileTypeCategory: string;
}

interface IDownloadsService extends IDisposable {
  getAll(): DownloadInfo[];
  getActive(): DownloadInfo[];
  getCompleted(): DownloadInfo[];
  getFailed(): DownloadInfo[];
  getById(id: string): DownloadInfo | null;
  pause(id: string): boolean;
  resume(id: string): boolean;
  cancel(id: string): boolean;
  remove(id: string): boolean;
  clearCompleted(): void;
  pauseAll(): void;
  resumeAll(): void;
  get totalCount(): number;
  get activeCount(): number;
  onEvent(handler: DownloadsEventHandler): () => void;
}

type DownloadsEventKind = 'created' | 'progress' | 'completed' | 'failed' | 'cancelled' | 'paused' | 'resumed' | 'removed';
interface DownloadsEvent {
  readonly kind: DownloadsEventKind;
  readonly item: DownloadInfo;
}

type DownloadsEventHandler = (event: DownloadsEvent) => void;

interface DownloadItemLike {
  readonly id: string;
  url: string;
  filename: string;
  mimeType: string;
  totalBytes: number;
  receivedBytes: number;
  state: string;
  error: string | null;
  readonly createdAt: number;
  completedAt: number | null;
  speedBytesPerSec: number;
  etaSeconds: number;
  fileTypeCategory: string;
}

interface DownloadManagerLike {
  getItems(): DownloadItemLike[];
  getItem(id: string): DownloadItemLike | null;
  pause(id: string): boolean;
  resume(id: string): boolean;
  cancel(id: string): boolean;
  remove(id: string): boolean;
  clearCompleted(): void;
  pauseAll(): void;
  resumeAll(): void;
  on(type: string, handler: (...args: unknown[]) => void): void;
  off(type: string, handler: (...args: unknown[]) => void): void;
}

class DownloadsService implements IDownloadsService {
  private manager: DownloadManagerLike;
  private handlers = new Set<DownloadsEventHandler>();
  private boundHandlers: Array<() => void> = [];

  constructor(manager: DownloadManagerLike) {
    this.manager = manager;
    this.wireEvents();
  }

  get totalCount(): number { return this.manager.getItems().length; }
  get activeCount(): number { return this.manager.getItems().filter(i => i.state === 'downloading' || i.state === 'paused').length; }

  getAll(): DownloadInfo[] { return this.manager.getItems().map(i => this.toInfo(i)); }
  getActive(): DownloadInfo[] { return this.manager.getItems().filter(i => i.state === 'downloading' || i.state === 'paused').map(i => this.toInfo(i)); }
  getCompleted(): DownloadInfo[] { return this.manager.getItems().filter(i => i.state === 'completed').map(i => this.toInfo(i)); }
  getFailed(): DownloadInfo[] { return this.manager.getItems().filter(i => i.state === 'failed' || i.state === 'cancelled').map(i => this.toInfo(i)); }
  getById(id: string): DownloadInfo | null { const i = this.manager.getItem(id); return i ? this.toInfo(i) : null; }
  pause(id: string): boolean { return this.manager.pause(id); }
  resume(id: string): boolean { return this.manager.resume(id); }
  cancel(id: string): boolean { return this.manager.cancel(id); }
  remove(id: string): boolean { return this.manager.remove(id); }
  clearCompleted(): void { this.manager.clearCompleted(); }
  pauseAll(): void { this.manager.pauseAll(); }
  resumeAll(): void { this.manager.resumeAll(); }

  private toInfo(item: DownloadItemLike): DownloadInfo {
    return {
      id: item.id, url: item.url, filename: item.filename, mimeType: item.mimeType,
      totalBytes: item.totalBytes, receivedBytes: item.receivedBytes,
      state: item.state as DownloadInfo['state'], error: item.error,
      createdAt: item.createdAt, completedAt: item.completedAt,
      speedBytesPerSec: item.speedBytesPerSec, etaSeconds: item.etaSeconds,
      fileTypeCategory: item.fileTypeCategory,
    };
  }

  private wireEvents(): void {
    const mapKind: Record<string, DownloadsEventKind> = {
      downloadCreated: 'created', downloadProgress: 'progress', downloadCompleted: 'completed',
      downloadFailed: 'failed', downloadCancelled: 'cancelled', downloadPaused: 'paused',
      downloadResumed: 'resumed', downloadRemoved: 'removed',
    };
    for (const [type, kind] of Object.entries(mapKind)) {
      const handler = (e: unknown) => {
        const ev = e as { id?: string; item?: DownloadItemLike };
        const itemId = ev?.id ?? ev?.item?.id;
        if (itemId) {
          const item = this.manager.getItem(itemId);
          if (item) this.emit({ kind, item: this.toInfo(item) });
        }
      };
      this.manager.on(type, handler);
      this.boundHandlers.push(() => this.manager.off(type, handler));
    }
  }

  onEvent(handler: DownloadsEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: DownloadsEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    for (const unbind of this.boundHandlers) unbind();
    this.boundHandlers.length = 0;
    this.handlers.clear();
  }
}

export { DownloadsService };
export type { IDownloadsService, DownloadInfo, DownloadsEvent, DownloadsEventKind, DownloadsEventHandler, DownloadManagerLike, DownloadItemLike };
