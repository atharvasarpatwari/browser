import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  PreloadBridge,
  createPreloadBridge,
  BRIDGE_APIS,
} from '../src/browser/security/preload';
import type { PreloadCapabilityManifest, PreloadIPC, BridgeResponse } from '../src/browser/security/preload';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function createMockIPC(): PreloadIPC & {
  sent: unknown[];
  handlers: Map<string, (msg: unknown) => void>;
} {
  const sent: unknown[] = [];
  const handlers = new Map<string, (msg: unknown) => void>();
  return {
    sent,
    handlers,
    send(channel: string, message: unknown) {
      sent.push({ channel, message });
    },
    on(channel: string, handler: (msg: unknown) => void) {
      handlers.set(channel, handler);
    },
    once(channel: string, handler: (msg: unknown) => void) {
      // For simplicity, just use on
      handlers.set(channel, handler);
    },
    removeListener(_channel: string, _handler: (msg: unknown) => void) {
      // no-op for tests
    },
  };
}

function createTestManifest(overrides?: Partial<PreloadCapabilityManifest>): PreloadCapabilityManifest {
  return {
    processId: 'test-process',
    privilegeLevel: 'web-content',
    origin: 'https://example.com',
    allowedChannels: ['dom', 'fetch', 'storage', 'websocket', 'workers'],
    allowedSurfaces: ['dom', 'fetch', 'storage', 'websocket', 'workers', 'eval'],
    capabilities: ['canvas-2d', 'dom-access'],
    env: { NODE_ENV: 'production' },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRELOAD BRIDGE
// ─────────────────────────────────────────────────────────────────────────────

describe('PreloadBridge', () => {
  let bridge: PreloadBridge;
  let mockIPC: ReturnType<typeof createMockIPC>;

  beforeEach(() => {
    bridge = createPreloadBridge();
    mockIPC = createMockIPC();
  });

  describe('initialization', () => {
    it('is not ready before initialization', () => {
      expect(bridge.isReady()).toBe(false);
    });

    it('becomes ready after manifest received', () => {
      bridge.initialize(mockIPC);
      expect(bridge.isReady()).toBe(false);

      // Simulate manifest from main process
      const manifestHandler = mockIPC.handlers.get('__preload:manifest');
      manifestHandler!(createTestManifest());

      expect(bridge.isReady()).toBe(true);
    });

    it('sends ready signal on initialization', () => {
      bridge.initialize(mockIPC);
      expect(mockIPC.sent.some((m: any) => m.channel === '__preload:ready')).toBe(true);
    });

    it('can be initialized only once', () => {
      bridge.initialize(mockIPC);
      bridge.initialize(mockIPC);
      // No error thrown
    });
  });

  describe('capability checks', () => {
    beforeEach(() => {
      bridge.initialize(mockIPC);
      const manifestHandler = mockIPC.handlers.get('__preload:manifest');
      manifestHandler!(createTestManifest());
    });

    it('hasCapability returns true for allowed capabilities', () => {
      expect(bridge.hasCapability('canvas-2d' as any)).toBe(true);
      expect(bridge.hasCapability('dom-access' as any)).toBe(true);
    });

    it('hasCapability returns false for disallowed capabilities', () => {
      expect(bridge.hasCapability('node-fs' as any)).toBe(false);
    });

    it('hasSurface returns true for allowed surfaces', () => {
      expect(bridge.hasSurface('dom')).toBe(true);
      expect(bridge.hasSurface('fetch')).toBe(true);
    });

    it('hasSurface returns false for disallowed surfaces', () => {
      expect(bridge.hasSurface('process')).toBe(false);
    });

    it('getManifest returns the manifest', () => {
      expect(bridge.getManifest()?.processId).toBe('test-process');
    });
  });

  describe('bridge calls', () => {
    beforeEach(() => {
      bridge.initialize(mockIPC);
      const manifestHandler = mockIPC.handlers.get('__preload:manifest');
      manifestHandler!(createTestManifest());
    });

    it('forwards allowed channel calls via IPC', async () => {
      const callPromise = bridge.call('dom', 'getElementById', 'test-id');
      expect(mockIPC.sent.some((m: any) => m.channel === '__preload:call')).toBe(true);
    });

    it('rejects calls to disallowed channels', async () => {
      await expect(bridge.call('process', 'spawn-process')).rejects.toThrow('not allowed');
    });

    it('rejects calls before manifest received', async () => {
      const freshBridge = createPreloadBridge();
      const freshIPC = createMockIPC();
      freshBridge.initialize(freshIPC);
      await expect(freshBridge.call('dom', 'getElementById')).rejects.toThrow('not initialized');
    });

    it('resolves when response received', async () => {
      const callPromise = bridge.call('dom', 'getElementById', 'test');

      // Get the call ID from the sent message
      const sentMsg = mockIPC.sent.find((m: any) => m.channel === '__preload:call') as any;
      const callId = sentMsg?.message?.callId;

      // Simulate response
      const responseHandler = mockIPC.handlers.get('__preload:response');
      responseHandler!({ callId, success: true, result: { id: 'test' } });

      const result = await callPromise;
      expect(result).toEqual({ id: 'test' });
    });

    it('rejects when response has error', async () => {
      const callPromise = bridge.call('dom', 'getElementById', 'test');

      const sentMsg = mockIPC.sent.find((m: any) => m.channel === '__preload:call') as any;
      const callId = sentMsg?.message?.callId;

      const responseHandler = mockIPC.handlers.get('__preload:response');
      responseHandler!({ callId, success: false, error: 'Element not found' });

      await expect(callPromise).rejects.toThrow('Element not found');
    });
  });

  describe('bridge object', () => {
    beforeEach(() => {
      bridge.initialize(mockIPC);
      const manifestHandler = mockIPC.handlers.get('__preload:manifest');
      manifestHandler!(createTestManifest());
    });

    it('creates bridge object with allowed surfaces', () => {
      const obj = bridge.createBridgeObject();
      expect(obj.dom).toBeDefined();
      expect(obj.fetch).toBeDefined();
      expect(obj.storage).toBeDefined();
      expect(obj.websocket).toBeDefined();
      expect(obj.workers).toBeDefined();
    });

    it('includes capabilities info', () => {
      const obj = bridge.createBridgeObject();
      const caps = obj.capabilities as any;
      expect(caps.processId).toBe('test-process');
      expect(caps.privilegeLevel).toBe('web-content');
      expect(caps.hasCapability('canvas-2d')).toBe(true);
    });

    it('includes env', () => {
      const obj = bridge.createBridgeObject();
      expect((obj.env as any).NODE_ENV).toBe('production');
    });

    it('does not include disallowed surfaces', () => {
      const obj = bridge.createBridgeObject();
      // process should not be present
      expect(obj.process).toBeUndefined();
    });
  });

  describe('disposal', () => {
    it('clears pending calls and resets state', () => {
      bridge.initialize(mockIPC);
      const manifestHandler = mockIPC.handlers.get('__preload:manifest');
      manifestHandler!(createTestManifest());

      bridge.dispose();
      expect(bridge.isReady()).toBe(false);
      expect(bridge.getManifest()).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BRIDGE APIS
// ─────────────────────────────────────────────────────────────────────────────

describe('BRIDGE_APIS', () => {
  it('defines APIs for dom surface', () => {
    expect(BRIDGE_APIS.get('dom')).toContain('getElementById');
  });

  it('defines APIs for fetch surface', () => {
    expect(BRIDGE_APIS.get('fetch')).toContain('fetch');
  });

  it('defines APIs for storage surface', () => {
    expect(BRIDGE_APIS.get('storage')).toBeDefined();
  });

  it('defines APIs for eval surface', () => {
    expect(BRIDGE_APIS.get('eval')).toContain('eval');
  });
});
