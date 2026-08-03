import { describe, it, expect, afterEach } from 'vitest';
import type { Socket } from 'node:net';
import {
  SocksError,
  connectThroughSocks,
  parseSocksProxyUrl,
  type SocksProxyInfo,
} from '../src/browser/networking/socks-connection';
import { startMockSocksServer, type MockSocksServer } from './helpers/socks-test-server';

const servers: MockSocksServer[] = [];

async function startSocks(options: Parameters<typeof startMockSocksServer>[0]): Promise<MockSocksServer> {
  const server = await startMockSocksServer(options);
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => s.close()));
});

function echoOnce(socket: Socket, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.on('data', (chunk: Buffer) => resolve(chunk.toString('utf-8')));
    socket.on('error', reject);
    socket.write(Buffer.from(payload, 'utf-8'));
  });
}

describe('parseSocksProxyUrl', () => {
  it('parses a socks5 URL with credentials', () => {
    const info = parseSocksProxyUrl('socks5://user:pass@proxy.example.com:1080');
    expect(info).toEqual({
      protocol: 'socks5',
      hostname: 'proxy.example.com',
      port: 1080,
      username: 'user',
      password: 'pass',
    });
  });

  it('defaults the port to 1080', () => {
    const info = parseSocksProxyUrl('socks5://proxy.example.com');
    expect(info).toEqual({ protocol: 'socks5', hostname: 'proxy.example.com', port: 1080 });
  });

  it('handles socks4 and socks4a schemes', () => {
    expect(parseSocksProxyUrl('socks4://1.2.3.4:9999')?.protocol).toBe('socks4');
    expect(parseSocksProxyUrl('socks4a://proxy:1080')?.protocol).toBe('socks4a');
  });

  it('strips IPv6 brackets and decodes URL-encoded credentials', () => {
    const info = parseSocksProxyUrl('socks5://user%40x:p%40ss@[::1]:1080');
    expect(info).toEqual({
      protocol: 'socks5',
      hostname: '::1',
      port: 1080,
      username: 'user@x',
      password: 'p@ss',
    });
  });

  it('returns null for unsupported or malformed URLs', () => {
    expect(parseSocksProxyUrl('http://proxy:1080')).toBeNull();
    expect(parseSocksProxyUrl('socks5://host:0')).toBeNull();
    expect(parseSocksProxyUrl('not a url')).toBeNull();
  });
});

describe('connectThroughSocks — SOCKS5', () => {
  it('establishes a no-auth tunnel and forwards traffic', async () => {
    const mock = await startSocks({ protocol: 'socks5' });
    const socket = await connectThroughSocks({
      proxy: { protocol: 'socks5', hostname: '127.0.0.1', port: mock.port },
      targetHost: 'example.com',
      targetPort: 443,
      timeoutMs: 2000,
    });

    expect(await echoOnce(socket, 'PING')).toBe('PING');
    socket.destroy();

    const connect = mock.events.find((e) => e.type === 'connect');
    expect(connect).toMatchObject({ type: 'connect', atyp: 0x03, targetHost: 'example.com', targetPort: 443 });
  });

  it('sends an IPv4 address type for IPv4 literals', async () => {
    const mock = await startSocks({ protocol: 'socks5' });
    const socket = await connectThroughSocks({
      proxy: { protocol: 'socks5', hostname: '127.0.0.1', port: mock.port },
      targetHost: '127.0.0.1',
      targetPort: 80,
      timeoutMs: 2000,
    });
    socket.destroy();

    expect(mock.events.find((e) => e.type === 'connect')).toMatchObject({
      atyp: 0x01,
      targetHost: '127.0.0.1',
      targetPort: 80,
    });
  });

  it('authenticates with username/password (RFC 1929)', async () => {
    const mock = await startSocks({ protocol: 'socks5', methods: [0x02] });
    const socket = await connectThroughSocks({
      proxy: {
        protocol: 'socks5', hostname: '127.0.0.1', port: mock.port,
        username: 'alice', password: 's3cret',
      },
      targetHost: 'example.com',
      targetPort: 443,
      timeoutMs: 2000,
    });
    socket.destroy();

    const auth = mock.events.find((e) => e.type === 'auth');
    expect(auth).toMatchObject({ type: 'auth', uname: 'alice', pass: 's3cret' });
  });

  it('rejects when the proxy refuses the password', async () => {
    const mock = await startSocks({ protocol: 'socks5', methods: [0x02], authStatus: 0x01 });
    await expect(connectThroughSocks({
      proxy: {
        protocol: 'socks5', hostname: '127.0.0.1', port: mock.port,
        username: 'alice', password: 'wrong',
      },
      targetHost: 'example.com',
      targetPort: 443,
      timeoutMs: 2000,
    })).rejects.toMatchObject({ name: 'SocksError', code: 'AUTH_FAILED' });
  });

  it('rejects when the proxy refuses all auth methods', async () => {
    const mock = await startSocks({ protocol: 'socks5', methods: [0xff] });
    await expect(connectThroughSocks({
      proxy: { protocol: 'socks5', hostname: '127.0.0.1', port: mock.port },
      targetHost: 'example.com',
      targetPort: 443,
      timeoutMs: 2000,
    })).rejects.toMatchObject({ code: 'METHOD_REJECTED' });
  });

  it('maps CONNECT failure replies to a typed error', async () => {
    const mock = await startSocks({ protocol: 'socks5', replyRep: 0x05 });
    await expect(connectThroughSocks({
      proxy: { protocol: 'socks5', hostname: '127.0.0.1', port: mock.port },
      targetHost: 'example.com',
      targetPort: 443,
      timeoutMs: 2000,
    })).rejects.toMatchObject({ name: 'SocksError', code: 'CONNECT_FAILED' });
  });

  it('times out when the proxy never responds', async () => {
    const mock = await startSocks({ protocol: 'socks5', neverRespond: true });
    await expect(connectThroughSocks({
      proxy: { protocol: 'socks5', hostname: '127.0.0.1', port: mock.port },
      targetHost: 'example.com',
      targetPort: 443,
      timeoutMs: 300,
    })).rejects.toMatchObject({ code: 'TIMEOUT' });
  }, 5000);

  it('aborts the handshake when the signal fires', async () => {
    const mock = await startSocks({ protocol: 'socks5', neverRespond: true });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await expect(connectThroughSocks({
      proxy: { protocol: 'socks5', hostname: '127.0.0.1', port: mock.port },
      targetHost: 'example.com',
      targetPort: 443,
      timeoutMs: 5000,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: 'ABORTED' });
  }, 5000);
});

describe('connectThroughSocks — SOCKS4 / SOCKS4a', () => {
  it('sends an IPv4 connect request and tunnels', async () => {
    const mock = await startSocks({ protocol: 'socks4' });
    const socket = await connectThroughSocks({
      proxy: { protocol: 'socks4', hostname: '127.0.0.1', port: mock.port },
      targetHost: '127.0.0.1',
      targetPort: 8080,
      timeoutMs: 2000,
    });

    expect(await echoOnce(socket, 'PONG')).toBe('PONG');
    socket.destroy();

    expect(mock.events.find((e) => e.type === 'connect')).toMatchObject({
      ip: [127, 0, 0, 1],
      targetPort: 8080,
    });
  });

  it('sends a SOCKS4a request for domain targets', async () => {
    const mock = await startSocks({ protocol: 'socks4' });
    const socket = await connectThroughSocks({
      proxy: { protocol: 'socks4a', hostname: '127.0.0.1', port: mock.port },
      targetHost: 'example.com',
      targetPort: 443,
      timeoutMs: 2000,
    });
    socket.destroy();

    expect(mock.events.find((e) => e.type === 'connect')).toMatchObject({
      ip: [0, 0, 0, 1],
      hostname: 'example.com',
      targetPort: 443,
    });
  });

  it('rejects when the proxy refuses the request', async () => {
    const mock = await startSocks({ protocol: 'socks4', replyCd: 0x5b });
    await expect(connectThroughSocks({
      proxy: { protocol: 'socks4', hostname: '127.0.0.1', port: mock.port },
      targetHost: '127.0.0.1',
      targetPort: 80,
      timeoutMs: 2000,
    })).rejects.toMatchObject({ code: 'CONNECT_FAILED' });
  });
});

describe('connectThroughSocks — connection failures', () => {
  it('rejects with a connection error when the proxy is unreachable', async () => {
    const proxy: SocksProxyInfo = { protocol: 'socks5', hostname: '127.0.0.1', port: 1 };
    await expect(connectThroughSocks({
      proxy,
      targetHost: 'example.com',
      targetPort: 443,
      timeoutMs: 2000,
    })).rejects.toBeInstanceOf(SocksError);
  });
});
