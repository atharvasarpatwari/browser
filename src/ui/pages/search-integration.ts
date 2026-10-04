import type { IDisposable } from '../../app/dependency-container';
import type { DomDocument } from '../../browser/rendering/dom-tree';
import type { IAddressBar } from '../components/address-bar/address-bar';
import type { AddressBarView } from '../components/address-bar/address-bar.view';
import { SearchSubsystem } from '../components/search-subsystem';
import type { BookmarkPort, HistoryPort, SearchEngineInfo, SettingsPort } from '../components/search-subsystem';
import type { OmniboxActions } from '../components/omnibox-controller';
import { SearchPage } from './search-page';
import type { SettingsWritePort } from './search-page';
import { FindInPage } from '../../browser/navigation-controls/find-in-page';
import { createDomFindSource } from '../../browser/navigation-controls/find-page-source';
import { FindBarView } from '../components/find-bar/find-bar.view';
import { FindHighlightOverlay } from '../components/find-bar/find-overlay';
import { DEFAULT_BROWSER_ACTIONS } from '../../browser/omnibox/browser-actions';
import { expandSearchTemplate } from '../../browser/omnibox/search-template';
import { buildResearchUrl } from '../../browser/omnibox/ai-research-provider';
import type { SwitchableTab } from '../../browser/omnibox/tab-switch-provider';

/** One of the user's search engines (what `SearchEngineManager` holds); `url` is a template with `%s`. */
interface HostEngine {
  readonly name: string;
  readonly url: string;
  readonly keyword: string;
}

/** What the search wiring needs from the window that owns tabs, navigation and settings. */
interface SearchHost {
  addressBar(): IAddressBar | null;
  addressBarView(): AddressBarView | null;
  contentArea(): HTMLElement | null;
  settings(): (SettingsPort & { setValue(key: string, value: unknown): void }) | null;
  history(): HistoryPort | null;
  bookmarks(): BookmarkPort | null;
  listTabs(): readonly SwitchableTab[];
  isIncognito(): boolean;
  /** Where plain-text searches from the address bar go. */
  defaultEngine(): HostEngine;
  /** The user's engines in their order: the search page's web shortcuts and the `!keyword` bangs. */
  engines(): readonly HostEngine[];
  normalizeUrl(raw: string): string;
  /** Navigate the current tab, or open a new tab. */
  open(url: string, newTab: boolean): void;
  switchTab(tabId: string): void;
  reload(): void;
  closeActiveTab(): void;
  /** Suggestion transport; defaults to a credential-less `fetch`. */
  fetchJson?(url: string, signal: AbortSignal): Promise<unknown>;
  /** Warms the connection to a host (optional). */
  warmHost?(host: string): void | Promise<void>;
}

/** Omnibox commands that just open a built-in page ("clear browsing data" opens the settings that do it). */
const ACTION_PAGES: ReadonlyMap<string, string> = new Map([
  ['open-settings', 'nova://settings'],
  ['open-downloads', 'nova://downloads'],
  ['open-history', 'nova://history'],
  ['open-bookmarks', 'nova://bookmarks'],
  ['clear-browsing-data', 'nova://settings'],
]);

/** Browser commands the window can actually run (the omnibox only offers these). */
const HOST_ACTION_IDS: ReadonlySet<string> = new Set([...ACTION_PAGES.keys(), 'new-tab', 'close-tab', 'reload-page']);

const REFRESH_INTERVAL_MS = 150;

/** Nova's own search page — what the search page's box always uses, whatever the default engine is. */
const novaSearchUrl = (query: string): string => expandSearchTemplate('nova://search?q=%s', { searchTerms: query });

const toEngineInfo = (e: HostEngine): SearchEngineInfo => ({
  name: e.name,
  searchUrl: (q) => expandSearchTemplate(e.url, { searchTerms: q }),
});

/**
 * Window-level glue for the search subsystem: the omnibox on the address bar, the `nova://search`
 * page, Ctrl+F find-in-page (with highlights over the page bitmap), and personal-archive indexing.
 */
class SearchIntegration implements IDisposable {
  private subsystem: SearchSubsystem | null = null;
  private searchPage: SearchPage | null = null;
  private findEngine: FindInPage | null = null;
  private findBar: FindBarView | null = null;
  private findOverlay: FindHighlightOverlay | null = null;
  private pageDocument: () => DomDocument | null = () => null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly host: SearchHost) {}

  get search(): SearchSubsystem | null { return this.subsystem; }

  /** Builds the subsystem and connects it to the address bar. Needs the address bar to exist. */
  install(): void {
    const bar = this.host.addressBar();
    const view = this.host.addressBarView();
    if (!bar || !view || this.subsystem) return;

    const engine = (): SearchEngineInfo => toEngineInfo(this.host.defaultEngine());
    this.subsystem = new SearchSubsystem({
      settings: () => this.host.settings(),
      history: () => this.host.history(),
      bookmarks: () => this.host.bookmarks(),
      listTabs: () => this.host.listTabs(),
      isIncognito: () => this.host.isIncognito(),
      defaultEngine: engine,
      extraBangs: () => this.host.engines(),
      normalizeUrl: (raw) => this.host.normalizeUrl(raw),
      availableActions: DEFAULT_BROWSER_ACTIONS.filter((a) => HOST_ACTION_IDS.has(a.id)),
      fetchJson: this.host.fetchJson,
      warmHost: this.host.warmHost,
    });
    this.subsystem.attach(bar, view, this.actions(engine));
    void this.subsystem.archive.load();

    this.keyHandler = (e) => this.onKeyDown(e);
    document.addEventListener('keydown', this.keyHandler);
  }

  /** The user added, removed or replaced search engines: their keywords are `!bangs` too. */
  onEnginesChanged(): void {
    this.subsystem?.refreshBangs();
  }

  /** Where the live page's DOM comes from (find-in-page reads its laid-out text). */
  setPageDocumentProvider(provider: () => DomDocument | null): void {
    this.pageDocument = provider;
  }

  /** A page finished loading: queue it for the personal archive (if the user opted in). */
  onPageDocumentReady(url: string, doc: DomDocument): void {
    this.subsystem?.indexPage(url, doc);
  }

  /** The page was repainted in place: re-run the find query so matches follow the new layout. */
  onPageRepainted(): void {
    if (!this.findBar?.isOpen || this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.findBar?.refresh();
    }, REFRESH_INTERVAL_MS); // animated pages repaint every frame; one search per interval is plenty
  }

  /** The content area is about to be (or was) redrawn with something else — find state no longer applies. */
  onContentReplaced(): void {
    this.teardownFind();
  }

  /** Mounts `nova://search?q=…` into `container` (replacing any previous instance). */
  renderSearchPage(container: HTMLElement, pageUrl: string): void {
    const subsystem = this.subsystem;
    if (!subsystem) return;
    this.disposeSearchPage();

    let query = '';
    try { query = new URL(pageUrl).searchParams.get('q')?.trim() ?? ''; } catch { /* malformed URL: empty query */ }

    this.searchPage = new SearchPage({
      archive: subsystem.archive,
      settings: () => this.host.settings() as SettingsWritePort | null,
      // Nova's own engine is the page you are on; the rest are one-click ways to take the query to the web.
      webEngines: () => this.host.engines().filter((e) => !e.url.startsWith('nova:')).map(toEngineInfo),
      navigate: (url, how) => this.host.open(url, how.newTab),
      search: (q) => this.host.open(novaSearchUrl(q), false),
      research: (q) => this.host.open(buildResearchUrl(q), false),
    });
    this.searchPage.mount(container);
    this.searchPage.setQuery(query);
  }

  disposeSearchPage(): void {
    this.searchPage?.dispose();
    this.searchPage = null;
  }

  /** Shows the find bar over the page. Only rendered web pages (a bitmap canvas) can be searched. */
  openFindBar(): boolean {
    const area = this.host.contentArea();
    if (!area || !this.frameSize(area)) return false;
    if (!this.findBar) {
      if (getComputedStyle(area).position === 'static') area.style.position = 'relative';
      this.findEngine = new FindInPage(createDomFindSource(() => this.pageDocument()));
      this.findOverlay = new FindHighlightOverlay(area, () => this.frameSize(area));
      this.findBar = new FindBarView(this.findEngine, {
        onChange: (r) => this.findOverlay?.show(r.matches, r.activeIndex),
        onClose: () => this.findOverlay?.clear(),
      });
      this.findBar.mount(area);
    }
    this.findBar.open();
    return true;
  }

  dispose(): void {
    if (this.keyHandler) document.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
    this.teardownFind();
    this.disposeSearchPage();
    void this.subsystem?.archive.flush();
    this.subsystem?.dispose();
    this.subsystem = null;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private actions(engine: () => SearchEngineInfo): OmniboxActions {
    return {
      open: (url, how) => this.host.open(url, how.newTab),
      search: (query, how) => this.host.open(engine().searchUrl(query), how.newTab),
      switchTab: (id) => this.host.switchTab(id),
      runAction: (id) => this.runAction(id),
      research: (query) => this.host.open(buildResearchUrl(query), false),
      copy: (text) => { void navigator.clipboard?.writeText(text).catch(() => { /* clipboard unavailable */ }); },
      fill: (text) => this.host.addressBarView()?.fill(text),
    };
  }

  private runAction(id: string): void {
    const page = ACTION_PAGES.get(id);
    if (page) this.host.open(page, false);
    else if (id === 'new-tab') this.host.open('about:newtab', true);
    else if (id === 'close-tab') this.host.closeActiveTab();
    else if (id === 'reload-page') this.host.reload();
  }

  private onKeyDown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      if (this.openFindBar()) e.preventDefault();
    } else if (e.key === 'F3' && this.findBar?.isOpen) {
      e.preventDefault();
      if (e.shiftKey) this.findEngine?.findPrevious();
      else this.findEngine?.findNext();
    }
  }

  /** The page bitmap's pixel size — match geometry is relative to it. Null when no page is rendered. */
  private frameSize(area: HTMLElement): { width: number; height: number } | null {
    const canvas = area.querySelector<HTMLCanvasElement>('canvas:not(.nova-find-overlay)');
    return canvas && canvas.width > 0 ? { width: canvas.width, height: canvas.height } : null;
  }

  private teardownFind(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.findBar?.dispose();
    this.findOverlay?.dispose();
    this.findEngine?.dispose();
    this.findBar = null;
    this.findOverlay = null;
    this.findEngine = null;
  }
}

export { SearchIntegration, HOST_ACTION_IDS, novaSearchUrl };
export type { SearchHost, HostEngine };
