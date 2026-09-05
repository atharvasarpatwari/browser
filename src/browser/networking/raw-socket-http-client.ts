/**
 * @file src/browser/networking/raw-socket-http-client.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * An IHttpClient implementation that uses raw TCP/TLS sockets via the socket
 * proxy (sockets owned by the main process, driven through the proxy wire).
 * This bypasses `globalThis.fetch()` entirely, giving the browser engine full
 * control over the network stack.
 *
 * Features:
 *   • Real TCP connection via `socketProxy.openTcp()`
 *   • Real TLS upgrade via `handle.upgradeTls()`/`getPeerCertificate()`
 *     with the system trust store
 *   • HTTP/1.1 request/response framing over raw sockets
 *   • Chunked transfer encoding decode
 *   • Content-Length based body reading
 *   • Timeout management
 *   • AbortSignal support
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IHttpClient, HttpRequestSpec, HttpResponseSpec } from './request-manager';
import type { ITlsHandler } from './tls-handler';
import { TlsCertificateError } from './tls-handler';
import { ContentDecoder } from './content-encoding';
import type { ContentCoding } from './content-encoding';
import { connectThroughSocks, parseSocksProxyUrl } from './socks-connection';
import { connectThroughHttpProxy, parseHttpProxyUrl } from './http-proxy-connect';
import { getSocketProxy } from './socket-proxy';
import { onceSocketEvent, type ISocketHandle } from './socket-handle';
import { concatBytes, decodeUtf8, encodeUtf8, indexOfBytes } from './byte-codecs';

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

const CRLF = encodeUtf8('\r\n');

function decodeChunkedBody(raw: Uint8Array): Uint8Array {
  const result: Uint8Array[] = [];
  let pos = 0;

  while (pos < raw.length) {
    const sizeLineEnd = indexOfBytes(raw, CRLF, pos);
    if (sizeLineEnd === -1) break;

    const sizeStr = decodeUtf8(raw.subarray(pos, sizeLineEnd)).trim();
    const chunkSize = parseInt(sizeStr, 16);

    if (isNaN(chunkSize) || chunkSize < 0) break;
    if (chunkSize === 0) break;

    const dataStart = sizeLineEnd + 2;
    const dataEnd = dataStart + chunkSize;

    if (dataEnd > raw.length) {
      result.push(raw.subarray(dataStart));
      break;
    }

    result.push(raw.subarray(dataStart, dataEnd));
    pos = dataEnd + 2;
  }

  return concatBytes(result);
}

// ─────────────────────────────────────────────────────────────────────────────
// RAW SOCKET HTTP CLIENT
// ─────────────────────────────────────────────────────────────────────────────

interface OpenRawSocketOptions {
  readonly hostname: string;
  readonly port: number;
  readonly useTls: boolean;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

interface WriteRequestOptions {
  readonly handle: ISocketHandle;
  readonly hostname: string;
  readonly port: number;
  readonly useTls: boolean;
  readonly tunneled: boolean;
  readonly requestBytes: Uint8Array;
}

class RawSocketHttpClient implements IHttpClient {
  private readonly defaultTimeoutMs: number;
  private readonly tlsHandler?: ITlsHandler;
  private readonly trustedCAs: Set<string>;
  private readonly contentDecoder: ContentDecoder;
  private readonly socksProxy?: string;
  private readonly httpProxy?: string;

  constructor(options?: { defaultTimeoutMs?: number; tlsHandler?: ITlsHandler; socksProxy?: string; httpProxy?: string }) {
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 30_000;
    this.tlsHandler = options?.tlsHandler;
    this.socksProxy = options?.socksProxy;
    this.httpProxy = options?.httpProxy;
    this.contentDecoder = new ContentDecoder();

    // Load system trust store once.
    const cas = new Set<string>();
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
    const requestBytes = encodeUtf8(headerLines.join('\r\n'));

    return new Promise<HttpResponseSpec>((resolve, reject) => {
      let settled = false;
      let handle: ISocketHandle | null = null;
      const chunks: Uint8Array[] = [];
      let unsubData: (() => void) | null = null;
      let unsubEnd: (() => void) | null = null;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        unsubData?.();
        unsubEnd?.();
        fn();
      };

      const timer = setTimeout(() => {
        finish(() => {
          if (handle) void handle.destroy();
          reject(new RawSocketTimeoutError(hostname, port, timeoutMs));
        });
      }, timeoutMs);

      const onAbort = () => {
        finish(() => {
          if (handle) void handle.destroy();
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      };
      signal.addEventListener('abort', onAbort);

      const onSocketFailure = (err: unknown) => {
        finish(() => {
          if (handle) void handle.destroy();
          reject(err instanceof Error
            ? new RawSocketConnectionError(hostname, port, err)
            : new RawSocketConnectionError(hostname, port));
        });
      };

      const run = async () => {
        const tunneled = this.socksProxy !== undefined || this.httpProxy !== undefined;
        handle = await this.openRawSocket({ hostname, port, useTls, timeoutMs, signal });
        unsubData = handle.onEvent('data', (chunk) => {
          if (chunk instanceof Uint8Array) chunks.push(chunk);
        });
        unsubEnd = handle.onEvent('end', () => {
          finish(async () => {
            try {
              const rawResponse = concatBytes(chunks);
              const result = await this.parseHttpResponse(rawResponse, request.url);
              if (handle) void handle.destroy();
              resolve(result);
            } catch (err) {
              reject(err instanceof Error ? err : new RawSocketError(String(err)));
            }
          });
        });
        handle.onEvent('error', onSocketFailure);
        handle.onEvent('close', onSocketFailure);

        await this.writeRequest({
          handle,
          hostname,
          port,
          useTls,
          tunneled,
          requestBytes,
        });
      };

      run().catch((err) => {
        finish(() => {
          if (handle) void handle.destroy();
          reject(err instanceof Error ? err : new RawSocketConnectionError(hostname, port));
        });
      });
    });
  }

  /** Open a socket through the proxy (direct, HTTP CONNECT, or SOCKS). */
  private async openRawSocket(options: OpenRawSocketOptions): Promise<ISocketHandle> {
    const { hostname, port, useTls, timeoutMs, signal } = options;
    if (this.socksProxy) {
      const proxyInfo = parseSocksProxyUrl(this.socksProxy);
      if (!proxyInfo) {
        throw new RawSocketError(`Invalid SOCKS proxy URL: ${this.socksProxy}`);
      }
      return connectThroughSocks({
        proxy: proxyInfo,
        targetHost: hostname,
        targetPort: port,
        timeoutMs,
        signal,
      });
    }
    if (this.httpProxy) {
      const proxyInfo = parseHttpProxyUrl(this.httpProxy);
      if (!proxyInfo) {
        throw new RawSocketError(`Invalid HTTP proxy URL: ${this.httpProxy}`);
      }
      return connectThroughHttpProxy({
        proxy: proxyInfo,
        targetHost: hostname,
        targetPort: port,
        timeoutMs,
        signal,
      });
    }
    return getSocketProxy().openTcp({ host: hostname, port, tls: useTls });
  }

  /**
   * Drive the write phase: wait for the TLS extra-gate where needed, validate
   * the peer certificate, and write the request once the stream is usable.
   */
  private async writeRequest(options: WriteRequestOptions): Promise<void> {
    const { handle, hostname, port, useTls, tunneled, requestBytes } = options;

    if (!useTls) {
      if (!tunneled) {
        // A tunneled handle is already connected after its handshake.
        await onceSocketEvent(handle, 'connect');
      }
      await handle.write(requestBytes);
      return;
    }

    if (tunneled) {
      await handle.upgradeTls(hostname);
    }
    await onceSocketEvent(handle, 'secureConnect');

    const peerCert = await handle.getPeerCertificate();
    if (!peerCert || !(peerCert as { subject?: unknown }).subject) {
      void handle.destroy();
      throw new RawSocketConnectionError(hostname, port,
        new Error('Server did not present a certificate'));
    }

    // Validate certificate if tlsHandler is available.
    if (this.tlsHandler) {
      const result = await this.tlsHandler.negotiate(hostname, port);
      if (!result.verified) {
        void handle.destroy();
        const detail = `Certificate verification failed: ${result.verificationStatus}`;
        throw new TlsCertificateError(hostname, result.verificationStatus, detail);
      }
    }

    await handle.write(requestBytes);
  }

  private async parseHttpResponse(raw: Uint8Array, requestUrl: string): Promise<HttpResponseSpec> {
    const separator = encodeUtf8('\r\n\r\n');
    const headerEndIdx = indexOfBytes(raw, separator);
    if (headerEndIdx === -1) {
      throw new RawSocketError('Invalid HTTP response: no header/body separator found');
    }

    const headerSection = decodeUtf8(raw.subarray(0, headerEndIdx));
    let bodyRaw: Uint8Array = raw.subarray(headerEndIdx + 4);

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
          bodyBinary = decoded;
        } else {
          body = decodeUtf8(decoded);
        }
      } catch {
        if (isBinary) {
          bodyBinary = bodyRaw;
        } else {
          body = decodeUtf8(bodyRaw);
        }
      }
    } else {
      if (isBinary) {
        bodyBinary = bodyRaw;
      } else {
        body = decodeUtf8(bodyRaw);
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