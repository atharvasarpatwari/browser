import type { IDisposable } from '../../app/dependency-container';
import type { DomDocument } from '../../browser/rendering/dom-tree';
import type { IAddressBar } from '../components/address-bar/address-bar';
import type { AddressBarOffer, AddressBarView } from '../components/address-bar/address-bar.view';
import { SearchSubsystem } from '../components/search-subsystem';
import type { BookmarkPort, HistoryPort, SearchEngineInfo, SettingsPort } from '../components/search-subsystem';
import type { OmniboxActions } from '../components/omnibox-controller';
import { SearchPage } from './search-page';
import type { SettingsWritePort } from './search-page';
import { FindInPage } from '../../browser/navigation-controls/find-in-page';
import { createDomFindSource } from '../../browser/navigation-controls/find-page-source';
import { FindBarView } from '../components/find-bar/find-bar.view';
import { FindHighlightOverlay } from '../components/find-bar/find-overlay';
import type { ScrollView } from '../components/find-bar/find-overlay';
import { PageSelectionController } from '../components/page-selection/page-selection-controller';
import { DEFAULT_BROWSER_ACTIONS } from '../../browser/omnibox/browser-actions';
import { expandSearchTemplate } from '../../browser/omnibox/search-template';
import { buildResearchUrl } from '../../browser/omnibox/ai-research-provider';
import { fetchTextWithGlobalFetch, findOpenSearchLinks, parseOpenSearchDescription } from '../../browser/omnibox/opensearch-discovery';
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
  /** Removes one history entry by id (the ✕ on an address-bar history row). */
  deleteHistoryEntry(id: string): void | Promise<void>;
  /** Adds an engine to the user's list. False when it is refused (name or keyword taken, no `%s` in the URL). */
  addEngine(engine: HostEngine): boolean;
  /** Suggestion transport; defaults to a credential-less `fetch`. */
  fetchJson?(url: string, signal: AbortSignal): Promise<unknown>;
  /** Transport for OpenSearch descriptors (the "Add as search engine" offer); defaults to a credential-less `fetch`. */
  fetchText?(url: string, signal: AbortSignal): Promise<string>;
  /** Warms the connection to a host (optional). */
  warmHost?(host: string): void | Promise<void>;
  /** How far the page is scrolled and how tall it is; find highlights and selections are in page coordinates. */
  scroll?(): ScrollView;
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
/** How long a descriptor download may take, and how long the "Added" / "Couldn't add" chip stays. */
const DESCRIPTOR_TIMEOUT_MS = 8000;
const OFFER_RESULT_MS = 2500;
/** Survives `encodeURIComponent`, so it can stand in for the query while a template is rewritten. */
const QUERY_MARK = 'NOVAQUERYMARK';

/** An OpenSearch template (`{searchTerms}`, optional extras) as the engine list's `%s` form. */
const toPercentS = (template: string): string =>
  expandSearchTemplate(template, { searchTerms: QUERY_MARK }).split(QUERY_MARK).join('%s');

const hostOf = (url: string): string => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};

type OfferOutcome = { readonly ok: true; readonly keyword: string } | { readonly ok: false; readonly reason: 'exists' | 'failed' };

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
  private selection: PageSelectionController | null = null;
  private pageDocument: () => DomDocument | null = () => null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private flushOnHide: ((e: Event) => void) | null = null;
  /** Hosts whose search engine was already offered this session (each site is offered once). */
  private readonly offered = new Set<string>();
  /** Bumped whenever the offer chip is retired, so a slow download can no longer touch a newer chip. */
  private offerToken = 0;
  private offerTimer: ReturnType<typeof setTimeout> | null = null;
  private offerAbort: AbortController | null = null;

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

    // The archive saves itself 5 s after its last change, and closing the window never reaches dispose():
    // a page indexed in the last few seconds would be lost. Save as soon as the page is hidden or unloaded.
    this.flushOnHide = (e) => {
      if (e.type === 'visibilitychange' && document.visibilityState !== 'hidden') return;
      void this.subsystem?.archive.flush();
    };
    window.addEventListener('pagehide', this.flushOnHide);
    document.addEventListener('visibilitychange', this.flushOnHide);
  }

  /** The user added, removed or replaced search engines: their keywords are `!bangs` too. */
  onEnginesChanged(): void {
    this.subsystem?.refreshBangs();
  }

  /** Where the live page's DOM comes from (find-in-page reads its laid-out text). */
  setPageDocumentProvider(provider: () => DomDocument | null): void {
    this.pageDocument = provider;
  }

  /** A page finished loading: queue it for the personal archive (if the user opted in) and offer the engine it advertises. */
  onPageDocumentReady(url: string, doc: DomDocument): void {
    this.subsystem?.indexPage(url, doc);
    this.offerEngine(url, doc);
  }

  /** The page was repainted in place: re-run the find query so matches follow the new layout. */
  onPageRepainted(): void {
    this.selection?.redraw();
    this.findOverlay?.redraw(); // the page may have scrolled: highlights are in page coordinates
    if (!this.findBar?.isOpen || this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      this.findBar?.refresh();
    }, REFRESH_INTERVAL_MS); // animated pages repaint every frame; one search per interval is plenty
  }

  /** The content area is about to be (or was) redrawn with something else — find state no longer applies. */
  onContentReplaced(): void {
    this.teardownFind();
    this.selection?.clear();
  }

  /**
   * The page being shown is going away (a navigation started, another tab was activated): its find state and
   * its "add search engine" offer end. Not part of `onContentReplaced`, which fires after the new page's
   * document is ready — the moment its own offer has just been shown.
   */
  onPageLeaving(): void {
    this.retireOffer();
    this.teardownFind();
    this.selection?.clear();
  }

  /** Lets the user select text on rendered pages (drag, double/triple-click, Ctrl+A, Ctrl+C). Desktop layout only. */
  enableSelection(): void {
    const area = this.host.contentArea();
    if (!area || this.selection) return;
    this.selection = new PageSelectionController({
      area, source: createDomFindSource(() => this.pageDocument()), scrollY: () => this.scrollView().y,
    });
    this.selection.attach();
  }

  /**
   * The selected text when `clientX/Y` is on it (the right-click menu offers to search it). A right-click anywhere
   * else ends the selection, like a browser's.
   */
  selectionAt(clientX: number, clientY: number): string {
    if (!this.selection?.hasSelection) return '';
    if (this.selection.containsClientPoint(clientX, clientY)) return this.selection.text();
    this.selection.clear();
    return '';
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

  /** "Search <default engine> for …" from the page's context menu — in a new tab, like the browser's own menu. */
  searchFor(text: string): void {
    this.host.open(toEngineInfo(this.host.defaultEngine()).searchUrl(text), true);
  }

  /** "Ask Nova AI about …" from the page's context menu. */
  askAi(text: string): void {
    this.host.open(buildResearchUrl(text), true);
  }

  copyText(text: string): void {
    void navigator.clipboard?.writeText(text).catch(() => { /* clipboard unavailable */ });
  }

  /** Shows the find bar over the page. Only rendered web pages (a bitmap canvas) can be searched. */
  openFindBar(): boolean {
    const area = this.host.contentArea();
    if (!area || !this.frameSize(area)) return false;
    if (!this.findBar) {
      if (getComputedStyle(area).position === 'static') area.style.position = 'relative';
      this.findEngine = new FindInPage(createDomFindSource(() => this.pageDocument()));
      this.findOverlay = new FindHighlightOverlay(area, () => this.frameSize(area), () => this.scrollView());
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
    if (this.flushOnHide) {
      window.removeEventListener('pagehide', this.flushOnHide);
      document.removeEventListener('visibilitychange', this.flushOnHide);
    }
    this.flushOnHide = null;
    this.offerAbort?.abort();
    this.retireOffer();
    this.teardownFind();
    this.selection?.dispose();
    this.selection = null;
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
      copy: (text) => this.copyText(text),
      fill: (text) => this.host.addressBarView()?.fill(text),
      deleteHistory: (id) => this.host.deleteHistoryEntry(id),
    };
  }

  /** A page advertises a search engine the user does not have: offer to add it. No network until they accept. */
  private offerEngine(pageUrl: string, doc: DomDocument): void {
    const view = this.host.addressBarView();
    if (!view || this.host.isIncognito() || !/^https?:/i.test(pageUrl)) return;
    const site = hostOf(pageUrl);
    const known = this.host.engines().some((e) => /^https?:/i.test(e.url) && hostOf(e.url.replace(/%s/g, 'x')) === site);
    if (!site || known || this.offered.has(site)) return;
    const link = findOpenSearchLinks(doc, pageUrl)[0];
    if (!link) return;

    this.offered.add(site);
    this.retireOffer();
    const token = this.offerToken;
    const name = link.title || site;
    view.setOffer({
      label: `＋ Add ${name}`,
      title: `Add ${name} as a search engine`,
      onAccept: () => { void this.acceptOffer(link.href, name, token); },
    });
  }

  /** The user took the offer: download the descriptor, add the engine, report the result for a moment. */
  private async acceptOffer(descriptorUrl: string, name: string, token: number): Promise<void> {
    const show = (offer: AddressBarOffer | null): void => {
      if (token === this.offerToken) this.host.addressBarView()?.setOffer(offer);
    };
    show({ label: 'Adding…', title: `Adding ${name}`, state: 'busy' });
    const outcome = await this.addDiscoveredEngine(descriptorUrl);
    if (token !== this.offerToken) return; // the page changed meanwhile: the engine (if added) stays, the chip is gone
    if (outcome.ok) {
      show({ label: `Added · !${outcome.keyword}`, title: `${name} was added: type !${outcome.keyword} and a query to use it`, state: 'done' });
    } else if (outcome.reason === 'exists') {
      show({ label: 'Already added', title: `${name} is already in your search engines`, state: 'failed' });
    } else {
      show({ label: "Couldn't add", title: `The search description of ${name} could not be read`, state: 'failed' });
    }
    this.offerTimer = setTimeout(() => { this.offerTimer = null; show(null); }, OFFER_RESULT_MS);
  }

  private async addDiscoveredEngine(descriptorUrl: string): Promise<OfferOutcome> {
    const abort = new AbortController();
    this.offerAbort = abort;
    const timeout = setTimeout(() => abort.abort(), DESCRIPTOR_TIMEOUT_MS);
    try {
      const xml = await (this.host.fetchText ?? fetchTextWithGlobalFetch)(descriptorUrl, abort.signal);
      const found = parseOpenSearchDescription(xml, descriptorUrl);
      if (!found) return { ok: false, reason: 'failed' };
      const keyword = this.freeKeyword(found.keyword);
      return this.host.addEngine({ name: found.name, url: toPercentS(found.searchUrl), keyword })
        ? { ok: true, keyword }
        : { ok: false, reason: 'exists' };
    } catch {
      return { ok: false, reason: 'failed' };
    } finally {
      clearTimeout(timeout);
      if (this.offerAbort === abort) this.offerAbort = null;
    }
  }

  /** `base`, or `base2`, `base3`… — the first keyword no engine and no built-in bang uses. */
  private freeKeyword(base: string): string {
    const taken = (k: string): boolean => this.host.engines().some((e) => e.keyword.toLowerCase() === k) || !!this.subsystem?.bangs.has(k);
    let keyword = base;
    for (let n = 2; taken(keyword); n++) keyword = `${base}${n}`;
    return keyword;
  }

  /** Removes the offer chip and stops any acceptance in flight from updating it. */
  private retireOffer(): void {
    this.offerToken++;
    if (this.offerTimer) clearTimeout(this.offerTimer);
    this.offerTimer = null;
    this.host.addressBarView()?.setOffer(null);
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
    } else if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !this.typingInField()) {
      const key = e.key.toLowerCase();
      if (key === 'a' && this.selection?.selectAll()) {
        e.preventDefault();
      } else if (key === 'c' && this.selection?.hasSelection) {
        this.copyText(this.selection.text());
        e.preventDefault();
      }
    }
  }

  /** Focus is in a text field (the address bar, the find box…): its own Ctrl+A / Ctrl+C apply, not the page's. */
  private typingInField(): boolean {
    const el = document.activeElement;
    return el instanceof HTMLElement && (el.matches('input, textarea, select') || el.isContentEditable);
  }

  private scrollView(): ScrollView {
    return this.host.scroll?.() ?? { y: 0, documentHeight: 0 };
  }

  /** The page bitmap's pixel size — match geometry is relative to it. Null when no page is rendered. */
  private frameSize(area: HTMLElement): { width: number; height: number } | null {
    const canvas = area.querySelector<HTMLCanvasElement>('canvas:not(.nova-find-overlay):not(.nova-selection-overlay)');
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
