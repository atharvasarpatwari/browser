import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMessageId,
  serializeError,
  deserializeError,
  createFireAndForget,
  createRequest,
  createResponse,
  createErrorResponse,
  createStreamRequest,
  createStreamChunk,
  isFireAndForget,
  isRequest,
  isResponse,
  isStreamRequest,
  isStreamChunk,
  IPCChannels,
} from '../src/common/ipc/message';
import { JSONSerializer } from '../src/common/ipc/serializer';
import {
  InProcessTransport,
  EventEmitterTransport,
  createInProcessPair,
} from '../src/common/ipc/transport';
import { Channel, ChannelManager } from '../src/common/ipc/channel';
import { ServiceProxy, ServiceStub, createTypedProxy } from '../src/common/ipc/service-proxy';
import { ProcessManager, ProcessState, createInProcessManager } from '../src/common/ipc/process-manager';

// ═════════════════════════════════════════════════════════════════════════════
// Message Protocol
// ═════════════════════════════════════════════════════════════════════════════

describe('IPC Message Protocol', () => {
  it('createMessageId generates unique IDs', () => {
    const id1 = createMessageId();
    const id2 = createMessageId();
    expect(id1).toBeTruthy();
    expect(id1).not.toBe(id2);
  });

  it('createFireAndForget produces correct shape', () => {
    const msg = createFireAndForget('test:channel', 'main-to-renderer', 'proc-1', { key: 'value' });
    expect(msg.kind).toBe('fire-and-forget');
    expect(msg.channel).toBe('test:channel');
    expect(msg.direction).toBe('main-to-renderer');
    expect(msg.sourceProcessId).toBe('proc-1');
    expect(msg.payload).toEqual({ key: 'value' });
    expect(msg.id).toBeTruthy();
    expect(msg.timestamp).toBeGreaterThan(0);
  });

  it('createRequest produces correct shape with timeout', () => {
    const msg = createRequest('test', 'renderer-to-main', 'proc-1', { data: 1 }, 5000);
    expect(msg.kind).toBe('request');
    expect(msg.timeoutMs).toBe(5000);
  });

  it('createResponse produces success response', () => {
    const msg = createResponse('test', 'main-to-renderer', 'proc-2', 'corr-1', { result: 42 });
    expect(msg.kind).toBe('response');
    expect(msg.success).toBe(true);
    expect(msg.payload).toEqual({ result: 42 });
    expect(msg.correlationId).toBe('corr-1');
  });

  it('createErrorResponse produces error response', () => {
    const msg = createErrorResponse('test', 'main-to-renderer', 'proc-2', 'corr-1', new Error('bad'));
    expect(msg.kind).toBe('response');
    expect(msg.success).toBe(false);
    expect(msg.error).toBeDefined();
    expect(msg.error!.message).toBe('bad');
    expect(msg.correlationId).toBe('corr-1');
  });

  it('createStreamRequest produces correct shape', () => {
    const msg = createStreamRequest('test', 'main-to-renderer', 'proc-1', { q: 'search' }, 60_000);
    expect(msg.kind).toBe('stream-request');
    expect(msg.timeoutMs).toBe(60_000);
  });

  it('createStreamChunk produces chunk with done flag', () => {
    const msg = createStreamChunk('test', 'renderer-to-main', 'proc-1', 'corr-1', { chunk: 1 }, false);
    expect(msg.kind).toBe('stream-chunk');
    expect(msg.done).toBe(false);
    expect(msg.data).toEqual({ chunk: 1 });
  });

  it('type guards work correctly', () => {
    const ff = createFireAndForget('c', 'main-to-renderer', 'p', null);
    const req = createRequest('c', 'main-to-renderer', 'p', null);
    const res = createResponse('c', 'main-to-renderer', 'p', 'corr', null);
    const sr = createStreamRequest('c', 'main-to-renderer', 'p', null);
    const sc = createStreamChunk('c', 'main-to-renderer', 'p', 'corr', null, true);

    expect(isFireAndForget(ff)).toBe(true);
    expect(isRequest(req)).toBe(true);
    expect(isResponse(res)).toBe(true);
    expect(isStreamRequest(sr)).toBe(true);
    expect(isStreamChunk(sc)).toBe(true);

    expect(isFireAndForget(req)).toBe(false);
    expect(isRequest(ff)).toBe(false);
    expect(isResponse(ff)).toBe(false);
  });

  it('IPCChannels has all channel names', () => {
    expect(IPCChannels.TAB_CREATE).toBe('tab:create');
    expect(IPCChannels.NAVIGATE).toBe('navigation:navigate');
    expect(IPCChannels.JS_EVALUATE).toBe('js:evaluate');
    expect(IPCChannels.PROCESS_READY).toBe('process:ready');
    expect(IPCChannels.SYSTEM_PING).toBe('system:ping');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Serializer
// ═════════════════════════════════════════════════════════════════════════════

describe('JSONSerializer', () => {
  let serializer: JSONSerializer;

  beforeEach(() => {
    serializer = new JSONSerializer();
  });

  it('encodes and decodes a fire-and-forget message', () => {
    const original = createFireAndForget('ch', 'main-to-renderer', 'p1', { a: 1 });
    const encoded = serializer.encode(original);
    const decoded = serializer.decode(encoded);
    expect(decoded.kind).toBe('fire-and-forget');
    expect(decoded.channel).toBe('ch');
    expect((decoded as any).payload).toEqual({ a: 1 });
  });

  it('preserves Date objects through round-trip', () => {
    const date = new Date('2026-01-15T12:00:00Z');
    const msg = createFireAndForget('ch', 'main-to-renderer', 'p1', { when: date });
    const decoded = serializer.decode(serializer.encode(msg));
    expect((decoded as any).payload.when).toBeInstanceOf(Date);
    expect((decoded as any).payload.when.toISOString()).toBe('2026-01-15T12:00:00.000Z');
  });

  it('preserves Map objects through round-trip', () => {
    const map = new Map([['key1', 'val1'], ['key2', 'val2']]);
    const msg = createFireAndForget('ch', 'main-to-renderer', 'p1', { data: map });
    const decoded = serializer.decode(serializer.encode(msg));
    expect((decoded as any).payload.data).toBeInstanceOf(Map);
    expect((decoded as any).payload.data.get('key1')).toBe('val1');
  });

  it('preserves Set objects through round-trip', () => {
    const set = new Set([1, 2, 3]);
    const msg = createFireAndForget('ch', 'main-to-renderer', 'p1', { data: set });
    const decoded = serializer.decode(serializer.encode(msg));
    expect((decoded as any).payload.data).toBeInstanceOf(Set);
    expect((decoded as any).payload.data.has(2)).toBe(true);
  });

  it('preserves RegExp through round-trip', () => {
    const re = /test/gi;
    const msg = createFireAndForget('ch', 'main-to-renderer', 'p1', { pattern: re });
    const decoded = serializer.decode(serializer.encode(msg));
    expect((decoded as any).payload.pattern).toBeInstanceOf(RegExp);
    expect((decoded as any).payload.pattern.source).toBe('test');
    expect((decoded as any).payload.pattern.flags).toBe('gi');
  });

  it('preserves BigInt through round-trip', () => {
    const big = BigInt(9007199254740993);
    const msg = createFireAndForget('ch', 'main-to-renderer', 'p1', { num: big });
    const decoded = serializer.decode(serializer.encode(msg));
    expect((decoded as any).payload.num).toBe(BigInt(9007199254740993));
  });

  it('preserves undefined through round-trip', () => {
    const msg = createFireAndForget('ch', 'main-to-renderer', 'p1', { val: undefined });
    const decoded = serializer.decode(serializer.encode(msg));
    expect('val' in (decoded as any).payload).toBe(true);
    expect((decoded as any).payload.val).toBeUndefined();
  });

  it('preserves Error objects through round-trip', () => {
    const err = new Error('test error');
    const msg = createFireAndForget('ch', 'main-to-renderer', 'p1', { err });
    const decoded = serializer.decode(serializer.encode(msg));
    expect((decoded as any).payload.err).toBeInstanceOf(Error);
    expect((decoded as any).payload.err.message).toBe('test error');
  });

  it('is_valid detects valid messages', () => {
    const msg = createFireAndForget('ch', 'main-to-renderer', 'p1', null);
    expect(serializer.is_valid(msg)).toBe(true);
  });

  it('is_valid rejects invalid shapes', () => {
    expect(serializer.is_valid(null)).toBe(false);
    expect(serializer.is_valid({})).toBe(false);
    expect(serializer.is_valid({ id: 1 })).toBe(false);
    expect(serializer.is_valid('string')).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Transport
// ═════════════════════════════════════════════════════════════════════════════

describe('InProcessTransport', () => {
  let a: InProcessTransport;
  let b: InProcessTransport;

  beforeEach(() => {
    [a, b] = createInProcessPair(
      { localId: 'a', remoteId: 'b' },
      { localId: 'b', remoteId: 'a' },
    );
  });

  it('starts disconnected', () => {
    expect(a.connected).toBe(false);
    expect(b.connected).toBe(false);
  });

  it('connects both ends', async () => {
    await a.connect();
    await b.connect();
    expect(a.connected).toBe(true);
    expect(b.connected).toBe(true);
  });

  it('delivers messages from A to B', async () => {
    await a.connect();
    await b.connect();

    let received = '';
    b.onData((data) => { received = data; });

    await a.send('hello');
    expect(received).toBe('hello');
  });

  it('delivers messages from B to A', async () => {
    await a.connect();
    await b.connect();

    let received = '';
    a.onData((data) => { received = data; });

    await b.send('world');
    expect(received).toBe('world');
  });

  it('throws when sending on disconnected transport', async () => {
    await a.connect();
    await b.connect();
    await a.disconnect();

    await expect(a.send('msg')).rejects.toThrow('Transport not connected');
  });

  it('offData removes handler', async () => {
    await a.connect();
    await b.connect();

    let count = 0;
    const handler = () => { count++; };
    b.onData(handler);
    await a.send('1');
    b.offData(handler);
    await a.send('2');
    expect(count).toBe(1);
  });

  it('disconnect fires close handlers', async () => {
    await a.connect();
    await b.connect();

    let closed = false;
    b.onClose(() => { closed = true; });
    await b.disconnect();
    expect(closed).toBe(true);
  });

  it('dispose clears all state', async () => {
    await a.connect();
    await b.connect();
    a.dispose();
    expect(a.connected).toBe(false);
  });

  it('localId and remoteId are correct', () => {
    expect(a.localId).toBe('a');
    expect(a.remoteId).toBe('b');
    expect(b.localId).toBe('b');
    expect(b.remoteId).toBe('a');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Channel
// ═════════════════════════════════════════════════════════════════════════════

describe('Channel', () => {
  let transportA: InProcessTransport;
  let transportB: InProcessTransport;
  let channelA: Channel;
  let channelB: Channel;

  beforeEach(async () => {
    [transportA, transportB] = createInProcessPair(
      { localId: 'a', remoteId: 'b' },
      { localId: 'b', remoteId: 'a' },
    );
    await transportA.connect();
    await transportB.connect();

    channelA = new Channel(transportA, { name: 'test-channel' }, 'proc-a');
    channelB = new Channel(transportB, { name: 'test-channel' }, 'proc-b');
    channelA.activate();
    channelB.activate();
  });

  it('delivers fire-and-forget messages', async () => {
    let received: unknown = null;
    channelB.onMessage((payload) => { received = payload; });

    await channelA.send({ greeting: 'hello' });
    expect(received).toEqual({ greeting: 'hello' });
  });

  it('delivers request-response', async () => {
    channelB.onRequest(async (payload: any) => {
      return { doubled: (payload as any).n * 2 };
    });

    const result = await channelA.request<{ n: number }, { doubled: number }>({ n: 21 });
    expect(result).toEqual({ doubled: 42 });
  });

  it('request rejects on handler error', async () => {
    channelB.onRequest(async () => {
      throw new Error('handler failed');
    });

    await expect(channelA.request({})).rejects.toThrow('handler failed');
  });

  it('request times out when no handler', async () => {
    await expect(channelA.request({}, 100)).rejects.toThrow('timed out');
  });

  it('channel name is accessible', () => {
    expect(channelA.name).toBe('test-channel');
  });

  it('activate/deactivate works', () => {
    expect(channelA.active).toBe(true);
    channelA.deactivate();
    expect(channelA.active).toBe(false);
  });

  it('send throws when deactivated', async () => {
    channelA.deactivate();
    await expect(channelA.send({})).rejects.toThrow('not active');
  });

  it('offMessage removes handler', async () => {
    let count = 0;
    const handler = () => { count++; };
    channelB.onMessage(handler);
    await channelA.send('1');
    channelB.offMessage(handler);
    await channelA.send('2');
    expect(count).toBe(1);
  });

  it('dispose clears handlers', () => {
    channelA.dispose();
    channelB.dispose();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ChannelManager
// ═════════════════════════════════════════════════════════════════════════════

describe('ChannelManager', () => {
  let transport: InProcessTransport;
  let mgr: ChannelManager;

  beforeEach(async () => {
    transport = new InProcessTransport({ localId: 'test', remoteId: 'peer' });
    await transport.connect();
    mgr = new ChannelManager(transport, 'test-proc');
  });

  it('creates channels by name', () => {
    const ch = mgr.getChannel('my-channel');
    expect(ch.name).toBe('my-channel');
    expect(mgr.hasChannel('my-channel')).toBe(true);
  });

  it('returns same channel for same name', () => {
    const ch1 = mgr.getChannel('ch');
    const ch2 = mgr.getChannel('ch');
    expect(ch1).toBe(ch2);
  });

  it('removes channels', () => {
    mgr.getChannel('ch');
    expect(mgr.removeChannel('ch')).toBe(true);
    expect(mgr.hasChannel('ch')).toBe(false);
    expect(mgr.removeChannel('ch')).toBe(false);
  });

  it('lists channel names', () => {
    mgr.getChannel('a');
    mgr.getChannel('b');
    const names = mgr.getChannelNames();
    expect(names).toContain('a');
    expect(names).toContain('b');
  });

  it('activateAll/deactivateAll', () => {
    const ch1 = mgr.getChannel('a');
    const ch2 = mgr.getChannel('b');
    mgr.activateAll();
    expect(ch1.active).toBe(true);
    expect(ch2.active).toBe(true);
    mgr.deactivateAll();
    expect(ch1.active).toBe(false);
    expect(ch2.active).toBe(false);
  });

  it('dispose clears everything', () => {
    mgr.getChannel('a');
    mgr.getChannel('b');
    mgr.dispose();
    expect(mgr.getChannelNames()).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ServiceProxy / ServiceStub
// ═════════════════════════════════════════════════════════════════════════════

describe('ServiceProxy + ServiceStub', () => {
  let transportA: InProcessTransport;
  let transportB: InProcessTransport;
  let proxyChannel: Channel;
  let stubChannel: Channel;
  let proxy: ServiceProxy;
  let stub: ServiceStub;

  beforeEach(async () => {
    [transportA, transportB] = createInProcessPair(
      { localId: 'client', remoteId: 'server' },
      { localId: 'server', remoteId: 'client' },
    );
    await transportA.connect();
    await transportB.connect();

    proxyChannel = new Channel(transportA, { name: 'calc-service' }, 'client');
    stubChannel = new Channel(transportB, { name: 'calc-service' }, 'server');

    proxy = new ServiceProxy(proxyChannel, { serviceName: 'Calculator', channelName: 'calc-service', timeoutMs: 5000 });
    stub = new ServiceStub(stubChannel, 'Calculator');

    stub.setImplementation({
      add: (a: unknown, b: unknown) => (a as number) + (b as number),
      multiply: (a: unknown, b: unknown) => (a as number) * (b as number),
      greet: (name: unknown) => `Hello, ${name}!`,
      failing: () => { throw new Error('deliberate failure'); },
    });

    stub.activate();
    proxyChannel.activate();
  });

  it('invokes remote methods', async () => {
    const result = await proxy.invoke<number>('add', 3, 4);
    expect(result).toBe(7);
  });

  it('invokes multiply', async () => {
    const result = await proxy.invoke<number>('multiply', 5, 6);
    expect(result).toBe(30);
  });

  it('invokes string-returning methods', async () => {
    const result = await proxy.invoke<string>('greet', 'World');
    expect(result).toBe('Hello, World!');
  });

  it('throws on remote errors', async () => {
    await expect(proxy.invoke('failing')).rejects.toThrow('deliberate failure');
  });

  it('throws on unknown methods', async () => {
    await expect(proxy.invoke('nonexistent')).rejects.toThrow('not found');
  });

  it('ping returns true when service is active', async () => {
    const ok = await proxy.ping();
    expect(ok).toBe(true);
  });

  it('ping returns false when service is inactive', async () => {
    stub.deactivate();
    const ok = await proxy.ping();
    expect(ok).toBe(false);
  });

  it('getCallHistory records calls', async () => {
    await proxy.invoke('add', 1, 2);
    await proxy.invoke('multiply', 3, 4);
    const history = proxy.getCallHistory();
    expect(history).toHaveLength(2);
    expect(history[0]!.method).toBe('add');
    expect(history[0]!.success).toBe(true);
  });

  it('getConfig returns config', () => {
    expect(proxy.getConfig().serviceName).toBe('Calculator');
  });

  it('dispose cleans up', () => {
    proxy.dispose();
    expect(proxy.connected).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// ProcessManager
// ═════════════════════════════════════════════════════════════════════════════

describe('ProcessManager', () => {
  let manager: ProcessManager;

  beforeEach(async () => {
    const { manager: mgr } = createInProcessManager({ maxProcesses: 5 });
    manager = mgr;
  });

  it('spawns a process', async () => {
    const pid = await manager.spawnProcess();
    expect(pid).toBeTruthy();
    expect(manager.getAllProcesses()).toHaveLength(1);
  });

  it('spawns with tab ID', async () => {
    const pid = await manager.spawnProcess('tab-1');
    const info = manager.getProcess(pid);
    expect(info).not.toBeNull();
    expect(info!.tabId).toBe('tab-1');
    expect(info!.state).toBe(ProcessState.Ready);
  });

  it('getProcessForTab returns correct process', async () => {
    const pid = await manager.spawnProcess('tab-1');
    expect(manager.getProcessForTab('tab-1')?.id).toBe(pid);
    expect(manager.getProcessForTab('nonexistent')).toBeNull();
  });

  it('destroys a process', async () => {
    const pid = await manager.spawnProcess('tab-1');
    const result = await manager.destroyProcess(pid);
    expect(result).toBe(true);
    expect(manager.getProcess(pid)).toBeNull();
  });

  it('destroyProcess returns false for unknown ID', async () => {
    expect(await manager.destroyProcess('nonexistent')).toBe(false);
  });

  it('emits processSpawned event', async () => {
    let spawnedPid = '';
    manager.on('processSpawned', (e) => { spawnedPid = e.processId; });
    const pid = await manager.spawnProcess('tab-1');
    expect(spawnedPid).toBe(pid);
  });

  it('emits processReady event', async () => {
    let readyPid = '';
    manager.on('processReady', (e) => { readyPid = e.processId; });
    const pid = await manager.spawnProcess();
    expect(readyPid).toBe(pid);
  });

  it('enforces max process limit', async () => {
    for (let i = 0; i < 5; i++) await manager.spawnProcess();
    await expect(manager.spawnProcess()).rejects.toThrow('Maximum process limit');
  });

  it('dispose clears all processes', async () => {
    await manager.spawnProcess('tab-1');
    await manager.spawnProcess('tab-2');
    manager.dispose();
    expect(manager.getAllProcesses()).toHaveLength(0);
  });

  it('process has transport and channelManager', async () => {
    const pid = await manager.spawnProcess('tab-1');
    const info = manager.getProcess(pid);
    expect(info!.transport).toBeDefined();
    expect(info!.channelManager).toBeDefined();
  });

  it('off removes event handler', async () => {
    let count = 0;
    const handler = () => { count++; };
    manager.on('processSpawned', handler);
    await manager.spawnProcess();
    manager.off('processSpawned', handler);
    await manager.spawnProcess();
    expect(count).toBe(1);
  });
});
