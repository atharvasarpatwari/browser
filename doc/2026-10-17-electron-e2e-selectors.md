# Electron E2E Selectors Updated

**Date:** 2026-10-17
**Session:** "Update stale Electron e2e selectors". Stopped after the selector fix because the user asked to refocus on the Android app.
**Status:** Completed (selectors). One pre-existing desktop rendering bug found and left open.

---

## Summary

Both Electron e2e specs waited for `.address-bar` / `.address-input`, which no longer exist anywhere in `src/` (removed by the 2026-09-12 UI rename, `ae70ffc`). They now locate the address bar by role and accessible name, so later class renames can't break them.

## Root Cause
**Files:** `tests/e2e/electron-smoke.spec.ts`, `tests/e2e/fidelity-audit.spec.ts`
**Problem:** The address input is now `.nova-addressbar-input` with `role="combobox"` and placeholder "Search or enter URL" (`src/ui/components/address-bar/address-bar.view.ts`); the specs still used the July class names.
**Fix:**
```ts
const addressInput = page.getByRole('combobox', { name: 'Search or enter URL' });
```

## Found, not fixed (pre-existing, desktop only)
The fidelity audit now reaches its real checks and fails one: **PNG images don't decode in the Electron app**. The "images" fixture shows the engine's purple checker placeholder where the image should be, and the CSS background image is missing.
- **Not caused by the 2026-10-17 script change:** an A/B with those two edits temporarily reverted fails identically.
- **Likely cause:** `src/browser/image/decoder.ts` uses `pngjs`, which needs Node's `zlib` through `node-builtin-shims/loader.ts`. That shim assumes `nodeIntegration: true`, but the 2026-09-06 socket-proxy phases turned `contextIsolation` on. The decode error is swallowed (`catch {}`), so nothing is logged.
- Left for a separate desktop task.

## Files Modified
| File | Change |
|------|--------|
| `tests/e2e/electron-smoke.spec.ts` | address bar by role + name |
| `tests/e2e/fidelity-audit.spec.ts` | address input by role + name |

## Files Created
| File | Purpose |
|------|--------|
| `doc/2026-10-17-electron-e2e-selectors.md` | This changelog |

## Test Results
```
npx playwright test --config=playwright-electron.config.cjs
  before: 1 passed, 2 failed (both timed out waiting for .address-bar / .address-input)
  after:  2 passed (electron-smoke, keep-alive), 1 failed:
          fidelity-audit -> "images fixture must show checker quadrant #380000" (pre-existing, see above)
A/B with the script-execution edits reverted (AUDIT_FIXTURE=images) -> same failure; edits restored and rebuilt
```
