// Runs AdHosts.BLOCK_SCRIPT (written to app/build/nova-block.js by the unit tests) the way a page
// would: blocked fetches must reject even though the network answered, others must pass through.
// Usage: node android/scripts/check-block-script.mjs [hosts.txt]
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const script = readFileSync(new URL('../app/build/nova-block.js', import.meta.url), 'utf8');
let calls = 0;
const window = { fetch: async () => { calls++; return { ok: true }; } };
new Function('window', 'location', script)(window, { href: 'https://example.org/' });

const rejects = async (input) => window.fetch(input, { method: 'HEAD', mode: 'no-cors' }).then(() => false, (e) => e instanceof TypeError);

const blocked = ['https://example.org/js/widget/ads.js', '/js/pagead.js?v=2', 'https://ad.doubleclick.net/fakepage.html', 'https://www.youtube.com/pagead/x', 'https://www.facebook.com/tr?id=1', { url: 'https://stats.wp.com/e.js' }];
const allowed = ['https://example.org/roads.js', 'https://example.org/a', '/relative', 'https://www.youtube.com/watch?v=1', 'https://notdoubleclick.net/', 'https://www.yahoo.com/', 'data:text/plain,hi'];
if (process.argv[2]) for (const h of readFileSync(process.argv[2], 'utf8').split(/\s+/).filter(Boolean)) {
  if (!h.includes('turtlecute')) blocked.push(`https://${h}/fakepage.html`);
}
for (const u of blocked) assert.equal(await rejects(u), true, `should reject: ${u.url ?? u}`);
for (const u of allowed) assert.equal(await rejects(u), false, `should pass: ${u}`);
assert.equal(calls, blocked.length + allowed.length, 'every request is still made, so the native side counts it');
console.log(`ok: ${blocked.length} blocked fetches rejected, ${allowed.length} allowed passed`);
