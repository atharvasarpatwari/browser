/**
 * IHttpClient transport for the plain-browser (Vite dev) context.
 *
 * The browser has no net/tls, so `FetchHttpClient` (globalThis.fetch) is the
 * only transport — and the host browser blocks cross-origin fetches with CORS,
 * which prevents the engine from loading external pages. `DevProxyHttpClient`
 * fixes that during development by rewriting http(s) requests through the
 * Vite dev-server proxy (`/__nova_proxy/`), a same-origin hop that forwards to
 * the real server. In production builds and Node/Electron the rewrite is
 * disabled and this behaves exactly like a plain `FetchHttpClient`.
 */

import { FetchHttpClient } from './request-manager';
import type { HttpRequestSpec, HttpResponseSpec, IHttpClient } from './request-manager';

const DEV: boolean =
  ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) === true;

/** True when running inside a browser with a usable window.location. */
export function isBrowserContext(): boolean {
  return (
    typeof window !== 'undefined'
    && typeof window.location !== 'undefined'
    && typeof window.location.origin === 'string'
  );
}

/**
 * Wraps an `IHttpClient` and routes http(s) requests through the dev-server
 * proxy while in a Vite dev build running in a browser. Everything else
 * (non-http schemes, Node, production builds) is delegated unchanged.
 */
export class DevProxyHttpClient implements IHttpClient {
  private readonly inner: IHttpClient;

  constructor(inner?: IHttpClient) {
    this.inner = inner ?? new FetchHttpClient();
  }

  async send(request: HttpRequestSpec, signal: AbortSignal): Promise<HttpResponseSpec> {
    if (DEV && isBrowserContext() && /^https?:\/\//i.test(request.url)) {
      const origin = window.location.origin;
      if (origin && origin !== 'null') {
        const proxied: HttpRequestSpec = {
          ...request,
          url: `${origin}/__nova_proxy/?url=${encodeURIComponent(request.url)}`,
        };
        console.log('[DevProxyHttpClient] proxying', request.url, '->', proxied.url);
        const resp = await this.inner.send(proxied, signal);
        console.log('[DevProxyHttpClient] response', proxied.url, 'status', resp.statusCode, 'url', resp.url);
        return resp;
      }
    }
    return this.inner.send(request, signal);
  }
}
