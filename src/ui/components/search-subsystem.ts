import type { IDisposable } from '../../app/dependency-container';
import type { DomDocument } from '../../browser/rendering/dom-tree';
import type { IAddressBar } from './address-bar/address-bar';
import type { OmniboxActions, OmniboxViewPort } from './omnibox-controller';
import { OmniboxController } from './omnibox-controller';
import { Omnibox } from '../../browser/omnibox/omnibox';
import type { OmniboxProvider, OmniboxResult } from '../../browser/omnibox/omnibox';
import { isDirectUrl } from '../../browser/omnibox/query-classifier';
import { InstantAnswerProvider } from '../../browser/omnibox/instant-answers';
import { BrowserActionsProvider, DEFAULT_BROWSER_ACTIONS } from '../../browser/omnibox/browser-actions';
import type { BrowserAction } from '../../browser/omnibox/browser-actions';
import { TabSwitchSuggestionsProvider } from '../../browser/omnibox/tab-switch-provider';
import type { SwitchableTab } from '../../browser/omnibox/tab-switch-provider';
import { ArchiveSuggestionsProvider } from '../../browser/omnibox/archive-suggestions';
import { AiResearchProvider } from '../../browser/omnibox/ai-research-provider';
import { BangRegistry, BangSuggestionsProvider } from '../../browser/omnibox/bangs';
import type { Bang } from '../../browser/omnibox/bangs';
import { ScopeHintsProvider } from '../../browser/omnibox/scope-hints';
import { HistorySuggestionsProvider } from '../../browser/omnibox/history-suggestions';
import type { HistoryEntry } from '../../browser/omnibox/history-suggestions';
import { BookmarkSuggestionsProvider } from '../../browser/omnibox/bookmark-suggestions';
import type { BookmarkEntry } from '../../browser/omnibox/bookmark-suggestions';
import { UrlSuggestionsProvider } from '../../browser/omnibox/url-suggestions';
import { tiered } from '../../browser/omnibox/score-tiers';
import {
  RemoteSearchSuggestionsProvider, fetchJsonWithGlobalFetch, getSuggestEndpoint,
} from '../../browser/omnibox/remote-search-suggestions';
import { PersonalSearchArchive } from '../../browser/search/search-archive';
import { IndexedDbIndexStorage } from '../../browser/search/archive-storage';
import type { IIndexStorage } from '../../browser/search/archive-storage';
import { extractIndexableDocument } from '../../browser/search/content-extractor';
import { SpeculativeLoader } from '../../browser/search/speculative-loader';

/** The settings keys the search subsystem reads (all optional; defaults are applied here). */
const SEARCH_SETTINGS = {
  suggestions: 'enableSearchSuggestions',
  suggestionsEngine: 'suggestionsEngine',
  archive: 'archiveEnabled',
  speculative: 'speculativeLoading',
  stripTracking: 'stripTrackingParams',
} as const;

interface SettingsPort {
  getBoolean(key: string, fallback?: boolean): boolean;
  getString(key: string, fallback?: string): string;
}

interface HistoryPort {
  query(options: { readonly query?: string; readonly maxResults?: number }): Promise<{ readonly entries: readonly HistoryEntry[] }>;
}

interface BookmarkPort {
  search(query: string): Promise<readonly BookmarkEntry[]>;
}

interface SearchEngineInfo {
  readonly name: string;
  searchUrl(query: string): string;
}

interface SearchSubsystemDeps {
  /** Getters, not values: the services are delivered to the window after it mounts. */
  readonly settings: () => SettingsPort | null;
  readonly history: () => HistoryPort | null;
  readonly bookmarks: () => BookmarkPort | null;
  readonly listTabs: () => readonly SwitchableTab[];
  readonly isIncognito: () => boolean;
  /** The current default engine (changes with settings). */
  readonly defaultEngine: () => SearchEngineInfo;
  readonly normalizeUrl: (raw: string) => string;
  /** Browser commands the window can actually run. Defaults to the full catalog. */
  readonly availableActions?: readonly BrowserAction[];
  /** The user's own search engines, usable as `!keyword`. */
  readonly extraBangs?: () => readonly Bang[];
  /** HTTP for suggestions; defaults to a credential-less `fetch`. */
  readonly fetchJson?: (url: string, signal: AbortSignal) => Promise<unknown>;
  readonly archiveStorage?: IIndexStorage;
  /** Warms the connection to a host (see SpeculativeLoader); optional. */
  readonly warmHost?: (host: string) => void | Promise<void>;
}

/**
 * The original URL provider guesses `.com/.org/.net` completions for any single word, which turns
 * every query into three bogus "go to" rows. Only dotted or schemed input is URL-like enough.
 */
function urlLikeOnly(provider: OmniboxProvider): OmniboxProvider {
  return {
    name: provider.name,
    getSuggestions: (input, max) => (/[./:]/.test(input) ? provider.getSuggestions(input, max) : []),
  };
}

/** The "Search <engine> for …" row for plain text. URL-looking text gets "Go to" rows instead. */
class TypedSearchProvider implements OmniboxProvider {
  readonly name = 'typed-search';

  constructor(private readonly engine: () => SearchEngineInfo) {}

  getSuggestions(input: string): OmniboxResult[] {
    const q = input.trim();
    if (!q || isDirectUrl(q)) return [];
    const e = this.engine();
    return [{
      type: 'search', text: q, description: `Search ${e.name} for "${q}"`, url: e.searchUrl(q),
      icon: '🔍', score: 98, source: this.name, action: 'search',
    }];
  }
}

/** Everything behind the omnibox, the personal archive and speculative loading, assembled once per window. */
class SearchSubsystem implements IDisposable {
  readonly omnibox = new Omnibox({ canonicalDedupe: true });
  readonly archive: PersonalSearchArchive;
  readonly bangs: BangRegistry;
  private readonly actionsProvider: BrowserActionsProvider;
  private readonly speculative: SpeculativeLoader;
  private readonly remote: RemoteSearchSuggestionsProvider;
  private controller: OmniboxController | null = null;

  constructor(private readonly deps: SearchSubsystemDeps) {
    const settings = (): SettingsPort | null => deps.settings();
    const flag = (key: string, fallback: boolean): boolean => settings()?.getBoolean(key, fallback) ?? fallback;
    const str = (key: string, fallback: string): string => settings()?.getString(key, fallback) || fallback;

    this.bangs = new BangRegistry(deps.extraBangs?.() ?? []);
    this.actionsProvider = new BrowserActionsProvider(deps.availableActions ?? DEFAULT_BROWSER_ACTIONS);

    this.archive = new PersonalSearchArchive({
      storage: deps.archiveStorage ?? new IndexedDbIndexStorage(),
      isEnabled: () => flag(SEARCH_SETTINGS.archive, false),
      isIncognito: deps.isIncognito,
    });

    this.speculative = new SpeculativeLoader({
      warm: (host) => deps.warmHost?.(host),
      isEnabled: () => flag(SEARCH_SETTINGS.speculative, true) && !!deps.warmHost,
      isIncognito: deps.isIncognito,
    });

    const history = new HistorySuggestionsProvider();
    history.setQueryFn(async (query, maxResults) => {
      const service = deps.history();
      return service ? [...(await service.query({ query, maxResults })).entries] : [];
    });
    const bookmarks = new BookmarkSuggestionsProvider();
    bookmarks.setQueryFn(async (query) => {
      const service = deps.bookmarks();
      return service ? [...(await service.search(query))] : [];
    });

    const tabs = new TabSwitchSuggestionsProvider(deps.listTabs);
    const archiveRows = new ArchiveSuggestionsProvider(this.archive, deps.isIncognito);
    const classifyOptions = { isBang: (k: string) => this.bangs.has(k), actionPhrases: this.actionsProvider.phrases };
    this.remote = new RemoteSearchSuggestionsProvider({
      getEndpoint: () => getSuggestEndpoint(str(SEARCH_SETTINGS.suggestionsEngine, 'duckduckgo')),
      buildSearchUrl: (q) => deps.defaultEngine().searchUrl(q),
      engineName: () => deps.defaultEngine().name,
      isEnabled: () => flag(SEARCH_SETTINGS.suggestions, true),
      isIncognito: deps.isIncognito,
      fetchJson: deps.fetchJson ?? fetchJsonWithGlobalFetch,
      classifyOptions,
    });

    // The orchestrator sorts and truncates across providers, so every general provider is put on the
    // same 0–100 scale and capped (see score-tiers.ts) before it merges.
    const providers: OmniboxProvider[] = [
      tiered(new TypedSearchProvider(deps.defaultEngine), 1),
      tiered(new InstantAnswerProvider(), 1),
      tiered(new BangSuggestionsProvider(this.bangs), 5),
      tiered(history, 4),
      tiered(bookmarks, 3),
      tiered(urlLikeOnly(new UrlSuggestionsProvider()), 3),
      tiered(tabs, 3),
      tiered(archiveRows, 3),
      tiered(this.actionsProvider, 3),
      tiered(this.remote, 5),
      // scope-only providers: larger lists, relaxed matching
      { name: 'scope:tabs', getSuggestions: (q) => tabs.search(q, { listAll: true, includeActive: true, limit: 8 }) },
      { name: 'scope:history', getSuggestions: (q, max) => history.getSuggestions(q, max ?? 8) },
      { name: 'scope:bookmarks', getSuggestions: (q, max) => bookmarks.getSuggestions(q, max ?? 8) },
      { name: 'scope:archive', getSuggestions: (q) => archiveRows.search(q, 8) },
      new AiResearchProvider(),
      new ScopeHintsProvider(),
    ];
    for (const p of providers) this.omnibox.addProvider(p);
  }

  /** Connects the address bar to the omnibox and returns the controller (disposed with the subsystem). */
  attach(addressBar: IAddressBar, view: OmniboxViewPort, actions: OmniboxActions): OmniboxController {
    this.controller?.dispose();
    this.controller = new OmniboxController({
      addressBar,
      view,
      omnibox: this.omnibox,
      bangs: this.bangs,
      actions,
      normalizeUrl: this.deps.normalizeUrl,
      resolveAction: (text) => {
        const top = this.actionsProvider.getSuggestions(text, 1)[0];
        return top && top.score >= 95 ? top.id ?? null : null;
      },
      scopeProviders: {
        tabs: ['scope:tabs'], history: ['scope:history'], bookmarks: ['scope:bookmarks'],
        archive: ['scope:archive'], ai: ['ai-research'], research: ['ai-research'],
      },
      scopeOnlyProviders: ['scope:tabs', 'scope:history', 'scope:bookmarks', 'scope:archive', 'ai-research', 'scope-hints'],
      actionPhrases: this.actionsProvider.phrases,
      stripTracking: () => this.deps.settings()?.getBoolean(SEARCH_SETTINGS.stripTracking, true) ?? true,
      speculative: this.speculative,
    });
    return this.controller;
  }

  /** Called when a page's DOM is ready: queues it for the personal archive if indexing is allowed. */
  indexPage(url: string, doc: DomDocument): boolean {
    if (!this.archive.canIndex(url)) return false;
    const extracted = extractIndexableDocument(doc, url, Date.now());
    return extracted ? this.archive.enqueue(extracted) : false;
  }

  dispose(): void {
    this.controller?.dispose();
    this.controller = null;
    this.omnibox.dispose();
    this.remote.dispose();
    this.archive.dispose();
    this.speculative.reset();
  }
}

export { SearchSubsystem, TypedSearchProvider, SEARCH_SETTINGS };
export type { SearchSubsystemDeps, SearchEngineInfo, SettingsPort, HistoryPort, BookmarkPort };
