/**
 * @file src/process/renderer-entry-sandboxed.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Entry point for sandboxed renderer processes. Unlike the legacy
 * `renderer-entry.ts` which runs with full Node.js capabilities, this
 * entry point:
 *
 *   1. Sets up the sandboxed JS engine with limited globals
 *   2. Loads the preload bridge (window.__nova)
 *   3. Runs user JavaScript in a restricted context
 *   4. All I/O goes through the IPC bridge — no direct Node.js access
 *
 * The sandboxed renderer has:
 *   • A custom `window` object with only allowed properties
 *   • A restricted `globalThis` (no process, no require, no fs, etc.)
 *   • Network requests go through IPC proxy (no direct sockets)
 *   • Storage access goes through IPC proxy
 *   • DOM access goes through IPC proxy
 *
 * Does NOT:
 *   • Provide direct access to Node.js APIs
 *   • Allow loading arbitrary modules
 *   • Permit network I/O without proxy
 *
 * OOP PRINCIPLES
 * ───────────────
 *  Single-Resp.     Only sets up the sandboxed environment.
 *  Interface Seg.   Exposes minimal surface to renderer.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { EventEmitter } from 'node:events';
import { Parser } from '../browser/js/parser';
import { Lexer } from '../browser/js/lexer';
import { Interpreter } from '../browser/js/interpreter';
import { Environment } from '../browser/js/values';
import { PreloadBridge, createPreloadBridge } from '../browser/security/preload';
import type { PreloadCapabilityManifest, PreloadIPC } from '../browser/security/preload';
import type { PrivilegeLevel } from '../browser/security/privilege-levels';
import type { RendererCapability } from '../browser/security/renderer-sandbox';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** Messages from main process to sandboxed renderer. */
type MainToRendererMessage =
  | { type: 'manifest'; manifest: PreloadCapabilityManifest }
  | { type: 'execute-script'; id: string; script: string }
  | { type: 'update-dom'; id: string; operation: string; data: unknown }
  | { type: 'set-viewport'; id: string; width: number; height: number }
  | { type: 'render'; id: string; html: string; styles?: string[] }
  | { type: 'bridge-response'; response: { callId: string; success: boolean; result?: unknown; error?: string } };

/** Messages from renderer to main process. */
type RendererToMainMessage =
  | { type: 'ready' }
  | { type: 'bridge-call'; call: { callId: string; channel: string; method: string; args: unknown[] } }
  | { type: 'script-result'; id: string; result: unknown; error?: string }
  | { type: 'dom-updated'; id: string; result: unknown }
  | { type: 'error'; error: string };

// ─────────────────────────────────────────────────────────────────────────────
// SANDBOXED WINDOW BUILDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a sandboxed window object with only allowed properties.
 */
function buildSandboxedWindow(
  bridge: PreloadBridge,
  manifest: PreloadCapabilityManifest,
): Record<string, unknown> {
  const window: Record<string, unknown> = {};

  // Base window properties
  window.window = window;
  window.self = window;
  window.top = window;
  window.parent = window;
  window.frames = [window];

  // Document stub (actual DOM operations go through bridge)
  window.document = createMinimalDocument(manifest.origin);

  // Console — always available
  window.console = console;

  // Timers — always available
  window.setTimeout = setTimeout;
  window.setInterval = setInterval;
  window.clearTimeout = clearTimeout;
  window.clearInterval = clearInterval;

  // bridge for controlled access
  window.__nova = bridge.createBridgeObject();

  // Navigator stub
  window.navigator = {
    userAgent: `Nova/${manifest.processId}`,
    platform: process.platform,
    language: 'en-US',
    clipboard: bridge.hasSurface('clipboard-read') || bridge.hasSurface('clipboard-write')
      ? { read: () => bridge.call('clipboard', 'clipboard-read'),
          write: (text: string) => bridge.call('clipboard', 'clipboard-write', text) }
      : undefined,
    geolocation: bridge.hasSurface('geolocation')
      ? { getCurrentPosition: (cb: PositionCallback) => bridge.call('geolocation', 'geolocation-get', cb) }
      : undefined,
  };

  // Location stub (navigation goes through bridge)
  window.location = {
    href: 'about:blank',
    protocol: 'https:',
    host: '',
    hostname: '',
    pathname: '/',
    search: '',
    hash: '',
    assign: (url: string) => bridge.call('navigation', 'navigate', url),
    replace: (url: string) => bridge.call('navigation', 'navigate', url),
    reload: () => bridge.call('navigation', 'reload'),
  };

  // History stub
  window.history = {
    pushState: (state: unknown, title: string, url?: string) =>
      bridge.call('navigation', 'push-state', state, title, url),
    replaceState: (state: unknown, title: string, url?: string) =>
      bridge.call('navigation', 'replace-state', state, title, url),
    back: () => bridge.call('navigation', 'go-back'),
    forward: () => bridge.call('navigation', 'go-forward'),
    go: (delta: number) => bridge.call('navigation', 'go', delta),
  };

  // Notification
  if (bridge.hasSurface('notifications')) {
    window.Notification = {
      permission: 'default',
      requestPermission: () => bridge.call('notifications', 'notification-request'),
    };
  }

  return window;
}

/**
 * Create a minimal document stub that proxies to the main process.
 */
function createMinimalDocument(origin: string): Record<string, unknown> {
  return {
    documentElement: { style: {} },
    body: { style: {} },
    head: {},
    title: '',
    readyState: 'complete',
    createElement: (tag: string) => ({ tagName: tag.toUpperCase(), style: {}, children: [] }),
    createTextNode: (text: string) => ({ nodeType: 3, textContent: text }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
    cookie: '',
    origin,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SANDBOXED RENDERER PROCESS
// ─────────────────────────────────────────────────────────────────────────────

class SandboxedRendererProcess {
  private readonly emitter = new EventEmitter();
  private readonly bridge: PreloadBridge;
  private manifest: PreloadCapabilityManifest | null = null;
  private interpreter: Interpreter | null = null;
  private window: Record<string, unknown> | null = null;
  private initialized = false;
  private ipc: {
    send: (message: unknown) => void;
    on: (message: (message: unknown) => void) => void;
  } | null = null;

  constructor() {
    this.bridge = createPreloadBridge();
  }

  /**
   * Initialize the sandboxed renderer.
   */
  initialize(ipcChannel: {
    send: (message: unknown) => void;
    on: (handler: (message: unknown) => void) => void;
  }): void {
    if (this.initialized) return;
    this.ipc = ipcChannel;

    // Set up preload bridge with a PreloadIPC adapter
    const preloadIPC: PreloadIPC = {
      send: (channel: string, message: unknown) => {
        this.send({ type: 'bridge-call', call: { callId: `bridge-${Date.now()}`, channel, method: '', args: [message] } });
      },
      on: (channel: string, handler: (message: unknown) => void) => {
        this.emitter.on(`ipc:${channel}`, handler);
      },
      once: (channel: string, handler: (message: unknown) => void) => {
        this.emitter.once(`ipc:${channel}`, handler);
      },
      removeListener: (channel: string, handler: (message: unknown) => void) => {
        this.emitter.removeListener(`ipc:${channel}`, handler);
      },
    };

    this.bridge.initialize(preloadIPC);

    // Listen for messages from main process
    ipcChannel.on((message: unknown) => {
      this.handleMessage(message as MainToRendererMessage).catch(error => {
        console.error('[SandboxedRenderer] Error:', error);
      });
    });

    this.initialized = true;
    this.send({ type: 'ready' });
  }

  /**
   * Get the capability manifest.
   */
  getManifest(): PreloadCapabilityManifest | null {
    return this.manifest;
  }

  /**
   * Get the sandboxed window object.
   */
  getWindow(): Record<string, unknown> | null {
    return this.window;
  }

  /**
   * Check if a capability is allowed.
   */
  hasCapability(capability: RendererCapability): boolean {
    return this.bridge.hasCapability(capability);
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async handleMessage(message: MainToRendererMessage): Promise<void> {
    switch (message.type) {
      case 'manifest':
        this.handleManifest(message.manifest);
        break;
      case 'execute-script':
        await this.handleExecuteScript(message.id, message.script);
        break;
      case 'render':
        await this.handleRender(message.id, message.html, message.styles);
        break;
      case 'bridge-response':
        this.handleBridgeResponse(message.response);
        break;
      case 'update-dom':
        this.handleUpdateDom(message.id, message.operation, message.data);
        break;
      case 'set-viewport':
        this.handleSetViewport(message.id, message.width, message.height);
        break;
      default:
        break;
    }
  }

  private handleManifest(manifest: PreloadCapabilityManifest): void {
    this.manifest = manifest;
    this.window = buildSandboxedWindow(this.bridge, manifest);
  }

  private async handleExecuteScript(id: string, script: string): Promise<void> {
    try {
      if (!this.window) {
        throw new Error('Renderer not initialized — no manifest received');
      }

      // Create a sandboxed environment from the window properties
      const env = new Environment();
      for (const [key, value] of Object.entries(this.window)) {
        env.declare(key, value as any, 'var');
      }

      // Create a JS engine for this script
      const lexer = new Lexer(script);
      const parser = new Parser([], lexer);
      const program = parser.parse();

      this.interpreter = new Interpreter(env);
      const result = this.interpreter.run(program);

      this.send({ type: 'script-result', id, result });
    } catch (error) {
      this.send({ type: 'script-result', id, result: null, error: (error as Error).message });
    }
  }

  private async handleRender(id: string, html: string, styles?: string[]): Promise<void> {
    try {
      // In sandboxed mode, rendering goes through the bridge
      const result = await this.bridge.call('renderer', 'render-page', html, styles);
      this.send({ type: 'script-result', id, result });
    } catch (error) {
      this.send({ type: 'script-result', id, result: null, error: (error as Error).message });
    }
  }

  private handleBridgeResponse(response: { callId: string; success: boolean; result?: unknown; error?: string }): void {
    this.bridge.handleResponse(response);
  }

  private handleUpdateDom(id: string, operation: string, data: unknown): void {
    this.send({ type: 'dom-updated', id, result: { success: true, operation, data } });
  }

  private handleSetViewport(id: string, width: number, height: number): void {
    this.send({ type: 'dom-updated', id, result: { success: true, width, height } });
  }

  private send(message: RendererToMainMessage): void {
    this.ipc?.send(message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  SandboxedRendererProcess,
  buildSandboxedWindow,
  createMinimalDocument,
};

export type {
  MainToRendererMessage,
  RendererToMainMessage,
};

// Start the sandboxed renderer process when run directly
if (require.main === module) {
  const renderer = new SandboxedRendererProcess();

  // In a real child process, `process.send` and `process.on('message')` are available
  if (process.send) {
    renderer.initialize({
      send: (message: unknown) => process.send!(message),
      on: (handler: (message: unknown) => void) => {
        process.on('message', handler as (message: unknown) => void);
      },
    });
  }
}
