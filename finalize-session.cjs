// Run from E:\nova_1 with:  node finalize-session.cjs
//
// Does three things to doc/analytics.html + doc/:
//   1. Removes 6 phantom DOCS entries that cite .md files which don't exist on disk.
//   2. Registers the already-on-disk 2026-09-10 mockup doc that had no entry.
//   3. Moves ./_new-session-doc.md into doc/2026-09-12-hn-rendering-pipeline-fixes.md
//      and registers it as a new DOCS entry.
// Then resyncs the header/KPI fallback numbers and verifies disk<->array coverage.
const fs = require('fs');
const path = require('path');

const ANALYTICS = 'doc/analytics.html';
const SRC_DOC = '_new-session-doc.md';
const DEST_DOC_NAME = '2026-09-12-hn-rendering-pipeline-fixes.md';
const DEST_DOC = path.join('doc', DEST_DOC_NAME);

if (!fs.existsSync(ANALYTICS)) { console.error('FAILED: run this from E:\\nova_1 (doc/analytics.html not found here)'); process.exit(1); }
if (!fs.existsSync(SRC_DOC)) { console.error('FAILED: ' + SRC_DOC + ' not found next to this script'); process.exit(1); }

let raw = fs.readFileSync(ANALYTICS, 'utf8');
const NL = raw.includes('\r\n') ? '\r\n' : '\n';

const PHANTOM_FILES = new Set([
  '2026-09-07-rendering-text-width-mismatch-fix.md',
  '2026-09-07-rendering-hidden-element-content-fix.md',
  '2026-09-07-rawtext-tokenizer-fix.md',
  '2026-09-07-css-dead-code-unified-theme.md',
  '2026-09-07-dark-theme-address-bar-fix.md',
  '2026-09-10-pngjs-contextisolation-image-decode-fix.md',
]);
const MOCKUP_ENTRY = '{file:"2026-09-10-browser-interface-design-mockup.md",date:"2026-09-10",title:"Browser Interface Design Mockup (Claude Design Canvas)",category:"UI",tests:0,status:"Completed",rootCauses:0,filesModified:0,filesCreated:1}';
const SESSION_ENTRY = `{file:"${DEST_DOC_NAME}",date:"2026-09-12",title:"HN Rendering Pipeline \u2014 11 Root-Cause Fixes (Tree-Builder, Layout, Tokenizer)",category:"Rendering",tests:3,status:"Completed",rootCauses:11,filesModified:18,filesCreated:0}`;

const startIdx = raw.indexOf('const DOCS = [');
if (startIdx === -1) { console.error('FAILED: "const DOCS = [" not found'); process.exit(1); }
const closeIdx = raw.indexOf(NL + '];', startIdx);
if (closeIdx === -1) { console.error('FAILED: closing "];" of DOCS array not found'); process.exit(1); }

const before = raw.slice(0, startIdx);
const arrayBody = raw.slice(startIdx + 'const DOCS = ['.length, closeIdx);
const after = raw.slice(closeIdx);

let lines = arrayBody.split(NL).filter(l => l.length > 0);
const removed = [];
lines = lines.filter(l => {
  const m = l.match(/file:"([^"]+)"/);
  if (m && PHANTOM_FILES.has(m[1])) { removed.push(m[1]); return false; }
  return true;
});
if (removed.length !== PHANTOM_FILES.size) {
  console.error('FAILED: expected to remove ' + PHANTOM_FILES.size + ' phantom entries, removed ' + removed.length);
  process.exit(1);
}
lines[lines.length - 1] = lines[lines.length - 1].replace(/,\s*$/, '') + ',';
lines.push(MOCKUP_ENTRY + ',');
lines.push(SESSION_ENTRY);

raw = before + 'const DOCS = [' + NL + lines.join(NL) + NL + after;

// move the doc file into place
fs.copyFileSync(SRC_DOC, DEST_DOC);
fs.unlinkSync(SRC_DOC);
console.log('Moved ' + SRC_DOC + ' -> ' + DEST_DOC);

// recompute totals and resync header/KPI fallbacks
const m = raw.match(/const DOCS = (\[[\s\S]*?\n\]);/);
const DOCS = eval(m[1]);
const tests = DOCS.reduce((a, d) => a + d.tests, 0);
const rootCauses = DOCS.reduce((a, d) => a + d.rootCauses, 0);
const files = DOCS.reduce((a, d) => a + d.filesModified + d.filesCreated, 0);
const days = new Set(DOCS.map(d => d.date)).size;

const fmt = n => n.toLocaleString('en-US');
const replacements = [
  [/(id="statDocs">)255(<)/, `$1${DOCS.length}$2`],
  [/(id="statDays">)43(<)/, `$1${days}$2`],
  [/(id="statTests">)9,261(<)/, `$1${fmt(tests)}$2`],
  [/(id="statGenerated">)2026-09-10(<)/, '$12026-09-12$2'],
  [/(id="kpiDocs">)255(<)/, `$1${DOCS.length}$2`],
  [/(id="kpiTests">)9,261(<)/, `$1${fmt(tests)}$2`],
  [/(id="kpiRootCauses">)460(<)/, `$1${rootCauses}$2`],
  [/(id="kpiFiles">)1,347(<)/, `$1${fmt(files)}$2`],
];
for (const [re, rep] of replacements) {
  if (!re.test(raw)) { console.error('FAILED: pattern not found: ' + re); process.exit(1); }
  raw = raw.replace(re, rep);
}

fs.writeFileSync(ANALYTICS, raw);
console.log('Patched ' + ANALYTICS);

// verify
const seen = new Map(); const dups = [];
for (const d of DOCS) { if (seen.has(d.file)) dups.push(d.file); seen.set(d.file, true); }
const diskFiles = fs.readdirSync('doc').filter(f => f.endsWith('.md') && f !== 'README.md');
const inDocsSet = new Set(DOCS.map(d => d.file));
const diskSet = new Set(diskFiles);
console.log(JSON.stringify({
  ENTRIES: DOCS.length, DUPS: dups.length, DAYS: days, TESTS: tests, ROOTCAUSES: rootCauses, FILES: files,
  missingFromDocs: diskFiles.filter(f => !inDocsSet.has(f)),
  extraInDocs: DOCS.map(d => d.file).filter(f => !diskSet.has(f)),
}, null, 2));

const s = raw.indexOf('<script>');
const e = raw.lastIndexOf('</script>');
fs.writeFileSync('.finalize-session-extracted.js', raw.slice(s + 8, e));
console.log('Wrote .finalize-session-extracted.js for `node --check` — delete it after checking.');
