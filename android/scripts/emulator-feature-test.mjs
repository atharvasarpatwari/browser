#!/usr/bin/env node
/**
 * Nova Android — regression checks for the 2026-10-14/15 fixes (v1.1–v1.4),
 * per doc/2026-10-15-nova-android-emulator-test-plan.md. Runs against an
 * emulator (all checks) or a phone (root-only / emulator-only checks are skipped).
 *
 *   node android/scripts/emulator-feature-test.mjs --adb <path-to-adb> [--ui]
 *
 * A local HTTP test server is reached from the device through `adb reverse`, so
 * no firewall rule or LAN address is needed. The debug APK is installed with a
 * cleared data dir (`pm clear`) so permissions and downloads start from zero.
 * Screenshots and a results.json are written to android/build/emulator-test/.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cdpEvaluate } from './cdp-client.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PKG = 'com.nova.browser';
const ACTIVITY = `${PKG}/.MainActivity`;
const APK_DIR = path.join(REPO_ROOT, 'android', 'app', 'build', 'outputs', 'apk');
const DOWNLOADS = `/sdcard/Android/data/${PKG}/files/Downloads`;

// ── args ───────────────────────────────────────────────────────────────────
const opts = {
  adb: 'adb', serial: null, cdpPort: 9334, serverPort: 8765, ui: false, only: null,
  debugApk: path.join(APK_DIR, 'debug', 'app-debug.apk'),
  releaseApk: path.join(APK_DIR, 'release', 'Nova-release.apk'),
  out: path.join(REPO_ROOT, 'android', 'build', 'emulator-test'),
};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--adb') opts.adb = process.argv[++i];
  else if (a === '--serial') opts.serial = process.argv[++i];
  else if (a === '--ui') opts.ui = true;
  else if (a === '--only') opts.only = new Set(process.argv[++i].split(','));
  else if (a === '--release-apk') opts.releaseApk = path.resolve(process.argv[++i]);
  else if (a === '--debug-apk') opts.debugApk = path.resolve(process.argv[++i]);
  else if (a === '--help' || a === '-h') {
    console.log('Usage: emulator-feature-test.mjs [--adb <path>] [--serial <id>] [--ui] [--only 1,4,7] [--debug-apk p] [--release-apk p]');
    process.exit(0);
  } else { console.error(`Unknown argument: ${a}`); process.exit(1); }
}

// ── adb helpers ────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function adb(args, extra = {}) {
  const r = spawnSync(opts.adb, opts.serial ? ['-s', opts.serial, ...args] : args, { encoding: 'utf8', maxBuffer: 64 << 20, ...extra });
  if (r.error) throw new Error(`adb failed to start: ${r.error.message}`);
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), stdout: r.stdout };
}
/** One shell command line, parsed by the device shell (quote anything with spaces/parens). */
const sh = (cmd) => adb(['shell', cmd]).out.trim();
const shBytes = (cmd) => adb(['exec-out', cmd], { encoding: 'buffer' }).stdout;
const appPid = () => sh(`pidof ${PKG}`).split(/\s+/)[0] || null;
async function poll(fn, timeoutMs = 20000, intervalMs = 1000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() > end) return null;
    await sleep(intervalMs);
  }
}

// ── engine (CDP) helpers ───────────────────────────────────────────────────
let forwardedPid = null;
function forwardDevtools() {
  const pid = appPid();
  if (!pid) return false;
  if (pid !== forwardedPid) {
    adb(['forward', `tcp:${opts.cdpPort}`, `localabstract:webview_devtools_remote_${pid}`]);
    forwardedPid = pid;
  }
  return true;
}
const js = (expr, o) => cdpEvaluate(opts.cdpPort, expr, o);
async function engineState(timeoutMs = 30000) {
  return poll(async () => {
    if (!forwardDevtools()) return null;
    const raw = await js("window.novaNative ? window.novaNative.getState() : ''");
    return raw ? JSON.parse(raw) : null;
  }, timeoutMs, 1500);
}
async function launch() {
  sh(`am start -W -n ${ACTIVITY}`);
  forwardedPid = null;
  return engineState();
}

// ── permission dialogs (uiautomator) ───────────────────────────────────────
function uiDump() {
  sh('uiautomator dump /sdcard/nova-ui.xml');
  return sh('cat /sdcard/nova-ui.xml');
}
function uiNodes(xml) {
  return [...xml.matchAll(/<node [^>]*>/g)].map((m) => {
    const attr = (n) => (m[0].match(new RegExp(` ${n}="([^"]*)"`)) || [])[1] ?? '';
    const b = attr('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    return {
      text: attr('text'), desc: attr('content-desc'), id: attr('resource-id'), cls: attr('class'),
      x: b ? (Number(b[1]) + Number(b[3])) >> 1 : 0, y: b ? (Number(b[2]) + Number(b[4])) >> 1 : 0,
      box: b ? b.slice(1).map(Number) : null,
    };
  });
}
const tap = (n) => sh(`input tap ${n.x} ${n.y}`);
/** Answers one runtime-permission dialog if shown. Returns {kind, answered} or null. */
async function answerPermission(decide) {
  const xml = await poll(() => { const x = uiDump(); return x.includes('permissioncontroller') ? x : null; }, 8000, 700);
  if (!xml) return null;
  const nodes = uiNodes(xml);
  const msg = nodes.find((n) => n.id.endsWith(':id/permission_message'))?.text ?? '';
  const kind = /audio|microphone/i.test(msg) ? 'mic' : /picture|video|camera/i.test(msg) ? 'camera' : /location/i.test(msg) ? 'location' : 'other';
  const allow = decide(kind);
  const ids = allow
    ? ['permission_allow_foreground_only_button', 'permission_allow_button', 'permission_allow_one_time_button']
    : ['permission_deny_button', 'permission_deny_and_dont_ask_again_button'];
  const btn = ids.map((id) => nodes.find((n) => n.id.endsWith(`:id/${id}`))).find(Boolean);
  if (!btn) return { kind, answered: false, msg };
  tap(btn);
  await sleep(800);
  return { kind, answered: true, allow, msg };
}

// ── test server (reached from the device via `adb reverse`) ────────────────
const PAYLOAD_REPORT = crypto.randomBytes(64 * 1024);
const PAYLOAD_REDIRECT = crypto.randomBytes(48 * 1024);
const PAYLOAD_WASM = crypto.randomBytes(4096);
const SJIS = Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea]); // "日本語" in Shift_JIS
if (new TextDecoder('shift_jis').decode(SJIS) !== '日本語') throw new Error('Shift_JIS fixture is wrong');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const hits = [];
const base = `http://127.0.0.1:${opts.serverPort}`;

const server = http.createServer((req, res) => {
  const u = new URL(req.url, base);
  hits.push(u.pathname);
  const p = u.pathname;
  if (p.startsWith('/page/')) {
    const name = p.slice(6);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><title>${name}</title><body style="margin:0">
      <a href="${base}/page/linked" style="display:block;font-size:48px;padding:60px 20px;background:#ddf">BIG LINK ${name}</a></body>`);
  }
  if (p.startsWith('/slow/')) return setTimeout(() => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); }, 1000);
  if (p === '/sjis') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=Shift_JIS' }); return res.end(SJIS); }
  if (p === '/latin1') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=ISO-8859-1' }); return res.end(Buffer.from('café', 'latin1')); }
  if (p === '/blob.wasm') { res.writeHead(200, { 'Content-Type': 'application/wasm' }); return res.end(PAYLOAD_WASM); }
  if (p === '/attach/report.bin') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="report.bin"', 'Content-Length': PAYLOAD_REPORT.length });
    return res.end(PAYLOAD_REPORT);
  }
  if (p === '/redirect') { res.writeHead(302, { Location: '/file/redirected.bin' }); return res.end('<html>this redirect body must not be saved</html>'); }
  if (p === '/file/redirected.bin') { res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': PAYLOAD_REDIRECT.length }); return res.end(PAYLOAD_REDIRECT); }
  if (p === '/drop/drop.bin') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="drop.bin"', 'Content-Length': 1 << 20 });
    res.write(crypto.randomBytes(64 * 1024));
    return setTimeout(() => res.socket.destroy(), 500); // connection dies mid-body
  }
  if (p === '/cookie/set') { // #15
    res.writeHead(200, { 'Set-Cookie': `sid=${u.searchParams.get('v')}; Path=/; Max-Age=86400`, 'Content-Type': 'text/plain' });
    return res.end('set');
  }
  if (p === '/cookie/pair') { // #16: one script-visible + one HttpOnly cookie
    res.writeHead(200, { 'Set-Cookie': ['vis=1; Path=/; Max-Age=86400', 'hid=2; Path=/; Max-Age=86400; HttpOnly'], 'Content-Type': 'text/plain' });
    return res.end('pair');
  }
  if (p === '/cookie/echo') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(req.headers.cookie ?? ''); }
  if (p === '/echo') { // #14: reports exactly what arrived
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    return req.on('end', () => {
      const body = Buffer.concat(chunks);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, contentType: req.headers['content-type'] ?? null, size: body.length, sha: sha(body), text: body.toString('utf8').slice(0, 2000) }));
    });
  }
  res.writeHead(404); res.end();
});

// ── result bookkeeping ─────────────────────────────────────────────────────
const results = [];
function record(id, name, status, detail = '') {
  results.push({ id, name, status, detail });
  console.log(`  [${status}] #${id} ${name}${detail ? ' — ' + detail : ''}`);
}
async function check(id, name, fn) {
  if (opts.only && !opts.only.has(String(id))) return;
  try {
    const r = await fn();
    if (r === 'SKIP' || r?.skip) record(id, name, 'SKIP', r?.detail ?? '');
    else record(id, name, r.ok ? 'PASS' : 'FAIL', r.detail ?? '');
  } catch (e) {
    record(id, name, 'FAIL', `threw: ${e.message}`);
  }
}
function screenshot(name) {
  mkdirSync(opts.out, { recursive: true });
  const file = path.join(opts.out, `${name}.png`);
  writeFileSync(file, shBytes('screencap -p'));
  return file;
}
const listDownloads = () => sh(`ls -l '${DOWNLOADS}' 2>/dev/null`)
  .split('\n').map((l) => l.trim().match(/^\S+\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.+)$/)).filter(Boolean)
  .map((m) => ({ size: Number(m[1]), name: m[2] }));
const pullHash = (name) => sha(shBytes(`cat '${DOWNLOADS}/${name}'`));

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('Nova Android — emulator feature test (v1.1–v1.4 regressions)');
  if (!existsSync(opts.debugApk)) throw new Error(`debug APK missing: ${opts.debugApk} (run gradlew assembleDebug)`);
  const devices = adb(['devices']).out.split('\n').slice(1).filter((l) => /\tdevice$/.test(l.trim()) || /\sdevice$/.test(l));
  if (!opts.serial && devices.length !== 1) throw new Error(`need exactly one device (or --serial); got ${devices.length}`);
  const isEmulator = (opts.serial ?? devices[0]).startsWith('emulator-');

  const rootOut = adb(['root']).out;
  const rooted = /restarting adbd as root|already running as root/.test(rootOut);
  if (rooted) { adb(['wait-for-device']); await sleep(2000); }
  console.log(`  device: ${opts.serial ?? devices[0].split(/\s+/)[0]} emulator=${isEmulator} root=${rooted}`);

  await new Promise((r) => server.listen(opts.serverPort, '127.0.0.1', r));
  adb(['reverse', `tcp:${opts.serverPort}`, `tcp:${opts.serverPort}`]);

  const inst = adb(['install', '-r', opts.debugApk]).out;
  if (!/Success/.test(inst)) throw new Error(`install failed: ${inst}`);
  sh(`pm clear ${PKG}`); // fresh permissions, storage, and downloads dir
  sh('cmd uimode night no');
  adb(['logcat', '-c']);
  const st0 = await launch();
  if (!st0) throw new Error('engine never came up (window.novaNative missing after 30s)');
  console.log(`  engine up: ${st0.tabs.length} tab(s), homeUrl=${st0.homeUrl}`);

  const tabsWith = async (needle) => (await engineState())?.tabs?.filter((t) => (t.url || '').includes(needle)) ?? [];

  // #1 external links, cold + warm (v1.1)
  await check(1, 'link from another app opens in Nova (cold + warm start)', async () => {
    sh(`am force-stop ${PKG}`);
    sh(`am start -W -a android.intent.action.VIEW -d '${base}/page/cold' -p ${PKG}`);
    forwardedPid = null;
    const cold = await poll(async () => (await tabsWith('/page/cold')).length, 30000, 1500);
    const pidBefore = appPid();
    sh(`am start -W -a android.intent.action.VIEW -d '${base}/page/warm' -p ${PKG}`);
    const warm = await poll(async () => (await tabsWith('/page/warm')).length, 20000, 1000);
    const samePid = appPid() === pidBefore;
    return { ok: !!cold && !!warm && samePid, detail: `cold tab=${!!cold} warm tab=${!!warm} (same process=${samePid}), server hits: ${hits.filter((h) => h.startsWith('/page/')).join(' ')}` };
  });

  // #2 non-web schemes from other apps are ignored (v1.1)
  await check(2, 'javascript: link from another app is ignored', async () => {
    const before = (await engineState()).tabs.length;
    const pid = appPid();
    sh(`am start -a android.intent.action.VIEW -d 'javascript:alert(1)' -n ${ACTIVITY}`);
    await sleep(3000);
    const after = await engineState();
    const jsTab = after.tabs.some((t) => (t.url || '').startsWith('javascript'));
    return { ok: after.tabs.length === before && !jsTab && appPid() === pid, detail: `tabs ${before} → ${after.tabs.length}, javascript tab=${jsTab}` };
  });

  // #10 parallel fetches (v1.4): 16 × 1 s responses
  await check(10, 'engine fetches run in parallel', async () => {
    const ms = await js(`(async () => { const t = performance.now();
      await Promise.all(Array.from({ length: 16 }, (_, i) => fetch('${base}/slow/' + i + '?r=' + Math.random()).then((r) => r.text())));
      return Math.round(performance.now() - t); })()`, { awaitPromise: true, timeoutMs: 60000 });
    return { ok: ms < 6000, detail: `16 × 1 s requests took ${ms} ms (serial would be ≥ 16000)` };
  });

  // #11 charset (v1.4)
  await check(11, 'non-UTF-8 text decoded with declared charset', async () => {
    const r = await js(`Promise.all(['/sjis', '/latin1'].map((p) => fetch('${base}' + p).then(async (r) => ({ t: await r.text(), ct: r.headers.get('content-type') }))))`, { awaitPromise: true, timeoutMs: 15000 });
    const ok = r[0].t === '日本語' && r[1].t === 'café' && r.every((x) => /utf-8/i.test(x.ct));
    return { ok, detail: `Shift_JIS → ${JSON.stringify(r[0].t)} (${r[0].ct}); ISO-8859-1 → ${JSON.stringify(r[1].t)} (${r[1].ct})` };
  });

  // #12 binary bodies (v1.4)
  await check(12, 'binary response bytes are exact (application/wasm)', async () => {
    const h = await js(`fetch('${base}/blob.wasm').then((r) => r.arrayBuffer()).then((b) => crypto.subtle.digest('SHA-256', b))
      .then((d) => [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join(''))`, { awaitPromise: true, timeoutMs: 15000 });
    return { ok: h === sha(PAYLOAD_WASM), detail: `sha256 ${h?.slice(0, 16)}… vs served ${sha(PAYLOAD_WASM).slice(0, 16)}…` };
  });

  // #14 request bodies + PATCH (v1.5)
  await check(14, 'PATCH works and FormData/binary request bodies arrive intact', async () => {
    const r = await js(`(async () => {
      const post = (init) => fetch('${base}/echo', init).then((r) => r.json());
      const form = new FormData(); form.append('field', 'value'); form.append('up', new Blob(['file-bytes']), 'a.txt');
      return {
        patch: await post({ method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"x":1}' }),
        form: await post({ method: 'POST', body: form }),
        bin: await post({ method: 'PUT', body: new Uint8Array([0, 255, 128, 10]) }),
      };
    })()`, { awaitPromise: true, timeoutMs: 20000 });
    const binSha = sha(Buffer.from([0, 255, 128, 10]));
    const ok = r.patch.method === 'PATCH' && r.patch.text === '{"x":1}' &&
      /^multipart\/form-data; boundary=/.test(r.form.contentType ?? '') && r.form.text.includes('file-bytes') &&
      r.bin.sha === binSha;
    return { ok, detail: `PATCH→${r.patch.method} body=${JSON.stringify(r.patch.text)}; FormData→${r.form.contentType} ${r.form.size} B; binary sha match=${r.bin.sha === binSha}` };
  });

  // #15 cookies persist across restarts and stay out of incognito (v1.6)
  await check(15, 'cookies are stored, sent, survive restart, isolated in incognito', async () => {
    const get = (path) => js(`fetch('${base}${path}').then((r) => r.text())`, { awaitPromise: true, timeoutMs: 15000 });
    await get('/cookie/set?v=normal');
    const sent = await get('/cookie/echo');
    sh('input keyevent 3'); // HOME -> onPause -> CookieManager.flush()
    await sleep(2000);
    sh(`am force-stop ${PKG}`);
    await launch();
    const afterRestart = await get('/cookie/echo');
    await js('window.novaNative.setIncognito(true)');
    await poll(async () => (await engineState())?.incognito === true, 8000);
    const inIncognito = await get('/cookie/echo');
    await get('/cookie/set?v=private');
    const privateSent = await get('/cookie/echo');
    await js('window.novaNative.setIncognito(false)');
    await poll(async () => (await engineState())?.incognito === false, 8000);
    const backToNormal = await get('/cookie/echo');
    const ok = sent === 'sid=normal' && afterRestart === 'sid=normal' && inIncognito === '' && privateSent === 'sid=private' && backToNormal === 'sid=normal';
    return { ok, detail: `sent=${JSON.stringify(sent)} afterRestart=${JSON.stringify(afterRestart)} incognito=${JSON.stringify(inIncognito)}→${JSON.stringify(privateSent)} backToNormal=${JSON.stringify(backToNormal)}` };
  });

  // #16 document.cookie bridge: HttpOnly hidden, script writes reach the server (v1.7)
  await check(16, 'NovaCookies bridge hides HttpOnly and script cookies reach the server', async () => {
    const page = `${base}/cookie/page`;
    await js(`fetch('${base}/cookie/pair').then((r) => r.text())`, { awaitPromise: true, timeoutMs: 15000 });
    const forScript = await js(`window.NovaCookies.getForScript('${page}')`);
    await js(`window.NovaCookies.setFromScript('${page}', 'fromjs=3; Path=/')`);
    await js(`window.NovaCookies.setFromScript('${page}', 'hid=stolen; Path=/')`);
    const sent = await js(`fetch('${base}/cookie/echo').then((r) => r.text())`, { awaitPromise: true, timeoutMs: 15000 });
    const has = (c) => sent.split('; ').includes(c);
    const ok = /(^|; )vis=1(;|$)/.test(forScript) && !/hid=/.test(forScript) && has('fromjs=3') && has('hid=2') && !sent.includes('hid=stolen');
    return { ok, detail: `getForScript=${JSON.stringify(forScript)}; server received ${JSON.stringify(sent)}` };
  });

  // #7 duplicate downloads, concurrent, via the fetch-handoff path (v1.3)
  await check(7, 'same-name downloads get numbered, both intact', async () => {
    await js(`Promise.all([1, 2].map(() => fetch('${base}/attach/report.bin')))`, { awaitPromise: true, timeoutMs: 20000 });
    const files = await poll(() => { const f = listDownloads().filter((x) => x.name.startsWith('report') && !x.name.endsWith('.part')); return f.length >= 2 ? f : null; }, 20000);
    if (!files) return { ok: false, detail: `files: ${JSON.stringify(listDownloads())}` };
    const intact = files.every((f) => f.size === PAYLOAD_REPORT.length && pullHash(f.name) === sha(PAYLOAD_REPORT));
    return { ok: intact && files.some((f) => f.name === 'report.bin') && files.some((f) => f.name === 'report (1).bin'), detail: files.map((f) => `${f.name} (${f.size} B)`).join(', ') + ` hashes match=${intact}` };
  });

  // #8 redirected download via novaNative.download (v1.3)
  await check(8, 'redirected download saves the real file, not the 3xx body', async () => {
    await js(`window.novaNative.download('${base}/redirect', JSON.stringify({ filename: 'redirected.bin' }))`);
    const f = await poll(() => listDownloads().find((x) => x.name === 'redirected.bin'), 20000);
    if (!f) return { ok: false, detail: `no redirected.bin; files: ${JSON.stringify(listDownloads())}` };
    const ok = f.size === PAYLOAD_REDIRECT.length && pullHash(f.name) === sha(PAYLOAD_REDIRECT);
    return { ok, detail: `redirected.bin ${f.size} B (expected ${PAYLOAD_REDIRECT.length}), hash match=${ok}` };
  });

  // #9 connection drop mid-download must not crash (v1.3)
  await check(9, 'dropped download connection does not crash the app', async () => {
    adb(['logcat', '-c']);
    const pid = appPid();
    await js(`fetch('${base}/drop/drop.bin').then(() => 'ok', (e) => String(e))`, { awaitPromise: true, timeoutMs: 20000 });
    await sleep(5000);
    const crashed = /FATAL EXCEPTION/.test(adb(['logcat', '-d', '-s', 'AndroidRuntime:E']).out);
    const finished = listDownloads().some((x) => x.name === 'drop.bin');
    return { ok: appPid() === pid && !crashed && !finished, detail: `process ${pid} → ${appPid()}, FATAL EXCEPTION=${crashed}, bogus completed drop.bin=${finished}` };
  });

  // #5 geolocation (v1.1)
  await check(5, 'geolocation prompts and returns a position', async () => {
    if (!isEmulator) return { skip: true, detail: 'needs `adb emu geo fix` (emulator only)' };
    adb(['emu', 'geo', 'fix', '-122.0840', '37.4220']);
    await js(`window.__geo = null; navigator.geolocation.getCurrentPosition(
      (p) => { window.__geo = { lat: p.coords.latitude, lon: p.coords.longitude }; },
      (e) => { window.__geo = { err: e.code + ': ' + e.message }; }, { timeout: 25000, maximumAge: 0 }); 'started'`);
    const dlg = await answerPermission(() => true);
    const geo = await poll(async () => js('window.__geo'), 25000, 1000);
    const ok = !!geo && Math.abs((geo.lat ?? 0) - 37.422) < 0.01;
    return { ok, detail: `dialog=${dlg ? dlg.kind + (dlg.answered ? ' (allowed)' : ' (no button found)') : 'none'}; result=${JSON.stringify(geo)}` };
  });

  // #6 camera + mic (v1.1): deny mic first, then allow it
  await check(6, 'camera+mic asks for both; only granted kinds reach the page', async () => {
    const gum = `window.__gum = null; navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(
      (s) => { window.__gum = { tracks: s.getTracks().map((t) => t.kind).sort() }; s.getTracks().forEach((t) => t.stop()); },
      (e) => { window.__gum = { err: e.name }; }); 'started'`;
    await js(gum);
    const asked = [];
    for (let i = 0; i < 2; i++) { const d = await answerPermission((k) => k === 'camera'); if (d) asked.push(`${d.kind}:${d.allow ? 'allow' : 'deny'}`); }
    const denied = await poll(async () => js('window.__gum'), 15000);
    const deniedOk = !!denied && (denied.err === 'NotAllowedError' || JSON.stringify(denied.tracks) === '["video"]');
    await js(gum);
    const d2 = await answerPermission(() => true);
    const allowed = await poll(async () => js('window.__gum'), 15000);
    const allowedOk = JSON.stringify(allowed?.tracks) === '["audio","video"]';
    const askedBoth = asked.some((a) => a.startsWith('camera')) && asked.some((a) => a.startsWith('mic'));
    return { ok: askedBoth && deniedOk && allowedOk, detail: `first ask: [${asked.join(', ')}] → ${JSON.stringify(denied)}; second ask: ${d2 ? d2.kind : 'none'} → ${JSON.stringify(allowed)}` };
  });

  // #4 renderer crash recovery (v1.2)
  await check(4, 'renderer kill: app survives and engine reboots', async () => {
    if (!rooted) return { skip: true, detail: 'needs adb root (emulator / userdebug build)' };
    adb(['logcat', '-c']);
    const pid = appPid();
    const renderers = sh('ps -A -o PID,NAME').split('\n').filter((l) => /sandboxed_process/.test(l)).map((l) => l.trim().split(/\s+/)[0]);
    if (!renderers.length) return { ok: false, detail: 'no sandboxed_process renderer found' };
    sh(`kill -9 ${renderers.join(' ')}`);
    await sleep(4000);
    const log = adb(['logcat', '-d']).out;
    const st = await engineState(40000);
    return { ok: appPid() === pid && /Renderer gone/.test(log) && !!st, detail: `killed renderer ${renderers.join(',')}; app pid ${pid} → ${appPid()}; "Renderer gone" logged=${/Renderer gone/.test(log)}; engine back=${!!st}` };
  });

  // #13 launch-frame theme (v1.0 round 2), best effort: sample the window before Compose/WebView draw
  await check(13, 'launch window color matches light/dark theme', async () => {
    const want = { yes: [0x10, 0x11, 0x1a], no: [0xf6, 0xf6, 0xf2] };
    const out = [];
    for (const mode of ['yes', 'no']) {
      sh(`cmd uimode night ${mode}`);
      sh(`am force-stop ${PKG}`);
      await sleep(800);
      sh(`am start -n ${ACTIVITY}`);
      const seen = [];
      for (let i = 0; i < 6; i++) {
        const raw = shBytes('screencap');
        const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4);
        const hdr = raw.length - w * h * 4;
        const o = hdr + ((h >> 1) * w + (w >> 1)) * 4;
        seen.push([raw[o], raw[o + 1], raw[o + 2]]);
      }
      const near = (c, t) => c.every((v, k) => Math.abs(v - t[k]) <= 12);
      const other = mode === 'yes' ? want.no : want.yes;
      out.push({ mode, hit: seen.some((c) => near(c, want[mode])), wrong: seen.some((c) => near(c, other)), seen: seen.map((c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('')) });
    }
    sh('cmd uimode night no');
    await launch();
    return { ok: out.every((o) => o.hit && !o.wrong), detail: out.map((o) => `night=${o.mode}: ${o.seen.join(' ')}`).join(' | ') };
  });

  // UI checklist items (context menu, bookmarks, incognito, downloads sheet)
  if (opts.ui) {
    const findUi = (pred) => uiNodes(uiDump()).find(pred);
    await check('U1', 'long-press a link shows the context menu', async () => {
      await js(`window.novaNative.navigate('${base}/page/menu')`);
      await sleep(4000);
      const web = findUi((n) => n.cls === 'android.webkit.WebView');
      if (!web?.box) return { ok: false, detail: 'WebView not found in UI tree' };
      const x = web.box[0] + 150, y = web.box[1] + 90;
      sh(`input swipe ${x} ${y} ${x} ${y} 1200`);
      const item = await poll(() => findUi((n) => n.text === 'Open in new tab' || n.text === 'Copy link'), 6000);
      const shot = screenshot('context-menu');
      sh('input keyevent 4');
      return { ok: !!item, detail: `${item ? 'menu shown' : 'no menu'}; screenshot ${path.basename(shot)}` };
    });
    await check('U2', 'bookmark star adds the page to Bookmarks', async () => {
      await js(`window.novaNative.navigate('${base}/page/bookmarked')`);
      await sleep(3000);
      const star = findUi((n) => n.desc === 'Bookmark');
      if (!star) return { ok: false, detail: 'no Bookmark button' };
      tap(star);
      await sleep(1500);
      const open = findUi((n) => n.desc === 'Bookmarks & History');
      if (open) tap(open);
      const row = await poll(() => findUi((n) => /bookmarked/.test(n.text)), 6000);
      const shot = screenshot('bookmarks-sheet');
      sh('input keyevent 4');
      return { ok: !!row, detail: `${row ? 'bookmark listed' : 'not listed'}; screenshot ${path.basename(shot)}` };
    });
    await check('U3', 'incognito toggle switches engine session', async () => {
      const btn = findUi((n) => n.desc === 'Incognito');
      if (!btn) return { ok: false, detail: 'no Incognito button' };
      tap(btn);
      const on = await poll(async () => (await engineState())?.incognito === true, 8000);
      const shot = screenshot('incognito');
      const btn2 = findUi((n) => n.desc === 'Incognito');
      if (btn2) tap(btn2);
      const off = await poll(async () => (await engineState())?.incognito === false, 8000);
      return { ok: !!on && !!off, detail: `on=${!!on} off=${!!off}; screenshot ${path.basename(shot)}` };
    });
    await check('U4', 'downloads sheet lists finished downloads', async () => {
      const btn = findUi((n) => n.desc === 'Downloads');
      if (!btn) return { ok: false, detail: 'no Downloads button' };
      tap(btn);
      const row = await poll(() => findUi((n) => /report \(1\)\.bin|report\.bin/.test(n.text)), 6000);
      const shot = screenshot('downloads-sheet');
      sh('input keyevent 4');
      return { ok: !!row, detail: `${row ? 'report.bin listed' : 'not listed'}; screenshot ${path.basename(shot)}` };
    });
    screenshot('main-light');
  }

  // #3 release build has no devtools socket (v1.1) — last: it swaps the installed APK
  await check(3, 'release build exposes no WebView devtools socket', async () => {
    if (!existsSync(opts.releaseApk)) return { skip: true, detail: `no ${opts.releaseApk}` };
    const debugSocket = sh('cat /proc/net/unix').includes(`webview_devtools_remote_${appPid()}`);
    const inst = adb(['install', '-r', opts.releaseApk]).out;
    if (!/Success/.test(inst)) return { ok: false, detail: `release install failed: ${inst.trim()}` };
    sh(`am start -W -n ${ACTIVITY}`);
    await sleep(6000);
    const pid = appPid();
    const releaseSocket = sh('cat /proc/net/unix').includes(`webview_devtools_remote_${pid}`);
    adb(['install', '-r', opts.debugApk]); // leave the debug build installed for other tools
    if (releaseSocket && sh('getprop ro.debuggable') === '1') {
      return { skip: true, detail: 'device build is debuggable (ro.debuggable=1): WebView opens devtools for every app, so this can only be checked on a user build' };
    }
    return { ok: debugSocket && !releaseSocket && !!pid, detail: `debug socket=${debugSocket}, release socket=${releaseSocket}` };
  });

  // ── summary ────────────────────────────────────────────────────────────
  mkdirSync(opts.out, { recursive: true });
  writeFileSync(path.join(opts.out, 'results.json'), JSON.stringify(results, null, 2));
  const counts = { PASS: 0, FAIL: 0, SKIP: 0 };
  results.forEach((r) => counts[r.status]++);
  console.log(`\nSummary: ${counts.PASS} passed, ${counts.FAIL} failed, ${counts.SKIP} skipped → ${path.join(opts.out, 'results.json')}`);
  process.exitCode = counts.FAIL ? 1 : 0;
}

main()
  .catch((e) => { console.error('Feature test aborted:', e.message); process.exitCode = 1; })
  .finally(() => {
    server.close();
    try { adb(['reverse', '--remove', `tcp:${opts.serverPort}`]); adb(['forward', '--remove', `tcp:${opts.cdpPort}`]); } catch { /* device gone */ }
  });
