import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import { NativeHttpClient } from '../src/browser/networking/native-http-client';

// Exercises NativeHttpClient end-to-end against a real HTTP server. On this
// machine the native Rust module isn't compiled (see doc/ for why), so
// httpFetch() transparently falls back to Node's own http/https client —
// which still proves the whole TS integration chain (request conversion,
// binary content-type sniffing, response assembly) is correct end-to-end.
// Node's http module already dechunks Transfer-Encoding: chunked itself,
// so the chunked case here exercises the fallback path's framing, not the
// Rust decoder directly — that's covered by nova-net's own Rust unit tests
// (test_parse_http_response_chunked / _binary_body).

let server: http.Server;
let baseUrl: string;

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x01, 0x02, 0x03, 0xff, 0xfe, 0xfd, 0xfc, // arbitrary non-UTF8 bytes
]);

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? '/';

    if (url === '/plain') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('Hello from Nova!');
    } else if (url === '/chunked') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('Hello ');
      res.write('World!');
      res.end();
    } else if (url === '/binary') {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(Buffer.from(PNG_BYTES));
    } else {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not Found');
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        baseUrl = `http://127.0.0.1:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

function spec(path: string) {
  return {
    url: `${baseUrl}${path}`,
    method: 'GET' as const,
    headers: new Map<string, string>(),
    timeoutMs: 5000,
  };
}

describe('NativeHttpClient', () => {
  it('fetches a plain text body', async () => {
    const client = new NativeHttpClient();
    const res = await client.send(spec('/plain'), new AbortController().signal);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('Hello from Nova!');
    expect(res.bodyBinary).toBeNull();
  });

  it('reassembles a Transfer-Encoding: chunked body', async () => {
    const client = new NativeHttpClient();
    const res = await client.send(spec('/chunked'), new AbortController().signal);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('Hello World!');
  });

  it('returns a binary body as bodyBinary, not corrupted text', async () => {
    const client = new NativeHttpClient();
    const res = await client.send(spec('/binary'), new AbortController().signal);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
    expect(res.bodyBinary).not.toBeNull();
    expect(Array.from(res.bodyBinary ?? [])).toEqual(Array.from(PNG_BYTES));
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const client = new NativeHttpClient();
    const controller = new AbortController();
    controller.abort();

    await expect(client.send(spec('/plain'), controller.signal)).rejects.toThrow();
  });
});
