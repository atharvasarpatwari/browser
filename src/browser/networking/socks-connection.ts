/**
 * @file src/browser/networking/socks-connection.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * A pure-TS SOCKS client over {@link ISocketHandle}s (sockets owned by the
 * main process). Supports:
 *   • SOCKS4  (IPv4 targets)
 *   • SOCKS4a (domain targets, resolved by the proxy)
 *   • SOCKS5  (IPv4 / IPv6 / domain targets, RFC 1928)
 *     - no-authentication and username/password auth (RFC 1929)
 *
 * The client performs the SOCKS handshake and returns a handle that is
 * already tunnelled to the target host. Plain HTTP requests are then written
 * to it directly; HTTPS requests upgrade it with TLS.
 *
 * Domain names are ALWAYS handed to the proxy (SOCKS4a / SOCKS5 ATYP=0x03)
 * so DNS resolution happens on the proxy side — the reason SOCKS exists.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { concatBytes, encodeUtf8 } from './byte-codecs';
import { SocketReader } from './socket-reader';
import { getSocketProxy } from './socket-proxy';
import type { ISocketHandle } from './socket-handle';

// ── SOCKS5 constants (RFC 1928) ──────────────────────────────────────────────
const SOCKS5_VERSION       = 0x05;
const SOCKS5_NO_AUTH       = 0x00;
const SOCKS5_USER_PASS     = 0x02;
const SOCKS5_CMD_CONNECT   = 0x01;
const SOCKS5_ATYP_IPV4     = 0x01;
const SOCKS5_ATYP_DOMAIN   = 0x03;
const SOCKS5_ATYP_IPV6     = 0x04;
const SOCKS5_REP_SUCCESS   = 0x00;
const SOCKS5_AUTH_VERSION  = 0x01;

// ── SOCKS4 constants (SOCKS4 protocol spec) ──────────────────────────────────
const SOCKS4_VERSION       = 0x04;
const SOCKS4_CMD_CONNECT   = 0x01;
const SOCKS4_REPLY_GRANTED = 0x5a;
const SOCKS4_REPLY_REJECTED = 0x5b;
const SOCKS4_REPLY_IDENTD  = 0x5c;
const SOCKS4_REPLY_USERID  = 0x5d;

const DEFAULT_SOCKS_PORT   = 1080;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Parsed SOCKS proxy endpoint. */
export interface SocksProxyInfo {
  readonly protocol: 'socks4' | 'socks4a' | 'socks5';
  readonly hostname: string;
  readonly port: number;
  readonly username?: string;
  readonly password?: string;
}

export interface ConnectThroughSocksOptions {
  /** The parsed SOCKS proxy to connect through. */
  readonly proxy: SocksProxyInfo;
  /** Target hostname to tunnel to (resolved by the proxy for domains). */
  readonly targetHost: string;
  /** Target TCP port to tunnel to. */
  readonly targetPort: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** Error type for all SOCKS failures. */
export class SocksError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SocksError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// URL PARSING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a `socks4://`, `socks4a://` or `socks5://` proxy URL into a
 * {@link SocksProxyInfo}. Returns `null` for malformed or unsupported URLs.
 */
export function parseSocksProxyUrl(url: string): SocksProxyInfo | null {
  try {
    const u = new URL(url);

    let protocol: SocksProxyInfo['protocol'];
    if (u.protocol === 'socks4:') protocol = 'socks4';
    else if (u.protocol === 'socks4a:') protocol = 'socks4a';
    else if (u.protocol === 'socks5:') protocol = 'socks5';
    else return null;

    const port = u.port ? parseInt(u.port, 10) : DEFAULT_SOCKS_PORT;
    if (Number.isNaN(port) || port <= 0 || port > 65535) return null;

    // Non-special schemes keep surrounding brackets on IPv6 hosts.
    let hostname = u.hostname;
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1);
    }
    if (!hostname) return null;

    let username: string | undefined;
    let password: string | undefined;
    if (u.username) {
      try {
        username = decodeURIComponent(u.username);
        password = u.password ? decodeURIComponent(u.password) : '';
      } catch {
        username = u.username;
        password = u.password ?? '';
      }
    }

    return username === undefined
      ? { protocol, hostname, port }
      : { protocol, hostname, port, username, password };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADDRESS ENCODING HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function ipv4Bytes(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = parseInt(part, 10);
    if (n > 255) return null;
    bytes.push(n);
  }
  return bytes;
}

function ipv6Bytes(host: string): number[] | null {
  if (!host.includes(':')) return null;
  const groups = host.split('::');
  if (groups.length > 2) return null;

  const left  = groups[0] ? groups[0].split(':').filter(Boolean) : [];
  const right = groups.length === 2 && groups[1] ? groups[1].split(':').filter(Boolean) : [];
  const hasDoubleColon = host.includes('::');

  if (!hasDoubleColon && left.length !== 8) return null;
  if (left.length + right.length > 8) return null;

  const missing = 8 - left.length - right.length;
  const parts = hasDoubleColon
    ? [...left, ...Array<string>(missing).fill('0'), ...right]
    : left;

  const bytes: number[] = [];
  for (const part of parts) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
    const n = parseInt(part, 16);
    bytes.push((n >> 8) & 0xff, n & 0xff);
  }
  return bytes;
}

/** Encode a target host for a SOCKS5 CONNECT request. */
function encodeSocks5Address(host: string): { addrBuf: Uint8Array; atyp: number } {
  const v4 = ipv4Bytes(host);
  if (v4) return { addrBuf: Uint8Array.from(v4), atyp: SOCKS5_ATYP_IPV4 };

  const v6 = ipv6Bytes(host);
  if (v6) return { addrBuf: Uint8Array.from(v6), atyp: SOCKS5_ATYP_IPV6 };

  const hostBytes = encodeUtf8(host);
  return {
    addrBuf: concatBytes([Uint8Array.of(hostBytes.length), hostBytes]),
    atyp: SOCKS5_ATYP_DOMAIN,
  };
}

function socks5RepText(rep: number): string {
  const map: Record<number, string> = {
    0x01: 'general SOCKS server failure',
    0x02: 'connection not allowed by ruleset',
    0x03: 'network unreachable',
    0x04: 'host unreachable',
    0x05: 'connection refused',
    0x06: 'TTL expired',
    0x07: 'command not supported',
    0x08: 'address type not supported',
  };
  return map[rep] ?? `unknown error code 0x${rep.toString(16)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDSHAKES
// ─────────────────────────────────────────────────────────────────────────────

/** SOCKS5: greeting → optional auth → CONNECT (RFC 1928 + RFC 1929). */
async function performSocks5Handshake(
  handle: ISocketHandle,
  proxy: SocksProxyInfo,
  targetHost: string,
  targetPort: number,
): Promise<void> {
  const reader = new SocketReader(handle, (cause) =>
    new SocksError(
      `SOCKS proxy closed the connection during the handshake${cause ? `: ${cause.message}` : ''}`,
      'CONN_CLOSED',
    ));
  const hasCreds = proxy.username !== undefined;
  const methods = hasCreds ? [SOCKS5_NO_AUTH, SOCKS5_USER_PASS] : [SOCKS5_NO_AUTH];

  await handle.write(Uint8Array.from([SOCKS5_VERSION, methods.length, ...methods]));

  const methodReply = await reader.read(2);
  if (methodReply[0] !== SOCKS5_VERSION) {
    throw new SocksError(
      `Invalid SOCKS5 greeting reply version 0x${methodReply[0]!.toString(16)}`,
      'BAD_VERSION',
    );
  }

  const method = methodReply[1]!;
  if (method === 0xff) {
    throw new SocksError('SOCKS5 proxy rejected all offered authentication methods', 'METHOD_REJECTED');
  }
  if (method === SOCKS5_USER_PASS) {
    if (proxy.username === undefined) {
      throw new SocksError('SOCKS5 proxy requires username/password but none were provided', 'AUTH_REQUIRED');
    }
    const uname = encodeUtf8(proxy.username);
    const passwd = encodeUtf8(proxy.password ?? '');
    await handle.write(concatBytes([
      Uint8Array.of(SOCKS5_AUTH_VERSION, uname.length),
      uname,
      Uint8Array.of(passwd.length),
      passwd,
    ]));

    const authReply = await reader.read(2);
    if (authReply[0] !== SOCKS5_AUTH_VERSION || authReply[1] !== 0x00) {
      throw new SocksError('SOCKS5 proxy rejected the username/password', 'AUTH_FAILED');
    }
  } else if (method !== SOCKS5_NO_AUTH) {
    throw new SocksError(
      `SOCKS5 proxy selected unsupported authentication method 0x${method.toString(16)}`,
      'AUTH_UNSUPPORTED',
    );
  }

  const { addrBuf, atyp } = encodeSocks5Address(targetHost);
  await handle.write(concatBytes([
    Uint8Array.from([SOCKS5_VERSION, SOCKS5_CMD_CONNECT, 0x00, atyp]),
    addrBuf,
    Uint8Array.from([(targetPort >> 8) & 0xff, targetPort & 0xff]),
  ]));

  const header = await reader.read(4);
  if (header[0] !== SOCKS5_VERSION) {
    throw new SocksError(
      `Invalid SOCKS5 CONNECT reply version 0x${header[0]!.toString(16)}`,
      'BAD_VERSION',
    );
  }
  if (header[1] !== SOCKS5_REP_SUCCESS) {
    throw new SocksError(`SOCKS5 connect failed: ${socks5RepText(header[1]!)}`, 'CONNECT_FAILED');
  }

  // Consume the reply's bound address + port so the tunneled stream is clean.
  const replyAtyp = header[3]!;
  let restLen: number;
  if (replyAtyp === SOCKS5_ATYP_IPV4) restLen = 4;
  else if (replyAtyp === SOCKS5_ATYP_IPV6) restLen = 16;
  else if (replyAtyp === SOCKS5_ATYP_DOMAIN) {
    const lenByte = await reader.read(1);
    restLen = lenByte[0]!;
  } else {
    throw new SocksError(
      `SOCKS5 proxy returned unsupported address type 0x${replyAtyp.toString(16)}`,
      'BAD_ATYP',
    );
  }
  await reader.read(restLen + 2);

  const leftover = reader.detach();
  if (leftover.length > 0) handle.enqueueIncoming(leftover);
}

/** SOCKS4 / SOCKS4a: CONNECT (domain targets use the SOCKS4a extension). */
async function performSocks4Handshake(
  handle: ISocketHandle,
  proxy: SocksProxyInfo,
  targetHost: string,
  targetPort: number,
): Promise<void> {
  const reader = new SocketReader(handle, (cause) =>
    new SocksError(
      `SOCKS proxy closed the connection during the handshake${cause ? `: ${cause.message}` : ''}`,
      'CONN_CLOSED',
    ));
  const userid = encodeUtf8(proxy.username ?? '');
  const portBuf = Uint8Array.from([(targetPort >> 8) & 0xff, targetPort & 0xff]);
  const ipv4 = ipv4Bytes(targetHost);

  let request: Uint8Array;
  if (ipv4) {
    request = concatBytes([
      Uint8Array.of(SOCKS4_VERSION, SOCKS4_CMD_CONNECT),
      portBuf,
      Uint8Array.from(ipv4),
      userid,
      Uint8Array.of(0x00),
    ]);
  } else {
    // SOCKS4a: proxy resolves the domain. Signal with IP 0.0.0.1 and append
    // the hostname after the user id terminator.
    const hostBuf = encodeUtf8(targetHost);
    request = concatBytes([
      Uint8Array.of(SOCKS4_VERSION, SOCKS4_CMD_CONNECT),
      portBuf,
      Uint8Array.of(0x00, 0x00, 0x00, 0x01),
      userid,
      Uint8Array.of(0x00),
      hostBuf,
      Uint8Array.of(0x00),
    ]);
  }

  await handle.write(request);

  const reply = await reader.read(8);
  if (reply[0] !== 0x00) {
    throw new SocksError(
      `Invalid SOCKS4 reply version byte 0x${reply[0]!.toString(16)}`,
      'BAD_VERSION',
    );
  }

  const cd = reply[1]!;
  if (cd !== SOCKS4_REPLY_GRANTED) {
    const text = cd === SOCKS4_REPLY_REJECTED
      ? 'request rejected or failed'
      : cd === SOCKS4_REPLY_IDENTD
        ? 'request rejected because identd is unreachable'
        : cd === SOCKS4_REPLY_USERID
          ? 'request rejected because of a differing user id'
          : `unknown status 0x${cd.toString(16)}`;
    throw new SocksError(`SOCKS4 connect failed: ${text}`, 'CONNECT_FAILED');
  }

  const leftover = reader.detach();
  if (leftover.length > 0) handle.enqueueIncoming(leftover);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION PHASE
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve once the proxy connection is usable; reject on connection errors. */
function waitForSocksConnection(handle: ISocketHandle): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const unsubs: Array<() => void> = [];
    const done = (fn: () => void) => {
      for (const unsub of unsubs.splice(0)) unsub();
      fn();
    };
    unsubs.push(handle.onEvent('connect', () => done(() => resolve())));
    unsubs.push(handle.onEvent('error', (payload) => {
      const message = payload instanceof Error ? payload.message : String(payload ?? 'unknown error');
      done(() => reject(new SocksError(`SOCKS proxy connection failed: ${message}`, 'CONNECT_ERROR')));
    }));
    unsubs.push(handle.onEvent('end', () => {
      done(() => reject(new SocksError('SOCKS proxy closed the connection during connect', 'CONN_CLOSED')));
    }));
    unsubs.push(handle.onEvent('close', () => {
      done(() => reject(new SocksError('SOCKS proxy closed the connection during connect', 'CONN_CLOSED')));
    }));
  });
}

/** Wait for the SOCKS phase to settle within timeoutMs, honoring `signal`. */
async function waitForSocksTunnel(
  handle: ISocketHandle,
  proxy: SocksProxyInfo,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new SocksError(
        `SOCKS handshake with ${proxy.hostname}:${proxy.port} timed out after ${timeoutMs}ms`,
        'TIMEOUT',
      ));
    }, timeoutMs);

    const onAbort = () => {
      cleanup();
      reject(new SocksError('SOCKS connection was aborted', 'ABORTED'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new SocksError('SOCKS connection was aborted', 'ABORTED'));
        return;
      }
      signal.addEventListener('abort', onAbort);
    }

    (async () => {
      await waitForSocksConnection(handle);
      await (proxy.protocol === 'socks5'
        ? performSocks5Handshake(handle, proxy, targetHost, targetPort)
        : performSocks4Handshake(handle, proxy, targetHost, targetPort));
    })().then(
      () => {
        cleanup();
        resolve();
      },
      (err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new SocksError(String(err), 'HANDSHAKE'));
      },
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open a connection to a SOCKS proxy and negotiate a tunnel to the target.
 * Resolves with the already-tunneled socket handle (owned by the main
 * process). On failure the underlying socket is destroyed.
 */
export async function connectThroughSocks(
  options: ConnectThroughSocksOptions,
): Promise<ISocketHandle> {
  const { proxy, targetHost, targetPort } = options;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const handle = await getSocketProxy().openTcp({
    host: proxy.hostname,
    port: proxy.port,
  });

  try {
    await waitForSocksTunnel(handle, proxy, targetHost, targetPort, timeoutMs, options.signal);
    return handle;
  } catch (err) {
    void handle.destroy().catch(() => undefined);
    throw err;
  }
}