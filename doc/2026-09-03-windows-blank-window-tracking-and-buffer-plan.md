# Windows Blank-Window Tracking Correction + Buffer-Safe Networking Plan

**Date:** 2026-09-03
**Session:** Corrected a stale TODO.md claim, flagged `electron/preload.cjs` as dead code, and scoped the deferred long-term fix for the Windows `nodeIntegration: true` trade-off.
**Status:** Completed (as a documentation/planning session — see "Run & Verify" note below)

---

## Summary

`TODO.md`'s Priority-High item 2 said the Windows blank-window fix was "not yet re-verified," but `doc/2026-09-01-make-app-functional.md` shows it already was — full typecheck, full test suite, `electron:dev`, and a packaged `build:win` + installer run all green, closed in that session. Corrected the tracking. Also confirmed `electron/preload.cjs` is genuinely unreferenced (checked `main.cjs` and `electron-builder.yml`) and, as written, wouldn't have fixed the `contextIsolation`/`Buffer` problem anyway — marked it dead code in place (couldn't delete it outright, see below). Wrote `doc/buffer-safe-networking-plan.md` scoping the actual long-term fix — a `DataView`-based rewrite of the 7 networking files that touch `Buffer` (155 occurrences total, dominated by `quic-transport.ts` and `socks-connection.ts`) — as a real design doc rather than leaving it as an unscoped TODO bullet.

## Files Modified

| File | Change |
|------|--------|
| `TODO.md` | Corrected item 2 (verification was already done 2026-09-01, tracking just hadn't caught up); updated the `preload.cjs` bullet to reflect it was marked dead code, not deleted (no delete/shell access this session), pointing at the new plan doc. |
| `electron/preload.cjs` | Added a header banner marking it unused/dead code, explaining why (unreferenced, and wouldn't actually have worked as designed), and pointing at `buffer-safe-networking-plan.md` for what a real replacement needs. No functional code changed — the file is inert either way. |

## Files Created

| File | Purpose |
|------|---------|
| `doc/buffer-safe-networking-plan.md` | Scopes the deferred long-term fix: replacing `Buffer` usage in `src/browser/networking/*` with `DataView`/`Uint8Array` so `contextIsolation: true` becomes viable again, vs. the alternative of a `contextBridge` byte-array function API. Includes a per-file occurrence count and a suggested implementation order (lowest-risk files first, `quic-transport.ts`/`socks-connection.ts` last). |
| `doc/2026-09-03-windows-blank-window-tracking-and-buffer-plan.md` | This file. |

## Test Results

Not run this session. This session had **file-bridge access only** — no shell/`device_bash` access to this machine, so `npm run typecheck`, `npm test`, and `npm run electron:start` were not executed. Both file edits (`TODO.md`, `electron/preload.cjs`) are text/comment-only and don't touch code that TypeScript or the test suite would compile or exercise, but per `AGENTS.md`'s Run & Verify Rule this should still be spot-checked (e.g. `npm run typecheck`) next time this repo is open in a real shell, and `doc/buffer-safe-networking-plan.md`'s occurrence counts should be re-grepped before anyone starts implementing off of them — they're a snapshot, not a verified audit.

## Verification Steps

- Confirmed `electron/preload.cjs` is unreferenced: grepped `electron/main.cjs` (no `preload:` key present) and `electron-builder.yml` (no mention).
- Confirmed the 2026-09-01 verification claim by reading `doc/2026-09-01-make-app-functional.md` directly rather than trusting `TODO.md`'s summary of it.
- Grepped `src/browser/networking/*.ts` for `Buffer`/`.subarray(`/`.writeUInt`/`.readUInt` occurrences to produce the counts in the new plan doc.

## Notes / Follow-ups

- Uncommitted in git: this session has no shell access, so nothing here was committed. These changes join whatever else is already sitting uncommitted in the working tree (see `TODO.md` item 1 for the Android side of that).
- Next real step on this thread is implementation, starting with `content-encoding.ts` and `http-proxy-connect.ts` per the plan doc's suggested order — needs a real terminal (build + test loop), not file-bridge access.
