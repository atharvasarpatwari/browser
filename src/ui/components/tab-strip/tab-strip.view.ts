import type { IDisposable } from '../../../app/dependency-container';
import type { ITabStrip, TabStripState, TabStripEventUnion } from './tab-strip';

interface TabStripViewConfig {
  readonly containerId: string;
  readonly maxTabWidth: number;
  readonly showNewTabButton: boolean;
}

const DEFAULT_VIEW_CONFIG: TabStripViewConfig = {
  containerId: 'tab-bar',
  maxTabWidth: 170,
  showNewTabButton: true,
};

interface ITabStripView extends IDisposable {
  readonly element: HTMLElement | null;
  attach(container: HTMLElement): void;
  detach(): void;
  update(state: TabStripState): void;
  setEventHandler(handler: (event: TabStripEventUnion) => void): void;
}

class TabStripView implements ITabStripView {
  private readonly config: TabStripViewConfig;
  private readonly model: ITabStrip;
  private container: HTMLElement | null = null;
  private tabsContainer: HTMLElement | null = null;
  private newTabButton: HTMLElement | null = null;
  private eventHandler: ((event: TabStripEventUnion) => void) | null = null;
  private dragState: { tabId: string; startX: number; startIndex: number } | null = null;

  constructor(model: ITabStrip, config?: Partial<TabStripViewConfig>) {
    this.model = model;
    this.config = { ...DEFAULT_VIEW_CONFIG, ...config };
  }

  get element(): HTMLElement | null {
    return this.container;
  }

  attach(container: HTMLElement): void {
    this.container = container;
    this.build();
  }

  detach(): void {
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this.tabsContainer = null;
    this.newTabButton = null;
    this.dragState = null;
  }

  update(state: TabStripState): void {
    this.renderTabs(state);
  }

  setEventHandler(handler: (event: TabStripEventUnion) => void): void {
    this.eventHandler = handler;
  }

  private build(): void {
    if (!this.container) return;
    this.container.innerHTML = '';
    this.container.className = 'tab-bar';

    this.tabsContainer = document.createElement('div');
    this.tabsContainer.className = 'tab-bar-inner';
    this.tabsContainer.style.cssText = 'display:flex;align-items:flex-end;gap:1px;flex:1;overflow-x:auto;min-width:0;padding:4px 6px 0;';
    this.container.appendChild(this.tabsContainer);

    if (this.config.showNewTabButton) {
      this.newTabButton = document.createElement('button');
      this.newTabButton.className = 'tab-new-btn';
      this.newTabButton.textContent = '+';
      this.newTabButton.title = 'New Tab';
      this.newTabButton.style.cssText = 'border:none;background:none;color:var(--text-tertiary);font-size:16px;cursor:pointer;padding:3px 8px;border-radius:var(--radius-sm);line-height:1;transition:all var(--t-fast);flex-shrink:0;margin-left:2px;font-family:inherit;';
      this.newTabButton.addEventListener('mouseenter', () => {
        if (this.newTabButton) this.newTabButton.style.color = 'var(--text-primary)';
      });
      this.newTabButton.addEventListener('mouseleave', () => {
        if (this.newTabButton) this.newTabButton.style.color = 'var(--text-tertiary)';
      });
      this.newTabButton.addEventListener('click', () => {
        this.dispatchEvent({ kind: 'newTabRequested' });
      });
      this.container.appendChild(this.newTabButton);
    }

    this.renderTabs(this.model.state);
  }

  private renderTabs(state: TabStripState): void {
    if (!this.tabsContainer) return;

    const existingTabs = new Map<string, HTMLElement>();
    for (const child of Array.from(this.tabsContainer.children)) {
      const el = child as HTMLElement;
      if (el.dataset.tabId) {
        existingTabs.set(el.dataset.tabId, el);
      }
    }

    const fragment = document.createDocumentFragment();

    for (const tab of state.tabs) {
      let tabEl = existingTabs.get(tab.id);
      if (tabEl) {
        existingTabs.delete(tab.id);
      } else {
        tabEl = this.createTabElement(tab);
      }
      this.updateTabElement(tabEl, tab);
      fragment.appendChild(tabEl);
    }

    this.tabsContainer.innerHTML = '';
    this.tabsContainer.appendChild(fragment);

    for (const orphan of existingTabs.values()) {
      orphan.remove();
    }
  }

  private createTabElement(tab: { id: string; title: string; favicon: string | null; loading: boolean; pinned: boolean; active: boolean }): HTMLElement {
    const el = document.createElement('div');
    el.className = 'tab';
    el.dataset.tabId = tab.id;
    el.style.cssText = `display:flex;align-items:center;gap:6px;padding:5px 12px;font-size:12px;color:var(--text-secondary);background:var(--bg-elevated);border:1px solid var(--border-subtle);border-bottom:none;border-radius:var(--radius-md) var(--radius-md) 0 0;cursor:pointer;max-width:${this.config.maxTabWidth}px;transition:all var(--t-fast);position:relative;top:1px;flex-shrink:0;user-select:none;`;

    el.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).classList.contains('tab-close')) {
        this.dispatchEvent({ kind: 'tabSelected', tabId: tab.id });
      }
    });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close tab';
    closeBtn.style.cssText = 'border:none;background:none;color:var(--text-tertiary);cursor:pointer;padding:1px 4px;border-radius:var(--radius-sm);font-size:10px;line-height:1;transition:all var(--t-fast);';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dispatchEvent({ kind: 'tabClosed', tabId: tab.id });
    });
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.background = 'rgba(240,106,106,.2)';
      closeBtn.style.color = 'var(--text-danger)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.background = 'none';
      closeBtn.style.color = 'var(--text-tertiary)';
    });

    el.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button === 2) {
        e.preventDefault();
        this.dispatchEvent({ kind: 'contextMenu', tabId: tab.id, x: e.clientX, y: e.clientY });
      }
    });

    el.addEventListener('contextmenu', (e: Event) => {
      e.preventDefault();
    });

    el.addEventListener('dragstart', (e: DragEvent) => {
      this.dragState = { tabId: tab.id, startX: e.clientX, startIndex: this.getTabIndex(tab.id) };
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', tab.id);
      }
      el.style.opacity = '0.5';
    });

    el.addEventListener('dragend', () => {
      el.style.opacity = '1';
      this.dragState = null;
    });

    el.addEventListener('dragover', (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });

    el.addEventListener('drop', (e: DragEvent) => {
      e.preventDefault();
      if (this.dragState && this.dragState.tabId !== tab.id) {
        const toIndex = this.getTabIndex(tab.id);
        this.dispatchEvent({ kind: 'tabMoved', tabId: this.dragState.tabId, fromIndex: this.dragState.startIndex, toIndex });
      }
      el.style.opacity = '1';
    });

    el.draggable = true;

    return el;
  }

  private updateTabElement(el: HTMLElement, tab: { id: string; title: string; favicon: string | null; loading: boolean; pinned: boolean; active: boolean }): void {
    el.className = `tab${tab.active ? ' active' : ''}`;

    if (tab.active) {
      el.style.background = 'var(--bg-surface)';
      el.style.color = 'var(--text-primary)';
      el.style.borderColor = 'var(--border-default)';
    } else {
      el.style.background = 'var(--bg-elevated)';
      el.style.color = 'var(--text-secondary)';
      el.style.borderColor = 'var(--border-subtle)';
    }

    el.innerHTML = '';

    if (tab.favicon) {
      const faviconEl = document.createElement('span');
      faviconEl.className = 'tab-favicon';
      faviconEl.textContent = tab.favicon;
      faviconEl.style.cssText = 'font-size:12px;flex-shrink:0;';
      el.appendChild(faviconEl);
    }

    if (tab.loading) {
      const spinner = document.createElement('span');
      spinner.className = 'tab-favicon tab-spinner';
      spinner.textContent = '↻';
      spinner.style.cssText = 'font-size:12px;flex-shrink:0;animation:spin 1s linear infinite;';
      el.appendChild(spinner);
    }

    const titleSpan = document.createElement('span');
    titleSpan.className = 'tab-title';
    titleSpan.textContent = tab.title;
    titleSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;';
    el.appendChild(titleSpan);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'tab-close';
    closeBtn.textContent = '×';
    closeBtn.title = 'Close tab';
    closeBtn.style.cssText = 'border:none;background:none;color:var(--text-tertiary);cursor:pointer;padding:1px 4px;border-radius:var(--radius-sm);font-size:10px;line-height:1;transition:all var(--t-fast);flex-shrink:0;';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dispatchEvent({ kind: 'tabClosed', tabId: tab.id });
    });
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.background = 'rgba(240,106,106,.2)';
      closeBtn.style.color = 'var(--text-danger)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.background = 'none';
      closeBtn.style.color = 'var(--text-tertiary)';
    });
    el.appendChild(closeBtn);

    el.onclick = (e) => {
      if (!(e.target as HTMLElement).classList.contains('tab-close')) {
        this.dispatchEvent({ kind: 'tabSelected', tabId: tab.id });
      }
    };

    el.oncontextmenu = (e: MouseEvent) => {
      e.preventDefault();
      this.dispatchEvent({ kind: 'contextMenu', tabId: tab.id, x: e.clientX, y: e.clientY });
    };
  }

  private getTabIndex(tabId: string): number {
    return this.model.state.tabs.findIndex(t => t.id === tabId);
  }

  private dispatchEvent(event: TabStripEventUnion): void {
    if (this.eventHandler) {
      this.eventHandler(event);
    }
  }

  dispose(): void {
    this.detach();
    this.eventHandler = null;
  }
}

export { TabStripView, DEFAULT_VIEW_CONFIG };
export type { ITabStripView, TabStripViewConfig };
