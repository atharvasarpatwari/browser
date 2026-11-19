/**
 * Minimal Chrome DevTools Protocol client for the Nova engine WebView, shared by
 * device-smoke-test.mjs and emulator-feature-test.mjs. Dependency-free: a
 * hand-rolled RFC 6455 client is enough for Runtime.evaluate round-trips over
 * the `adb forward`ed loopback devtools socket (see the smoke-test doc,
 * doc/2026-09-06-android-device-smoke-test.md, for why no `ws` package).
 */
import http from 'node:http';
import crypto from 'node:crypto';

function computeAcceptKey(key) {
  return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}

/** Minimal RFC 6455 client: single-frame text messages over a plain loopback
 * socket. Does not handle fragmented frames, ping/pong, or payloads over 4 GB. */
export function wsConnect(urlStr, timeoutMs = 5000) {
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
      if (res.headers['sec-websocket-accept'] !== computeAcceptKey(key)) {
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
      const opcode = buffer[0] & 0x0f;
      let len = buffer[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buffer.length < 4) return;
        len = buffer.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buffer.length < 10) return;
        const high = buffer.readUInt32BE(2);
        if (high !== 0) {
          buffer = Buffer.alloc(0);
          if (waiter) { const w = waiter; waiter = null; w.reject(new Error('Unexpectedly large WebSocket frame')); }
          return;
        }
        len = buffer.readUInt32BE(6);
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
      // close(0x8)/ping(0x9)/pong(0xa): nothing to do for these tools.
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
    } else if (json.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(json.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(json.length, 6);
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

export async function cdpFetchTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  if (!res.ok) throw new Error(`GET /json/list → HTTP ${res.status}`);
  return res.json();
}

/**
 * Runtime.evaluate in the engine page. With awaitPromise, a returned promise is
 * awaited (up to timeoutMs) and its resolved value returned.
 */
export async function cdpEvaluate(port, expression, { awaitPromise = false, timeoutMs = 5000 } = {}) {
  const targets = await cdpFetchTargets(port);
  const target = targets.find((t) => t.type === 'page') ?? targets[0];
  if (!target?.webSocketDebuggerUrl) throw new Error('No CDP page target on the forwarded port');
  const ws = await wsConnect(target.webSocketDebuggerUrl);
  try {
    ws.send({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise } });
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const parsed = JSON.parse(await ws.recv(Math.max(1, deadline - Date.now())));
      if (parsed.id !== 1) continue; // skip any protocol events
      if (parsed.error) throw new Error(`CDP error: ${parsed.error.message}`);
      if (parsed.result?.exceptionDetails) {
        const d = parsed.result.exceptionDetails;
        throw new Error(`Page threw: ${d.exception?.description ?? d.text ?? JSON.stringify(d)}`);
      }
      return parsed.result?.result?.value;
    }
  } finally {
    ws.close();
  }
}
