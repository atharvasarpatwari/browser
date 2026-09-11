# Browser Interface Design Mockup (Claude Design canvas)

**Date:** 2026-09-10
**Session:** Cowork session `session_01W6wSGNKHuZ7Mv7nQRXAgXK` — `https://claude.ai/code/session_01W6wSGNKHuZ7Mv7nQRXAgXK`. This file exists so a future session (human or agent) working on Nova's UI has a pointer back to that conversation as reference — the session itself is not re-openable from inside this repo, only citable.
**Status:** Reference only — no code changed. File-bridge access, no build/test run.

---

## What this is

A two-artboard visual mockup of Nova Browser's interface, built on a Claude Design canvas (an Artifact, not code in this repo):

- **Main window** — titlebar, tab strip (active/loading/muted/pinned tab states), nav bar with address bar, bookmarks bar, a rendered sample page, status bar.
- **New tab page** — greeting, live-style clock, search pill, 6-item speed-dial grid, recent-sites list.

Published Artifact: `https://claude.ai/code/artifact/69b6fd82-f77e-45c9-8051-6d517d09036a` ("Nova Browser Interface").

## How it was built (for anyone extending it)

Per the design skill's "match the existing app pixel-perfectly" rule, the mockup was **not** invented — it was assembled from the actual shipped design tokens read out of this repo's own compiled output:

- `dist/assets/main-DR04VOts.css` — the real `:root` custom-property scale (the `--ob-*` obsidian dark palette, `--cyan-*`/`--amber-*`/`--green-*`/`--red-*`/`--purple-*` accents, `--font-ui`/`--font-mono`/`--font-display` = DM Sans / DM Mono / Playfair Display, the `--sp-*`/`--r-*`/`--sh-*`/`--sz-*` spacing/radius/shadow/size scales) and every `.nova-*` component class (`.nova-titlebar`, `.nova-tabbar`, `.nova-tab`, `.nova-navbar`, `.nova-addressbar`, `.nova-bookbar`, `.nova-newtab`, `.nova-speed-dial`, etc.).
- `src/ui/pages/browser-window.ts`, `src/ui/components/{toolbar,address-bar,tab-strip,status-bar,bookmark-bar}/*.view.ts` — component structure/anatomy.
- `src/browser/settings/themes.ts` — confirmed this is the live `ThemeManager`'s color contract (a second, older, simpler CSS-variable scheme also exists here and is what the `.view.ts` files above still reference inline — it does not match the richer `.nova-*` system in the compiled CSS, which is newer and is what the app actually ships. Worth reconciling — see "Open question" below).

The mockup is static (no working controls) — the user asked for a visual mockup, not a clickable prototype, when asked.

## Open question worth a future session's attention

Two parallel UI styling systems currently coexist in the source tree:

1. The `.view.ts` components (`toolbar.view.ts`, `address-bar.view.ts`, etc.) build DOM with inline `style.cssText` referencing a **small** CSS-variable set (`--bg-elevated`, `--text-tertiary`, `--t-fast`, …) whose values come from `src/browser/settings/themes.ts`'s `ThemeColors`/`themeToCSSVariables()`.
2. The compiled `dist/assets/main-DR04VOts.css` defines a **much larger, richer** token set (the `--ob-*`/`--cyan-*`/glass/font/spacing scale above) and a full `.nova-*` component class library that doesn't appear to be emitted by the `.view.ts` files at all.

Either the `.nova-*` system comes from a newer/different UI source file this session's file-bridge search didn't surface (a `browser-window.ts` section or a dedicated stylesheet), or it's a redesign that landed in `dist/` without the `.view.ts` components being updated to match — in which case the actually-running app may currently be a mix of both systems rather than the cohesive look this mockup shows. Worth a session with real build/run access confirming which system the live app renders, before treating this mockup as "what already exists" versus "the fuller expression of a design that's only partly wired up."
