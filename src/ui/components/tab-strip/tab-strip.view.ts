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

const ICON_NEW_TAB =
  '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M7 1.5v11M1.5 7h11"/></svg>';
const ICON_TAB_CLOSE =
  '<svg viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M1.5 1.5l6 6M7.5 1.5l-6 6"/></svg>';

class TabStripView implements ITabStripView {
  private readonly config: TabStripViewConfig;
  private readonly model: ITabStrip;
  private container: HTMLElement | null = null;
  private tabsList: HTMLElement | null = null;
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
    this.tabsList = null;
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

    this.tabsList = document.createElement('div');
    this.tabsList.className = 'nova-tabs-list';
    this.container.appendChild(this.tabsList);

    this.tabsContainer = document.createElement('div');
    this.tabsContainer.className = 'nova-tabs-scroll';
    this.tabsList.appendChild(this.tabsContainer);

    if (this.config.showNewTabButton) {
      this.newTabButton = document.createElement('button');
      this.newTabButton.setAttribute('type', 'button');
      this.newTabButton.className = 'nova-new-tab';
      this.newTabButton.innerHTML = ICON_NEW_TAB;
      this.newTabButton.title = 'New Tab';
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
    el.className = 'nova-tab';
    el.dataset.tabId = tab.id;
    el.draggable = true;

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

    return el;
  }

  private updateTabElement(el: HTMLElement, tab: { id: string; title: string; favicon: string | null; loading: boolean; pinned: boolean; active: boolean }): void {
    el.className = `nova-tab${tab.active ? ' active' : ''}${tab.pinned ? ' pinned' : ''}${tab.loading ? ' loading' : ''}`;
    el.title = tab.title || 'New Tab';
    el.innerHTML = '';

    const faviconEl = document.createElement('span');
    faviconEl.className = 'nova-tab-favicon';
    if (!tab.loading && tab.favicon) {
      faviconEl.textContent = tab.favicon;
    }
    el.appendChild(faviconEl);

    if (!tab.pinned) {
      const titleSpan = document.createElement('span');
      titleSpan.className = 'nova-tab-title';
      titleSpan.textContent = tab.title;
      el.appendChild(titleSpan);

      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'nova-tab-close';
      closeBtn.innerHTML = ICON_TAB_CLOSE;
      closeBtn.title = 'Close tab';
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dispatchEvent({ kind: 'tabClosed', tabId: tab.id });
      });
      el.appendChild(closeBtn);
    }

    if (tab.active) {
      el.setAttribute('aria-selected', 'true');
    } else {
      el.removeAttribute('aria-selected');
    }

    el.onclick = (e) => {
      if (!(e.target as HTMLElement).closest('.nova-tab-close')) {
        this.dispatchEvent({ kind: 'tabSelected', tabId: tab.id });
      }
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