import type { IDisposable } from '../../app/dependency-container';
import type { BookmarkEntry } from '../../browser/storage/bookmark-store';
import type { HistoryEntry } from '../../browser/storage/history-store';
import type { ISearchEngineManager } from '../../browser/omnibox/search-engine';
import type { OmniboxResult } from '../../browser/omnibox/omnibox';
import { SuggestionsDropdown } from '../components/suggestions-dropdown';
import { createNovaLogo } from '../components/nova-logo';
import { ensureSearchTheme } from './search-theme';

// ── Event types ───────────────────────────────────────────────────────────

type NewTabPageEventType = 'navigate' | 'tileAction';

interface NewTabPageEvent {
  readonly kind: NewTabPageEventType;
  readonly url?: string;
  readonly action?: 'openInNewTab' | 'remove';
}

interface INewTabPage extends IDisposable {
  readonly isMounted: boolean;
  mount(container: HTMLElement): void;
  unmount(): void;
  setSearchEngineManager(manager: ISearchEngineManager): void;
  setBookmarks(entries: readonly BookmarkEntry[]): void;
  setHistoryEntries(entries: readonly HistoryEntry[]): void;
  on(type: NewTabPageEventType, handler: (event: NewTabPageEvent) => void): void;
  off(type: NewTabPageEventType, handler: (event: NewTabPageEvent) => void): void;
}

// ── Quick-link tile model ─────────────────────────────────────────────────

interface NewTabPageNotice {
  readonly text: string;
  readonly actions: ReadonlyArray<{ readonly label: string; readonly primary?: boolean; onClick(): void }>;
}

interface NewTabPageLink {
  readonly label: string;
  readonly url: string;
  readonly icon: string;
}

const DEFAULT_QUICK_LINKS: readonly NewTabPageLink[] = [
  { label: 'Settings', url: 'nova://settings', icon: '\u2699\uFE0F' },
  { label: 'Downloads', url: 'nova://downloads', icon: '\uD83D\uDCE5' },
  { label: 'Bookmarks', url: 'nova://bookmarks', icon: '\uD83D\uDCD1' },
  { label: 'History', url: 'nova://history', icon: '\uD83D\uDCCB' },
  { label: 'Extensions', url: 'nova://extensions', icon: '\uD83D\uDD27' },
];

// ── CSS animation keyframes (injected once) ───────────────────────────────

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ntpFadeInUp {
      from { opacity:0; transform:translateY(18px); }
      to   { opacity:1; transform:translateY(0); }
    }
    .ntp-fade { opacity:0; animation:ntpFadeInUp 0.5s ease-out forwards; }
    @media (prefers-reduced-motion: reduce) { .ntp-fade { opacity:1; animation:none; } }
    .ntp-fade-d1 { animation-delay:0.05s; }
    .ntp-fade-d2 { animation-delay:0.15s; }
    .ntp-fade-d3 { animation-delay:0.25s; }
    .ntp-fade-d4 { animation-delay:0.35s; }
    .ntp-fade-d5 { animation-delay:0.45s; }
    .ntp-tile { display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative;
      padding:14px 6px 12px; border-radius:16px; cursor:pointer; min-height:76px;
      background:var(--ns-surface); border:1px solid var(--ns-border);
      transition:background 0.2s,transform 0.18s,border-color 0.2s,box-shadow 0.2s; }
    .ntp-tile:hover { background:var(--ns-surface-2); border-color:var(--ns-accent); transform:translateY(-2px); box-shadow:var(--ns-shadow); }
    .ntp-tile:active { transform:scale(0.97); transition-duration:0.08s; }
    .ntp-tile-label { font-size:12px; color:var(--ns-text); text-align:center; line-height:1.2; max-width:100%;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ntp-tile-domain { font-size:10px; color:var(--ns-muted); text-align:center; margin-top:2px; max-width:100%;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ntp-section { width:100%; max-width:640px; margin-top:24px; }
    .ntp-section-label { font-size:12px; font-weight:600; color:var(--ns-muted); text-transform:uppercase; letter-spacing:.06em;
      margin-bottom:10px; padding-left:4px; text-align:left; }
    .ntp-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(88px,1fr)); gap:12px; }
    .ntp-engine-btn { flex:none; font-size:12px; color:var(--ns-muted); padding:6px 10px; border-radius:999px;
      white-space:nowrap; user-select:none; cursor:pointer; transition:background 0.15s; }
    .ntp-engine-btn:hover { background:var(--ns-surface-2); }
    .ntp-dropdown { position:absolute; top:100%; right:0; margin-top:6px; min-width:160px; text-align:left;
      background:var(--ns-surface); border:1px solid var(--ns-border); box-shadow:var(--ns-shadow);
      border-radius:12px; z-index:50; overflow:hidden; }
    .ntp-dropdown-item { padding:10px 14px; font-size:13px; color:var(--ns-text); cursor:pointer; transition:background 0.12s; }
    .ntp-dropdown-item:hover { background:var(--ns-surface-2); }
    .ntp-dropdown-item.active { color:var(--ns-accent); font-weight:600; }
    .ntp-ctx-menu { position:fixed; min-width:160px; background:var(--ns-surface); border:1px solid var(--ns-border);
      box-shadow:var(--ns-shadow); border-radius:12px; z-index:100; overflow:hidden; padding:4px 0; text-align:left; }
    .ntp-ctx-item { padding:9px 16px; font-size:13px; color:var(--ns-text); cursor:pointer; transition:background 0.12s; }
    .ntp-ctx-item:hover { background:var(--ns-surface-2); }
    .ntp-ctx-item.danger { color:#e5484d; }
  `;
  document.head.appendChild(style);
}

// ── Helper: derive hue from string ────────────────────────────────────────

function hashToHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** "Good morning" / "Good afternoon" / "Good evening", as on the Android home page. */
function greetingFor(hour: number): string {
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

// ── Main class ────────────────────────────────────────────────────────────

type NewTabPageEventHandler = (event: NewTabPageEvent) => void;

class NewTabPage implements INewTabPage {
  private readonly handlers: NewTabPageEventHandler[] = [];
  private container: HTMLElement | null = null;
  private wrapper: HTMLElement | null = null;
  private clockEl: HTMLElement | null = null;
  private engineLabelEl: HTMLElement | null = null;
  private dropdownEl: HTMLElement | null = null;
  private ctxMenuEl: HTMLElement | null = null;
  private frequentSection: HTMLElement | null = null;
  private bookmarkSection: HTMLElement | null = null;
  private _mounted = false;
  private manager: ISearchEngineManager | null = null;
  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private bookmarks: readonly BookmarkEntry[] = [];
  private historyEntries: readonly HistoryEntry[] = [];
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;
  private suggestSource: ((text: string) => Promise<readonly OmniboxResult[]>) | null = null;
  private suggestions: SuggestionsDropdown | null = null;
  private notice: NewTabPageNotice | null = null;
  private noticeEl: HTMLElement | null = null;

  get isMounted(): boolean { return this._mounted; }

  mount(container: HTMLElement): void {
    ensureSearchTheme();
    injectStyles();
    this.container = container;
    this.container.className = 'new-tab-page ns-root';
    this.container.style.cssText = 'position:relative;-webkit-tap-highlight-color:transparent;';
    this.build();
    this.startClock();
    this._mounted = true;
  }

  unmount(): void {
    this.suggestions?.dispose();
    this.suggestions = null;
    this.stopClock();
    this.removeCtxMenu();
    this.removeClickOutside();
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this.wrapper = null;
    this.noticeEl = null;
    this.clockEl = null;
    this.engineLabelEl = null;
    this.dropdownEl = null;
    this.frequentSection = null;
    this.bookmarkSection = null;
    this._mounted = false;
  }

  on(type: NewTabPageEventType, handler: NewTabPageEventHandler): void {
    this.handlers.push(handler);
  }

  off(type: NewTabPageEventType, handler: NewTabPageEventHandler): void {
    const idx = this.handlers.indexOf(handler);
    if (idx !== -1) this.handlers.splice(idx, 1);
  }

  setSearchEngineManager(manager: ISearchEngineManager): void {
    this.manager = manager;
    if (this.engineLabelEl) {
      this.engineLabelEl.textContent = manager.getDefaultEngine().name;
    }
  }

  /** A one-line notice under the search box (null removes it). */
  setNotice(notice: NewTabPageNotice | null): void {
    this.notice = notice;
    this.renderNotice();
  }

  private renderNotice(): void {
    const slot = this.noticeEl;
    if (!slot) return;
    slot.innerHTML = '';
    slot.hidden = !this.notice;
    if (!this.notice) return;
    const card = document.createElement('div');
    card.className = 'ns-card';
    card.setAttribute('role', 'status');
    const text = document.createElement('p');
    text.style.margin = '0 0 10px';
    text.textContent = this.notice.text;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';
    for (const action of this.notice.actions) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = action.primary ? 'ns-btn ns-primary' : 'ns-btn';
      b.textContent = action.label;
      b.addEventListener('click', () => action.onClick());
      row.appendChild(b);
    }
    card.append(text, row);
    slot.appendChild(card);
  }

  /** Suggestion rows for the search box (the omnibox providers). Set before mount; without it the box has no suggestions. */
  setSuggestionSource(fetch: (text: string) => Promise<readonly OmniboxResult[]>): void {
    this.suggestSource = fetch;
  }

  setBookmarks(entries: readonly BookmarkEntry[]): void {
    this.bookmarks = entries;
    this.renderBookmarkSection();
  }

  setHistoryEntries(entries: readonly HistoryEntry[]): void {
    this.historyEntries = entries;
    this.renderFrequentSection();
  }

  // ── Private: event emission ───────────────────────────────────────────

  private emit(event: NewTabPageEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch (err) {
        console.error('[NewTabPage] Handler threw:', err);
      }
    }
  }

  // ── Private: particle background ──────────────────────────────────────


  // ── Private: main build ───────────────────────────────────────────────

  private build(): void {
    if (!this.container) return;
    this.container.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'ns-home';
    this.wrapper = wrapper;
    this.container.appendChild(wrapper);

    this.buildLogo(wrapper);
    this.buildSearchBar(wrapper);
    this.noticeEl = document.createElement('div');
    this.noticeEl.className = 'ns-notice';
    wrapper.appendChild(this.noticeEl);
    this.renderNotice();
    this.buildQuickLinks(wrapper);

    this.frequentSection = document.createElement('div');
    this.frequentSection.className = 'ntp-section';
    wrapper.appendChild(this.frequentSection);
    this.renderFrequentSection();

    this.bookmarkSection = document.createElement('div');
    this.bookmarkSection.className = 'ntp-section';
    wrapper.appendChild(this.bookmarkSection);
    this.renderBookmarkSection();

    this.buildFooter(wrapper);
  }

  // ── Private: logo section ─────────────────────────────────────────────

  private buildLogo(parent: HTMLElement): void {
    const logo = document.createElement('h1');
    logo.className = 'ns-home-logo ntp-fade ntp-fade-d1';
    logo.append(createNovaLogo(72));
    const name = document.createElement('span');
    name.className = 'ns-sr';
    name.textContent = 'Nova';
    logo.appendChild(name);
    parent.appendChild(logo);

    const greeting = document.createElement('p');
    greeting.className = 'ns-greeting ntp-fade ntp-fade-d1';
    greeting.textContent = `${greetingFor(new Date().getHours())} · Search the pages you have visited, your bookmarks and history`;
    parent.appendChild(greeting);
  }

  // ── Private: search bar + engine selector ─────────────────────────────

  private buildSearchBar(parent: HTMLElement): void {
    const container = document.createElement('div');
    container.className = 'ntp-fade ntp-fade-d2';
    // z-index: the fade-in animation gives each section its own stacking context, so without it the
    // suggestions list drew under the quick-link tiles that follow.
    container.style.cssText = 'width:100%;max-width:640px;position:relative;z-index:20;';

    const form = document.createElement('div');
    form.className = 'ns-pill';
    form.style.maxWidth = 'none';
    form.setAttribute('role', 'search');

    const searchIcon = document.createElement('span');
    searchIcon.className = 'ns-pill-icon';
    searchIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
    form.appendChild(searchIcon);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search Nova or type a web address';
    input.setAttribute('aria-label', 'Search Nova or type a web address');
    input.autocomplete = 'off';
    if (this.suggestSource) {
      const fetch = this.suggestSource;
      this.suggestions = new SuggestionsDropdown(input, form, {
        fetch: (text) => fetch(text),
        onPick: (row) => (row.url ? this.emit({ kind: 'navigate', url: row.url }) : this.navigateFromInput(row.text)),
        onSubmit: (text) => this.navigateFromInput(text),
      });
    } else {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const query = input.value.trim();
          if (query) this.navigateFromInput(query);
        }
      });
    }
    form.appendChild(input);

    const engineBtn = document.createElement('div');
    engineBtn.className = 'ntp-engine-btn';
    engineBtn.setAttribute('role', 'button');
    engineBtn.title = 'Search engine';
    engineBtn.textContent = this.manager?.getDefaultEngine().name ?? 'Search';
    this.engineLabelEl = engineBtn;
    engineBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown(container);
    });
    form.appendChild(engineBtn);

    container.appendChild(form);
    parent.appendChild(container);
  }

  private toggleDropdown(anchor: HTMLElement): void {
    if (this.dropdownEl) { this.removeDropdown(); return; }

    const dd = document.createElement('div');
    dd.className = 'ntp-dropdown';
    const engines = this.manager?.getEngines() ?? [];
    const defaultId = this.manager?.getDefaultEngine().id;
    for (const engine of engines) {
      const item = document.createElement('div');
      item.className = 'ntp-dropdown-item' + (engine.id === defaultId ? ' active' : '');
      item.textContent = engine.icon ? `${engine.icon} ${engine.name}` : engine.name;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.manager?.setDefaultEngine(engine.id);
        if (this.engineLabelEl) this.engineLabelEl.textContent = engine.name;
        this.removeDropdown();
      });
      dd.appendChild(item);
    }
    this.dropdownEl = dd;
    anchor.appendChild(dd);

    this.clickOutsideHandler = (e: MouseEvent) => {
      if (!dd.contains(e.target as Node)) this.removeDropdown();
    };
    setTimeout(() => document.addEventListener('click', this.clickOutsideHandler!), 0);
  }

  private removeDropdown(): void {
    if (this.dropdownEl) { this.dropdownEl.remove(); this.dropdownEl = null; }
    this.removeClickOutside();
  }

  private removeClickOutside(): void {
    if (this.clickOutsideHandler) {
      document.removeEventListener('click', this.clickOutsideHandler);
      this.clickOutsideHandler = null;
    }
  }

  // ── Private: static quick links ───────────────────────────────────────

  private buildQuickLinks(parent: HTMLElement): void {
    const section = document.createElement('div');
    section.className = 'ntp-section ntp-fade ntp-fade-d3';

    const label = document.createElement('div');
    label.className = 'ntp-section-label';
    label.textContent = 'Quick Links';
    section.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'ntp-grid';
    for (const link of DEFAULT_QUICK_LINKS) {
      grid.appendChild(this.createStaticTile(link));
    }
    section.appendChild(grid);
    parent.appendChild(section);
  }

  private createStaticTile(link: NewTabPageLink): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'ntp-tile';
    tile.setAttribute('role', 'link');
    tile.tabIndex = 0;
    tile.addEventListener('click', () => this.emit({ kind: 'navigate', url: link.url }));
    tile.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.emit({ kind: 'navigate', url: link.url }); });

    const icon = document.createElement('div');
    icon.style.cssText = 'font-size:24px;margin-bottom:6px;';
    icon.textContent = link.icon;
    tile.appendChild(icon);

    const labelEl = document.createElement('div');
    labelEl.className = 'ntp-tile-label';
    labelEl.textContent = link.label;
    tile.appendChild(labelEl);

    return tile;
  }

  // ── Private: "Frequently Visited" section ─────────────────────────────

  private renderFrequentSection(): void {
    if (!this.frequentSection) return;
    this.frequentSection.innerHTML = '';
    if (this.historyEntries.length === 0) return;

    const label = document.createElement('div');
    label.className = 'ntp-section-label';
    label.textContent = 'Recently visited';
    this.frequentSection.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'ntp-grid';

    for (const entry of this.historyEntries.slice(0, 8)) {
      grid.appendChild(this.createDynamicTile(entry.title || extractDomain(entry.url), entry.url, 'history'));
    }
    this.frequentSection.appendChild(grid);
  }

  // ── Private: "Bookmarks" section ──────────────────────────────────────

  private renderBookmarkSection(): void {
    if (!this.bookmarkSection) return;
    this.bookmarkSection.innerHTML = '';
    if (this.bookmarks.length === 0) return;

    const label = document.createElement('div');
    label.className = 'ntp-section-label';
    label.textContent = 'Bookmarks';
    this.bookmarkSection.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'ntp-grid';

    for (const bm of this.bookmarks.slice(0, 8)) {
      if (!bm.url || bm.folder) continue;
      grid.appendChild(this.createDynamicTile(bm.title || extractDomain(bm.url), bm.url, 'bookmark'));
    }
    this.bookmarkSection.appendChild(grid);
  }

  // ── Private: dynamic tile (bookmark / history) ────────────────────────

  private createDynamicTile(title: string, url: string, type: 'bookmark' | 'history'): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'ntp-tile';
    tile.setAttribute('role', 'link');
    tile.tabIndex = 0;
    tile.title = url;
    tile.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.emit({ kind: 'navigate', url }); });

    // A letter avatar, not a favicon fetched from a third-party service (that sent every visited host to Google).
    tile.appendChild(this.createLetterAvatar(title, hashToHue(url)));

    const labelEl = document.createElement('div');
    labelEl.className = 'ntp-tile-label';
    labelEl.textContent = title.length > 14 ? title.slice(0, 13) + '\u2026' : title;
    tile.appendChild(labelEl);

    const domain = extractDomain(url);
    if (domain) {
      const domainEl = document.createElement('div');
      domainEl.className = 'ntp-tile-domain';
      domainEl.textContent = domain;
      tile.appendChild(domainEl);
    }

    tile.addEventListener('click', () => this.emit({ kind: 'navigate', url }));

    let pressTimer: ReturnType<typeof setTimeout> | null = null;
    const onDown = (e: MouseEvent | TouchEvent) => {
      pressTimer = setTimeout(() => {
        this.showCtxMenu(e, url, title, type);
      }, 500);
    };
    const onUp = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    tile.addEventListener('mousedown', onDown);
    tile.addEventListener('mouseup', onUp);
    tile.addEventListener('mouseleave', onUp);
    tile.addEventListener('touchstart', onDown, { passive: true });
    tile.addEventListener('touchend', onUp);
    tile.addEventListener('touchcancel', onUp);

    return tile;
  }

  private createLetterAvatar(text: string, hue: number): HTMLElement {
    const letter = document.createElement('div');
    const initial = (text.charAt(0) || '?').toUpperCase();
    letter.style.cssText = `
      width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;
      font-size:13px;font-weight:700;color:hsl(${hue},70%,85%);
      background:hsl(${hue},50%,25%);margin-bottom:6px;flex-shrink:0;
    `;
    letter.textContent = initial;
    return letter;
  }

  // ── Private: context menu ─────────────────────────────────────────────

  private showCtxMenu(e: MouseEvent | TouchEvent, url: string, title: string, type: 'bookmark' | 'history'): void {
    this.removeCtxMenu();

    const menu = document.createElement('div');
    menu.className = 'ntp-ctx-menu';

    let clientX: number, clientY: number;
    if ('touches' in e) {
      const t = e.touches[0] || e.changedTouches[0];
      clientX = t.clientX; clientY = t.clientY;
    } else {
      clientX = e.clientX; clientY = e.clientY;
    }

    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;

    const openNew = document.createElement('div');
    openNew.className = 'ntp-ctx-item';
    openNew.textContent = 'Open in new tab';
    openNew.addEventListener('click', () => {
      this.emit({ kind: 'tileAction', url, action: 'openInNewTab' });
      this.removeCtxMenu();
    });
    menu.appendChild(openNew);

    if (type === 'bookmark') {
      const remove = document.createElement('div');
      remove.className = 'ntp-ctx-item danger';
      remove.textContent = 'Remove bookmark';
      remove.addEventListener('click', () => {
        this.emit({ kind: 'tileAction', url, action: 'remove' });
        this.removeCtxMenu();
      });
      menu.appendChild(remove);
    }

    // Inside the page root so it takes the page's theme colours.
    (this.container ?? document.body).appendChild(menu);
    this.ctxMenuEl = menu;

    const dismiss = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        this.removeCtxMenu();
        document.removeEventListener('click', dismiss);
      }
    };
    setTimeout(() => document.addEventListener('click', dismiss), 0);
  }

  private removeCtxMenu(): void {
    if (this.ctxMenuEl) { this.ctxMenuEl.remove(); this.ctxMenuEl = null; }
  }

  // ── Private: footer with live clock ───────────────────────────────────

  private buildFooter(parent: HTMLElement): void {
    const footer = document.createElement('div');
    footer.className = 'ntp-fade ntp-fade-d5';
    footer.style.cssText = 'margin-top:auto;padding-top:28px;text-align:center;';

    const timeEl = document.createElement('div');
    timeEl.className = 'ns-muted ns-small';
    this.clockEl = timeEl;
    this.updateClock(timeEl);
    footer.appendChild(timeEl);

    const brand = document.createElement('div');
    brand.className = 'ns-muted ns-small';
    brand.style.marginTop = '4px';
    brand.textContent = 'Nova Browser · results come from your own Nova index';
    footer.appendChild(brand);

    parent.appendChild(footer);
  }

  private startClock(): void {
    this.clockInterval = setInterval(() => {
      if (this.clockEl) this.updateClock(this.clockEl);
    }, 30_000);
  }

  private stopClock(): void {
    if (this.clockInterval) { clearInterval(this.clockInterval); this.clockInterval = null; }
  }

  private updateClock(el: HTMLElement): void {
    const now = new Date();
    const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    el.textContent = `${dateStr} \u00B7 ${timeStr}`;
  }

  // ── Private: search input handling ────────────────────────────────────

  private navigateFromInput(query: string): void {
    const isUrl = /^(https?:\/\/|ftp:\/\/|file:\/\/|nova:|about:)/i.test(query) ||
      (/^[\w-]+(\.[\w-]+)+/.test(query) && !/\s/.test(query));

    if (isUrl) {
      const url = query.startsWith('http') ? query : `https://${query}`;
      this.emit({ kind: 'navigate', url });
    } else {
      const template = this.manager?.getDefaultEngine().url ?? 'nova://search?q=%s';
      this.emit({ kind: 'navigate', url: template.replace('%s', encodeURIComponent(query)) });
    }
  }

  dispose(): void {
    this.unmount();
    this.handlers.length = 0;
  }
}

export { NewTabPage, DEFAULT_QUICK_LINKS };
export type { INewTabPage, NewTabPageEvent, NewTabPageEventType, NewTabPageLink, NewTabPageNotice };
