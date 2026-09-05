/**
 * @file src/browser/networking/http-proxy-connect.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * HTTP CONNECT tunneling through an HTTP(S) proxy. Establishes a raw tunnel to
 * a target `host:port` by sending an HTTP `CONNECT` request to the proxy and
 * awaiting a 2xx "Connection established" reply. Plain HTTP requests are then
 * written to the tunneled handle directly; HTTPS requests upgrade it with TLS
 * via `handle.upgradeTls()`.
 *
 * The proxy performs the DNS resolution of the target (the client only ever
 * connects to the proxy endpoint).
 *
 * URL credentials are turned into a `Proxy-Authorization: Basic` header.
 * TLS to the proxy itself (`https://` proxy URLs) is connected with
 * `rejectUnauthorized: false`, matching the legacy "trust the wire, validate
 * the target later" behavior of the raw-socket transport.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { bytesToBase64, decodeUtf8, encodeUtf8 } from './byte-codecs';
import { SocketReader } from './socket-reader';
import { getSocketProxy } from './socket-proxy';
import type { ISocketHandle } from './socket-handle';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Parsed HTTP(S) proxy endpoint. */
export interface HttpProxyInfo {
  readonly hostname: string;
  readonly port: number;
  /** Whether the connection to the proxy itself is TLS (`https://` URL). */
  readonly isTls: boolean;
  /** Precomputed `Proxy-Authorization` value, when the URL carries credentials. */
  readonly authorization?: string;
}

export interface ConnectThroughHttpProxyOptions {
  /** The parsed HTTP(S) proxy to connect through. */
  readonly proxy: HttpProxyInfo;
  /** Target hostname to tunnel to (resolved by the proxy). */
  readonly targetHost: string;
  /** Target TCP port to tunnel to. */
  readonly targetPort: number;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** Error type for all HTTP proxy (CONNECT) failures. */
export class HttpProxyError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'HttpProxyError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// URL PARSING
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_HTTP_PROXY_PORT = 80;
const DEFAULT_HTTPS_PROXY_PORT = 443;

/**
 * Parse an `http://` or `https://` proxy URL into a {@link HttpProxyInfo}.
 * Returns `null` for malformed or unsupported URLs.
 */
export function parseHttpProxyUrl(url: string): HttpProxyInfo | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

    const isTls = u.protocol === 'https:';
    const port = u.port ? parseInt(u.port, 10) : (isTls ? DEFAULT_HTTPS_PROXY_PORT : DEFAULT_HTTP_PROXY_PORT);
    if (Number.isNaN(port) || port <= 0 || port > 65535) return null;

    // Non-special schemes keep surrounding brackets on IPv6 hosts.
    let hostname = u.hostname;
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      hostname = hostname.slice(1, -1);
    }
    if (!hostname) return null;

    let authorization: string | undefined;
    if (u.username) {
      let user: string;
      let pass: string;
      try {
        user = decodeURIComponent(u.username);
        pass = u.password ? decodeURIComponent(u.password) : '';
      } catch {
        user = u.username;
        pass = u.password ?? '';
      }
      authorization = 'Basic ' + bytesToBase64(encodeUtf8(`${user}:${pass}`));
    }

    return authorization === undefined
      ? { hostname, port, isTls }
      : { hostname, port, isTls, authorization };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDSHAKE
// ─────────────────────────────────────────────────────────────────────────────

const CONNECT_HEAD_DELIMITER = encodeUtf8('\r\n\r\n');

/** Send `CONNECT host:port HTTP/1.1` and await a 2xx "Connection established". */
async function performConnectHandshake(
  handle: ISocketHandle,
  targetHost: string,
  targetPort: number,
  authorization: string | undefined,
): Promise<void> {
  const reader = new SocketReader(handle, (cause) =>
    new HttpProxyError(
      `HTTP proxy closed the connection during the CONNECT handshake${cause ? `: ${cause.message}` : ''}`,
      'CONN_CLOSED',
    ));

  const authLine = authorization ? `Proxy-Authorization: ${authorization}\r\n` : '';
  await handle.write(encodeUtf8(
    `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
    `Host: ${targetHost}:${targetPort}\r\n` +
    authLine +
    '\r\n',
  ));

  const response = await reader.readUntil(CONNECT_HEAD_DELIMITER);
  const headerText = decodeUtf8(response);
  const statusLine = headerText.split('\r\n')[0] ?? '';
  const match = /^HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(statusLine);
  if (!match) {
    throw new HttpProxyError(
      `Malformed HTTP proxy CONNECT response: ${statusLine || '(empty status line)'}`,
      'BAD_RESPONSE',
    );
  }
  const status = parseInt(match[1]!, 10);
  if (status < 200 || status >= 300) {
    throw new HttpProxyError(`HTTP proxy CONNECT failed with status ${status}`, 'CONNECT_FAILED');
  }

  const leftover = reader.detach();
  if (leftover.length > 0) handle.enqueueIncoming(leftover);
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION PHASE
// ─────────────────────────────────────────────────────────────────────────────

/** Resolve once the proxy connection is usable; reject on connection errors. */
function waitForConnection(handle: ISocketHandle, secure: boolean): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const unsubs: Array<() => void> = [];
    const done = (fn: () => void) => {
      for (const unsub of unsubs.splice(0)) unsub();
      fn();
    };
    unsubs.push(handle.onEvent(secure ? 'secureConnect' : 'connect', () => done(() => resolve())));
    unsubs.push(handle.onEvent('error', (payload) => {
      const message = payload instanceof Error ? payload.message : String(payload ?? 'unknown error');
      done(() => reject(new HttpProxyError(`HTTP proxy connection failed: ${message}`, 'CONNECT_ERROR')));
    }));
    unsubs.push(handle.onEvent('end', () => {
      if (!secure) done(() => reject(new HttpProxyError('HTTP proxy closed the connection during connect', 'CONN_CLOSED')));
    }));
    unsubs.push(handle.onEvent('close', () => {
      done(() => reject(new HttpProxyError('HTTP proxy closed the connection during connect', 'CONN_CLOSED')));
    }));
  });
}

/** Wait for the tunnel phase to settle within timeoutMs, honoring `signal`. */
async function waitForProxyTunnel(
  handle: ISocketHandle,
  proxy: HttpProxyInfo,
  targetHost: string,
  targetPort: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new HttpProxyError(
        `HTTP CONNECT handshake with ${proxy.hostname}:${proxy.port} timed out after ${timeoutMs}ms`,
        'TIMEOUT',
      ));
    }, timeoutMs);

    const onAbort = () => {
      cleanup();
      reject(new HttpProxyError('HTTP proxy connection was aborted', 'ABORTED'));
    };

    const cleanup = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    if (signal) {
      if (signal.aborted) {
        cleanup();
        reject(new HttpProxyError('HTTP proxy connection was aborted', 'ABORTED'));
        return;
      }
      signal.addEventListener('abort', onAbort);
    }

    (async () => {
      await waitForConnection(handle, proxy.isTls);
      await performConnectHandshake(handle, targetHost, targetPort, proxy.authorization);
    })().then(
      () => {
        cleanup();
        resolve();
      },
      (err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new HttpProxyError(String(err), 'HANDSHAKE'));
      },
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open a connection to an HTTP(S) proxy and negotiate a CONNECT tunnel to the
 * target. Resolves with the already-tunneled socket handle (owned by the main
 * process). On failure the underlying socket is destroyed.
 */
export async function connectThroughHttpProxy(
  options: ConnectThroughHttpProxyOptions,
): Promise<ISocketHandle> {
  const { proxy, targetHost, targetPort } = options;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const handle = await getSocketProxy().openTcp({
    host: proxy.hostname,
    port: proxy.port,
    tls: proxy.isTls,
  });

  try {
    await waitForProxyTunnel(handle, proxy, targetHost, targetPort, timeoutMs, options.signal);
    return handle;
  } catch (err) {
    void handle.destroy().catch(() => undefined);
    throw err;
  }
}