#!/usr/bin/env node
/**
 * @file doc/gen-analytics-churn.mjs
 *
 * Regenerates doc/analytics-churn.js — the per-day code-churn dataset the
 * "Code Churn" section of doc/analytics.html renders. Run it from anywhere:
 *
 *   node doc/gen-analytics-churn.mjs
 *
 * The numbers come from `git log --all --numstat`, so every branch counts (much
 * of the work lands on claude/* branches that were never merged into main), and
 * they are the actual lines
 * added/removed per commit, grouped by author date. Generated and vendored
 * files are left out (see SKIP) — a rebuilt web bundle would otherwise swamp
 * a day with tens of thousands of lines that nobody wrote by hand.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(DOC_DIR, '..');
const OUT = path.join(DOC_DIR, 'analytics-churn.js');

/** Build output, vendored code and lockfiles: real commits, but not hand-written lines. */
const SKIP = [
  /(^|\/)node_modules\//,
  /(^|\/)(dist|build|out)\//,
  /^android\/app\/src\/main\/assets\//,
  /(^|\/)package-lock\.json$/,
  /\.min\.(js|css)$/,
  /\.map$/,
];
const skipped = (file) => SKIP.some((re) => re.test(file));

const log = execFileSync('git', [
  'log', '--all', '--no-merges', '--numstat', '--date=short',
  '--pretty=format:C|%H|%ad|%an',
], { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 256 << 20 });

/** date -> { commits:Set, files:Set, added, removed, authors:Set } */
const days = new Map();
let cur = null;
for (const line of log.split(/\r?\n/)) {
  if (line.startsWith('C|')) {
    const [, hash, date, author] = line.split('|');
    if (!days.has(date)) days.set(date, { date, commits: new Set(), files: new Set(), added: 0, removed: 0, authors: new Set() });
    cur = days.get(date);
    cur.commits.add(hash);
    cur.authors.add(author);
    continue;
  }
  if (!cur || !line.trim()) continue;
  const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
  if (!m) continue;
  const [, add, del, rawFile] = m;
  if (add === '-' || del === '-') continue; // binary file
  // "a/{old => new}/b" rename syntax -> the new path
  const file = rawFile.includes(' => ')
    ? rawFile.replace(/\{([^}]*) => ([^}]*)\}/, '$2').replace(/^.* => /, '')
    : rawFile;
  if (skipped(file)) continue;
  cur.files.add(file);
  cur.added += Number(add);
  cur.removed += Number(del);
}

const rows = [...days.values()]
  .map((d) => ({
    date: d.date,
    commits: d.commits.size,
    files: d.files.size,
    added: d.added,
    removed: d.removed,
    net: d.added - d.removed,
    authors: [...d.authors].sort(),
  }))
  .filter((d) => d.added || d.removed)
  .sort((a, b) => a.date.localeCompare(b.date));

const now = new Date();
// local time, to match the stamps the rest of the dashboard shows
const pad = (n) => String(n).padStart(2, '0');
const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} `
  + `${pad(now.getHours())}:${pad(now.getMinutes())}`;
writeFileSync(OUT, `// Auto-generated ${stamp} by doc/gen-analytics-churn.mjs — do not edit by hand.
// Lines added/removed per day from \`git log --numstat\` (merges, build output,
// vendored code and lockfiles excluded). Re-run: node doc/gen-analytics-churn.mjs
window.CODE_CHURN = {
  generated: ${JSON.stringify(stamp)},
  days: [
${rows.map((r) => '    ' + JSON.stringify(r)).join(',\n')}
  ]
};
`, 'utf8');

const tot = rows.reduce((a, r) => ({ added: a.added + r.added, removed: a.removed + r.removed }), { added: 0, removed: 0 });
console.log(`${OUT}: ${rows.length} days, +${tot.added} / -${tot.removed} lines`);
