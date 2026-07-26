import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ProcessIsolator,
  createProcessIsolator,
  DEFAULT_WEB_CONTENT_QUOTA,
  SANDBOXED_CONTENT_QUOTA,
  BROWSER_CHROME_QUOTA,
} from '../src/browser/security/process-isolator';
import type { IsolationViolationEvent, ResourceQuota } from '../src/browser/security/process-isolator';
import {
  NetworkProxy,
  createNetworkProxy,
  DEFAULT_PROXY_CONFIG,
} from '../src/browser/security/network-proxy';
import type { ProxiedRequest } from '../src/browser/security/network-proxy';

// ─────────────────────────────────────────────────────────────────────────────
// PROCESS ISOLATOR
// ─────────────────────────────────────────────────────────────────────────────

describe('ProcessIsolator', () => {
  let isolator: ProcessIsolator;

  beforeEach(() => {
    isolator = createProcessIsolator();
  });

  describe('process registration', () => {
    it('registers a process successfully', () => {
      const result = isolator.registerProcess('p1', 'https://example.com', 'web-content');
      expect(result.allowed).toBe(true);
    });

    it('rejects when max processes reached', () => {
      const smallIsolator = createProcessIsolator({ maxProcesses: 2 });
      smallIsolator.registerProcess('p1', 'https://a.com', 'web-content');
      smallIsolator.registerProcess('p2', 'https://b.com', 'web-content');
      const result = smallIsolator.registerProcess('p3', 'https://c.com', 'web-content');
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Maximum process limit');
    });

    it('assigns correct quota by privilege level', () => {
      isolator.registerProcess('p1', 'https://a.com', 'sandboxed-content');
      isolator.registerProcess('p2', 'https://b.com', 'web-content');
      isolator.registerProcess('p3', 'https://c.com', 'browser-chrome');

      expect(isolator.getProcessState('p1')?.quota.maxMemoryMB).toBe(SANDBOXED_CONTENT_QUOTA.maxMemoryMB);
      expect(isolator.getProcessState('p2')?.quota.maxMemoryMB).toBe(DEFAULT_WEB_CONTENT_QUOTA.maxMemoryMB);
      expect(isolator.getProcessState('p3')?.quota.maxMemoryMB).toBe(BROWSER_CHROME_QUOTA.maxMemoryMB);
    });
  });

  describe('process unregistration', () => {
    it('unregisters a process', () => {
      isolator.registerProcess('p1', 'https://example.com', 'web-content');
      isolator.unregisterProcess('p1');
      expect(isolator.getProcessState('p1')).toBeUndefined();
    });

    it('removes from origin tracking', () => {
      isolator.registerProcess('p1', 'https://example.com', 'web-content');
      isolator.unregisterProcess('p1');
      expect(isolator.getProcessesForOrigin('https://example.com')).toHaveLength(0);
    });
  });

  describe('resource checking', () => {
    it('allows when under quota', () => {
      isolator.registerProcess('p1', 'https://example.com', 'web-content');
      const result = isolator.checkResource('p1', 'memoryMB');
      expect(result.allowed).toBe(true);
      expect(result.current).toBe(0);
    });

    it('denies when over quota', () => {
      isolator.registerProcess('p1', 'https://example.com', 'sandboxed-content');
      isolator.updateUsage('p1', { memoryMB: 200 });
      const result = isolator.checkResource('p1', 'memoryMB');
      expect(result.allowed).toBe(false);
    });

    it('returns false for dead process', () => {
      const result = isolator.checkResource('nonexistent', 'memoryMB');
      expect(result.allowed).toBe(false);
    });
  });

  describe('usage tracking', () => {
    it('updates usage', () => {
      isolator.registerProcess('p1', 'https://example.com', 'web-content');
      const ok = isolator.updateUsage('p1', { memoryMB: 100, cpuTimeMs: 10 });
      expect(ok).toBe(true);

      const state = isolator.getProcessState('p1');
      expect(state?.usage.memoryMB).toBe(100);
      expect(state?.usage.cpuTimeMs).toBe(10);
    });

    it('returns false for dead process', () => {
      const ok = isolator.updateUsage('nonexistent', { memoryMB: 100 });
      expect(ok).toBe(false);
    });
  });

  describe('same-origin checks', () => {
    it('detects same-origin processes', () => {
      isolator.registerProcess('p1', 'https://example.com', 'web-content');
      isolator.registerProcess('p2', 'https://example.com', 'web-content');
      expect(isolator.areSameOrigin('p1', 'p2')).toBe(true);
    });

    it('detects cross-origin processes', () => {
      isolator.registerProcess('p1', 'https://a.com', 'web-content');
      isolator.registerProcess('p2', 'https://b.com', 'web-content');
      expect(isolator.areSameOrigin('p1', 'p2')).toBe(false);
    });
  });

  describe('origin tracking', () => {
    it('tracks processes by origin', () => {
      isolator.registerProcess('p1', 'https://example.com', 'web-content');
      isolator.registerProcess('p2', 'https://example.com', 'web-content');
      expect(isolator.getProcessesForOrigin('https://example.com')).toEqual(
        expect.arrayContaining(['p1', 'p2']),
      );
    });

    it('returns empty for unknown origin', () => {
      expect(isolator.getProcessesForOrigin('https://unknown.com')).toHaveLength(0);
    });
  });

  describe('error tracking', () => {
    it('records errors', () => {
      isolator.registerProcess('p1', 'https://example.com', 'web-content');
      isolator.recordError('p1', 'test error');
      expect(isolator.getProcessState('p1')?.errorCount).toBe(1);
    });

    it('emits crash event after 5 errors', () => {
      const events: IsolationViolationEvent[] = [];
      isolator.on(e => events.push(e));

      isolator.registerProcess('p1', 'https://example.com', 'web-content');
      for (let i = 0; i < 5; i++) {
        isolator.recordError('p1', `error ${i}`);
      }

      expect(events.some(e => e.kind === 'process-crash')).toBe(true);
      expect(isolator.getProcessState('p1')?.alive).toBe(false);
    });
  });

  describe('quota violations', () => {
    it('emits memory-exceeded event', () => {
      const events: IsolationViolationEvent[] = [];
      isolator.on(e => events.push(e));

      isolator.registerProcess('p1', 'https://example.com', 'sandboxed-content');
      isolator.updateUsage('p1', { memoryMB: 200 });

      expect(events.some(e => e.kind === 'memory-exceeded')).toBe(true);
    });

    it('emits cpu-exceeded event', () => {
      const events: IsolationViolationEvent[] = [];
      isolator.on(e => events.push(e));

      isolator.registerProcess('p1', 'https://example.com', 'sandboxed-content');
      isolator.updateUsage('p1', { cpuTimeMs: 50 });

      expect(events.some(e => e.kind === 'cpu-exceeded')).toBe(true);
    });

    it('emits timer-exceeded event', () => {
      const events: IsolationViolationEvent[] = [];
      isolator.on(e => events.push(e));

      isolator.registerProcess('p1', 'https://example.com', 'sandboxed-content');
      isolator.updateUsage('p1', { activeTimers: 500 });

      expect(events.some(e => e.kind === 'timer-exceeded')).toBe(true);
    });
  });

  describe('query methods', () => {
    it('getAliveProcessIds returns alive processes', () => {
      isolator.registerProcess('p1', 'https://a.com', 'web-content');
      isolator.registerProcess('p2', 'https://b.com', 'web-content');
      isolator.unregisterProcess('p1');
      expect(isolator.getAliveProcessIds()).toEqual(['p2']);
    });

    it('getActiveCount returns count', () => {
      isolator.registerProcess('p1', 'https://a.com', 'web-content');
      isolator.registerProcess('p2', 'https://b.com', 'web-content');
      expect(isolator.getActiveCount()).toBe(2);
    });
  });

  describe('disposal', () => {
    it('clears all state', () => {
      isolator.registerProcess('p1', 'https://example.com', 'web-content');
      isolator.dispose();
      expect(isolator.disposed).toBe(true);
      expect(isolator.getActiveCount()).toBe(0);
    });
  });

  describe('default quotas', () => {
    it('DEFAULT_WEB_CONTENT_QUOTA has 512MB', () => {
      expect(DEFAULT_WEB_CONTENT_QUOTA.maxMemoryMB).toBe(512);
    });

    it('SANDBOXED_CONTENT_QUOTA has 128MB', () => {
      expect(SANDBOXED_CONTENT_QUOTA.maxMemoryMB).toBe(128);
    });

    it('BROWSER_CHROME_QUOTA has 1024MB', () => {
      expect(BROWSER_CHROME_QUOTA.maxMemoryMB).toBe(1024);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NETWORK PROXY
// ─────────────────────────────────────────────────────────────────────────────

describe('NetworkProxy', () => {
  let proxy: NetworkProxy;

  beforeEach(() => {
    proxy = createNetworkProxy();
  });

  function makeRequest(overrides?: Partial<ProxiedRequest>): ProxiedRequest {
    return {
      requestId: 'req-1',
      processId: 'p1',
      origin: 'https://example.com',
      url: 'https://example.com/page',
      method: 'GET',
      headers: {},
      ...overrides,
    };
  }

  describe('request checking', () => {
    it('allows valid HTTPS requests', () => {
      const result = proxy.checkRequest(makeRequest());
      expect(result.allowed).toBe(true);
    });

    it('allows HTTP requests', () => {
      const result = proxy.checkRequest(makeRequest({ url: 'http://example.com/page' }));
      expect(result.allowed).toBe(true);
    });

    it('blocks file:// scheme', () => {
      const result = proxy.checkRequest(makeRequest({ url: 'file:///etc/passwd' }));
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('not allowed');
    });

    it('blocks localhost', () => {
      const result = proxy.checkRequest(makeRequest({ url: 'https://localhost/secret' }));
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('blocked');
    });

    it('blocks 127.0.0.1', () => {
      const result = proxy.checkRequest(makeRequest({ url: 'http://127.0.0.1/secret' }));
      expect(result.allowed).toBe(false);
    });

    it('blocks invalid URLs', () => {
      const result = proxy.checkRequest(makeRequest({ url: 'not-a-url' }));
      expect(result.allowed).toBe(false);
    });

    it('blocks when per-process limit exceeded', () => {
      for (let i = 0; i < 10; i++) {
        proxy.trackRequest(makeRequest({ requestId: `req-${i}` }));
      }
      const result = proxy.checkRequest(makeRequest({ requestId: 'req-overflow' }));
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('concurrent requests');
    });

    it('blocks when total limit exceeded', () => {
      // Use different processes to avoid per-process limit
      for (let i = 0; i < 100; i++) {
        proxy.trackRequest(makeRequest({
          requestId: `req-${i}`,
          processId: `p-${i % 10}`,
        }));
      }
      const result = proxy.checkRequest(makeRequest({
        requestId: 'req-overflow',
        processId: 'p-new',
      }));
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('Total concurrent');
    });
  });

  describe('request tracking', () => {
    it('tracks active requests', () => {
      proxy.trackRequest(makeRequest());
      expect(proxy.getTotalActiveCount()).toBe(1);
    });

    it('tracks per-process requests', () => {
      proxy.trackRequest(makeRequest());
      proxy.trackRequest(makeRequest({ requestId: 'req-2' }));
      expect(proxy.getActiveCountForProcess('p1')).toBe(2);
    });

    it('completes requests', () => {
      proxy.trackRequest(makeRequest());
      proxy.completeRequest('req-1');
      expect(proxy.getTotalActiveCount()).toBe(0);
    });

    it('returns false when tracking denied request', () => {
      const ok = proxy.trackRequest(makeRequest({ url: 'file:///etc/passwd' }));
      expect(ok).toBe(false);
      expect(proxy.getTotalActiveCount()).toBe(0);
    });
  });

  describe('cancel all for process', () => {
    it('cancels all requests for a process', () => {
      proxy.trackRequest(makeRequest({ requestId: 'r1', processId: 'p1' }));
      proxy.trackRequest(makeRequest({ requestId: 'r2', processId: 'p1' }));
      proxy.trackRequest(makeRequest({ requestId: 'r3', processId: 'p2' }));

      const cancelled = proxy.cancelAllForProcess('p1');
      expect(cancelled).toEqual(expect.arrayContaining(['r1', 'r2']));
      expect(proxy.getTotalActiveCount()).toBe(1); // p2's request remains
    });

    it('returns empty for unknown process', () => {
      expect(proxy.cancelAllForProcess('unknown')).toHaveLength(0);
    });
  });

  describe('event handling', () => {
    it('emits denied events', () => {
      const events: any[] = [];
      proxy.on(e => events.push(e));

      proxy.trackRequest(makeRequest({ url: 'file:///etc/passwd' }));
      expect(events.length).toBe(1);
      expect(events[0].kind).toBe('proxyDenied');
    });
  });

  describe('disposal', () => {
    it('clears all state', () => {
      proxy.trackRequest(makeRequest());
      proxy.dispose();
      expect(proxy.disposed).toBe(true);
      expect(proxy.getTotalActiveCount()).toBe(0);
    });
  });
});
