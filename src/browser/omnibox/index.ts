export { Omnibox } from './omnibox';
export type { IOmnibox, OmniboxResult, OmniboxProvider, OmniboxResultType, OmniboxAction, OmniboxEvent, OmniboxEventKind, OmniboxEventHandler } from './omnibox';

export { SearchSuggestionsProvider, isLikelyUrl, DEFAULT_ENGINE } from './search-suggestions';
export type { ISearchSuggestionsProvider, SearchEngineConfig } from './search-suggestions';

export { UrlSuggestionsProvider, isDomainName, looksLikeUrl, COMMON_TLDS } from './url-suggestions';
export type { IUrlSuggestionsProvider } from './url-suggestions';

export { BookmarkSuggestionsProvider } from './bookmark-suggestions';
export type { IBookmarkSuggestionsProvider, BookmarkEntry, BookmarkQueryFn } from './bookmark-suggestions';

export { HistorySuggestionsProvider, computeFrecency } from './history-suggestions';
export type { IHistorySuggestionsProvider, HistoryEntry, HistoryQueryFn } from './history-suggestions';

export { SearchEngineManager, EngineSwitchProvider, BUILT_IN_ENGINES } from './search-engine';
export type { ISearchEngineManager, SearchEngine, EngineEvent, EngineEventKind, EngineEventHandler } from './search-engine';
