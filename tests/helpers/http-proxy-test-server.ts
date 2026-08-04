/**
 * @file tests/helpers/http-proxy-test-server.ts
 *
 * In-process mock HTTP proxy for testing the HTTP CONNECT client.
 * Two post-CONNECT modes:
 *   • relay – pipes bytes to the real target (end-to-end proxying)
 *   • idle  – leaves the tunnel open without relaying (handshake-only tests)
 */

import * as net from 'node:net';
import type { Socket } from 'node:net';

export interface HttpProxyEvent {
  type: 'connect' | 'absolute';
  targetHost: string;
  targetPort: number;
  raw: string;
}

export interface MockHttpProxyOptions {
  /** Reply status line to send for CONNECT (default 200). */
  replyStatus?: number;
  /** Raw bytes to reply instead of the standard "200 Connection established". */
  rawReply?: string;
  /** Accept the CONNECT but never reply (timeout tests). */
  neverRespond?: boolean;
  /** After a successful CONNECT, pipe to the real target host:port. */
  relay?: boolean;
}

export interface MockHttpProxyServer {
  readonly port: number;
  readonly events: HttpProxyEvent[];
  close(): Promise<void>;
}

class HeadReader {
  private buffer = Buffer.alloc(0);
  private waiters: Array<{ resolve: (b: Buffer) => void }> = [];

  constructor(private readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flush();
    });
  }

  readHead(): Promise<Buffer> {
    return new Promise((resolve) => {
      this.waiters.push({ resolve });
      this.flush();
    });
  }

  private flush(): void {
    const delimiter = Buffer.from('\r\n\r\n');
    const idx = this.buffer.indexOf(delimiter);
    if (idx === -1 || this.waiters.length === 0) return;
    const w = this.waiters.shift()!;
    const out = this.buffer.subarray(0, idx + delimiter.length);
    this.buffer = this.buffer.subarray(idx + delimiter.length);
    w.resolve(out);
  }
}

function relayToTarget(socket: Socket, host: string, port: number): void {
  const upstream = net.connect({ host, port });
  upstream.on('error', () => socket.destroy());
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
  socket.pipe(upstream);
  upstream.pipe(socket);
}

async function handleConnection(
  socket: Socket,
  options: {
    replyStatus: number;
    rawReply: string | undefined;
    neverRespond: boolean;
    relay: boolean;
  },
  events: HttpProxyEvent[],
  sockets: Set<Socket>,
): Promise<void> {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));

  const reader = new HeadReader(socket);
  const head = await reader.readHead();
  const headText = head.toString('utf-8');
  const requestLine = headText.split('\r\n')[0] ?? '';
  const connectMatch = /^CONNECT\s+([^:\s]+):(\d+)\s+HTTP\/\d(?:\.\d)?/.exec(requestLine);

  if (connectMatch) {
    const targetHost = connectMatch[1]!;
    const targetPort = parseInt(connectMatch[2]!, 10);
    events.push({ type: 'connect', targetHost, targetPort, raw: headText });

    if (options.neverRespond) return;

    if (options.rawReply !== undefined) {
      socket.write(options.rawReply);
      socket.destroy();
      return;
    }

    const status = options.replyStatus;
    const statusText = status === 200
      ? 'Connection established'
      : status === 407
        ? 'Proxy Authentication Required'
        : status === 403
          ? 'Forbidden'
          : 'Error';
    socket.write(`HTTP/1.1 ${status} ${statusText}\r\n\r\n`);

    if (status < 200 || status >= 300) {
      socket.destroy();
      return;
    }

    if (options.relay) {
      relayToTarget(socket, targetHost, targetPort);
    }
    return;
  }

  events.push({ type: 'absolute', targetHost: '', targetPort: 0, raw: headText });
  socket.write(
    'HTTP/1.1 200 OK\r\n' +
    'Content-Type: text/plain\r\n' +
    'Content-Length: 15\r\n' +
    'Connection: close\r\n\r\n' +
    'proxy-responded',
  );
  socket.destroy();
}

/** Start a mock HTTP proxy server on an ephemeral localhost port. */
export function startMockHttpProxy(options: MockHttpProxyOptions = {}): Promise<MockHttpProxyServer> {
  const fullOptions = {
    replyStatus: options.replyStatus ?? 200,
    rawReply: options.rawReply,
    neverRespond: options.neverRespond ?? false,
    relay: options.relay ?? false,
  };
  const events: HttpProxyEvent[] = [];
  const sockets = new Set<Socket>();

  const server = net.createServer((socket) => {
    handleConnection(socket, fullOptions, events, sockets).catch(() => socket.destroy());
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('Mock HTTP proxy failed to bind'));
        return;
      }
      resolve({
        port: addr.port,
        events,
        close: async () => {
          for (const s of sockets) s.destroy();
          sockets.clear();
          await new Promise<void>((res) => server.close(() => res()));
        },
      });
    });
  });
}
