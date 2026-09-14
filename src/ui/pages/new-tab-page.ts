import type { IDisposable } from '../../app/dependency-container';
import type { BookmarkEntry } from '../../browser/storage/bookmark-store';
import type { HistoryEntry } from '../../browser/storage/history-store';

// ── Event types ───────────────────────────────────────────────────────────

type NewTabPageEventType = 'navigate' | 'tileAction' | 'searchEngineChanged';

interface NewTabPageEvent {
  readonly kind: NewTabPageEventType;
  readonly url?: string;
  readonly action?: 'openInNewTab' | 'remove' | 'add';
  readonly engine?: string;
  /** Present on an 'add' tileAction — the name the user typed for the new tile. */
  readonly title?: string;
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

/** A single tile in the bookmarks rail or the quick-links grid. */
interface Tile {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  /** Bookmarks can be removed from the quick-links grid; frequently-visited
   *  history tiles are read-only (removing them wouldn't delete history). */
  readonly removable: boolean;
}

const SEARCH_URL_TEMPLATES: Record<string, string> = {
  google: 'https://www.google.com/search?q=%s',
  bing: 'https://www.bing.com/search?q=%s',
  duckduckgo: 'https://duckduckgo.com/?q=%s',
};

const PAGE_SIZE = 6; // quick-link tiles per carousel page
const MAX_RAIL_ITEMS = 12;
const MAX_HISTORY_TILES = 6;

// ── Styles (injected once) ────────────────────────────────────────────────

let stylesInjected = false;
function injectStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;

  const fontLink = document.createElement('link');
  fontLink.rel = 'stylesheet';
  fontLink.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap';
  document.head.appendChild(fontLink);

  const style = document.createElement('style');
  style.textContent = `
    .ntp-root{ --ntp-surface-0:#f3f2fa; --ntp-surface-1:rgba(255,255,255,0.66); --ntp-surface-1-hover:rgba(255,255,255,0.9);
      --ntp-border:rgba(35,32,68,0.11); --ntp-ink-1:#1a1830; --ntp-ink-2:#5c5975; --ntp-ink-3:#8a87a3;
      --ntp-accent:#6c5ce7; --ntp-accent-ink:#ffffff; --ntp-accent-2:#ff6f91;
      --ntp-blob-a:108,92,231; --ntp-blob-b:255,111,145; --ntp-blob-c:31,174,122;
      --ntp-shadow:0 20px 60px -25px rgba(35,32,68,0.35);
      color-scheme: light dark; }
    @media (prefers-color-scheme: dark){ .ntp-root:not([data-ntp-theme="light"]){
      --ntp-surface-0:#0b0a16; --ntp-surface-1:rgba(255,255,255,0.055); --ntp-surface-1-hover:rgba(255,255,255,0.1);
      --ntp-border:rgba(255,255,255,0.11); --ntp-ink-1:#f1f0fb; --ntp-ink-2:#a6a3c4; --ntp-ink-3:#726f92;
      --ntp-accent:#9587ff; --ntp-accent-ink:#ffffff; --ntp-accent-2:#ff86ab;
      --ntp-blob-a:149,135,255; --ntp-blob-b:255,134,171; --ntp-blob-c:63,224,165;
      --ntp-shadow:0 20px 60px -20px rgba(0,0,0,0.55); } }
    .ntp-root[data-ntp-theme="dark"]{
      --ntp-surface-0:#0b0a16; --ntp-surface-1:rgba(255,255,255,0.055); --ntp-surface-1-hover:rgba(255,255,255,0.1);
      --ntp-border:rgba(255,255,255,0.11); --ntp-ink-1:#f1f0fb; --ntp-ink-2:#a6a3c4; --ntp-ink-3:#726f92;
      --ntp-accent:#9587ff; --ntp-accent-ink:#ffffff; --ntp-accent-2:#ff86ab;
      --ntp-blob-a:149,135,255; --ntp-blob-b:255,134,171; --ntp-blob-c:63,224,165;
      --ntp-shadow:0 20px 60px -20px rgba(0,0,0,0.55); }

    .ntp-root{ position:relative; width:100%; height:100%; overflow-y:auto; overflow-x:hidden;
      background:var(--ntp-surface-0); color:var(--ntp-ink-1); font-family:'IBM Plex Sans',system-ui,sans-serif;
      -webkit-font-smoothing:antialiased; box-sizing:border-box; }
    .ntp-root *{ box-sizing:border-box; }
    .ntp-root [hidden]{ display:none !important; }

    .ntp-glow{ position:absolute; inset:0; overflow:hidden; z-index:0; pointer-events:none; }
    .ntp-glow-blob{ position:absolute; width:46vw; height:46vw; max-width:620px; max-height:620px; border-radius:50%; filter:blur(70px); opacity:.38; }
    .ntp-glow-blob.a{ background:rgb(var(--ntp-blob-a)); top:-12%; left:-8%; animation:ntpDrift1 26s ease-in-out infinite; }
    .ntp-glow-blob.b{ background:rgb(var(--ntp-blob-b)); bottom:-16%; right:-10%; animation:ntpDrift2 30s ease-in-out infinite; }
    .ntp-glow-blob.c{ background:rgb(var(--ntp-blob-c)); top:30%; right:18%; width:30vw; height:30vw; opacity:.24; animation:ntpDrift3 34s ease-in-out infinite; }
    @keyframes ntpDrift1{ 0%,100%{ transform:translate(0,0); } 50%{ transform:translate(4%,6%); } }
    @keyframes ntpDrift2{ 0%,100%{ transform:translate(0,0); } 50%{ transform:translate(-5%,-4%); } }
    @keyframes ntpDrift3{ 0%,100%{ transform:translate(0,0) scale(1); } 50%{ transform:translate(-3%,5%) scale(1.06); } }
    @media (prefers-reduced-motion:reduce){ .ntp-glow-blob{ animation:none !important; } }

    .ntp-shell{ position:relative; z-index:1; max-width:880px; margin:0 auto; padding:clamp(28px,6vw,56px) 20px 40px;
      display:flex; flex-direction:column; gap:26px; min-height:100%; }

    .ntp-rail{ display:flex; gap:8px; overflow-x:auto; padding:4px 2px 10px; scrollbar-width:none;
      -webkit-mask-image:linear-gradient(90deg,transparent 0,#000 24px,#000 calc(100% - 24px),transparent 100%);
      mask-image:linear-gradient(90deg,transparent 0,#000 24px,#000 calc(100% - 24px),transparent 100%); }
    .ntp-rail::-webkit-scrollbar{ display:none; }
    .ntp-chip{ flex:0 0 auto; display:flex; align-items:center; gap:8px; background:var(--ntp-surface-1);
      border:1px solid var(--ntp-border); border-radius:999px; padding:7px 14px 7px 7px; color:var(--ntp-ink-1);
      font-size:13px; font-weight:500; cursor:pointer; transition:background .15s ease,transform .15s ease; font-family:inherit; }
    .ntp-chip:hover, .ntp-chip:focus-visible{ background:var(--ntp-surface-1-hover); transform:translateY(-1px); }
    .ntp-chip .ntp-avatar{ width:22px; height:22px; font-size:10px; border-radius:7px; }

    .ntp-hero{ display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
    .ntp-clock{ font-family:'Outfit',system-ui,sans-serif; font-weight:600; font-size:clamp(46px,9vw,84px);
      line-height:1; letter-spacing:-0.02em; font-variant-numeric:tabular-nums; }
    .ntp-date{ margin-top:6px; color:var(--ntp-ink-2); font-size:14px; }
    .ntp-icon-btn{ display:flex; align-items:center; gap:8px; background:var(--ntp-surface-1); border:1px solid var(--ntp-border);
      color:var(--ntp-ink-1); border-radius:999px; padding:10px 16px 10px 12px; font-family:inherit; font-size:13px;
      font-weight:500; cursor:pointer; transition:background .15s ease,color .15s ease; }
    .ntp-icon-btn svg{ width:16px; height:16px; }
    .ntp-icon-btn:hover, .ntp-icon-btn:focus-visible{ background:var(--ntp-surface-1-hover); }
    .ntp-icon-btn[aria-pressed="true"]{ background:var(--ntp-accent); color:var(--ntp-accent-ink); border-color:transparent; }

    .ntp-panel{ background:var(--ntp-surface-1); border:1px solid var(--ntp-border); border-radius:24px;
      box-shadow:var(--ntp-shadow); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); }

    .ntp-ql-card{ padding:18px 18px 8px; }
    .ntp-ql-viewport{ overflow:hidden; border-radius:16px; }
    .ntp-ql-track{ display:flex; transition:transform .5s cubic-bezier(.65,0,.35,1); }
    @media (prefers-reduced-motion:reduce){ .ntp-ql-track{ transition:none; } }
    .ntp-ql-page{ flex:0 0 auto; min-width:0; display:grid; grid-template-columns:repeat(auto-fit,minmax(84px,1fr));
      gap:6px; align-content:start; }
    .ntp-tile{ position:relative; display:flex; flex-direction:column; align-items:center; gap:8px; background:transparent;
      border:none; border-radius:16px; padding:12px 6px 10px; cursor:pointer; color:var(--ntp-ink-1); font-family:inherit; width:100%; }
    .ntp-tile:hover, .ntp-tile:focus-visible{ background:var(--ntp-surface-1-hover); }
    .ntp-tile .ntp-label{ font-size:12.5px; font-weight:500; text-align:center; max-width:84px; overflow:hidden;
      text-overflow:ellipsis; white-space:nowrap; }
    .ntp-avatar{ width:52px; height:52px; border-radius:16px; display:flex; align-items:center; justify-content:center;
      color:#fff; font-family:'Outfit',sans-serif; font-weight:600; font-size:17px; flex-shrink:0; overflow:hidden; }
    .ntp-avatar img{ width:100%; height:100%; object-fit:cover; }
    .ntp-tile.ntp-add .ntp-avatar{ background:transparent; border:1.6px dashed var(--ntp-ink-3); color:var(--ntp-ink-3); }
    .ntp-tile.ntp-add .ntp-label{ color:var(--ntp-ink-2); }
    .ntp-remove-btn{ display:none; position:absolute; top:2px; right:10px; width:20px; height:20px; border-radius:50%;
      background:var(--ntp-ink-1); color:var(--ntp-surface-0); border:none; align-items:center; justify-content:center; cursor:pointer; }
    .ntp-remove-btn svg{ width:11px; height:11px; }
    .ntp-shell.ntp-edit-mode .ntp-tile.ntp-removable .ntp-remove-btn{ display:flex; }
    .ntp-shell.ntp-edit-mode .ntp-tile.ntp-removable .ntp-avatar{ outline:2px solid var(--ntp-accent-2); outline-offset:2px; }

    .ntp-dots{ display:flex; justify-content:center; gap:6px; padding:12px 0 4px; }
    .ntp-dot{ width:6px; height:6px; padding:0; border-radius:999px; border:none; background:var(--ntp-ink-3); opacity:.5;
      cursor:pointer; transition:width .2s ease,background .2s ease,opacity .2s ease; }
    .ntp-dot.active{ width:18px; background:var(--ntp-accent); opacity:1; }

    .ntp-search-pill{ display:flex; align-items:center; gap:10px; padding:15px 20px; border-radius:999px; }
    .ntp-search-pill svg{ width:18px; height:18px; color:var(--ntp-ink-2); flex-shrink:0; }
    .ntp-search-pill input{ flex:1; min-width:0; background:transparent; border:none; outline:none; color:var(--ntp-ink-1);
      font-family:inherit; font-size:15.5px; }
    .ntp-search-pill input::placeholder{ color:var(--ntp-ink-3); }

    .ntp-insight-card{ padding:6px 6px 4px; }
    .ntp-insight-viewport{ overflow:hidden; border-radius:18px; }
    .ntp-insight-track{ display:flex; align-items:stretch; transition:transform .5s cubic-bezier(.65,0,.35,1); }
    @media (prefers-reduced-motion:reduce){ .ntp-insight-track{ transition:none; } }
    .ntp-insight-slide{ flex:0 0 auto; min-width:0; padding:22px 22px 20px; display:flex; flex-direction:column; gap:10px; }
    .ntp-insight-slide h3{ margin:0; font-size:16px; font-weight:600; letter-spacing:-0.01em; }
    .ntp-insight-slide p{ margin:0; font-size:13.8px; line-height:1.55; color:var(--ntp-ink-2); max-width:62ch; }
    .ntp-insight-slide code.ntp-formula{ font-family:'IBM Plex Mono',ui-monospace,monospace; background:var(--ntp-surface-1-hover);
      border:1px solid var(--ntp-border); padding:2px 7px; border-radius:6px; font-size:12.5px; }

    .ntp-stats{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:12px; }
    .ntp-stat-card{ padding:16px 18px; display:flex; flex-direction:column; gap:10px; }
    .ntp-stat-card svg{ width:18px; height:18px; color:var(--ntp-accent); }
    .ntp-stat-value{ font-family:'Outfit',sans-serif; font-weight:600; font-size:26px; font-variant-numeric:tabular-nums; letter-spacing:-0.01em; }
    .ntp-stat-label{ font-size:11.5px; color:var(--ntp-ink-2); text-transform:uppercase; letter-spacing:.05em; }

    .ntp-footnote{ text-align:center; font-size:12px; color:var(--ntp-ink-3); padding-top:4px; }

    .ntp-popover-backdrop{ position:absolute; inset:0; z-index:10; background:rgba(10,9,20,0.45); display:flex;
      align-items:center; justify-content:center; padding:20px; }
    .ntp-popover{ width:100%; max-width:340px; background:var(--ntp-surface-0); border:1px solid var(--ntp-border);
      border-radius:20px; padding:22px; display:flex; flex-direction:column; gap:14px; box-shadow:var(--ntp-shadow); }
    .ntp-popover h2{ margin:0; font-size:17px; font-weight:600; }
    .ntp-popover label{ display:flex; flex-direction:column; gap:6px; font-size:12.5px; color:var(--ntp-ink-2); font-weight:500; }
    .ntp-popover input{ font-family:inherit; font-size:14.5px; color:var(--ntp-ink-1); background:var(--ntp-surface-1);
      border:1px solid var(--ntp-border); border-radius:10px; padding:10px 12px; outline:none; }
    .ntp-popover input:focus-visible{ border-color:var(--ntp-accent); }
    .ntp-popover-actions{ display:flex; justify-content:flex-end; gap:10px; margin-top:4px; }
    .ntp-popover-actions button{ font-family:inherit; font-size:13.5px; font-weight:500; border-radius:999px; padding:9px 16px;
      cursor:pointer; border:1px solid var(--ntp-border); background:var(--ntp-surface-1); color:var(--ntp-ink-1); }
    .ntp-popover-actions button[type="submit"]{ background:var(--ntp-accent); color:var(--ntp-accent-ink); border-color:transparent; }

    .ntp-toast{ position:absolute; left:50%; bottom:26px; transform:translate(-50%,12px); background:var(--ntp-ink-1);
      color:var(--ntp-surface-0); font-size:13px; font-weight:500; padding:10px 18px; border-radius:999px; opacity:0;
      transition:opacity .25s ease,transform .25s ease; pointer-events:none; z-index:20; white-space:nowrap; max-width:90vw;
      overflow:hidden; text-overflow:ellipsis; }
    .ntp-toast.show{ opacity:1; transform:translate(-50%,0); }

    .ntp-root :focus-visible{ outline:2px solid var(--ntp-accent); outline-offset:2px; }

    @media (max-width:480px){
      .ntp-clock{ font-size:52px; }
      .ntp-hero{ align-items:flex-start; }
      .ntp-icon-btn span{ display:none; }
      .ntp-icon-btn{ padding:10px; }
    }
  `;
  document.head.appendChild(style);
}

// ── Small helpers ─────────────────────────────────────────────────────────

function hashHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h % 360;
}
function avatarBg(name: string): string {
  const hue = hashHue(name);
  return `background: linear-gradient(135deg, hsl(${hue} 68% 56%), hsl(${(hue + 42) % 360} 68% 46%));`;
}
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(w => w[0] ? w[0].toUpperCase() : '').join('') || '?';
}
function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}
function chunk<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out.length ? out : [[]];
}
function clamp(n: number, min: number, max: number): number { return Math.max(min, Math.min(max, n)); }
function pad(n: number): string { return String(n).padStart(2, '0'); }
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const ADD_TILE_ID = '__add__';

// ── Insight carousel content ──────────────────────────────────────────────
// Unlike a static demo, these tiles are actually true of the page below:
// the quick-links grid really is your bookmarks, pagination really is
// computed from how many you have, and Customize really does add/remove
// real, persistent bookmarks (not a separate local-only list).

const INSIGHTS: ReadonlyArray<{ title: string; body: string }> = [
  {
    title: 'Quick links are your real bookmarks',
    body: `<p>Every tile in the grid below is a bookmark, and the rail above is the same list in compact form. Add a tile with the <strong>+</strong> button and it becomes a bookmark you'll see anywhere bookmarks show up in Nova &mdash; remove one here and it's gone everywhere else too.</p>`,
  },
  {
    title: 'Pagination counts itself',
    body: `<p>The grid doesn't have a fixed number of pages &mdash; it divides however many tiles you have into groups and draws exactly that many dots.</p>
      <p><code class="ntp-formula">pages = Math.ceil(items.length / ${PAGE_SIZE})</code> &mdash; add enough tiles to overflow the current page and a new dot appears on its own.</p>`,
  },
  {
    title: 'Frequently visited, without saving it',
    body: `<p>A few tiles alongside your bookmarks come from pages you actually visit a lot &mdash; no remove button, since clearing one wouldn't erase your history. Everything else is <strong>Customize tiles</strong> away from being rearranged.</p>`,
  },
];

// ── Main class ────────────────────────────────────────────────────────────

type NewTabPageEventHandler = (event: NewTabPageEvent) => void;

class NewTabPage implements INewTabPage {
  // Keyed by event kind — a flat list (as this used to be) delivered every
  // event to every handler regardless of which kind it was registered for,
  // since emit() never checked event.kind against anything. That meant a
  // 'tileAction' with a url field (e.g. adding a tile) also fired the
  // 'navigate' handler, silently navigating the tab away whenever a tile
  // was added or removed.
  private readonly handlers = new Map<NewTabPageEventType, Set<NewTabPageEventHandler>>();
  private container: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private _mounted = false;

  // Data supplied by the host (browser-window.ts).
  private bookmarks: readonly BookmarkEntry[] = [];
  private historyEntries: readonly HistoryEntry[] = [];
  private searchEngine = 'google';

  // View state.
  private editMode = false;
  private qlPage = 0;
  private insightIndex = 0;
  private readonly launchedAt = Date.now();
  /** Bookmark ids removed locally while waiting for the host to confirm via a fresh setBookmarks(). */
  private readonly pendingRemoveIds = new Set<string>();

  // Timers.
  private insightTimer: ReturnType<typeof setInterval> | null = null;
  private sessionTimer: ReturnType<typeof setInterval> | null = null;

  // Cached element refs (scoped to this instance's container, never the whole document).
  private els: {
    rail: HTMLElement; clockTime: HTMLElement; clockDate: HTMLElement; editToggle: HTMLButtonElement;
    qlTrack: HTMLElement; qlDots: HTMLElement; searchInput: HTMLInputElement;
    insightTrack: HTMLElement; insightDots: HTMLElement; statsStrip: HTMLElement;
    popoverBackdrop: HTMLElement; addName: HTMLInputElement; addUrl: HTMLInputElement;
    toast: HTMLElement; shell: HTMLElement;
  } | null = null;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private outsidePointerHandler: ((e: PointerEvent) => void) | null = null;

  get isMounted(): boolean { return this._mounted; }

  // ── Lifecycle ────────────────────────────────────────────────────────

  mount(container: HTMLElement): void {
    injectStyles();
    this.container = container;
    container.innerHTML = '';

    const root = document.createElement('div');
    root.className = 'ntp-root';
    root.innerHTML = `
      <div class="ntp-glow" aria-hidden="true">
        <div class="ntp-glow-blob a"></div>
        <div class="ntp-glow-blob b"></div>
        <div class="ntp-glow-blob c"></div>
      </div>
      <div class="ntp-shell" data-role="shell">
        <nav class="ntp-rail" data-role="rail" aria-label="Bookmarks"></nav>
        <section class="ntp-hero">
          <div>
            <div class="ntp-clock" data-role="clock-time">--:--</div>
            <div class="ntp-date" data-role="clock-date">&nbsp;</div>
          </div>
          <button class="ntp-icon-btn" type="button" data-role="edit-toggle" aria-pressed="false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="7" cy="18" r="2"/></svg>
            <span>Customize tiles</span>
          </button>
        </section>
        <section class="ntp-ql-card ntp-panel">
          <div class="ntp-ql-viewport" data-role="ql-viewport">
            <div class="ntp-ql-track" data-role="ql-track"></div>
          </div>
          <div class="ntp-dots" data-role="ql-dots"></div>
        </section>
        <section>
          <form class="ntp-search-pill ntp-panel" data-role="search-form">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" autocomplete="off" placeholder="Search the web, or enter a URL" aria-label="Search the web" data-role="search-input">
          </form>
        </section>
        <section class="ntp-insight-card ntp-panel">
          <div class="ntp-insight-viewport" data-role="insight-viewport">
            <div class="ntp-insight-track" data-role="insight-track"></div>
          </div>
          <div class="ntp-dots" data-role="insight-dots"></div>
        </section>
        <section class="ntp-stats" data-role="stats"></section>
        <footer class="ntp-footnote">Nova Browser &middot; new tab</footer>
      </div>
      <div class="ntp-popover-backdrop" data-role="popover-backdrop" hidden>
        <form class="ntp-popover" data-role="add-form">
          <h2>Add a tile</h2>
          <label>Name
            <input data-role="add-name" required maxlength="18" placeholder="e.g. Team Wiki">
          </label>
          <label>Link
            <input data-role="add-url" type="text" inputmode="url" required placeholder="https://example.com or example.com">
          </label>
          <div class="ntp-popover-actions">
            <button type="button" data-role="add-cancel">Cancel</button>
            <button type="submit">Add tile</button>
          </div>
        </form>
      </div>
      <div class="ntp-toast" data-role="toast" role="status" aria-live="polite"></div>
    `;
    container.appendChild(root);
    this.root = root;

    const q = <T extends HTMLElement>(role: string): T => root.querySelector(`[data-role="${role}"]`) as T;
    this.els = {
      rail: q('rail'), clockTime: q('clock-time'), clockDate: q('clock-date'), editToggle: q('edit-toggle'),
      qlTrack: q('ql-track'), qlDots: q('ql-dots'), searchInput: q('search-input'),
      insightTrack: q('insight-track'), insightDots: q('insight-dots'), statsStrip: q('stats'),
      popoverBackdrop: q('popover-backdrop'), addName: q('add-name'), addUrl: q('add-url'),
      toast: q('toast'), shell: q('shell'),
    };

    this.wireStaticEvents();
    this.updateClock();
    this.sessionTimer = setInterval(() => this.updateClock(), 1000);
    this.renderRail();
    this.renderQuickLinks();
    this.renderInsights();
    this.resetInsightTimer();

    this._mounted = true;
  }

  unmount(): void {
    if (this.sessionTimer) { clearInterval(this.sessionTimer); this.sessionTimer = null; }
    if (this.insightTimer) { clearInterval(this.insightTimer); this.insightTimer = null; }
    if (this.toastTimer) { clearTimeout(this.toastTimer); this.toastTimer = null; }
    if (this.outsidePointerHandler) { document.removeEventListener('pointerdown', this.outsidePointerHandler); this.outsidePointerHandler = null; }
    if (this.container) this.container.innerHTML = '';
    this.container = null;
    this.root = null;
    this.els = null;
    this._mounted = false;
    this.pendingRemoveIds.clear();
  }

  on(type: NewTabPageEventType, handler: NewTabPageEventHandler): void {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(handler);
  }
  off(type: NewTabPageEventType, handler: NewTabPageEventHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  setSearchEngine(engine: string): void { this.searchEngine = engine; }

  setBookmarks(entries: readonly BookmarkEntry[]): void {
    this.bookmarks = entries;
    this.pendingRemoveIds.clear();
    if (!this._mounted) return;
    this.renderRail();
    this.renderQuickLinks();
  }

  setHistoryEntries(entries: readonly HistoryEntry[]): void {
    this.historyEntries = entries;
    if (!this._mounted) return;
    this.renderQuickLinks();
  }

  dispose(): void {
    this.unmount();
    this.handlers.clear();
  }

  // ── Event emission ─────────────────────────────────────────────────────

  private emit(event: NewTabPageEvent): void {
    const set = this.handlers.get(event.kind);
    if (!set) return;
    for (const h of set) {
      try { h(event); } catch (err) { console.error('[NewTabPage] Handler threw:', err); }
    }
  }

  private handleItemActivate(item: Tile): void {
    this.emit({ kind: 'navigate', url: item.url });
  }

  // ── Toast ────────────────────────────────────────────────────────────

  private toast(msg: string): void {
    if (!this.els) return;
    const el = this.els.toast;
    el.textContent = msg;
    el.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ── Bookmarks rail ─────────────────────────────────────────────────────

  private renderRail(): void {
    if (!this.els) return;
    const rail = this.els.rail;
    rail.innerHTML = '';
    for (const bm of this.bookmarks.slice(0, MAX_RAIL_ITEMS)) {
      if (!bm.url || this.pendingRemoveIds.has(bm.id)) continue;
      const name = bm.title || extractDomain(bm.url);
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'ntp-chip';
      chip.innerHTML = `<span class="ntp-avatar" style="${avatarBg(name)}">${initials(name)}</span><span>${escapeHtml(name)}</span>`;
      chip.addEventListener('click', () => this.emit({ kind: 'navigate', url: bm.url! }));
      rail.appendChild(chip);
    }
  }

  // ── Quick links (paginated grid) ───────────────────────────────────────

  private quickLinkItems(): Tile[] {
    const bookmarkTiles: Tile[] = this.bookmarks
      .filter(bm => bm.url && !this.pendingRemoveIds.has(bm.id))
      .map(bm => ({ id: bm.id, name: bm.title || extractDomain(bm.url!), url: bm.url!, removable: true }));

    const bookmarkUrls = new Set(bookmarkTiles.map(t => t.url));
    const historyTiles: Tile[] = this.historyEntries
      .filter(h => !bookmarkUrls.has(h.url))
      .slice(0, MAX_HISTORY_TILES)
      .map(h => ({ id: `h:${h.id}`, name: h.title || extractDomain(h.url), url: h.url, removable: false }));

    return [...bookmarkTiles, ...historyTiles];
  }

  private renderQuickLinks(): void {
    if (!this.els) return;
    const { qlTrack, qlDots } = this.els;
    const items = this.quickLinkItems();
    // Paginate the real tiles, then append one Add-tile to the very last
    // page (it doesn't count toward PAGE_SIZE, matching the source design).
    const itemPages = chunk(items, PAGE_SIZE);
    this.qlPage = clamp(this.qlPage, 0, itemPages.length - 1);

    qlTrack.innerHTML = '';
    itemPages.forEach((pageItems, pageIdx) => {
      const pageEl = document.createElement('div');
      pageEl.className = 'ntp-ql-page';
      pageEl.style.width = (100 / itemPages.length) + '%';
      pageItems.forEach(item => pageEl.appendChild(this.buildTile(item)));
      if (pageIdx === itemPages.length - 1) pageEl.appendChild(this.buildAddTile());
      qlTrack.appendChild(pageEl);
    });
    qlTrack.style.width = (itemPages.length * 100) + '%';
    this.positionQlTrack(itemPages.length);

    const goToPage = (i: number): void => {
      this.qlPage = clamp(i, 0, itemPages.length - 1);
      this.positionQlTrack(itemPages.length);
      this.renderDots(qlDots, itemPages.length, this.qlPage, goToPage);
    };
    this.renderDots(qlDots, itemPages.length, this.qlPage, goToPage);
    this.renderStats();
  }

  private positionQlTrack(pageCount: number): void {
    if (!this.els) return;
    this.els.qlTrack.style.transform = `translateX(-${this.qlPage * (100 / pageCount)}%)`;
  }

  private renderDots(container: HTMLElement, count: number, active: number, onClick: (i: number) => void): void {
    container.innerHTML = '';
    if (count <= 1) return;
    for (let i = 0; i < count; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ntp-dot' + (i === active ? ' active' : '');
      b.setAttribute('aria-label', `Go to page ${i + 1} of ${count}`);
      b.addEventListener('click', () => onClick(i));
      container.appendChild(b);
    }
  }

  private buildTile(item: Tile): HTMLElement {
    const btn = document.createElement('div');
    btn.className = 'ntp-tile' + (item.removable ? ' ntp-removable' : '');
    btn.innerHTML = `
      <span class="ntp-avatar" style="${avatarBg(item.name)}">${initials(item.name)}</span>
      <span class="ntp-label">${escapeHtml(item.name)}</span>
      ${item.removable ? `<button type="button" class="ntp-remove-btn" aria-label="Remove ${escapeHtml(item.name)}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>
      </button>` : ''}`;
    btn.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.ntp-remove-btn')) {
        this.pendingRemoveIds.add(item.id);
        this.toast(`Removing "${item.name}"…`);
        this.emit({ kind: 'tileAction', action: 'remove', url: item.url });
        this.renderRail();
        this.renderQuickLinks();
        return;
      }
      if (!this.editMode) this.handleItemActivate(item);
    });
    btn.tabIndex = 0;
    btn.setAttribute('role', 'button');
    btn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !this.editMode) this.handleItemActivate(item); });
    return btn;
  }

  private buildAddTile(): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ntp-tile ntp-add';
    btn.innerHTML = `
      <span class="ntp-avatar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      </span>
      <span class="ntp-label">Add tile</span>`;
    btn.addEventListener('click', () => this.openAddPopover());
    return btn;
  }

  // ── Add-tile popover ───────────────────────────────────────────────────

  private openAddPopover(): void {
    if (!this.els) return;
    this.els.popoverBackdrop.hidden = false;
    this.els.addName.focus();
  }

  private closeAddPopover(): void {
    if (!this.els) return;
    this.els.popoverBackdrop.hidden = true;
    this.els.addName.value = '';
    this.els.addUrl.value = '';
  }

  // ── Customize / edit mode ─────────────────────────────────────────────

  private toggleEditMode(): void {
    if (!this.els) return;
    this.editMode = !this.editMode;
    this.els.shell.classList.toggle('ntp-edit-mode', this.editMode);
    this.els.editToggle.setAttribute('aria-pressed', String(this.editMode));
    this.toast(this.editMode ? "Customize on — tap a tile's × to remove it" : 'Customize off');
  }

  // ── Search ─────────────────────────────────────────────────────────────

  private navigateFromInput(query: string): void {
    const isUrl = /^(https?:\/\/|ftp:\/\/|file:\/\/|nova:|about:)/i.test(query) ||
      (/^[\w-]+(\.[\w-]+)+/.test(query) && !/\s/.test(query));
    if (isUrl) {
      const url = query.startsWith('http') || /^[a-z][a-z0-9+.-]*:/i.test(query) ? query : `https://${query}`;
      this.emit({ kind: 'navigate', url });
    } else {
      const template = SEARCH_URL_TEMPLATES[this.searchEngine] || SEARCH_URL_TEMPLATES.google!;
      this.emit({ kind: 'navigate', url: template.replace('%s', encodeURIComponent(query)) });
    }
  }

  // ── Insight carousel ───────────────────────────────────────────────────

  private renderInsights(): void {
    if (!this.els) return;
    const { insightTrack, insightDots } = this.els;
    insightTrack.innerHTML = '';
    INSIGHTS.forEach(slide => {
      const el = document.createElement('div');
      el.className = 'ntp-insight-slide';
      el.style.width = (100 / INSIGHTS.length) + '%';
      el.innerHTML = `<h3>${slide.title}</h3>${slide.body}`;
      insightTrack.appendChild(el);
    });
    insightTrack.style.width = (INSIGHTS.length * 100) + '%';
    this.positionInsight();
    this.renderDots(insightDots, INSIGHTS.length, this.insightIndex, (i) => this.goToInsight(i));
  }

  private goToInsight(i: number): void {
    this.insightIndex = i;
    this.positionInsight();
    if (this.els) this.renderDots(this.els.insightDots, INSIGHTS.length, i, (n) => this.goToInsight(n));
    this.resetInsightTimer();
  }

  private positionInsight(): void {
    if (!this.els) return;
    this.els.insightTrack.style.transform = `translateX(-${this.insightIndex * (100 / INSIGHTS.length)}%)`;
  }

  private resetInsightTimer(): void {
    if (this.insightTimer) clearInterval(this.insightTimer);
    this.insightTimer = setInterval(() => {
      this.insightIndex = (this.insightIndex + 1) % INSIGHTS.length;
      this.positionInsight();
      if (this.els) this.renderDots(this.els.insightDots, INSIGHTS.length, this.insightIndex, (n) => this.goToInsight(n));
    }, 7000);
  }

  // ── Stats (computed live from state) ──────────────────────────────────

  private sessionLabel(): string {
    const s = Math.floor((Date.now() - this.launchedAt) / 1000);
    return pad(Math.floor(s / 60)) + ':' + pad(s % 60);
  }

  private static readonly STAT_ICONS = {
    bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 4h12v16l-6-4-6 4V4z"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><polygon points="12 3 21 8 12 13 3 8"/><polyline points="3 13 12 18 21 13"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/></svg>',
  } as const;

  private animateNumber(el: HTMLElement, to: number): void {
    const from = 0, dur = 700, start = performance.now();
    const step = (now: number): void => {
      const t = clamp((now - start) / dur, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.textContent = String(Math.round(from + (to - from) * eased));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private renderStats(): void {
    if (!this.els) return;
    const strip = this.els.statsStrip;
    const bookmarkCount = this.bookmarks.filter(b => b.url && !this.pendingRemoveIds.has(b.id)).length;
    const pageCount = Math.max(1, Math.ceil((this.quickLinkItems().length + 1) / PAGE_SIZE));
    strip.innerHTML = `
      <div class="ntp-stat-card ntp-panel">
        ${NewTabPage.STAT_ICONS.bookmark}
        <div class="ntp-stat-value" data-role="stat-bookmarks">0</div>
        <div class="ntp-stat-label">Bookmarks</div>
      </div>
      <div class="ntp-stat-card ntp-panel">
        ${NewTabPage.STAT_ICONS.layers}
        <div class="ntp-stat-value" data-role="stat-pages">0</div>
        <div class="ntp-stat-label">Grid pages</div>
      </div>
      <div class="ntp-stat-card ntp-panel">
        ${NewTabPage.STAT_ICONS.clock}
        <div class="ntp-stat-value" data-role="stat-session">00:00</div>
        <div class="ntp-stat-label">Session time</div>
      </div>`;
    this.animateNumber(strip.querySelector('[data-role="stat-bookmarks"]')!, bookmarkCount);
    this.animateNumber(strip.querySelector('[data-role="stat-pages"]')!, pageCount);
    strip.querySelector('[data-role="stat-session"]')!.textContent = this.sessionLabel();
  }

  // ── Clock ──────────────────────────────────────────────────────────────

  private updateClock(): void {
    if (!this.els) return;
    const now = new Date();
    this.els.clockTime.textContent = pad(now.getHours()) + ':' + pad(now.getMinutes());
    this.els.clockDate.textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    const statSession = this.root?.querySelector('[data-role="stat-session"]');
    if (statSession) statSession.textContent = this.sessionLabel();
  }

  // ── Swipe support ──────────────────────────────────────────────────────

  private attachSwipe(viewportEl: HTMLElement, onLeft: () => void, onRight: () => void): void {
    let startX: number | null = null;
    viewportEl.addEventListener('pointerdown', (e) => { startX = e.clientX; });
    viewportEl.addEventListener('pointerup', (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX;
      if (Math.abs(dx) > 40) { dx < 0 ? onLeft() : onRight(); }
      startX = null;
    });
  }

  // ── Wire static (shell-level) events, once per mount ──────────────────

  private wireStaticEvents(): void {
    if (!this.els || !this.root) return;
    const els = this.els;

    els.editToggle.addEventListener('click', () => this.toggleEditMode());

    const searchForm = this.root.querySelector('[data-role="search-form"]') as HTMLFormElement;
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = els.searchInput.value.trim();
      if (!q) return;
      this.navigateFromInput(q);
      els.searchInput.value = '';
    });

    const addForm = this.root.querySelector('[data-role="add-form"]') as HTMLFormElement;
    const addCancel = this.root.querySelector('[data-role="add-cancel"]') as HTMLButtonElement;
    addCancel.addEventListener('click', () => this.closeAddPopover());
    els.popoverBackdrop.addEventListener('click', (e) => { if (e.target === els.popoverBackdrop) this.closeAddPopover(); });
    addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = els.addName.value.trim();
      let url = els.addUrl.value.trim();
      if (!name || !url) return;
      if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = 'https://' + url;
      this.closeAddPopover();
      this.toast(`Adding "${name}"…`);
      this.emit({ kind: 'tileAction', action: 'add', title: name, url });
    });

    const qlViewport = this.root.querySelector('[data-role="ql-viewport"]') as HTMLElement;
    this.attachSwipe(qlViewport,
      () => { this.qlPage += 1; this.renderQuickLinks(); },
      () => { this.qlPage -= 1; this.renderQuickLinks(); },
    );

    const insightViewport = this.root.querySelector('[data-role="insight-viewport"]') as HTMLElement;
    this.attachSwipe(insightViewport,
      () => this.goToInsight((this.insightIndex + 1) % INSIGHTS.length),
      () => this.goToInsight((this.insightIndex - 1 + INSIGHTS.length) % INSIGHTS.length),
    );
    insightViewport.addEventListener('pointerenter', () => { if (this.insightTimer) clearInterval(this.insightTimer); });
    insightViewport.addEventListener('pointerleave', () => this.resetInsightTimer());
  }
}

export { NewTabPage, SEARCH_URL_TEMPLATES };
export type { INewTabPage, NewTabPageEvent, NewTabPageEventType, Tile as NewTabPageTile };
