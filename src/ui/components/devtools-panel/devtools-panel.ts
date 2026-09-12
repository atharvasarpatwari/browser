import type { IDisposable } from '../../../app/dependency-container';

export type DevToolsConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface DevToolsConsoleEntry {
  readonly level: DevToolsConsoleLevel;
  readonly text: string;
  readonly timestamp: number;
}

const LEVEL_COLOR: Record<DevToolsConsoleLevel, string> = {
  log: '#e8eaed',
  info: '#8ab4f8',
  warn: '#fdd663',
  error: '#f28b82',
  debug: '#9aa0a6',
};

const MAX_ROWS = 1000;

/**
 * Renders live page console output into a container. Visibility is owned by
 * whatever the container is (e.g. DesktopLayout's `devtools` area, shown/hidden
 * via `toggleDevtools()`) — this component only ever manages its own content.
 */
interface IDevToolsPanel extends IDisposable {
  attach(container: HTMLElement): void;
  addEntry(entry: DevToolsConsoleEntry): void;
  clear(): void;
}

class DevToolsPanel implements IDevToolsPanel {
  private container: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private rowCount = 0;

  attach(container: HTMLElement): void {
    this.container = container;
    this.build();
  }

  private build(): void {
    if (!this.container) return;
    this.container.style.cssText += 'flex-direction:column; background:#202124; color:#e8eaed; font-family:\'Consolas\',\'Menlo\',monospace; font-size:12px; overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText = `
      display:flex; align-items:center; gap:8px; padding:6px 10px;
      background:#292a2d; border-bottom:1px solid #3c4043; flex:none;
    `.trim();

    const title = document.createElement('span');
    title.textContent = 'Console';
    title.style.cssText = 'font-weight:600; color:#9aa0a6; flex:1;';

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.style.cssText = 'background:#3c4043; color:#e8eaed; border:none; border-radius:3px; padding:3px 10px; font-size:11px; cursor:pointer;';
    clearBtn.addEventListener('click', () => this.clear());

    header.append(title, clearBtn);

    const list = document.createElement('div');
    list.style.cssText = 'flex:1; overflow-y:auto; padding:4px 0;';

    this.container.append(header, list);
    this.listEl = list;
  }

  addEntry(entry: DevToolsConsoleEntry): void {
    if (!this.listEl) return;

    const row = document.createElement('div');
    row.style.cssText = `
      display:flex; gap:8px; padding:2px 10px; white-space:pre-wrap;
      word-break:break-word; border-bottom:1px solid #292a2d;
      color:${LEVEL_COLOR[entry.level]};
    `.trim();

    const time = document.createElement('span');
    time.textContent = new Date(entry.timestamp).toLocaleTimeString();
    time.style.cssText = 'color:#5f6368; flex:none;';

    const badge = document.createElement('span');
    badge.textContent = entry.level.toUpperCase();
    badge.style.cssText = 'flex:none; width:44px; font-weight:600;';

    const text = document.createElement('span');
    text.textContent = entry.text;
    text.style.cssText = 'flex:1;';

    row.append(time, badge, text);
    this.listEl.appendChild(row);

    this.rowCount++;
    if (this.rowCount > MAX_ROWS) {
      this.listEl.firstChild?.remove();
      this.rowCount--;
    }

    this.listEl.scrollTop = this.listEl.scrollHeight;
  }

  clear(): void {
    if (this.listEl) this.listEl.innerHTML = '';
    this.rowCount = 0;
  }

  dispose(): void {
    if (this.container) this.container.innerHTML = '';
    this.container = null;
    this.listEl = null;
  }
}

export { DevToolsPanel, type IDevToolsPanel };
