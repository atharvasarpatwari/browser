/**
 * @file src/browser/security/network-proxy.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Proxies all network requests from sandboxed renderer processes through the
 * main process. Renderers cannot open sockets directly — every HTTP/HTTPS/
 * WebSocket request goes through this proxy.
 *
 * The proxy:
 *   1. Receives IPC requests from renderer processes
 *   2. Checks origin, CSP, and CORS via the main process middleware
 *   3. Executes the actual network request
 *   4. Returns the response (or an opaque response for CORS failures)
 *   5. Enforces resource quotas per process
 *
 * Does NOT:
 *   • Define CSP rules (csp-enforcement.ts's job)
 *   • Check capabilities (capability-gate.ts's job)
 *   • Manage processes (process-isolator.ts's job)
 *
 * OOP PRINCIPLES
 * ───────────────
 *  Single-Resp.     Only proxies and applies network security middleware.
 *  SRP              Delegates CSP/CORS checks to their respective services.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A proxied network request. */
interface ProxiedRequest {
  /** Unique request ID. */
  readonly requestId: string;
  /** The process ID making the request. */
  readonly processId: string;
  /** The origin of the requesting process. */
  readonly origin: string;
  /** The target URL. */
  readonly url: string;
  /** HTTP method. */
  readonly method: string;
  /** Request headers. */
  readonly headers: Readonly<Record<string, string>>;
  /** Request body (if any). */
  readonly body?: string | Uint8Array;
  /** Fetch mode (cors, no-cors, navigate, same-origin). */
  readonly mode?: string;
  /** Fetch credentials. */
  readonly credentials?: string;
}

/** A proxied network response. */
interface ProxiedResponse {
  /** The request ID. */
  readonly requestId: string;
  /** Whether the request was allowed. */
  readonly allowed: boolean;
  /** HTTP status code (if executed). */
  readonly status?: number;
  /** Status text. */
  readonly statusText?: string;
  /** Response headers. */
  readonly headers?: Readonly<Record<string, string>>;
  /** Response body. */
  readonly body?: string;
  /** Opaque flag (CORS failure). */
  readonly opaque?: boolean;
  /** Error message (if denied). */
  readonly error?: string;
  /** Time taken in ms. */
  readonly durationMs?: number;
}

/** A proxied WebSocket connection request. */
interface ProxiedWsConnect {
  readonly requestId: string;
  readonly processId: string;
  readonly origin: string;
  readonly url: string;
  readonly protocols?: string[];
}

/** A proxied WebSocket message. */
interface ProxiedWsMessage {
  readonly requestId: string;
  readonly socketId: string;
  readonly data: string | Uint8Array;
}

/** Configuration for the network proxy. */
interface NetworkProxyConfig {
  /** Maximum concurrent requests per process. */
  readonly maxConcurrentPerProcess: number;
  /** Maximum total concurrent requests. */
  readonly maxConcurrentTotal: number;
  /** Request timeout in ms. */
  readonly requestTimeoutMs: number;
  /** Whether to allow cross-origin requests. */
  readonly allowCors: boolean;
  /** Allowed schemes. */
  readonly allowedSchemes: readonly string[];
  /** Blocked hostnames. */
  readonly blockedHostnames: readonly string[];
}

/** Event emitted on proxy denial. */
interface ProxyDeniedEvent {
  readonly kind: 'proxyDenied';
  readonly requestId: string;
  readonly processId: string;
  readonly origin: string;
  readonly url: string;
  readonly reason: string;
  readonly timestamp: number;
}

type ProxyEventHandler = (event: ProxyDeniedEvent) => void;

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PROXY_CONFIG: NetworkProxyConfig = {
  maxConcurrentPerProcess: 10,
  maxConcurrentTotal: 100,
  requestTimeoutMs: 30_000,
  allowCors: true,
  allowedSchemes: ['https:', 'http:', 'ws:', 'wss:'],
  blockedHostnames: ['localhost', '127.0.0.1', '0.0.0.0', '::1'],
};

// ─────────────────────────────────────────────────────────────────────────────
// NETWORK PROXY
// ─────────────────────────────────────────────────────────────────────────────

class NetworkProxy implements IDisposable {
  private readonly config: NetworkProxyConfig;
  private readonly activeRequests = new Map<string, ProxiedRequest>();
  private readonly requestsByProcess = new Map<string, Set<string>>();
  private readonly eventHandlers = new Set<ProxyEventHandler>();
  private _disposed = false;

  constructor(config?: Partial<NetworkProxyConfig>) {
    this.config = { ...DEFAULT_PROXY_CONFIG, ...config };
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Check if a request is allowed before executing it.
   */
  checkRequest(request: ProxiedRequest): { allowed: boolean; reason?: string } {
    // 1. Check scheme
    try {
      const url = new URL(request.url);
      if (!this.config.allowedSchemes.includes(url.protocol)) {
        return { allowed: false, reason: `Scheme '${url.protocol}' not allowed` };
      }

      // 2. Check blocked hostnames
      if (this.config.blockedHostnames.includes(url.hostname)) {
        return { allowed: false, reason: `Hostname '${url.hostname}' is blocked` };
      }
    } catch {
      return { allowed: false, reason: 'Invalid URL' };
    }

    // 3. Check concurrent request limits
    const processRequests = this.requestsByProcess.get(request.processId);
    if (processRequests && processRequests.size >= this.config.maxConcurrentPerProcess) {
      return {
        allowed: false,
        reason: `Process ${request.processId} has ${processRequests.size} concurrent requests (max: ${this.config.maxConcurrentPerProcess})`,
      };
    }

    if (this.activeRequests.size >= this.config.maxConcurrentTotal) {
      return {
        allowed: false,
        reason: `Total concurrent requests ${this.activeRequests.size} exceeds limit ${this.config.maxConcurrentTotal}`,
      };
    }

    return { allowed: true };
  }

  /**
   * Register a request as active (before execution).
   */
  trackRequest(request: ProxiedRequest): boolean {
    const check = this.checkRequest(request);
    if (!check.allowed) {
      this.emitDenied(request, check.reason!);
      return false;
    }

    this.activeRequests.set(request.requestId, request);

    let processSet = this.requestsByProcess.get(request.processId);
    if (!processSet) {
      processSet = new Set();
      this.requestsByProcess.set(request.processId, processSet);
    }
    processSet.add(request.requestId);

    return true;
  }

  /**
   * Complete a tracked request.
   */
  completeRequest(requestId: string): void {
    const request = this.activeRequests.get(requestId);
    if (!request) return;

    this.activeRequests.delete(requestId);

    const processSet = this.requestsByProcess.get(request.processId);
    if (processSet) {
      processSet.delete(requestId);
      if (processSet.size === 0) {
        this.requestsByProcess.delete(request.processId);
      }
    }
  }

  /**
   * Get the number of active requests for a process.
   */
  getActiveCountForProcess(processId: string): number {
    return this.requestsByProcess.get(processId)?.size ?? 0;
  }

  /**
   * Get total active request count.
   */
  getTotalActiveCount(): number {
    return this.activeRequests.size;
  }

  /**
   * Cancel all requests for a process (on process exit/crash).
   */
  cancelAllForProcess(processId: string): string[] {
    const processRequests = this.requestsByProcess.get(processId);
    if (!processRequests) return [];

    const cancelled = Array.from(processRequests);
    for (const requestId of cancelled) {
      this.activeRequests.delete(requestId);
    }
    this.requestsByProcess.delete(processId);

    return cancelled;
  }

  /**
   * Subscribe to proxy events.
   */
  on(handler: ProxyEventHandler): void {
    this.eventHandlers.add(handler);
  }

  off(handler: ProxyEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  get disposed(): boolean {
    return this._disposed;
  }

  dispose(): void {
    this._disposed = true;
    this.activeRequests.clear();
    this.requestsByProcess.clear();
    this.eventHandlers.clear();
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private emitDenied(request: ProxiedRequest, reason: string): void {
    const event: ProxyDeniedEvent = {
      kind: 'proxyDenied',
      requestId: request.requestId,
      processId: request.processId,
      origin: request.origin,
      url: request.url,
      reason,
      timestamp: Date.now(),
    };

    for (const handler of this.eventHandlers) {
      try { handler(event); } catch { /* swallow */ }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────

function createNetworkProxy(config?: Partial<NetworkProxyConfig>): NetworkProxy {
  return new NetworkProxy(config);
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  NetworkProxy,
  createNetworkProxy,
  DEFAULT_PROXY_CONFIG,
};

export type {
  ProxiedRequest,
  ProxiedResponse,
  ProxiedWsConnect,
  ProxiedWsMessage,
  NetworkProxyConfig,
  ProxyDeniedEvent,
  ProxyEventHandler,
};
