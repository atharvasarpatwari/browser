import { describe, it, expect } from 'vitest';
import { RawSocketHttpClient } from '../src/browser/networking/raw-socket-http-client';
import { encodeUtf8 } from '../src/browser/networking/byte-codecs';
import type { HttpResponseSpec } from '../src/browser/networking/request-manager';

// parseHttpResponse is private — it's the pure header/body parser with no
// socket dependency, so it's the smallest unit worth exercising directly.
type ParsableClient = { parseHttpResponse(raw: Uint8Array, requestUrl: string): Promise<HttpResponseSpec> };

describe('RawSocketHttpClient — header parsing', () => {
  it('collects every Set-Cookie line into setCookieHeaders, not just the last', async () => {
    const client = new RawSocketHttpClient() as unknown as ParsableClient;
    const raw = encodeUtf8(
      'HTTP/1.1 200 OK\r\n' +
      'Content-Type: text/plain\r\n' +
      'Set-Cookie: a=1; Path=/\r\n' +
      'Set-Cookie: b=2; Path=/\r\n' +
      '\r\n' +
      'ok',
    );

    const res = await client.parseHttpResponse(raw, 'https://example.com/');

    expect(res.setCookieHeaders).toEqual(['a=1; Path=/', 'b=2; Path=/']);
    // The single-value headers Map can only keep the last one.
    expect(res.headers.get('set-cookie')).toBe('b=2; Path=/');
  });
});
