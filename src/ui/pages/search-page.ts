import type { IDisposable } from '../../app/dependency-container';
import type { SearchHit, SearchOptions } from '../../browser/search/bm25-index';
import type { ArchiveStats } from '../../browser/search/search-archive';
import type { OmniboxResult } from '../../browser/omnibox/omnibox';
import { detectInstantAnswer } from '../../browser/omnibox/instant-answers';
import { searchArchive, mergeResults, paginate } from '../../browser/search/nova-results';
import type { NovaResult, ResultTab, SavedMatches } from '../../browser/search/nova-results';
import { appendRanges } from '../components/highlight';
import { SEARCH_SETTINGS } from '../components/search-subsystem';
import type { SettingsPort } from '../components/search-subsystem';
import { SuggestionsDropdown } from '../components/suggestions-dropdown';
import { createNovaLogo } from '../components/nova-logo';
import { ensureSearchTheme } from './search-theme';

interface SearchPageEngine {
  readonly name: string;
  searchUrl(query: string): string;
}

interface ArchivePort {
  search(query: string, options?: SearchOptions): SearchHit[];
  stats(): ArchiveStats;
  clear(): Promise<void>;
  onChange(handler: () => void): () => void;
}

interface SettingsWritePort extends SettingsPort {
  setValue(key: string, value: unknown): void;
}

interface SearchPageDeps {
  readonly archive: ArchivePort;
  readonly settings: () => SettingsWritePort | null;
  /** Engines offered in the "Search elsewhere" row. */
  readonly webEngines: () => readonly SearchPageEngine[];
  readonly navigate: (url: string, how: { readonly newTab: boolean }) => void;
  /** Search again from this page's own box. */
  readonly search: (query: string) => void;
  readonly research: (query: string) => void;
  /** Bookmarks and history that match (merged into the results when they arrive). */
  readonly saved?: (query: string) => Promise<SavedMatches>;
  /** Suggestion rows for the page's box (the omnibox providers). */
  readonly suggest?: (text: string) => Promise<readonly OmniboxResult[]>;
  readonly now?: () => number;
  /** Clock for the "(0.04 seconds)" line. */
  readonly perfNow?: () => number;
}

const SUGGESTION_PROVIDERS: ReadonlyArray<readonly [string, string]> = [
  ['duckduckgo', 'DuckDuckGo'], ['google', 'Google'], ['bing', 'Bing'], ['brave', 'Brave'], ['wikipedia', 'Wikipedia'],
];

const MAX_ELSEWHERE = 3;

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a calendar date. */
function formatAgo(timestamp: number, now: number): string {
  const s = Math.max(0, Math.round((now - timestamp) / 1000));
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  if (s < 30 * 86_400) return `${Math.round(s / 86_400)} d ago`;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/**
 * `nova://search` — Nova's own search engine: results from the pages you have visited (the personal archive, full text),
 * your bookmarks and your history, with instant answers and Nova AI. No external provider is queried; the "Search elsewhere"
 * row only hands the query to another engine when you click it.
 */
class SearchPage implements IDisposable {
  private container: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private main: HTMLElement | null = null;
  private tabsEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private dropdown: SuggestionsDropdown | null = null;
  private query = '';
  private tab: ResultTab = 'all';
  private page = 1;
  private hits: SearchHit[] = [];
  private elapsedMs = 0;
  private saved: SavedMatches | null = null;
  private savedSeq = 0;
  private unsubscribe: (() => void) | null = null;
  private clearArmed = false;
  private readonly now: () => number;

  constructor(private readonly deps: SearchPageDeps) {
    this.now = deps.now ?? Date.now;
  }

  get isMounted(): boolean { return this.container !== null; }

  mount(container: HTMLElement): void {
    ensureSearchTheme();
    this.container = container;
    container.innerHTML = '';
    container.className = 'ns-root';
    container.style.cssText = '';

    const top = el('header', 'ns-top');
    const logo = el('h1', 'ns-home-logo');
    logo.style.margin = '0';
    logo.title = 'Nova Search';
    logo.setAttribute('aria-label', 'Nova Search');
    logo.append(createNovaLogo(30), el('span', 'ns-sr', 'Nova Search'));

    const pill = el('div', 'ns-pill');
    pill.appendChild(this.searchIcon());
    const input = el('input');
    input.type = 'search';
    input.placeholder = 'Search Nova';
    input.setAttribute('aria-label', 'Search');
    input.autocomplete = 'off';
    const submit = (): void => { const q = input.value.trim(); if (q) this.deps.search(q); };
    const go = el('button', 'ns-go', '→');
    go.type = 'button';
    go.setAttribute('aria-label', 'Search');
    go.addEventListener('click', submit);
    pill.append(input, go);
    if (this.deps.suggest) {
      const suggest = this.deps.suggest;
      this.dropdown = new SuggestionsDropdown(input, pill, {
        fetch: (text) => suggest(text),
        onPick: (row, how) => (row.url ? this.deps.navigate(row.url, how) : this.deps.search(row.text)),
        onSubmit: (text) => this.deps.search(text),
      });
    } else {
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    }
    top.append(logo, pill);

    this.tabsEl = el('nav', 'ns-tabs');
    this.tabsEl.setAttribute('aria-label', 'Result types');
    this.main = el('main', 'ns-results');
    container.append(top, this.tabsEl, this.main);
    this.input = input;
    this.unsubscribe = this.deps.archive.onChange(() => this.renderStatus());
    this.render();
  }

  setQuery(query: string): void {
    this.query = query.trim();
    this.tab = 'all';
    this.page = 1;
    if (this.input) this.input.value = this.query;
    this.runSearch();
    this.render();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.dropdown?.dispose();
    this.dropdown = null;
    this.savedSeq++;
    if (this.container) { this.container.innerHTML = ''; this.container.className = ''; }
    this.container = null;
    this.input = null;
    this.main = null;
    this.tabsEl = null;
    this.statusEl = null;
  }

  // ── searching ─────────────────────────────────────────────────────────────

  private archiveEnabled(): boolean {
    return this.deps.settings()?.getBoolean(SEARCH_SETTINGS.archive, false) ?? false;
  }

  private runSearch(): void {
    this.hits = [];
    this.elapsedMs = 0;
    this.saved = null;
    const mine = ++this.savedSeq;
    if (!this.query) return;
    if (this.deps.archive.stats().documents > 0) {
      const found = searchArchive(this.deps.archive, this.query, this.deps.perfNow);
      this.hits = found.hits;
      this.elapsedMs = found.elapsedMs;
    }
    const saved = this.deps.saved?.(this.query);
    if (!saved) return;
    saved.then((s) => {
      if (mine !== this.savedSeq) return; // a newer query, or the page went away
      this.saved = s;
      this.render();
    }, () => { /* bookmarks/history unavailable: archive results stand */ });
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  private render(): void {
    const main = this.main;
    if (!main) return;
    main.innerHTML = '';
    this.clearArmed = false;
    this.renderTabs();

    if (!this.query) {
      main.appendChild(this.intro());
    } else {
      const answer = detectInstantAnswer(this.query);
      if (answer && this.tab === 'all') main.appendChild(this.answerCard(answer.value, answer.detail));
      const results = mergeResults(this.hits, this.saved, this.tab);
      const pageOf = paginate(results, this.page);
      this.page = pageOf.page;
      main.appendChild(this.stats(pageOf.total));
      if (this.tab === 'all') { const note = this.archiveNote(); if (note) main.appendChild(note); }
      if (pageOf.total === 0) main.appendChild(this.noResults());
      const now = this.now();
      for (const r of pageOf.items) main.appendChild(this.result(r, now));
      if (pageOf.pages > 1) main.appendChild(this.pager(pageOf.page, pageOf.pages));
      main.appendChild(this.elsewhere());
    }
    main.appendChild(this.settingsSection());
  }

  private renderTabs(): void {
    const nav = this.tabsEl;
    if (!nav) return;
    nav.innerHTML = '';
    nav.hidden = !this.query;
    const tabs: ReadonlyArray<readonly [ResultTab, string]> = [['all', 'All'], ['saved', 'Bookmarks & history']];
    for (const [id, label] of tabs) {
      const b = el('button', `ns-tab${this.tab === id ? ' ns-active' : ''}`, label);
      b.type = 'button';
      b.setAttribute('aria-pressed', String(this.tab === id));
      b.addEventListener('click', () => { this.tab = id; this.page = 1; this.render(); });
      nav.appendChild(b);
    }
  }

  private searchIcon(): HTMLElement {
    const span = el('span', 'ns-pill-icon');
    span.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
    return span;
  }

  private button(label: string, onClick: (e: MouseEvent) => void, className = 'ns-btn'): HTMLButtonElement {
    const b = el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  private intro(): HTMLElement {
    const s = el('section');
    s.appendChild(el('h2', 'ns-muted ns-small', 'Search anything'));
    s.appendChild(el('p', 'ns-muted',
      'Nova searches the pages you have visited, your bookmarks and your history. Type a question, a calculation (2+2, 72 f to c), or a color. '
      + 'In the address bar, try @archive to search the full text of visited pages, @tabs for open tabs, @ai to research a question, '
      + 'or !g / !yt / !gh to jump straight to another site’s search.'));
    return s;
  }

  private stats(total: number): HTMLElement {
    const seconds = (this.elapsedMs / 1000).toFixed(2);
    const docs = this.deps.archive.stats().documents;
    return el('p', 'ns-stats',
      `About ${total.toLocaleString('en-US')} result${total === 1 ? '' : 's'} (${seconds} seconds) · ${docs.toLocaleString('en-US')} page${docs === 1 ? '' : 's'} in your Nova index`);
  }

  private answerCard(value: string, detail: string): HTMLElement {
    const card = el('section', 'ns-card');
    card.style.cssText = 'display:flex;align-items:center;gap:16px;margin:0 0 20px;';
    card.setAttribute('aria-label', 'Instant answer');
    const body = el('div');
    body.style.cssText = 'flex:1;min-width:0;';
    const big = el('div', undefined, value);
    big.style.cssText = 'font-size:28px;font-weight:600;word-break:break-all;';
    body.append(el('h2', 'ns-muted ns-small', 'Instant answer'), big, el('div', 'ns-result-meta', detail));
    const copy = this.button('Copy', () => {
      void navigator.clipboard?.writeText(value).then(() => { copy.textContent = 'Copied'; }, () => { /* clipboard unavailable */ });
    });
    card.append(body, copy);
    return card;
  }

  /** Why the archive part is empty (off, or nothing indexed yet), with the switch to turn it on. */
  private archiveNote(): HTMLElement | null {
    if (this.deps.archive.stats().documents > 0) return null;
    const card = el('div', 'ns-card');
    card.style.margin = '0 0 20px';
    if (this.archiveEnabled()) {
      card.appendChild(el('p', 'ns-muted', 'Nothing is indexed yet. Pages you visit from now on will be searchable here.'));
      return card;
    }
    card.appendChild(el('p', 'ns-muted', 'Your personal archive is off. Turn it on to search the full text of pages you visit — it is stored only on '
      + 'this device, and never in private windows or for pages with login forms.'));
    const on = this.button('Turn on personal archive', () => {
      this.deps.settings()?.setValue(SEARCH_SETTINGS.archive, true);
      this.render();
    }, 'ns-btn ns-primary');
    on.style.marginTop = '10px';
    card.appendChild(on);
    return card;
  }

  private noResults(): HTMLElement {
    const p = el('p', 'ns-muted');
    p.append('Your search — ', el('b', undefined, this.query), ' — did not match any pages in your archive, bookmarks or history.');
    if (this.deps.archive.stats().documents > 0) p.append(' No pages in your archive match.');
    return p;
  }

  private open(url: string, e: MouseEvent): void {
    e.preventDefault();
    this.deps.navigate(url, { newTab: e.ctrlKey || e.metaKey || e.button === 1 });
  }

  private result(r: NovaResult, now: number): HTMLElement {
    const article = el('article', 'ns-result');
    const url = el('div', 'ns-result-url');
    if (r.kind !== 'page') url.appendChild(el('span', 'ns-badge', r.kind === 'bookmark' ? 'Bookmark' : 'History'));
    url.appendChild(el('span', undefined, displayUrl(r.url)));

    const link = el('a', 'ns-result-title', r.title);
    link.href = r.url;
    link.addEventListener('click', (e) => this.open(r.url, e));
    link.addEventListener('auxclick', (e) => { if (e.button === 1) this.open(r.url, e); });

    article.append(url, el('br'), link);
    if (r.snippet) {
      const snippet = el('p', 'ns-result-snippet');
      appendRanges(snippet, r.snippet, r.highlights);
      article.appendChild(snippet);
    }
    if (r.visitedAt !== null) article.appendChild(el('span', 'ns-result-meta', `Visited ${formatAgo(r.visitedAt, now)}`));
    return article;
  }

  private pager(page: number, pages: number): HTMLElement {
    const nav = el('nav', 'ns-pager');
    nav.setAttribute('aria-label', 'Result pages');
    const goTo = (n: number): void => { this.page = n; this.render(); this.container?.scrollTo?.({ top: 0 }); };
    const prev = this.button('Previous', () => goTo(page - 1));
    prev.disabled = page <= 1;
    nav.appendChild(prev);
    const first = Math.max(1, Math.min(page - 4, pages - 9));
    for (let n = first; n <= Math.min(pages, first + 9); n++) {
      const b = this.button(String(n), () => goTo(n), n === page ? 'ns-btn ns-primary' : 'ns-btn');
      if (n === page) b.setAttribute('aria-current', 'page');
      nav.appendChild(b);
    }
    const next = this.button('Next', () => goTo(page + 1));
    next.disabled = page >= pages;
    nav.appendChild(next);
    return nav;
  }

  /** One-click hand-offs: nothing is sent to these engines unless the user clicks. */
  private elsewhere(): HTMLElement {
    const row = el('section', 'ns-elsewhere');
    row.setAttribute('aria-label', 'Search elsewhere');
    row.appendChild(el('span', 'ns-muted ns-small', 'Search elsewhere:'));
    // A small row (the plan: Google, DuckDuckGo, Bing): the user's first three engines, in their order.
    for (const engine of this.deps.webEngines().slice(0, MAX_ELSEWHERE)) {
      row.appendChild(this.button(engine.name, (e) => this.deps.navigate(engine.searchUrl(this.query), { newTab: e.ctrlKey || e.metaKey })));
    }
    row.appendChild(this.button('✨ Ask Nova AI', () => this.deps.research(this.query)));
    return row;
  }

  private settingsSection(): HTMLElement {
    const details = el('details', 'ns-settings');
    details.appendChild(el('summary', undefined, 'Search settings'));
    const settings = this.deps.settings();

    const toggle = (key: string, fallback: boolean, label: string, hint: string): HTMLElement => {
      const wrap = el('label');
      wrap.style.cssText = 'display:flex;align-items:flex-start;gap:10px;margin:12px 0;cursor:pointer;';
      const box = el('input');
      box.type = 'checkbox';
      box.checked = settings?.getBoolean(key, fallback) ?? fallback;
      box.addEventListener('change', () => {
        settings?.setValue(key, box.checked);
        if (key === SEARCH_SETTINGS.archive) { this.runSearch(); this.render(); }
      });
      const text = el('span');
      text.append(el('div', undefined, label), el('div', 'ns-result-meta', hint));
      wrap.append(box, text);
      return wrap;
    };

    details.appendChild(toggle(SEARCH_SETTINGS.archive, false, 'Index pages I visit',
      'Lets you search the full text of visited pages. Stored only on this device; skipped in private windows and for pages with password fields.'));
    this.statusEl = el('div', 'ns-result-meta');
    this.statusEl.style.margin = '-4px 0 12px 26px';
    details.appendChild(this.statusEl);
    this.renderStatus();

    const clear = this.button('Clear archive', () => {
      if (!this.clearArmed) {
        this.clearArmed = true;
        clear.textContent = 'Click again to erase everything';
        return;
      }
      this.clearArmed = false;
      clear.textContent = 'Clear archive';
      void this.deps.archive.clear().then(() => { this.runSearch(); this.render(); });
    });
    clear.style.margin = '0 0 18px 26px';
    details.appendChild(clear);

    details.appendChild(toggle(SEARCH_SETTINGS.suggestions, true, 'Show search suggestions',
      'Sends what you type to the provider below as you type. Never sent in private windows, and never for web addresses.'));

    const providerRow = el('label');
    providerRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin:0 0 12px 26px;font-size:13px;';
    providerRow.append('Suggestions provider');
    const select = el('select', 'ns-btn');
    const current = settings?.getString(SEARCH_SETTINGS.suggestionsEngine, 'duckduckgo') || 'duckduckgo';
    for (const [value, label] of SUGGESTION_PROVIDERS) {
      const option = el('option', undefined, label);
      option.value = value;
      option.selected = value === current;
      select.appendChild(option);
    }
    select.addEventListener('change', () => settings?.setValue(SEARCH_SETTINGS.suggestionsEngine, select.value));
    providerRow.appendChild(select);
    details.appendChild(providerRow);

    details.appendChild(toggle(SEARCH_SETTINGS.stripTracking, true, 'Remove tracking parameters from links',
      'Strips utm_*, gclid, fbclid and similar from addresses you open from the address bar.'));
    details.appendChild(toggle(SEARCH_SETTINGS.speculative, true, 'Prepare likely destinations',
      'Resolves the address of a site you are very likely to open before you press Enter. Never in private windows.'));
    return details;
  }

  private renderStatus(): void {
    if (!this.statusEl) return;
    const st = this.deps.archive.stats();
    const parts = [`${st.documents} page${st.documents === 1 ? '' : 's'} indexed`];
    if (st.pending > 0) parts.push(`${st.pending} waiting`);
    if (st.lastError) parts.push(`storage problem: ${st.lastError}`);
    this.statusEl.textContent = parts.join(' · ');
  }
}

export { SearchPage, formatAgo, displayUrl, SUGGESTION_PROVIDERS };
export type { SearchPageDeps, SearchPageEngine, ArchivePort, SettingsWritePort };
