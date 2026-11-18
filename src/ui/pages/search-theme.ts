/**
 * Styles shared by the search pages (the home page and the results page): one stylesheet, injected once, driven by
 * colour variables. Dark is the default; the app's own theme (`data-theme` on the root, set by the theme manager) wins,
 * and with none set the system's `prefers-color-scheme` decides. Replaces the colours that were hardcoded as inline
 * styles in each page.
 */
const SEARCH_THEME_CSS = `
.ns-root {
  --ns-bg:#0b0d12; --ns-surface:#141821; --ns-surface-2:#1b2130; --ns-border:rgba(255,255,255,.11);
  --ns-text:#e8ecf4; --ns-muted:#9aa4b8; --ns-accent:#4aa3ff; --ns-link:#8ab4ff; --ns-url:#6fd6a0;
  --ns-shadow:0 2px 14px rgba(0,0,0,.35); --ns-warn:#f6b93b;
  box-sizing:border-box; width:100%; height:100%; overflow-y:auto; overflow-x:hidden; background:var(--ns-bg); color:var(--ns-text);
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif; font-size:14px; line-height:1.5;
}
:root[data-theme="light"] .ns-root {
  --ns-bg:#ffffff; --ns-surface:#f6f8fc; --ns-surface-2:#eef2f9; --ns-border:rgba(20,30,50,.14);
  --ns-text:#1b2230; --ns-muted:#5b6578; --ns-accent:#1a73e8; --ns-link:#1a0dab; --ns-url:#188038;
  --ns-shadow:0 2px 12px rgba(30,40,70,.14); --ns-warn:#a9720f;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme]) .ns-root {
    --ns-bg:#ffffff; --ns-surface:#f6f8fc; --ns-surface-2:#eef2f9; --ns-border:rgba(20,30,50,.14);
    --ns-text:#1b2230; --ns-muted:#5b6578; --ns-accent:#1a73e8; --ns-link:#1a0dab; --ns-url:#188038;
    --ns-shadow:0 2px 12px rgba(30,40,70,.14); --ns-warn:#a9720f;
  }
}
.ns-root *, .ns-root *::before, .ns-root *::after { box-sizing:border-box; }
.ns-muted { color:var(--ns-muted); }
.ns-sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
.ns-small { font-size:12px; }

/* search box */
.ns-pill { position:relative; display:flex; align-items:center; gap:10px; width:100%; max-width:640px; height:46px; padding:0 8px 0 18px;
  background:var(--ns-surface); border:1px solid var(--ns-border); border-radius:999px; transition:box-shadow .15s,border-color .15s; }
.ns-pill:focus-within { border-color:var(--ns-accent); box-shadow:var(--ns-shadow); }
.ns-pill-icon { flex:none; color:var(--ns-muted); }
.ns-pill input { flex:1; min-width:0; height:100%; background:none; border:none; outline:none; color:var(--ns-text); font:inherit; font-size:16px; }
.ns-pill input::placeholder { color:var(--ns-muted); }
.ns-go { flex:none; width:34px; height:34px; border:none; border-radius:50%; background:var(--ns-accent); color:#fff; cursor:pointer; font-size:15px; }
.ns-suggest { position:absolute; left:0; right:0; top:calc(100% + 6px); z-index:30; margin:0; padding:6px 0; list-style:none; text-align:left;
  background:var(--ns-surface); border:1px solid var(--ns-border); border-radius:16px; box-shadow:var(--ns-shadow); overflow:hidden; }
.ns-suggest-row { display:flex; align-items:center; gap:10px; padding:8px 16px; cursor:pointer; }
.ns-suggest-row.ns-active, .ns-suggest-row:hover { background:var(--ns-surface-2); }
.ns-suggest-text { font-size:14px; color:var(--ns-text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ns-suggest-desc { font-size:12px; color:var(--ns-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0; }
.ns-suggest-icon { flex:none; width:20px; text-align:center; }

/* buttons, chips, cards */
.ns-btn { padding:7px 14px; border:1px solid var(--ns-border); border-radius:999px; background:var(--ns-surface); color:var(--ns-text);
  font:inherit; font-size:13px; cursor:pointer; }
.ns-btn:hover { background:var(--ns-surface-2); }
.ns-btn.ns-primary { background:var(--ns-accent); border-color:var(--ns-accent); color:#fff; }
.ns-btn[disabled] { opacity:.45; cursor:default; }
.ns-card { padding:14px 16px; background:var(--ns-surface); border:1px solid var(--ns-border); border-radius:14px; }
.ns-chip { display:inline-flex; align-items:center; gap:6px; padding:4px 12px; border:1px solid var(--ns-border); border-radius:999px; font-size:12px; color:var(--ns-muted); }
.ns-badge { display:inline-block; margin-right:6px; padding:0 6px; border-radius:6px; font-size:11px; background:var(--ns-surface-2); color:var(--ns-muted); }

/* results page */
.ns-top { display:flex; align-items:center; gap:22px; padding:14px 28px 0; }
.ns-top .ns-pill { max-width:640px; }
.ns-tabs { display:flex; gap:4px; padding:10px 28px 0 150px; border-bottom:1px solid var(--ns-border); }
.ns-tab { padding:8px 14px; border:none; border-bottom:3px solid transparent; background:none; color:var(--ns-muted); font:inherit; font-size:13px; cursor:pointer; }
.ns-tab.ns-active { color:var(--ns-accent); border-bottom-color:var(--ns-accent); }
.ns-results { max-width:700px; padding:14px 28px 40px 150px; }
.ns-stats { margin:0 0 16px; font-size:13px; color:var(--ns-muted); }
.ns-result { margin:0 0 22px; max-width:652px; }
.ns-result-url { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--ns-url); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ns-result-title { display:inline-block; margin:2px 0; font-size:19px; line-height:1.3; color:var(--ns-link); text-decoration:none; cursor:pointer; }
.ns-result-title:hover { text-decoration:underline; }
.ns-result-snippet { margin:0; font-size:14px; line-height:1.55; color:var(--ns-text); }
.ns-result-snippet b { font-weight:700; }
.ns-result-meta { font-size:12px; color:var(--ns-muted); }
.ns-pager { display:flex; align-items:center; gap:6px; margin:8px 0 28px; }
.ns-elsewhere { display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:6px 0 24px; }
.ns-settings { margin:30px 0 0; padding-top:12px; border-top:1px solid var(--ns-border); }
.ns-settings > summary { cursor:pointer; color:var(--ns-muted); font-size:13px; }

/* home page */
.ns-home { display:flex; flex-direction:column; align-items:center; min-height:100%; padding:7vh 24px 32px; text-align:center; }
.ns-home-logo { margin:0 0 6px; color:var(--ns-text); }
.ns-greeting { margin:0 0 22px; font-size:14px; color:var(--ns-muted); }
.ns-tiles { display:flex; flex-wrap:wrap; justify-content:center; gap:14px; margin:30px 0 6px; }
.ns-tile { display:flex; flex-direction:column; align-items:center; gap:8px; width:92px; padding:14px 6px; border:1px solid var(--ns-border); border-radius:16px;
  background:var(--ns-surface); color:var(--ns-text); font:inherit; font-size:12px; cursor:pointer; }
.ns-tile:hover { background:var(--ns-surface-2); border-color:var(--ns-accent); }
.ns-tile-icon { font-size:22px; line-height:1; }
.ns-recent { width:100%; max-width:640px; margin-top:26px; text-align:left; }
.ns-recent h2 { margin:0 0 8px; font-size:12px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:var(--ns-muted); }
.ns-recent-row { display:flex; align-items:baseline; gap:10px; padding:7px 4px; border-radius:8px; cursor:pointer; }
.ns-recent-row:hover { background:var(--ns-surface-2); }
.ns-notice { width:100%; max-width:640px; margin:18px 0 0; text-align:left; }
`;

let injected = false;

/** Adds the shared stylesheet to the document once. */
function ensureSearchTheme(): void {
  if (injected && document.getElementById('nova-search-theme')) return;
  injected = true;
  if (document.getElementById('nova-search-theme')) return;
  const style = document.createElement('style');
  style.id = 'nova-search-theme';
  style.textContent = SEARCH_THEME_CSS;
  document.head.appendChild(style);
}

export { ensureSearchTheme, SEARCH_THEME_CSS };
