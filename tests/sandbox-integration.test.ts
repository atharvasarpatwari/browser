import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SandboxManager } from '../src/browser/security/sandbox-manager';
import { PrivilegeLevels } from '../src/browser/security/privilege-levels';
import { SandboxEnforcer, createSandboxEnforcer } from '../src/browser/security/sandbox-enforcer';
import { CapabilityGate, createCapabilityGate } from '../src/common/ipc/capability-gate';
import { ProcessIsolator, createProcessIsolator } from '../src/browser/security/process-isolator';
import { NetworkProxy, createNetworkProxy } from '../src/browser/security/network-proxy';
import { PreloadBridge, createPreloadBridge } from '../src/browser/security/preload';
import {
  createSandboxedContentConfig,
  createBrowserChromeConfig,
  SANDBOXED_CONTENT_CAPABILITIES,
  WEB_CONTENT_CAPABILITIES,
  createSandboxForkOptions,
} from '../src/browser/security/renderer-sandbox';
import type { EnforcementContext } from '../src/browser/security/sandbox-enforcer';
import type { PrivilegeLevel } from '../src/browser/security/privilege-levels';
import type { ProxiedRequest } from '../src/browser/security/network-proxy';
import type { PreloadCapabilityManifest } from '../src/browser/security/preload';

// ─────────────────────────────────────────────────────────────────────────────
// END-TO-END SANDBOXING PIPELINE
// ─────────────────────────────────────────────────────────────────────────────

describe('Sandbox Integration — Full Pipeline', () => {
  let sandboxManager: SandboxManager;
  let privilegeLevels: PrivilegeLevels;
  let enforcer: SandboxEnforcer;
  let isolator: ProcessIsolator;
  let networkProxy: NetworkProxy;

  beforeEach(() => {
    sandboxManager = new SandboxManager({ enabled: true });
    privilegeLevels = new PrivilegeLevels();
    enforcer = createSandboxEnforcer(sandboxManager, { privilegeLevels });
    isolator = createProcessIsolator();
    networkProxy = createNetworkProxy();
  });

  it('registers process → enforces IPC → tracks isolation → proxies network', () => {
    // 1. Register a process
    const regResult = isolator.registerProcess('renderer-1', 'https://example.com', 'web-content');
    expect(regResult.allowed).toBe(true);

    // 2. Register with enforcer
    enforcer.registerProcess('renderer-1', 'web-content', 'https://example.com', 'tab-1');

    // 3. Enforce an IPC request
    const ctx: EnforcementContext = {
      processId: 'renderer-1',
      origin: 'https://example.com',
      tabId: 'tab-1',
      channel: 'dom',
      method: 'get-document',
      timestamp: Date.now(),
    };
    const enforcement = enforcer.enforce(ctx);
    expect(enforcement.allowed).toBe(true);

    // 4. Track a network request
    const req: ProxiedRequest = {
      requestId: 'net-1',
      processId: 'renderer-1',
      origin: 'https://example.com',
      url: 'https://api.example.com/data',
      method: 'GET',
      headers: {},
    };
    const trackResult = networkProxy.trackRequest(req);
    expect(trackResult).toBe(true);

    // 5. Check isolation
    expect(isolator.areSameOrigin('renderer-1', 'renderer-1')).toBe(true);
    expect(isolator.getProcessState('renderer-1')?.alive).toBe(true);
  });

  it('denies IPC for sandboxed-content accessing fetch', () => {
    isolator.registerProcess('sandbox-1', 'https://untrusted.com', 'sandboxed-content');
    enforcer.registerProcess('sandbox-1', 'sandboxed-content', 'https://untrusted.com', 'tab-2');

    const ctx: EnforcementContext = {
      processId: 'sandbox-1',
      origin: 'https://untrusted.com',
      tabId: 'tab-2',
      channel: 'fetch',
      method: 'fetch',
      timestamp: Date.now(),
    };

    const result = enforcer.enforce(ctx);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('denied');
  });

  it('allows IPC for web-content accessing dom', () => {
    isolator.registerProcess('renderer-2', 'https://safe.com', 'web-content');
    enforcer.registerProcess('renderer-2', 'web-content', 'https://safe.com', 'tab-3');

    const ctx: EnforcementContext = {
      processId: 'renderer-2',
      origin: 'https://safe.com',
      tabId: 'tab-3',
      channel: 'dom',
      method: 'get-document',
      timestamp: Date.now(),
    };

    const result = enforcer.enforce(ctx);
    expect(result.allowed).toBe(true);
  });

  it('blocks network request to localhost', () => {
    const req: ProxiedRequest = {
      requestId: 'net-2',
      processId: 'renderer-1',
      origin: 'https://example.com',
      url: 'http://localhost:3000/internal',
      method: 'GET',
      headers: {},
    };

    const result = networkProxy.checkRequest(req);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('blocked');
  });

  it('blocks file:// scheme in network proxy', () => {
    const req: ProxiedRequest = {
      requestId: 'net-3',
      processId: 'renderer-1',
      origin: 'https://example.com',
      url: 'file:///etc/passwd',
      method: 'GET',
      headers: {},
    };

    const result = networkProxy.checkRequest(req);
    expect(result.allowed).toBe(false);
  });

  it('enforces per-process network limits', () => {
    for (let i = 0; i < 10; i++) {
      networkProxy.trackRequest({
        requestId: `req-${i}`,
        processId: 'renderer-1',
        origin: 'https://example.com',
        url: `https://example.com/page-${i}`,
        method: 'GET',
        headers: {},
      });
    }

    const result = networkProxy.checkRequest({
      requestId: 'req-overflow',
      processId: 'renderer-1',
      origin: 'https://example.com',
      url: 'https://example.com/page-overflow',
      method: 'GET',
      headers: {},
    });
    expect(result.allowed).toBe(false);
  });

  it('process crash cancels network requests', () => {
    networkProxy.trackRequest({
      requestId: 'req-1',
      processId: 'crasher',
      origin: 'https://example.com',
      url: 'https://example.com/1',
      method: 'GET',
      headers: {},
    });
    networkProxy.trackRequest({
      requestId: 'req-2',
      processId: 'crasher',
      origin: 'https://example.com',
      url: 'https://example.com/2',
      method: 'GET',
      headers: {},
    });

    const cancelled = networkProxy.cancelAllForProcess('crasher');
    expect(cancelled).toHaveLength(2);
    expect(networkProxy.getActiveCountForProcess('crasher')).toBe(0);
  });

  it('process isolator emits quota violation events', () => {
    const events: any[] = [];
    isolator.on(e => events.push(e));

    isolator.registerProcess('heavy', 'https://example.com', 'sandboxed-content');
    isolator.updateUsage('heavy', { memoryMB: 200 });

    expect(events.some(e => e.kind === 'memory-exceeded')).toBe(true);
  });

  it('cross-origin processes are isolated', () => {
    isolator.registerProcess('p-a', 'https://a.com', 'web-content');
    isolator.registerProcess('p-b', 'https://b.com', 'web-content');

    expect(isolator.areSameOrigin('p-a', 'p-b')).toBe(false);
    expect(isolator.getProcessesForOrigin('https://a.com')).toEqual(['p-a']);
    expect(isolator.getProcessesForOrigin('https://b.com')).toEqual(['p-b']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRELOAD BRIDGE + CAPABILITY GATE INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Preload + CapabilityGate Integration', () => {
  it('preload receives manifest → gate checks align', () => {
    const gate = createCapabilityGate('web-content');
    const manifest: PreloadCapabilityManifest = {
      processId: 'test',
      privilegeLevel: 'web-content',
      origin: 'https://example.com',
      allowedChannels: ['dom', 'fetch', 'storage'],
      allowedSurfaces: ['dom', 'fetch', 'storage'],
      capabilities: ['canvas-2d'],
      env: {},
    };

    // Gate should allow channels in manifest
    for (const ch of manifest.allowedChannels) {
      const gateResult = gate.checkChannel(ch);
      expect(gateResult.allowed).toBe(true);
    }
  });

  it('gate denies channels not in manifest for sandboxed-content', () => {
    const gate = createCapabilityGate('sandboxed-content');
    const manifest: PreloadCapabilityManifest = {
      processId: 'test',
      privilegeLevel: 'sandboxed-content',
      origin: 'https://example.com',
      allowedChannels: ['dom'],
      allowedSurfaces: ['dom'],
      capabilities: [],
      env: {},
    };

    // Gate allows dom for sandboxed-content
    expect(gate.checkChannel('dom').allowed).toBe(true);

    // Gate denies fetch for sandboxed-content
    expect(gate.checkChannel('fetch').allowed).toBe(false);

    // Manifest only has dom — preload bridge would only expose dom
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RENDERER SANDBOX CONFIG INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────

describe('RendererSandboxConfig + PrivilegeLevels Integration', () => {
  it('sandboxed-content capabilities align with gate restrictions', () => {
    const caps = SANDBOXED_CONTENT_CAPABILITIES;
    const gate = createCapabilityGate('sandboxed-content');

    // Basic DOM should be allowed
    expect(gate.checkChannel('dom').allowed).toBe(true);

    // But sandboxed-content should not have fetch
    expect(caps).not.toContain('network' as any);
    expect(gate.checkChannel('fetch').allowed).toBe(false);
  });

  it('web-content capabilities align with gate', () => {
    const caps = WEB_CONTENT_CAPABILITIES;
    const gate = createCapabilityGate('web-content');

    // web-content should have dom, fetch, storage, etc.
    expect(gate.checkChannel('dom').allowed).toBe(true);
    expect(gate.checkChannel('fetch').allowed).toBe(true);
    expect(gate.checkChannel('storage').allowed).toBe(true);

    // But not process
    expect(caps).not.toContain('process' as any);
    expect(gate.checkChannel('process').allowed).toBe(false);
  });

  it('browser-chrome gets everything through gate', () => {
    const gate = createCapabilityGate('browser-chrome');
    expect(gate.checkChannel('process').allowed).toBe(true);
    expect(gate.checkChannel('security').allowed).toBe(true);
    expect(gate.checkChannel('devtools').allowed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENFORCER + ISOLATOR INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Enforcer + Isolator Integration', () => {
  it('denial from enforcer does not affect other processes', () => {
    const sm = new SandboxManager({ enabled: true });
    const pl = new PrivilegeLevels();
    const enforcer = createSandboxEnforcer(sm, { privilegeLevels: pl });
    const isolator = createProcessIsolator();

    isolator.registerProcess('p1', 'https://a.com', 'sandboxed-content');
    isolator.registerProcess('p2', 'https://b.com', 'web-content');
    enforcer.registerProcess('p1', 'sandboxed-content', 'https://a.com', 'tab-1');
    enforcer.registerProcess('p2', 'web-content', 'https://b.com', 'tab-2');

    // p1 denied fetch
    const r1 = enforcer.enforce({
      processId: 'p1', origin: 'https://a.com', tabId: 'tab-1',
      channel: 'fetch', timestamp: Date.now(),
    });
    expect(r1.allowed).toBe(false);

    // p2 allowed fetch
    const r2 = enforcer.enforce({
      processId: 'p2', origin: 'https://b.com', tabId: 'tab-2',
      channel: 'fetch', timestamp: Date.now(),
    });
    expect(r2.allowed).toBe(true);

    // Both processes still alive in isolator
    expect(isolator.getProcessState('p1')?.alive).toBe(true);
    expect(isolator.getProcessState('p2')?.alive).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENVIRONMENT SCRUBBING INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────

describe('Environment Scrubbing Integration', () => {
  it('sandbox config creates fork options that scrub env', () => {
    const config = createSandboxedContentConfig('https://example.com', 'tab-1');
    const options = createSandboxForkOptions('test-process', config);

    // Should not have sensitive env vars
    expect(options.env).toBeDefined();
    const env = options.env as Record<string, string>;
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.NODE_ENV).toBeDefined();
  });

  it('sandbox config creates restricted execArgv', () => {
    const config = createSandboxedContentConfig('https://example.com', 'tab-1');
    const options = createSandboxForkOptions('test-process', config);

    // Should have memory limit flags
    expect(options.execArgv.some(f => f.includes('--max-old-space-size'))).toBe(true);
  });

  it('sandbox config has restricted capabilities for sandboxed tier', () => {
    const config = createSandboxedContentConfig('https://example.com', 'tab-1');
    const caps = config.capabilities;

    expect(caps).toContain('dom');
    expect(caps).toContain('canvas-2d');
    expect(caps).toContain('javascript');
    expect(caps).not.toContain('fetch-proxy');
    expect(caps).not.toContain('cross-origin-isolation');
  });

  it('sandbox config has more capabilities for browser-chrome tier', () => {
    const config = createBrowserChromeConfig();
    const caps = config.capabilities;

    expect(caps).toContain('fetch-proxy');
    expect(caps).toContain('cross-origin-isolation');
    expect(caps).toContain('canvas-2d');
    expect(caps).toContain('dom');
  });
});
