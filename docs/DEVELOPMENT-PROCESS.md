# Nova Browser — Development Process & Technical Documentation

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Core Browser Engine](#3-core-browser-engine)
4. [Navigation System](#4-navigation-system)
5. [URL Parsing & Validation](#5-url-parsing--validation)
6. [HTML & CSS Parsing](#6-html--css-parsing)
7. [DOM Tree & Rendering Pipeline](#7-dom-tree--rendering-pipeline)
8. [Networking Layer](#8-networking-layer)
9. [JavaScript Runtime](#9-javascript-runtime)
10. [Storage Layer](#10-storage-layer)
11. [Bookmark System (Unified)](#11-bookmark-system-unified)
12. [History & Download Services](#12-history--download-services)
13. [Tab Management](#13-tab-management)
14. [Security Subsystem](#14-security-subsystem)
15. [UI Component System (Model+View Pattern)](#15-ui-component-system-modelview-pattern)
16. [Desktop Layout & Browser Window Page](#16-desktop-layout--browser-window-page)
17. [Design System (CSS)](#17-design-system-css)
18. [Dependency Injection Container](#18-dependency-injection-container)
19. [Testing Strategy](#19-testing-strategy)
20. [What Was Built, Session by Session](#20-what-was-built-session-by-session)
21. [Known Issues & Future Work](#21-known-issues--future-work)

---

## 1. Project Overview

Nova Browser is a **from-scratch browser engine** written in TypeScript with strict mode. It is not a wrapper around Chromium — every major subsystem (URL parsing, HTML parsing, CSS parsing, DOM construction, layout, paint, networking, JavaScript evaluation, security) is implemented natively.

The project has four major layers:

| Layer | Purpose |
|-------|---------|
| **Platform Layer** | Electron shell, window management, runtime detection, native menus |
| **Browser Core** | Navigation, networking, rendering, JavaScript, storage, security, bookmarks, downloads, tabs |
| **App Layer** | Dependency injection container, application shell, service registration |
| **UI Layer** | Components (address bar, toolbar, tab strip, bookmark bar, status bar), layouts (desktop, mobile), pages (settings, downloads) |

Additionally, a **React-based new-tab dashboard** (`dashboard/`) provides a visual landing page with an analog clock, weather widget, search bar, and quick-launch dock.

**Total codebase:** ~89 files, ~39 TypeScript source files, 19 test suites with **1157 passing tests**, 4 shell scripts, 4 documentation files, 1 CSS design system.

---

## 2. Architecture

### 2.1 Layer Diagram

```
┌──────────────────────────────────────────────────────────┐
│                       UI Layer                           │
│  TabStrip  Toolbar  AddressBar  BookmarkBar  StatusBar   │
│  DesktopLayout  MobileLayout  BrowserWindowPage          │
│  SettingsPage  DownloadsPage                             │
└─────────────────────────┬────────────────────────────────┘
                          │ depends on
┌─────────────────────────▼────────────────────────────────┐
│                      App Layer                           │
│    DependencyContainer   AppShell   main.ts (entry)      │
└─────────────────────────┬────────────────────────────────┘
                          │ wires together
┌─────────────────────────▼────────────────────────────────┐
│                   Browser Core Layer                     │
│  Navigation:  UrlParser, Router, NavigationController    │
│  Rendering:   HtmlParser, CssParser, DomTree,            │
│               LayoutEngine, PaintEngine                  │
│  Networking:  RequestManager, CacheManager,              │
│               ResourceLoader, ResponseParser             │
│  JavaScript:  JsRuntimeBridge, EventLoop, DomBindings    │
│  Storage:     BookmarkStore, CookieStore, HistoryStore,  │
│               SessionStore                              │
│  Security:    AdBlocker, TrackerBlocker, SandboxManager, │
│               PermissionManager, CertificateValidator,   │
│               ThirdPartySecurityManager                  │
│  Bookmarks:   BookmarkService, BookmarkValidator         │
│  Downloads:   DownloadManager, FileVerifier              │
│  Tabs:        TabManager, TabSession                     │
└─────────────────────────┬────────────────────────────────┘
                          │ abstracts
┌─────────────────────────▼────────────────────────────────┐
│                   Platform Layer                         │
│  WindowManager, RuntimeAdapter, PlatformEvents,          │
│  MenuIntegration, Electron type declarations             │
└──────────────────────────────────────────────────────────┘
```

### 2.2 Dependency Flow

Dependencies flow **downward only**. UI components depend on Browser Core services. Browser Core depends on Platform abstractions. The `DependencyContainer` wires everything together at startup in `main.ts`, registering all services as either Singleton (shared instance) or Transient (new instance per resolve).

### 2.3 Data Flow

```
User Input (click/type) 
  → UI Component (View captures DOM event)
    → UI Component (Model emits typed event via EventBus)
      → BrowserWindowPage (orchestrator handles event)
        → Browser Core Service (e.g., NavigationController.navigate())
          → Sub-systems (UrlParser → RequestManager → HtmlParser → DomTree → LayoutEngine → PaintEngine)
            → Events propagate back up to UI for re-rendering
```

---

## 3. Core Browser Engine

**File:** `src/browser/engine/browser-engine.ts`

The `BrowserEngine` is the central coordinator. It owns instances of all sub-systems and orchestrates the full page-load lifecycle:

1. **Navigate:** `UrlParser.parse(url)` → validate → `NavigationController.navigate(url)`
2. **Fetch:** `RequestManager.fetch(url)` → `ResponseParser.parse(response)`
3. **Parse:** `HtmlParser.parse(html, baseUrl)` → DOM nodes + resource list
4. **Load Resources:** `ResourceLoader.loadResources(resources)` — stylesheets, scripts, images in parallel
5. **Build DOM:** `DomTree.buildFromHtml(parseResult)` — live tree with mutation tracking
6. **Style:** `CssParser.computeStyles(element, stylesheets)` — cascade + specificity
7. **Layout:** `LayoutEngine.layout(root, viewport)` — box model, positioning, stacking
8. **Paint:** `PaintEngine.paint(layoutResult)` — paint commands (fill, stroke, text, image, clip)

The `LifecycleManager` (`src/browser/engine/lifecycle-manager.ts`) is a state machine (Idle → Starting → Running → Stopping) that manages ordered startup/shutdown phases with guards.

---

## 4. Navigation System

**Files:**
- `src/browser/navigation/navigation-controller.ts`
- `src/browser/navigation/router.ts`

### 4.1 NavigationController

The `NavigationController` is a **per-tab navigation coordinator** that manages a history stack and enforces navigation state transitions.

**States:** Idle → Loading → Committing → Complete (or Stopped/Error)

**Navigation Types:**
- `Push` — new entry added to history stack
- `Replace` — current entry replaced
- `Reload` — re-fetch current URL

**Key Methods:**
- `navigate(url)` — full navigation with guard checks, event emission, stack management
- `back()` / `forward()` — pop/push history stack
- `stop()` — abort in-progress navigation
- `replace(url)` — replace current entry without adding to stack
- `addGuard(guard)` / `removeGuard(guard)` — navigation interception

**Guard System:**
Guards are functions `(url, type) => boolean | Promise<boolean>` that can block navigation. If any guard returns `false`, navigation is blocked and `navigationFailed` is emitted. If a guard throws, it is treated as a block (with error logging).

**NavigationStack:**
- Configurable max size (default 50)
- Forward entries are discarded on push (standard browser behavior)
- `snapshot()` returns a frozen copy for inspection

**EventBus Events:**
`navigationStarted`, `navigationCommitted`, `navigationCompleted`, `navigationFailed`, `navigationStopped`, `canGoBackChanged`, `canGoForwardChanged`, `hashChanged`

### 4.2 Router

The `Router` provides pattern-based URL matching with support for:
- Wildcard patterns: `nova://*`
- Parameter patterns: `nova://settings/:section`
- Exact matches

---

## 5. URL Parsing & Validation

**File:** `src/browser/navigation/url-parser.ts`

The `UrlParser` is the first line of defense for all URL input. It performs:

### 5.1 Protocol Blocking

Only two schemes are permanently blocked before any parsing:
- `javascript:` — XSS injection
- `vbscript:` — legacy script injection

Previously, `data:`, `blob:`, `ws:`, and `wss:` were also blocked, but they have been moved to the allowed list since they are legitimate protocols the browser may encounter.

### 5.6 Search Query Detection

The parser can distinguish between URLs and search queries:

- `isSearchQuery(input)` — returns `true` when input is not a valid URL, not a bare hostname, not an IP address, and not a scheme-prefixed string. Used by the address bar to decide whether to navigate or search.
- `buildSearchUrl(query, engineUrl?)` — constructs a search-engine URL by replacing the `%s` placeholder. Defaults to DuckDuckGo (`https://duckduckgo.com/?q=%s`).

### 5.7 Expanded Protocol Support

`ALLOWED_PROTOCOLS` now includes 40+ gateway protocols across seven categories:

| Category | Protocols |
|----------|-----------|
| **Proxy** | `http-proxy:`, `https-proxy:`, `socks4:`, `socks4a:`, `socks5:`, `pac+http:`, `pac+https:`, `wpad:` |
| **DNS** | `dns:`, `dns+udp:`, `dns+tcp:`, `https+dns:`, `tls+dns:`, `quic+dns:`, `dnssec:`, `mdns:` |
| **Tunnel** | `ssh-tunnel:`, `wg:`, `openvpn:`, `ipsec:`, `ikev2:`, `l2tp:`, `gre:`, `ipip:`, `vxlan:`, `geneve:`, `6to4:`, `isatap:`, `teredo:` |
| **NAT** | `upnp:`, `nat-pmp:`, `pcp:`, `stun:`, `stuns:`, `turn:`, `turns:`, `ice:` |
| **Access** | `captive:`, `radius:`, `radiustls:`, `tacacs:`, `dot1x:`, `wispr:` |
| **Load Balancer** | `health:`, `consul:` |
| **CDN** | `cdn:`, `cdn+push:`, `cdn+pull:` |
| **Discovery** | `ssdp:`, `bonjour:`, `avahi:`, `dnssd:` |

### 5.2 Bare Domain Inference

Input like `example.com`, `localhost:3000`, or `google` is automatically prefixed with `https://`. The parser uses three regex patterns in order of specificity:

1. `SINGLE_LABEL_HOSTNAME_RE` — catches single-label hostnames like `www` or `localhost` (added during security work)
2. `IP_ADDRESS_RE` — IPv4/IPv6 addresses with optional ports
3. `ANY_SCHEME_RE` — full URLs with explicit schemes

### 5.3 Special Pages

- `about:blank`, `about:newtab`, `about:history` — internal pages
- `nova://settings`, `nova://downloads`, `nova://bookmarks` — Nova internal pages

### 5.4 Validation

`validate(input)` returns a `UrlValidationResult` with either:
- `{ valid: true, url: NormalizedUrl }` — ready to navigate
- `{ valid: false, error: string, errorKind: ErrorKind }` — with specific error type

### 5.5 Error Types

- `EmptyInputError` — blank or whitespace-only input
- `BlockedProtocolError` — dangerous scheme detected
- `MalformedUrlError` — unparseable URL

---

## 6. HTML & CSS Parsing

### 6.1 HTML Parser

**File:** `src/browser/rendering/html-parser.ts`

A **two-stage parser** following the HTML5 specification approach:

**Stage 1 — Tokenizer:** Converts raw HTML into a stream of tokens:
- StartTag, EndTag, Character, Comment, Doctype, EOF
- Handles attribute parsing (single/double/no quotes)
- Detects raw text elements (`<script>`, `<style>`) that should not be tokenized

**Stage 2 — Tree Builder:** Constructs a tree of `DomNode` objects:
- Handles open/close/void/self-closing tags
- Extracts `<meta charset>` for encoding
- Discovers sub-resources (stylesheets, scripts, images, links)
- Classifies scripts as render-blocking, deferred, or async
- Supports `parseFragment()` for partial HTML

**Resource Discovery:**
Each parsed document includes a `resources` array listing:
- Stylesheets (with `renderBlocking` flag)
- Scripts (with `defer`/`async` flags)
- Images (with `src`/`srcset`)
- Links (`preconnect`, `dns-prefetch`, etc.)

### 6.2 CSS Parser

**File:** `src/browser/rendering/css-parser.ts`

Parses CSS into a `Stylesheet` object and provides selector matching and style computation.

**Selector Support:**
- Type selectors (`div`, `p`)
- Class selectors (`.class`)
- ID selectors (`#id`)
- Attribute selectors (`[attr]`, `[attr=value]`, `[attr~=value]`)
- Universal selector (`*`)
- Descendant combinator (space)
- Child combinator (`>`)
- Pseudo-classes (`:hover`, `:first-child`, `:nth-child(n)`)

**Cascade & Specificity:**
- Specificity calculated as (ID count, class count, type count)
- Source order used as tie-breaker
- CSS variables (`--var`) are resolved during computation

**Media Queries:**
Basic media query evaluation for `prefers-color-scheme`, `width`, etc.

---

## 7. DOM Tree & Rendering Pipeline

### 7.1 DOM Tree

**File:** `src/browser/rendering/dom-tree.ts`

A **live DOM tree** with mutation tracking. Every modification is recorded for later inspection (useful for incremental rendering).

**Node Types:** Document, Element, Text, Comment, Doctype

**Mutation Types Recorded:**
- `nodeInserted` — child added
- `nodeRemoved` — child removed
- `attributeChanged` — attribute set/removed
- `textChanged` — text content modified
- `styleChanged` — computed style updated

**Indexing:**
- Nodes indexed by `domId` (auto-generated)
- Elements with `id` attributes are also indexed by that ID
- `getElementsByTagName()` returns all matching elements

### 7.2 Layout Engine

**File:** `src/browser/rendering/layout-engine.ts`

Calculates the position and size of every element in the render tree.

**Layout Models:**
- Block flow (vertical stacking)
- Inline flow (horizontal text)
- Float positioning
- Clear handling

**Box Model:**
Full support for margin, padding, border, and content area. Margin collapsing between adjacent block elements.

**Positioning:**
- `static` — normal flow
- `relative` — offset from normal position
- `absolute` — relative to nearest positioned ancestor
- `fixed` — relative to viewport

**Additional Features:**
- Stacking contexts with z-index
- Overflow handling (visible, hidden, scroll, auto)
- Viewport-relative sizing (vw, vh, %)
- Width/height/auto calculations

### 7.3 Paint Engine

**File:** `src/browser/rendering/paint-engine.ts`

Converts layout results into a sequence of **paint commands** that can be rendered to a canvas or other output.

**Paint Commands:**
- `FillRect` — filled rectangle
- `StrokeRect` — outlined rectangle
- `DrawText` — text rendering
- `DrawLine` — line segment
- `DrawImage` — image placement
- `DrawBorder` — styled border
- `ClipRect` — clipping region
- `Restore` — pop clip/state
- `SetColor` / `SetFont` / `SetOpacity` — state changes

**Layer System:**
Paint output is organized into layers with z-ordering, opacity, clip regions, and transforms.

---

## 8. Networking Layer

**Directory:** `src/browser/netwroking/` (note: directory name is misspelled in the codebase)

### 8.1 Request Manager

**File:** `request-manager.ts`

Handles HTTP(S) requests with:
- Redirect following (max 5 hops)
- Retry with exponential backoff (max 3 attempts)
- Configurable timeout
- Abort via `AbortController`

### 8.2 Cache Manager

**File:** `cache-manager.ts`

In-memory HTTP cache with:
- TTL-based expiration
- LRU eviction when exceeding max entries (default 1000)
- `Cache-Control` header parsing (`max-age`, `no-cache`, `no-store`, `must-revalidate`)

### 8.3 Resource Loader

**File:** `resource-loader.ts`

Batch-loads sub-resources discovered during HTML parsing:
- Parallel loading with priority ordering
- Render-blocking resources loaded first
- Progress tracking and error aggregation

### 8.4 Response Parser

**File:** `response-parser.ts`

Extracts metadata from HTTP responses:
- MIME type detection
- Cache directives
- Security headers: `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`

---

## 9. JavaScript Runtime

### 9.1 JS Runtime Bridge

**File:** `src/browser/javascript/js-runtime-bridge.ts`

Provides isolated JavaScript execution contexts:
- `evaluate(code, context)` — run code in a sandboxed context
- `createContext()` / `destroyContext(id)` — lifecycle management
- Console interception for devtools output
- Execution timeout to prevent infinite loops

### 9.2 Event Loop

**File:** `src/browser/javascript/event-loop.ts`

Implements the browser event loop:
- **Macrotask queue** — setTimeout, setInterval, I/O
- **Microtask queue** — Promise callbacks, queueMicrotask
- **requestAnimationFrame queue** — animation callbacks
- **Idle callback queue** — requestIdleCallback
- Task prioritization

### 9.3 DOM Bindings

**File:** `src/browser/javascript/dom-bindings.ts`

Exposes a browser-compatible DOM API surface to the JavaScript runtime:
- `getElementById()`, `querySelector()`, `querySelectorAll()`
- `createElement()`, `addEventListener()`, `removeEventListener()`
- `setAttribute()`, `getAttribute()`
- `appendChild()`, `removeChild()`

---

## 10. Storage Layer

### 10.1 Bookmark Store

**File:** `src/browser/storage/bookmark-store.ts`

In-memory tree-structured store:
- `create()`, `createFolder()` — add entries
- `get(id)`, `getChildren(parentId)`, `getTree()` — retrieval
- `query(filter)` — text search, folder-only, by folder ID
- `update(id, changes)` — explicit property updates (no prototype pollution)
- `move(id, newParentId)` — reparent entries
- `remove(id)`, `removeFolderTree(id)` — deletion with recursive cleanup

### 10.2 Cookie Store

**File:** `src/browser/storage/cookie-store.ts`

In-memory cookie jar with domain/path scoping, expiration, and secure flags.

### 10.3 History Store

**File:** `src/browser/storage/history-store.ts`

Visit history with frecency scoring:
- Visit count + typed count × 0.7
- Query by text, time range, pagination
- `getFrecents()` — most frequently/recently visited

### 10.4 Session Store

**File:** `src/browser/storage/sessions-store.ts`

Saves/restores window state, tab positions, and scroll positions.

---

## 11. Bookmark System (Unified)

The bookmark system went through a significant evolution. Originally, the UI `BookmarkBar` component had its own standalone localStorage persistence, completely disconnected from the backend `BookmarkService`. This was unified during the security hardening work.

### 11.1 Current Architecture

```
BookmarkBarView (DOM rendering)
       ↕ events
BookmarkBar (model + event bus)
       ↕ delegates to
BookmarkService (business logic + events)
       ↕ delegates to
InMemoryBookmarkStore (tree-structured CRUD)
```

Plus a validation layer:

```
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
```

### 11.2 BookmarkValidator

**File:** `src/browser/bookmarks/bookmark-validator.ts`

Input sanitization and URL scheme blocking:

- **URL validation:** Must be non-empty, must parse as URL, scheme must be `http:` or `https:`
- **Title sanitization:** Strip control characters (U+0000–U+001F, U+007F–U+009F), enforce max 200 chars
- **Blocked schemes:** `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `about:`

### 11.3 Secure ID Generation

**File:** `src/browser/bookmarks/bookmark-validator.ts` (also in `bookmark-store.ts`)

IDs are generated using:
1. Primary: `crypto.randomUUID()` (available in modern browsers and Node.js)
2. Fallback: `crypto.getRandomValues()` with hex encoding
3. Prefix: `bm-` for namespacing

This replaces the old sequential counter (`nextId++`) which was predictable.

### 11.4 BookmarkService

**File:** `src/browser/bookmarks/bookmark-services.ts`

Business logic layer with:
- **Deduplication:** Adding a bookmark with an existing URL updates the existing entry
- **Tree operations:** Add folder, move between folders, recursive folder deletion
- **Search:** Full-text search across title and URL
- **Events:** `bookmarkCreated`, `bookmarkRemoved`, `bookmarkUpdated`, `bookmarkMoved`, `folderCreated`, `folderRemoved`

### 11.5 BookmarkBar Model

**File:** `src/ui/components/bookmark-bar/bookmark-bar.ts`

The UI model that wraps `BookmarkService`:
- Async operations (add/remove/update all return Promises)
- Navigation: `navigateIntoFolder(id)` / `navigateUp()` — changes which folder's contents are displayed
- Event bus with **rate limiting** (max 100 emits before throttling, resettable)

### 11.6 BookmarkBar View

**File:** `src/ui/components/bookmark-bar/bookmark-bar.view.ts`

Renders the horizontal bookmark bar:
- Items as clickable divs with hover effects
- Folders show a back button when navigated into
- "+" button to add new bookmarks
- Max 50 visible items with overflow scrolling
- Truncated display titles with full tooltip

---

## 12. History & Download Services

### 12.1 History Service

**File:** `src/browser/history/history-service.ts`

Records browsing history and provides frecency-based suggestions:
- **Auto-recording:** Connects to `NavigationController` events to automatically record visits
- **Frecency scoring:** `visitCount + typedCount × 0.7`
- **Query API:** Text filter, time range, pagination
- **Bulk operations:** Delete by range, delete all

### 12.2 Download Manager

**File:** `src/browser/downloads/download-manager.ts`

Full download lifecycle management:
- **States:** queued → downloading → paused/completed/failed/cancelled
- **Operations:** pause, resume, cancel, remove
- **Events:** `downloadCreated`, `downloadProgress`, `downloadCompleted`, `downloadFailed`, `downloadCancelled`, `downloadPaused`, `downloadResumed`, `downloadRemoved`
- **Filename extraction:** From URL path or Content-Disposition header

### 12.3 File Verifier

**File:** `src/browser/downloads/file-verifier.ts`

Blocks dangerous file types:
- **Blocked extensions:** `.exe`, `.bat`, `.cmd`, `.scr`, `.pif`, `.com`, `.msi`, `.dll`, `.vbs`, `.js` (when standalone), etc.
- **Blocked MIME types:** `application/x-msdownload`, `application/x-bat`, `application/x-vbs`, etc.

---

## 13. Tab Management

### 13.1 Tab Manager

**File:** `src/browser/tabs/tab-manager.ts`

Multi-tab CRUD with state tracking:
- `createTab(opts?)` — creates a new tab with optional URL and title
- `removeTab(id)` — closes a tab
- `setActiveTab(id)` — switches active tab
- `getAllTabs()` — returns all tabs
- Supports tab grouping and pinning

### 13.2 Tab Session

**File:** `src/browser/tabs/tab-session.ts`

Per-tab state:
- `id`, `url`, `title`, `loading`, `favicon`
- `scrollX`, `scrollY` — scroll position
- `zoom` — zoom level
- `historyIndex` — position in navigation history

---

## 14. Security Subsystem

The security subsystem is the most extensive part of the codebase, with six interconnected modules.

### 14.1 Tracker Blocker

**File:** `src/browser/security/tracker-blocker.ts`

Blocks known tracking domains using a built-in rule list.

**Categories:** analytics, advertising, tracking, fingerprinting, crypto-mining, malware

**Domain Matching (Fixed):**
Originally used `String.includes()` which could cause false positives (e.g., "tracker.example.com" matching "exampletracker.com"). Now uses proper domain boundary checking:

```typescript
function matchesDomain(hostname: string, ruleDomain: string): boolean {
  const h = hostname.toLowerCase();
  const d = ruleDomain.toLowerCase();
  if (h === d) return true;           // exact match
  if (h.endsWith('.' + d)) return true; // subdomain match
  return false;
}
```

For path-based rules (e.g., `/analytics/track`), the URL path is extracted and matched separately.

**Key Methods:**
- `shouldBlock(url, pageOrigin)` — checks URL against rule list
- `recordBlocked(match)` — records blocked request for stats
- `setEnabled(enabled)` — toggles blocking on/off
- `getBlockedDomains()` — returns unique blocked domains
- `getStats()` — returns counts by category

### 14.2 Ad Blocker

**File:** `src/browser/security/ad-blocker.ts`

Filters advertisements using domain and pattern rules.

**Default Rules:** 50+ rules covering common ad domains and paths.

**Ad Element Selectors:** 15+ CSS selectors for hiding ad containers in the DOM.

**Categories:** banner, video, popup, native, malvertising, tracking-ad, sponsored

**Pattern Matching (Fixed):**
Also used `String.includes()` — replaced with `matchesAdPattern()` that:
1. Extracts hostname from URL
2. Checks exact domain match or subdomain match
3. For path patterns (starting with `/`), checks URL pathname
4. Falls back to substring match only for non-domain patterns

**Custom Rule Validation (New):**
Added `validateCustomAdRule()` before accepting custom rules:
- Rejects empty patterns
- Rejects patterns longer than 256 characters
- Rejects patterns containing HTML injection characters (`<`, `>`, `"`, `'`, `` ` ``)

**Key Methods:**
- `shouldBlock(url, resourceKind)` — checks URL against all rules (default + custom)
- `addCustomRule(rule)` — adds a validated custom filter rule
- `removeCustomRule(pattern)` — removes a custom rule
- `getElementSelectors()` — returns CSS selectors for ad elements
- `recordBlocked(match, resourceKind)` — records with category

### 14.3 Sandbox Manager

**File:** `src/browser/security/sandbox-manager.ts`

Creates per-origin sandboxes with configurable permissions:
- `allowScripts`, `allowForms`, `allowModals`, `allowPopups`
- `allowSameOrigin`, `allowTopNavigation`
- `contentSecurityPolicy`

Each origin gets an isolated sandbox. Permissions can be checked via `checkPermission(origin, permission)`.

### 14.4 Permission Manager

**File:** `src/browser/security/permission-manager.ts`

Manages web API permissions (geolocation, notifications, camera, microphone, clipboard, etc.).

**Permission States:** `granted`, `denied`, `prompt`

**Decision Persistence:**
- `session` — stored in memory for the session
- `always` — stored permanently in the permission store
- `once` — single use, then reset to prompt

**Request Recording (Fixed):**
The `request()` method was not recording permission requests. Now every request (when state is `prompt`) is logged to the `requests` array with origin, permission name, decision type, and timestamp.

**Eviction:**
When stored permissions exceed `maxStoredDecisions` (default 1000), the oldest entry is evicted.

### 14.5 Certificate Validator

**File:** `src/browser/security/certificate-validator.ts`

Validates TLS certificates:
- Chain of trust verification
- Expiry checking
- Revocation status
- Minimum key size (default 2048 bits)
- Cipher strength assessment

### 14.6 Third-Party Security Manager

**File:** `src/browser/security/third-party-security.ts`

Enforces security policies for third-party content (iframes, scripts, cookies, storage, fetch, popups).

**Policies:**
- `block` — completely forbidden
- `isolate` — allowed but sandboxed with minimal permissions
- `restrict` — allowed with reduced permissions
- `allow` — no restrictions

**isThirdParty() Function (Fixed):**
Originally compared raw hostnames, treating `www.example.com` and `example.com` as different origins. Now uses `stripWwwPrefix()` to normalize:

```typescript
function isThirdParty(requestOrigin: string, pageOrigin: string): boolean {
  const r = new URL(requestOrigin);
  const p = new URL(pageOrigin);
  return stripWwwPrefix(r.hostname) !== stripWwwPrefix(p.hostname);
}
```

**stripWwwPrefix():**
Safely removes `www.` prefix only when:
- The hostname starts with `www.`
- The remainder contains a dot (so `www.com` → preserved, `www.example.com` → `example.com`)

**Fingerprinting Detection:**
Blocks known fingerprinting domains: `fingerprintjs.com`, `fpjs.io`, `browserleaks.com`, `ipify.org`, etc.

**CSP Directives:**
When `enforceStrictCSP` is enabled, returns a strict Content-Security-Policy:
```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; frame-src 'self'; ...
```

---

## 15. UI Component System (Model+View Pattern)

All UI components follow a consistent **two-file pattern**:

```
component/
  component.ts      ← Model: state, events, business logic
  component.view.ts  ← View: DOM rendering, event binding
```

Both implement `IDisposable` for cleanup.

### 15.1 Event Bus Pattern

Every component has a typed event bus:

```typescript
type EventType = 'clicked' | 'changed' | 'submitted';

interface ClickEvent { readonly kind: 'clicked'; readonly id: string; }
interface ChangedEvent { readonly kind: 'changed'; readonly value: string; }
interface SubmittedEvent { readonly kind: 'submitted'; }

type EventUnion = ClickEvent | ChangedEvent | SubmittedEvent;

class ComponentEventBus {
  private readonly channels = new Map<EventType, Set<EventHandler>>();
  
  on(type: EventType, handler: EventHandler): void { ... }
  off(type: EventType, handler: EventHandler): void { ... }
  emit(event: EventUnion): void {
    const handlers = this.channels.get(event.kind);
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[Component] Handler threw on "${event.kind}":`, err);
      }
    }
  }
  dispose(): void { this.channels.clear(); }
}
```

Handlers are always wrapped in try/catch to prevent one handler's error from breaking others.

### 15.2 Tab Strip

**Files:** `src/ui/components/tab-strip/tab-strip.ts`, `tab-strip.view.ts`

**Model State:**
```typescript
interface TabStripState {
  readonly tabs: readonly TabData[];
  readonly activeTabId: string | null;
}

interface TabData {
  readonly id: string;
  readonly title: string;
  readonly favicon: string | null;
  readonly active: boolean;
  readonly loading: boolean;
  readonly pinned: boolean;
}
```

**Sync with TabManager:**
The `syncWithManager()` method reads the current `TabManager` state and produces a `TabStripState`. It handles: tab creation (new tabs not in strip), tab removal (stale tabs removed), active tab tracking.

**View Features:**
- Tab list with close buttons
- "+" new tab button
- Loading spinner on active tab
- Favicon display
- Title truncation with tooltip
- Drag-and-drop reordering (via HTML5 drag events)
- Context menu (right-click)

### 15.3 Toolbar

**Files:** `src/ui/components/toolbar/toolbar.ts`, `toolbar.view.ts`

**Model State:**
```typescript
interface ToolbarState {
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
  readonly loading: boolean;
  readonly shieldEnabled: boolean;
}
```

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

**Files:** `src/ui/components/status-bar/status-bar.ts`, `status-bar.view.ts`

**Model State:**
```typescript
interface StatusBarState {
  readonly statusText: string;
  readonly url: string | null;
  readonly protocol: string | null;
  readonly secure: boolean;
  readonly zoom: number;
  readonly blockedCount: number;
  readonly hoverUrl: string | null;
}
```

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

**Files:** `src/ui/components/address-bar/address-bar.ts`, `address-bar.view.ts`

**Model State:**
```typescript
interface AddressBarState {
  readonly value: string;
  readonly focused: boolean;
  readonly validation: ValidationResult;
  readonly loading: boolean;
  readonly secure: boolean;
  readonly hostname: string;
  readonly suggestions: readonly string[];
}
```

**Events:** navigate, inputChanged, focus, blur, search, reload, stop

**URL-Smart Behavior:**
The AddressBar now integrates with `UrlParser` to provide intelligent input handling:
- On every `setValue()`, it runs `parser.validate()` and `parser.parse()` to determine validity, hostname, and security status.
- When input is a valid URL → emits `navigate` with the normalized URL.
- When input is a search query (detected via `parser.isSearchQuery()`) → emits `search` with the raw query text.
- Emits `inputChanged` with the full `ValidationResult` for every input change.

**View Features:**
- Protocol badge (lock icon for HTTPS)
- Editable URL input
- Loading spinner
- Suggestions dropdown with keyboard navigation (↑↓ arrows, Enter to select)
- Visual indicator for secure/insecure connections

### 15.7 Content Renderer

**File:** `src/ui/components/content-renderer/content-renderer.ts` (new)

A single-file component that renders all web content into the browser's content area. Unlike the Model+View components, this uses a simpler architecture with a single class that directly manipulates the DOM.

**Interface:**
```typescript
interface IContentRenderer extends IDisposable {
  attach(container: HTMLElement): void;
  renderHtml(html: string, options?: ContentRenderOptions): void;
  renderSearchResults(query: string, searchUrl: string, results: readonly SearchResult[]): void;
  renderError(title: string, message: string, url?: string): void;
  renderLoading(url: string): void;
  renderNewTab(): void;
  clear(): void;
}
```

**Rendering Modes:**

| Method | Purpose |
|--------|---------|
| `renderHtml()` | Writes raw HTML into a sandboxed iframe (`allow-same-origin allow-scripts allow-forms allow-popups`) |
| `renderSearchResults()` | Renders a Google-style search results page with clickable links |
| `renderError()` | Displays a centered error page with title, message, and URL |
| `renderLoading()` | Shows an animated CSS spinner with the target hostname |
| `renderNewTab()` | Displays the Nova branding new-tab page |
| `clear()` | Empties the content area |

**Search Result Navigation:**
Result links dispatch a `nova-navigate` CustomEvent (bubbling) with `{ detail: { url } }`. The parent `BrowserWindowPage` listens for this event and triggers a full navigation — this avoids iframe cross-origin restrictions while still allowing in-content link clicks.

**Security:**
All user-provided strings (search queries, URLs) are HTML-escaped via `escapeHtml()` before insertion into the DOM, preventing XSS through malicious search terms or result titles.

---

## 16. Desktop Layout & Browser Window Page

### 16.1 Desktop Layout

**File:** `src/ui/layout/desktop-layout.ts`

Defines the overall page structure matching the demo.html prototype:

```
┌──────────────────────────────────────────┐
│              Toolbar Area                │
│  [←→↻⟳] [Address Bar Slot] [🔖🛡]      │
├──────────────────────────────────────────┤
│              Tab Strip Area              │
│  [Tab 1] [Tab 2] [Tab 3] [+]           │
├──────────────────────────────────────────┤
│           Bookmark Bar Area              │
│  [📁Work] [Example] [GitHub] [+]        │
├──────────────────────────────────────────┤
│             Content View Area            │
│                                          │
│           (web content here)             │
│                                          │
├──────────────────────────────────────────┤
│             Status Bar Area              │
│  Done  |  🔍 2 blocked  |  🔒 HTTPS     │
└──────────────────────────────────────────┘
```

**Areas Interface:**
```typescript
interface LayoutAreas {
  toolbar: HTMLElement | null;
  tabBar: HTMLElement | null;
  bookmarkBar: HTMLElement | null;
  content: HTMLElement | null;
  statusBar: HTMLElement | null;
}
```

**Methods:**
- `build()` — creates all DOM elements with proper CSS classes
- `attach(container)` — appends layout to a parent element
- `detach()` — removes layout from DOM
- `getArea(name)` — returns a specific area element

### 16.2 Browser Window Page

**File:** `src/ui/pages/browser-window.ts`

The **main orchestrator** that wires all UI components to browser core services.

**Initialization Flow:**
1. Create `DesktopLayout` and attach to container
2. Create `TabManager` instance
3. Create `TrackerBlocker` and `AdBlocker` instances
4. Create `Toolbar` + `ToolbarView`, attach to layout toolbar area
5. Create `TabStrip` + `TabStripView`, attach to layout tab bar area
6. Create `AddressBar` + `AddressBarView`, attach to toolbar's address bar slot
7. Create `BookmarkBar` + `BookmarkBarView`, attach to layout bookmark bar area
8. Create `StatusBar` + `StatusBarView`, attach to layout status bar area
9. Wire all event handlers between components
10. Create `ContentRenderer`, attach to content area, render new-tab page
11. Listen for `nova-navigate` CustomEvents from rendered content (search result links)
12. Create initial tab and render new tab page

**Event Wiring:**

```
Toolbar "back"        → BrowserWindowPage.goBack()
Toolbar "forward"     → BrowserWindowPage.goForward()
Toolbar "reload"      → BrowserWindowPage.reload()
Toolbar "stop"        → BrowserWindowPage.stop()
Toolbar "shieldToggle" → TrackerBlocker.setEnabled() + AdBlocker.setEnabled()
Toolbar "bookmarkAdd"  → BookmarkBar.addBookmark(currentTab.url)

TabStrip "tabSelected"    → TabManager.activateTab()
TabStrip "tabClosed"      → TabManager.removeTab()
TabStrip "newTabRequested" → TabManager.createTab()

AddressBar "navigate"  → BrowserWindowPage.navigate(url)
AddressBar "search"    → BrowserWindowPage.navigate(query) (treated as search)
AddressBar "reload"    → BrowserWindowPage.reload()
AddressBar "stop"      → BrowserWindowPage.stop()

BookmarkBar "bookmarkClicked" → BrowserWindowPage.navigate(bookmark.url)

StatusBar "shieldClicked" → Toolbar.toggleShield()

ContentRenderer "nova-navigate" → BrowserWindowPage.navigate(detail.url)
```

**Navigation Flow:**
When `navigate(url)` is called:
1. Update address bar value
2. Set toolbar to loading state
3. Update status bar text to "Loading..."
4. Update tab URL and loading state
5. Show loading spinner in content area via `contentRenderer.renderLoading()`
6. **Search query detection:** If `parser.isSearchQuery(url)` returns true:
   - Build search URL via `parser.buildSearchUrl(url)`
   - Generate contextual search results via `generateSearchResults()`
   - Render search results page via `contentRenderer.renderSearchResults()`
7. **URL navigation:** Otherwise:
   - Normalize URL via `parser.normalize()`
   - Determine protocol and security from URL
   - Render content via `renderUrlContent()` which handles:
     - Special pages (`about:blank`, `nova://settings`, etc.)
     - Data URLs (rendered in iframe)
     - File URLs (file info display)
     - HTTP/HTTPS (hostname + URL display page)
     - Other protocols (protocol info display)
8. Update security indicators (HTTPS detection, protocol label)
9. Reset loading state
10. Sync all UI components

**Search Result Generation:**
`generateSearchResults(query)` produces contextual results based on keyword analysis:
- Always includes a DuckDuckGo search link and Wikipedia article
- Programming terms (javascript, python, etc.) → Stack Overflow result
- News terms (today, breaking, etc.) → Google News result
- Tutorial terms (how, guide, etc.) → Tutorial result
- Shopping terms (buy, price, etc.) → Reviews result
- Always includes a documentation/MDN result

**Protocol Label Mapping:**
`getProtocolLabel(scheme)` maps 60+ protocol schemes to human-readable labels (e.g., `https:` → `HTTPS`, `dns+udp:` → `DNS/UDP`, `ssh-tunnel:` → `SSH-TUNNEL`).

**Shield Toggle Flow:**
When the shield button is clicked:
1. Toolbar emits `shieldToggle` with `enabled` state
2. `BrowserWindowPage` calls `TrackerBlocker.setEnabled(enabled)`
3. `BrowserWindowPage` calls `AdBlocker.setEnabled(enabled)`
4. Status bar updates with "Shield enabled/disabled" message

---

## 17. Design System (CSS)

**File:** `styles.css` (598 lines)

A comprehensive dark-theme design system using CSS custom properties.

### 17.1 Color Palette

```css
/* Backgrounds */
--bg-body:     #0f0f0f;    /* page background */
--bg-surface:  #161618;    /* cards, panels */
--bg-elevated: #1c1c1e;    /* elevated surfaces */
--bg-raised:   #242426;    /* raised elements */
--bg-overlay:  rgba(255,255,255,.04);  /* hover states */
--bg-glass:    rgba(22,22,24,.85);     /* glass morphism */

/* Text */
--text-primary:   #f0eee6;  /* main text */
--text-secondary: #a0a098;  /* secondary text */
--text-tertiary:  #6a6a68;  /* muted text */
--text-accent:    #7c9cf5;  /* accent/links */
--text-danger:    #f06a6a;  /* errors, warnings */
--text-success:   #5fec7f;  /* success states */

/* Borders */
--border-subtle:  rgba(255,255,255,.06);
--border-default: rgba(255,255,255,.1);
--border-strong:  rgba(255,255,255,.15);
--border-accent:  rgba(124,156,245,.4);
```

### 17.2 Typography

```css
--font-sans:    Inter, system-ui, -apple-system, sans-serif;
--font-display: Poppins, Inter, sans-serif;
--font-mono:    'JetBrains Mono', 'Fira Code', monospace;
```

### 17.3 Spacing & Radii

```css
--radius-sm:   4px;
--radius-md:   6px;
--radius-lg:   10px;
--radius-xl:   14px;
--radius-full: 9999px;
```

### 17.4 Shadows & Effects

```css
--shadow-xs:    0 1px 2px rgba(0,0,0,.3);
--shadow-sm:    0 2px 8px rgba(0,0,0,.35);
--shadow-md:    0 4px 16px rgba(0,0,0,.4);
--shadow-lg:    0 8px 32px rgba(0,0,0,.5);
--shadow-glow:  0 0 20px var(--accent-glow);
```

### 17.5 Animations

```css
--curve:  cubic-bezier(.4,0,.2,1);
--t-fast: .12s var(--curve);  /* micro interactions */
--t-norm: .2s  var(--curve);  /* standard transitions */
--t-slow: .35s var(--curve);  /* page transitions */
```

### 17.6 Component Styles

The CSS defines styles for:
- `.address-bar` — glass morphism address bar with focus states
- `.toolbar` — navigation toolbar
- `.tab-strip` / `.tab` — tab styling with active/hover states
- `.bookmark-bar` — bookmark bar with item hover
- `.status-bar` — bottom status bar
- `.settings-page` — settings layout
- `.download-item` — download list items
- `.suggestion-dropdown` — address bar autocomplete

---

## 18. Dependency Injection Container

**File:** `src/app/dependency-container.ts`

A custom IoC (Inversion of Control) container supporting:

### 18.1 Service Lifetimes

- **Singleton:** One instance shared across all resolvers. Created on first resolve.
- **Transient:** New instance created on every resolve.

### 18.2 Registration

```typescript
container.register('UrlParser', UrlParser, ServiceLifetime.Singleton);
container.registerValue('Config', appConfig);
```

### 18.3 Resolution

```typescript
const parser = container.resolve<UrlParser>('UrlParser');
```

### 18.4 Safety Features

- **Duplicate detection:** Throws `DuplicateRegistrationError` if a token is registered twice
- **Missing service:** Throws `ServiceNotFoundError` if resolving an unregistered token
- **Circular dependency:** Detects and throws `CircularDependencyError` via a resolving stack
- **Disposal:** On `dispose()`, all singletons implementing `IDisposable` have their `dispose()` called

### 18.5 Registration in main.ts

The entry point registers **40+ services** including all browser core modules, UI components, storage layers, and security systems.

---

## 19. Testing Strategy

**Framework:** Vitest 1.6.1 with happy-dom environment

**Coverage:** v8 provider with 80% threshold

### 19.1 Test Suites (80 files, 3295 tests)

| Suite | Tests | What It Tests |
|-------|-------|---------------|
| `dependency-container.test.ts` | 17 | IoC container: lifetimes, errors, disposal, fluent API |
| `url-parser.test.ts` | 53 | URL parsing, validation, normalization, protocol blocking, search queries, search URL building, 26+ protocol tests |
| `navigation-controller.test.ts` | 39 | History stack, navigation state machine, guards, events |
| `html-parser.test.ts` | 35 | HTML tokenization, tree building, resource discovery |
| `dom-tree.test.ts` | 20 | DOM construction, mutations, indexing |
| `css5.test.ts` | 55 | CSS5 tokenizer, parser, selectors, cascade, computed styles |
| `layout-engine.test.ts` | 25 | Box model, positioning, formatting contexts |
| `flex-layout.test.ts` | 37 | Flexbox layout: direction, wrap, justify, align, grow/shrink |
| `grid-layout.test.ts` | 50 | CSS Grid: template tracks, fr units, auto-placement |
| `positioning.test.ts` | 37 | CSS positioning: static, relative, absolute, fixed, sticky |
| `stacking.test.ts` | 26 | Stacking context tree, z-index, paint order |
| `formatting-contexts.test.ts` | 67 | Block/inline/flex formatting, margin collapsing, floats |
| `line-break.test.ts` | 10 | UAX #14 line breaking, text segmentation |
| `text-measure.test.ts` | 10 | Heuristic and canvas text measurement |
| `rasterizer.test.ts` | 56 | Color parsing, fill/stroke, alpha compositing, text rendering |
| `reflow-repaint.test.ts` | 22 | Damage tracking, dirty flags, incremental layout/paint |
| `lazy-loading.test.ts` | 45 | IntersectionObserver, LazyLoader, image rendering |
| `js-engine.test.ts` | 107 | Lexer, parser, interpreter, DOM bindings, event loop |
| `script-execution.test.ts` | 26 | Script execution: blocking, defer, async, DOM modification |
| `integration.test.ts` | 25 | Full pipeline: HTML→DOM→CSS→Layout→Paint→Rasterize |
| `ad-blocker.test.ts` | 20 | Ad filtering, custom rules, categories, events |
| `tracker-blocker.test.ts` | 18 | Tracker blocking, domain matching, events |
| `third-party-security.test.ts` | 45 | Third-party policies, CSP, fingerprinting, trusted origins |
| `sandbox-manager.test.ts` | 15 | Sandbox creation, permission checking |
| `permission-manager.test.ts` | 30 | Permission requests, grants, denials, TTL |
| `certificate-validator.test.ts` | 25 | TLS validation, chain verification, expiry |
| `address-bar.test.ts` | 24 | Address bar model + event bus + search events |
| `toolbar.test.ts` | 18 | Toolbar model + shield toggle + events |
| `tab-strip.test.ts` | 14 | Tab strip sync, events, TabManager integration |
| `bookmark-bar.test.ts` | 18 | Bookmark bar CRUD, navigation, validation, events |
| `bookmark-services.test.ts` | 59 | Bookmark store CRUD, service logic, events, search |
| `status-bar.test.ts` | 13 | Status bar model + events |
| `history-service.test.ts` | 39 | History store, service, frecency, events |
| `download-manager.test.ts` | 37 | Download lifecycle, filename extraction, events |
| `settings-page.test.ts` | 16 | Settings sections, values, mount/unmount |
| `settings-store.test.ts` | 18 | Settings persistence, localStorage, corruption recovery |
| `settings-service.test.ts` | 18 | Settings service, change broadcasting, typed getters |
| `runtime-adapter.test.ts` | 18 | Environment detection, platform APIs |
| `window-manager.test.ts` | 21 | Window lifecycle, bounds, events |
| `content-renderer.test.ts` | 14 | Content rendering, search results, errors, loading, HTML escaping |
| `resource-prioritizer.test.ts` | 25 | Priority resolution, batch loading, bandwidth demotion |
| `priority-queue.test.ts` | 18 | Enqueue/dequeue ordering, stress test, heap property |
| `bandwidth-estimator.test.ts` | 13 | Bandwidth estimation, tier detection, demotion |
| `resource-loader.test.ts` | 10 | Cache integration, priority queue, error handling |
| `connection-pool.test.ts` | 15 | Connection reuse, multiplexing, limits |
| `dns-resolver.test.ts` | 12 | DNS resolution, caching, overrides |
| `firewall.test.ts` | 20 | Rule matching, allow/deny, baseline rules |
| `networking-setup.test.ts` | 10 | Firewall creation, guard socket |
| `ip-protocol.test.ts` | 100 | IPv4/IPv6, CIDR, PNA, DNS, Happy Eyeballs |
| `ip-adapter.test.ts` | 23 | System resolver, PNA enforcement |
| `tab-process-adapter.test.ts` | 18 | Tab context ↔ process manager bridge |
| `ipc.test.ts` | 64 | Message protocol, serializer, transport, channel, proxy, process manager |
| `crash-recovery.test.ts` | 88 | TabContext, ScriptGuard, ErrorBoundary, ProcessGuard, CrashReporter |
| `content-security-policy.test.ts` | 179 | CSP parser, evaluator, reporter, policy-store, navigation-guard, resource-enforcer, script-enforcer, sandbox-enforcer |
| `navigation-bridge.test.ts` | 29 | NavigationBridge orchestration, re-entrancy guard, blocked protocols |
| `bookmarks-history.test.ts` | 48 | BookmarksService, HistoryService, UI rendering |
| `devtools.test.ts` | 99 | Console, Network Monitor, DOM Inspector, DevTools facade |
| `page-loader.test.ts` | 14 | PageLoader: loading, mapping, signals, errors, disposal |
| `page-renderer.test.ts` | 22 | PageRenderer: pipeline execution, signals, disposal, accessors |

### 19.2 Testing Patterns

**Unit Tests:** Most tests are pure unit tests that instantiate a class, call methods, and assert results. No DOM mocking needed for model tests.

**Event Testing:** Event buses are tested by registering handlers via `vi.fn()`, emitting events, and asserting the handler was called with correct arguments.

**Error Testing:** Exception handling is tested by registering handlers that throw, then verifying the error is caught and logged without crashing the bus.

**Async Testing:** BookmarkBar tests use `async/await` since the unified system delegates to async `BookmarkService` methods.

---

## 20. What Was Built, Session by Session

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

1. **`url-parser.ts`** — Added `SINGLE_LABEL_HOSTNAME_RE` regex to handle bare hostnames like `www` that were not being parsed correctly. This regex is placed before the `ANY_SCHEME_RE` check so single-label inputs are caught early.

2. **`third-party-security.ts`** — Added and exported `stripWwwPrefix()` helper function that safely removes `www.` prefix from hostnames, preserving edge cases like `www.com` (no dot after removing prefix) and `www-something.com` (not a real www prefix).

### Session 3: UI Components (Model+View)

Created four complete UI components, each following the two-file Model+View pattern:

1. **Tab Strip** (`src/ui/components/tab-strip/`)
   - Model: `TabStrip` class with `TabStripEventBus`, state tracking via `TabManager` sync
   - View: `TabStripView` with favicon, title, close button, drag reorder, "+" button, context menu
   - Tests: 14 tests covering state, sync, events, disposal

2. **Bookmark Bar** (`src/ui/components/bookmark-bar/`)
   - Model: `BookmarkBar` class with localStorage persistence, folder navigation
   - View: `BookmarkBarView` with horizontal scrollable list, back button, add button
   - Tests: 16 tests covering CRUD, folders, events

3. **Status Bar** (`src/ui/components/status-bar/`)
   - Model: `StatusBar` class tracking status text, URL, protocol, security, zoom, blocked count
   - View: `StatusBarView` with status display, shield button, security badge
   - Tests: 13 tests covering state and events

4. **Toolbar** (`src/ui/components/toolbar/`)
   - Model: `Toolbar` class with navigation state, shield toggle
   - View: `ToolbarView` with traffic lights, nav buttons, shield/bookmark buttons
   - Tests: 18 tests covering all button events

### Session 4: Layout Integration & Browser Window Page

**Changes Made:**

1. **Desktop Layout** (`src/ui/layout/desktop-layout.ts`) — Updated to add `toolbar` area (replacing separate `addressBar` area), matching the demo.html `title-bar` layout.

2. **Browser Window Page** (`src/ui/pages/browser-window.ts`) — Full rewrite to:
   - Create `TabManager` and all four UI components
   - Attach views to `DesktopLayout` areas
   - Wire event handling between components (toolbar → navigation, tab strip → tab manager, bookmark bar → navigation, address bar → navigation)
   - Implement navigation simulation (placeholder for real rendering)
   - Implement reload, back, forward, stop operations

### Session 5: Security Hardening

**Bookmark Security:**

1. **`bookmark-validator.ts`** (new) — Created `BookmarkValidator` class:
   - `validateBookmark(url, title)` — blocks dangerous URL schemes, sanitizes titles
   - `validateTitle(title)` — strips control characters, enforces length limits
   - Blocked schemes: `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `about:`

2. **`bookmark-store.ts`** — Two fixes:
   - **Secure IDs:** Replaced `nextId++` sequential counter with `generateSecureId()` using `crypto.randomUUID()` with `crypto.getRandomValues()` fallback
   - **Prototype pollution fix:** `update()` method now explicitly picks known properties (`title`, `url`, `parentId`, `folder`) instead of spreading arbitrary `...changes` which could inject prototype properties

3. **`bookmark-services.ts`** — Updated `addBookmark()` and `updateBookmark()` to validate URLs and titles through `BookmarkValidator` before persisting

**Shield Toggle Wiring:**

4. **`browser-window.ts`** — Imported `TrackerBlocker` and `AdBlocker`, created instances, wired the `shieldToggle` event to call `setEnabled()` on both blocking systems

**Domain Matching Fixes:**

5. **`tracker-blocker.ts`** — Replaced `String.includes()` domain matching with proper `matchesDomain()` function that checks exact domain match or subdomain boundary (`.endsWith('.' + d)`)

6. **`ad-blocker.ts`** — Three changes:
   - Added `matchesAdPattern()` with proper hostname extraction and domain boundary checks
   - Added `validateCustomAdRule()` that rejects empty, oversized, or injection-pattern rules
   - Updated `shouldBlock()` to use `matchesAdPattern()` instead of `String.includes()`
   - Updated `addCustomRule()` to validate before accepting

**Third-Party Origin Comparison:**

7. **`third-party-security.ts`** — Updated `isThirdParty()` to use `stripWwwPrefix()` so `www.example.com` and `example.com` are treated as same-party

**Permission Request Recording:**

8. **`permission-manager.ts`** — Fixed `request()` to push entries to the `requests` array when a permission is requested in `prompt` state

**BookmarkBar Unification:**

9. **`bookmark-bar.ts`** — Complete rewrite to use backend `BookmarkService` instead of standalone localStorage:
   - All methods are now async (delegating to `BookmarkService`)
   - Uses `BookmarkValidator` for input validation
   - Added rate limiting to event bus (max 100 emits)
   - Navigation: `navigateIntoFolder()` / `navigateUp()`

10. **`bookmark-bar.view.ts`** — Updated to work with `BookmarkEntry` type (with `folder: boolean` flag) instead of the old `Bookmark` type

11. **`bookmark-bar.test.ts`** — Rewritten for new async API with 18 tests

### Final State: 470 Tests Passing

All 18 test suites pass with 470 individual test cases. No pre-existing test failures.

### Session 6: Content Rendering, Search Integration & Protocol Expansion

**Content Renderer Component (New):**

1. **`content-renderer.ts`** (new) — Created `ContentRenderer` class implementing `IContentRenderer`:
   - `renderHtml()` — renders raw HTML into a sandboxed iframe (`allow-same-origin allow-scripts allow-forms allow-popups`)
   - `renderSearchResults()` — renders a Google-style search results page with clickable links, breadcrumbs, and footer
   - `renderError()` — displays centered error page with title, message, and URL
   - `renderLoading()` — animated CSS spinner with hostname display
   - `renderNewTab()` — Nova branding new-tab page
   - HTML escaping via `escapeHtml()` to prevent XSS in search queries and result titles
   - `nova-navigate` CustomEvent dispatch for link clicks (bubbles to parent)

2. **`content-renderer.test.ts`** (new) — 14 tests covering:
   - HTML rendering into sandboxed iframe
   - Search result rendering with clickable links
   - No-results message
   - `nova-navigate` event dispatch on link click
   - Error page rendering (with and without URL)
   - Loading spinner rendering
   - New tab branding display
   - Clear/dispose lifecycle
   - HTML escaping for XSS prevention

**URL Parser Expansion:**

3. **`url-parser.ts`** — Three major additions:
   - **`isSearchQuery(input)`** — detects plain text that should be treated as a search query rather than a URL. Returns `true` when input is not a valid URL, not a bare hostname, not an IP address, and not scheme-prefixed.
   - **`buildSearchUrl(query, engineUrl?)`** — constructs a search-engine URL by replacing the `%s` placeholder. Defaults to DuckDuckGo.
   - **`ALLOWED_PROTOCOLS` expanded** with 40+ gateway protocols across seven categories: Proxy, DNS, Tunnel, NAT, Access, Load Balancer, CDN, and Discovery.
   - **`BLOCKED_PROTOCOLS` reduced** — removed `data:`, `blob:`, `ws:`, `wss:` from the blocked list (now allowed). Only `javascript:` and `vbscript:` remain blocked.
   - **`isSecure` detection expanded** to cover all encrypted gateway protocols (https-proxy, tls+dns, ssh-tunnel, etc.)

4. **`url-parser.test.ts`** — Expanded from 37 to 53 tests:
   - 26 new protocol tests (HTTP, WS, WSS, FTP, FTPS, SFTP, mailto, tel, sms, smsto, ssh, magnet, news, nntp, gopher, wais, data, blob)
   - `isSearchQuery()` tests (plain text, multi-word, empty, valid URLs, bare hostnames, localhost, IPv4, schemes, special characters, non-English)
   - `buildSearchUrl()` tests (default DuckDuckGo, special characters, custom engine, empty query, placeholder replacement)
   - `ALLOWED_PROTOCOLS` coverage tests (web, WebSocket, file transfer, internal, external, legacy, usenet)
   - `BLOCKED_PROTOCOLS` verification (javascript/vbscript blocked, ws/wss/data/blob no longer blocked)

**Address Bar Search Integration:**

5. **`address-bar.ts`** — Enhanced with URL-smart behavior:
   - Integrated `IUrlParser` via constructor injection (replaces hardcoded `UrlParser`)
   - `setValue()` now runs `parser.validate()` and `parser.parse()` on every input
   - Emits `search` event when `parser.isSearchQuery()` returns true
   - Emits `navigate` event when input is a valid URL
   - Emits `inputChanged` with full `ValidationResult` for every change
   - State now includes `validation: ValidationResult` and `hostname: string` (was `Suggestion[]` and `string | null`)

6. **`address-bar.test.ts`** — Expanded from 16 to 24 tests:
   - Search event tests (plain text → search, valid URL → navigate not search, bare hostname → navigate not search, empty input → no search)
   - Combined inputChanged + search event emission

**Browser Window Page — Content Rendering & Search:**

7. **`browser-window.ts`** — Major enhancements to the main orchestrator:
   - Integrated `ContentRenderer` for actual content display (replaces placeholder timeout)
   - Added `ContentRenderer` creation and attachment during mount
   - Added `nova-navigate` event listener for search result link clicks
   - Added `navigate()` rework with search query detection path
   - Added `generateSearchResults(query)` — contextual search results based on keyword analysis (programming, news, tutorial, shopping categories)
   - Added `renderUrlContent(url)` — protocol-specific content rendering for special pages, data URLs, file URLs, HTTP/HTTPS, and other protocols
   - Added `getProtocolLabel(scheme)` — maps 60+ protocol schemes to human-readable labels
   - Added `isSecureProtocol(scheme)` — expanded to cover all encrypted gateway protocols
   - Navigation now shows loading spinner in content area, then renders appropriate content
   - `unmount()` now disposes `ContentRenderer` and removes event listener

### Final State: 1157 Tests Passing

All 19 test suites pass with 1157 individual test cases. No pre-existing test failures.

### Session 7: UI Cleanup & Formatting Tests

**Tab Strip Listener Leak Fix:**

1. **`tab-strip.ts`** — Fixed listener leak in `syncWithManager()` where `TabManager.on()` was called on every sync without removing previous listeners. Now stores and removes previous handlers before adding new ones.

**Formatting Context Tests (New):**

2. **`formatting-contexts.test.ts`** (new) — 67 new tests covering:
   - `classifyDisplay()` — block, inline, flex, grid, list-item classification
   - `isBlockLevel()` — block-level element detection
   - `classifyChildren()` — child classification for formatting contexts
   - Margin collapsing — adjacent block margins, parent-child margins, clearing
   - Anonymous block generation — inline nodes wrapped in anonymous blocks
   - Inline formatting context — line box construction, baseline alignment
   - Float context — float placement, clearance, content flow
   - Vertical alignment — baseline, top, bottom, middle alignment
   - Box model resolution — margin, padding, border calculations

### Session 8: Resource Prioritization

**Priority Queue (New):**

1. **`priority-queue.ts`** (new) — Generic priority queue with min-heap implementation:
   - `enqueue(item, priority)` — add item with priority weight
   - `dequeue()` — remove highest priority item
   - `peek()` — view highest priority item without removal
   - `drain()` — remove all items in priority order
   - `remove(predicate)` — remove matching items
   - `filter(predicate)` — view matching items
   - `clear()` — empty the queue

**Bandwidth Estimator (New):**

2. **`bandwidth-estimator.ts`** (new) — Network bandwidth estimation:
   - Records transfer samples (bytes/time)
   - Calculates moving average bandwidth
   - Determines bandwidth tier: fast (>1 Mbps), medium (100K-1Mbps), slow (<100K)
   - Suggests resource demotion based on bandwidth
   - Recommends concurrency limits per tier

**Resource Prioritizer (New):**

3. **`resource-prioritizer.ts`** (new) — Priority-aware resource loading:
   - `submit(resource)` — queue resource with computed priority
   - `submitBatch(resources)` — queue multiple resources
   - `submitPreload(url, as)` — high-priority preload
   - `submitPrefetch(url)` — low-priority prefetch
   - `submitPreconnect(url)` — connection pre-establishment
   - Priority resolution: blocking > high > normal > low > deferred
   - Fetchpriority attribute support (`fetchpriority="high"`)
   - Bandwidth-based demotion
   - Concurrency adjustment per tier

**Cache Integration:**

4. **`resource-loader.ts`** — Updated to integrate with priority queue and bandwidth estimator for smarter resource loading decisions.

### Session 9: Profiling & Benchmarking Toolkit

**Benchmark Framework (New):**

1. **`benchmarks/`** (new directory) — 51 benchmarks across all subsystems:
   - HTML parsing benchmarks (tokenization, tree building)
   - CSS parsing benchmarks (tokenization, selector matching, cascade)
   - Layout engine benchmarks (block layout, inline layout, float positioning)
   - JS engine benchmarks (lexer, parser, interpreter, DOM bindings)
   - Paint/rasterizer benchmarks (fill, stroke, text, compositing)
   - Pipeline benchmarks (end-to-end render cycle)
   - Memory profiling benchmarks (allocation, GC pressure)

**Memory Profiling:**

2. **Memory leak detection** — Tracks allocation patterns, detects leaks via heap snapshots, measures GC pressure across different operations.

### Session 10: Memory Management Audit

**Leak Fixes:**

1. **Timer leak fixes** — Identified and fixed timer leaks in `EventLoop`, `LazyLoader`, and `FrameScheduler` where `setInterval`/`setTimeout` handles were not properly cleared on disposal.

2. **Disposal chain fixes** — Ensured all disposable resources have proper `dispose()` implementations that cascade to owned resources.

3. **idIndex cleanup** — Fixed `DomTree.idIndex` leak where elements with `id` attributes were not properly removed from the index on `removeChild()`.

4. **Size caps** — Added configurable maximum sizes to unbounded stores:
   - `PermissionManager`: max 5000 stored decisions with LRU eviction
   - `HistoryStore`: max 10000 entries with oldest-first eviction
   - `BookmarkStore`: max 5000 entries with warning on overflow

5. **Stale reference cleanup** — Added periodic cleanup of stale event handlers and weak references in security modules.

### Session 11: Crash Recovery & Isolation

**Per-Tab Isolation:**

1. **`tab-context.ts`** (new) — `TabContextManager` creates isolated contexts per tab:
   - Each tab gets its own `DomTree`, `LayoutEngine`, `PaintEngine`, `EventLoop`
   - Crash metadata (phase, error, recovery state) is per-tab
   - Context lifecycle: create → active → crashed → recovered/destroyed

**Script Guard:**

2. **`script-guard.ts`** (new) — Limits script execution:
   - Maximum execution time per script (default 5000ms)
   - Maximum instruction count (default 1,000,000)
   - Maximum call stack depth (default 500)
   - Timeout enforcement via `Promise.race`

**Error Boundary:**

3. **`error-boundary.ts`** (new) — Catches and isolates errors:
   - Wraps function execution with try/catch
   - Records error metadata (type, message, stack, timestamp)
   - Emits error events for monitoring
   - Prevents error propagation across tab boundaries

**Process Guard:**

4. **`process-guard.ts`** (new) — Monitors tab process health:
   - Tracks memory usage per tab
   - Detects runaway processes (excessive CPU/memory)
   - Triggers forced termination on threshold breach

**Crash Reporter:**

5. **`crash-reporter.ts`** (new) — Records crash information:
   - Builds structured crash reports with metadata
   - Stores crash history for analysis
   - Provides crash statistics and trending

**Lifecycle Manager:**

6. **`lifecycle-manager.ts`** — Enhanced with ordered startup/shutdown phases, guard checks, and state machine (Idle → Starting → Running → Stopping).

### Session 12: IPC System

**Message Protocol:**

1. **`message-protocol.ts`** (new) — Typed message serialization:
   - JSON-based message format with type discriminators
   - Support for primitives, arrays, objects, Date, RegExp, Map, Set
   - Circular reference detection and handling
   - Binary data support via Uint8Array

**Serializer:**

2. **`serializer.ts`** (new) — Deep serialization/deserialization:
   - `toJSON(value)` — convert to portable JSON
   - `fromJSON(json)` — restore original types
   - Handles special types: Date, RegExp, Map, Set, undefined, BigInt
   - Pre-process/post-process approach for clean serialization

**Transport:**

3. **`transport.ts`** (new) — Message transport layer:
   - `send(message)` — send message to remote
   - `onMessage(handler)` — receive messages from remote
   - Supports both direct function calls and event-based communication

**Channel:**

4. **`channel.ts`** (new) — Named communication channels:
   - 38 pre-defined channel names for common operations
   - `createChannel(name)` — create typed channel
   - `sendMessage(channel, data)` — send on specific channel
   - `onMessage(channel, handler)` — listen on specific channel

**Service Proxy:**

5. **`service-proxy.ts`** (new) — Remote method invocation:
   - `call(method, args)` — invoke remote method
   - `on(method, handler)` — register remote method handler
   - Promise-based return values
   - Error propagation across process boundaries

**Process Manager:**

6. **`process-manager.ts`** (new) — Tab process lifecycle:
   - `createProcess(tabId)` — spawn new process for tab
   - `destroyProcess(tabId)` — terminate process
   - `sendMessage(tabId, message)` — send message to tab process
   - Process health monitoring and crash detection

### Session 13: IP Protocol & Network Stack

**IP Protocol Layer:**

1. **`ip-protocol.ts`** (new) — Complete IP implementation:
   - IPv4 and IPv6 address parsing and validation
   - CIDR notation support
   - Private Network Access (PNA) detection
   - DNS resolution with system resolver
   - Happy Eyeballs algorithm for dual-stack connections
   - Connection pool with per-host limits

**IP Adapter:**

2. **`ip-adapter.ts`** (new) — Bridges IP protocol to browser:
   - `createIPSystemResolver()` — system DNS resolver
   - `PNAEnforcingHttpClient` — blocks cross-origin private network requests
   - Integrates with `RequestManager` for HTTP operations

**Tab-Process Adapter:**

3. **`tab-process-adapter.ts`** (new) — Bridges tab contexts with process management:
   - `TabProcessManager` coordinates `TabContextManager` ↔ `ProcessManager`
   - Tab lifecycle events propagate to process lifecycle
   - Crash recovery triggers process restart

**Firewall:**

4. **`firewall.ts`** (new) — Network access control:
   - Rule-based filtering (allow/deny per protocol, host, port)
   - Default-deny posture (secure by default)
   - Baseline rules: block mDNS (5353), NetBIOS (137-139), SSDP (1900)
   - Allow rules: HTTP (80), HTTPS (443)
   - `firewallGuardedOpenSocket()` wraps socket creation

**Networking Setup:**

5. **`networking-setup.ts`** (new) — Factory for networking stack:
   - `createFirewallGuardedNetworking()` — composes Firewall + IP Protocol
   - Configurable per-deployment

### Session 14: Settings Integration

**Settings Store:**

1. **`settings-store.ts`** — Persistent key-value storage:
   - `get(key)` / `set(key, value)` — basic CRUD
   - `has(key)` / `delete(key)` / `clear()` — existence and bulk operations
   - `getAll()` / `keys()` — enumeration
   - Persistence to `localStorage` with JSON serialization
   - Corruption recovery (returns defaults on parse failure)

**Settings Service:**

2. **`settings-service.ts`** (new) — DI-friendly settings facade:
   - `getValue(key)` / `setValue(key, value)` — type-safe access
   - `getBoolean(key)` / `getString(key)` / `getNumber(key)` — typed getters with fallbacks
   - `has(key)` — existence check
   - `init()` — sync with `BrowserWindowPage` settings
   - Change broadcasting via `onChange()` events
   - `resetAll()` — restore defaults

**Settings Page:**

3. **`settings-page.ts`** — Settings UI with sections:
   - General, Appearance, Privacy, Security, Advanced sections
   - Each section has configurable settings with defaults
   - Mount/unmount lifecycle with event wiring

### Session 15: Developer Tools

**Console Service:**

1. **`console-service.ts`** (new) — Browser console:
   - `log()`, `warn()`, `error()`, `info()`, `debug()` — typed logging
   - Message formatting with object inspection
   - Duplicate message collapsing
   - Maximum message history (1000 entries)
   - Clear and filter capabilities

**Network Monitor:**

2. **`network-monitor.ts`** (new) — Network request inspection:
   - Records all HTTP requests with timing
   - Timing phases: DNS, connect, TLS, send, wait, receive
   - Firewall decision tracking
   - HAR export for debugging
   - Request/response body inspection

**DOM Inspector:**

3. **`dom-inspector.ts`** (new) — DOM tree inspection:
   - CSS selector-lite engine (tag, id, class, attribute selectors)
   - Tree walking with depth-first traversal
   - Element highlighting and selection
   - Computed style inspection
   - Box model visualization

**DevTools Facade:**

4. **`devtools.ts`** (new) — Unified DevTools interface:
   - Combines Console, Network, Inspector
   - `open()` / `close()` — visibility control
   - `console` / `network` / `inspector` — sub-service access
   - Event aggregation from all sub-services

### Session 16: Bookmarks/History UI Conversion

**Vitest Migration:**

1. **Test conversion** — Converted 48 tests from custom mini-framework to Vitest:
   - `bookmarks-history.test.ts` — 48 tests covering:
     - `BookmarksService` — CRUD operations, search, events
     - `HistoryService` — Visit recording, frecency, events
     - `renderBookmarksPanel()` — UI rendering
     - `renderHistoryPage()` — UI rendering
     - `renderBookmarkStarButton()` — Star toggle
     - `injectStyles()` — CSS injection

### Session 17: Navigation Bridge

**NavigationBridge (New):**

1. **`navigation-bridge.ts`** (new) — Orchestration layer:
   - Wires `Toolbar` ↔ `AddressBar` ↔ `NavigationController` ↔ `TabManager` ↔ `StatusBar`
   - Re-entrancy guard (`_navigating` boolean)
   - Blocked protocol detection (`javascript:`, `data:`)
   - Search query detection (`isSearchQuery()`)

**Address Bar Enhancements:**

2. **`address-bar.ts`** — Keyboard shortcuts:
   - `Ctrl+L` / `Cmd+L` — focus address bar
   - `Escape` — blur address bar
   - `Enter` — navigate or search

**Browser Window Page Wiring:**

3. **`browser-window.ts`** — NavigationBridge integration:
   - Creates and wires `NavigationBridge`
   - Connects all UI components through bridge

### Session 18: Content Security Policy

**CSP Parser:**

1. **`csp-parser.ts`** (new) — Parses CSP headers:
   - Handles CSP Level 1–3 keywords
   - Nonce/hash source support
   - Scheme, host, port, path source parsing
   - IP CIDR support
   - Wildcard (`*`) handling

**CSP Evaluator:**

2. **`csp-evaluator.ts`** (new) — Evaluates CSP policies:
   - `evaluateCsp(url, policy, directive)` — check if URL is allowed
   - Directive → default-src fallback chain
   - Nonce/hash/unsafe-inline/unsafe-eval/strict-dynamic support

**CSP Reporter:**

3. **`csp-reporter.ts`** (new) — CSP violation reporting:
   - Collects violation reports
   - Batches submissions
   - Rate limiting to prevent flooding

**CSP Policy Store:**

4. **`csp-policy-store.ts`** (new) — Per-origin CSP storage:
   - `setPolicy(origin, policy)` — store CSP for origin
   - `getPolicy(origin)` — retrieve CSP
   - LRU eviction, TTL expiration

**CSP Navigation Guard:**

5. **`csp-navigation-guard.ts`** (new) — CSP navigation enforcement:
   - `canNavigate(url, policy)` — check if navigation is allowed
   - Compatible with `NavigationController` guard interface

**CSP Resource Enforcer:**

6. **`csp-resource-enforcer.ts`** (new) — CSP resource loading enforcement:
   - Checks `script-src`, `style-src`, `img-src`, `connect-src`, etc.
   - Reports violations

**CSP Script Enforcer:**

7. **`csp-script-enforcer.ts`** (new) — CSP script execution enforcement:
   - Routes workers to `worker-src` directive
   - Uses `worker-src`/`child-src`/`script-src` fallback chain
   - Checks nonces and hashes for inline scripts

**CSP Sandbox Enforcer:**

8. **`csp-sandbox-enforcer.ts`** (new) — CSP sandbox enforcement:
   - Empty sandbox token = fully sandboxed per HTML spec
   - Enforces sandbox flags

### Session 19: PageLoader & PageRenderer Extraction

**PageLoader (New):**

1. **`page-loader.ts`** (new) — Standalone page loading:
   - Implements `IPageLoader` interface
   - Wraps `IResourceLoader` for dependency injection
   - Maps `ResourceLoadResult` → `PageLoadResult`
   - Propagates abort signals
   - Error handling for network failures

**PageRenderer (New):**

2. **`page-renderer.ts`** (new) — Standalone rendering pipeline:
   - Implements `IPageRenderer` interface
   - Full pipeline: HTML parse → DOM build → CSS extract → style computation → script execution → layout → lazy load → paint
   - Extracts 6 helper methods from `main.ts`
   - Proper signal propagation through entire pipeline
   - Dependencies injected via constructor

**Main.ts Cleanup:**

3. **`main.ts`** — Removed inline adapters:
   - Removed `createPageLoader()` method
   - Removed `createPageRenderer()` method
   - Removed 6 helper methods (`applyComputedStyles`, `buildCss5Stylesheet`, `buildStyleableTree`, `applyStylesRecursive`, `executeAllScripts`, `resolveUrl`)
   - Updated wiring to use new classes

**Tests:**

4. **`page-loader.test.ts`** (new) — 14 tests covering:
   - Successful page load
   - Correct parameter passing
   - Result mapping
   - Abort signal propagation
   - Network error handling
   - Disposal behavior
   - Interface compliance

5. **`page-renderer.test.ts`** (new) — 22 tests covering:
   - Full pipeline execution
   - HTML parsing with correct parameters
   - DOM tree building
   - Resource submission to prioritizer
   - CSS extraction
   - Layout computation
   - Paint execution
   - Abort signal propagation
   - Disposal behavior
   - Accessor methods

### Final State: 3295 Tests Passing

80 test files pass with 3295 individual test cases. 2 pre-existing failures in `memory-management.test.ts` (PermissionManager cap behavior).

---

## 21. Known Issues & Future Work

### 21.1 Pre-existing Issues

1. **Misspelled directory:** `src/browser/netwroking/` (should be `networking`)
2. **Misspelled script:** `scripts/bulid.sh` (should be `build.sh`)
3. **Pre-existing TS errors:** `dom-tree.ts` has a read-only property assignment issue; `navigation-controller.test.ts` has a missing `value` property — these are unrelated to our changes

### 21.2 Potential Future Work

1. **Rate limiting on security event buses:** `ThirdPartySecurityManager` and `AdBlocker` event buses could flood handlers during heavy blocking. Adding rate limiting similar to `BookmarkBarEventBus` would improve resilience.

2. **Real network fetching:** `ContentRenderer` currently renders placeholder content for HTTP/HTTPS pages. Connecting to the actual `BrowserEngine` pipeline (fetch → HTML parse → DOM build → layout → paint) would render real web pages.

3. **Electron integration:** The platform layer has Electron type declarations and window management, but the actual Electron main process wiring is not yet connected.

4. **Dashboard integration:** The React new-tab dashboard exists as a separate sub-project but is not yet wired into the browser's new-tab page.

5. **Search engine API connection:** `generateSearchResults()` currently produces synthetic results based on keyword matching. Connecting to a real search API (DuckDuckGo, Google, etc.) would provide actual results.

6. **History integration:** `HistoryService` can auto-record from `NavigationController` but `BrowserWindowPage` doesn't yet connect them.

7. **Download integration:** `DownloadManager` exists but isn't wired to handle actual file downloads from navigation.

---

*Document generated from codebase analysis. Covers all modules, their interactions, the development process, security improvements, and testing strategy. Last updated: Session 19 — PageLoader & PageRenderer Extraction.*
