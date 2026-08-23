/**
 * @file src/browser/networking/http-proxy-connect.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * HTTP CONNECT tunneling through an HTTP(S) proxy. Establishes a raw tunnel to
 * a target `host:port` by sending an HTTP `CONNECT` request to the proxy and
 * awaiting a 2xx "Connection established" reply. Plain HTTP requests are then
 * written to the tunneled socket directly; HTTPS requests wrap it with
 * `tls.connect()`.
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

import type { Socket } from 'node:net';
import { SocketReader } from './socket-reader';
import { loadNodeBuiltin } from './node-builtins';

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
      authorization = 'Basic ' + Buffer.from(`${user}:${pass}`, 'utf-8').toString('base64');
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

/** Send `CONNECT host:port HTTP/1.1` and await a 2xx "Connection established". */
async function performConnectHandshake(
  socket: Socket,
  targetHost: string,
  targetPort: number,
  authorization: string | undefined,
): Promise<void> {
  const reader = new SocketReader(socket, (cause) =>
    new HttpProxyError(
      `HTTP proxy closed the connection during the CONNECT handshake${cause ? `: ${cause.message}` : ''}`,
      'CONN_CLOSED',
    ));

  const authLine = authorization ? `Proxy-Authorization: ${authorization}\r\n` : '';
  socket.write(
    `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
    `Host: ${targetHost}:${targetPort}\r\n` +
    authLine +
    '\r\n',
  );

  const response = await reader.readUntil(Buffer.from('\r\n\r\n'));
  const headerText = response.toString('utf-8');
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
  if (leftover.length > 0) socket.emit('data', leftover);
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open a connection to an HTTP(S) proxy and negotiate a CONNECT tunnel to the
 * target. Resolves with the already-connected, tunneled socket.
 */
export async function connectThroughHttpProxy(
  options: ConnectThroughHttpProxyOptions,
): Promise<Socket> {
  const net = loadNodeBuiltin<typeof import('node:net')>('node:net');
  const tls = loadNodeBuiltin<typeof import('node:tls')>('node:tls');
  if (!net || !tls) {
    throw new HttpProxyError('Node net/tls builtins are unavailable in this runtime', 'NO_NODE');
  }
  const { proxy, targetHost, targetPort } = options;
  const timeoutMs = options.timeoutMs ?? 30_000;

  const rawSocket = proxy.isTls
    ? tls.connect({
        host: proxy.hostname,
        port: proxy.port,
        servername: proxy.hostname,
        rejectUnauthorized: false,
      })
    : net.connect({ host: proxy.hostname, port: proxy.port });

  return new Promise<Socket>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined; // eslint-disable-line prefer-const

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', onAbort);
      rawSocket.removeListener('error', onSocketError);
      fn();
    };

    const fail = (err: Error) => {
      finish(() => {
        rawSocket.destroy();
        reject(err);
      });
    };

    const onAbort = () => fail(new HttpProxyError('HTTP proxy connection was aborted', 'ABORTED'));

    const onSocketError = (err: Error) =>
      fail(new HttpProxyError(`HTTP proxy connection failed: ${err.message}`, 'CONNECT_ERROR'));

    timer = setTimeout(() => {
      fail(new HttpProxyError(
        `HTTP CONNECT handshake with ${proxy.hostname}:${proxy.port} timed out after ${timeoutMs}ms`,
        'TIMEOUT',
      ));
    }, timeoutMs);

    rawSocket.on('error', onSocketError);

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort);
    }

    const onReady = () => {
      performConnectHandshake(rawSocket, targetHost, targetPort, proxy.authorization)
        .then(() => finish(() => resolve(rawSocket)))
        .catch((err) => {
          finish(() => {
            rawSocket.destroy();
            reject(err instanceof Error ? err : new HttpProxyError(String(err), 'HANDSHAKE'));
          });
        });
    };

    if (proxy.isTls) rawSocket.once('secureConnect', onReady);
    else rawSocket.once('connect', onReady);
  });
}
