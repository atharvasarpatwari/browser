import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChildProcessTransport } from '@/common/ipc/child-process-transport';

describe('ChildProcessTransport', () => {
  let transport: ChildProcessTransport;
  let mockListeners: Map<string, Function[]>;
  let mockProcess: any;

  beforeEach(() => {
    mockListeners = new Map();
    mockProcess = {
      channel: {},
      connected: true,
      on: vi.fn((event: string, handler: Function) => {
        if (!mockListeners.has(event)) mockListeners.set(event, []);
        mockListeners.get(event)!.push(handler);
      }),
      removeListener: vi.fn((event: string, handler: Function) => {
        const handlers = mockListeners.get(event);
        if (handlers) {
          const i = handlers.indexOf(handler);
          if (i !== -1) handlers.splice(i, 1);
        }
      }),
      send: vi.fn(),
      disconnect: vi.fn(),
    };

    transport = ChildProcessTransport.fromChildProcess(mockProcess, {
      localId: 'main',
      remoteId: 'child-1',
    });
  });

  afterEach(() => {
    transport.dispose();
  });

  describe('initialization', () => {
    it('should not be connected before connect()', () => {
      expect(transport.connected).toBe(false);
    });

    it('should report localId and remoteId', () => {
      expect(transport.localId).toBe('main');
      expect(transport.remoteId).toBe('child-1');
    });

    it('should have an id', () => {
      expect(transport.id).toBeTruthy();
    });

    it('should expose the child process', () => {
      expect(transport.childProcess).toBe(mockProcess);
    });

    it('should register process listeners on construction', () => {
      expect(mockProcess.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockProcess.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockProcess.on).toHaveBeenCalledWith('exit', expect.any(Function));
    });
  });

  describe('connect / disconnect', () => {
    it('should connect', async () => {
      await transport.connect();
      expect(transport.connected).toBe(true);
    });

    it('should be idempotent', async () => {
      await transport.connect();
      await transport.connect();
      expect(transport.connected).toBe(true);
    });

    it('should disconnect', async () => {
      await transport.connect();
      await transport.disconnect();
      expect(transport.connected).toBe(false);
    });

    it('should call process.disconnect on disconnect', async () => {
      await transport.connect();
      await transport.disconnect();
      expect(mockProcess.disconnect).toHaveBeenCalled();
    });

    it('should be no-op if already disconnected', async () => {
      await transport.disconnect();
      expect(mockProcess.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('send', () => {
    it('should send string data through process.send', async () => {
      await transport.connect();
      await transport.send('hello world');
      expect(mockProcess.send).toHaveBeenCalledWith('hello world');
    });

    it('should throw when not connected', async () => {
      await expect(transport.send('data')).rejects.toThrow('Transport not connected');
    });

    it('should throw when no IPC channel', async () => {
      mockProcess.channel = null;
      await transport.connect();
      await expect(transport.send('data')).rejects.toThrow('No IPC channel');
    });

    it('should throw when message exceeds size limit', async () => {
      await transport.connect();
      const big = 'x'.repeat(17 * 1024 * 1024);
      await expect(transport.send(big)).rejects.toThrow('exceeds limit');
    });
  });

  describe('data handlers', () => {
    it('should deliver incoming messages to onData handlers', async () => {
      const handler = vi.fn();
      transport.onData(handler);
      await transport.connect();

      const messageHandler = mockListeners.get('message')![0];
      messageHandler('{"test": true}');
      expect(handler).toHaveBeenCalledWith('{"test": true}');
    });

    it('should deliver to multiple handlers', async () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      transport.onData(h1);
      transport.onData(h2);
      await transport.connect();

      const messageHandler = mockListeners.get('message')![0];
      messageHandler('msg');
      expect(h1).toHaveBeenCalledWith('msg');
      expect(h2).toHaveBeenCalledWith('msg');
    });

    it('offData removes a handler', async () => {
      const handler = vi.fn();
      transport.onData(handler);
      transport.offData(handler);
      await transport.connect();

      const messageHandler = mockListeners.get('message')![0];
      messageHandler('msg');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should not deliver when not connected', async () => {
      const handler = vi.fn();
      transport.onData(handler);

      const messageHandler = mockListeners.get('message')![0];
      messageHandler('msg');
      expect(handler).not.toHaveBeenCalled();
    });

    it('should catch handler errors and route to error handlers', async () => {
      const badHandler = () => { throw new Error('handler error'); };
      const errorHandler = vi.fn();
      transport.onData(badHandler);
      transport.onError(errorHandler);
      await transport.connect();

      const messageHandler = mockListeners.get('message')![0];
      messageHandler('msg');
      expect(errorHandler).toHaveBeenCalled();
    });
  });

  describe('error handlers', () => {
    it('should deliver process errors to onError handlers', async () => {
      const handler = vi.fn();
      transport.onError(handler);
      await transport.connect();

      const errorHandler = mockListeners.get('error')![0];
      const err = new Error('process failed');
      errorHandler(err);
      expect(handler).toHaveBeenCalledWith(err);
    });

    it('should not deliver errors when not connected', async () => {
      const handler = vi.fn();
      transport.onError(handler);

      const errorHandler = mockListeners.get('error')![0];
      errorHandler(new Error('err'));
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('close handlers', () => {
    it('should fire onClose when process exits', async () => {
      const handler = vi.fn();
      transport.onClose(handler);
      await transport.connect();

      const exitHandler = mockListeners.get('exit')![0];
      exitHandler(1, null);
      expect(handler).toHaveBeenCalled();
      expect(transport.connected).toBe(false);
    });

    it('should not fire onClose when already disconnected', async () => {
      const handler = vi.fn();
      transport.onClose(handler);
      await transport.connect();
      await transport.disconnect();
      handler.mockClear();

      const exitHandler = mockListeners.get('exit')![0];
      exitHandler(1, null);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should disconnect on dispose', async () => {
      await transport.connect();
      transport.dispose();
      expect(transport.connected).toBe(false);
      expect(mockProcess.disconnect).toHaveBeenCalled();
    });

    it('should remove process reference', () => {
      transport.dispose();
      expect(transport.childProcess).toBeNull();
    });

    it('should be idempotent', () => {
      transport.dispose();
      transport.dispose();
      expect(transport.connected).toBe(false);
    });

    it('should clear handlers', async () => {
      const handler = vi.fn();
      transport.onData(handler);
      transport.dispose();
      expect(transport.connected).toBe(false);
    });
  });
});

describe('ChildProcessTransport.fork', () => {
  it('should be a static factory method', () => {
    expect(typeof ChildProcessTransport.fork).toBe('function');
  });
});
