/**
 * @file src/browser/crawler/crawler-fetcher.ts
 *
 * Dedicated HTTP fetcher for the crawler. Deliberately NOT the browsing-path
 * `RequestManager`/`FetchHttpClient` (tuned for single-page UX: cookies,
 * cache, auth) — a crawler needs plain, concurrent, politeness-gated GETs.
 *
 * Built on Node's `http`/`https` + `DnsResolver` (reused as-is from
 * src/browser/networking/dns-resolver.ts) so repeated requests to the same
 * domain don't re-resolve DNS every time.
 */

import * as http from 'node:http';
import * as https from 'node:https';
import * as zlib from 'node:zlib';
import * as net from 'node:net';
import { DnsResolver } from '../networking/dns-resolver';

export interface FetchResult {
  readonly status: number;
  readonly headers: http.IncomingHttpHeaders;
  readonly body: string;
  readonly finalUrl: string;
}

export interface FetchOptions {
  readonly userAgent: string;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
  readonly maxBodyBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

export class MaxBodySizeExceededError extends Error {
  constructor(url: string, maxBytes: number) {
    super(`Response body for "${url}" exceeded the ${maxBytes}-byte limit.`);
    this.name = 'MaxBodySizeExceededError';
  }
}

export class CrawlerFetcher {
  constructor(private readonly dns: DnsResolver = new DnsResolver()) {}

  async fetch(url: string, options: FetchOptions): Promise<FetchResult> {
    return this.fetchFollowingRedirects(url, options, options.maxRedirects ?? DEFAULT_MAX_REDIRECTS);
  }

  private async fetchFollowingRedirects(
    url: string,
    options: FetchOptions,
    redirectsLeft: number,
  ): Promise<FetchResult> {
    const res = await this.fetchOnce(url, options);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      if (redirectsLeft <= 0) return res; // give the caller the redirect response rather than throwing
      const nextUrl = new URL(location, url).toString();
      return this.fetchFollowingRedirects(nextUrl, options, redirectsLeft - 1);
    }
    return res;
  }

  private fetchOnce(url: string, options: FetchOptions): Promise<FetchResult> {
    return new Promise((resolve, reject) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch (err) {
        reject(err);
        return;
      }
      const transport = parsed.protocol === 'https:' ? https : http;
      const maxBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

      const req = transport.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: { 'User-Agent': options.userAgent, 'Accept-Encoding': 'gzip, deflate, br' },
          timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          lookup: net.isIP(parsed.hostname)
            ? undefined
            : ((hostname: string, _opts: unknown, callback: (err: Error | null, address: string, family: number) => void) => {
                this.dns
                  .resolve(hostname)
                  .then((result) => callback(null, result.addresses[0], net.isIPv6(result.addresses[0]) ? 6 : 4))
                  .catch((err) => callback(err instanceof Error ? err : new Error(String(err)), '', 4));
              }) as unknown as http.RequestOptions['lookup'],
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          let exceeded = false;

          res.on('data', (chunk: Buffer) => {
            if (exceeded) return;
            size += chunk.length;
            if (size > maxBytes) {
              exceeded = true;
              req.destroy();
              reject(new MaxBodySizeExceededError(url, maxBytes));
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () => {
            if (exceeded) return;
            try {
              const body = decodeBody(Buffer.concat(chunks), res.headers['content-encoding']);
              resolve({ status: res.statusCode ?? 0, headers: res.headers, body, finalUrl: url });
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
          res.on('error', (err) => { if (!exceeded) reject(err); });
        },
      );

      req.on('timeout', () => req.destroy(new Error(`Request to "${url}" timed out.`)));
      req.on('error', reject);
      req.end();
    });
  }
}

function decodeBody(buf: Buffer, encoding: string | string[] | undefined): string {
  const enc = Array.isArray(encoding) ? encoding[0] : encoding;
  try {
    if (enc === 'gzip' || enc === 'x-gzip') return zlib.gunzipSync(buf).toString('utf-8');
    if (enc === 'br') return zlib.brotliDecompressSync(buf).toString('utf-8');
    if (enc === 'deflate') return zlib.inflateSync(buf).toString('utf-8');
  } catch {
    // Fall through — treat as uncompressed if decoding fails.
  }
  return buf.toString('utf-8');
}
