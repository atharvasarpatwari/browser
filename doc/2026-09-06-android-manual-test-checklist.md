# Android App — Manual On-Device Test Checklist

**Date:** 2026-09-06
**Companion to:** `android/scripts/device-smoke-test.mjs`

---

## Why this exists

TODO.md's Android item has listed the same line since 2026-08-28: "Manual
on-device feature pass: tabs, bookmarks/history, downloads (pause/resume/
cancel/share), long-press context menu, file upload, camera/mic permission
prompts, incognito, theme in light/dark system settings — no automated
on-device test harness exists yet."

`device-smoke-test.mjs` (added this session) now automates the part of that
list a script can verify honestly: the app installs, boots, the JS engine
actually starts (not just the Activity), the bridge contract's state shape
looks right, and a real `createTab()` round-trip proves the "tabs" item
works. **It deliberately does not attempt the rest** — driving a long-press
menu, a system permission dialog, or a share sheet via blind `adb shell input
tap <x> <y>` coordinates is fragile (screen size/density/theme all shift the
coordinates) and would produce a script that looks green without actually
testing anything. Those items still need a person. This checklist is that
person's list — same wording as TODO.md, expanded with what to actually look
for, using the implementation details `doc/2026-08-27-android-app-source-
audit.md` already documented.

Run `npm run android:smoke-test` first. If it's green, you know the baseline
is sound and any issue you find below is a real feature bug, not a boot
problem.

## Checklist

**Tabs** — automated by `device-smoke-test.mjs` (creates a tab via the
bridge, confirms it appears in state). Worth a quick manual look anyway:
open several tabs from the tab strip UI itself (not the bridge), switch
between them, close one, confirm the address bar and title update for the
active tab each time.

**Bookmarks / history** — add a bookmark, confirm it appears in the
bookmarks sheet; revisit a page, confirm it appears in history; remove one
of each and confirm it's actually gone (not just hidden until next refresh).
`BrowserViewModel.applyBookmarksSnapshot`/`applyHistorySnapshot` mirror the
engine's real services, so this is also indirectly checking that the engine
side persisted correctly.

**Downloads** — trigger a download from a real page (a link with a
downloadable file, or `<a download>`), then: pause it mid-transfer, resume
it, cancel a different one, and use the share action on a completed one.
`NativeDownloader` supports streaming HTTP with resume (range requests) and
gzip/deflate decompression — a good test target is a file large enough that
pause/resume actually has time to matter, not a instant sub-second download.

**Long-press context menu** — long-press a link (expect open-in-new-tab /
copy / share), long-press an image (expect save-image / share / copy), and
long-press plain text (expect the platform's normal text-selection behavior,
not a Nova context menu — the engine only resolves link/image targets via
its own hit-testing, since the WebView's own `HitTestResult` never sees
canvas-rendered page content).

**File upload** — find a page with `<input type="file">`, tap it, confirm
the native document/photo picker opens, pick a file, confirm the page
receives it (e.g. a file-upload test page that echoes the filename back).

**Camera / mic permission prompts** — visit a page that requests
`getUserMedia` (camera and/or mic), confirm the real Android runtime
permission dialog appears (not just the site's own UI), test both Allow and
Deny, and confirm denying doesn't crash the tab.

**Incognito** — toggle incognito on, confirm the UI reflects it (the
`IncognitoSurface`/`IncognitoContent` theme colors from `Color.kt`), browse a
few pages, exit incognito, and confirm none of that browsing shows up in
history.

**Theme light/dark** — with the app open, flip the system light/dark
setting (this exercises the `uiMode` entry in `AndroidManifest.xml`'s
`configChanges`, added specifically so this doesn't destroy the WebView and
lose your tabs) and confirm: the app follows the system theme without a
restart, no tabs were lost, and the "Nova Flash" gold/violet palette renders
correctly in both `values/styles.xml` and `values-night/styles.xml`.

## Reporting back

If anything above doesn't match, that's a real Kotlin/Compose bug (or a real
engine bug, for the bookmark/history/download items, since those round-trip
through the TS engine) — worth a session of its own to fix, not a smoke-test
false negative. `adb logcat` filtered to the app's PID
(`adb logcat --pid=$(adb shell pidof com.nova.browser)`) is the fastest way
to see what actually happened underneath any of these.
