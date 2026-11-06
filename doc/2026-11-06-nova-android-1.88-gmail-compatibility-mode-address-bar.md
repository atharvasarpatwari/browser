# Nova Android 1.88: Typing www.gmail.com Opens Gmail — Compatibility Mode, Address-Bar Progress, Suggestions, Lone Words Search

**Date:** 2026-11-06
**Session:** "focus on the parsing of the url and if i type www.gmail.com i should be … redirected to the gmail page … i dont see any update in the app … i want to work with this app efficiently"
**Status:** Completed. Verified on the Android emulator (NovaEmu); the tablet was not connected.

---

## Summary
Typing `www.gmail.com` now opens Google's "Sign in to continue to Gmail" page, fully working, in the same tab:
- The address bar reacts the moment Go is pressed.
- It shows the final address after Gmail's redirects.
- It suggests addresses while typing.

Investigation first, before any change:
- **Parsing was already correct.** The Kotlin address bar (`UrlInputResolver`) and the engine (`UrlParser`) both turn `www.gmail.com` into `https://www.gmail.com`.
- **Nothing blocked it.** The ad, tracker, third-party and security checks allow every URL in Gmail's chain.
- **The redirect chain:** `www.gmail.com` → `mail.google.com/mail/u/0/` → … → `accounts.google.com/v3/signin/identifier` (3 redirects).
- **Live, through Nova's real renderer** (Node, real network): the sign-in page arrived at 2.1s; its single 1.2 MB script finished downloading at 9.9s; the first full frame was at 13.8s. Then the script failed in Nova's interpreter (`_._DumpException is not a function`), so the "Next" button can never sign in.

Signing in to and using Gmail needs Google's full JavaScript apps. With the user's choice (asked in session), those sites now open in **compatibility mode**: Android's system WebView (Chromium), inside the Nova tab.

The user also chose three address-bar improvements: load progress, the final URL, and suggestions as you type. While testing, a parsing problem turned up: typing a single word such as `gmail` opened the dead address `https://gmail`. It now searches.

## Root Causes

### 1. Google sign-in and Gmail can't run in Nova's engine
**Files:** new `CompatSites.kt`, `ui/components/CompatWebView.kt`; `BrowserViewModel.kt`, `ui/BrowserScreen.kt`
**Problem:** typing `www.gmail.com` never led to a usable Gmail. On the phone it looked like nothing happened.
**Root cause:** Gmail's redirects end on Google's sign-in page, a JavaScript application. Nova's interpreter fails on its 1.2 MB script (`_._DumpException is not a function`), and the page took about 14s on a PC (longer on a phone) before anything showed. Gmail's inbox needs much more JavaScript still.
**Fix: compatibility mode.**
- **Which sites:** `CompatSites` lists Gmail and Google's signed-in apps (mail, accounts, docs, drive, calendar, meet, keep, photos, contacts, chat, myaccount). A site the user switches in or out from the menu is remembered (`NovaSettings.compatOn/compatOff`).
- **Opening:** `navigate()` opens those sites in `CompatWebView`, a system WebView in the same tab. It is shown over the engine while that tab is active, and kept hidden on other tabs so Gmail isn't reloaded.
- **Address bar:** shows the compatibility page's final URL and progress; back, forward, reload and stop drive it. Back out of its history returns to the tab's Nova page.
- **Links:** Google sign-in hops (accounts.youtube.com, ogs.google.com…) and redirects stay in compatibility mode. A link to an ordinary site goes back to Nova's engine in the same tab. `intent:`, `mailto:` and `tel:` links open their apps.
- **Arriving from Nova:** an engine page that reaches a compatibility site (a link or redirect to Gmail) switches over, and the engine steps back. A page the user backed out of is not reopened automatically, which prevents a loop.
- **Downloads** (Gmail attachments) carry the WebView's sign-in cookies and user agent into `NativeDownloader`. File uploads, camera/microphone and location reuse the existing prompts. `window.open` loads in the same view.
- **Lifecycle:** paused and resumed with the app; WebView cookies are flushed on pause; the view is destroyed when it leaves (`onRelease`) and rebuilt after a renderer crash.
- **Incognito** stays in Nova's engine: the system WebView's cookies are shared, while Nova's own jar keeps private sessions apart.

### 2. Pressing Go gave no feedback until the engine reported back
**Files:** `BrowserViewModel.kt` (`navigatingTo`), `ui/BrowserScreen.kt`
**Problem:** after Go, the bar and page stayed unchanged until the engine's next state push, sometimes seconds later.
**Root cause:** the bar showed only the engine tab's URL and `loading` flag, both of which arrive asynchronously.
**Fix:** the typed address and a progress bar show at once (`navigatingTo`). They are cleared when the engine reports the load (loading, error or the URL), or after three state pushes.

### 3. A lone word opened a dead address
**File:** `UrlInputResolver.kt`
**Problem:** typing `gmail`, `weather` or `hello` opened `https://gmail` and so on: a host that doesn't exist, ending on "Couldn't find this site".
**Root cause:** the single-label-hostname rule (copied from the engine's parser for intranet names) matched any lone word.
**Fix:** a single-label host needs a port or a path (`router:8080`, `intranet/`, `wiki/Page`). A lone word is a search, as in mainstream browsers; `localhost` is still a host. The two tests that pinned the old behaviour were updated. The engine's `UrlParser` (desktop) is unchanged.

## Added (user-chosen)
- **Suggestions as you type** (`AddressSuggestions.kt`, `BottomChrome.kt`):
  - The first row is what Go will do: open the address, or search for the text.
  - Then matching bookmarks and history (up to 6 rows): sites starting with the typed text rank first, duplicates collapse, and recent history comes before older.
- **Final URL:** engine pages already show the post-redirect address (`urlRedirected` → tab → snapshot). Compatibility pages show the WebView's current URL, for example `accounts.google.com/v3/signin/…` after typing `www.gmail.com`.

## Not changed (recorded)
- **Pages opened in compatibility mode** are not added to Nova's history or bookmarks, and Find in page is hidden there.
- **The tab switcher** shows the engine tab's title for a tab in compatibility mode.
- **Nova's own JavaScript interpreter** still fails on Google's sign-in script; compatibility mode works around it rather than fixing it.
- **Sign-in data:** compatibility-mode sign-ins live in the system WebView's cookie store, not Nova's jar. "Clear browsing data → cookies" doesn't clear them yet.

## Files Modified
| File | Change |
|------|--------|
| `android/.../BrowserViewModel.kt` | compatibility mode state and actions; immediate navigation feedback; suggestions; lifecycle |
| `android/.../ui/BrowserScreen.kt` | compatibility view; address/progress/back wiring; menu toggle; share/copy of the shown page |
| `android/.../ui/components/BottomChrome.kt` | suggestion rows while typing |
| `android/.../UrlInputResolver.kt` | lone words search (#3) |
| `android/.../Settings.kt` | `compatOn` / `compatOff` site choices |
| `android/app/src/test/.../UrlInputResolverTest.kt` | single-label tests updated for #3 |
| `android/app/build.gradle` | 1.87 (88) → 1.88 (89) |

## Files Created
| File | Purpose |
|------|--------|
| `android/.../CompatSites.kt` | which sites use compatibility mode; which hops stay |
| `android/.../AddressSuggestions.kt` | address-bar suggestion ranking |
| `android/.../ui/components/CompatWebView.kt` | the compatibility-mode WebView |
| `android/app/src/test/.../CompatAndSuggestionsTest.kt` | 8 tests: Gmail addresses resolve to the site, a word searches; Gmail's chain uses compatibility mode, ordinary and look-alike hosts don't; user on/off choices; sign-in hops stay and other links leave; host parsing; first suggestion is what Go does; ranking and de-duplication |
| `doc/img/2026-11-06-1.88-gmail-progress.png`, `…-gmail-signin-compat.png` | emulator screenshots |

## Test Results
```
Investigation:
  UrlParser.normalize("www.gmail.com") = "https://www.gmail.com" (isSearchQuery false); Kotlin resolver the same
  Blockers on the 4 chain URLs: ads/tracker/third-party allowed; security "warn" (false-positive pattern), allowed
  curl: www.gmail.com → 3 redirects → accounts.google.com/v3/signin/identifier (200)
  Live render through PageRenderer (Node, real network): document 2056 ms; 1.22 MB script 9905 ms; render 13803 ms;
    console: [ScriptEngine] Error executing defer script: _._DumpException is not a function
gradlew :app:testDebugUnitTest → 44 tests, 0 failures (CompatAndSuggestionsTest 8, UrlInputResolverTest 18, …)
gradlew :app:assembleRelease → exit 0; apksigner verify Nova-1.88.apk → verified; versionCode 89, versionName 1.88
Emulator (NovaEmu, 1080x2400), Nova 1.88 installed:
  typing www.gmail.com in the address bar → suggestion row "gmail.com"
  Go → at once: bar "gmail.com", progress bar, Stop button (doc/img/…-gmail-progress.png)
  ~25 s (software-rendered emulator) → Google "Sign in to continue to Gmail" in compatibility mode; bar shows
    accounts.google.com/v3/sig… (final URL) (doc/img/…-gmail-signin-compat.png)
  menu → "Compatibility mode: on"; Back → leaves compatibility mode to the tab's previous Nova page
  A first burst-typed "www.gmail.com" arrived as "www.gmai" (emulator just cold-booted); repeated burst on 1.88 and on
    1.87 both arrive complete → emulator lag, not Nova
Web engine: no TypeScript changed this round (vitest/tsc/eslint unaffected; last run 335 files, 11436 passed)
```
