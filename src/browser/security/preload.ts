/**
 * @file src/browser/security/preload.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Preload script that runs in a sandboxed renderer process BEFORE any user
 * JavaScript. It bridges the gap between the restricted renderer and the main
 * process by providing a controlled `window.__nova` bridge.
 *
 * Pattern: Like Electron's preload / Chrome's extension content scripts.
 *
 * The preload script:
 *   1. Receives capability manifest from the main process at startup
 *   2. Creates a `window.__nova` bridge object exposing only allowed APIs
 *   3. All bridge calls are forwarded via IPC to the main process
 *   4. The sandboxed JS engine sees only the bridge — no direct Node.js access
 *
 * Does NOT:
 *   • Define capabilities (renderer-sandbox.ts's job)
 *   • Enforce permissions (sandbox-enforcer.ts's job)
 *   • Run user JavaScript (renderer-entry-sandboxed.ts's job)
 *
 * OOP PRINCIPLES
 * ───────────────
 *  Single-Resp.     Only creates the bridge and forwards calls.
 *  Interface Seg.   Exposes minimal surface to renderer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { PrivilegeLevel, ApiSurface } from './privilege-levels';
import type { RendererCapability } from './renderer-sandbox';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Capability manifest sent from main process to preload. */
interface PreloadCapabilityManifest {
  /** The process ID. */
  readonly processId: string;
  /** The privilege level. */
  readonly privilegeLevel: PrivilegeLevel;
  /** The origin this renderer is allowed to serve. */
  readonly origin: string;
  /** Allowed IPC channels. */
  readonly allowedChannels: readonly string[];
  /** Allowed API surfaces. */
  readonly allowedSurfaces: readonly ApiSurface[];
  /** Allowed renderer capabilities. */
  readonly capabilities: readonly RendererCapability[];
  /** Environment to expose (sanitized). */
  readonly env: Readonly<Record<string, string>>;
}

/** Bridge call forwarded to main process. */
interface BridgeCall {
  /** Unique call ID for request/response correlation. */
  readonly callId: string;
  /** The channel to use for the IPC call. */
  readonly channel: string;
  /** The method to invoke. */
  readonly method: string;
  /** Arguments (must be serializable). */
  readonly args: readonly unknown[];
}

/** Bridge response from main process. */
interface BridgeResponse {
  readonly callId: string;
  readonly success: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

/** IPC interface for the preload script. */
interface PreloadIPC {
  send(channel: string, message: unknown): void;
  on(channel: string, handler: (message: unknown) => void): void;
  once(channel: string, handler: (message: unknown) => void): void;
  removeListener(channel: string, handler: (message: unknown) => void): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// BRIDGE API DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

/** APIs that the bridge exposes per surface. */
const BRIDGE_APIS: ReadonlyMap<ApiSurface, readonly string[]> = new Map([
  ['dom', ['getElementById', 'querySelector', 'querySelectorAll', 'createElement',
           'createTextNode', 'addEventListener', 'removeEventListener']],
  ['fetch', ['fetch', 'requestAnimationFrame', 'cancelAnimationFrame']],
  ['storage', ['localStorage', 'sessionStorage']],
  ['indexed-db', ['indexedDB']],
  ['websocket', ['WebSocket']],
  ['workers', ['Worker']],
  ['eval', ['eval', 'Function', 'setTimeout', 'setInterval', 'clearTimeout',
            'clearInterval', 'queueMicrotask']],
  ['navigation-top', ['location', 'history']],
  ['notification', ['Notification']],
  ['clipboard-read', ['navigator.clipboard.read']],
  ['clipboard-write', ['navigator.clipboard.write']],
  ['geolocation', ['navigator.geolocation']],
]);

// ─────────────────────────────────────────────────────────────────────────────
// PRELOAD BRIDGE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class PreloadBridge {
  private manifest: PreloadCapabilityManifest | null = null;
  private ipc: PreloadIPC | null = null;
  private pendingCalls = new Map<string, {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  private callCounter = 0;
  private initialized = false;

  /**
   * Initialize the preload bridge with the IPC transport.
   */
  initialize(ipc: PreloadIPC): void {
    if (this.initialized) return;
    this.ipc = ipc;
    this.initialized = true;

    // Listen for capability manifest from main process
    ipc.on('__preload:manifest', (message: unknown) => {
      this.handleManifest(message as PreloadCapabilityManifest);
    });

    // Listen for bridge responses
    ipc.on('__preload:response', (message: unknown) => {
      this.handleResponse(message as BridgeResponse);
    });

    // Signal readiness
    ipc.send('__preload:ready', { type: 'ready' });
  }

  /**
   * Check if the bridge is initialized and has a manifest.
   */
  isReady(): boolean {
    return this.initialized && this.manifest !== null;
  }

  /**
   * Get the current capability manifest.
   */
  getManifest(): PreloadCapabilityManifest | null {
    return this.manifest;
  }

  /**
   * Check if a capability is allowed.
   */
  hasCapability(capability: RendererCapability): boolean {
    return this.manifest?.capabilities.includes(capability) ?? false;
  }

  /**
   * Check if an API surface is allowed.
   */
  hasSurface(surface: ApiSurface): boolean {
    return this.manifest?.allowedSurfaces.includes(surface) ?? false;
  }

  /**
   * Forward a bridge call to the main process.
   */
  call(channel: string, method: string, ...args: unknown[]): Promise<unknown> {
    if (!this.ipc || !this.manifest) {
      return Promise.reject(new Error('Bridge not initialized'));
    }

    // Check if the channel is allowed
    if (!this.manifest.allowedChannels.includes(channel)) {
      return Promise.reject(new Error(`Channel '${channel}' not allowed for this renderer`));
    }

    const callId = `bridge-${++this.callCounter}`;
    const call: BridgeCall = { callId, channel, method, args };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingCalls.delete(callId);
        reject(new Error(`Bridge call timed out: ${method}`));
      }, 30_000);

      this.pendingCalls.set(callId, { resolve, reject, timeout });

      this.ipc!.send('__preload:call', call);
    });
  }

  /**
   * Create the `window.__nova` bridge object.
   */
  createBridgeObject(): Record<string, unknown> {
    const self = this;
    const bridge: Record<string, unknown> = {};

    // DOM bridge
    if (this.hasSurface('dom')) {
      bridge.dom = {
        getElementById: (id: string) => self.call('dom', 'getElementById', id),
        querySelector: (selector: string) => self.call('dom', 'querySelector', selector),
        querySelectorAll: (selector: string) => self.call('dom', 'querySelectorAll', selector),
        createElement: (tag: string) => self.call('dom', 'createElement', tag),
        createTextNode: (text: string) => self.call('dom', 'createTextNode', text),
      };
    }

    // Fetch bridge
    if (this.hasSurface('fetch')) {
      bridge.fetch = {
        request: (url: string, init?: unknown) => self.call('fetch', 'fetch', url, init),
        requestAnimationFrame: (cb: string) => self.call('fetch', 'requestAnimationFrame', cb),
        cancelAnimationFrame: (id: number) => self.call('fetch', 'cancelAnimationFrame', id),
      };
    }

    // Storage bridge
    if (this.hasSurface('storage')) {
      bridge.storage = {
        getItem: (key: string) => self.call('storage', 'get-item', key),
        setItem: (key: string, value: string) => self.call('storage', 'set-item', key, value),
        removeItem: (key: string) => self.call('storage', 'remove-item', key),
        clear: () => self.call('storage', 'clear'),
      };
    }

    // WebSocket bridge
    if (this.hasSurface('websocket')) {
      bridge.websocket = {
        connect: (url: string, protocols?: string[]) =>
          self.call('websocket', 'ws-connect', url, protocols),
        send: (socketId: string, data: unknown) =>
          self.call('websocket', 'ws-send', socketId, data),
        close: (socketId: string, code?: number, reason?: string) =>
          self.call('websocket', 'ws-close', socketId, code, reason),
      };
    }

    // Workers bridge
    if (this.hasSurface('workers')) {
      bridge.workers = {
        create: (url: string) => self.call('workers', 'worker-create', url),
        postMessage: (workerId: string, message: unknown) =>
          self.call('workers', 'worker-post-message', workerId, message),
        terminate: (workerId: string) => self.call('workers', 'worker-terminate', workerId),
      };
    }

    // Capability info
    bridge.capabilities = {
      processId: this.manifest?.processId,
      privilegeLevel: this.manifest?.privilegeLevel,
      origin: this.manifest?.origin,
      hasCapability: (cap: RendererCapability) => self.hasCapability(cap),
      hasSurface: (surface: ApiSurface) => self.hasSurface(surface),
    };

    // Environment (sanitized subset)
    bridge.env = { ...this.manifest?.env };

    return bridge;
  }

  /**
   * Clean up pending calls.
   */
  dispose(): void {
    for (const [callId, pending] of this.pendingCalls) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Bridge disposed'));
    }
    this.pendingCalls.clear();
    this.initialized = false;
    this.manifest = null;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private handleManifest(manifest: PreloadCapabilityManifest): void {
    this.manifest = manifest;
  }

  handleResponse(response: BridgeResponse): void {
    const pending = this.pendingCalls.get(response.callId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pendingCalls.delete(response.callId);

    if (response.success) {
      pending.resolve(response.result);
    } else {
      pending.reject(new Error(response.error ?? 'Bridge call failed'));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────

function createPreloadBridge(): PreloadBridge {
  return new PreloadBridge();
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  PreloadBridge,
  createPreloadBridge,
  BRIDGE_APIS,
};

export type {
  PreloadCapabilityManifest,
  BridgeCall,
  BridgeResponse,
  PreloadIPC,
};
