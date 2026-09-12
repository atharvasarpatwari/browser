import type { IDisposable } from '../../../app/dependency-container';
import type { IDomTree, DomNode, DomElement, DomTextNode } from '../../../browser/rendering/dom-tree';

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

export interface DevToolsNetworkEntry {
  readonly url: string;
  readonly kind: string;
  readonly statusCode: number;
  readonly durationMs: number;
  readonly fromCache: boolean;
  readonly error: string | null;
}

const MAX_ROWS = 1000;
const MAX_TREE_NODES = 2000;
const MAX_NETWORK_ROWS = 500;

type DevToolsTab = 'console' | 'elements' | 'network';

/**
 * Renders live page console output, a snapshot of the live DOM tree, and a
 * log of resource loads into a container. Visibility is owned by whatever
 * the container is (e.g. DesktopLayout's `devtools` area, shown/hidden via
 * `toggleDevtools()`) — this component only ever manages its own content.
 */
interface IDevToolsPanel extends IDisposable {
  attach(container: HTMLElement): void;
  addEntry(entry: DevToolsConsoleEntry): void;
  addNetworkEntry(entry: DevToolsNetworkEntry): void;
  clear(): void;
  /** Provide a way to fetch the live DOM tree on demand for the Elements tab. */
  setDomTreeProvider(provider: () => IDomTree | null): void;
}

class DevToolsPanel implements IDevToolsPanel {
  private container: HTMLElement | null = null;
  private consolePane: HTMLElement | null = null;
  private elementsPane: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private rowCount = 0;
  private networkPane: HTMLElement | null = null;
  private networkRowCount = 0;
  private activeTab: DevToolsTab = 'console';
  private consoleTabBtn: HTMLButtonElement | null = null;
  private elementsTabBtn: HTMLButtonElement | null = null;
  private networkTabBtn: HTMLButtonElement | null = null;
  private domTreeProvider: (() => IDomTree | null) | null = null;

  attach(container: HTMLElement): void {
    this.container = container;
    this.build();
  }

  setDomTreeProvider(provider: () => IDomTree | null): void {
    this.domTreeProvider = provider;
  }

  private build(): void {
    if (!this.container) return;
    this.container.style.cssText += 'flex-direction:column; background:#202124; color:#e8eaed; font-family:\'Consolas\',\'Menlo\',monospace; font-size:12px; overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText = `
      display:flex; align-items:center; gap:4px; padding:6px 10px;
      background:#292a2d; border-bottom:1px solid #3c4043; flex:none;
    `.trim();

    this.consoleTabBtn = DevToolsPanel.tabButton('Console');
    this.elementsTabBtn = DevToolsPanel.tabButton('Elements');
    this.networkTabBtn = DevToolsPanel.tabButton('Network');
    this.consoleTabBtn.addEventListener('click', () => this.selectTab('console'));
    this.elementsTabBtn.addEventListener('click', () => this.selectTab('elements'));
    this.networkTabBtn.addEventListener('click', () => this.selectTab('network'));

    const spacer = document.createElement('span');
    spacer.style.flex = '1';

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Clear';
    clearBtn.style.cssText = DevToolsPanel.actionButtonStyle();
    clearBtn.addEventListener('click', () => this.clear());

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh';
    refreshBtn.style.cssText = DevToolsPanel.actionButtonStyle();
    refreshBtn.addEventListener('click', () => this.renderElementsTree());

    header.append(this.consoleTabBtn, this.elementsTabBtn, this.networkTabBtn, spacer, refreshBtn, clearBtn);

    this.consolePane = document.createElement('div');
    this.consolePane.style.cssText = 'flex:1; overflow-y:auto; padding:4px 0;';
    this.listEl = this.consolePane;

    this.elementsPane = document.createElement('div');
    this.elementsPane.style.cssText = 'flex:1; overflow:auto; padding:6px 10px; display:none; white-space:pre;';

    this.networkPane = document.createElement('div');
    this.networkPane.style.cssText = 'flex:1; overflow-y:auto; padding:4px 0; display:none;';

    this.container.append(header, this.consolePane, this.elementsPane, this.networkPane);
    this.updateTabStyles();
  }

  private static tabButton(label: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = 'background:transparent; color:#9aa0a6; border:none; padding:4px 10px; font-size:12px; font-weight:600; cursor:pointer; border-bottom:2px solid transparent;';
    return btn;
  }

  private static actionButtonStyle(): string {
    return 'background:#3c4043; color:#e8eaed; border:none; border-radius:3px; padding:3px 10px; font-size:11px; cursor:pointer;';
  }

  private selectTab(tab: DevToolsTab): void {
    this.activeTab = tab;
    this.updateTabStyles();
    if (tab === 'elements') this.renderElementsTree();
  }

  private updateTabStyles(): void {
    if (!this.consoleTabBtn || !this.elementsTabBtn || !this.networkTabBtn
      || !this.consolePane || !this.elementsPane || !this.networkPane) return;
    const active = 'color:#8ab4f8; border-bottom-color:#8ab4f8;';
    const inactive = 'color:#9aa0a6; border-bottom-color:transparent;';
    this.consoleTabBtn.style.cssText = DevToolsPanel.tabButtonBase() + (this.activeTab === 'console' ? active : inactive);
    this.elementsTabBtn.style.cssText = DevToolsPanel.tabButtonBase() + (this.activeTab === 'elements' ? active : inactive);
    this.networkTabBtn.style.cssText = DevToolsPanel.tabButtonBase() + (this.activeTab === 'network' ? active : inactive);
    this.consolePane.style.display = this.activeTab === 'console' ? 'block' : 'none';
    this.elementsPane.style.display = this.activeTab === 'elements' ? 'block' : 'none';
    this.networkPane.style.display = this.activeTab === 'network' ? 'block' : 'none';
  }

  private static tabButtonBase(): string {
    return 'background:transparent; border:none; padding:4px 10px; font-size:12px; font-weight:600; cursor:pointer; border-bottom:2px solid transparent;';
  }

  private renderElementsTree(): void {
    if (!this.elementsPane) return;
    const domTree = this.domTreeProvider?.() ?? null;
    const doc = domTree?.getDocument() ?? null;
    if (!doc) {
      this.elementsPane.textContent = '(no page loaded)';
      return;
    }
    this.elementsPane.innerHTML = '';
    const budget = { remaining: MAX_TREE_NODES };
    for (const child of doc.children) {
      this.renderNode(child, 0, this.elementsPane, budget);
    }
    if (budget.remaining <= 0) {
      const truncated = document.createElement('div');
      truncated.textContent = `… truncated at ${MAX_TREE_NODES} nodes`;
      truncated.style.color = '#5f6368';
      this.elementsPane.appendChild(truncated);
    }
  }

  private renderNode(node: DomNode, depth: number, out: HTMLElement, budget: { remaining: number }): void {
    if (budget.remaining <= 0) return;

    if (node.nodeType === 'text') {
      const text = (node as DomTextNode).text.trim();
      if (text) {
        budget.remaining--;
        const row = document.createElement('div');
        row.textContent = `${'  '.repeat(depth)}${DevToolsPanel.truncate(text, 120)}`;
        row.style.color = '#9aa0a6';
        out.appendChild(row);
      }
      return;
    }

    if (node.nodeType !== 'element') return;
    const el = node as DomElement;
    budget.remaining--;

    const row = document.createElement('div');
    const attrs = Array.from(el.attributes.entries()).filter(([k]) => k !== '').map(([k, v]) => ` ${k}="${v}"`).join('');
    row.textContent = `${'  '.repeat(depth)}<${el.tagName}${attrs}>`;
    row.style.color = '#8ab4f8';
    out.appendChild(row);

    for (const child of el.children) {
      this.renderNode(child, depth + 1, out, budget);
      if (budget.remaining <= 0) return;
    }
  }

  private static truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}…` : text;
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

  addNetworkEntry(entry: DevToolsNetworkEntry): void {
    if (!this.networkPane) return;

    const isError = entry.error !== null || entry.statusCode >= 400 || entry.statusCode === 0;
    const row = document.createElement('div');
    row.style.cssText = `
      display:flex; gap:8px; padding:2px 10px; white-space:nowrap;
      overflow:hidden; border-bottom:1px solid #292a2d;
      color:${isError ? LEVEL_COLOR.error : '#e8eaed'};
    `.trim();

    const status = document.createElement('span');
    status.textContent = entry.error ? 'ERR' : String(entry.statusCode);
    status.style.cssText = 'flex:none; width:36px; font-weight:600;';

    const kind = document.createElement('span');
    kind.textContent = entry.kind;
    kind.style.cssText = 'flex:none; width:70px; color:#9aa0a6;';

    const url = document.createElement('span');
    url.textContent = entry.error ? `${entry.url} — ${entry.error}` : entry.url;
    url.style.cssText = 'flex:1; overflow:hidden; text-overflow:ellipsis;';
    url.title = url.textContent;

    const duration = document.createElement('span');
    duration.textContent = entry.fromCache ? '(cache)' : `${entry.durationMs}ms`;
    duration.style.cssText = 'flex:none; color:#5f6368;';

    row.append(status, kind, url, duration);
    this.networkPane.appendChild(row);

    this.networkRowCount++;
    if (this.networkRowCount > MAX_NETWORK_ROWS) {
      this.networkPane.firstChild?.remove();
      this.networkRowCount--;
    }

    this.networkPane.scrollTop = this.networkPane.scrollHeight;
  }

  clear(): void {
    if (this.activeTab === 'console') {
      if (this.listEl) this.listEl.innerHTML = '';
      this.rowCount = 0;
    } else if (this.activeTab === 'network') {
      if (this.networkPane) this.networkPane.innerHTML = '';
      this.networkRowCount = 0;
    } else {
      this.renderElementsTree();
    }
  }

  dispose(): void {
    if (this.container) this.container.innerHTML = '';
    this.container = null;
    this.consolePane = null;
    this.elementsPane = null;
    this.networkPane = null;
    this.listEl = null;
    this.consoleTabBtn = null;
    this.elementsTabBtn = null;
    this.networkTabBtn = null;
  }
}

export { DevToolsPanel, type IDevToolsPanel };
