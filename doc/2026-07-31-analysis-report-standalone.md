# Analysis Report Monitor — Standalone HTML

**Date:** 2026-07-31
**Session:** Convert the live dashboard at http://localhost:4567/ into a single self-contained .html file
**Status:** Completed

---

## Summary
Bundled the analysis report monitor into one portable file (`analysis-report/analysis-report-standalone.html`, ~312 KB): CSS and JS are inlined, and a live data snapshot (stats, branches, 30-day activity, all 29 commits with file lists and root causes) is embedded so the page renders even with no backend running. When the backend on port 4567 is reachable, the page still uses live data.

## Architecture Decision
- **Hybrid live + embedded fallback:** `apiFetch()` first tries the live backend at the absolute URL `http://localhost:4567/api` (the Express server enables `cors()` for all origins, so a `file://`-opened page can still reach it). On any fetch failure (server down, offline, CORS), it transparently serves from the embedded `EMBEDDED_DATA` snapshot via a new `embeddedResponse(path)` resolver.
- **Embedded endpoints:** `/stats`, `/branches`, `/activity?days=30`, `/commits?...` (with client-side search/author/branch/date/limit/offset filtering), and `/commits/{hash}` (full detail modal data).
- **Safety encoding:** embedded JSON is emitted with all `<`, `>`, and `&` escaped (`\u003c` etc.) to prevent `</script>` breakout when inlined.

## Files Created
| File | Purpose |
|------|---------|
| `analysis-report/analysis-report-standalone.html` | Single self-contained dashboard (CSS + JS + embedded data snapshot). |
| `doc/2026-07-31-analysis-report-standalone.md` | This change log. |

## Build Process
Data was captured live from the running backend with PowerShell (`Invoke-RestMethod`) into temp JSON, then a Node builder script (`build-standalone.js`) injected it. The builder:
1. Replaced `API_BASE = '/api'` with the absolute `http://localhost:4567/api`.
2. Normalized CRLF→LF before regex-replacing the original `apiFetch` with the fallback version + `embeddedResponse`.
3. Prefixed the script with `const EMBEDDED_DATA = {...}`.
4. Inlined `style.css` into `<style>` and the modified `script.js` into `<script>`.

## Test Results
```
node --check on extracted inline script   → SYNTAX OK
happy-dom offline render (fetch stubbed to throw):
  statCards=12  tableRows=25  badges=88  canvases=7  qualityItems=7
  skeletonHidden=true  errorShown=false  emptyShown=false
  pageInfo=Page 1 of 2
RENDER TEST PASS
```

## Verification Steps
1. `node --check` on the extracted `<script>` body — no syntax errors.
2. happy-dom render with `window.fetch` forced to reject: confirmed the embedded fallback fully populates stats grid (12 cards), table (25 rows, 2 pages), 7 canvas charts, root-cause badges, and quality grid with no error/empty states.
3. Live mode verified structurally: backend health OK on port 4567, `cors()` middleware enabled, absolute API base in file — a browser-opened copy will refresh from the live server every 10 s and fall back to the snapshot when it is down.
4. No leftover references to `style.css` or `script.js` in the standalone file (only external Google Fonts links remain, non-blocking).
