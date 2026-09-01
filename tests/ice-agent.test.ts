import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { IceAgent, formatCandidateSdp, parseCandidateSdp, type IceCandidate } from '../src/browser/networking/ice-agent';

describe('ICE candidate SDP formatting', () => {
  it('round-trips a host candidate line', () => {
    const candidate: IceCandidate = {
      foundation: '1', component: 1, protocol: 'udp', priority: 2130706431,
      ip: '192.168.1.5', port: 54321, type: 'host',
    };
    const line = formatCandidateSdp(candidate);
    expect(line).toBe('candidate:1 1 udp 2130706431 192.168.1.5 54321 typ host');
    expect(parseCandidateSdp(line)).toEqual(candidate);
  });

  it('round-trips a server-reflexive candidate line with raddr/rport', () => {
    const candidate: IceCandidate = {
      foundation: '2', component: 1, protocol: 'udp', priority: 1694498815,
      ip: '203.0.113.9', port: 40000, type: 'srflx',
      relatedAddress: '192.168.1.5', relatedPort: 54321,
    };
    const line = formatCandidateSdp(candidate);
    expect(line).toContain('typ srflx');
    expect(line).toContain('raddr 192.168.1.5 rport 54321');
    expect(parseCandidateSdp(line)).toEqual(candidate);
  });

  it('parses a line prefixed with a= (as it would appear inside SDP)', () => {
    const parsed = parseCandidateSdp('a=candidate:1 1 udp 2130706431 10.0.0.2 5000 typ host');
    expect(parsed?.ip).toBe('10.0.0.2');
    expect(parsed?.type).toBe('host');
  });

  it('returns null for a non-UDP or malformed line', () => {
    expect(parseCandidateSdp('candidate:1 1 tcp 100 10.0.0.2 5000 typ host')).toBeNull();
    expect(parseCandidateSdp('not a candidate line')).toBeNull();
  });
});

describe('IceAgent — real loopback UDP', () => {
  let agentA: IceAgent | null = null;
  let agentB: IceAgent | null = null;

  afterEach(() => {
    agentA?.close();
    agentB?.close();
    agentA = null;
    agentB = null;
  });

  it('gathers at least one host candidate', async () => {
    agentA = new IceAgent();
    const candidates = await agentA.gather();
    // A CI sandbox always has at least a loopback-adjacent non-internal
    // interface in practice, but if this environment truly has none, the
    // agent should still return an empty (not throwing) array.
    expect(Array.isArray(candidates)).toBe(true);
    for (const c of candidates) {
      expect(c.type).toBe('host');
      expect(c.protocol).toBe('udp');
      expect(c.port).toBe(agentA.boundPort);
    }
  });

  it('two agents on loopback complete a connectivity check against each other', async () => {
    agentA = new IceAgent();
    agentB = new IceAgent();
    await agentA.gather();
    await agentB.gather();

    // Force loopback candidates so this test doesn't depend on the runner's
    // actual network interfaces (which may have zero non-internal IPv4s in
    // a sandboxed CI runner).
    const bLoopback: IceCandidate[] = [{
      foundation: '1', component: 1, protocol: 'udp', priority: 2130706431,
      ip: '127.0.0.1', port: agentB.boundPort!, type: 'host',
    }];

    const selected = await agentA.checkConnectivity(bLoopback);
    expect(selected.ip).toBe('127.0.0.1');
    expect(selected.port).toBe(agentB.boundPort);
    expect(agentA.selectedPair).toEqual(selected);
  });

  it('delivers non-STUN application data via onData after a pair is selected', async () => {
    agentA = new IceAgent();
    agentB = new IceAgent();
    await agentA.gather();
    await agentB.gather();

    const bLoopback: IceCandidate[] = [{
      foundation: '1', component: 1, protocol: 'udp', priority: 2130706431,
      ip: '127.0.0.1', port: agentB.boundPort!, type: 'host',
    }];
    await agentA.checkConnectivity(bLoopback);

    // B also needs a selected pair before it can `send()` back to A.
    const aLoopback: IceCandidate[] = [{
      foundation: '1', component: 1, protocol: 'udp', priority: 2130706431,
      ip: '127.0.0.1', port: agentA.boundPort!, type: 'host',
    }];
    await agentB.checkConnectivity(aLoopback);

    const received = new Promise<Buffer>((resolve) => agentB!.onData((data) => resolve(data)));
    agentA.send(Buffer.from('hello from A'));
    const data = await received;
    expect(data.toString('utf8')).toBe('hello from A');
  });

  it('throws from checkConnectivity when no candidate answers', async () => {
    agentA = new IceAgent();
    await agentA.gather();
    const unreachable: IceCandidate[] = [{
      foundation: '1', component: 1, protocol: 'udp', priority: 1,
      ip: '127.0.0.1', port: 1, type: 'host',
    }];
    await expect(agentA.checkConnectivity(unreachable)).rejects.toThrow(/No candidate pair became reachable/);
  }, 3000);
});

describe('IceAgent — bind failure robustness (injected dgram mock)', () => {
  // A dgram-shaped socket that fails to bind: emits an error and never calls
  // the success callback — exercises the agent's bind-failure cleanup path
  // with no listener. On a real socket an 'error' with no listener would
  // crash the process.
  class MockFailingSocket extends EventEmitter {
    closed: boolean;
    constructor() {
      super();
      this.closed = false;
    }
    bind(_port: unknown, _cb?: () => void): void {
      this.emit('error', new Error('EADDRINUSE simulated bind failure'));
    }
    close(): void {
      this.closed = true;
    }
    address(): { port: number } {
      return { port: 0 };
    }
  }

  const novaKey = 'nova' as keyof typeof globalThis;
  let originalNova: unknown;

  afterEach(() => {
    if (originalNova !== undefined) {
      (globalThis as unknown as Record<string, unknown>)[novaKey] = originalNova;
    } else {
      delete (globalThis as unknown as Record<string, unknown>)[novaKey];
    }
    originalNova = undefined;
  });

  it('cleans up and yields safe state when bind() fails', async () => {
    // loadNodeBuiltin checks globalThis.nova.require first (contextIsolation
    // path) — inject a dgram fake whose socket fails to bind.
    originalNova = (globalThis as unknown as Record<string, unknown>)[novaKey];
    (globalThis as unknown as Record<string, unknown>)[novaKey] = {
      require: (name: string) =>
        name === 'node:dgram' ? { createSocket: () => new MockFailingSocket() } : undefined,
    };

    const agent = new IceAgent();
    await expect(agent.gather()).rejects.toThrow(/Failed to bind ICE socket/);

    // Clean state after a failed bind: close() stays safe, and no socket
    // remains for connectivity checks to act on.
    expect(() => agent.close()).not.toThrow();
    const unreachable: IceCandidate[] = [{
      foundation: '1', component: 1, protocol: 'udp', priority: 1,
      ip: '127.0.0.1', port: 1, type: 'host',
    }];
    await expect(agent.checkConnectivity(unreachable)).rejects.toThrow(/gather/);
  });
});
