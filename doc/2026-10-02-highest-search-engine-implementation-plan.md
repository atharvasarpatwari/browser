# Flagship Browser Search Engine Subsystem — Complete Implementation Plan

**Date:** 2026-10-02  
**Document:** `doc/2026-10-02-highest-search-engine-implementation-plan.md`  
**Status:** Planned / Approved Specification  
**Architecture Domain:** Omnibox, OpenSearch 1.1, Remote Suggestion Pipeline, Inverted Index Local Search Engine, Find-in-Page, AI Deep Search Integration  

---

## 1. Executive Summary & Vision

The Nova Browser Search Subsystem represents the critical interface through which users discover, navigate, and query information. The goal of this implementation is to elevate Nova from basic static URL/search switching into a **state-of-the-art, flagship browser search engine ecosystem** comparable to or exceeding modern engines in Chrome, Arc, Safari, and Brave.

This plan specifies the architecture, data structures, algorithms, protocols, UI components, and test gates across six unified pillars:
1. **Intelligent Omnibox & Query Classification Engine:** Ultra-low latency (<2ms) multi-provider suggestion orchestrator with live remote suggestions, local frecency ranking, and rich client-side instant answers.
2. **OpenSearch 1.1 Protocol & Dynamic Search Engine Registry:** Full compliance with OpenSearch 1.1 auto-discovery from `<link rel="search">`, parameterized query templates (`{searchTerms}`, `{count}`), and multi-engine bang routing (`!g`, `!yt`, `!w`, `!ddg`).
3. **Personal Full-Text Search Engine (Local Personal Web Archive):** An embedded client-side inverted index (BM25 ranking, stemming, stop-word filtration, tf-idf) running in background web workers over visited page text, reader-mode articles, bookmarks, and downloads—enabling `nova://search` to search offline personal web history by page content.
4. **Hardware-Accelerated Find-in-Page Subsystem:** DOM-boundary-crossing text search with CSS Highlight API zero-mutation rendering, scrollbar tick marks, and regex support.
5. **Contextual & AI Research Integration:** Native selection search, image reverse search, and seamless delegation to Nova's `ResearchService` (`nova://research`) via `@ai` omnibox actions.
6. **Privacy, Security & Speculative Performance:** Zero keystroke leakage in incognito tabs, URL tracking parameter stripping, and speculative DNS prefetch / TLS preconnect for top predictions.

---

## 2. System Architecture

```mermaid
flowchart TD
    subgraph UI_Layer ["User Interface Layer"]
        ABView["AddressBarView (.nova-addressbar)"]
        Dropdown["Omnibox Dropdown (.nova-dropdown)"]
        NTP["New Tab Page (nova://newtab)"]
        FindBar["FindInPage Bar"]
        LocalSearchPage["Local Search Page (nova://search)"]
        ContextMenu["Context Menu ('Search with...')"]
    end

    subgraph Orchestration ["Omnibox Orchestration Core"]
        Classifier["Fast Query & Intent Classifier (<2ms)"]
        OmniboxCore["Omnibox Orchestrator (Multi-Provider Multiplexer)"]
        ScoreRanker["Frecency & Score Fusion Ranker"]
        Deduplicator["Canonical URL Deduplicator"]
    end

    subgraph Providers ["Omnibox Providers"]
        RemoteProv["RemoteSearchSuggestionsProvider (OpenSearch / AC API)"]
        HistoryProv["HistorySuggestionsProvider (Frecency Engine)"]
        BookmarkProv["BookmarkSuggestionsProvider (Fuzzy Hierarchy)"]
        TabProv["TabSwitchSuggestionsProvider (Open Tabs)"]
        BangProv["EngineSwitchProvider (!bang & @keyword)"]
        ActionProv["BrowserActionsProvider (Chrome Commands)"]
        InstantProv["InstantAnswerProvider (Math/Unit/Date)"]
        AiProv["AiResearchProvider (@ai & Deep Search)"]
    end

    subgraph Local_Index ["Native Full-Text Search Engine"]
        DOMExtractor["DOM & Reader Text Extractor"]
        WorkerPool["Background Indexing Worker (Idle / Worker)"]
        Tokenizer["Stemmer, Normalizer & Tokenizer"]
        InvertedIndex["Inverted Index + BM25 Ranker"]
        IndexDB["IndexedDB / SQLite Persistent Store"]
    end

    subgraph External_Registry ["Search Engine Management"]
        OpenSearchDiscovery["OpenSearch 1.1 Autodiscovery Parser"]
        EngineManager["SearchEngineManager (Built-in + Custom Engines)"]
        SpeculativePreload["Speculative DNS & TLS Preconnector"]
    end

    ABView -->|Keystrokes (Debounced)| Classifier
    NTP -->|Search Input| Classifier
    Classifier --> OmniboxCore
    OmniboxCore --> Providers
    RemoteProv -->|Live Suggestions| EngineManager
    OpenSearchDiscovery --> EngineManager
    EngineManager --> RemoteProv
    Providers --> ScoreRanker
    ScoreRanker --> Deduplicator
    Deduplicator --> Dropdown
    Dropdown -->|Navigation / Selection| ABView
    ScoreRanker -->|High-Confidence Top Hit| SpeculativePreload

    DOMExtractor --> WorkerPool
    WorkerPool --> Tokenizer
    Tokenizer --> InvertedIndex
    InvertedIndex --> IndexDB
    IndexDB --> LocalSearchPage
```

---

## 3. Detailed Component Specifications

### 3.1 Pillar 1: Intelligent Omnibox & Query Classification

#### 3.1.1 Query Classifier (`src/browser/omnibox/query-classifier.ts`)
Executes synchronously in `< 2ms` on every keystroke to partition inputs:
- **`DIRECT_URL`**: Matches scheme (`http://`, `https://`, `file://`, `nova://`, `about:`), known port (`localhost:3000`), valid IPv4/IPv6 (`127.0.0.1`, `[::1]`), or valid host with verified public suffix / TLD (`github.com/pulls`, `news.ycombinator.com`).
- **`BANG_SEARCH`**: Starts or ends with bang keyword (e.g., `!g quantum computing`, `react docs !gh`, `!w Albert Einstein`).
- **`SCOPED_SEARCH`**: Prefixed with `@` trigger (e.g., `@tabs settings`, `@history rust`, `@bookmarks recipes`, `@ai synthesize WebRTC`).
- **`BROWSER_ACTION`**: Direct commands (e.g., `clear browsing data`, `open settings`, `new incognito window`, `inspect element`).
- **`CALCULATION_OR_CONVERSION`**: Arithmetic (`sqrt(144) + 12 * 4`), unit conversion (`72 F to C`, `100 USD in EUR`), color parsing (`#ff5500`, `rgb(255, 0, 0)`).
- **`GENERAL_SEARCH`**: Free-form search query intended for the default search engine.

#### 3.1.2 Remote Search Suggestions Provider (`src/browser/omnibox/remote-search-suggestions.ts`)
- **Protocol**: Standard OpenSearch Suggestion JSON (RFC format: `[query, [suggestions], [descriptions], [urls]]`) and provider-specific schemas (Google Suggest JSON, DuckDuckGo AC JSON, Brave Suggestions API, Bing JSON).
- **Network Pipeline**:
  - In-flight request cancellation via `AbortController`.
  - Configurable debounce: 120ms desktop, 180ms mobile.
  - LRU in-memory query cache (capacity: 256 queries, TTL: 5 minutes).
  - Strict **Zero-Leakage Privacy Guard**:
    - Complete bypass when current tab is `incognito: true`.
    - Bypass when user toggles `settings.enableSearchSuggestions = false`.
    - Stripping sensitive query strings (passwords, credit cards, token formats).

#### 3.1.3 Instant Answer Engine (`src/browser/omnibox/instant-answers.ts`)
- Client-side zero-network mathematical evaluator using safe recursive descent parser (supports `+`, `-`, `*`, `/`, `^`, `%`, `sqrt`, `sin`, `cos`, `pi`, `e`).
- Currency and metric/imperial conversion tables.
- Emits dedicated result type `OmniboxResultType.InstantAnswer` with formatted visual badge.

---

### 3.2 Pillar 2: OpenSearch 1.1 Specification & Dynamic Engine Management

#### 3.2.1 OpenSearch 1.1 Autodiscovery (`src/browser/omnibox/opensearch-discovery.ts`)
- Ingests DOM `<link>` tags matching:
  `<link rel="search" type="application/opensearchdescription+xml" href="..." title="...">`
- Fetches and parses XML document extracting:
  - `ShortName`, `Description`, `Tags`
  - Search URL Template: `<Url type="text/html" template="https://example.com/search?q={searchTerms}"/>`
  - Suggestion URL Template: `<Url type="application/x-suggestions+json" template="https://example.com/suggest?q={searchTerms}"/>`
  - `Image` (favicon/icon)
  - Parameter expansion support: `{searchTerms}`, `{count}`, `{startIndex}`, `{language}`, `{inputEncoding}`.
- Registers into `SearchEngineManager` with autodiscovered flag; prompts UI pill in address bar: *"Add [Engine] as search engine"*.

#### 3.2.2 Search Engine Registry Expansion (`src/browser/omnibox/search-engine.ts`)
- Built-in catalog updated to 12 flagship engines:
  1. **DuckDuckGo** (default privacy engine)
  2. **Google**
  3. **Bing**
  4. **Brave Search**
  5. **Ecosia**
  6. **Kagi**
  7. **StartPage**
  8. **Wikipedia**
  9. **GitHub**
  10. **YouTube**
  11. **Stack Overflow**
  12. **Reddit**
- Full DuckDuckGo-style bang syntax catalog (~50 common bangs mapped natively without network roundtrip).
- Serialization and synchronization with `SettingsService` and mobile `ChromeStateSnapshot`.

---

### 3.3 Pillar 3: Personal Full-Text Search Engine (Local Inverted Index)

#### 3.3.1 DOM & Reader Content Extraction (`src/browser/search/content-indexer.ts`)
- Runs after page `DOMContentLoaded` and paint stabilization (or triggered upon Reader Mode parse).
- Extracts:
  - Title, URL, visit timestamp
  - Headings (`h1`, `h2`, `h3`) with boost weights (h1: 3.0, h2: 2.0, h3: 1.5)
  - Meta description and OpenGraph tags (boost: 2.0)
  - Readable body text (sanitized, stripped of script/style/nav/footer boilerplate)
- Dispatches extraction payload to background Web Worker via `MessageChannel`.

#### 3.3.2 Inverted Index & BM25 Ranker (`src/browser/search/bm25-index.ts`)
- **Text Processing Pipeline**:
  - Unicode lowercasing & diacritic removal.
  - Word boundary tokenization (Unicode UAX #29 regex).
  - Multi-language stop-word removal (English, French, German, Spanish, etc.).
  - Algorithmic stemming (Porter Stemmer for English, Snowball fallbacks).
  - Prefix trie for autocomplete and fuzzy typo matching (Damerau-Levenshtein distance <= 1).
- **BM25 Scoring Model**:
  $$\text{Score}(D, Q) = \sum_{t \in Q} \text{IDF}(t) \cdot \frac{f(t, D) \cdot (k_1 + 1)}{f(t, D) + k_1 \cdot (1 - b + b \cdot \frac{|D|}{\text{avgdl}})}$$
  Where $k_1 = 1.2$, $b = 0.75$, with field-level weight boosts (title 5.0, headings 2.5, body 1.0).
- **Storage**: IndexedDB object stores (`documents`, `terms`, `postings`) with chunked transactions for 60fps UI non-blocking operation.
- **UI Surface**: Native internal page `nova://search` presenting instant full-text search across all visited history, bookmarks, and saved articles with highlighted snippets and document previews.

---

### 3.4 Pillar 4: High-Performance Find-in-Page Subsystem

#### 3.4.1 In-Page Search Engine (`src/browser/navigation-controls/find-in-page-engine.ts`)
- Traverses DOM text nodes using `TreeWalker` crossing inline boundaries (`<p>Hello <span>world</span></p>`).
- Search options: case sensitive, whole word, regular expressions.
- **Zero-DOM-Mutation Rendering**: Uses `CSS.highlights` (`HighlightRegistry`) where supported, with fallback to canvas highlight overlay, avoiding invalidating virtual DOM states in complex web apps (React/Vue/Angular).
- **Scrollbar Visual Tick Marks**: Computes vertical percentage of every match and draws indicators on the viewport scroll track.
- Seamless keyboard navigation (`Enter` for next, `Shift+Enter` for previous, `Escape` to dismiss).

---

### 3.5 Pillar 5: Contextual Search & AI Deep Search Integration

#### 3.5.1 Contextual Selection Search (`src/ui/components/context-menu/search-context.ts`)
- Active text selection on any rendered page automatically populates context menu:
  - *"Search [Default Engine] for '[truncated query]'"*
  - Submenu: *"Search with DuckDuckGo / Google / GitHub / Wikipedia"*
  - *"Ask Nova AI about '[truncated query]'"*
- Image context menu: *"Search Web for Image"* (reverse image lookup).

#### 3.5.2 AI Deep Search Orchestration (`src/browser/search/ai-search-bridge.ts`)
- `@ai <query>` or `@research <query>` omnibox prefix activates Nova's autonomous research agent (`ResearchService`).
- Instead of just navigating to external search engines, it creates a research session that retrieves, synthesizes, and generates cited summaries directly in the browser side panel or `nova://research`.

---

### 3.6 Pillar 6: Privacy, Security & Predictive Performance

#### 3.6.1 Privacy & Anti-Tracking Safeguards
- **Incognito Isolation**: Remote suggestions disabled automatically in private browsing; local indexing disabled for private sessions.
- **Query Stripping**: Removes invasive tracker tags (`utm_source`, `utm_medium`, `utm_campaign`, `gclid`, `fbclid`, `msclkid`, `yclid`) from search engine destination URLs.
- **Referrer Privacy**: Ensures `strict-origin-when-cross-origin` referrer policy when navigating from omnibox search queries to search providers.

#### 3.6.2 Speculative Preconnect & DNS Prefetch (`src/browser/search/speculative-loader.ts`)
- When the Omnibox ranking engine produces a confidence score $> 900$ (e.g. user typed `yo` and top match is `youtube.com`, or top search query is overwhelmingly likely):
  - Emits DNS prefetch (`dns-prefetch`) for the destination origin.
  - Initiates speculative TLS preconnect (`preconnect`) via socket layer.
  - Reduces Time-To-First-Byte (TTFB) by 120ms–250ms upon user pressing `Enter`.

---

## 4. UI / UX Design & Mockup Alignment

The UI implementation directly integrates with the `.nova-*` design system in `styles.css` and `src/ui/layout/desktop-layout.ts`:
- **Address Bar Input (`.nova-addressbar-input`)**: Real-time query type badge (e.g., search icon, globe icon, `@tab` pill, `!bang` pill, calculator glyph).
- **Omnibox Dropdown (`.nova-dropdown`)**:
  - Section headers: *Suggestions*, *Open Tabs*, *Bookmarks & History*, *Calculations*, *Personal Web Archive*.
  - Rich suggestion items (`.nova-dropdown-item`):
    - Left icon / favicon / provider badge
    - Highlighted matching characters (bold/accent color)
    - Right-aligned hint text (*"Switch to tab"*, *"DuckDuckGo Search"*, *"Press Tab to complete"*)
    - Action buttons on hover (e.g. *Delete from history*, *Copy URL*)
- **Keyboard Navigation**:
  - `ArrowDown` / `ArrowUp`: cycles through suggestions.
  - `Tab`: autocomplete to current highlighted suggestion or enters engine keyword mode.
  - `Enter`: navigate or execute search.
  - `Alt+Enter`: open in new foreground tab.
  - `Escape`: dismiss dropdown and restore initial typed text.

---

## 5. Implementation Phases & Milestones

| Phase | Focus Areas | Deliverables | Target Test Suite |
|-------|-------------|--------------|-------------------|
| **Phase 1** | Omnibox Core & Live Remote Suggestions | `query-classifier.ts`, `remote-search-suggestions.ts`, LRU cache, AbortController wiring, Privacy guard, updated `tests/omnibox.test.ts` | +35 tests |
| **Phase 2** | OpenSearch 1.1 & Engine Management | `opensearch-discovery.ts`, 12 built-in engines, ~50 bang shortcuts, autodiscovery XML parser, `tests/opensearch.test.ts` | +28 tests |
| **Phase 3** | Personal Full-Text Search Engine | `content-indexer.ts`, `bm25-index.ts`, tokenizer, Porter stemmer, IndexedDB store, `nova://search` UI, `tests/bm25-search.test.ts` | +42 tests |
| **Phase 4** | Instant Answers, Actions & Tab Switching | `instant-answers.ts`, `browser-actions.ts`, `tab-switch-provider.ts`, `tests/instant-answers.test.ts` | +30 tests |
| **Phase 5** | UI Polish, Find-in-Page & Context Search | Dropdown redesign with `.nova-*`, CSS Highlight API find bar, context menu search entries, `tests/find-in-page.test.ts` | +25 tests |
| **Phase 6** | AI Deep Search & Speculative Preconnect | `@ai` bridge to `ResearchService`, speculative DNS/TLS preconnect, tracker parameter stripping, integration tests | +20 tests |

---

## 6. Verification & Quality Gates

In accordance with project rules (`AGENTS.md`):
1. **Compilation Gate**: `npx tsc --noEmit` must report 0 errors across the entire codebase.
2. **Unit & Integration Suite**: All existing 216 test files (9,180+ tests) must remain 100% green, plus ~180 new targeted tests for the search subsystem.
3. **Performance Gate**:
   - Query classification and local ranking: $< 2.5\text{ms}$ execution budget.
   - Omnibox total keystroke response time (local): $< 16\text{ms}$ (1 frame at 60fps).
   - Inverted index search on 10,000 indexed pages: $< 15\text{ms}$ query response.
4. **Platform Verification**:
   - Packaged Electron Windows launch & omnibox interaction.
   - Android native bridge snapshot check (`homeUrl`, `searchTemplate`, search queries from WebView).
