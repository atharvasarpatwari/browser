import type { IDisposable } from '../../app/dependency-container';
import type { SearchHit, SearchOptions } from '../../browser/search/bm25-index';
import type { ArchiveStats } from '../../browser/search/search-archive';
import { detectInstantAnswer } from '../../browser/omnibox/instant-answers';
import { appendRanges } from '../components/highlight';
import { SEARCH_SETTINGS } from '../components/search-subsystem';
import type { SettingsPort } from '../components/search-subsystem';

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
  /** Engines offered as "search the web with…" buttons. */
  readonly webEngines: () => readonly SearchPageEngine[];
  readonly navigate: (url: string, how: { readonly newTab: boolean }) => void;
  /** Search again from this page's own box. */
  readonly search: (query: string) => void;
  readonly research: (query: string) => void;
  readonly now?: () => number;
}

const SUGGESTION_PROVIDERS: ReadonlyArray<readonly [string, string]> = [
  ['duckduckgo', 'DuckDuckGo'], ['google', 'Google'], ['bing', 'Bing'], ['brave', 'Brave'], ['wikipedia', 'Wikipedia'],
];

const MAX_ARCHIVE_HITS = 20;

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

const STYLE = {
  root: 'display:flex;flex-direction:column;height:100%;overflow:auto;font-family:system-ui,-apple-system,sans-serif;background:var(--bg-body,#0f0f0f);color:var(--text-primary,#e0e0e0);',
  header: 'padding:20px 24px 12px;border-bottom:1px solid var(--border-subtle,rgba(255,255,255,.06));background:var(--bg-surface,#161618);',
  row: 'display:flex;gap:8px;margin-top:12px;max-width:720px;',
  input: 'flex:1;padding:10px 14px;border:1px solid var(--border-subtle,rgba(255,255,255,.1));border-radius:6px;background:var(--bg-body,#0f0f0f);color:var(--text-primary,#e0e0e0);font-size:14px;outline:none;',
  button: 'padding:8px 14px;border:1px solid var(--border-subtle,rgba(255,255,255,.12));border-radius:6px;background:var(--bg-surface,#161618);color:var(--text-primary,#e0e0e0);font-size:13px;cursor:pointer;',
  main: 'padding:16px 24px 32px;max-width:760px;',
  section: 'margin:0 0 24px;',
  heading: 'margin:0 0 10px;font-size:12px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--text-secondary,#a0a098);',
  muted: 'margin:0;font-size:13px;line-height:1.5;color:var(--text-secondary,#a0a098);',
  card: 'padding:14px 16px;border:1px solid var(--border-subtle,rgba(255,255,255,.08));border-radius:8px;background:var(--bg-surface,#161618);',
  hitTitle: 'font-size:16px;color:var(--accent,#9bb5ff);text-decoration:none;cursor:pointer;',
  hitUrl: 'font-size:12px;color:var(--text-secondary,#a0a098);margin:2px 0 4px;',
  hitSnippet: 'margin:0;font-size:13px;line-height:1.5;color:var(--text-primary,#e0e0e0);',
  hitMeta: 'font-size:11px;color:var(--text-secondary,#a0a098);',
};

/** `nova://search` — the browser's own search: instant answers, your personal archive, and web-search shortcuts. */
class SearchPage implements IDisposable {
  private container: HTMLElement | null = null;
  private input: HTMLInputElement | null = null;
  private main: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private query = '';
  private unsubscribe: (() => void) | null = null;
  private clearArmed = false;
  private readonly now: () => number;

  constructor(private readonly deps: SearchPageDeps) {
    this.now = deps.now ?? Date.now;
  }

  get isMounted(): boolean { return this.container !== null; }

  mount(container: HTMLElement): void {
    this.container = container;
    container.style.cssText = STYLE.root;
    container.innerHTML = '';

    const header = document.createElement('div');
    header.style.cssText = STYLE.header;
    const title = document.createElement('h1');
    title.textContent = 'Nova Search';
    title.style.cssText = 'margin:0 0 4px;font-size:20px;font-weight:600;';
    const subtitle = document.createElement('p');
    subtitle.textContent = 'Instant answers, the full text of pages you have visited, and the web — in one place.';
    subtitle.style.cssText = STYLE.muted;
    const row = document.createElement('div');
    row.style.cssText = STYLE.row;
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search';
    input.setAttribute('aria-label', 'Search');
    input.style.cssText = STYLE.input;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) this.deps.search(input.value.trim());
    });
    const go = this.button('Search', () => { if (input.value.trim()) this.deps.search(input.value.trim()); });
    row.append(input, go);
    header.append(title, subtitle, row);

    this.main = document.createElement('div');
    this.main.style.cssText = STYLE.main;
    container.append(header, this.main);
    this.input = input;
    this.unsubscribe = this.deps.archive.onChange(() => this.renderStatus());
    this.render();
  }

  setQuery(query: string): void {
    this.query = query.trim();
    if (this.input) this.input.value = this.query;
    this.render();
  }

  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.container) this.container.innerHTML = '';
    this.container = null;
    this.input = null;
    this.main = null;
    this.statusEl = null;
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  private render(): void {
    const main = this.main;
    if (!main) return;
    main.innerHTML = '';
    this.clearArmed = false;

    if (!this.query) {
      main.appendChild(this.intro());
    } else {
      const answer = detectInstantAnswer(this.query);
      if (answer) main.appendChild(this.answerCard(answer.value, answer.detail));
      main.appendChild(this.archiveSection());
      main.appendChild(this.webSection());
    }
    main.appendChild(this.settingsSection());
  }

  private section(heading: string): HTMLElement {
    const s = document.createElement('section');
    s.style.cssText = STYLE.section;
    const h = document.createElement('h2');
    h.textContent = heading;
    h.style.cssText = STYLE.heading;
    s.appendChild(h);
    return s;
  }

  private button(label: string, onClick: (e: MouseEvent) => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = STYLE.button;
    b.addEventListener('click', onClick);
    return b;
  }

  private intro(): HTMLElement {
    const s = this.section('Search anything');
    const p = document.createElement('p');
    p.style.cssText = STYLE.muted;
    p.textContent = 'Type a question, a calculation (2+2, 72 f to c), or a color. In the address bar, try @archive to search the full '
      + 'text of pages you have visited, @tabs for open tabs, @ai to research a question, or !g / !yt / !gh to jump straight to another site’s search.';
    s.appendChild(p);
    return s;
  }

  private answerCard(value: string, detail: string): HTMLElement {
    const s = this.section('Instant answer');
    const card = document.createElement('div');
    card.style.cssText = `${STYLE.card}display:flex;align-items:center;gap:16px;`;
    const body = document.createElement('div');
    body.style.cssText = 'flex:1;min-width:0;';
    const big = document.createElement('div');
    big.textContent = value;
    big.style.cssText = 'font-size:28px;font-weight:600;word-break:break-all;';
    const small = document.createElement('div');
    small.textContent = detail;
    small.style.cssText = STYLE.hitMeta;
    body.append(big, small);
    const copy = this.button('Copy', () => {
      void navigator.clipboard?.writeText(value).then(() => { copy.textContent = 'Copied'; }, () => { /* clipboard unavailable */ });
    });
    card.append(body, copy);
    s.appendChild(card);
    return s;
  }

  private archiveSection(): HTMLElement {
    const s = this.section('From your archive');
    const stats = this.deps.archive.stats();
    const enabled = this.deps.settings()?.getBoolean(SEARCH_SETTINGS.archive, false) ?? false;
    const note = (text: string): void => {
      const p = document.createElement('p');
      p.style.cssText = STYLE.muted;
      p.textContent = text;
      s.appendChild(p);
    };

    if (stats.documents === 0) {
      if (enabled) {
        note('Nothing is indexed yet. Pages you visit from now on will be searchable here.');
      } else {
        note('Your personal archive is off. Turn it on to search the full text of pages you visit — it is stored only on this device, '
          + 'and never in private windows or for pages with login forms.');
        const on = this.button('Turn on personal archive', () => {
          this.deps.settings()?.setValue(SEARCH_SETTINGS.archive, true);
          this.render();
        });
        on.style.cssText += 'margin-top:10px;';
        s.appendChild(on);
      }
      return s;
    }

    const hits = this.deps.archive.search(this.query, { limit: MAX_ARCHIVE_HITS, prefix: false });
    if (hits.length === 0) {
      note('No pages in your archive match.');
      return s;
    }
    const now = this.now();
    for (const hit of hits) s.appendChild(this.hit(hit, now));
    return s;
  }

  private hit(hit: SearchHit, now: number): HTMLElement {
    const el = document.createElement('article');
    el.style.cssText = 'margin:0 0 16px;';

    const link = document.createElement('a');
    link.textContent = hit.title || hit.url;
    link.href = hit.url;
    link.style.cssText = STYLE.hitTitle;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      this.deps.navigate(hit.url, { newTab: e.ctrlKey || e.metaKey });
    });
    link.addEventListener('auxclick', (e) => {
      if (e.button === 1) { e.preventDefault(); this.deps.navigate(hit.url, { newTab: true }); }
    });

    const url = document.createElement('div');
    url.textContent = displayUrl(hit.url);
    url.style.cssText = STYLE.hitUrl;

    const snippet = document.createElement('p');
    snippet.style.cssText = STYLE.hitSnippet;
    appendRanges(snippet, hit.snippet, hit.highlights);

    const meta = document.createElement('span');
    meta.textContent = `Visited ${formatAgo(hit.visitedAt, now)}`;
    meta.style.cssText = STYLE.hitMeta;

    el.append(link, url, snippet, meta);
    return el;
  }

  private webSection(): HTMLElement {
    const s = this.section('Search the web');
    const chips = document.createElement('div');
    chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;';
    for (const engine of this.deps.webEngines()) {
      chips.appendChild(this.button(engine.name, (e) => {
        this.deps.navigate(engine.searchUrl(this.query), { newTab: e.ctrlKey || e.metaKey });
      }));
    }
    chips.appendChild(this.button('✨ Ask Nova AI', () => this.deps.research(this.query)));
    s.appendChild(chips);
    return s;
  }

  private settingsSection(): HTMLElement {
    const s = this.section('Search settings');
    const settings = this.deps.settings();

    const toggle = (key: string, fallback: boolean, label: string, hint: string): HTMLElement => {
      const wrap = document.createElement('label');
      wrap.style.cssText = 'display:flex;align-items:flex-start;gap:10px;margin:0 0 12px;cursor:pointer;';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = settings?.getBoolean(key, fallback) ?? fallback;
      box.addEventListener('change', () => {
        settings?.setValue(key, box.checked);
        if (key === SEARCH_SETTINGS.archive) this.render();
      });
      const text = document.createElement('span');
      const title = document.createElement('div');
      title.textContent = label;
      title.style.cssText = 'font-size:13px;';
      const small = document.createElement('div');
      small.textContent = hint;
      small.style.cssText = STYLE.hitMeta;
      text.append(title, small);
      wrap.append(box, text);
      return wrap;
    };

    s.appendChild(toggle(SEARCH_SETTINGS.archive, false, 'Index pages I visit',
      'Lets you search the full text of visited pages. Stored only on this device; skipped in private windows and for pages with password fields.'));
    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = `${STYLE.hitMeta}margin:-4px 0 12px 26px;`;
    s.appendChild(this.statusEl);
    this.renderStatus();

    const clear = this.button('Clear archive', () => {
      if (!this.clearArmed) {
        this.clearArmed = true;
        clear.textContent = 'Click again to erase everything';
        return;
      }
      this.clearArmed = false;
      clear.textContent = 'Clear archive';
      void this.deps.archive.clear().then(() => this.render());
    });
    clear.style.cssText += 'margin:0 0 18px 26px;';
    s.appendChild(clear);

    s.appendChild(toggle(SEARCH_SETTINGS.suggestions, true, 'Show search suggestions',
      'Sends what you type to the provider below as you type. Never sent in private windows, and never for web addresses.'));

    const providerRow = document.createElement('label');
    providerRow.style.cssText = 'display:flex;align-items:center;gap:10px;margin:0 0 12px 26px;font-size:13px;';
    providerRow.append('Suggestions provider');
    const select = document.createElement('select');
    select.style.cssText = STYLE.input.replace('flex:1;', '') + 'padding:6px 8px;';
    const current = settings?.getString(SEARCH_SETTINGS.suggestionsEngine, 'duckduckgo') || 'duckduckgo';
    for (const [value, label] of SUGGESTION_PROVIDERS) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = value === current;
      select.appendChild(option);
    }
    select.addEventListener('change', () => settings?.setValue(SEARCH_SETTINGS.suggestionsEngine, select.value));
    providerRow.appendChild(select);
    s.appendChild(providerRow);

    s.appendChild(toggle(SEARCH_SETTINGS.stripTracking, true, 'Remove tracking parameters from links',
      'Strips utm_*, gclid, fbclid and similar from addresses you open from the address bar.'));
    s.appendChild(toggle(SEARCH_SETTINGS.speculative, true, 'Prepare likely destinations',
      'Resolves the address of a site you are very likely to open before you press Enter. Never in private windows.'));
    return s;
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
