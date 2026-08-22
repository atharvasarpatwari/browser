import type { IDisposable } from '../../app/dependency-container';
import type { BookmarkEntry } from '../../browser/storage/bookmark-store';
import type { HistoryEntry } from '../../browser/storage/history-store';

// ── Event types ───────────────────────────────────────────────────────────

type NewTabPageEventType = 'navigate' | 'tileAction' | 'searchEngineChanged';

interface NewTabPageEvent {
  readonly kind: NewTabPageEventType;
  readonly url?: string;
  readonly action?: 'openInNewTab' | 'remove';
  readonly engine?: string;
}

interface INewTabPage extends IDisposable {
  readonly isMounted: boolean;
  mount(container: HTMLElement): void;
  unmount(): void;
  setSearchEngine(engine: string): void;
  setBookmarks(entries: readonly BookmarkEntry[]): void;
  setHistoryEntries(entries: readonly HistoryEntry[]): void;
  on(type: NewTabPageEventType, handler: (event: NewTabPageEvent) => void): void;
  off(type: NewTabPageEventType, handler: (event: NewTabPageEvent) => void): void;
}

// ── Quick-link tile model ─────────────────────────────────────────────────

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

const SEARCH_URL_TEMPLATES: Record<string, string> = {
  google: 'https://www.google.com/search?q=%s',
  bing: 'https://www.bing.com/search?q=%s',
  duckduckgo: 'https://duckduckgo.com/?q=%s',
};

const ENGINE_LABELS: Record<string, string> = {
  google: 'Google',
  bing: 'Bing',
  duckduckgo: 'DuckDuckGo',
};

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
    @keyframes ntpFloat {
      0%,100% { transform:translateY(0) scale(1); opacity:0.18; }
      50%     { transform:translateY(-18px) scale(1.1); opacity:0.32; }
    }
    @keyframes ntpGradientShift {
      0%   { background-position:0% 50%; }
      50%  { background-position:100% 50%; }
      100% { background-position:0% 50%; }
    }
    @keyframes ntpPulse {
      0%,100% { opacity:0.5; }
      50%     { opacity:1; }
    }
    .ntp-fade { opacity:0; animation:ntpFadeInUp 0.5s ease-out forwards; }
    .ntp-fade-d1 { animation-delay:0.05s; }
    .ntp-fade-d2 { animation-delay:0.15s; }
    .ntp-fade-d3 { animation-delay:0.25s; }
    .ntp-fade-d4 { animation-delay:0.35s; }
    .ntp-fade-d5 { animation-delay:0.45s; }
    .ntp-tile { transition:background 0.2s,transform 0.18s,border-color 0.2s,box-shadow 0.2s; }
    .ntp-tile:hover { background:rgba(255,255,255,0.1) !important; border-color:rgba(129,140,248,0.4) !important;
      transform:translateY(-3px) scale(1.04); box-shadow:0 6px 20px rgba(99,102,241,0.15); }
    .ntp-tile:active { transform:scale(0.96); transition-duration:0.08s; }
    .ntp-particle { position:absolute; border-radius:50%; background:rgba(255,255,255,0.18);
      animation:ntpFloat linear infinite; pointer-events:none; }
    .ntp-engine-btn { cursor:pointer; transition:background 0.15s; }
    .ntp-engine-btn:hover { background:rgba(255,255,255,0.12); }
    .ntp-dropdown { position:absolute; top:100%; right:0; margin-top:6px; min-width:140px;
      background:rgba(30,30,50,0.96); border:1px solid rgba(255,255,255,0.12);
      border-radius:10px; backdrop-filter:blur(12px); z-index:50; overflow:hidden; }
    .ntp-dropdown-item { padding:10px 14px; font-size:13px; color:#cbd5e1; cursor:pointer;
      transition:background 0.12s; }
    .ntp-dropdown-item:hover { background:rgba(255,255,255,0.08); }
    .ntp-dropdown-item.active { color:#818cf8; font-weight:600; }
    .ntp-ctx-menu { position:fixed; min-width:160px; background:rgba(30,30,50,0.97);
      border:1px solid rgba(255,255,255,0.12); border-radius:10px;
      backdrop-filter:blur(12px); z-index:100; overflow:hidden; padding:4px 0; }
    .ntp-ctx-item { padding:9px 16px; font-size:13px; color:#cbd5e1; cursor:pointer;
      transition:background 0.12s; }
    .ntp-ctx-item:hover { background:rgba(255,255,255,0.08); }
    .ntp-ctx-item.danger { color:#f87171; }
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

function getFaviconUrl(url: string): string {
  try {
    const u = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
  } catch { return ''; }
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
  private searchEngine = 'google';
  private clockInterval: ReturnType<typeof setInterval> | null = null;
  private bookmarks: readonly BookmarkEntry[] = [];
  private historyEntries: readonly HistoryEntry[] = [];
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private clickOutsideHandler: ((e: MouseEvent) => void) | null = null;

  get isMounted(): boolean { return this._mounted; }

  mount(container: HTMLElement): void {
    injectStyles();
    this.container = container;
    this.container.className = 'new-tab-page';
    this.container.style.cssText = `
      width:100%;height:100%;overflow-y:auto;overflow-x:hidden;position:relative;
      background:linear-gradient(135deg,#0f0c29 0%,#1a1a2e 35%,#16213e 70%,#0f0c29 100%);
      background-size:200% 200%;
      animation:ntpGradientShift 18s ease infinite;
      font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      display:flex;flex-direction:column;align-items:center;
      padding:0;margin:0;box-sizing:border-box;
      -webkit-tap-highlight-color:transparent;
    `;
    this.buildParticles();
    this.build();
    this.startClock();
    this._mounted = true;
  }

  unmount(): void {
    this.stopClock();
    this.removeCtxMenu();
    this.removeClickOutside();
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this.wrapper = null;
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

  setSearchEngine(engine: string): void {
    this.searchEngine = engine;
    if (this.engineLabelEl) {
      this.engineLabelEl.textContent = ENGINE_LABELS[engine] ?? engine;
    }
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

  private buildParticles(): void {
    if (!this.container) return;
    const count = window.innerWidth < 600 ? 12 : 22;
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'ntp-particle';
      const size = 2 + Math.random() * 4;
      const dur = 8 + Math.random() * 14;
      const delay = Math.random() * dur;
      const x = Math.random() * 100;
      const y = Math.random() * 100;
      p.style.cssText = `
        width:${size}px;height:${size}px;left:${x}%;top:${y}%;
        animation-duration:${dur}s;animation-delay:-${delay}s;
        opacity:${0.08 + Math.random() * 0.15};
      `;
      this.container.appendChild(p);
    }
  }

  // ── Private: main build ───────────────────────────────────────────────

  private build(): void {
    if (!this.container) return;
    this.container.innerHTML = '';
    this.buildParticles();

    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      display:flex;flex-direction:column;align-items:center;
      min-height:100%;padding:16px 20px 24px;box-sizing:border-box;
      position:relative;z-index:1;
    `;
    this.wrapper = wrapper;
    this.container.appendChild(wrapper);

    this.buildLogo(wrapper);
    this.buildSearchBar(wrapper);
    this.buildQuickLinks(wrapper);

    this.frequentSection = document.createElement('div');
    this.frequentSection.style.cssText = 'width:100%;max-width:500px;margin-top:24px;';
    wrapper.appendChild(this.frequentSection);
    this.renderFrequentSection();

    this.bookmarkSection = document.createElement('div');
    this.bookmarkSection.style.cssText = 'width:100%;max-width:500px;margin-top:20px;';
    wrapper.appendChild(this.bookmarkSection);
    this.renderBookmarkSection();

    this.buildFooter(wrapper);
  }

  // ── Private: logo section ─────────────────────────────────────────────

  private buildLogo(parent: HTMLElement): void {
    const logo = document.createElement('div');
    logo.className = 'ntp-fade ntp-fade-d1';
    logo.style.cssText = 'text-align:center;margin-bottom:28px;';
    logo.innerHTML = `
      <div style="font-size:44px;margin-bottom:6px;filter:drop-shadow(0 0 18px rgba(129,140,248,0.35));">\u2728</div>
      <div style="font-size:26px;font-weight:700;color:#e2e8f0;letter-spacing:-0.5px;">Nova Browser</div>
      <div style="font-size:12px;color:#64748b;margin-top:4px;letter-spacing:0.5px;">PRIVATE \u00B7 FAST \u00B7 SECURE</div>
    `;
    parent.appendChild(logo);
  }

  // ── Private: search bar + engine selector ─────────────────────────────

  private buildSearchBar(parent: HTMLElement): void {
    const container = document.createElement('div');
    container.className = 'ntp-fade ntp-fade-d2';
    container.style.cssText = 'width:100%;max-width:540px;margin-bottom:28px;position:relative;';

    const form = document.createElement('div');
    form.style.cssText = `
      display:flex;align-items:center;
      background:rgba(255,255,255,0.07);border:1px solid rgba(255,255,255,0.1);
      border-radius:16px;padding:0 6px 0 16px;
      backdrop-filter:blur(12px);
      transition:border-color 0.25s,box-shadow 0.25s;
    `;

    const searchIcon = document.createElement('span');
    searchIcon.textContent = '\uD83D\uDD0D';
    searchIcon.style.cssText = 'font-size:16px;margin-right:10px;opacity:0.5;flex-shrink:0;';
    form.appendChild(searchIcon);

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Search the web or enter a URL...';
    input.style.cssText = `
      flex:1;background:none;border:none;outline:none;
      font-size:15px;color:#e2e8f0;padding:13px 0;font-family:inherit;min-width:0;
    `;
    input.addEventListener('focus', () => {
      form.style.borderColor = 'rgba(129,140,248,0.5)';
      form.style.boxShadow = '0 0 0 3px rgba(129,140,248,0.12),0 4px 16px rgba(0,0,0,0.2)';
    });
    input.addEventListener('blur', () => {
      form.style.borderColor = 'rgba(255,255,255,0.1)';
      form.style.boxShadow = 'none';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const query = input.value.trim();
        if (query) this.navigateFromInput(query);
      }
    });
    form.appendChild(input);

    const engineBtn = document.createElement('div');
    engineBtn.className = 'ntp-engine-btn';
    engineBtn.style.cssText = `
      font-size:12px;color:#94a3b8;padding:6px 10px;border-radius:10px;
      flex-shrink:0;white-space:nowrap;user-select:none;
    `;
    engineBtn.textContent = ENGINE_LABELS[this.searchEngine] ?? this.searchEngine;
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
    const engines: Array<[string, string]> = [
      ['google', 'Google'], ['bing', 'Bing'], ['duckduckgo', 'DuckDuckGo'],
    ];
    for (const [key, label] of engines) {
      const item = document.createElement('div');
      item.className = 'ntp-dropdown-item' + (key === this.searchEngine ? ' active' : '');
      item.textContent = label;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.searchEngine = key;
        if (this.engineLabelEl) this.engineLabelEl.textContent = label;
        this.emit({ kind: 'searchEngineChanged', engine: key });
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
    section.className = 'ntp-fade ntp-fade-d3';
    section.style.cssText = 'width:100%;max-width:500px;margin-bottom:4px;';

    const label = document.createElement('div');
    label.style.cssText = 'font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;padding-left:4px;';
    label.textContent = 'Quick Links';
    section.appendChild(label);

    const grid = document.createElement('div');
    grid.style.cssText = `
      display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:12px;
    `;
    for (const link of DEFAULT_QUICK_LINKS) {
      grid.appendChild(this.createStaticTile(link));
    }
    section.appendChild(grid);
    parent.appendChild(section);
  }

  private createStaticTile(link: NewTabPageLink): HTMLElement {
    const tile = document.createElement('div');
    tile.className = 'ntp-tile';
    tile.style.cssText = `
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:14px 6px 12px;border-radius:12px;cursor:pointer;min-height:72px;
      background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
    `;
    tile.addEventListener('click', () => this.emit({ kind: 'navigate', url: link.url }));

    const icon = document.createElement('div');
    icon.style.cssText = 'font-size:26px;margin-bottom:6px;';
    icon.textContent = link.icon;
    tile.appendChild(icon);

    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'font-size:11px;color:#94a3b8;text-align:center;line-height:1.2;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
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
    label.style.cssText = 'font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;padding-left:4px;';
    label.textContent = 'Frequently Visited';
    this.frequentSection.appendChild(label);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:12px;';

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
    label.style.cssText = 'font-size:11px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;padding-left:4px;';
    label.textContent = 'Bookmarks';
    this.bookmarkSection.appendChild(label);

    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:12px;';

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
    tile.style.cssText = `
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      padding:14px 6px 12px;border-radius:12px;cursor:pointer;min-height:72px;
      background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
      position:relative;
    `;

    const favicon = getFaviconUrl(url);
    const hue = hashToHue(url);

    if (favicon) {
      const img = document.createElement('img');
      img.src = favicon;
      img.style.cssText = 'width:24px;height:24px;border-radius:4px;margin-bottom:6px;object-fit:contain;background:rgba(255,255,255,0.06);';
      img.onerror = () => {
        img.remove();
        const letter = this.createLetterAvatar(title, hue);
        tile.insertBefore(letter, tile.firstChild?.nextSibling ?? null);
      };
      tile.appendChild(img);
    } else {
      tile.appendChild(this.createLetterAvatar(title, hue));
    }

    const labelEl = document.createElement('div');
    labelEl.style.cssText = 'font-size:11px;color:#94a3b8;text-align:center;line-height:1.2;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    labelEl.textContent = title.length > 12 ? title.slice(0, 11) + '\u2026' : title;
    tile.appendChild(labelEl);

    const domain = extractDomain(url);
    if (domain) {
      const domainEl = document.createElement('div');
      domainEl.style.cssText = 'font-size:9px;color:#475569;text-align:center;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;';
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

    document.body.appendChild(menu);
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
    timeEl.style.cssText = 'font-size:12px;color:#475569;';
    this.clockEl = timeEl;
    this.updateClock(timeEl);
    footer.appendChild(timeEl);

    const brand = document.createElement('div');
    brand.style.cssText = 'font-size:10px;color:#334155;margin-top:4px;';
    brand.textContent = 'Nova Browser v1.0.0';
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
      const template = SEARCH_URL_TEMPLATES[this.searchEngine] || SEARCH_URL_TEMPLATES.google;
      this.emit({ kind: 'navigate', url: template.replace('%s', encodeURIComponent(query)) });
    }
  }

  dispose(): void {
    this.unmount();
    this.handlers.length = 0;
  }
}

export { NewTabPage, DEFAULT_QUICK_LINKS, SEARCH_URL_TEMPLATES, ENGINE_LABELS };
export type { INewTabPage, NewTabPageEvent, NewTabPageEventType, NewTabPageLink };
