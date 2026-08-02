# Protocols & Rendering Tools Inventory

**Date:** 2026-08-01
**Session:** Comprehensive inventory of every URL protocol/scheme and every rendering tool in Nova Browser
**Status:** Completed

---

## Summary
Reference inventory of all protocols/schemes the browser recognizes (across every registry, handler, and security gate) and all rendering tools (with the exact circumstances in which each is used). Research-only; no source changes.

---

## Part 1 — Protocols (all formats)

Scheme handling is centralized in four registries:

| Registry | File | Role |
|---|---|---|
| `ALLOWED_PROTOCOLS` / `BLOCKED_PROTOCOLS` / `SPECIAL_PAGES` | `src/browser/navigation/url-parser.ts` | Address-bar parse gate (scheme allow-list, security block-list, special-page aliases) |
| `BUILT_IN_PROTOCOLS` | `src/browser/networking/protocol-handler.ts` | Scheme → handler metadata (type/label/encryption/port/transport/OS-scheme) |
| `BUILT_IN_GATEWAYS` | `src/browser/networking/gateway-protocols.ts` | 48 gateway schemes (proxy/DNS/tunnel/NAT/access/LB/CDN/discovery) |
| Router built-in routes | `src/browser/navigation/router.ts` | Scheme/pattern → RouteType + page handler |

Flow: address bar → `NavigationBridge` → `UrlParser.parse()` (allow/block gate) → `NavigationController` (guards) → `Router.match()` (route table) → render pipeline.

### 1. `ALLOWED_PROTOCOLS` (93) — `url-parser.ts:251`
- Web: `http:`, `https:`
- WebSocket: `ws:`, `wss:`
- File transfer: `ftp:`, `ftps:`, `sftp:`
- Local: `file:`
- Internal: `data:`, `blob:`, `about:`, `nova:`
- External: `mailto:`, `tel:`, `sms:`, `smsto:`, `ssh:`
- Torrent: `magnet:` · Usenet: `news:`, `nntp:` · Legacy: `gopher:`, `wais:`
- Gateway Proxy: `http-proxy:`, `https-proxy:`, `socks4:`, `socks4a:`, `socks5:`, `pac+http:`, `pac+https:`, `wpad:`
- Gateway DNS: `dns:`, `dns+udp:`, `dns+tcp:`, `https+dns:`, `tls+dns:`, `quic+dns:`, `dnssec:`, `mdns:`
- Gateway Tunnel: `ssh-tunnel:`, `wg:`, `openvpn:`, `ipsec:`, `ikev2:`, `l2tp:`, `gre:`, `ipip:`, `vxlan:`, `geneve:`, `6to4:`, `isatap:`, `teredo:`
- Gateway NAT: `upnp:`, `nat-pmp:`, `pcp:`, `stun:`, `stuns:`, `turn:`, `turns:`, `ice:`
- Gateway Access: `captive:`, `radius:`, `radiustls:`, `tacacs:`, `dot1x:`, `wispr:`
- Gateway LB: `health:`, `consul:` · Gateway CDN: `cdn:`, `cdn+push:`, `cdn+pull:`
- Gateway Discovery: `ssdp:`, `bonjour:`, `avahi:`, `dnssd:`

### 2. `BLOCKED_PROTOCOLS` (navigation) — `url-parser.ts:354`
`javascript:`, `vbscript:`, `data:` — rejected at parse time with `BlockedProtocolError`. (`data:` is in both sets: allowed for `data:` URI rendering via router `DataUri` route, but blocked as a navigated top-level protocol.)

### 3. `SPECIAL_PAGES` (aliases) — `url-parser.ts:366`
`about:blank`, `about:newtab`, `about:settings`→`nova://settings`, `about:downloads`→`nova://downloads`, `about:history`→`nova://history`, `about:bookmarks`→`nova://bookmarks`, `about:extensions`→`nova://extensions` (plus the canonical `nova://…` forms). `about:blank` is the default home page (`app-shell.ts:56`, `settings-page.ts:50`, `tab-session.ts:153`, `renderer-entry-sandboxed.ts:117`).

### 4. `BUILT_IN_PROTOCOLS` (32 registrations) — `protocol-handler.ts:178`
Types: `network | internal | external | blocked`; transports: `http | websocket | ftp | sftp`.

| Scheme | Type | Encrypted | Port | Transport | OS Scheme |
|---|---|---|---|---|---|
| `http:` | network | no | 80 | http | — |
| `https:` | network | yes | 443 | http | — |
| `ws:` | network | no | 80 | websocket | — |
| `wss:` | network | yes | 443 | websocket | — |
| `ftp:` | network | no | 21 | ftp | — |
| `ftps:` | network | yes | 990 | ftp | — |
| `sftp:` | network | yes | 22 | sftp | — |
| `file:` | internal | yes | — | — | — |
| `data:` | internal | yes | — | — | — |
| `blob:` | internal | yes | — | — | — |
| `about:` | internal | yes | — | — | — |
| `nova:` | internal | yes | — | — | — |
| `mailto:` | external | yes | — | — | `mailto:` |
| `tel:` | external | yes | — | — | `tel:` |
| `sms:` / `smsto:` | external | yes | — | — | `sms:` |
| `ssh:` | external | yes | 22 | — | `ssh:` |
| `magnet:` | external | yes | — | — | `magnet:` |
| `news:` / `nntp:` | network | no | 119 | http | — |
| `gopher:` | network | no | 70 | http | — |
| `wais:` | network | no | 210 | http | — |
| `javascript:` / `vbscript:` | **blocked** | no | — | — | — |

### 5. `BUILT_IN_GATEWAYS` (48) — `gateway-protocols.ts:330`
| Category | Schemes (default port) |
|---|---|
| Proxy (8) | `http-proxy` 8080, `https-proxy` 443, `socks4`/`socks4a`/`socks5` 1080, `pac+http` 80, `pac+https` 443, `wpad` 80 |
| DNS (8) | `dns` 53, `dns+udp` 53, `dns+tcp` 53, `https+dns` 443, `tls+dns` 853, `quic+dns` 784, `dnssec` 53, `mdns` 5353 |
| Tunnel (13) | `ssh-tunnel` 22, `wg` 51820, `openvpn` 1194, `ipsec` 500, `ikev2` 500, `l2tp` 1701, `gre`, `ipip`, `vxlan` 4789, `geneve` 6081, `6to4`, `isatap`, `teredo` 3544 |
| NAT (8) | `upnp`, `nat-pmp` 5351, `pcp` 5351, `stun` 3478, `stuns` 5349, `turn` 3478, `turns` 5349, `ice` |
| Access (6) | `captive` 443, `radius` 1812, `radiustls` 2083, `tacacs` 49, `dot1x`, `wispr` 443 |
| Load Balancer (2) | `health`, `consul` 8500 |
| CDN (3) | `cdn` 443, `cdn+push` 443, `cdn+pull` 443 |
| Discovery (4) | `ssdp` 1900, `bonjour` 5353, `avahi` 5353, `dnssd` 5353 |

### 6. Router route table — `router.ts:472-682`
| Pattern | Strategy | RouteType | Priority |
|---|---|---|---|
| `about:blank` | exact | BlankPage | 200 |
| `about:newtab` | exact | NewTabPage | 200 |
| `nova://settings/downloads/history/bookmarks/extensions` | exact | InternalPage | 150 |
| `data:` | protocol | DataUri | 50 |
| `blob:` | protocol | BlobUrl | 50 |
| `mailto:`, `tel:`, `sms:`, `smsto:`, `ssh:`, `magnet:` | protocol | ExternalProtocol | 30 |
| `wss:`, `ws:` | protocol | WebSocket | 20 |
| `news:`, `nntp:` | protocol | Usenet | 15 |
| `gopher:`, `wais:` | protocol | LegacyProtocol | 12 |
| `https:`, `http:`, `ftp:` | protocol | WebContent | 10 |
| `ftps:`, `sftp:` | protocol | SecureFileTransfer | 10 |
| `file:` | protocol | LocalFile | 10 |
| all 48 gateway schemes | protocol | Gateway | 5 |
| (no match) | — | Unknown → `error-no-route` | — |

### 7. `isSecure` set (shared by url-parser + browser-window `isSecureProtocol`)
`https:`, `wss:`, `ftps:`, `sftp:`, `ssh:`, `file:`, `nova:`, `about:`, `data:`, `blob:`, `mailto:`, `tel:`, `sms:`, `smsto:`, `magnet:`, `https-proxy:`, `pac+https:`, `tls+dns:`, `quic+dns:`, `https+dns:`, `ssh-tunnel:`, `wg:`, `openvpn:`, `ipsec:`, `ikev2:`, `vxlan:`, `geneve:`, `stuns:`, `turns:`, `captive:`, `radiustls:`, `tacacs:`, `wispr:`, `consul:`, `cdn:`, `cdn+push:`, `cdn+pull:`.

### 8. Blocked-scheme variants (per subsystem)
| Location | Schemes | Purpose |
|---|---|---|
| `security/blocked-url-schemes.ts:26` — global source of truth | `javascript:`, `vbscript:`, `data:`, `livescript:`, `blob:` | `isBlockedUrlScheme()`, `isEventHandlerAttribute()`; used by html-sanitizer, dom-bindings, fetch-api, url-parser |
| `navigation/url-parser.ts:354` | `javascript:`, `vbscript:`, `data:` | Address-bar / navigation gate |
| `networking/protocol-handler.ts:396` | `javascript:`, `vbscript:` | Handler registry (type=blocked) |
| `js/websocket-api.ts:117` | `javascript:`, `vbscript:`, `data:` | WebSocket URL check |
| `js/fetch-api.ts:27` | `javascript:`, `vbscript:`, `data:` | fetch() prohibition |
| `bookmarks/bookmark-validator.ts:3` | `javascript:`, `data:`, `vbscript:`, `file:`, `blob:`, `about:` | Bookmark URL validation |
| `ui/components/navigation-bridge.ts:651` | `javascript:`, `data:` | Address-bar pre-check before navigation |

### 9. Other scheme/port enforcement
- `networking/request-manager.ts:957` and `redirect-handler.ts:200` — reject redirect hops whose protocol is in `BLOCKED_PROTOCOLS`.
- `security/network-proxy.ts:134` — `allowedSchemes: ['https:', 'http:', 'ws:', 'wss:']`.
- `security/origin-service.ts:34` — opaque schemes `{data, blob}`; network schemes `{http, https, ws, wss, ftp, ftps}`; default ports `{http:80, https:443, ws:80, wss:443}`; inherits origin for `about:blank`/`blob:`/`srcdoc`.
- `media/https.ts` — `isHttps()`; `upgradeUrl()` `http:`→`https:` (HSTS). `media/mixed-content.ts` — block/upgrade subresources by page vs resource scheme.
- `networking/firewall.ts:386` — baseline: block mDNS 5353, NetBIOS 137-139, SSDP 1900; allow 80/443.
- CSP scheme sources (`security/csp-parser.ts:165`): `http`, `https`, `ftp`, `ftps`, `data`, `blob`, `mediastream`, `ws`, `wss`, `file`, `chrome`, `chrome-extension` (note: `mediastream:`, `chrome:`, `chrome-extension:` appear **only** here).
- `omnibox/search-suggestions.ts:16` — URL detection for `http://`, `https://`, `ftp://`.

### 10. Not supported anywhere
`view-source:` (zero references), `edge://` (zero), `chrome://` (no handler; only CSP scheme-source string `'chrome'`), and no OS/Electron-level custom scheme registration (`electron/main.cjs` registers nothing).

### 11. Default fallthrough
1. Scheme-less input → normalized to `https://` (bare hostname, localhost, IPv4, single-label hostname).
2. Unparseable scheme-less input → `isSearchQuery()` → `buildSearchUrl()` → **DuckDuckGo** `https://duckduckgo.com/?q=%s`.
3. Known special-page alias → canonical `about:`/`nova://`.
4. Scheme in `ALLOWED_PROTOCOLS` → routed by `Router`.
5. Scheme not in `ALLOWED_PROTOCOLS` (incl. `chrome:`, `mediastream:`, unknown) → `BlockedProtocolError`.
6. Blocked schemes → `BlockedProtocolError` / bridge "Blocked protocol" error.
7. Router no-match → `RouteType.Unknown` → `error-no-route` page; handler exceptions → `ErrorPage`.

### 12. UI rendering per protocol — `browser-window.ts:396`
1. `parsed.isSpecialPage` → `renderSpecialPage()` (about/nova).
2. `data:` → iframe embed.
3. `file:` → local-file placeholder card.
4. `http:`/`https:` → engine pipeline (or "Engine not connected" fallback).
5. Everything else (ws/ftp/mailto/gateway/…) → generic "X Protocol" placeholder card.

---

## Part 2 — Rendering tools (all circumstances)

| Tool | File(s) | Circumstance |
|---|---|---|
| HTML5 parser (17 modules, 12 insertion modes, encoding sniffing: BOM→Content-Type→meta prescan→UTF-8 fallback) | `browser/rendering/html5/` | Every document parse |
| CSS5 engine (tokenizer, parser, selector, cascade, computed-value-resolver, used-style, math-functions, stylesheet/CSSOM) | `browser/rendering/css-*` | Every style computation |
| `LayoutEngine` (block/inline/flex/grid/table, positioned queue, StickyController, margin collapsing) | `browser/rendering/layout-engine.ts` | Every layout pass |
| `PaintEngine` (dirty rects, layer emission, stacking context paint order) | `browser/rendering/paint-engine.ts` | Always, then rasterize |
| Software `Rasterizer` (8×8 bitmap font, alpha compositing, clip rect stack) | `browser/rendering/software-rasterizer.ts` | Default / GPU unavailable / fallback |
| WebGL `GpuRasterizer` + compositing (layer promotion, tiling, damage tracking) | `browser/rendering/gpu-rasterizer.ts`, `compositing-*` | `enableGpuAcceleration: true` (default) — falls back to software on failure |
| `PageRenderer` (pipeline orchestrator, lazy image loading) | `browser/engine/page-renderer.ts` | Wired at `main.ts:776` |
| Text measurement / UAX#14 line breaking / TextRun rendering | `browser/rendering/text-*` | Text layout & paint |
| Canvas 2D wrapper (software rasterizer), SVG, WebGL, WebGPU, OffscreenCanvas | `browser/media/`, `browser/js/canvas*` | Respective `<canvas>` / API usage |
| PNG/JPEG decoder (pngjs/jpeg-js) | `browser/image/decoder.ts` | Image rendering — **no WebP support** |
| CSS Animations + Web Animations API + `requestAnimationFrame` scheduler | `browser/rendering/animation-*`, `browser/media/request-animation-frame.ts` | Animated content |
| PDF viewer (parser + canvas renderer) | `browser/features/pdf-*` | PDF documents |
| `ReflowRepaintController` (damage region tracking, dirty flags, coalesced scheduling) | `browser/rendering/reflow-repaint-controller.ts` | **Dead code** — defined and tested but not wired into production |

---

## Findings / gaps
1. **`ReflowRepaintController` is unwired** — production `BrowserEngine` emits dirty-region data that nothing consumes.
2. **No WebP decode** — image decoder handles PNG/JPEG only.
3. **`src/browser/media/*` Web API surfaces are test-only** — imported only by `tests/graphics.test.ts` / `media.test.ts` (except `request-animation-frame`); not exposed in the JS runtime bindings.
4. **TODO.md is stale** (last updated 07-19) — 6 marked-open items are actually done (PageLoader/PageRenderer wiring, IPC direction, WebSocket binary, microtask queue, PNG/JPEG decoding, Electron).
5. **Still open in source**: sticky `fontSize` hardcoded to 16 (`positioning.ts:361`); stacking-context triggers for `transform`/`filter`/`will-change`; SOCKS proxy support; pluggable font metrics provider.

## Verification Steps
- Cross-referenced registry contents against `url-parser.ts`, `protocol-handler.ts`, `gateway-protocols.ts`, `router.ts`, `security/blocked-url-schemes.ts`, `csp-parser.ts`, `network-proxy.ts`, `origin-service.ts`, and `browser-window.ts`.
- Rendering inventory cross-referenced against `src/browser/rendering/`, `src/browser/engine/page-renderer.ts`, and `doc/README.md` change-log history.
- Research-only: no source files modified, no tests run.
