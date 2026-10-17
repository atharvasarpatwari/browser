/**
 * @file src/browser/networking/native-http-client.ts
 *
 * `IHttpClient` backed by the Rust native HTTP client (`native/nova-net` via
 * `src/native/index.ts`), used in place of `RawSocketHttpClient` when the
 * native module is available and no proxy is configured (native has no
 * proxy support — see `src/app/main.ts`'s `IResourceLoader` wiring).
 *
 * `RequestManager` owns redirect-following, retry, and protocol-safety
 * checks itself — every `IHttpClient` only ever answers one exchange and
 * leaves `redirected`/`redirectChain` for `RequestManager` to fill in
 * afterward (see `FetchHttpClient.send()` for the same convention). So this
 * class has nothing to do beyond: convert the request, call `httpFetch()`,
 * convert the response.
 */

import { httpFetch } from '../../native/index';
import type { HttpRequest as NativeHttpRequest } from '../../native/types';
import { ContentDecoder, ContentCoding } from './content-encoding';
import { decodeUtf8 } from './byte-codecs';
import type { IHttpClient, HttpRequestSpec, HttpResponseSpec } from './request-manager';

const CONTENT_CODING_BY_HEADER: Readonly<Record<string, ContentCoding>> = {
  gzip:     ContentCoding.Gzip,
  deflate:  ContentCoding.Deflate,
  br:       ContentCoding.Brotli,
  identity: ContentCoding.Identity,
};

class NativeHttpClient implements IHttpClient {
  private readonly contentDecoder: ContentDecoder;

  constructor() {
    this.contentDecoder = new ContentDecoder();
  }

  async send(request: HttpRequestSpec, signal: AbortSignal): Promise<HttpResponseSpec> {
    if (signal.aborted) {
      throw new DOMException('Request aborted', 'AbortError');
    }

    const headers: Record<string, string> = {};
    for (const [key, value] of request.headers) {
      headers[key] = value;
    }

    const nativeRequest: NativeHttpRequest = {
      url: request.url,
      method: request.method,
      headers,
      body: request.body,
      timeoutSecs: Math.max(1, Math.ceil(request.timeoutMs / 1000)),
    };

    // Native's fetch() has no cancellation hook — a mid-flight abort can't
    // interrupt it (same gap as the absence of a connect-timeout; both are
    // bounded by the read-timeout either way, not worth a timer-race here).
    const response = await httpFetch(nativeRequest);

    const responseHeaders = new Map<string, string>();
    for (const [key, value] of Object.entries(response.headers)) {
      responseHeaders.set(key.toLowerCase(), value);
    }

    let bytes = response.body ?? new Uint8Array(0);

    const contentEncoding = responseHeaders.get('content-encoding');
    if (contentEncoding) {
      const coding = CONTENT_CODING_BY_HEADER[contentEncoding.trim().toLowerCase()];
      if (coding && coding !== ContentCoding.Identity) {
        try {
          bytes = await this.contentDecoder.decode(coding, bytes);
        } catch {
          // If decompression fails, fall back to the raw bytes.
        }
      }
    }

    const contentType = responseHeaders.get('content-type') ?? '';
    const isBinary = contentType.startsWith('image/')
      || contentType.startsWith('font/')
      || contentType.startsWith('audio/')
      || contentType.startsWith('video/');

    return {
      url:           request.url,  // RequestManager tracks the final URL itself
      statusCode:    response.status,
      statusText:    response.statusText,
      headers:       responseHeaders,
      body:          isBinary ? '' : decodeUtf8(bytes),
      bodyBinary:    isBinary ? bytes : null,
      redirected:    false,        // RequestManager sets this after following redirects
      redirectChain: [],
    };
  }
}

export { NativeHttpClient };
