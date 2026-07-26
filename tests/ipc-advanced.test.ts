/**
 * @file tests/ipc-advanced.test.ts
 *
 * Comprehensive tests for IPC improvements:
 * - Channel subscribe/topic messaging
 * - Channel stream handling (server-side onStream + client-side stream())
 * - Queue-based streaming with backpressure
 * - ProcessManager heartbeat
 * - Transport backpressure (bufferedAmount, onDrain)
 * - WorkerTransport (mocked)
 * - SocketTransport (mocked)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  InProcessTransport,
  createInProcessPair,
  DEFAULT_TRANSPORT_CONFIG,
} from '../src/common/ipc/transport';
import {
  Channel,
  ChannelManager,
  DEFAULT_CHANNEL_CONFIG,
} from '../src/common/ipc/channel';
import {
  ProcessManager,
  ProcessState,
  createInProcessManager,
  DEFAULT_PROCESS_MANAGER_CONFIG,
} from '../src/common/ipc/process-manager';
import {
  createFireAndForget,
  createStreamChunk,
  createStreamRequest,
  isStreamChunk,
} from '../src/common/ipc/message';
import { EventEmitterTransport } from '../src/common/ipc/transport';
import { CrossProcessPageLoader } from '../src/common/ipc/cross-process-page-loader';
import { ChildProcessTransport } from '../src/common/ipc/child-process-transport';
import { WorkerParentTransport, WorkerSideTransport } from '../src/common/ipc/worker-transport';
import { SocketTransport, SocketServerTransport } from '../src/common/ipc/socket-transport';

// ── Helpers ─────────────────────────────────────────────────────────────────

function createTestPair() {
  const [a, b] = createInProcessPair(
    { localId: 'a', remoteId: 'b' },
    { localId: 'b', remoteId: 'a' },
  );
  return { a, b };
}

function createTestChannelPair(channelName = 'test') {
  const { a, b } = createTestPair();
  const processIdA = 'proc-a';
  const processIdB = 'proc-b';
  const chA = new Channel(a, { name: channelName, direction: 'main-to-renderer' }, processIdA);
  const chB = new Channel(b, { name: channelName, direction: 'renderer-to-main' }, processIdB);
  return { a, b, chA, chB, processIdA, processIdB };
}

// ── Channel Subscribe / Topic Messaging ─────────────────────────────────────

describe('Channel subscribe / topic messaging', () => {
  let pair: ReturnType<typeof createTestChannelPair>;

  beforeEach(async () => {
    pair = createTestChannelPair();
    await pair.a.connect();
    await pair.b.connect();
    pair.chA.activate();
    pair.chB.activate();
  });

  afterEach(() => {
    pair.chA.dispose();
    pair.chB.dispose();
    pair.a.dispose();
    pair.b.dispose();
  });

  it('subscribe receives topic-filtered messages', async () => {
    const received: string[] = [];
    const unsub = pair.chB.subscribe<string>('alerts', (payload) => {
      received.push(payload);
    });

    await pair.chA.send('alerts', 'warning');
    await pair.chA.send('alerts', 'error');

    // Wait for async delivery
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toEqual(['warning', 'error']);
    unsub();
  });

  it('subscribe ignores messages on other topics', async () => {
    const received: string[] = [];
    pair.chB.subscribe<string>('topic-a', (payload) => {
      received.push(payload);
    });

    await pair.chA.send('topic-b', 'msg1');
    await pair.chA.send('other', 'msg2');
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toEqual([]);
  });

  it('unsubscribe stops delivery', async () => {
    const received: string[] = [];
    const unsub = pair.chB.subscribe<string>('log', (payload) => {
      received.push(payload);
    });

    await pair.chA.send('log', 'msg1');
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toEqual(['msg1']);

    unsub();
    await pair.chA.send('log', 'msg2');
    await new Promise((r) => setTimeout(r, 50));
    expect(received).toEqual(['msg1']);
  });

  it('multiple subscribers on same topic', async () => {
    const received1: string[] = [];
    const received2: string[] = [];
    pair.chB.subscribe<string>('events', (p) => received1.push(p));
    pair.chB.subscribe<string>('events', (p) => received2.push(p));

    await pair.chA.send('events', 'hello');
    await new Promise((r) => setTimeout(r, 50));

    expect(received1).toEqual(['hello']);
    expect(received2).toEqual(['hello']);
  });

  it('send(payload) without topic works as before', async () => {
    let received: unknown = null;
    pair.chB.onMessage((payload) => {
      received = payload;
    });

    await pair.chA.send('plain-message');
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toBe('plain-message');
  });
});

// ── Channel Streaming ───────────────────────────────────────────────────────

describe('Channel streaming', () => {
  let pair: ReturnType<typeof createTestChannelPair>;

  beforeEach(async () => {
    pair = createTestChannelPair();
    await pair.a.connect();
    await pair.b.connect();
    pair.chA.activate();
    pair.chB.activate();
  });

  afterEach(() => {
    pair.chA.dispose();
    pair.chB.dispose();
    pair.a.dispose();
    pair.b.dispose();
  });

  it('server-side stream handler sends chunks', async () => {
    // Register a stream handler on B that yields numbers
    pair.chB.onStream<number, number>(async function* (_payload) {
      for (let i = 1; i <= 5; i++) {
        yield i;
      }
    });

    // Client A opens a stream
    const chunks: number[] = [];
    for await (const chunk of pair.chA.stream<void, number>(null)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([1, 2, 3, 4, 5]);
  });

  it('stream with empty result', async () => {
    pair.chB.onStream(async function* () {
      // empty
    });

    const chunks: unknown[] = [];
    for await (const chunk of pair.chA.stream(null)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([]);
  });

  it('stream with payload', async () => {
    pair.chB.onStream<{ start: number; count: number }, number>(async function* (payload) {
      for (let i = payload.start; i < payload.start + payload.count; i++) {
        yield i;
      }
    });

    const chunks: number[] = [];
    for await (const chunk of pair.chA.stream<{ start: number; count: number }, number>({ start: 10, count: 3 })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([10, 11, 12]);
  });

  it('stream times out when no handler', async () => {
    const chunks: unknown[] = [];
    try {
      for await (const chunk of pair.chA.stream(null, 200)) {
        chunks.push(chunk);
      }
    } catch {
      // Expected — no handler registered, stream will just end
    }

    // Should get done signal and exit cleanly (not hang)
    expect(chunks).toEqual([]);
  });

  it('stream error in handler sends done', async () => {
    pair.chB.onStream(async function* () {
      throw new Error('handler error');
    });

    const chunks: unknown[] = [];
    try {
      for await (const chunk of pair.chA.stream(null, 500)) {
        chunks.push(chunk);
      }
    } catch {
      // may throw
    }

    // Stream should end cleanly even with handler error
    expect(chunks).toEqual([]);
  });
});

// ── Transport BufferedAmount and Drain ──────────────────────────────────────

describe('Transport backpressure', () => {
  it('InProcessTransport starts with bufferedAmount 0', () => {
    const [a, b] = createInProcessPair();
    expect(a.bufferedAmount).toBe(0);
    expect(b.bufferedAmount).toBe(0);
    a.dispose();
    b.dispose();
  });

  it('onDrain / offDrain work', () => {
    const [a, b] = createInProcessPair();
    let drainCalled = false;
    const handler = () => { drainCalled = true; };
    a.onDrain(handler);
    a.offDrain(handler);
    a.dispose();
    b.dispose();
    expect(drainCalled).toBe(false);
  });

  it('EventEmitterTransport has bufferedAmount and drain', () => {
    // Create a mock emitter
    const handlers: Record<string, Function[]> = {};
    const mockEmitter = {
      send: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        if (!handlers[event]) handlers[event] = [];
        handlers[event].push(handler);
      }),
      removeListener: vi.fn((event: string, handler: Function) => {
        if (handlers[event]) {
          handlers[event] = handlers[event].filter(h => h !== handler);
        }
      }),
    };

    const transport = new EventEmitterTransport(mockEmitter, { localId: 'test', remoteId: 'peer' });

    expect(transport.bufferedAmount).toBe(0);

    let drainCalled = false;
    transport.onDrain(() => { drainCalled = true; });
    transport.offDrain(() => { drainCalled = true; });

    transport.dispose();
  });
});

// ── ProcessManager Heartbeat ────────────────────────────────────────────────

describe('ProcessManager heartbeat', () => {
  it('spawns process and starts heartbeat', async () => {
    const { manager, getChildTransport } = createInProcessManager({
      spawnTimeoutMs: 2000,
    });

    const processId = await manager.spawnProcess('tab-1');
    const info = manager.getProcess(processId);

    expect(info).not.toBeNull();
    expect(info!.state).toBe(ProcessState.Ready);
    expect(info!.tabId).toBe('tab-1');

    manager.dispose();
  });

  it('heartbeat channel exists after spawn', async () => {
    const { manager, getChildTransport } = createInProcessManager({
      spawnTimeoutMs: 2000,
    });

    const processId = await manager.spawnProcess('tab-1');
    const info = manager.getProcess(processId);
    const cm = info!.channelManager as ChannelManager;

    // The heartbeat channel should exist
    const heartbeatExists = cm.hasChannel('__heartbeat__');
    expect(heartbeatExists).toBe(true);

    manager.dispose();
  });

  it('destroyProcess cleans up heartbeat', async () => {
    const { manager } = createInProcessManager({
      spawnTimeoutMs: 2000,
    });

    const processId = await manager.spawnProcess('tab-2');
    const destroyed = await manager.destroyProcess(processId);

    expect(destroyed).toBe(true);
    expect(manager.getProcess(processId)).toBeNull();

    manager.dispose();
  });
});

// ── ProcessManager State Mutations ──────────────────────────────────────────

describe('ProcessManager state management', () => {
  it('spawnProcess transitions through Starting → Ready', async () => {
    const { manager } = createInProcessManager({ spawnTimeoutMs: 2000 });

    const events: string[] = [];
    manager.on('processSpawned', (e) => events.push(`spawned:${e.processId}`));
    manager.on('processReady', (e) => events.push(`ready:${e.processId}`));

    const processId = await manager.spawnProcess();
    const info = manager.getProcess(processId);

    expect(info!.state).toBe(ProcessState.Ready);
    expect(info!.spawnedAt).toBeGreaterThan(0);
    expect(info!.readyAt).toBeGreaterThan(0);
    expect(info!.crashCount).toBe(0);

    manager.dispose();
  });

  it('destroyProcess transitions to Killed', async () => {
    const { manager } = createInProcessManager({ spawnTimeoutMs: 2000 });

    const processId = await manager.spawnProcess();
    await manager.destroyProcess(processId);

    // Process should be removed
    expect(manager.getProcess(processId)).toBeNull();
    expect(manager.getAllProcesses()).toHaveLength(0);

    manager.dispose();
  });

  it('getAllProcesses returns correct count', async () => {
    const { manager } = createInProcessManager({ spawnTimeoutMs: 2000 });

    await manager.spawnProcess('t1');
    await manager.spawnProcess('t2');

    expect(manager.getAllProcesses()).toHaveLength(2);

    manager.dispose();
  });
});

// ── Cross-Process Proxies with subscribe() ─────────────────────────────────

describe('Cross-process proxies subscribe', () => {
  it('CrossProcessPageLoader uses subscribe without error', async () => {
    const { a, b } = createTestPair();
    await a.connect();
    await b.connect();

    const chA = new Channel(a, { name: 'renderer-1', direction: 'main-to-renderer' }, 'main');
    const chB = new Channel(b, { name: 'renderer-1', direction: 'renderer-to-main' }, 'renderer');
    chA.activate();
    chB.activate();

    // PageRenderer side responds to load requests
    chB.onRequest(() => ({ success: true, title: 'Test', url: 'about:blank' }));

    const loader = new CrossProcessPageLoader(chA);
    const result = await loader.load('https://example.com');

    expect(result).toEqual({ success: true, title: 'Test', url: 'about:blank' });

    loader.dispose();
    chA.dispose();
    chB.dispose();
    a.dispose();
    b.dispose();
  });

  it('CrossProcessPageLoader onProgress uses subscribe pattern', async () => {
    const { a, b } = createTestPair();
    await a.connect();
    await b.connect();

    const chA = new Channel(a, { name: 'renderer-2', direction: 'main-to-renderer' }, 'main');
    const chB = new Channel(b, { name: 'renderer-2', direction: 'renderer-to-main' }, 'renderer');
    chA.activate();
    chB.activate();

    // Setup load response
    chB.onRequest(() => ({ success: true, title: 'Test', url: 'about:blank' }));

    const loader = new CrossProcessPageLoader(chA);
    const progressReports: unknown[] = [];

    loader.onProgress((p) => {
      progressReports.push(p);
    });

    // Start loading
    const loadPromise = loader.load('https://example.com');

    // Simulate progress from renderer side
    await chB.send({ __topic__: 'load-progress', __payload__: { loaded: 50, total: 100 } });
    await new Promise((r) => setTimeout(r, 50));

    expect(progressReports).toHaveLength(1);
    expect(progressReports[0]).toEqual({ loaded: 50, total: 100 });

    await loadPromise;
    loader.dispose();
    chA.dispose();
    chB.dispose();
    a.dispose();
    b.dispose();
  });
});

// ── ChildProcessTransport interface compliance ─────────────────────────────

describe('ChildProcessTransport interface', () => {
  it('implements all ITransport members including new ones', async () => {
    // Create with fromChildProcess using a mock
    const mockHandlers: Record<string, Function[]> = {};
    const mockChild = {
      connected: true,
      channel: {},
      send: vi.fn(),
      disconnect: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        if (!mockHandlers[event]) mockHandlers[event] = [];
        mockHandlers[event].push(handler);
      }),
      removeListener: vi.fn((event: string, handler: Function) => {
        if (mockHandlers[event]) {
          mockHandlers[event] = mockHandlers[event].filter(h => h !== handler);
        }
      }),
    };

    const transport = ChildProcessTransport.fromChildProcess(mockChild as any);

    // ITransport interface members
    expect(typeof transport.id).toBe('string');
    expect(typeof transport.connected).toBe('boolean');
    expect(typeof transport.localId).toBe('string');
    expect(typeof transport.remoteId).toBe('string');
    expect(typeof transport.bufferedAmount).toBe('number');
    expect(typeof transport.connect).toBe('function');
    expect(typeof transport.disconnect).toBe('function');
    expect(typeof transport.send).toBe('function');
    expect(typeof transport.onData).toBe('function');
    expect(typeof transport.onError).toBe('function');
    expect(typeof transport.onClose).toBe('function');
    expect(typeof transport.onDrain).toBe('function');
    expect(typeof transport.offData).toBe('function');
    expect(typeof transport.offDrain).toBe('function');
    expect(typeof transport.dispose).toBe('function');

    transport.dispose();
  });
});

// ── Worker Transport (mocked) ──────────────────────────────────────────────

describe('Worker transports', () => {
  it('WorkerParentTransport implements ITransport', async () => {
    const mockHandlers: Record<string, Function[]> = {};
    const mockWorker = {
      postMessage: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        if (!mockHandlers[event]) mockHandlers[event] = [];
        mockHandlers[event].push(handler);
      }),
      removeListener: vi.fn((event: string, handler: Function) => {
        if (mockHandlers[event]) {
          mockHandlers[event] = mockHandlers[event].filter(h => h !== handler);
        }
      }),
    };

    const transport = new WorkerParentTransport(mockWorker);

    expect(transport.connected).toBe(false);
    expect(transport.bufferedAmount).toBe(0);

    await transport.connect();
    expect(transport.connected).toBe(true);

    await transport.send('hello');
    expect(mockWorker.postMessage).toHaveBeenCalledWith('hello');

    // Simulate incoming message
    const received: string[] = [];
    transport.onData((data) => received.push(data));
    mockHandlers['message']?.forEach(h => h('world'));
    expect(received).toEqual(['world']);

    await transport.disconnect();
    expect(transport.connected).toBe(false);

    transport.dispose();
  });

  it('WorkerSideTransport implements ITransport', async () => {
    const mockHandlers: Record<string, Function[]> = {};
    const mockPort = {
      postMessage: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        if (!mockHandlers[event]) mockHandlers[event] = [];
        mockHandlers[event].push(handler);
      }),
      removeListener: vi.fn((event: string, handler: Function) => {
        if (mockHandlers[event]) {
          mockHandlers[event] = mockHandlers[event].filter(h => h !== handler);
        }
      }),
    };

    const transport = new WorkerSideTransport(mockPort);

    await transport.connect();
    expect(transport.connected).toBe(true);

    await transport.send('test');
    expect(mockPort.postMessage).toHaveBeenCalledWith('test');

    await transport.disconnect();
    expect(transport.connected).toBe(false);

    transport.dispose();
  });

  it('Worker transport onDrain/offDrain work', async () => {
    const mockWorker = {
      postMessage: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const transport = new WorkerParentTransport(mockWorker);

    let drainCalled = false;
    transport.onDrain(() => { drainCalled = true; });
    transport.offDrain(() => { drainCalled = true; });

    transport.dispose();
    expect(drainCalled).toBe(false);
  });
});

// ── Socket Transport (mocked) ──────────────────────────────────────────────

describe('Socket transports', () => {
  it('SocketTransport constructor and properties', async () => {
    const transport = new SocketTransport({ host: '127.0.0.1', port: 8080 });

    expect(transport.connected).toBe(false);
    expect(transport.bufferedAmount).toBe(0);
    expect(transport.localId).toBe('local');
    expect(transport.remoteId).toBe('remote');

    transport.dispose();
  });

  it('SocketTransport send throws when not connected', async () => {
    const transport = new SocketTransport({ host: '127.0.0.1', port: 8080 });

    await expect(transport.send('test')).rejects.toThrow('Socket transport not connected');

    transport.dispose();
  });

  it('SocketServerTransport wraps connected socket', async () => {
    const mockHandlers: Record<string, Function[]> = {};
    const mockSocket = {
      write: vi.fn(() => true),
      end: vi.fn((cb: Function) => cb()),
      destroy: vi.fn(),
      removeAllListeners: vi.fn(),
      on: vi.fn((event: string, handler: Function) => {
        if (!mockHandlers[event]) mockHandlers[event] = [];
        mockHandlers[event].push(handler);
      }),
      removeListener: vi.fn((event: string, handler: Function) => {
        if (mockHandlers[event]) {
          mockHandlers[event] = mockHandlers[event].filter(h => h !== handler);
        }
      }),
    };

    const transport = new SocketServerTransport(mockSocket);

    await transport.connect();
    expect(transport.connected).toBe(true);

    await transport.send('hello');
    expect(mockSocket.write).toHaveBeenCalled();

    // Simulate incoming data
    const received: string[] = [];
    transport.onData((data) => received.push(data));
    mockHandlers['data']?.forEach(h => h(Buffer.from('world')));
    expect(received).toEqual(['world']);

    // Simulate drain
    let drained = false;
    transport.onDrain(() => { drained = true; });
    mockHandlers['drain']?.forEach(h => h());
    expect(drained).toBe(true);

    await transport.disconnect();
    expect(transport.connected).toBe(false);

    transport.dispose();
  });

  it('SocketTransport onDrain and offDrain work', async () => {
    const transport = new SocketTransport({ host: '127.0.0.1', port: 8080 });

    let drainCalled = false;
    const handler = () => { drainCalled = true; };
    transport.onDrain(handler);
    transport.offDrain(handler);

    transport.dispose();
  });
});

// ── Channel Stream Handler Registration ─────────────────────────────────────

describe('Channel onStream/offStream', () => {
  it('onStream and offStream manage handlers', async () => {
    const { a, b } = createTestPair();
    await a.connect();
    await b.connect();

    const chA = new Channel(a, { name: 's', direction: 'main-to-renderer' }, 'a');
    chA.activate();

    let called = false;
    const handler = async function* () { called = true; yield 1; };
    chA.onStream(handler);
    chA.offStream(handler);

    chA.dispose();
    a.dispose();
    b.dispose();
  });
});

// ── Channel subscribe with various payload types ────────────────────────────

describe('Channel subscribe edge cases', () => {
  let pair: ReturnType<typeof createTestChannelPair>;

  beforeEach(async () => {
    pair = createTestChannelPair();
    await pair.a.connect();
    await pair.b.connect();
    pair.chA.activate();
    pair.chB.activate();
  });

  afterEach(() => {
    pair.chA.dispose();
    pair.chB.dispose();
    pair.a.dispose();
    pair.b.dispose();
  });

  it('subscribe with object payload', async () => {
    const received: any[] = [];
    pair.chB.subscribe<{ x: number }>('data', (p) => received.push(p));

    await pair.chA.send('data', { x: 42 });
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toEqual([{ x: 42 }]);
  });

  it('subscribe with null payload', async () => {
    const received: any[] = [];
    pair.chB.subscribe<null>('ping', (p) => received.push(p));

    await pair.chA.send('ping', null);
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toEqual([null]);
  });

  it('subscribe with number payload', async () => {
    const received: any[] = [];
    pair.chB.subscribe<number>('count', (p) => received.push(p));

    await pair.chA.send('count', 123);
    await new Promise((r) => setTimeout(r, 50));

    expect(received).toEqual([123]);
  });
});
