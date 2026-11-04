# Nova Android — End-User Test Plan

**Date:** 2026-10-21
**Session:** "do the app testing as the end user, write all the possible test cases and test them, then find the root cause of them and list them"
**Status:** Planned → executed in [2026-10-21-nova-android-1.26-end-user-test-results.md](2026-10-21-nova-android-1.26-end-user-test-results.md)

**Build under test:** Nova 1.26 (versionCode 27)
**Device:** Realme RMX5264, Android 16, 720×1570, density 272

**Method:** Everything is done as a user would on the device: taps, swipes, typing, the system Back key. Inputs go through `adb input`, guarded so they only reach Nova. Each step is checked with screenshots, the UI tree (uiautomator) and Nova's logcat, including its per-page `[render]` timings.

**Not executed on purpose:**
- entering real credentials or payment details (login forms are checked for focus and typing only, with no submit);
- downloading files to the phone without the owner's say-so.

---

## A. Install & launch
| ID | Case | Steps | Expected |
|----|------|-------|----------|
| A1 | Cold start | Force-stop, launch from the launcher intent | Home page within ~1 s: greeting, date/time, search box, 4 shortcuts, bottom bar |
| A2 | Warm resume | Home → reopen | The same tab and page are shown, nothing reloads |
| A3 | Link intent from another app | `VIEW https://example.com` | Nova opens and loads the page in a tab |

## B. Address bar
| ID | Case | Steps | Expected |
|----|------|-------|----------|
| B1 | Type a full URL | Tap the bar, type `https://example.com`, Enter | Example Domain page; the bar shows the URL |
| B2 | Bare domain | `example.org` | Loads `https://example.org/` |
| B3 | Search terms | `nova browser` | Results page from the default search engine |
| B4 | Keyboard and focus | Tap the bar | The keyboard opens, the bar is editable, the text is selected or cleared |
| B5 | Cancel editing | Tap the bar, then Back | The keyboard closes and the bar shows the current URL again |
| B6 | Invalid host | `https://nonexistent.invalid` | A clear error page, not a blank or a crash |
| B7 | http → https | `http://example.com` | Loads, and the lock or scheme indicator is correct |
| B8 | Special characters | `ünïcödé test` | Searched, correctly encoded |

## C. Navigation
| ID | Case | Steps | Expected |
|----|------|-------|----------|
| C1 | Tap a link | example.com → "More information…" / "Learn more" | Navigates to iana.org |
| C2 | Back button (toolbar) | After C1, tap ← | Back to example.com |
| C3 | System Back key | After a navigation, press Android Back | Goes back in history (it doesn't exit the app) |
| C4 | Back at the first page | System Back on the first page | Leaves the app or goes home; no crash |
| C5 | Reload | Menu/reload control | The page reloads (a new `[render]` line) |
| C6 | Pull to refresh | Swipe down at the top of the page | Reload |
| C7 | Forward | Menu → Forward after going back | Forward again |
| C8 | `target=_blank` link | A link that opens a new tab | A new tab opens and the tab count goes up |

## D. Tabs
| ID | Case | Steps | Expected |
|----|------|-------|----------|
| D1 | Open the tab switcher | Tap the tab count | A grid/list of tabs with titles |
| D2 | New tab | Switcher → + / Menu → New tab | A new home tab; the count increases |
| D3 | Switch tab | Pick the other tab | Its page shows, with scroll kept |
| D4 | Close tab | × / swipe | The tab goes and the count decreases |
| D5 | Close the last tab | Close the only tab | A fresh home tab, not an empty app |

## E. Menu features
| ID | Case | Steps | Expected |
|----|------|-------|----------|
| E1 | Menu opens | Tap ⋮ | Lists the actions |
| E2 | Add bookmark | Menu → bookmark on a page | Saved; shown in Bookmarks |
| E3 | Bookmarks list | Home → Bookmarks | Shows the bookmark; tapping opens it |
| E4 | History | Home → History | Visited pages, newest first; tapping opens one |
| E5 | Find in page | Menu → Find, type "domain" | Matches highlighted, count shown, next/previous work |
| E6 | Share | Menu → Share | The Android share sheet with the URL (dismissed, nothing sent) |
| E7 | Settings | Home → Settings | The settings screen opens; Back returns |
| E8 | Downloads screen | Home → Downloads | Opens (empty list fine) |

## F. Page rendering
| ID | Case | URL | Expected |
|----|------|-----|----------|
| F1 | Simple page | example.com | Heading, paragraph, link styled; fits the width |
| F2 | Article | en.m.wikipedia.org/wiki/Web_browser | Title, lead text, images, sections; readable at phone width |
| F3 | Search results | Wikipedia Special:Search for "web browser" | Results listed with snippets |
| F4 | Real-world CSS site | iana.org | Header and nav laid out, no giant fonts |
| F5 | JS-built content | a page that builds its DOM with JS | Content appears |
| F6 | Non-Latin text | ja/ar Wikipedia main page | CJK/Arabic glyphs render |
| F7 | Images | A page with PNG/JPEG/SVG | The images show |
| F8 | Page performance | F2/F3 | `[render]` total under ~5 s on the phone |

## G. Forms
| ID | Case | Steps | Expected |
|----|------|-------|----------|
| G1 | Type into a field | Wikipedia search box | A native field over the box, the keyboard, typed text |
| G2 | Submit with Enter | After G1 | GET results page |
| G3 | Submit with a button | Type, tap Search | GET results page |
| G4 | Hidden/invisible controls | Tap near hidden menus | Nothing invisible is triggered |
| G5 | Checkbox / select | A page with them | Toggles / opens choices |
| G6 | POST form | Any POST form | Known limitation: logged, no navigation (Round B) |

## H. Scrolling
| ID | Case | Steps | Expected |
|----|------|-------|----------|
| H1 | Scroll a long page | Swipe up on F2 | Smooth, content follows the finger |
| H2 | Fling | A fast swipe | Momentum scroll |
| H3 | Scroll to the bottom and back | Repeated swipes | No blank areas, the footer is reachable |
| H4 | Scroll position on Back | Scroll, follow a link, Back | Returns to the same position (or the top: noted) |

## I. Long-press
| ID | Case | Steps | Expected |
|----|------|-------|----------|
| I1 | Long-press a link | Hold on a link | A single context menu: open, open in new tab, copy link |
| I2 | Long-press an image | Hold on an image | An image menu |
| I3 | Long-press plain text | Hold on text | No menu, or a selection; no crash |

## J. Device & keyboard
| ID | Case | Steps | Expected |
|----|------|-------|----------|
| J1 | Rotate to landscape | `user_rotation 1` | Relayout at the new width, chrome usable |
| J2 | Back to portrait | `user_rotation 0` | Relayout |
| J3 | Keyboard over a field | G1 near the bottom of the page | The field stays visible above the keyboard |

## K. Errors & edge cases
| ID | Case | Steps | Expected |
|----|------|-------|----------|
| K1 | 404 page | example.com/does-not-exist | The server's 404 page is shown |
| K2 | Slow/large page | A big Wikipedia article | Progress shown, eventually renders, no ANR |
| K3 | Non-HTML resource | A .txt or .json URL | Shown as text (or handled sensibly) |
| K4 | Offline | Not executed (it would cut the phone's network) | — |

## L. Persistence
| ID | Case | Steps | Expected |
|----|------|-------|----------|
| L1 | Tabs survive an app restart | Open 2 tabs, force-stop, relaunch | The tabs are restored |
| L2 | Bookmarks survive a restart | After E2, restart | The bookmark is still there |
| L3 | History survives a restart | Restart | History is still there |

## M. Stability
| ID | Case | Steps | Expected |
|----|------|-------|----------|
| M1 | No crashes in the whole run | logcat `FATAL EXCEPTION` for `com.nova.browser` | None |
| M2 | No uncaught page-engine errors | logcat `NovaEngine` errors | Listed and triaged |
