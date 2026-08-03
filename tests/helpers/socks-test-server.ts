/**
 * @file tests/helpers/socks-test-server.ts
 *
 * In-process mock SOCKS4 / SOCKS5 servers for testing the SOCKS client.
 * Two post-CONNECT modes:
 *   • echo  – echoes received bytes back (proves the tunnel is established)
 *   • relay – pipes bytes to the real target (end-to-end proxying)
 */

import * as net from 'node:net';
import type { Socket } from 'node:net';

export interface SocksServerEvent {
  type: 'greet' | 'auth' | 'connect';
  [key: string]: unknown;
}

export interface MockSocksServerOptions {
  protocol: 'socks4' | 'socks5';
  /** SOCKS5: methods the server selects from (default: reflect what the client offered). */
  methods?: number[];
  /** SOCKS5: RFC 1929 auth reply status (default 0 = success). */
  authStatus?: number;
  /** SOCKS5: CONNECT reply code (default 0 = success). */
  replyRep?: number;
  /** SOCKS4: CONNECT reply CD (default 0x5a = granted). */
  replyCd?: number;
  /** Accept the connection but never respond (for timeout/abort tests). */
  neverRespond?: boolean;
  /** After a successful CONNECT, pipe to the real target host:port. */
  relay?: boolean;
}

export interface MockSocksServer {
  readonly port: number;
  readonly events: SocksServerEvent[];
  close(): Promise<void>;
}

class FrameReader {
  private buffer = Buffer.alloc(0);
  private waiters: Array<{ min: number; resolve: (b: Buffer) => void }> = [];

  constructor(private readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flush();
    });
  }

  read(min: number): Promise<Buffer> {
    return new Promise((resolve) => {
      this.waiters.push({ min, resolve });
      this.flush();
    });
  }

  private flush(): void {
    while (this.waiters.length > 0 && this.buffer.length >= this.waiters[0]!.min) {
      const w = this.waiters.shift()!;
      const out = this.buffer.subarray(0, w.min);
      this.buffer = this.buffer.subarray(w.min);
      w.resolve(Buffer.from(out));
    }
  }
}

function record(events: SocksServerEvent[], event: SocksServerEvent): void {
  events.push(event);
}

async function handleSocks5(
  socket: Socket,
  options: Required<MockSocksServerOptions>,
  events: SocksServerEvent[],
): Promise<void> {
  const reader = new FrameReader(socket);

  // 1. Greeting
  const greetHead = await reader.read(2);
  const nmethods = greetHead[1]!;
  const greetMethods = [...(await reader.read(nmethods))];
  record(events, { type: 'greet', version: greetHead[0], methods: greetMethods });

  let selected: number;
  if (options.neverRespond) return;
  if (Array.isArray(options.methods) && options.methods.length > 0) {
    selected = options.methods[0]!;
  } else {
    selected = greetMethods.includes(0x00) ? 0x00 : greetMethods.includes(0x02) ? 0x02 : 0xff;
  }
  socket.write(Buffer.from([0x05, selected]));

  if (selected === 0xff) {
    socket.destroy();
    return;
  }

  // 2. Username/password auth
  if (selected === 0x02) {
    const authHead = await reader.read(2);
    const uname = (await reader.read(authHead[1]!)).toString('utf-8');
    const plen = (await reader.read(1))[0]!;
    const pass = (await reader.read(plen)).toString('utf-8');
    record(events, { type: 'auth', uname, pass });
    if (options.neverRespond) return;
    socket.write(Buffer.from([0x01, options.authStatus]));
    if (options.authStatus !== 0x00) {
      socket.destroy();
      return;
    }
  }

  // 3. CONNECT request
  const head = await reader.read(4);
  const atyp = head[3]!;
  let targetHost = '';
  if (atyp === 0x01) {
    targetHost = [...(await reader.read(4))].join('.');
  } else if (atyp === 0x04) {
    targetHost = 'ipv6';
    await reader.read(16);
  } else if (atyp === 0x03) {
    const len = (await reader.read(1))[0]!;
    targetHost = (await reader.read(len)).toString('utf-8');
  } else {
    socket.destroy();
    return;
  }
  const portBytes = await reader.read(2);
  const targetPort = portBytes.readUInt16BE(0);
  record(events, { type: 'connect', atyp, targetHost, targetPort });

  if (options.neverRespond) return;

  const replyRep = options.replyRep;
  socket.write(Buffer.from([0x05, replyRep, 0x00, 0x01, 127, 0, 0, 1, 0, 0]));
  if (replyRep !== 0x00) {
    socket.destroy();
    return;
  }

  if (options.relay) {
    const upstream = net.connect({ host: targetHost, port: targetPort });
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
    socket.pipe(upstream);
    upstream.pipe(socket);
  } else {
    socket.on('data', (chunk: Buffer) => socket.write(chunk));
  }
}

async function handleSocks4(
  socket: Socket,
  options: Required<MockSocksServerOptions>,
  events: SocksServerEvent[],
): Promise<void> {
  const reader = new FrameReader(socket);

  const head = await reader.read(8);
  const port = head.readUInt16BE(2);
  const ip = [...head.subarray(4, 8)];

  // user id, null-terminated
  const userIdChunks: Buffer[] = [];
  for (;;) {
    const b = (await reader.read(1))[0]!;
    if (b === 0x00) break;
    userIdChunks.push(Buffer.from([b]));
  }

  let targetHost: string;
  if (ip[0] === 0 && ip[1] === 0 && ip[2] === 0 && ip[3] !== 0) {
    // SOCKS4a: hostname follows the user id (0.0.0.x signals this)
    const hostChunks: Buffer[] = [];
    for (;;) {
      const b = (await reader.read(1))[0]!;
      if (b === 0x00) break;
      hostChunks.push(Buffer.from([b]));
    }
    targetHost = Buffer.concat(hostChunks).toString('utf-8');
  } else {
    targetHost = ip.join('.');
  }

  record(events, {
    type: 'connect',
    ip,
    hostname: targetHost,
    targetHost,
    targetPort: port,
    userId: Buffer.concat(userIdChunks).toString('utf-8'),
  });

  if (options.neverRespond) return;

  socket.write(Buffer.from([0x00, options.replyCd, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]));
  if (options.replyCd !== 0x5a) {
    socket.destroy();
    return;
  }

  if (options.relay) {
    const upstream = net.connect({ host: targetHost, port });
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
    socket.pipe(upstream);
    upstream.pipe(socket);
  } else {
    socket.on('data', (chunk: Buffer) => socket.write(chunk));
  }
}

/** Start a mock SOCKS server on an ephemeral localhost port. */
export function startMockSocksServer(options: MockSocksServerOptions): Promise<MockSocksServer> {
  const fullOptions: Required<MockSocksServerOptions> = {
    protocol: options.protocol,
    methods: options.methods ?? [],
    authStatus: options.authStatus ?? 0x00,
    replyRep: options.replyRep ?? 0x00,
    replyCd: options.replyCd ?? 0x5a,
    neverRespond: options.neverRespond ?? false,
    relay: options.relay ?? false,
  };
  const events: SocksServerEvent[] = [];

  const server = net.createServer((socket) => {
    const handler = fullOptions.protocol === 'socks5'
      ? handleSocks5(socket, fullOptions, events)
      : handleSocks4(socket, fullOptions, events);
    handler.catch(() => socket.destroy());
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        reject(new Error('Mock SOCKS server failed to bind'));
        return;
      }
      resolve({
        port: addr.port,
        events,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}
