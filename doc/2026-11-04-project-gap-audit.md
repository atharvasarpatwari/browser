# Project Gap Audit

**Date:** 2026-11-04
**Session:** Full-repository audit — what is broken, missing, or unverified
**Status:** Completed

---

## Summary

A read-only audit of the whole project: git state, build integrity, dependencies,
CI, source-level stubs and swallowed errors, and every documented deferral across
the 370 docs in `doc/`. Sections 1–9 were read or run against the working tree on
2026-11-04 — line numbers and quoted code are current. Sections 10–16 come from the
docs, each cross-checked against later-dated docs so nothing already fixed is listed
as still open.

Two structural findings dominate, and most others are downstream of them:
**`main` exists in two diverging copies (§1)** and **the repository cannot be built
from a clean clone (§2)**. Nothing else on this list can be confirmed fixed or broken
until those two are closed, because neither CI nor a local run is currently testing
the code that actually exists.

---

## 1. `main` has split in two

Local `main` and `origin/main` have diverged **both ways**: 38 commits here never
pushed, 12 there never pulled. Nothing has reconciled them since mid-October.

| # | Gap | Evidence |
|---|-----|----------|
| 1.1 | **38 commits of finished work sit on local `main` and nowhere on `origin/main`** — the entire search subsystem (omnibox classifier, instant answers, find-in-page, personal archive, OpenSearch/bangs, BM25 perf), page scroll + text selection + context menus, and **Nova Android v1.2 → v1.9** (APK trimmed to 1.4 MB, request bodies, cookie-jar wiring, downloads, pull-to-refresh, tab-card swipe, long-press menu). | `git log origin/main..main` |
| 1.2 | **8 of those exist on no remote branch at all** — one disk failure from gone: `1aeab83` Electron load timeout + socket transport + wildcard certs + watchdog reload loop, `f520b05` Android `MODIFY_AUDIO_SETTINGS` + device test harness, `01c0861` v1.3 download dedupe/redirect verification, `3b95673`/`dfa3334` on-device re-checks + missing change logs, `0bc3a4c`/`ec16dd3`/`6927ffb` analytics-dashboard churn work. | `git branch -r --contains` per commit |
| 1.3 | **12 commits on `origin/main` were never pulled** — the 52-file dead-code purge, native Rust HTTP client wiring, API-key encryption + privacy page + extension permission prompt, four `native-build` CI repairs. Local work has been built on a tree that lacks all of it. | `git log main..origin/main` |
| 1.4 | **That unpulled purge deletes files local code still uses.** `ac6c172` removes `src/browser/extensions/index.ts`, `src/native/dns-resolver.ts`, `src/process/renderer-entry-sandboxed.ts` (+4 more) — all present and referenced in the local tree. Merging it naively breaks the build; the merge needs a reference check per deleted file, not a fast-forward. | `git show --name-status ac6c172 -- src` |
| 1.5 | **CI's last word on `origin/main` is red (2026-10-17) and stale.** `typecheck + vitest (macos-latest)` and `electron e2e` both failed on `612d9ca`. Both failures are already fixed in the *unpushed* local commits — the macOS QUIC datagram bug by "Fix QUIC stream writes sent as one unbounded UDP datagram" (2026-09-23), the e2e selector drift by the `omnibox()` helper in `9740541`. **So no CI has ever run against the code that actually exists.** | `gh run view 39034645383`; `git merge-base --is-ancestor 9740541 612d9ca` → false |
| 1.6 | **6 PRs open, oldest unmerged 8 weeks** (#1 pngjs decode, #4 search subsystem, #5 `.nova-*` class wiring, #6 search-engine requirements, #10 native HTTP client gaps, #11 analytics restyle). Every one carries a red CI Gate. `claude/ecstatic-fermi-f08bd5` is **92 commits ahead with no PR at all**; `claude/ponytail-folder-browser-8b310d` is 107 ahead. ~20 `claude/*` branches linger, several already fully merged; 21 worktrees exist under `.claude/worktrees/`. | `gh pr list`, `git rev-list --count`, `git worktree list` |

**Fix order:** pull `origin/main` into a scratch branch, resolve 1.4 file-by-file,
push 1.2's eight orphans first (they are unique), then let CI run for the first time
on the real tree before touching any feature work.

## 2. A clean clone does not build

| # | Gap | Evidence |
|---|-----|----------|
| 2.1 | **`src/browser/networking/crypto-utils.ts` is untracked, and tracked code imports it.** `src/browser/networking/tls-handler.ts:37` → `import { sha256Hex } from './crypto-utils'`. The file is absent from `HEAD`, so a fresh clone fails to typecheck, build, or package. Highest-severity single-file gap in the repo. | `git ls-files --others`; `git cat-file -e HEAD:…` |
| 2.2 | **23 more untracked files under `src/`**, whole subsystems among them: `service-worker/` (registration, cache-strategies, background-sync, push-notifications), `webrtc/` (rtc-peer-connection, ice-agent, stun-client), `extensions/` (extension-host, content-bridge, background-page, manifest), `rendering/webgpu-context.ts` + `.wgsl`, `dashboard-page.ts`, `find-controller.ts`, `inverted-index.ts`, `privacy-gate.ts`, `dns-preconnect.ts`, `tab-group-manager.ts`, `opensearch-parser.ts`, plus duplicate `preload.cjs`/`socket-owner.cjs` under `networking/`. None is imported by tracked code — so each is either uncommitted work or a corpse of the dead-code purge. Decide per file: commit or delete. Leaving them is how 2.1 happened. | `git ls-files --others --exclude-standard src` (24) |
| 2.3 | **9 tracked source files modified and uncommitted**, including `tls-handler.ts`, `security/permission-manager.ts`, `omnibox/index.ts`, `ui/components/toolbar/toolbar.view.ts`, `ui/layout/desktop-layout.ts`. Plus **44 untracked docs** under `doc/` — change logs for work that already shipped. | `git status --porcelain` (81 entries) |
| 2.4 | **The Android APK's web bundle is a committed build artifact.** `android/app/src/main/assets/assets/main-*.js` etc. are tracked, hash-named Vite output. Every rebuild changes the hashes, so each Android build dirties the repo with ~1.5 MB of churn (currently visible as `D main-CteteDHL.js` / `?? main-ChnPGrnc.js`), and the committed bundle is stale against `src/`. Build it in CI or at package time; don't track it. | `git ls-files android/…/assets` vs `ls` |

## 3. Dependencies

| # | Gap | Evidence |
|---|-----|----------|
| 3.1 | **1 critical + 3 high advisories in production deps.** Critical: `@capacitor/android` — remote content can be loaded at the app origin via the internal HTTP proxy path. High: `@xmldom/xmldom` XML fragment injection, `brace-expansion` DoS, `js-yaml` quadratic CPU in `!!omap`. 8 total. | `npm audit --omit=dev` |
| 3.2 | **All three Capacitor packages are dead weight** — zero references in `src/`, `electron/`, `android/`, `tests/`, `vite-plugins/`; only a stale root `capacitor.config.ts` remains. They carry the one critical advisory, and `@capacitor/cli` is a major behind (`^7.6.8` vs `^8.4.2`). Deleting the three + the config closes 3.1's critical finding outright. | `grep -rl capacitor` across source trees |

## 4. CI gate quality

| # | Gap | Evidence |
|---|-----|----------|
| 4.1 | **Lint can never fail the gate.** `npm run lint` exits 1 (`4 errors, 975 warnings`) but `ci.yml` sets `continue-on-error: true` *and* `--max-warnings 1000` — double-muted, and 25 warnings from tripping its own cap. The 4 errors: `prefer-const` (`popState`), `require-yield` (a generator that never yields, `tests/html5-error-recovery.test.ts`), 2× `no-loss-of-precision` literals. | `.github/workflows/ci.yml:33-35` |
| 4.2 | **No Android CI at all.** The three workflows are `ci.yml` (web + Electron), `native-build.yml` (Rust), `release.yml` (desktop installers). Nothing compiles `android/` or runs its 8 Kotlin test classes — on the platform that is the current focus, and where v1.2–v1.9 landed verified by nothing but manual device checks. | `ls .github/workflows/` |
| 4.3 | **CSP blocks the app's own webfonts.** Electron console: the Google Fonts `css2?family=DM+Sans…` stylesheet "violates the following Content Security Policy" — typography silently falls back to system fonts in the packaged app. Self-host the three families rather than loosening CSP. | e2e run log |
| 4.4 | `win/arm64` legs are commented out in `native-build.yml`. | `TODO.md` item 5 |

## 5. Repo hygiene

| # | Gap | Evidence |
|---|-----|----------|
| 5.1 | **Debug dumps committed to git:** `logcat.txt` (1.7 MB) and `inst_user_settings.tmp` are tracked. `.gitignore` has `*.log`, which does not match `logcat.txt`. Untracked but sitting at root: `router-read.txt` (43 KB), `tsc-output.txt`, `tsc-errors.txt` (0 bytes). Also tracked: `logo-image.png` + `logo-symbol.png` (2.3 MB combined). | `git ls-files`, `.gitignore` |
| 5.2 | **Stale parallel source trees that are not the product** — each a place a future session can edit the wrong copy: `_kt_stage/` (18 tracked files, dead since 2026-09-08), `mini-browser-android/` (28 files, the MiniWeb app, explicitly out of scope), `dashboard/` (21 files, stale since 2026-07-13), `new/`, `ui/`, `com/` (untracked), `Claude outputs/` (9 agent scratch files tracked in git). | `git ls-files` + `git log -1` per dir |

## 6. Security holes in shipped code

Each one was read and confirmed in the current tree.

| # | Gap | Location |
|---|-----|----------|
| 6.1 | **JWT signature verification accepts any algorithm it doesn't implement.** The `switch` handles `HS256`/`HS512`; the `default` branch logs `Algorithm "…" not fully implemented; skipping signature check` and **returns `true`** — so `RS256`, `ES256`, `PS256` and `alg: "none"` all verify. An attacker picks the header. `verifyHmac` is itself "a simple comparison", not a real HMAC, because SubtleCrypto is async. | `src/browser/auth/jwt-manager.ts:325` (+`:330`) |
| 6.2 | **`webSecurity: false` on the main Electron `BrowserWindow`** — same-origin policy and mixed-content blocking off for the whole shell. The surrounding comment carefully justifies `nodeIntegration: false` / `contextIsolation: true` / `sandbox: false` and **says nothing about this line**, which suggests it was never a decision. | `electron/main.cjs:208` |
| 6.3 | **`rejectUnauthorized: false` on the main-process TLS path** — in `tls.connect()` and `upgradeTls()`, the path all renderer TLS traffic actually takes, in both the CJS and TS owners. `raw-socket-http-client.ts:310-325` *does* reject a missing cert and call `tlsHandler.negotiate()` — but only `if (this.tlsHandler)`. Confirm the DI wiring can never leave it unset. | `electron/socket-owner.cjs:85,184`; `src/browser/networking/socket-owner.ts:114,210` |
| 6.4 | **Stored XSS in the research report renderer.** Every branch of `renderMarkdown()` escapes through `inlineMarkdown()` — except the ordered-list branch, which interpolates the raw capture into a `<p>`. The result is assigned to `innerHTML` at `:276` from model- and web-derived text, so a report line `1. <img src=x onerror=…>` executes. One-line fix: route the capture through `inlineMarkdown()` like its sibling. | `src/ui/pages/research-page.ts:439` → sink at `:276` |
| 6.5 | **`android:usesCleartextTraffic="true"` app-wide**, with no `networkSecurityConfig` to narrow it — combined with two `addJavascriptInterface()` bridges exposed to the WebView (`EngineWebView.kt:207,213`), this is the Android attack surface worth auditing as one piece. | `android/app/src/main/AndroidManifest.xml:25` |
| 6.6 | **Secrets stored unencrypted outside Electron.** A `ponytail:`-marked admission: the Anthropic API key passes through in the clear on web and Android — no keychain bridge. | `src/browser/storage/secure-value.ts:7` |
| 6.7 | `eval()` is CSP-checked via `cspScriptEnforcer`, but the enforcer is *optional* — unset means unchecked `eval`. Same optional-dependency shape as 6.3. | `src/browser/js/interpreter.ts:1704`, `src/browser/js/index.ts:485` |

## 7. Features that report success without doing anything

Worse than missing features: callers get a success signal, so the gap surfaces later
as data loss or a blank page rather than an error.

| # | Gap | Location |
|---|-----|----------|
| 7.1 | **`await` does not suspend on a pending promise** in the bytecode VM — the comment says "for now, just pass through the Promise object", so the Promise itself lands on the stack instead of its resolved value. And **`try`/`catch` is not wired**: `OP.TRY` writes a handler offset to `__tryHandler` that **nothing ever reads**. Both are live: `interpreter.ts:102,142` construct a `BytecodeVM` on the real path, including for `fn.async`. | `src/browser/js/vm.ts:641,665-669` |
| 7.2 | **Object and default destructuring silently compile to nothing.** `ObjectPattern` is popped uncompiled (`const {a} = obj` is a no-op); `AssignmentPattern` discards the default (`const [a = 1] = []` → `undefined`). | `src/browser/js/bytecode-compiler.ts:643,651` |
| 7.3 | **`applyUpdate()` emits `update-installed` without unpacking or installing anything** — and `checkForUpdates()` discards its own failures, so the entire update path can fail end to end in silence. | `src/browser/engine/auto-updater.ts:369` (+`:244,:428`) |
| 7.4 | **Settings sync is a counter.** `pushChanges()` increments numbers — no network, no E2E encryption — and reports success; `pullChanges()` returns `[]` unconditionally. | `src/browser/settings/sync.ts:285,294` |
| 7.5 | **CSP violation reports are never sent.** Nothing is POSTed to `report-uri`/`report-to`; reports are queued locally and an event is emitted. CSP reporting is non-functional. | `src/browser/security/csp-reporter.ts:400` |
| 7.6 | **`NullPageLoader` returns an empty HTTP 200 for every URL** and `NullPageRenderer.render()` only logs, with `getLayoutEngine()` returning `null` — so a wiring regression presents as a blank page, never an error. | `src/browser/engine/browser-engine.ts:242,257` |
| 7.7 | **The desktop OS-window abstraction is four TODOs.** `open()`/`close()`/`focus()`/`setTitle()` flip a boolean and log; they never touch Electron or a native window — yet this is registered as the real `IWindow`. | `src/platform/desktop/browser-window.ts:56,65,74,81` |
| 7.8 | `crypto.subtle` is a stub — all 12 methods return rejected promise-likes, so page JS has no Web Crypto. `importScripts` throws outright (workers cannot load scripts). `ReadableStream`/`WritableStream` are shells (`read()` always `{done:true}`, `write()` discards), so `fetch().body` streaming cannot work. | `src/browser/js/web-apis.ts:148,2207,2227`; `src/browser/js/index.ts:1827` |
| 7.9 | **Iframe `contentDocument` returns `null` for same-origin too** ("Placeholder — full implementation needs document proxy"), and the same-origin check is a *comment*: "`CrossOriginGuard.checkAccess()` would be called here in production." `contentWindow` returns a fabricated object carrying only `origin`. | `src/browser/js/dom-bindings.ts:1073,1090-1097` |
| 7.10 | `ElementInternals.setFormValue`/`setValidity`/`setLabels` are empty and `checkValidity()`/`reportValidity()` hardcode `true` — custom-element form validation always passes. `needsPreflightDueToCache()` hardcodes `false`. WebSocket binary frames are stored as the literal string `'[binary data]'`. GPU path ops are a no-op that draws nothing instead of falling back. | `rendering/html5/shadow.ts:616-628`; `security/cors.ts:630`; `networking/request-manager.ts:269`; `rendering/gpu/gpu-rasterizer.ts:507` |

## 8. Errors are swallowed at scale

**233 of 552 `catch` sites** in `src/` + `electron/` are empty or comment-only —
**94 with no comment at all** — plus 17 `.catch(() => {})`. This is the pattern behind
most "it just silently didn't work" reports. The ones that matter:

- **IPC transports: 33 silent catches** across `worker-transport.ts` (10, including the error-dispatch path itself), `socket-transport.ts` (10), `child-process-transport.ts` (8), `transport.ts` (5). A transport failure can vanish entirely. `process-manager.ts:486` discards the liveness probe's own failure, so **a dead child process looks alive**.
- **Storage: write failures are silent.** `local-storage.ts:112,133,147` and `indexed-db.ts:137,153,167` — a failed write leaves data in memory for the session and reports nothing. Same in `settings-store.ts:85`, `persistent-stores.ts:38`, `tabs/tab-persistence.ts:34,42`. This is user data loss with no signal.
- **The crash reporter drops its own failures** (`crash-reporter.ts:430,452,528`, and `flushUploads()` at `:294`) — crashes go unreported, leaving no trace that they went unreported.
- **7 fully empty `catch { }` around extension event dispatch** (`storage-api.ts:142`, `permissions.ts:113`, `messaging.ts:152,179`, `extension-loader.ts:113`, `content-scripts.ts:118`, `background-scripts.ts:112`): a throwing extension handler is indistinguishable from success.
- **Every security-subsystem event bus swallows handler throws** — `sandbox-enforcer.ts:421`, `process-isolator.ts:471`, `origin-isolator.ts:400`, `permission-manager.ts:421`, `network-proxy.ts:299`, `resource-quota-manager.ts:367`, `csp-policy-store.ts:330` — so a failed enforcement callback is never surfaced.
- `download-manager.ts:321,436,502`: three `startDownload(...)` calls whose rejections are discarded — a download that fails to start tells the UI nothing. Plus socket/tunnel teardown (`socket-proxy.ts:93`, `dgram-handle.ts:213`, `http-proxy-connect.ts:263`, `socks-connection.ts:470`), telemetry flushes, and five consecutive empty catches in `media/clipboard.ts:30-64`.
- Android: `NovaFetchBridge.kt:182` swallows header-JSON parse failures entirely, so **download resume silently loses its headers**; `NativeDownloader.kt:376` does the same in `guessFilename()`.

A reasonable first pass: a lint rule banning empty `catch` outside tests, and a
`logger.debug(e)` at minimum in the IPC, storage, and security buses.

## 9. Misfiled and test-only code

- **`src/browser/media/` holds 68 files, most of which are not media**: `cors.ts`, `csp.ts`, `certificates.ts`, `csrf-protection.ts`, `same-origin-policy.ts`, `interpreter.ts`, `classes.ts`, `closures.ts`, `variables.ts`, `promises.ts`, `local-storage.ts`, `indexed-db.ts`, `bytecode.ts`, `jit-compiler.ts`. They are DI service facades that belong beside `security/`, `js/`, `storage/`. Anyone searching for the CORS implementation finds two.
- **Four of them are test-only parallel implementations reachable from no production code — and the suites that "cover" the JS engine assert against them, not the engine.** `media/interpreter.ts:71`'s `InterpreterService.execute()` does not evaluate JavaScript: it tokenizes, counts tokens as "steps", returns `success: true`, and imports nothing from `src/browser/js/`. Its only consumer is `tests/js-engine.test.ts`; `media/classes.ts`, `closures.ts`, `variables.ts` are the same shape, consumed only by `tests/js-language.test.ts`. **So those green tests prove nothing about the real engine** — which is where §7.1 and §7.2 live.
- `media/interpreter.ts:96-100` also contains `while (this._paused) { … }` — a **busy-wait spin loop on the main thread**, burning a core until the 5 s timeout.
- `rendering/html5/modes/body.ts:623` disables `no-duplicate-case` for an entire switch, so a real duplicate-case bug there is now invisible.
- Clean signals, so effort goes elsewhere: the Kotlin sources carry **zero** TODO/FIXME/`@Ignore`; the Rust crates carry zero `todo!`/`unimplemented!` and `.unwrap()` only under `#[cfg(test)]`; there are **no disabled tests** anywhere (the two `skip` helpers in `tests/wpt/wpt-adapter.ts` are never called); and `NoVerifier` in `native/nova-net/src/tls.rs` is correctly gated behind `verify_certificates`, which defaults to `true`.

---

## 10. Android engine — rendering / CSS

The most active area, and the one with the most open items. From the Android 1.2x–1.74 series.

- Shrink-to-fit box comes out a few px narrower than its painted text; the label's last letter overhangs. Device measure-vs-paint mismatch in the real-font path — **open, top of the current to-do list** (`1.72`).
- White slanted streaks in the top ~12 CSS px of httpforever's hero. Ruled out as scroll artifact, not in the engine raster, not `putImageData`, not a shell progress bar; "gone in that frame" on two later runs but never explained — **unresolved intermittent** (`1.42`–`1.46`).
- `load` fires before images finish (`1.48`, `1.49`).
- `rootFontSizePx` is per-process, not per-document (`1.48`).
- `::marker` / `::first-line` / `::first-letter`, `list-style-image`, nested counter scopes, `url()` inside `content` (`1.44`, `1.50`).
- SVG sprites — `<use href="#id">` across SVGs (`1.43`; script-mutated SVGs were fixed in 1.55–1.61).
- `table-layout: fixed` from the first row (`1.49`; percentage widths landed in `1.70`).
- CJK closing punctuation (、。) classified as ideographic, so a break before it is allowed (`1.40-1.41`).
- Static position inside inline content uses the line start, not the pen position (`1.40-1.41`).
- `drop-shadow` filter skipped — needs element pixels as a layer (`ponytail:`-marked, `1.37`+).
- `inline-block` not painted atomically (`ponytail:`, `1.55-1.61` #10); no `toggle` event on `<details>` (same doc, #13).
- `vertical-align: middle` centres in the line box instead of baseline + x-height/2; margin collapse-through skipped for a first child whose margin already collapsed — both deliberate, both `ponytail:`-marked (2026-11-02).
- Wikipedia: sister-project sidebar lays out 900 px wide at x=645 and runs off the page, `iw-result__content` divs 0 px tall (`1.24`, `1.25`); footer logos vanished once `overflow` really clips (`footer img` has no layout box); block-level `<select>` renders as a short empty box.
- Minerva user menu placed ~400 px above its anchor — believed fixed by the 1.55 out-of-flow padding-box fix, **device confirmation still pending**.
- Wikipedia results ~15 s on tablet; a 468 KB stylesheet parsed + cascaded on the main thread. `1.25` claimed a speed-up but the 2026-10-27 analysis says it was **never re-measured**.
- Mid-page dark-mode switch only re-styles on reload; `light-dark()`/`color-scheme` follows the preference without checking the element's own `color-scheme` (`1.32`).

## 11. JS engine

- **Async generators (`async function*`) and `for await…of`** — plan written (2026-10-26), still "left on purpose" in the newest doc (`1.73`).
- `return()` on a generator skips pending `finally`; `yield*` doesn't forward `next(v)`/`throw` (`1.31`).
- `String.raw` / raw strings in tagged templates (`1.30`).
- Deliberate V8 divergences that mask real errors: reading an undeclared variable yields `undefined` instead of `ReferenceError`; primitive `this` unboxed in sloppy mode; the lexer accepts a raw newline inside a quoted string (`1.73`).
- Still-missing web APIs: **Shadow DOM, Proxy, DOMParser, BigInt, `getRootNode`** (`1.30`; FormData/Blob/TextEncoder/Intl/`Promise.any` have since landed).
- `children` / `getElementsByClassName` return snapshots, not live collections (`1.67`).
- `requestAnimationFrame` never exercised by the harness — frames are driven manually (`1.67`).
- **Google search results are blank** — bot challenge, not an engine bug per `1.29`; the product decision ("keep Google as default?") is still open.
- 4 of 161 JS-vs-V8 probes and 2 of 70 DOM/web-API probes still failing (`1.73`, `1.74`).

## 12. Android app shell (Kotlin/Compose)

- **Downloads do not survive a restart.** `BrowserViewModel.downloads` is `mutableStateListOf<DownloadItem>()` — in-memory only, with no SharedPreferences or Room anywhere, and `NativeDownloader` keeps no record. The sheet reads "No downloads yet" while the files sit in `Android/data/<pkg>/files/Downloads`. Documented unfixed three times; no commit touches it. (Verified in the current tree.)
- `<input type=file>` never reaches the native picker (the engine uses a simulated one); upload parts are skipped by `formDataEntries`.
- Reloading a POST result re-issues GET with no "resend?" prompt; `form.submit()` from page JS isn't routed through `submitForm` (`1.33`).
- Emulator checks #4 (renderer kill, needs `adb root`) and #5 (geolocation) **never ran** — blocked on the AEHD hypervisor driver, which needs an elevated install.
- Cross-protocol http→https download redirect never exercised on a real device; only the JVM branch is covered.
- The manual on-device checklist has never been run end to end: bookmarks/history, download pause/resume/cancel/share, long-press menu, file upload, camera/mic prompts, incognito, light/dark theme.
- **No release keystore**; Play App Signing enrollment not started.
- **Device-verification debt is the single largest open verification gap.** A long run of builds shipped with the on-device check deferred because the phone was locked, in use, disconnected, or an install prompt was dismissed: `1.27`, `1.33`, `1.37`, `1.38-1.39`, `1.42`, `1.43`, `1.44`, `1.45`, `1.47`, `1.49`, `1.50`, `1.63`, `1.71`, `1.73`. Three of the five current auto-generated to-dos are device re-checks of 1.65–1.73.

## 13. Electron / desktop shell

- **GPU rasteriser is dead code today** — `rendering/gpu/*` cannot initialise in Electron (`GPUBufferUsage is not defined`) and silently falls back to software; it also still advances a full em per glyph.
- `setFont` ignores family and weight (bold isn't drawn bolder); the canvas is rendered at CSS px then scaled, softening all text.
- Desktop viewport hard-coded 1920×1080 (`setViewport` is Android-only) — no real desktop resize.
- `https://example.com/` paints a blank bitmap in the Vite dev pane; verified against the committed tree, never explained.
- `fidelity-audit.spec.ts` is supposed to be re-run after **any** rendering-pipeline change ("the kind of regression that fails silently otherwise"). ~40 rendering rounds have landed since the last run.

## 14. Engine scrolling / selection / find

- **Content below 16,384 px cannot be scrolled to** — the page is rasterised once into a capped ~126 MB bitmap and scrolling just crops it.
- No horizontal scroll; no `overflow: auto` inner scrollers (the wheel scrolls the page even over them); find's scroll-to-match is vertical only and can't reach a match inside a scroller.
- `position: sticky` not pinned (needs a second composited pass; `fixed` was fixed in `1.41`).
- `window.scrollY/scrollTo/scrollBy/innerHeight` + `scroll` events were bound in `1.30`, but **no doc records whether they drive the engine's real scroll offset** — verify.
- Selection is DOM order, not visual order (floats/columns/flex `order` select oddly); no `user-select: none`; hidden text not filtered; nothing mirrored to `window.getSelection()`; no caret. Selection and find are desktop-layout only.

## 15. Networking / security / native

- **WebRTC Phase 2 — real DTLS 1.2 + SCTP + DCEP for browser interop — is designed and uncoded.** Today Nova peers talk only to each other (`m=NOVA/DATACHANNEL`, unencrypted). Highest-risk item on the roadmap. Phases 3 (TURN + trickle-ICE) and 4 (audio/video) deliberately unscheduled.
- **The Rust `nova-net`/`nova-bindings` crates are half-wired** — not connected to `RawSocketHttpClient`, no JS fallback, not flagged experimental. The roadmap's own words: "half-wired is worse than either committed state."
- Dead raw-socket path: `socket-owner` + `RawSocketHttpClient` are not on the page-load path at all (pages load through `fetch`/Chromium's resolver); kept as Phase-5 groundwork. Architectural ambiguity worth closing either way.
- `subresource-integrity.ts` still requires `node:crypto` directly, with a pure-JS fallback, because a relative require of `crypto-utils` fails under Vitest ESM.
- Remote omnibox suggestions need a cross-origin transport — in a plain browser, CORS blocks `duckduckgo.com/ac` and the provider degrades silently; Android WebView must inject `fetchJson`.
- Speculative TLS preconnect is a no-op in Electron's stack (`session.preconnect()` untried); only the DNS half shipped.
- Multi-process / per-tab crash isolation parked, the `child_process.fork()` transport dormant, blast radius never measured. Full site isolation unstarted.
- Service Workers / PWA, WASM execution, CSS containment / subgrid / scroll-snap, JIT tiering: all open (the bytecode VM exists; no optimising tier).

## 16. Tests, release, and doc hygiene

- **The full suite was not re-run after the newest two engine fixes** (vertical-align, fixed containing blocks, 2026-11-02) — the doc says "to run before the next build". Most recent and most actionable test gap.
- Timing-budget flakes, same class, both unresolved: `tests/bytecode-vm.test.ts` fibonacci(20) at 2075 ms against a 2000 ms budget, and `tests/search-performance.test.ts` under load (1 failed + 9 skipped in that file).
- 3 `DnsResolver` real-resolver timeouts called "known environmental" across ~10 docs but never added to `known-test-failures.md` — the exact failure that file exists to prevent.
- **`known-test-failures.md` is stale**: populated from a 2026-09-03 run of 208 files / 9,108 tests; the suite is now 322 files / 11,202 tests.
- Release gaps: auto-update never tested against a real tagged release; macOS/Linux release legs never run; **no code-signing certs** (Windows EV, Apple Developer ID) so every install shows "unknown publisher"; WASM build fallback missing; no documented fresh-install run since the contextIsolation/Buffer fix.
- **`TODO.md` is 8 weeks stale** ("Last updated: 2026-09-10") — it predates all 50+ Android 1.x rounds, the scroll/selection/search series and the RC-1…RC-19 board. `doc/analytics-todos.js` is the only current to-do source, which means the file a newcomer reads first is the wrong one.
- **Plan-doc `Status:` lines are unmaintained** — these still say `Planned` for shipped work: `fetch-api-xhr-plan.md`, `promise-microtask-plan.md`, `compositing-layers-plan.md`, `xss-mitigations-plan.md`, `2026-07-18-resource-prioritization-plan.md`, `ai-research-agent-integration-plan.md`. Genuinely still planned: webrtc-phase2, site-isolation, tab-management-overhaul, gpu-acceleration, crash-isolation-scoping, buffer-safe-networking.
- **The RC-1…RC-19 end-user board has no closure record, and the numbering was reused** for per-session root causes from `1.37` on, so "RC-1" means different things in different docs. **RC-5** (closing the last tab leaves zero tabs; pages then load invisibly) and **RC-8** (CSS Color 4 `oklch()`/`lab()` paint black) have no documented fix anywhere.
- 44 change-log docs are written but uncommitted (see 2.3); `doc/README.md` indexes some of them already.

---

## Files Modified

| File | Change |
|------|--------|
| `doc/analytics.html` | Added the `DOCS` entry for this audit |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-11-04-project-gap-audit.md` | This audit — the standing gap list and work queue |

## Test Results

No source code was changed, so no suite was run for this document. The audit's own
findings were produced by read-only commands, each re-runnable:

```
$ git log --oneline origin/main..main | wc -l
38
$ git log --oneline main..origin/main | wc -l
12
$ git ls-files --others --exclude-standard src | wc -l
24
$ git grep -n "from './crypto-utils'" -- src/browser/networking
src/browser/networking/tls-handler.ts:37:import { sha256Hex } from './crypto-utils';
$ npm audit --omit=dev
8 vulnerabilities (4 moderate, 3 high, 1 critical)
$ gh pr list --state open | wc -l
6
$ gh run view 39034645383
X main CI Gate - typecheck + vitest (macos-latest) FAILED, electron e2e FAILED
```

The suite itself was **not** run as part of this audit, and §16's first item records
that it has not been run since the 2026-11-02 engine fixes either. Closing §1 and §2
is the prerequisite for a run whose result would mean anything.
