/**
 * Vite dev-server middleware that lets the Nova engine, running inside a plain
 * browser, load pages from ANY external HTTP(S) server.
 *
 * The engine's browser transport (`FetchHttpClient`) uses `globalThis.fetch()`,
 * and the host browser enforces Same-Origin Policy on it — so cross-origin page
 * loads fail with a CORS NetworkError. Electron/Node builds never hit this
 * (they use `RawSocketHttpClient` over net/tls). This middleware is the browser
 * equivalent: a same-origin "fetch through the dev server" hop that forwards to
 * the real server and pipes the response back, letting the engine render
 * arbitrary external sites during development.
 *
 * Redirects are followed server-side (a browser turns a `redirect: 'manual'`
 * 3xx into an opaque, status-0 response, which the engine cannot read). The
 * final URL after redirects is reported back to the engine via the
 * `x-nova-proxy-url` header so the address bar and history stay accurate.
 *
 * Only used by the Vite dev server (`configureServer`); never shipped.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';

export const NOVA_PROXY_PATH = '/__nova_proxy/';

/** Request headers forwarded to the upstream server. */
const FORWARD_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'authorization',
  'cookie',
  'origin',
  'referer',
  'user-agent',
  'x-requested-with',
]);

/** Response headers that must not be copied verbatim to the client. */
const SKIP_RESPONSE_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'transfer-encoding',
  'upgrade',
]);

/**
 * Extracts the target URL from a `/__nova_proxy/...` request path.
 * Supports both `?url=<encoded>` and path-encoded forms. Returns null when the
 * request is not a proxy request or the target is not an http(s) URL.
 */
export function parseNovaProxyTarget(url: string): string | null {
  if (!url.startsWith(NOVA_PROXY_PATH)) return null;
  const q = url.indexOf('?');
  if (q !== -1) {
    const target = new URLSearchParams(url.slice(q)).get('url');
    return target && /^https?:\/\//i.test(target) ? target : null;
  }
  const rest = url.slice(NOVA_PROXY_PATH.length);
  if (!rest) return null;
  try {
    const decoded = decodeURIComponent(rest);
    return /^https?:\/\//i.test(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

/** Builds the same-origin proxy URL for a target http(s) URL. */
export function buildNovaProxyUrl(origin: string, target: string): string {
  return `${origin}${NOVA_PROXY_PATH}?url=${encodeURIComponent(target)}`;
}

export type NovaProxyMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) => void;

/** Creates the connect-style middleware for `server.middlewares.use()`. */
export function createNovaDevProxyMiddleware(): NovaProxyMiddleware {
  return (req, res, next) => {
    const target = parseNovaProxyTarget(req.url ?? '');
    if (!target) {
      next();
      return;
    }

    // Same-origin in dev, but harmless if the app is ever embedded elsewhere.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    );
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Expose-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf-8');
    });
    req.on('error', () => {
      // Client connection died; nothing left to do.
    });

    req.on('end', () => {
      void proxyRequest(target, req, res, body);
    });
  };
}

/** Vite plugin that mounts the proxy on the dev server. */
export function novaDevProxyPlugin(): { name: string; configureServer(server: {
  middlewares: { use: (path: string, handler: NovaProxyMiddleware) => void };
}): void } {
  return {
    name: 'nova-dev-proxy',
    configureServer(server) {
      // Mounted without a path prefix: connect would otherwise strip the
      // mount path from req.url, breaking parseNovaProxyTarget. The handler
      // fast-paths to next() for non-proxy paths.
      server.middlewares.use(createNovaDevProxyMiddleware());
    },
  };
}

async function proxyRequest(
  target: string,
  req: IncomingMessage,
  res: ServerResponse,
  body: string,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  // Abort only when the client disconnects mid-fetch. res 'close' also fires
  // after a normal res.end(), but by then writableEnded is already true and
  // the upstream fetch has finished. (req 'close' fires immediately after
  // 'end' on bodyless requests and would abort every proxy call.)
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (FORWARD_REQUEST_HEADERS.has(key.toLowerCase()) && typeof value === 'string') {
      headers[key] = value;
    }
  }

  const method = (req.method ?? 'GET').toUpperCase();
  const hasBody = body.length > 0 && method !== 'GET' && method !== 'HEAD';

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? body : undefined,
      redirect: 'follow',
      signal: controller.signal,
    });

    res.statusCode = upstream.status;
    if (upstream.statusText) {
      res.statusMessage = upstream.statusText;
    }
    // Tell FetchHttpClient the final URL after the server-side redirects.
    res.setHeader('x-nova-proxy-url', upstream.url);

    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (SKIP_RESPONSE_HEADERS.has(lower) || lower === 'content-length' || lower === 'content-encoding') return;
      if (lower === 'set-cookie') {
        const existing = res.getHeader('set-cookie');
        const arr = Array.isArray(existing) ? (existing as string[]) : existing ? [existing as string] : [];
        res.setHeader('set-cookie', [...arr, value]);
        return;
      }
      res.setHeader(key, value);
    });

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('content-length', String(buf.length));
    res.end(buf);
  } catch (err) {
    if (res.headersSent || res.writableEnded) return;
    const aborted = err instanceof Error && err.name === 'AbortError';
    res.statusCode = aborted ? 499 : 502;
    const msg = err instanceof Error ? err.message : String(err);
    res.end(`nova-dev-proxy: ${target} failed: ${msg}`);
  } finally {
    clearTimeout(timeout);
  }
}
