import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as http from 'node:http';
import * as zlib from 'node:zlib';
import { ContentDecoder, ContentCoding, ContentEncodingError, ACCEPT_ENCODING } from '../src/browser/networking/content-encoding';
import { HttpAuthenticator, AuthScheme, AuthError } from '../src/browser/networking/http-auth';
import { MultipartBuilder, MultipartError } from '../src/browser/networking/multipart';
import { QuicConnection, QuicConnectionState, QuicError, DEFAULT_QUIC_CONFIG } from '../src/browser/networking/quic-transport';
import { RawSocketHttpClient } from '../src/browser/networking/raw-socket-http-client';
import { HttpMethod } from '../src/browser/networking/request-manager';

// ─────────────────────────────────────────────────────────────────────────────
// Content-Encoding Decompression
// ─────────────────────────────────────────────────────────────────────────────

describe('ContentDecoder', () => {
  const decoder = new ContentDecoder();

  it('should decompress gzip data', async () => {
    const original = 'Hello Nova Browser! This is gzip compressed.';
    const compressed = zlib.gzipSync(Buffer.from(original));
    const decoded = await decoder.decode(ContentCoding.Gzip, compressed);
    expect(decoded.toString('utf-8')).toBe(original);
  });

  it('should decompress deflate data', async () => {
    const original = 'Deflate compression test payload';
    const compressed = zlib.deflateSync(Buffer.from(original));
    const decoded = await decoder.decode(ContentCoding.Deflate, compressed);
    expect(decoded.toString('utf-8')).toBe(original);
  });

  it('should decompress deflate raw data', async () => {
    const original = 'Raw deflate test';
    const compressed = zlib.deflateRawSync(Buffer.from(original));
    const decoded = await decoder.decode(ContentCoding.Deflate, compressed);
    expect(decoded.toString('utf-8')).toBe(original);
  });

  it('should return identity data unchanged', async () => {
    const data = Buffer.from('plain text data');
    const decoded = await decoder.decode(ContentCoding.Identity, data);
    expect(decoded.toString('utf-8')).toBe('plain text data');
  });

  it('should decompress gzipped response via decompressResponse', async () => {
    const original = 'Response body for decompression test';
    const compressed = zlib.gzipSync(Buffer.from(original));
    const compressedStr = compressed.toString('binary');
    const headers = new Map<string, string>();
    headers.set('content-encoding', 'gzip');
    headers.set('content-type', 'text/plain');

    const result = await decoder.decompressResponse(headers, compressedStr, null);
    expect(result.body).toBe(original);
  });

  it('should pass through identity content-encoding', async () => {
    const headers = new Map<string, string>();
    headers.set('content-encoding', 'identity');
    const result = await decoder.decompressResponse(headers, 'plain text', null);
    expect(result.body).toBe('plain text');
  });

  it('should handle binary content with gzip', async () => {
    const original = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const compressed = zlib.gzipSync(original);
    const headers = new Map<string, string>();
    headers.set('content-encoding', 'gzip');
    headers.set('content-type', 'image/png');

    const result = await decoder.decompressResponse(headers, '', new Uint8Array(compressed));
    expect(result.bodyBinary).not.toBeNull();
    expect(Array.from(result.bodyBinary!)).toEqual(Array.from(original));
    expect(result.body).toBe('');
  });

  it('should decompress via decodeFromString with binary-safe encoding', async () => {
    const original = 'binary safe test';
    const compressed = zlib.gzipSync(Buffer.from(original));
    const binaryStr = compressed.toString('binary');
    const decoded = await decoder.decodeFromString('gzip', binaryStr);
    expect(decoded.toString('utf-8')).toBe(original);
  });

  it('should reject unsupported encoding with error', async () => {
    const data = Buffer.from('test');
    await expect(decoder.decode('compress' as ContentCoding, data))
      .rejects.toThrow(ContentEncodingError);
  });

  it('should accept-encoding include br, gzip, deflate', () => {
    expect(ACCEPT_ENCODING).toContain('gzip');
    expect(ACCEPT_ENCODING).toContain('deflate');
    expect(ACCEPT_ENCODING).toContain('br');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HTTP Authentication
// ─────────────────────────────────────────────────────────────────────────────

describe('HttpAuthenticator', () => {
  const auth = new HttpAuthenticator();

  describe('canHandle', () => {
    it('should handle Basic', () => {
      expect(auth.canHandle('Basic realm="test"')).toBe(true);
    });

    it('should handle Digest', () => {
      expect(auth.canHandle('Digest realm="test", nonce="abc123"')).toBe(true);
    });

    it('should handle Bearer', () => {
      expect(auth.canHandle('Bearer realm="test"')).toBe(true);
    });

    it('should handle NTLM', () => {
      expect(auth.canHandle('NTLM TlRMTVNTUAABAAAAB4IIAAAAAAAvACAAADAAAAAAAAAAAAAAAAAAAAAAAADwCQAAAAAAA=')).toBe(true);
    });

    it('should handle Negotiate', () => {
      expect(auth.canHandle('Negotiate YIIBZAYJKoZIhvcSAQICAQBugg')).toBe(true);
    });

    it('should reject unknown schemes', () => {
      expect(auth.canHandle('UnknownScheme token="abc"')).toBe(false);
    });
  });

  describe('parseChallenge', () => {
    it('should parse Basic challenge', () => {
      const c = auth.parseChallenge('Basic realm="Example"');
      expect(c).not.toBeNull();
      expect(c!.scheme).toBe(AuthScheme.Basic);
      expect(c!.realm).toBe('Example');
    });

    it('should parse Digest challenge', () => {
      const h = 'Digest realm="testrealm@host.com", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"';
      const c = auth.parseChallenge(h);
      expect(c).not.toBeNull();
      expect(c!.scheme).toBe(AuthScheme.Digest);
      expect(c!.params.get('realm')).toBe('testrealm@host.com');
      expect(c!.params.get('nonce')).toBe('dcd98b7102dd2f0e8b11d0f600bfb0c093');
      expect(c!.params.get('opaque')).toBe('5ccc069c403ebaf9f0171e9517f40e41');
    });

    it('should parse Bearer challenge', () => {
      const c = auth.parseChallenge('Bearer realm="api@example.com"');
      expect(c).not.toBeNull();
      expect(c!.scheme).toBe(AuthScheme.Bearer);
      expect(c!.realm).toBe('api@example.com');
    });
  });

  describe('generate Basic response', () => {
    it('should produce valid Basic auth header', () => {
      const challenge = auth.parseChallenge('Basic realm="test"')!;
      const response = auth.generateResponse(challenge, { username: 'admin', password: 'secret' }, 'GET', '/');
      expect(response).toMatch(/^Basic /);
      const decoded = Buffer.from(response.slice(6), 'base64').toString('utf-8');
      expect(decoded).toBe('admin:secret');
    });
  });

  describe('generate Digest response', () => {
    it('should produce valid Digest auth header', () => {
      const h = 'Digest realm="testrealm@host.com", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41", qop=auth, algorithm=MD5';
      const challenge = auth.parseChallenge(h)!;
      const response = auth.generateResponse(challenge, { username: 'Mufasa', password: 'Circle Of Life' }, 'GET', '/dir/index.html');
      expect(response).toMatch(/^Digest /);
      expect(response).toContain('username="Mufasa"');
      expect(response).toContain('realm="testrealm@host.com"');
      expect(response).toContain('nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093"');
      expect(response).toContain('uri="/dir/index.html"');
      expect(response).toContain('response="');
      expect(response).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');
      expect(response).toContain('qop=auth');
      expect(response).toContain('nc=');
      expect(response).toContain('cnonce="');
    });

    it('should produce different nc values on successive calls', () => {
      const h = 'Digest realm="test", nonce="abc123"';
      const challenge = auth.parseChallenge(h)!;
      const creds = { username: 'user', password: 'pass' };
      const r1 = auth.generateResponse(challenge, creds, 'GET', '/');
      const r2 = auth.generateResponse(challenge, creds, 'GET', '/');
      const nc1 = r1.match(/nc=([0-9a-f]+)/)?.[1];
      const nc2 = r2.match(/nc=([0-9a-f]+)/)?.[1];
      expect(nc1).toBe('00000001');
      expect(nc2).toBe('00000002');
    });
  });

  describe('generate Bearer response', () => {
    it('should produce Bearer token header', () => {
      const challenge = auth.parseChallenge('Bearer realm="api"')!;
      const response = auth.generateResponse(challenge, { username: '', password: '' }, 'GET', '/');
      expect(response).toBe('Bearer api');
    });
  });

  describe('generate NTLM response', () => {
    it('should produce NTLM type 3 message', () => {
      const challenge = auth.parseChallenge('NTLM TlRMTVNTUAABAAAAB4IIAAAAAAAvACAAADAAAAAAAAAAAAAAAAAAAAAAAADwCQAAAAAAA=')!;
      const response = auth.generateResponse(challenge, { username: 'user', password: 'pass' }, 'GET', '/');
      expect(response).toMatch(/^NTLM /);
      const decoded = Buffer.from(response.slice(5), 'base64');
      expect(decoded.toString('ascii', 0, 7)).toBe('NTLMSSP');
      expect(decoded.readUInt32LE(8)).toBe(3);
    });
  });

  describe('clearCache', () => {
    it('should reset nonce counters', () => {
      const h = 'Digest realm="test", nonce="abc"';
      const challenge = auth.parseChallenge(h)!;
      const creds = { username: 'u', password: 'p' };
      auth.generateResponse(challenge, creds, 'GET', '/');
      auth.generateResponse(challenge, creds, 'GET', '/');
      auth.clearCache();
      const r3 = auth.generateResponse(challenge, creds, 'GET', '/');
      expect(r3).toContain('nc=00000001');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multipart Uploads
// ─────────────────────────────────────────────────────────────────────────────

describe('MultipartBuilder', () => {
  const builder = new MultipartBuilder();

  it('should build multipart body with fields only', () => {
    const result = builder.build([
      { name: 'username', value: 'john' },
      { name: 'role', value: 'admin' },
    ]);

    expect(result.contentType).toContain('multipart/form-data');
    expect(result.contentType).toContain('boundary=');
    expect(result.body.length).toBeGreaterThan(0);

    const bodyStr = result.body.toString('utf-8');
    expect(bodyStr).toContain('name="username"');
    expect(bodyStr).toContain('john');
    expect(bodyStr).toContain('name="role"');
    expect(bodyStr).toContain('admin');
    expect(bodyStr).toContain(result.boundary);
  });

  it('should build multipart body with files', () => {
    const result = builder.build([], [
      {
        name: 'file',
        filename: 'test.txt',
        contentType: 'text/plain',
        data: Buffer.from('file contents'),
      },
    ]);

    const bodyStr = result.body.toString('utf-8');
    expect(bodyStr).toContain('name="file"');
    expect(bodyStr).toContain('filename="test.txt"');
    expect(bodyStr).toContain('Content-Type: text/plain');
    expect(bodyStr).toContain('file contents');
  });

  it('should build mixed fields and files', () => {
    const result = builder.build(
      [{ name: 'description', value: 'A test upload' }],
      [{ name: 'avatar', filename: 'photo.png', contentType: 'image/png', data: Buffer.from([0x89, 0x50, 0x4E, 0x47]) }],
    );

    const bodyStr = result.body.toString('utf-8');
    expect(bodyStr).toContain('name="description"');
    expect(bodyStr).toContain('name="avatar"');
    expect(bodyStr).toContain('filename="photo.png"');
  });

  it('should generate unique boundaries', () => {
    const r1 = builder.build([{ name: 'a', value: '1' }]);
    const r2 = builder.build([{ name: 'a', value: '1' }]);
    expect(r1.boundary).not.toBe(r2.boundary);
  });

  it('should parse multipart body', async () => {
    const built = builder.build(
      [{ name: 'user', value: 'alice' }],
      [{ name: 'doc', filename: 'notes.txt', contentType: 'text/plain', data: Buffer.from('hello') }],
    );

    const parsed = await builder.parse(built.contentType, built.body);
    expect(parsed.fields).toHaveLength(1);
    expect(parsed.fields[0]!.name).toBe('user');
    expect(parsed.fields[0]!.value).toBe('alice');
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0]!.name).toBe('doc');
    expect(parsed.files[0]!.filename).toBe('notes.txt');
    expect(parsed.files[0]!.contentType).toBe('text/plain');
    expect(parsed.files[0]!.data.toString()).toBe('hello');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QUIC Transport
// ─────────────────────────────────────────────────────────────────────────────

describe('QuicConnection', () => {
  it('should start in Listening state', () => {
    const conn = new QuicConnection();
    expect(conn.state).toBe(QuicConnectionState.Listening);
  });

  it('should encode varints correctly', () => {
    const conn = new QuicConnection();

    const encodeVarInt = (value: number, buf: Buffer, offset: number): number => {
      if (value < 64) { buf[offset] = value; return 1; }
      if (value < 16384) {
        buf[offset] = (value >> 8) | 0x40;
        buf[offset + 1] = value & 0xFF;
        return 2;
      }
      if (value < 1_073_741_824) {
        buf[offset] = ((value >> 24) & 0x3F) | 0x80;
        buf[offset + 1] = (value >> 16) & 0xFF;
        buf[offset + 2] = (value >> 8) & 0xFF;
        buf[offset + 3] = value & 0xFF;
        return 4;
      }
      const hi = Math.floor(value / 0x100000000);
      const lo = value >>> 0;
      buf[offset] = ((hi >> 24) & 0x3F) | 0xC0;
      buf[offset + 1] = (hi >> 16) & 0xFF;
      buf[offset + 2] = (hi >> 8) & 0xFF;
      buf[offset + 3] = hi & 0xFF;
      buf[offset + 4] = (lo >> 24) & 0xFF;
      buf[offset + 5] = (lo >> 16) & 0xFF;
      buf[offset + 6] = (lo >> 8) & 0xFF;
      buf[offset + 7] = lo & 0xFF;
      return 8;
    };

    const testBuf = Buffer.alloc(8);

    let n = encodeVarInt(0, testBuf, 0);
    expect(n).toBe(1);
    expect(testBuf[0]).toBe(0);

    n = encodeVarInt(63, testBuf, 0);
    expect(n).toBe(1);
    expect(testBuf[0]).toBe(63);

    n = encodeVarInt(64, testBuf, 0);
    expect(n).toBe(2);
    expect(testBuf[0]).toBe(0x40 | (64 >> 8));

    n = encodeVarInt(16383, testBuf, 0);
    expect(n).toBe(2);

    n = encodeVarInt(16384, testBuf, 0);
    expect(n).toBe(4);

    n = encodeVarInt(1_073_741_823, testBuf, 0);
    expect(n).toBe(4);

    n = encodeVarInt(1_073_741_824, testBuf, 0);
    expect(n).toBe(8);
  });

  it('should open streams with correct ID allocation', async () => {
    const conn = new QuicConnection();
    const s1 = await conn.openStream();
    expect(s1.id).toBe(0);
    const s2 = await conn.openStream();
    expect(s2.id).toBe(4);
    const s3 = await conn.openStream();
    expect(s3.id).toBe(8);
  });

  it('should have default config', () => {
    expect(DEFAULT_QUIC_CONFIG.maxStreamsBidi).toBe(100);
    expect(DEFAULT_QUIC_CONFIG.maxData).toBe(16_777_216);
    expect(DEFAULT_QUIC_CONFIG.idleTimeout).toBe(30_000);
  });

  it('should throw when reading unopened stream', async () => {
    const conn = new QuicConnection();
    await expect(conn.readStream(999)).rejects.toThrow();
  });

  it('should be disposable', () => {
    const conn = new QuicConnection();
    expect(() => conn.dispose()).not.toThrow();
    expect(conn.state).toBe(QuicConnectionState.Closed);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end: Content-Encoding + Auth + Upload over RawSocketHttpClient
// ─────────────────────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

describe('Networking end-to-end', () => {
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/gzip') {
        const body = '<html><body><h1>Gzipped response</h1></body></html>';
        const compressed = zlib.gzipSync(body);
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-encoding': 'gzip',
          'content-length': compressed.length.toString(),
        });
        res.end(compressed);
      } else if (url === '/deflate') {
        const body = 'Deflate compressed body';
        const compressed = zlib.deflateSync(body);
        res.writeHead(200, {
          'content-type': 'text/plain',
          'content-encoding': 'deflate',
          'content-length': compressed.length.toString(),
        });
        res.end(compressed);
      } else if (url === '/identity') {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('Plain text response');
      } else if (url === '/echo') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          res.writeHead(200, {
            'content-type': req.headers['content-type'] ?? 'text/plain',
          });
          res.end(body);
        });
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

  afterAll(() => {
    server.close();
  });

  it('should decompress gzipped response via raw socket', async () => {
    const client = new RawSocketHttpClient();
    const result = await client.send({
      url: `${baseUrl}/gzip`,
      method: HttpMethod.GET,
      timeoutMs: 5000,
      headers: new Map(),
    }, new AbortController().signal);
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('Gzipped response');
  });

  it('should decompress deflated response via raw socket', async () => {
    const client = new RawSocketHttpClient();
    const result = await client.send({
      url: `${baseUrl}/deflate`,
      method: HttpMethod.GET,
      timeoutMs: 5000,
      headers: new Map(),
    }, new AbortController().signal);
    expect(result.statusCode).toBe(200);
    expect(result.body).toContain('Deflate compressed');
  });

  it('should pass through identity responses', async () => {
    const client = new RawSocketHttpClient();
    const result = await client.send({
      url: `${baseUrl}/identity`,
      method: HttpMethod.GET,
      timeoutMs: 5000,
      headers: new Map(),
    }, new AbortController().signal);
    expect(result.statusCode).toBe(200);
    expect(result.body).toBe('Plain text response');
  });
});
