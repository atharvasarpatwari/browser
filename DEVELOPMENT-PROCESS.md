# Nova Browser - Development Process & Technical Documentation

## Table of Contents

- [Project Overview](#1-project-overview)
- [Architecture](#2-architecture)
- [Core Browser Engine](#3-core-browser-engine)
- [Navigation System](#4-navigation-system)
- [URL Parsing & Validation](#5-url-parsing--validation)
- [HTML & CSS Parsing](#6-html--css-parsing)
- [DOM Tree & Rendering Pipeline](#7-dom-tree--rendering-pipeline)
- [Networking Layer](#8-networking-layer)
- [JavaScript Runtime](#9-javascript-runtime)
- [Storage Layer](#10-storage-layer)
- [Bookmark System (Unified)](#11-bookmark-system-unified)
- [History & Download Services](#12-history--download-services)
- [Tab Management](#13-tab-management)
- [Security Subsystem](#14-security-subsystem)
- [UI Component System (Model+View Pattern)](#15-ui-component-system-modelview-pattern)
- [Desktop Layout & Browser Window Page](#16-desktop-layout--browser-window-page)
- [Design System (CSS)](#17-design-system-css)
- [Dependency Injection Container](#18-dependency-injection-container)
- [Testing Strategy](#19-testing-strategy)
- [What Was Built, Session by Session](#20-what-was-built-session-by-session)
- [Known Issues & Future Work](#21-known-issues--future-work)

## 1\. Project Overview

Nova Browser is a **from-scratch browser engine** written in TypeScript with strict mode. It is not a wrapper around Chromium - every major subsystem (URL parsing, HTML parsing, CSS parsing, DOM construction, layout, paint, networking, JavaScript evaluation, security) is implemented natively.

The project has four major layers:

| Layer              | Purpose                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **Platform Layer** | Electron shell, window management, runtime detection, native menus                                                             |
| **Browser Core**   | Navigation, networking, rendering, JavaScript, storage, security, bookmarks, downloads, tabs                                   |
| **App Layer**      | Dependency injection container, application shell, service registration                                                        |
| **UI Layer**       | Components (address bar, toolbar, tab strip, bookmark bar, status bar), layouts (desktop, mobile), pages (settings, downloads) |

Additionally, a **React-based new-tab dashboard** (dashboard/) provides a visual landing page with an analog clock, weather widget, search bar, and quick-launch dock.

**Total codebase:** ~87 files, ~37 TypeScript source files, 18 test suites with **470 passing tests**, 4 shell scripts, 4 documentation files, 1 CSS design system.

## 2\. Architecture

### 2.1 Layer Diagram

┌──────────────────────────────────────────────────────────┐  
│ UI Layer │  
│ TabStrip Toolbar AddressBar BookmarkBar StatusBar │  
│ DesktopLayout MobileLayout BrowserWindowPage │  
│ SettingsPage DownloadsPage │  
└─────────────────────────┬────────────────────────────────┘  
│ depends on  
┌─────────────────────────▼────────────────────────────────┐  
│ App Layer │  
│ DependencyContainer AppShell main.ts (entry) │  
└─────────────────────────┬────────────────────────────────┘  
│ wires together  
┌─────────────────────────▼────────────────────────────────┐  
│ Browser Core Layer │  
│ Navigation: UrlParser, Router, NavigationController │  
│ Rendering: HtmlParser, CssParser, DomTree, │  
│ LayoutEngine, PaintEngine │  
│ Networking: RequestManager, CacheManager, │  
│ ResourceLoader, ResponseParser │  
│ JavaScript: JsRuntimeBridge, EventLoop, DomBindings │  
│ Storage: BookmarkStore, CookieStore, HistoryStore, │  
│ SessionStore │  
│ Security: AdBlocker, TrackerBlocker, SandboxManager, │  
│ PermissionManager, CertificateValidator, │  
│ ThirdPartySecurityManager │  
│ Bookmarks: BookmarkService, BookmarkValidator │  
│ Downloads: DownloadManager, FileVerifier │  
│ Tabs: TabManager, TabSession │  
└─────────────────────────┬────────────────────────────────┘  
│ abstracts  
┌─────────────────────────▼────────────────────────────────┐  
│ Platform Layer │  
│ WindowManager, RuntimeAdapter, PlatformEvents, │  
│ MenuIntegration, Electron type declarations │  
└──────────────────────────────────────────────────────────┘

### 2.2 Dependency Flow

Dependencies flow **downward only**. UI components depend on Browser Core services. Browser Core depends on Platform abstractions. The DependencyContainer wires everything together at startup in main.ts, registering all services as either Singleton (shared instance) or Transient (new instance per resolve).

### 2.3 Data Flow

User Input (click/type)  
→ UI Component (View captures DOM event)  
→ UI Component (Model emits typed event via EventBus)  
→ BrowserWindowPage (orchestrator handles event)  
→ Browser Core Service (e.g., NavigationController.navigate())  
→ Sub-systems (UrlParser → RequestManager → HtmlParser → DomTree → LayoutEngine → PaintEngine)  
→ Events propagate back up to UI for re-rendering

## 3\. Core Browser Engine

**File:** src/browser/engine/browser-engine.ts

The BrowserEngine is the central coordinator. It owns instances of all sub-systems and orchestrates the full page-load lifecycle:

- **Navigate:** UrlParser.parse(url) → validate → NavigationController.navigate(url)
- **Fetch:** RequestManager.fetch(url) → ResponseParser.parse(response)
- **Parse:** HtmlParser.parse(html, baseUrl) → DOM nodes + resource list
- **Load Resources:** ResourceLoader.loadResources(resources) - stylesheets, scripts, images in parallel
- **Build DOM:** DomTree.buildFromHtml(parseResult) - live tree with mutation tracking
- **Style:** CssParser.computeStyles(element, stylesheets) - cascade + specificity
- **Layout:** LayoutEngine.layout(root, viewport) - box model, positioning, stacking
- **Paint:** PaintEngine.paint(layoutResult) - paint commands (fill, stroke, text, image, clip)

The LifecycleManager (src/browser/engine/lifecycle-manager.ts) is a state machine (Idle → Starting → Running → Stopping) that manages ordered startup/shutdown phases with guards.

## 4\. Navigation System

**Files:**

- src/browser/navigation/navigation-controller.ts
- src/browser/navigation/router.ts

### 4.1 NavigationController

The NavigationController is a **per-tab navigation coordinator** that manages a history stack and enforces navigation state transitions.

**States:** Idle → Loading → Committing → Complete (or Stopped/Error)

**Navigation Types:**

- Push - new entry added to history stack
- Replace - current entry replaced
- Reload - re-fetch current URL

**Key Methods:**

- navigate(url) - full navigation with guard checks, event emission, stack management
- back() / forward() - pop/push history stack
- stop() - abort in-progress navigation
- replace(url) - replace current entry without adding to stack
- addGuard(guard) / removeGuard(guard) - navigation interception

**Guard System:** Guards are functions (url, type) => boolean | Promise&lt;boolean&gt; that can block navigation. If any guard returns false, navigation is blocked and navigationFailed is emitted. If a guard throws, it is treated as a block (with error logging).

**NavigationStack:**

- Configurable max size (default 50)
- Forward entries are discarded on push (standard browser behavior)
- snapshot() returns a frozen copy for inspection

**EventBus Events:** navigationStarted, navigationCommitted, navigationCompleted, navigationFailed, navigationStopped, canGoBackChanged, canGoForwardChanged, hashChanged

### 4.2 Router

The Router provides pattern-based URL matching with support for:

- Wildcard patterns: nova://\*
- Parameter patterns: nova://settings/:section
- Exact matches

## 5\. URL Parsing & Validation

**File:** src/browser/navigation/url-parser.ts

The UrlParser is the first line of defense for all URL input. It performs:

### 5.1 Protocol Blocking

Blocked schemes are rejected before any parsing:

- javascript: - XSS injection
- data: - embedded content injection
- vbscript: - legacy script injection
- blob: - uncontrolled content
- ws: / wss: - WebSocket (not yet supported)

### 5.2 Bare Domain Inference

Input like example.com, localhost:3000, or google is automatically prefixed with https://. The parser uses three regex patterns in order of specificity:

- SINGLE_LABEL_HOSTNAME_RE - catches single-label hostnames like www or localhost (added during security work)
- IP_ADDRESS_RE - IPv4/IPv6 addresses with optional ports
- ANY_SCHEME_RE - full URLs with explicit schemes

### 5.3 Special Pages

- about:blank, about:newtab, about:history - internal pages
- nova://settings, nova://downloads, nova://bookmarks - Nova internal pages

### 5.4 Validation

validate(input) returns a UrlValidationResult with either:

- { valid: true, url: NormalizedUrl } - ready to navigate
- { valid: false, error: string, errorKind: ErrorKind } - with specific error type

### 5.5 Error Types

- EmptyInputError - blank or whitespace-only input
- BlockedProtocolError - dangerous scheme detected
- MalformedUrlError - unparseable URL

## 6\. HTML & CSS Parsing

### 6.1 HTML Parser

**File:** src/browser/rendering/html-parser.ts

A **two-stage parser** following the HTML5 specification approach:

**Stage 1 - Tokenizer:** Converts raw HTML into a stream of tokens:

- StartTag, EndTag, Character, Comment, Doctype, EOF
- Handles attribute parsing (single/double/no quotes)
- Detects raw text elements (&lt;script&gt;, &lt;style&gt;) that should not be tokenized

**Stage 2 - Tree Builder:** Constructs a tree of DomNode objects:

- Handles open/close/void/self-closing tags
- Extracts &lt;meta charset&gt; for encoding
- Discovers sub-resources (stylesheets, scripts, images, links)
- Classifies scripts as render-blocking, deferred, or async
- Supports parseFragment() for partial HTML

**Resource Discovery:** Each parsed document includes a resources array listing:

- Stylesheets (with renderBlocking flag)
- Scripts (with defer/async flags)
- Images (with src/srcset)
- Links (preconnect, dns-prefetch, etc.)

### 6.2 CSS Parser

**File:** src/browser/rendering/css-parser.ts

Parses CSS into a Stylesheet object and provides selector matching and style computation.

**Selector Support:**

- Type selectors (div, p)
- Class selectors (.class)
- ID selectors (#id)
- Attribute selectors (\[attr\], \[attr=value\], \[attr~=value\])
- Universal selector (\*)
- Descendant combinator (space)
- Child combinator (>)
- Pseudo-classes (:hover, :first-child, :nth-child(n))

**Cascade & Specificity:**

- Specificity calculated as (ID count, class count, type count)
- Source order used as tie-breaker
- CSS variables (--var) are resolved during computation

**Media Queries:** Basic media query evaluation for prefers-color-scheme, width, etc.

## 7\. DOM Tree & Rendering Pipeline

### 7.1 DOM Tree

**File:** src/browser/rendering/dom-tree.ts

A **live DOM tree** with mutation tracking. Every modification is recorded for later inspection (useful for incremental rendering).

**Node Types:** Document, Element, Text, Comment, Doctype

**Mutation Types Recorded:**

- nodeInserted - child added
- nodeRemoved - child removed
- attributeChanged - attribute set/removed
- textChanged - text content modified
- styleChanged - computed style updated

**Indexing:**

- Nodes indexed by domId (auto-generated)
- Elements with id attributes are also indexed by that ID
- getElementsByTagName() returns all matching elements

### 7.2 Layout Engine

**File:** src/browser/rendering/layout-engine.ts

Calculates the position and size of every element in the render tree.

**Layout Models:**

- Block flow (vertical stacking)
- Inline flow (horizontal text)
- Float positioning
- Clear handling

**Box Model:** Full support for margin, padding, border, and content area. Margin collapsing between adjacent block elements.

**Positioning:**

- static - normal flow
- relative - offset from normal position
- absolute - relative to nearest positioned ancestor
- fixed - relative to viewport

**Additional Features:**

- Stacking contexts with z-index
- Overflow handling (visible, hidden, scroll, auto)
- Viewport-relative sizing (vw, vh, %)
- Width/height/auto calculations

### 7.3 Paint Engine

**File:** src/browser/rendering/paint-engine.ts

Converts layout results into a sequence of **paint commands** that can be rendered to a canvas or other output.

**Paint Commands:**

- FillRect - filled rectangle
- StrokeRect - outlined rectangle
- DrawText - text rendering
- DrawLine - line segment
- DrawImage - image placement
- DrawBorder - styled border
- ClipRect - clipping region
- Restore - pop clip/state
- SetColor / SetFont / SetOpacity - state changes

**Layer System:** Paint output is organized into layers with z-ordering, opacity, clip regions, and transforms.

## 8\. Networking Layer

**Directory:** src/browser/netwroking/ (note: directory name is misspelled in the codebase)

### 8.1 Request Manager

**File:** request-manager.ts

Handles HTTP(S) requests with:

- Redirect following (max 5 hops)
- Retry with exponential backoff (max 3 attempts)
- Configurable timeout
- Abort via AbortController

### 8.2 Cache Manager

**File:** cache-manager.ts

In-memory HTTP cache with:

- TTL-based expiration
- LRU eviction when exceeding max entries (default 1000)
- Cache-Control header parsing (max-age, no-cache, no-store, must-revalidate)

### 8.3 Resource Loader

**File:** resource-loader.ts

Batch-loads sub-resources discovered during HTML parsing:

- Parallel loading with priority ordering
- Render-blocking resources loaded first
- Progress tracking and error aggregation

### 8.4 Response Parser

**File:** response-parser.ts

Extracts metadata from HTTP responses:

- MIME type detection
- Cache directives
- Security headers: Content-Security-Policy, X-Frame-Options, X-Content-Type-Options, Strict-Transport-Security

## 9\. JavaScript Runtime

### 9.1 JS Runtime Bridge

**File:** src/browser/javascript/js-runtime-bridge.ts

Provides isolated JavaScript execution contexts:

- evaluate(code, context) - run code in a sandboxed context
- createContext() / destroyContext(id) - lifecycle management
- Console interception for devtools output
- Execution timeout to prevent infinite loops

### 9.2 Event Loop

**File:** src/browser/javascript/event-loop.ts

Implements the browser event loop:

- **Macrotask queue** - setTimeout, setInterval, I/O
- **Microtask queue** - Promise callbacks, queueMicrotask
- **requestAnimationFrame queue** - animation callbacks
- **Idle callback queue** - requestIdleCallback
- Task prioritization

### 9.3 DOM Bindings

**File:** src/browser/javascript/dom-bindings.ts

Exposes a browser-compatible DOM API surface to the JavaScript runtime:

- getElementById(), querySelector(), querySelectorAll()
- createElement(), addEventListener(), removeEventListener()
- setAttribute(), getAttribute()
- appendChild(), removeChild()

## 10\. Storage Layer

### 10.1 Bookmark Store

**File:** src/browser/storage/bookmark-store.ts

In-memory tree-structured store:

- create(), createFolder() - add entries
- get(id), getChildren(parentId), getTree() - retrieval
- query(filter) - text search, folder-only, by folder ID
- update(id, changes) - explicit property updates (no prototype pollution)
- move(id, newParentId) - reparent entries
- remove(id), removeFolderTree(id) - deletion with recursive cleanup

### 10.2 Cookie Store

**File:** src/browser/storage/cookie-store.ts

In-memory cookie jar with domain/path scoping, expiration, and secure flags.

### 10.3 History Store

**File:** src/browser/storage/history-store.ts

Visit history with frecency scoring:

- Visit count + typed count × 0.7
- Query by text, time range, pagination
- getFrecents() - most frequently/recently visited

### 10.4 Session Store

**File:** src/browser/storage/sessions-store.ts

Saves/restores window state, tab positions, and scroll positions.

## 11\. Bookmark System (Unified)

The bookmark system went through a significant evolution. Originally, the UI BookmarkBar component had its own standalone localStorage persistence, completely disconnected from the backend BookmarkService. This was unified during the security hardening work.

### 11.1 Current Architecture

BookmarkBarView (DOM rendering)  
↕ events  
BookmarkBar (model + event bus)  
↕ delegates to  
BookmarkService (business logic + events)  
↕ delegates to  
InMemoryBookmarkStore (tree-structured CRUD)

Plus a validation layer:

BookmarkBar.addBookmark(title, url)  
→ BookmarkValidator.validateBookmark(url, title)  
→ Check: non-empty URL, allowed scheme (http/https only)  
→ Sanitize: strip control chars from title, enforce max length  
→ Block: javascript:, data:, vbscript:, file:, blob:, about: schemes  
→ BookmarkService.addBookmark(sanitizedTitle, sanitizedUrl)  
→ Deduplicate by URL (updates existing instead of creating new)  
→ Generate secure ID via crypto.randomUUID() with fallback  
→ BookmarkBarEventBus.emit('addBookmark', { title, url })  
→ reload from store

### 11.2 BookmarkValidator

**File:** src/browser/bookmarks/bookmark-validator.ts

Input sanitization and URL scheme blocking:

- **URL validation:** Must be non-empty, must parse as URL, scheme must be http: or https:
- **Title sanitization:** Strip control characters (U+0000-U+001F, U+007F-U+009F), enforce max 200 chars
- **Blocked schemes:** javascript:, data:, vbscript:, file:, blob:, about:

### 11.3 Secure ID Generation

**File:** src/browser/bookmarks/bookmark-validator.ts (also in bookmark-store.ts)

IDs are generated using:

- Primary: crypto.randomUUID() (available in modern browsers and Node.js)
- Fallback: crypto.getRandomValues() with hex encoding
- Prefix: bm- for namespacing

This replaces the old sequential counter (nextId++) which was predictable.

### 11.4 BookmarkService

**File:** src/browser/bookmarks/bookmark-services.ts

Business logic layer with:

- **Deduplication:** Adding a bookmark with an existing URL updates the existing entry
- **Tree operations:** Add folder, move between folders, recursive folder deletion
- **Search:** Full-text search across title and URL
- **Events:** bookmarkCreated, bookmarkRemoved, bookmarkUpdated, bookmarkMoved, folderCreated, folderRemoved

### 11.5 BookmarkBar Model

**File:** src/ui/components/bookmark-bar/bookmark-bar.ts

The UI model that wraps BookmarkService:

- Async operations (add/remove/update all return Promises)
- Navigation: navigateIntoFolder(id) / navigateUp() - changes which folder's contents are displayed
- Event bus with **rate limiting** (max 100 emits before throttling, resettable)

### 11.6 BookmarkBar View

**File:** src/ui/components/bookmark-bar/bookmark-bar.view.ts

Renders the horizontal bookmark bar:

- Items as clickable divs with hover effects
- Folders show a back button when navigated into
- "+" button to add new bookmarks
- Max 50 visible items with overflow scrolling
- Truncated display titles with full tooltip

## 12\. History & Download Services

### 12.1 History Service

**File:** src/browser/history/history-service.ts

Records browsing history and provides frecency-based suggestions:

- **Auto-recording:** Connects to NavigationController events to automatically record visits
- **Frecency scoring:** visitCount + typedCount × 0.7
- **Query API:** Text filter, time range, pagination
- **Bulk operations:** Delete by range, delete all

### 12.2 Download Manager

**File:** src/browser/downloads/download-manager.ts

Full download lifecycle management:

- **States:** queued → downloading → paused/completed/failed/cancelled
- **Operations:** pause, resume, cancel, remove
- **Events:** downloadCreated, downloadProgress, downloadCompleted, downloadFailed, downloadCancelled, downloadPaused, downloadResumed, downloadRemoved
- **Filename extraction:** From URL path or Content-Disposition header

### 12.3 File Verifier

**File:** src/browser/downloads/file-verifier.ts

Blocks dangerous file types:

- **Blocked extensions:** .exe, .bat, .cmd, .scr, .pif, .com, .msi, .dll, .vbs, .js (when standalone), etc.
- **Blocked MIME types:** application/x-msdownload, application/x-bat, application/x-vbs, etc.

## 13\. Tab Management

### 13.1 Tab Manager

**File:** src/browser/tabs/tab-manager.ts

Multi-tab CRUD with state tracking:

- createTab(opts?) - creates a new tab with optional URL and title
- removeTab(id) - closes a tab
- setActiveTab(id) - switches active tab
- getAllTabs() - returns all tabs
- Supports tab grouping and pinning

### 13.2 Tab Session

**File:** src/browser/tabs/tab-session.ts

Per-tab state:

- id, url, title, loading, favicon
- scrollX, scrollY - scroll position
- zoom - zoom level
- historyIndex - position in navigation history

## 14\. Security Subsystem

The security subsystem is the most extensive part of the codebase, with six interconnected modules.

### 14.1 Tracker Blocker

**File:** src/browser/security/tracker-blocker.ts

Blocks known tracking domains using a built-in rule list.

**Categories:** analytics, advertising, tracking, fingerprinting, crypto-mining, malware

**Domain Matching (Fixed):** Originally used String.includes() which could cause false positives (e.g., "tracker.example.com" matching "exampletracker.com"). Now uses proper domain boundary checking:

function matchesDomain(hostname: string, ruleDomain: string): boolean {  
const h = hostname.toLowerCase();  
const d = ruleDomain.toLowerCase();  
if (h === d) return true; // exact match  
if (h.endsWith('.' + d)) return true; // subdomain match  
return false;  
}

For path-based rules (e.g., /analytics/track), the URL path is extracted and matched separately.

**Key Methods:**

- shouldBlock(url, pageOrigin) - checks URL against rule list
- recordBlocked(match) - records blocked request for stats
- setEnabled(enabled) - toggles blocking on/off
- getBlockedDomains() - returns unique blocked domains
- getStats() - returns counts by category

### 14.2 Ad Blocker

**File:** src/browser/security/ad-blocker.ts

Filters advertisements using domain and pattern rules.

**Default Rules:** 50+ rules covering common ad domains and paths.

**Ad Element Selectors:** 15+ CSS selectors for hiding ad containers in the DOM.

**Categories:** banner, video, popup, native, malvertising, tracking-ad, sponsored

**Pattern Matching (Fixed):** Also used String.includes() - replaced with matchesAdPattern() that:

- Extracts hostname from URL
- Checks exact domain match or subdomain match
- For path patterns (starting with /), checks URL pathname
- Falls back to substring match only for non-domain patterns

**Custom Rule Validation (New):** Added validateCustomAdRule() before accepting custom rules:

- Rejects empty patterns
- Rejects patterns longer than 256 characters
- Rejects patterns containing HTML injection characters (&lt;, &gt;, ", ', \`)

**Key Methods:**

- shouldBlock(url, resourceKind) - checks URL against all rules (default + custom)
- addCustomRule(rule) - adds a validated custom filter rule
- removeCustomRule(pattern) - removes a custom rule
- getElementSelectors() - returns CSS selectors for ad elements
- recordBlocked(match, resourceKind) - records with category

### 14.3 Sandbox Manager

**File:** src/browser/security/sandbox-manager.ts

Creates per-origin sandboxes with configurable permissions:

- allowScripts, allowForms, allowModals, allowPopups
- allowSameOrigin, allowTopNavigation
- contentSecurityPolicy

Each origin gets an isolated sandbox. Permissions can be checked via checkPermission(origin, permission).

### 14.4 Permission Manager

**File:** src/browser/security/permission-manager.ts

Manages web API permissions (geolocation, notifications, camera, microphone, clipboard, etc.).

**Permission States:** granted, denied, prompt

**Decision Persistence:**

- session - stored in memory for the session
- always - stored permanently in the permission store
- once - single use, then reset to prompt

**Request Recording (Fixed):** The request() method was not recording permission requests. Now every request (when state is prompt) is logged to the requests array with origin, permission name, decision type, and timestamp.

**Eviction:** When stored permissions exceed maxStoredDecisions (default 1000), the oldest entry is evicted.

### 14.5 Certificate Validator

**File:** src/browser/security/certificate-validator.ts

Validates TLS certificates:

- Chain of trust verification
- Expiry checking
- Revocation status
- Minimum key size (default 2048 bits)
- Cipher strength assessment

### 14.6 Third-Party Security Manager

**File:** src/browser/security/third-party-security.ts

Enforces security policies for third-party content (iframes, scripts, cookies, storage, fetch, popups).

**Policies:**

- block - completely forbidden
- isolate - allowed but sandboxed with minimal permissions
- restrict - allowed with reduced permissions
- allow - no restrictions

**isThirdParty() Function (Fixed):** Originally compared raw hostnames, treating <www.example.com> and example.com as different origins. Now uses stripWwwPrefix() to normalize:

function isThirdParty(requestOrigin: string, pageOrigin: string): boolean {  
const r = new URL(requestOrigin);  
const p = new URL(pageOrigin);  
return stripWwwPrefix(r.hostname) !== stripWwwPrefix(p.hostname);  
}

**stripWwwPrefix():** Safely removes <www>. prefix only when:

- The hostname starts with www.
- The remainder contains a dot (so <www.com> → preserved, <www.example.com> → example.com)

**Fingerprinting Detection:** Blocks known fingerprinting domains: fingerprintjs.com, fpjs.io, browserleaks.com, ipify.org, etc.

**CSP Directives:** When enforceStrictCSP is enabled, returns a strict Content-Security-Policy:

default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';  
img-src 'self' data:; connect-src 'self'; frame-src 'self'; ...

## 15\. UI Component System (Model+View Pattern)

All UI components follow a consistent **two-file pattern**:

component/  
component.ts ← Model: state, events, business logic  
component.view.ts ← View: DOM rendering, event binding

Both implement IDisposable for cleanup.

### 15.1 Event Bus Pattern

Every component has a typed event bus:

type EventType = 'clicked' | 'changed' | 'submitted';  
<br/>interface ClickEvent { readonly kind: 'clicked'; readonly id: string; }  
interface ChangedEvent { readonly kind: 'changed'; readonly value: string; }  
interface SubmittedEvent { readonly kind: 'submitted'; }  
<br/>type EventUnion = ClickEvent | ChangedEvent | SubmittedEvent;  
<br/>class ComponentEventBus {  
private readonly channels = new Map&lt;EventType, Set<EventHandler&gt;>();  
<br/>on(type: EventType, handler: EventHandler): void { ... }  
off(type: EventType, handler: EventHandler): void { ... }  
emit(event: EventUnion): void {  
const handlers = this.channels.get(event.kind);  
for (const h of handlers) {  
try { h(event); } catch (err) {  
console.error(\`\[Component\] Handler threw on "\${event.kind}":\`, err);  
}  
}  
}  
dispose(): void { this.channels.clear(); }  
}

Handlers are always wrapped in try/catch to prevent one handler's error from breaking others.

### 15.2 Tab Strip

**Files:** src/ui/components/tab-strip/tab-strip.ts, tab-strip.view.ts

**Model State:**

interface TabStripState {  
readonly tabs: readonly TabData\[\];  
readonly activeTabId: string | null;  
}  
<br/>interface TabData {  
readonly id: string;  
readonly title: string;  
readonly favicon: string | null;  
readonly active: boolean;  
readonly loading: boolean;  
readonly pinned: boolean;  
}

**Sync with TabManager:** The syncWithManager() method reads the current TabManager state and produces a TabStripState. It handles: tab creation (new tabs not in strip), tab removal (stale tabs removed), active tab tracking.

**View Features:**

- Tab list with close buttons
- "+" new tab button
- Loading spinner on active tab
- Favicon display
- Title truncation with tooltip
- Drag-and-drop reordering (via HTML5 drag events)
- Context menu (right-click)

### 15.3 Toolbar

**Files:** src/ui/components/toolbar/toolbar.ts, toolbar.view.ts

**Model State:**

interface ToolbarState {  
readonly canGoBack: boolean;  
readonly canGoForward: boolean;  
readonly loading: boolean;  
readonly shieldEnabled: boolean;  
}

**Events:** back, forward, reload, stop, shieldToggle, menuClick, bookmarkAdd

**View Features:**

- macOS-style traffic light buttons (close/minimize/maximize)
- Navigation buttons (← → ↻ ⌧) with disabled states
- Address bar slot (for embedding AddressBarView)
- Bookmark add button
- Shield toggle button with visual state

### 15.4 Bookmark Bar

Covered in detail in [Section 11](#11-bookmark-system-unified).

### 15.5 Status Bar

**Files:** src/ui/components/status-bar/status-bar.ts, status-bar.view.ts

**Model State:**

interface StatusBarState {  
readonly statusText: string;  
readonly url: string | null;  
readonly protocol: string | null;  
readonly secure: boolean;  
readonly zoom: number;  
readonly blockedCount: number;  
readonly hoverUrl: string | null;  
}

**Events:** shieldClicked, zoomChanged

**View Features:**

- Status text (loading indicators, "Done", error messages)
- Hover URL display (shows link target on hover)
- Blocked request counter with shield icon
- Shield toggle button
- Protocol indicator
- Secure/insecure badge (lock icon)
- Zoom percentage display

### 15.6 Address Bar

**Files:** src/ui/components/address-bar/address-bar.ts, address-bar.view.ts

**Model State:**

interface AddressBarState {  
readonly value: string;  
readonly focused: boolean;  
readonly loading: boolean;  
readonly secure: boolean;  
readonly suggestions: readonly Suggestion\[\];  
readonly hostname: string | null;  
}

**Events:** inputChanged, navigate, focus, blur, suggestionSelected

**View Features:**

- Protocol badge (lock icon for HTTPS)
- Editable URL input
- Loading spinner
- Suggestions dropdown with keyboard navigation (↑↓ arrows, Enter to select)
- Visual indicator for secure/insecure connections

## 16\. Desktop Layout & Browser Window Page

### 16.1 Desktop Layout

**File:** src/ui/layout/desktop-layout.ts

Defines the overall page structure matching the demo.html prototype:

┌──────────────────────────────────────────┐  
│ Toolbar Area │  
│ \[←→↻⟳\] \[Address Bar Slot\] \[🔖🛡\] │  
├──────────────────────────────────────────┤  
│ Tab Strip Area │  
│ \[Tab 1\] \[Tab 2\] \[Tab 3\] \[+\] │  
├──────────────────────────────────────────┤  
│ Bookmark Bar Area │  
│ \[📁Work\] \[Example\] \[GitHub\] \[+\] │  
├──────────────────────────────────────────┤  
│ Content View Area │  
│ │  
│ (web content here) │  
│ │  
├──────────────────────────────────────────┤  
│ Status Bar Area │  
│ Done | 🔍 2 blocked | 🔒 HTTPS │  
└──────────────────────────────────────────┘

**Areas Interface:**

interface LayoutAreas {  
toolbar: HTMLElement | null;  
tabBar: HTMLElement | null;  
bookmarkBar: HTMLElement | null;  
content: HTMLElement | null;  
statusBar: HTMLElement | null;  
}

**Methods:**

- build() - creates all DOM elements with proper CSS classes
- attach(container) - appends layout to a parent element
- detach() - removes layout from DOM
- getArea(name) - returns a specific area element

### 16.2 Browser Window Page

**File:** src/ui/pages/browser-window.ts

The **main orchestrator** that wires all UI components to browser core services.

**Initialization Flow:**

- Create DesktopLayout and attach to container
- Create TabManager instance
- Create TrackerBlocker and AdBlocker instances
- Create Toolbar + ToolbarView, attach to layout toolbar area
- Create TabStrip + TabStripView, attach to layout tab bar area
- Create AddressBar + AddressBarView, attach to toolbar's address bar slot
- Create BookmarkBar + BookmarkBarView, attach to layout bookmark bar area
- Create StatusBar + StatusBarView, attach to layout status bar area
- Wire all event handlers between components
- Create initial tab and render new tab page

**Event Wiring:**

Toolbar "back" → BrowserWindowPage.goBack()  
Toolbar "forward" → BrowserWindowPage.goForward()  
Toolbar "reload" → BrowserWindowPage.reload()  
Toolbar "stop" → BrowserWindowPage.stop()  
Toolbar "shieldToggle" → TrackerBlocker.setEnabled() + AdBlocker.setEnabled()  
Toolbar "bookmarkAdd" → BookmarkBar.addBookmark(currentTab.url)  
<br/>TabStrip "tabSelected" → TabManager.activateTab()  
TabStrip "tabClosed" → TabManager.removeTab()  
TabStrip "newTabRequested" → TabManager.createTab()  
<br/>AddressBar "navigate" → BrowserWindowPage.navigate(url)  
<br/>BookmarkBar "bookmarkClicked" → BrowserWindowPage.navigate(bookmark.url)  
<br/>StatusBar "shieldClicked" → Toolbar.toggleShield()

**Navigation Flow:** When navigate(url) is called:

- Update address bar value
- Set toolbar to loading state
- Update status bar text to "Loading..."
- Update tab URL and loading state
- Simulate network delay (500ms placeholder)
- Extract hostname as tab title
- Update security indicators (HTTPS detection)
- Reset loading state
- Sync all UI components

**Shield Toggle Flow:** When the shield button is clicked:

- Toolbar emits shieldToggle with enabled state
- BrowserWindowPage calls TrackerBlocker.setEnabled(enabled)
- BrowserWindowPage calls AdBlocker.setEnabled(enabled)
- Status bar updates with "Shield enabled/disabled" message

## 17\. Design System (CSS)

**File:** styles.css (598 lines)

A comprehensive dark-theme design system using CSS custom properties.

### 17.1 Color Palette

/\* Backgrounds \*/  
\--bg-body: #0f0f0f; /\* page background \*/  
\--bg-surface: #161618; /\* cards, panels \*/  
\--bg-elevated: #1c1c1e; /\* elevated surfaces \*/  
\--bg-raised: #242426; /\* raised elements \*/  
\--bg-overlay: rgba(255,255,255,.04); /\* hover states \*/  
\--bg-glass: rgba(22,22,24,.85); /\* glass morphism \*/  
<br/>/\* Text \*/  
\--text-primary: #f0eee6; /\* main text \*/  
\--text-secondary: #a0a098; /\* secondary text \*/  
\--text-tertiary: #6a6a68; /\* muted text \*/  
\--text-accent: #7c9cf5; /\* accent/links \*/  
\--text-danger: #f06a6a; /\* errors, warnings \*/  
\--text-success: #5fec7f; /\* success states \*/  
<br/>/\* Borders \*/  
\--border-subtle: rgba(255,255,255,.06);  
\--border-default: rgba(255,255,255,.1);  
\--border-strong: rgba(255,255,255,.15);  
\--border-accent: rgba(124,156,245,.4);

### 17.2 Typography

\--font-sans: Inter, system-ui, -apple-system, sans-serif;  
\--font-display: Poppins, Inter, sans-serif;  
\--font-mono: 'JetBrains Mono', 'Fira Code', monospace;

### 17.3 Spacing & Radii

\--radius-sm: 4px;  
\--radius-md: 6px;  
\--radius-lg: 10px;  
\--radius-xl: 14px;  
\--radius-full: 9999px;

### 17.4 Shadows & Effects

\--shadow-xs: 0 1px 2px rgba(0,0,0,.3);  
\--shadow-sm: 0 2px 8px rgba(0,0,0,.35);  
\--shadow-md: 0 4px 16px rgba(0,0,0,.4);  
\--shadow-lg: 0 8px 32px rgba(0,0,0,.5);  
\--shadow-glow: 0 0 20px var(--accent-glow);

### 17.5 Animations

\--curve: cubic-bezier(.4,0,.2,1);  
\--t-fast: .12s var(--curve); /\* micro interactions \*/  
\--t-norm: .2s var(--curve); /\* standard transitions \*/  
\--t-slow: .35s var(--curve); /\* page transitions \*/

### 17.6 Component Styles

The CSS defines styles for:

- .address-bar - glass morphism address bar with focus states
- .toolbar - navigation toolbar
- .tab-strip / .tab - tab styling with active/hover states
- .bookmark-bar - bookmark bar with item hover
- .status-bar - bottom status bar
- .settings-page - settings layout
- .download-item - download list items
- .suggestion-dropdown - address bar autocomplete

## 18\. Dependency Injection Container

**File:** src/app/dependency-container.ts

A custom IoC (Inversion of Control) container supporting:

### 18.1 Service Lifetimes

- **Singleton:** One instance shared across all resolvers. Created on first resolve.
- **Transient:** New instance created on every resolve.

### 18.2 Registration

container.register('UrlParser', UrlParser, ServiceLifetime.Singleton);  
container.registerValue('Config', appConfig);

### 18.3 Resolution

const parser = container.resolve&lt;UrlParser&gt;('UrlParser');

### 18.4 Safety Features

- **Duplicate detection:** Throws DuplicateRegistrationError if a token is registered twice
- **Missing service:** Throws ServiceNotFoundError if resolving an unregistered token
- **Circular dependency:** Detects and throws CircularDependencyError via a resolving stack
- **Disposal:** On dispose(), all singletons implementing IDisposable have their dispose() called

### 18.5 Registration in main.ts

The entry point registers **40+ services** including all browser core modules, UI components, storage layers, and security systems.

## 19\. Testing Strategy

**Framework:** Vitest 1.6.1 with happy-dom environment

**Coverage:** v8 provider with 80% threshold

### 19.1 Test Suites (18 files, 470 tests)

| Suite                         | Tests | What It Tests                                              |
| ----------------------------- | ----- | ---------------------------------------------------------- |
| dependency-container.test.ts  | 17    | IoC container: lifetimes, errors, disposal, fluent API     |
| url-parser.test.ts            | 37    | URL parsing, validation, normalization, protocol blocking  |
| navigation-controller.test.ts | 39    | History stack, navigation state machine, guards, events    |
| html-parser.test.ts           | 23    | HTML tokenization, tree building, resource discovery       |
| dom-tree.test.ts              | 20    | DOM construction, mutations, indexing                      |
| ad-blocker.test.ts            | 20    | Ad filtering, custom rules, categories, events             |
| third-party-security.test.ts  | 45    | Third-party policies, CSP, fingerprinting, trusted origins |
| address-bar.test.ts           | 16    | Address bar model + event bus                              |
| toolbar.test.ts               | 18    | Toolbar model + shield toggle + events                     |
| tab-strip.test.ts             | 14    | Tab strip sync, events, TabManager integration             |
| bookmark-bar.test.ts          | 18    | Bookmark bar CRUD, navigation, validation, events          |
| bookmark-services.test.ts     | 59    | Bookmark store CRUD, service logic, events, search         |
| status-bar.test.ts            | 13    | Status bar model + events                                  |
| history-service.test.ts       | 39    | History store, service, frecency, events                   |
| download-manager.test.ts      | 37    | Download lifecycle, filename extraction, events            |
| settings-page.test.ts         | 16    | Settings sections, values, mount/unmount                   |
| runtime-adapter.test.ts       | 18    | Environment detection, platform APIs                       |
| window-manager.test.ts        | 21    | Window lifecycle, bounds, events                           |

### 19.2 Testing Patterns

**Unit Tests:** Most tests are pure unit tests that instantiate a class, call methods, and assert results. No DOM mocking needed for model tests.

**Event Testing:** Event buses are tested by registering handlers via vi.fn(), emitting events, and asserting the handler was called with correct arguments.

**Error Testing:** Exception handling is tested by registering handlers that throw, then verifying the error is caught and logged without crashing the bus.

**Async Testing:** BookmarkBar tests use async/await since the unified system delegates to async BookmarkService methods.

## 20\. What Was Built, Session by Session

### Session 1: Foundation (Pre-existing)

The initial codebase was created with:

- All browser core modules (navigation, rendering, networking, JavaScript, storage)
- Security modules (ad-blocker, tracker-blocker, sandbox, permissions, certificates, third-party)
- Platform layer (window manager, runtime adapter, menu integration)
- Application layer (dependency container, app shell, main entry)
- Config files (app config, routes config, security config)
- Basic tests for core modules
- CSS design system

### Session 2: URL Parser & Third-Party Security Fixes

**Changes Made:**

- **url-parser.ts** - Added SINGLE_LABEL_HOSTNAME_RE regex to handle bare hostnames like www that were not being parsed correctly. This regex is placed before the ANY_SCHEME_RE check so single-label inputs are caught early.
- **third-party-security.ts** - Added and exported stripWwwPrefix() helper function that safely removes <www>. prefix from hostnames, preserving edge cases like <www.com> (no dot after removing prefix) and www-something.com (not a real www prefix).

### Session 3: UI Components (Model+View)

Created four complete UI components, each following the two-file Model+View pattern:

- **Tab Strip** (src/ui/components/tab-strip/)
  - Model: TabStrip class with TabStripEventBus, state tracking via TabManager sync
  - View: TabStripView with favicon, title, close button, drag reorder, "+" button, context menu
  - Tests: 14 tests covering state, sync, events, disposal
- **Bookmark Bar** (src/ui/components/bookmark-bar/)
  - Model: BookmarkBar class with localStorage persistence, folder navigation
  - View: BookmarkBarView with horizontal scrollable list, back button, add button
  - Tests: 16 tests covering CRUD, folders, events
- **Status Bar** (src/ui/components/status-bar/)
  - Model: StatusBar class tracking status text, URL, protocol, security, zoom, blocked count
  - View: StatusBarView with status display, shield button, security badge
  - Tests: 13 tests covering state and events
- **Toolbar** (src/ui/components/toolbar/)
  - Model: Toolbar class with navigation state, shield toggle
  - View: ToolbarView with traffic lights, nav buttons, shield/bookmark buttons
  - Tests: 18 tests covering all button events

### Session 4: Layout Integration & Browser Window Page

**Changes Made:**

- **Desktop Layout** (src/ui/layout/desktop-layout.ts) - Updated to add toolbar area (replacing separate addressBar area), matching the demo.html title-bar layout.
- **Browser Window Page** (src/ui/pages/browser-window.ts) - Full rewrite to:
  - Create TabManager and all four UI components
  - Attach views to DesktopLayout areas
  - Wire event handling between components (toolbar → navigation, tab strip → tab manager, bookmark bar → navigation, address bar → navigation)
  - Implement navigation simulation (placeholder for real rendering)
  - Implement reload, back, forward, stop operations

### Session 5: Security Hardening

**Bookmark Security:**

- **bookmark-validator.ts** (new) - Created BookmarkValidator class:
  - validateBookmark(url, title) - blocks dangerous URL schemes, sanitizes titles
  - validateTitle(title) - strips control characters, enforces length limits
  - Blocked schemes: javascript:, data:, vbscript:, file:, blob:, about:
- **bookmark-store.ts** - Two fixes:
  - **Secure IDs:** Replaced nextId++ sequential counter with generateSecureId() using crypto.randomUUID() with crypto.getRandomValues() fallback
  - **Prototype pollution fix:** update() method now explicitly picks known properties (title, url, parentId, folder) instead of spreading arbitrary ...changes which could inject prototype properties
- **bookmark-services.ts** - Updated addBookmark() and updateBookmark() to validate URLs and titles through BookmarkValidator before persisting

**Shield Toggle Wiring:**

- **browser-window.ts** - Imported TrackerBlocker and AdBlocker, created instances, wired the shieldToggle event to call setEnabled() on both blocking systems

**Domain Matching Fixes:**

- **tracker-blocker.ts** - Replaced String.includes() domain matching with proper matchesDomain() function that checks exact domain match or subdomain boundary (.endsWith('.' + d))
- **ad-blocker.ts** - Three changes:
  - Added matchesAdPattern() with proper hostname extraction and domain boundary checks
  - Added validateCustomAdRule() that rejects empty, oversized, or injection-pattern rules
  - Updated shouldBlock() to use matchesAdPattern() instead of String.includes()
  - Updated addCustomRule() to validate before accepting

**Third-Party Origin Comparison:**

- **third-party-security.ts** - Updated isThirdParty() to use stripWwwPrefix() so <www.example.com> and example.com are treated as same-party

**Permission Request Recording:**

- **permission-manager.ts** - Fixed request() to push entries to the requests array when a permission is requested in prompt state

**BookmarkBar Unification:**

- **bookmark-bar.ts** - Complete rewrite to use backend BookmarkService instead of standalone localStorage:
  - All methods are now async (delegating to BookmarkService)
  - Uses BookmarkValidator for input validation
  - Added rate limiting to event bus (max 100 emits)
  - Navigation: navigateIntoFolder() / navigateUp()
- **bookmark-bar.view.ts** - Updated to work with BookmarkEntry type (with folder: boolean flag) instead of the old Bookmark type
- **bookmark-bar.test.ts** - Rewritten for new async API with 18 tests

### Final State: 470 Tests Passing

All 18 test suites pass with 470 individual test cases. No pre-existing test failures.

## 21\. Known Issues & Future Work

### 21.1 Pre-existing Issues

- **Misspelled directory:** src/browser/netwroking/ (should be networking)
- **Misspelled script:** scripts/bulid.sh (should be build.sh)
- **Pre-existing TS errors:** dom-tree.ts has a read-only property assignment issue; navigation-controller.test.ts has a missing value property - these are unrelated to our changes

### 21.2 Potential Future Work

- **Rate limiting on security event buses:** ThirdPartySecurityManager and AdBlocker event buses could flood handlers during heavy blocking. Adding rate limiting similar to BookmarkBarEventBus would improve resilience.
- **Real rendering integration:** BrowserWindowPage.navigate() currently simulates navigation with a timeout. Connecting to the actual BrowserEngine pipeline (HTML parse → DOM build → layout → paint) would make pages render.
- **Electron integration:** The platform layer has Electron type declarations and window management, but the actual Electron main process wiring is not yet connected.
- **Dashboard integration:** The React new-tab dashboard exists as a separate sub-project but is not yet wired into the browser's new-tab page.
- **Search engine integration:** The address bar has suggestion infrastructure but no real search engine API connection.
- **History integration:** HistoryService can auto-record from NavigationController but BrowserWindowPage doesn't yet connect them.
- **Download integration:** DownloadManager exists but isn't wired to handle actual file downloads from navigation.

_Document generated from codebase analysis. Covers all modules, their interactions, the development process, security improvements, and testing strategy._