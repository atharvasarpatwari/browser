#!/usr/bin/env node
/**
 * @file android/scripts/inspect-live-state.mjs
 *
 * Read-only, non-destructive companion to device-smoke-test.mjs.
 *
 * WHY THIS EXISTS: the smoke test force-stops and cold-relaunches the app on
 * every run (by design — it needs a clean boot to verify boot markers). That
 * makes it useless for inspecting a bug that's already reproduced on screen
 * (e.g. "I navigated to a URL and the content area is blank") — running the
 * smoke test would kill that exact state before anyone could look at it.
 *
 * This script does the opposite: it attaches to whatever instance of the app
 * is CURRENTLY running (via the same adb-forward + Chrome DevTools Protocol
 * technique the smoke test uses for its Tier 2), asks it two read-only
 * questions, and changes nothing:
 *
 *   1. window.novaNative.getState() — the exact ChromeStateSnapshot the
 *      engine is reporting right now, including each tab's `loading` and
 *      `error` fields (see src/ui/pages/browser-window.ts). If the active
 *      tab's `error` is non-null, the engine itself is reporting why the
 *      navigation failed. If `error` is null and `loading` is false, the
 *      engine believes the page loaded successfully — which would point the
 *      problem at rendering/painting rather than networking.
 *   2. A DOM probe of the WebView page itself: how many <canvas> elements
 *      exist and their pixel vs. CSS dimensions (per src/app/android-native-
 *      bridge.ts, the engine paints page content onto a canvas rather than
 *      real DOM nodes — a 0×0 or missing canvas would explain a blank
 *      screen even when the engine thinks the page loaded fine).
 *
 * Never force-stops, installs, or launches anything. Only ever removes the
 * `adb forward` it sets up.
 *
 * USAGE
 *   node android/scripts/inspect-live-state.mjs [options]
 *     --serial <id>   Target device serial (required if >1 device attached)
 *     --port <n>      Local port for the adb forward (default 9334 — a
 *                      different default from the smoke test's 9333, so the
 *                      two can be run back-to-back without a stale forward
 *                      colliding).
 *     --adb <path>    Path to adb binary if not on PATH.
 */

import { spawnSync } from 'node:child_process';
import http from 'node:http';
import crypto from 'node:crypto';

const PACKAGE_NAME = 'com.nova.browser';
const DEFAULT_PORT = 9334;

function parseArgs(argv) {
  const opts = { serial: null, port: DEFAULT_PORT, adb: 'adb' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--serial') opts.serial = argv[++i];
    else if (a === '--port') opts.port = Number(argv[++i]);
    else if (a === '--adb') opts.adb = argv[++i];
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error(`Unknown argument: ${a} (--help for usage)`); process.exit(1); }
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node android/scripts/inspect-live-state.mjs [options]
  --serial <id>   Target device serial (required if >1 device attached)
  --port <n>      Local port for the adb forward (default: ${DEFAULT_PORT})
  --adb <path>    Path to adb binary if not on PATH

Read-only: attaches to whatever instance of the app is already running and
reports its current state. Does not force-stop, install, or launch anything.`);
}

const opts = parseArgs(process.argv.slice(2));

function adbArgs(args) {
  return opts.serial ? ['-s', opts.serial, ...args] : args;
}

function adb(args, extra = {}) {
  const result = spawnSync(opts.adb, adbArgs(args), { encoding: 'utf8', ...extra });
  if (result.error) {
    return { status: -1, stdout: '', stderr: String(result.error.message ?? result.error) };
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

// ── Minimal CDP-over-adb-forward client (copied verbatim from
//    device-smoke-test.mjs's Tier 2 — already unit-tested and confirmed
//    working against this device's real WebView devtools endpoint). ──────────

function computeAcceptKey(key) {
  return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}

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
  socket.on('error', () => {});

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
          buffer = Buffer.alloc(0);
          if (waiter) { const w = waiter; waiter = null; w.reject(new Error('Unexpectedly large WebSocket frame')); }
          return;
        }
        len = low;
        offset = 10;
      }
      if (buffer.length < offset + len) return;
      const payload = buffer.subarray(offset, offset + len);
      buffer = buffer.subarray(offset + len);
      if (opcode === 0x1) {
        const text = payload.toString('utf8');
        if (waiter) { const w = waiter; waiter = null; w.resolve(text); }
        else pending.push(text);
      }
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
    try { socket.end(); } catch {}
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

// ── main ─────────────────────────────────────────────────────────────────

const DOM_PROBE_EXPR = `
JSON.stringify({
  canvasCount: document.querySelectorAll('canvas').length,
  canvases: Array.from(document.querySelectorAll('canvas')).map(c => ({
    attrWidth: c.width, attrHeight: c.height,
    cssWidth: c.clientWidth, cssHeight: c.clientHeight,
    display: getComputedStyle(c).display, visibility: getComputedStyle(c).visibility,
  })),
  bodyChildCount: document.body.children.length,
  bodyChildTags: Array.from(document.body.children).map(el => el.tagName),
  novaGlobals: Object.keys(window).filter(k => /nova/i.test(k)),
})`;

async function main() {
  console.log('Nova Browser — live state inspector (read-only, no restart)\n');

  const version = adb(['version']);
  if (version.status !== 0) {
    console.error(`[FAIL] adb is not reachable (${version.stderr.trim() || 'not found on PATH'}). Pass --adb <path>.`);
    process.exitCode = 1;
    return;
  }

  const pidOut = adb(['shell', 'pidof', PACKAGE_NAME]).stdout.trim();
  const pid = pidOut.split(/\s+/)[0];
  if (!pid) {
    console.error(`[FAIL] "${PACKAGE_NAME}" is not currently running (adb shell pidof returned nothing). Launch it first, reproduce the issue, then re-run this.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Attaching to running process — pid ${pid}`);

  const forward = adb(['forward', `tcp:${opts.port}`, `localabstract:webview_devtools_remote_${pid}`]);
  if (forward.status !== 0) {
    console.error(`[FAIL] adb forward failed: ${(forward.stdout + forward.stderr).trim()}`);
    process.exitCode = 1;
    return;
  }

  try {
    console.log('\n--- window.novaNative.getState() ---');
    try {
      const raw = await cdpEvaluate(opts.port, "window.novaNative ? window.novaNative.getState() : 'null'");
      if (typeof raw !== 'string' || raw === 'null') {
        console.log('  window.novaNative is not installed on this page (bridge not live).');
      } else {
        const state = JSON.parse(raw);
        console.log(JSON.stringify(state, null, 2));
        const active = state.tabs?.find((t) => t.id === state.activeTabId) ?? state.tabs?.[0];
        if (active) {
          console.log(`\n  Active tab summary: url=${JSON.stringify(active.url)} loading=${active.loading} error=${JSON.stringify(active.error)}`);
        }
      }
    } catch (err) {
      console.log(`  Could not read state: ${err instanceof Error ? err.message : String(err)}`);
    }

    console.log('\n--- DOM / canvas probe ---');
    try {
      const raw = await cdpEvaluate(opts.port, DOM_PROBE_EXPR);
      console.log(JSON.stringify(JSON.parse(raw), null, 2));
    } catch (err) {
      console.log(`  Could not probe DOM: ${err instanceof Error ? err.message : String(err)}`);
    }
  } finally {
    adb(['forward', '--remove', `tcp:${opts.port}`]);
  }

  console.log('\nDone. This did not restart or modify the app — whatever was on screen is still there.');
}

main().catch((err) => {
  console.error('inspect-live-state crashed unexpectedly:', err);
  process.exitCode = 1;
});
