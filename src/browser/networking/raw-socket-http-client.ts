/**
 * @file src/browser/networking/raw-socket-http-client.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * An IHttpClient implementation that uses raw TCP/TLS sockets via Node.js
 * `net` and `tls` modules. This bypasses `globalThis.fetch()` entirely,
 * giving the browser engine full control over the network stack.
 *
 * Features:
 *   • Real TCP connection via `net.connect()`
 *   • Real TLS upgrade via `tls.connect()` with system trust store
 *   • HTTP/1.1 request/response framing over raw sockets
 *   • Chunked transfer encoding decode
 *   • Content-Length based body reading
 *   • Timeout management
 *   • AbortSignal support
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IHttpClient, HttpRequestSpec, HttpResponseSpec } from './request-manager';
import type { ITlsHandler } from './tls-handler';
import { CertVerificationStatus, TlsCertificateError } from './tls-handler';
import { ContentDecoder } from './content-encoding';
import type { ContentCoding } from './content-encoding';

export class RawSocketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RawSocketError';
  }
}

export class RawSocketConnectionError extends RawSocketError {
  constructor(host: string, port: number, cause?: Error) {
    super(`Failed to connect to ${host}:${port}${cause ? `: ${cause.message}` : ''}`);
    this.name = 'RawSocketConnectionError';
  }
}

export class RawSocketTimeoutError extends RawSocketError {
  constructor(host: string, port: number, timeoutMs: number) {
    super(`Connection to ${host}:${port} timed out after ${timeoutMs}ms`);
    this.name = 'RawSocketTimeoutError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHUNKED TRANSFER DECODER
// ─────────────────────────────────────────────────────────────────────────────

function decodeChunkedBody(raw: Buffer): Buffer {
  const result: Buffer[] = [];
  let pos = 0;

  while (pos < raw.length) {
    const sizeLineEnd = raw.indexOf('\r\n', pos);
    if (sizeLineEnd === -1) break;

    const sizeStr = raw.subarray(pos, sizeLineEnd).toString('utf-8').trim();
    const chunkSize = parseInt(sizeStr, 16);

    if (isNaN(chunkSize) || chunkSize < 0) break;
    if (chunkSize === 0) break;

    const dataStart = sizeLineEnd + 2;
    const dataEnd = dataStart + chunkSize;

    if (dataEnd > raw.length) {
      result.push(Buffer.from(raw.subarray(dataStart)));
      break;
    }

    result.push(Buffer.from(raw.subarray(dataStart, dataEnd)));
    pos = dataEnd + 2;
  }

  return Buffer.concat(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// RAW SOCKET HTTP CLIENT
// ─────────────────────────────────────────────────────────────────────────────

class RawSocketHttpClient implements IHttpClient {
  private readonly defaultTimeoutMs: number;
  private readonly tlsHandler?: ITlsHandler;
  private readonly trustedCAs: Set<string>;
  private readonly contentDecoder: ContentDecoder;

  constructor(options?: { defaultTimeoutMs?: number; tlsHandler?: ITlsHandler }) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 30_000;
    this.tlsHandler = options?.tlsHandler;
    this.contentDecoder = new ContentDecoder();

    // Load system trust store once.
    let cas = new Set<string>();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { rootCertificates } = require('node:tls') as typeof import('node:tls');
      for (const pem of rootCertificates) {
        cas.add(pem.trim());
      }
    } catch { /* empty */ }
    this.trustedCAs = cas;
  }

  async send(request: HttpRequestSpec, signal: AbortSignal): Promise<HttpResponseSpec> {
    const url = new URL(request.url);
    const hostname = url.hostname;
    const port = parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80);
    const useTls = url.protocol === 'https:';
    const timeoutMs = request.timeoutMs || this.defaultTimeoutMs;

    if (signal.aborted) {
      throw new DOMException('The operation was aborted.', 'AbortError');
    }

    // Build raw HTTP/1.1 request
    const path = url.pathname + url.search;
    const hostHeader = url.port ? `${hostname}:${url.port}` : hostname;

    const headerLines: string[] = [
      `${request.method} ${path} HTTP/1.1`,
      `Host: ${hostHeader}`,
      'Connection: close',
    ];

    if (request.headers) {
      for (const [key, value] of request.headers) {
        headerLines.push(`${key}: ${value}`);
      }
    }

    if (request.body !== undefined) {
      const bodyBytes = new TextEncoder().encode(request.body);
      headerLines.push(`Content-Length: ${bodyBytes.byteLength.toString()}`);
    }

    headerLines.push('', '');
    const rawRequest = headerLines.join('\r\n');
    const requestBytes = Buffer.from(rawRequest, 'utf-8');

    // Dynamic import of Node.js modules
    const net = await import('node:net');
    const tls = await import('node:tls');

    return new Promise<HttpResponseSpec>((resolve, reject) => {
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          socket.destroy();
          reject(new RawSocketTimeoutError(hostname, port, timeoutMs));
        });
      }, timeoutMs);

      const onAbort = () => {
        finish(() => {
          socket.destroy();
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      };
      signal.addEventListener('abort', onAbort);

      const onSocketError = (err: Error) => {
        finish(() => reject(new RawSocketConnectionError(hostname, port, err)));
      };

      let socket: any;

      if (useTls) {
        // Use rejectUnauthorized: false so we can inspect the peer cert before deciding.
        socket = tls.connect({ host: hostname, port, servername: hostname, rejectUnauthorized: false });
      } else {
        socket = net.connect({ host: hostname, port });
      }

      socket.on('error', onSocketError);

      if (useTls) {
        // Wait for the TLS handshake to complete, then validate the certificate.
        socket.on('secureConnect', () => {
          const peerCert = socket.getPeerCertificate(true);
          if (!peerCert || !peerCert.subject) {
            socket.destroy();
            finish(() => reject(new RawSocketConnectionError(hostname, port,
              new Error('Server did not present a certificate'))));
            return;
          }

          // Validate certificate if tlsHandler is available.
          if (this.tlsHandler) {
            this.tlsHandler.negotiate(hostname, port).then(result => {
              if (!result.verified) {
                socket.destroy();
                const detail = `Certificate verification failed: ${result.verificationStatus}`;
                finish(() => reject(new TlsCertificateError(hostname, result.verificationStatus, detail)));
                return;
              }
              // Certificate valid — send the HTTP request.
              socket.write(requestBytes);
            }).catch(err => {
              socket.destroy();
              finish(() => reject(err instanceof Error ? err : new RawSocketConnectionError(hostname, port, err)));
            });
          } else {
            // No tlsHandler — trust the connection (legacy behavior).
            socket.write(requestBytes);
          }
        });
      } else {
        // Plain TCP — send immediately on connect.
        socket.on('connect', () => {
          socket.write(requestBytes);
        });
      }

      const chunks: Buffer[] = [];

      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      socket.on('end', () => {
        finish(async () => {
          try {
            const rawResponse = Buffer.concat(chunks);
            const result = await this.parseHttpResponse(rawResponse, request.url);
            resolve(result);
          } catch (err) {
            reject(err instanceof Error ? err : new RawSocketError(String(err)));
          }
        });
      });
    });
  }

  private async parseHttpResponse(raw: Buffer, requestUrl: string): Promise<HttpResponseSpec> {
    const separator = Buffer.from('\r\n\r\n');
    const headerEndIdx = raw.indexOf(separator);
    if (headerEndIdx === -1) {
      throw new RawSocketError('Invalid HTTP response: no header/body separator found');
    }

    const headerSection = raw.subarray(0, headerEndIdx).toString('utf-8');
    let bodyRaw: Buffer = Buffer.from(raw.subarray(headerEndIdx + 4));

    const headerLines = headerSection.split('\r\n');

    // Parse status line
    const statusLine = headerLines[0] ?? '';
    const statusMatch = /^HTTP\/\d\.?\d?\s+(\d{3})/.exec(statusLine);
    const statusCode = statusMatch ? parseInt(statusMatch[1]!, 10) : 0;

    // Parse headers
    const headers = new Map<string, string>();
    for (let i = 1; i < headerLines.length; i++) {
      const line = headerLines[i]!;
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.substring(0, colonIdx).trim().toLowerCase();
        const value = line.substring(colonIdx + 1).trim();
        headers.set(key, value);
      }
    }

    // Decode chunked transfer encoding if present
    const transferEncoding = headers.get('transfer-encoding') ?? '';
    if (transferEncoding.includes('chunked')) {
      bodyRaw = decodeChunkedBody(bodyRaw);
    }

    // Detect binary content
    const contentType = headers.get('content-type') ?? '';
    const isBinary = contentType.startsWith('image/')
      || contentType.startsWith('font/')
      || contentType.startsWith('audio/')
      || contentType.startsWith('video/');

    let body = '';
    let bodyBinary: Uint8Array | null = null;

    // Decompress if Content-Encoding is present
    const contentEncoding = headers.get('content-encoding');
    if (contentEncoding && contentEncoding.trim().toLowerCase() !== 'identity') {
      try {
        const decoded = await this.contentDecoder.decode(contentEncoding as ContentCoding, bodyRaw);
        if (isBinary) {
          bodyBinary = new Uint8Array(decoded);
        } else {
          body = decoded.toString('utf-8');
        }
      } catch {
        if (isBinary) {
          bodyBinary = new Uint8Array(bodyRaw);
        } else {
          body = bodyRaw.toString('utf-8');
        }
      }
    } else {
      if (isBinary) {
        bodyBinary = new Uint8Array(bodyRaw);
      } else {
        body = bodyRaw.toString('utf-8');
      }
    }

    return {
      url: requestUrl,
      statusCode,
      statusText: RawSocketHttpClient.statusText(statusCode),
      headers,
      body,
      bodyBinary,
      redirected: false,
      redirectChain: [],
    };
  }

  private static statusText(code: number): string {
    const texts: Record<number, string> = {
      200: 'OK', 201: 'Created', 204: 'No Content',
      301: 'Moved Permanently', 302: 'Found', 304: 'Not Modified',
      400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
      404: 'Not Found', 500: 'Internal Server Error',
    };
    return texts[code] ?? 'Unknown';
  }
}

export { RawSocketHttpClient };
