import type { IDisposable } from '../../app/dependency-container';
import type { DownloadItem, DownloadState } from '../../browser/downloads/download-manager';

interface DownloadsPageConfig {
  readonly maxDisplayItems: number;
  readonly showDateGroups: boolean;
}

const DEFAULT_DOWNLOADS_CONFIG: DownloadsPageConfig = {
  maxDisplayItems: 100,
  showDateGroups: true,
};

type DownloadsPageEventType = 'downloadAction';

interface DownloadsPageEvent {
  readonly kind: DownloadsPageEventType;
  readonly action?: 'pause' | 'resume' | 'cancel' | 'remove' | 'openFile' | 'showInFolder';
  readonly downloadId?: string;
}

interface IDownloadsPage extends IDisposable {
  readonly isMounted: boolean;
  mount(container: HTMLElement, items: readonly DownloadItem[]): void;
  unmount(): void;
  updateItems(items: readonly DownloadItem[]): void;
  on(type: DownloadsPageEventType, handler: (event: DownloadsPageEvent) => void): void;
  off(type: DownloadsPageEventType, handler: (event: DownloadsPageEvent) => void): void;
}

type DownloadsPageEventHandler = (event: DownloadsPageEvent) => void;

class DownloadsPage implements IDownloadsPage {
  private readonly config: DownloadsPageConfig;
  private readonly handlers: DownloadsPageEventHandler[] = [];
  private container: HTMLElement | null = null;
  private itemsContainer: HTMLElement | null = null;
  private _mounted = false;
  private currentItems: readonly DownloadItem[] = [];

  constructor(config?: Partial<DownloadsPageConfig>) {
    this.config = { ...DEFAULT_DOWNLOADS_CONFIG, ...config };
  }

  get isMounted(): boolean { return this._mounted; }

  mount(container: HTMLElement, items: readonly DownloadItem[]): void {
    this.container = container;
    this.currentItems = items;
    this.container.className = 'downloads-page';
    this.container.style.cssText = 'padding:24px;font-family:sans-serif;overflow-y:auto;height:100%;';
    this.build();
    this._mounted = true;
  }

  unmount(): void {
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this.itemsContainer = null;
    this._mounted = false;
  }

  updateItems(items: readonly DownloadItem[]): void {
    this.currentItems = items;
    this.renderItems();
  }

  on(type: DownloadsPageEventType, handler: DownloadsPageEventHandler): void {
    this.handlers.push(handler);
  }

  off(type: DownloadsPageEventType, handler: DownloadsPageEventHandler): void {
    const idx = this.handlers.indexOf(handler);
    if (idx !== -1) this.handlers.splice(idx, 1);
  }

  private emit(event: DownloadsPageEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch (err) {
        console.error(`[DownloadsPage] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  private build(): void {
    if (!this.container) return;

    this.container.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;';

    const title = document.createElement('h1');
    title.textContent = '📥 Downloads';
    title.style.cssText = 'margin:0;font-size:24px;';
    header.appendChild(title);

    if (this.currentItems.length > 0) {
      const clearBtn = document.createElement('button');
      clearBtn.textContent = 'Clear all';
      clearBtn.style.cssText = 'padding:6px 12px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;font-size:13px;';
      clearBtn.addEventListener('click', () => {
        for (const item of this.currentItems) {
          if (item.state === 'completed' || item.state === 'failed' || item.state === 'cancelled') {
            this.emit({ kind: 'downloadAction', action: 'remove', downloadId: item.id });
          }
        }
      });
      header.appendChild(clearBtn);
    }

    this.container.appendChild(header);

    if (this.currentItems.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align:center;padding:60px 20px;color:#999;';
      empty.innerHTML = '<div style="font-size:48px;margin-bottom:16px;">📥</div><p style="font-size:16px;">No downloads yet</p><p style="font-size:13px;">Downloads will appear here when you download files</p>';
      this.container.appendChild(empty);
      return;
    }

    this.itemsContainer = document.createElement('div');
    this.itemsContainer.className = 'downloads-list';
    this.container.appendChild(this.itemsContainer);

    this.renderItems();
  }

  private renderItems(): void {
    if (!this.itemsContainer) return;

    const displayItems = this.currentItems
      .slice(0, this.config.maxDisplayItems);

    this.itemsContainer.innerHTML = '';

    if (this.config.showDateGroups) {
      const groups = this.groupByDate(displayItems);
      for (const [dateLabel, items] of groups) {
        const groupHeader = document.createElement('div');
        groupHeader.style.cssText = 'font-weight:bold;font-size:13px;color:#666;padding:12px 0 6px;border-bottom:1px solid #eee;margin-top:8px;';
        groupHeader.textContent = dateLabel;
        this.itemsContainer.appendChild(groupHeader);

        for (const item of items) {
          this.itemsContainer.appendChild(this.createDownloadRow(item));
        }
      }
    } else {
      for (const item of displayItems) {
        this.itemsContainer.appendChild(this.createDownloadRow(item));
      }
    }
  }

  private createDownloadRow(item: DownloadItem): HTMLElement {
    const row = document.createElement('div');
    row.className = `download-item ${item.state}`;
    row.style.cssText = 'display:flex;align-items:center;padding:10px 8px;border-bottom:1px solid #f0f0f0;gap:12px;';

    const icon = document.createElement('div');
    icon.style.cssText = 'font-size:24px;width:32px;text-align:center;';
    icon.textContent = this.stateIcon(item.state);
    row.appendChild(icon);

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';

    const filename = document.createElement('div');
    filename.style.cssText = 'font-size:14px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    filename.textContent = item.filename;
    info.appendChild(filename);

    const meta = document.createElement('div');
    meta.style.cssText = 'font-size:11px;color:#888;margin-top:2px;';
    meta.textContent = this.formatMeta(item);
    info.appendChild(meta);

    if (item.state === 'downloading' && item.totalBytes > 0) {
      const progressBar = document.createElement('div');
      progressBar.style.cssText = 'height:4px;background:#e0e0e0;border-radius:2px;margin-top:4px;overflow:hidden;';

      const progress = document.createElement('div');
      const percent = item.totalBytes > 0 ? (item.receivedBytes / item.totalBytes) * 100 : 0;
      progress.style.cssText = `height:100%;width:${percent}%;background:#1a73e8;border-radius:2px;transition:width 0.3s;`;
      progressBar.appendChild(progress);
      info.appendChild(progressBar);
    }

    row.appendChild(info);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:4px;flex-shrink:0;';

    if (item.state === 'completed') {
      this.addActionBtn(actions, '📂', 'openFile', item.id, 'Open file');
      this.addActionBtn(actions, '📁', 'showInFolder', item.id, 'Show in folder');
    }
    if (item.state === 'downloading') {
      this.addActionBtn(actions, '⏸', 'pause', item.id, 'Pause');
    }
    if (item.state === 'paused') {
      this.addActionBtn(actions, '▶', 'resume', item.id, 'Resume');
    }
    if (item.state === 'queued' || item.state === 'downloading') {
      this.addActionBtn(actions, '✕', 'cancel', item.id, 'Cancel');
    }
    this.addActionBtn(actions, '🗑', 'remove', item.id, 'Remove');

    row.appendChild(actions);

    return row;
  }

  private addActionBtn(
    parent: HTMLElement,
    text: string,
    action: string,
    downloadId: string,
    title: string,
  ): void {
    const btn = document.createElement('button');
    btn.textContent = text;
    btn.title = title;
    btn.style.cssText = 'border:none;background:none;cursor:pointer;font-size:16px;padding:4px;opacity:0.6;';
    btn.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
    btn.addEventListener('mouseleave', () => { btn.style.opacity = '0.6'; });
    btn.addEventListener('click', () => {
      this.emit({
        kind: 'downloadAction',
        action: action as 'pause' | 'resume' | 'cancel' | 'remove' | 'openFile' | 'showInFolder',
        downloadId,
      });
    });
    parent.appendChild(btn);
  }

  private stateIcon(state: DownloadState): string {
    switch (state) {
      case 'queued': return '⏳';
      case 'downloading': return '⬇';
      case 'paused': return '⏸';
      case 'completed': return '✅';
      case 'failed': return '❌';
      case 'cancelled': return '🚫';
    }
  }

  private formatMeta(item: DownloadItem): string {
    const parts: string[] = [];
    if (item.totalBytes > 0) {
      parts.push(this.formatBytes(item.receivedBytes) + ' / ' + this.formatBytes(item.totalBytes));
    } else if (item.receivedBytes > 0) {
      parts.push(this.formatBytes(item.receivedBytes));
    }
    if (item.state === 'completed' && item.completedAt) {
      parts.push('Completed ' + new Date(item.completedAt).toLocaleString());
    }
    if (item.state === 'failed' && item.error) {
      parts.push(item.error);
    }
    return parts.join(' · ');
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  private groupByDate(items: readonly DownloadItem[]): Map<string, DownloadItem[]> {
    const groups = new Map<string, DownloadItem[]>();
    const now = new Date();
    const today = now.toDateString();
    const yesterday = new Date(now.getTime() - 86400000).toDateString();

    for (const item of items) {
      const date = new Date(item.createdAt).toDateString();
      let label: string;
      if (date === today) label = 'Today';
      else if (date === yesterday) label = 'Yesterday';
      else label = new Date(item.createdAt).toLocaleDateString();

      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(item);
    }

    const sorted = new Map<string, DownloadItem[]>();
    const order = ['Today', 'Yesterday'];
    for (const key of order) {
      if (groups.has(key)) {
        sorted.set(key, groups.get(key)!);
        groups.delete(key);
      }
    }
    for (const [key, value] of groups) {
      sorted.set(key, value);
    }

    return sorted;
  }

  dispose(): void {
    this.unmount();
    this.handlers.length = 0;
    this.currentItems = [];
  }
}

export { DownloadsPage, DEFAULT_DOWNLOADS_CONFIG };
export type { IDownloadsPage, DownloadsPageConfig, DownloadsPageEvent, DownloadsPageEventType };
