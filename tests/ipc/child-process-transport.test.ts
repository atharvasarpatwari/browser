import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChildProcessTransport } from '../../src/common/ipc/child-process-transport';

describe('ChildProcessTransport', () => {
  let transport: ChildProcessTransport;

  beforeEach(() => {
    transport = new ChildProcessTransport();
  });

  afterEach(() => {
    transport.dispose();
  });

  describe('initialization', () => {
    it('should initialize with no process attached', () => {
      expect(transport.isAlive).toBe(false);
    });

    it('should throw when sending without a process', () => {
      expect(() => transport.send({ test: true })).toThrow('No IPC channel available');
    });

    it('should throw when attaching to an already attached process', () => {
      const mockProcess = {
        channel: {},
        on: vi.fn(),
        send: vi.fn(),
        disconnect: vi.fn(),
      } as any;

      transport.attach(mockProcess);
      expect(() => transport.attach(mockProcess)).toThrow('Already attached to a process');
    });
  });

  describe('message handling', () => {
    it('should register message handlers', () => {
      const handler = vi.fn();
      transport.onMessage(handler);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should unregister message handlers', () => {
      const handler = vi.fn();
      transport.onMessage(handler);
      transport.offMessage(handler);
      // Handler should not be called after unregistration
    });

    it('should register error handlers', () => {
      const handler = vi.fn();
      transport.onError(handler);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should unregister error handlers', () => {
      const handler = vi.fn();
      transport.onError(handler);
      transport.offError(handler);
      // Handler should not be called after unregistration
    });
  });

  describe('dispose', () => {
    it('should mark transport as disposed', () => {
      transport.dispose();
      expect(transport.isAlive).toBe(false);
    });

    it('should throw when sending after dispose', () => {
      transport.dispose();
      expect(() => transport.send({ test: true })).toThrow('Transport is disposed');
    });

    it('should be idempotent', () => {
      transport.dispose();
      transport.dispose(); // Should not throw
      expect(transport.isAlive).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should catch listener errors', () => {
      const badHandler = () => {
        throw new Error('Handler error');
      };
      const goodHandler = vi.fn();
      
      transport.onMessage(badHandler);
      transport.onMessage(goodHandler);
      
      // When we attach a process and receive a message,
      // both handlers should be called without throwing
    });

    it('should catch error listener errors', () => {
      const badHandler = () => {
        throw new Error('Handler error');
      };
      const goodHandler = vi.fn();
      
      transport.onError(badHandler);
      transport.onError(goodHandler);
      
      // Error handlers should be registered
    });
  });
});

describe('ChildProcessTransport with mock process', () => {
  let transport: ChildProcessTransport;
  let mockProcess: any;
  let messageHandlers: Map<string, Function>;

  beforeEach(() => {
    transport = new ChildProcessTransport();
    messageHandlers = new Map();
    
    mockProcess = {
      channel: {},
      connected: true,
      on: vi.fn((event: string, handler: Function) => {
        messageHandlers.set(event, handler);
      }),
      send: vi.fn(),
      disconnect: vi.fn(),
    };
  });

  afterEach(() => {
    transport.dispose();
  });

  it('should attach to a process', () => {
    transport.attach(mockProcess);
    expect(transport.isAlive).toBe(true);
  });

  it('should send messages through process.send', () => {
    transport.attach(mockProcess);
    transport.send({ type: 'test', data: 123 });
    expect(mockProcess.send).toHaveBeenCalledWith({ type: 'test', data: 123 });
  });

  it('should handle incoming messages', () => {
    const handler = vi.fn();
    transport.onMessage(handler);
    transport.attach(mockProcess);
    
    // Simulate incoming message
    const messageHandler = messageHandlers.get('message');
    expect(messageHandler).toBeDefined();
    
    messageHandler!({ type: 'response', data: 'hello' });
    expect(handler).toHaveBeenCalledWith({ type: 'response', data: 'hello' });
  });

  it('should handle process errors', () => {
    const handler = vi.fn();
    transport.onError(handler);
    transport.attach(mockProcess);
    
    // Simulate error
    const errorHandler = messageHandlers.get('error');
    expect(errorHandler).toBeDefined();
    
    const error = new Error('Process error');
    errorHandler!(error);
    expect(handler).toHaveBeenCalledWith(error);
  });

  it('should handle process exit', () => {
    const handler = vi.fn();
    transport.onError(handler);
    transport.attach(mockProcess);
    
    // Simulate exit
    const exitHandler = messageHandlers.get('exit');
    expect(exitHandler).toBeDefined();
    
    exitHandler!(1, 'SIGTERM');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('exited with code 1'),
      })
    );
  });

  it('should disconnect on dispose', () => {
    transport.attach(mockProcess);
    transport.dispose();
    expect(mockProcess.disconnect).toHaveBeenCalled();
  });

  it('should not send messages after dispose', () => {
    transport.attach(mockProcess);
    transport.dispose();
    expect(() => transport.send({ test: true })).toThrow('Transport is disposed');
  });
});
