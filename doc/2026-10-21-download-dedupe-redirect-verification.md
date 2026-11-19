# Download Dedupe & http→https Redirect — Verification of the v1.3 Fixes

**Date:** 2026-10-21
**Session:** "Verify Android download dedupe + http-to-https redirect on device (doc 2026-10-15-nova-android-download-fixes)"
**Status:** Completed — dedupe fully verified on device; redirect verified on device for the
3xx-body case, the cross-protocol hop verified only on the JVM (no trusted TLS endpoint on device)

---

## Summary

`doc/2026-10-15-nova-android-download-fixes.md` closed with "Not run on a device". Both of the
behaviors asked about here **were** since exercised on real hardware, by the feature-test harness
run recorded in `doc/2026-10-21-android-feature-test-on-device.md` (OnePlus OPD2305, Android 14,
serial `IZ9HSSBUYHG6G6AU`, build `com.nova.browser.debug` 1.9-debug):

| v1.3 fix | Device check | Result |
|---|---|---|
| #2 same-name downloads share one file | `emulator-feature-test.mjs` check 7 | PASS — `report.bin` + `report (1).bin`, both hashes match |
| #3 redirect saved as the file | `emulator-feature-test.mjs` check 8 | PASS — 49,152 B, hash match (not the 3xx body) |
| #1 dropped connection crashes the app | `emulator-feature-test.mjs` check 9 | PASS — same pid, no FATAL |

No device was attached during this session and the emulator cannot substitute, so nothing was
re-run on hardware. What this session added instead is the one assertion neither the device run
nor the original unit tests made: that the redirect follower actually **crosses http → https**.

## The gap that was still open

The v1.3 changelog states: *"The cross-protocol case can't be exercised without TLS, but it uses
the same loop."* The device harness does not close it either — its redirect route is same-protocol:

```js
// android/scripts/emulator-feature-test.mjs:160
if (p === '/redirect') { res.writeHead(302, { Location: '/file/redirected.bin' }); ... }
```

A relative `Location` on a plain-HTTP server. Device check 8 therefore proves "a 3xx body is not
saved as the download" (the `code in 200..299` half of fix #3) but says nothing about the
protocol crossing that motivated `openFollowingRedirects()` in the first place — the half that
matters for the common `http://` link that 301s to `https://`.

## What was added

`DownloadRedirectTest.crossesHttpToHttps` — the existing loopback server gains a `/to-https`
route whose `Location` is an absolute `https://127.0.0.1:<same port>/final.bin`. The server
speaks plain HTTP so the handshake cannot complete; the test captures each hop through
`openFollowingRedirects`' `onConnection` callback (invoked before any I/O) and asserts the hop
was taken:

```kotlin
val hops = mutableListOf<HttpURLConnection>()
runCatching { openFollowingRedirects("$base/to-https", emptyMap()) { hops += it } }

assertEquals(2, hops.size)
val second = hops[1]
assertEquals("https://127.0.0.1:${server.localPort}/final.bin", second.url.toString())
assertTrue("second hop must be a TLS connection", second is HttpsURLConnection)
```

The assertions are real discriminators, not vacuous: a scheme guard that refused `https` would
leave `hops.size == 1`, which is exactly what the sibling `refusesRedirectToNonHttpScheme` case
produces for a `file:` target.

## Code reviewed, not run

`register()` in `NativeDownloader.kt:170` is the dedupe path the pure `numberedFilename` tests do
not reach. By inspection it is correct: `@Synchronized` so claim-and-store is atomic, and the
candidate scan rejects a name taken by another entry in `states`, by an existing final file, **and**
by an existing `.part` file:

```kotlin
.first { it !in taken && !File(dir, it).exists() && !File(dir, "$it.part").exists() }
```

The `taken` set spans all states rather than only active ones, so a name stays claimed after its
download finishes. Harmless, and it is what makes device check 7's two intact files possible.

## Files Modified
| File | Change |
|------|--------|
| `android/app/src/test/java/com/nova/browser/DownloadRedirectTest.kt` | `/to-https` route; `crossesHttpToHttps` test; `server`/`base` moved above `routes` so the route can embed the port |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-10-21-download-dedupe-redirect-verification.md` | This change log |

## Test Results

```
cd android && gradlew.bat --no-daemon :app:testDebugUnitTest \
  --tests com.nova.browser.DownloadFilenameTest --tests com.nova.browser.DownloadRedirectTest

BUILD SUCCESSFUL in 1m 10s
com.nova.browser.DownloadFilenameTest  tests=1 failures=0 errors=0
com.nova.browser.DownloadRedirectTest  tests=4 failures=0 errors=0
  followsRelativeRedirectChainToTheRealFile
  redirectLoopFailsInsteadOfSavingA3xxBody
  refusesRedirectToNonHttpScheme
  crossesHttpToHttps            <- new
```

A pre-change baseline run of the same two classes was 1 + 3, also green.

## Why nothing ran on hardware this session

```
adb devices -l              -> List of devices attached   (empty; the tablet is not plugged in)
emulator -avd NovaEmu       -> ERROR | x86_64 emulation currently requires hardware acceleration!
emulator-check accel        -> 6: Android Emulator hypervisor driver is not installed
Win32_ComputerSystem.HypervisorPresent -> False
```

The AEHD driver install needs an elevated terminal, same blocker as
`doc/2026-10-21-android-feature-test-on-device.md` recorded:
`%LOCALAPPDATA%\Android\Sdk\extras\google\Android_Emulator_Hypervisor_Driver\silent_install.bat`

## Still open

- **A true cross-protocol redirect has never run on device.** Closing it needs an https endpoint
  the device trusts — either a cert installed into the device trust store, or a public
  `http://…` → `https://…` URL (external dependency, flaky in a test suite). The JVM test above
  covers the branch; only the TLS handshake on real hardware is unproven, and that is
  `HttpsURLConnection`'s code, not Nova's.
- Downloads still do not survive an app restart (carried over from
  `doc/2026-10-21-android-feature-test-on-device.md`, unrelated to these two fixes).
