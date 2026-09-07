#!/usr/bin/env node
/**
 * @file android/scripts/device-smoke-test.mjs
 *
 * Automated on-device smoke test for the Nova Browser Android app.
 *
 * BACKGROUND: TODO.md's Android item has always listed a "manual on-device
 * feature pass" (tabs, bookmarks/history, downloads, long-press menu, file
 * upload, permission prompts, incognito, theme) with the note "no automated
 * on-device test harness exists yet." This script does not replace that pass
 * — several of those features genuinely need a human (a visual theme check,
 * a real permission dialog, a share-sheet). What it does is automate the
 * slice that a script CAN verify reliably, so every run of the manual pass
 * starts from a confirmed-good baseline instead of re-checking "did it even
 * boot" by hand every time. See doc/2026-09-06-android-manual-test-checklist.md
 * for the parts this script deliberately leaves to a human.
 *
 * WHAT THIS AUTOMATES
 *   Tier 1 (adb + logcat + dumpsys — mechanically simple, high confidence):
 *     - exactly one device/emulator is attached and authorized
 *     - the debug APK installs cleanly
 *     - the app cold-launches and reaches its "resumed" state
 *     - the expected boot log lines appear (native bridge installed, page load
 *       finished) — the same markers doc/2026-08-15-android-mobile-phase0-
 *       completeness.md verified by hand via logcat
 *   Tier 2 (Chrome DevTools Protocol over `adb forward` — the same technique
 *   that doc used by hand for its CDP check, scripted here):
 *     - window.novaNative is actually installed (the JS engine booted, not
 *       just the Activity)
 *     - the ChromeStateSnapshot shape looks right (tabs array, homeUrl,
 *       searchTemplate, etc. — see src/ui/pages/browser-window.ts /
 *       src/app/android-native-bridge.ts for the real contract)
 *     - a real functional check of the "tabs" feature: create a tab via
 *       window.novaNative.createTab(), confirm it shows up in the next state
 *       snapshot
 *
 * WHAT THIS DOES NOT AUTOMATE (by design, not oversight)
 *   Long-press context menu, file upload, camera/mic permission prompts,
 *   downloads (pause/resume/cancel/share), incognito visuals, and light/dark
 *   theme rendering all involve real system UI (dialogs, share sheets, the
 *   document picker) or a human visual judgment call. Driving those blindly
 *   via `adb shell input tap <x> <y>` is fragile (coordinates depend on
 *   screen size/density/theme) and would produce a script that looks green
 *   while testing nothing real. Better to leave them to the manual checklist.
 *
 * REQUIREMENTS
 *   - `adb` on PATH (or pass --adb <path to adb.exe>)
 *   - exactly one device/emulator connected with USB debugging authorized
 *   - a debug APK already built: `npm run build:android` (this script does
 *     NOT build — Gradle needs a real shell, which this tool doesn't assume)
 *
 * USAGE
 *   node android/scripts/device-smoke-test.mjs [options]
 *     --serial <id>     Target a specific device (adb -s). Required if more
 *                        than one device/emulator is attached.
 *     --apk <path>       Override the APK path (default: android/app/build/
 *                        outputs/apk/debug/app-debug.apk).
 *     --port <n>         Local port for `adb forward` to the WebView's CDP
 *                        socket (default 9333 — deliberately not 9222, so
 *                        this doesn't collide with a chrome://inspect session
 *                        you might already have forwarded on this machine).
 *     --skip-cdp         Run Tier 1 only (skip the CDP/tabs check).
 *     --adb <path>       Full path to the adb binary, if it's not on PATH.
 *
 *   Exit code 0 if every check passed, 1 if any failed. Nothing here mutates
 *   the repo or the APK — it only installs/launches/inspects what's already
 *   built, and always removes the `adb forward` it sets up.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const PACKAGE_NAME = 'com.nova.browser'; // android/app/build.gradle applicationId
const ACTIVITY = `${PACKAGE_NAME}/.MainActivity`;
const DEFAULT_APK = path.join(REPO_ROOT, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const DEFAULT_CDP_PORT = 9333;
const BOOT_MARKERS = [
  '[AndroidNativeBridge] Native host detected',
  'onPageFinished',
];

// ── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { serial: null, apk: DEFAULT_APK, port: DEFAULT_CDP_PORT, skipCdp: false, adb: 'adb' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--serial') opts.serial = argv[++i];
    else if (a === '--apk') opts.apk = path.resolve(argv[++i]);
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--skip-cdp') opts.skipCdp = true;
    else if (a === '--adb') opts.adb = argv[++i];
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error(`Unknown argument: ${a} (--help for usage)`); process.exit(1); }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node android/scripts/device-smoke-test.mjs [options]
  --serial <id>   Target device serial (required if >1 device attached)
  --apk <path>    Override APK path (default: android/app/build/outputs/apk/debug/app-debug.apk)
  --port <n>      Local port for CDP adb forward (default: ${DEFAULT_CDP_PORT})
  --skip-cdp      Run Tier 1 only (install/launch/boot-log/dumpsys)
  --adb <path>    Path to adb binary if not on PATH`);
}

const opts = parseArgs(process.argv.slice(2));

// ── small helpers ───────────────────────────────────────────────────────────

const failures = [];
const skipped = [];

function section(title) {
  console.log(`\n${title}`);
}
function pass(label, detail) {
  console.log(`  [PASS] ${label}${detail ? ' — ' + detail : ''}`);
}
function fail(label, detail) {
  console.log(`  [FAIL] ${label}${detail ? ' — ' + detail : ''}`);
  failures.push(label);
}
function skip(label, detail) {
  console.log(`  [SKIP] ${label}${detail ? ' — ' + detail : ''}`);
  skipped.push(label);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function adbArgs(args) {
  return opts.serial ? ['-s', opts.serial, ...args] : args;
}

/** Runs adb synchronously and returns {status, stdout, stderr}. Never throws for a non-zero exit — callers check status. */
function adb(args, extra = {}) {
  const result = spawnSync(opts.adb, adbArgs(args), { encoding: 'utf8', ...extra });
  if (result.error) {
    // ENOENT etc. — adb itself couldn't be launched.
    return { status: -1, stdout: '', stderr: String(result.error.message ?? result.error) };
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** Polls `checkFn` (sync, returns truthy on success) every `intervalMs` up to `timeoutMs`. Returns the truthy value, or null on timeout. */
async function pollUntil(checkFn, { timeoutMs, intervalMs }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = checkFn();
    if (result) return result;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

async function pollUntilAsync(checkFn, { timeoutMs, intervalMs }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await checkFn();
    if (result) return result;
    if (Date.now() >= deadline) return null;
    await sleep(intervalMs);
  }
}

// ── Tier 1: adb / device / install / launch / logcat / dumpsys ─────────────

async function runTier1() {
  section('Tier 1 — adb, install, launch, boot verification');

  const version = adb(['version']);
  if (version.status !== 0) {
    fail('adb is reachable', `could not run "${opts.adb} version" (${version.stderr.trim() || 'not found on PATH'}). Pass --adb <path> or add platform-tools to PATH.`);
    return false;
  }
  pass('adb is reachable');

  const devicesOut = adb(['devices', '-l']).stdout;
  const deviceLines = devicesOut
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('*'));
  const attached = deviceLines.filter((l) => / device /.test(' ' + l + ' ') || l.endsWith(' device'));
  const unauthorized = deviceLines.filter((l) => l.includes('unauthorized'));
  const offline = deviceLines.filter((l) => l.includes('offline'));

  if (deviceLines.length === 0) {
    fail('a device is connected', 'no devices/emulators in `adb devices -l`. Connect your phone via USB, enable USB debugging in Developer Options, and accept the RSA fingerprint prompt on the phone.');
    return false;
  }
  if (unauthorized.length > 0) {
    fail('device is authorized', 'device shows "unauthorized" — check your phone for a USB debugging authorization dialog and accept it, then re-run.');
    return false;
  }
  if (offline.length > 0) {
    fail('device is online', 'device shows "offline" — try unplugging/replugging the USB cable.');
    return false;
  }
  if (attached.length > 1 && !opts.serial) {
    fail('exactly one target device', `${attached.length} devices attached; pass --serial <id> to pick one:\n${deviceLines.map((l) => '    ' + l).join('\n')}`);
    return false;
  }
  pass('device connected and authorized', opts.serial ?? deviceLines[0].split(/\s+/)[0]);

  if (!existsSync(opts.apk)) {
    fail('debug APK exists', `not found at ${opts.apk} — run "npm run build:android" first.`);
    return false;
  }
  const apkStat = statSync(opts.apk);
  const distDir = path.join(REPO_ROOT, 'dist');
  if (existsSync(distDir)) {
    const newestDistMtime = readdirSync(distDir)
      .map((f) => { try { return statSync(path.join(distDir, f)).mtimeMs; } catch { return 0; } })
      .reduce((a, b) => Math.max(a, b), 0);
    if (newestDistMtime > apkStat.mtimeMs) {
      console.log('  [WARN] dist/ is newer than the installed APK — the app may not reflect your latest web build. Run "npm run build:android" if you want to test the current code.');
    }
  }
  pass('debug APK found', `${opts.apk} (${(apkStat.size / (1024 * 1024)).toFixed(1)} MB)`);

  // Clean slate: a stopped app + cleared logcat makes the boot-marker check
  // below mean "this run booted", not "booted at some point since the buffer
  // last wrapped."
  adb(['shell', 'am', 'force-stop', PACKAGE_NAME]);

  const install = adb(['install', '-r', opts.apk]);
  if (install.status !== 0 || !/Success/.test(install.stdout)) {
    fail('adb install -r', (install.stdout + install.stderr).trim() || `exit code ${install.status}`);
    return false;
  }
  pass('APK installed', 'adb install -r → Success');

  adb(['logcat', '-c']);

  const start = adb(['shell', 'am', 'start', '-W', '-n', ACTIVITY]);
  const startOut = start.stdout + start.stderr;
  if (start.status !== 0 || !/Status:\s*ok/.test(startOut)) {
    fail('app launch (am start -W)', startOut.trim() || `exit code ${start.status}`);
    return false;
  }
  const totalTimeMatch = startOut.match(/TotalTime:\s*(\d+)/);
  pass('app launched', totalTimeMatch ? `cold start ${totalTimeMatch[1]}ms` : 'Status: ok');

  const markersSeen = await pollUntil(() => {
    const log = adb(['logcat', '-d']).stdout;
    return BOOT_MARKERS.every((m) => log.includes(m)) ? log : null;
  }, { timeoutMs: 15000, intervalMs: 1000 });

  if (!markersSeen) {
    const log = adb(['logcat', '-d']).stdout;
    const missing = BOOT_MARKERS.filter((m) => !log.includes(m));
    fail('boot log markers present', `missing after 15s: ${missing.join(', ')}. The Activity may have started but the WebView/engine did not finish booting — check "adb logcat" by hand.`);
  } else {
    pass('boot log markers present', BOOT_MARKERS.join(' / '));
  }

  const dump = adb(['shell', 'dumpsys', 'activity', 'activities']).stdout;
  const resumedLine = dump.split('\n').find((l) => l.includes(PACKAGE_NAME) && /resumed=true/i.test(l));
  const topResumed = dump.includes(`topResumedActivity`) && dump.includes(PACKAGE_NAME);
  if (resumedLine || topResumed || new RegExp(`ResumedActivity.*${PACKAGE_NAME.replace(/\./g, '\\.')}`).test(dump)) {
    pass('activity is resumed (foreground)');
  } else {
    fail('activity is resumed (foreground)', 'dumpsys activity activities did not show the app as resumed — it may have crashed on boot; check "adb logcat" for AndroidRuntime crashes.');
  }

  return true;
}

// ── Tier 2: CDP over `adb forward` ──────────────────────────────────────────

function computeAcceptKey(key) {
  return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}

/** Minimal RFC 6455 client: enough to send/receive small single-frame text
 * messages over a plain (non-TLS) loopback socket, which is all a CDP
 * Runtime.evaluate round-trip needs. Does not handle fragmented frames,
 * ping/pong, or payloads over ~64KB — none of which a CDP JSON reply for
 * this app's state snapshot will ever produce. */
function wsConnect(urlStr, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key,
      },
      timeout: timeoutMs,
    });
    req.on('timeout', () => { req.destroy(new Error('WebSocket handshake timed out')); });
    req.on('upgrade', (res, socket) => {
      const expected = computeAcceptKey(key);
      if (res.headers['sec-websocket-accept'] !== expected) {
        socket.destroy();
        return reject(new Error('WebSocket handshake Sec-WebSocket-Accept mismatch'));
      }
      resolve(makeWsClient(socket));
    });
    req.on('error', reject);
    req.end();
  });
}

function makeWsClient(socket) {
  let buffer = Buffer.alloc(0);
  const pending = [];
  let waiter = null;

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    drain();
  });
  socket.on('error', () => { /* surfaced to the caller via recv()'s timeout */ });

  function drain() {
    for (;;) {
      if (buffer.length < 2) return;
      const byte0 = buffer[0];
      const byte1 = buffer[1];
      const opcode = byte0 & 0x0f;
      let len = byte1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        const high = buffer.readUInt32BE(2);
        const low = buffer.readUInt32BE(6);
        if (high !== 0) {
          // A CDP reply this large is not expected for this tool's use; bail
          // out rather than mis-handle it.
          buffer = Buffer.alloc(0);
          if (waiter) { const w = waiter; waiter = null; w.reject(new Error('Unexpectedly large WebSocket frame')); }
          return;
        }
        len = low;
        offset = 10;
      }
      if (buffer.length < offset + len) return; // wait for the rest to arrive
      const payload = buffer.subarray(offset, offset + len);
      buffer = buffer.subarray(offset + len);
      if (opcode === 0x1) {
        const text = payload.toString('utf8');
        if (waiter) { const w = waiter; waiter = null; w.resolve(text); }
        else pending.push(text);
      }
      // close(0x8)/ping(0x9)/pong(0xa) frames: nothing to do for this tool's needs.
    }
  }

  function send(obj) {
    const json = Buffer.from(JSON.stringify(obj), 'utf8');
    const maskKey = crypto.randomBytes(4);
    const masked = Buffer.alloc(json.length);
    for (let i = 0; i < json.length; i++) masked[i] = json[i] ^ maskKey[i % 4];
    let header;
    if (json.length < 126) {
      header = Buffer.from([0x81, 0x80 | json.length]);
    } else {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(json.length, 2);
    }
    socket.write(Buffer.concat([header, maskKey, masked]));
  }

  function recv(timeoutMs = 5000) {
    if (pending.length) return Promise.resolve(pending.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiter = null; reject(new Error('WebSocket recv timed out')); }, timeoutMs);
      waiter = {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
    });
  }

  function close() {
    try { socket.end(); } catch { /* already closed */ }
  }

  return { send, recv, close };
}

async function cdpFetchTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`GET /json/list → HTTP ${res.status}`);
  return res.json();
}

async function cdpEvaluate(port, expression) {
  const targets = await cdpFetchTargets(port);
  const target = targets.find((t) => t.type === 'page') ?? targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('No CDP page target on the forwarded port');
  const ws = await wsConnect(target.webSocketDebuggerUrl);
  try {
    ws.send({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: false } });
    const raw = await ws.recv(5000);
    const parsed = JSON.parse(raw);
    if (parsed.error) throw new Error(`CDP error: ${parsed.error.message}`);
    if (parsed.result?.exceptionDetails) {
      throw new Error(`Page threw: ${parsed.result.exceptionDetails.text ?? JSON.stringify(parsed.result.exceptionDetails)}`);
    }
    return parsed.result?.result?.value;
  } finally {
    ws.close();
  }
}

async function runTier2() {
  section('Tier 2 — CDP bridge-contract + tabs check');

  const pidOut = adb(['shell', 'pidof', PACKAGE_NAME]).stdout.trim();
  const pid = pidOut.split(/\s+/)[0];
  if (!pid) {
    fail('app process is running', `"adb shell pidof ${PACKAGE_NAME}" returned nothing — the app is not running (did Tier 1 fail?).`);
    return;
  }

  const forward = adb(['forward', `tcp:${opts.port}`, `localabstract:webview_devtools_remote_${pid}`]);
  if (forward.status !== 0) {
    fail('adb forward to WebView devtools socket', (forward.stdout + forward.stderr).trim());
    return;
  }

  try {
    // The Activity resuming doesn't mean the JS engine has finished booting
    // inside the WebView yet — poll rather than assume.
    const state = await pollUntilAsync(async () => {
      try {
        const raw = await cdpEvaluate(opts.port, "window.novaNative ? window.novaNative.getState() : 'null'");
        if (typeof raw !== 'string') return null;
        const parsed = JSON.parse(raw);
        return parsed ? parsed : null;
      } catch {
        return null; // devtools socket may not be ready in the first second or two
      }
    }, { timeoutMs: 20000, intervalMs: 1500 });

    if (!state) {
      fail('window.novaNative bridge is installed', 'getState() never returned non-null within 20s — the engine may not have finished booting, or the CDP socket for this pid never came up. Try re-running, or check "adb logcat" for JS errors.');
      return;
    }
    pass('window.novaNative bridge is installed');

    const hasTabs = Array.isArray(state.tabs);
    const hasHomeUrl = typeof state.homeUrl === 'string';
    const hasSearchTemplate = typeof state.searchTemplate === 'string';
    if (hasTabs && hasHomeUrl && hasSearchTemplate) {
      pass('ChromeStateSnapshot shape looks right', `${state.tabs.length} tab(s), homeUrl=${JSON.stringify(state.homeUrl)}`);
    } else {
      fail('ChromeStateSnapshot shape looks right', `expected {tabs: array, homeUrl: string, searchTemplate: string}, got ${JSON.stringify(state).slice(0, 200)}`);
    }

    // Real functional check of the "tabs" item from the manual checklist:
    // create one and confirm it actually shows up in the next snapshot.
    const beforeCount = hasTabs ? state.tabs.length : null;
    try {
      const newTabId = await cdpEvaluate(opts.port, 'window.novaNative.createTab()');
      const afterRaw = await cdpEvaluate(opts.port, 'window.novaNative.getState()');
      const after = JSON.parse(afterRaw);
      const found = Array.isArray(after?.tabs) && after.tabs.some((t) => t.id === newTabId);
      if (found && beforeCount !== null && after.tabs.length === beforeCount + 1) {
        pass('createTab() is reflected in state', `tabs ${beforeCount} → ${after.tabs.length}`);
      } else {
        fail('createTab() is reflected in state', `expected tab id ${JSON.stringify(newTabId)} in the next snapshot; got ${JSON.stringify(after?.tabs)}`);
      }
    } catch (err) {
      fail('createTab() is reflected in state', err instanceof Error ? err.message : String(err));
    }
  } finally {
    adb(['forward', '--remove', `tcp:${opts.port}`]);
  }
}

// ── main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log('Nova Browser — Android on-device smoke test');
  const tier1Ok = await runTier1();
  if (tier1Ok && !opts.skipCdp) {
    await runTier2();
  } else if (opts.skipCdp) {
    skip('Tier 2 (CDP bridge + tabs check)', '--skip-cdp passed');
  } else {
    skip('Tier 2 (CDP bridge + tabs check)', 'Tier 1 did not complete cleanly');
  }

  section('Summary');
  if (failures.length === 0) {
    console.log(`  All checks passed${skipped.length ? ` (${skipped.length} skipped)` : ''}.`);
    console.log('  This covers install/launch/boot + the bridge contract + tabs.');
    console.log('  Still needs a human: bookmarks/history, downloads, long-press menu,');
    console.log('  file upload, permission prompts, incognito, light/dark theme — see');
    console.log('  doc/2026-09-06-android-manual-test-checklist.md.');
  } else {
    console.log(`  ${failures.length} check(s) failed:`);
    for (const f of failures) console.log(`    - ${f}`);
  }
  process.exitCode = failures.length ? 1 : 0;
}

main().catch((err) => {
  console.error('Smoke test crashed unexpectedly:', err);
  process.exitCode = 1;
});
