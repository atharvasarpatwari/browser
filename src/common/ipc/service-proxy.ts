/**
 * @file src/common/ipc/service-proxy.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Enable remote method invocation over IPC channels. A ServiceProxy wraps a
 * local interface and transparently forwards method calls to a remote process
 * via IPC request-response messages. The caller uses the proxy as if it were
 * a local object — method calls become IPC requests, return values become
 * IPC responses.
 *
 * This is the key integration point between the DI container and IPC:
 * register a ServiceProxy in the container instead of the real implementation,
 * and all DI consumers get transparent remote access.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 *  Abstraction      IServiceProxy hides the IPC transport from consumers.
 *  Encapsulation    Channel, serializer, and pending calls are private.
 *  Single-Resp.     Proxy only forwards calls — it doesn't implement business logic.
 *  Open / Closed    New proxy patterns (event subscription, streaming) are added
 *                   via composition, not by modifying the base class.
 */

import type { IDisposable } from '../../app/dependency-container';
import type { IChannel } from './channel';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A method call to be serialized and sent over IPC. */
interface MethodCall {
  /** The method name. */
  readonly method: string;
  /** The arguments. */
  readonly args: unknown[];
}

/** The result of a remote method call. */
interface MethodResult<T = unknown> {
  /** Whether the call succeeded. */
  readonly success: boolean;
  /** The return value (only on success). */
  readonly value?: T;
  /** The error message (only on failure). */
  readonly error?: string;
}

/** Configuration for a service proxy. */
interface ServiceProxyConfig {
  /** The service name (for logging). */
  readonly serviceName: string;
  /** The IPC channel name to use for this service. */
  readonly channelName: string;
  /** Timeout in ms for each method call. */
  readonly timeoutMs: number;
  /** Whether to retry failed calls. */
  readonly retryOnFailure: boolean;
  /** Maximum retry attempts. */
  readonly maxRetries: number;
}

const DEFAULT_PROXY_CONFIG: ServiceProxyConfig = {
  serviceName: 'unknown',
  channelName: 'service',
  timeoutMs: 30_000,
  retryOnFailure: false,
  maxRetries: 1,
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IServiceProxy extends IDisposable {
  /** The service name. */
  readonly serviceName: string;
  /** Whether the proxy is connected to a remote endpoint. */
  readonly connected: boolean;
  /** Invoke a remote method. */
  invoke<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  /** Check if the remote service is available (ping). */
  ping(): Promise<boolean>;
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class ServiceProxy implements IServiceProxy {
  readonly serviceName: string;
  private _connected = false;
  private readonly _config: ServiceProxyConfig;
  private readonly _channel: IChannel;
  private readonly _callHistory: Array<{ method: string; args: unknown[]; timestamp: number; durationMs: number; success: boolean }> = [];
  private static readonly MAX_HISTORY = 100;

  constructor(channel: IChannel, config?: Partial<ServiceProxyConfig>) {
    this._config = { ...DEFAULT_PROXY_CONFIG, ...config };
    this.serviceName = this._config.serviceName;
    this._channel = channel;
    this._connected = true;
  }

  get connected(): boolean { return this._connected; }

  async invoke<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    if (!this._connected) {
      throw new Error(`ServiceProxy "${this.serviceName}" is not connected`);
    }

    const call: MethodCall = { method, args };
    const startTime = Date.now();
    let lastError: Error | null = null;

    const maxAttempts = this._config.retryOnFailure ? this._config.maxRetries + 1 : 1;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const result = await this._channel.request<MethodCall, MethodResult<T>>(
          call,
          this._config.timeoutMs,
        );

        const durationMs = Date.now() - startTime;
        this._recordCall(method, args, durationMs, true);

        if (result.success) {
          return result.value as T;
        } else {
          throw new Error(result.error ?? 'Remote method failed');
        }
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < maxAttempts - 1) {
          // Exponential backoff before retry
          const delay = Math.min(100 * Math.pow(2, attempt), 5_000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    const durationMs = Date.now() - startTime;
    this._recordCall(method, args, durationMs, false);
    throw lastError!;
  }

  async ping(): Promise<boolean> {
    try {
      const result = await this._channel.request(
        { method: '__ping__', args: [] },
        5_000,
      );
      return (result as MethodResult).success === true || result === true;
    } catch {
      return false;
    }
  }

  /** Get the call history for diagnostics. */
  getCallHistory(): readonly ServiceProxy['_callHistory'][number][] {
    return [...this._callHistory];
  }

  /** Get the proxy configuration. */
  getConfig(): ServiceProxyConfig {
    return { ...this._config };
  }

  dispose(): void {
    this._connected = false;
    this._callHistory.length = 0;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _recordCall(method: string, args: unknown[], durationMs: number, success: boolean): void {
    this._callHistory.push({ method, args, timestamp: Date.now(), durationMs, success });
    if (this._callHistory.length > ServiceProxy.MAX_HISTORY) {
      this._callHistory.splice(0, this._callHistory.length - ServiceProxy.MAX_HISTORY);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVICE STUB
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A service stub runs on the remote (server) side. It receives IPC requests,
 * dispatches them to the actual implementation, and sends back responses.
 *
 * Pair with ServiceProxy on the client side.
 */
interface IServiceStub extends IDisposable {
  /** The service name. */
  readonly serviceName: string;
  /** Whether the stub is active. */
  readonly active: boolean;
  /** Register the actual implementation. */
  setImplementation(impl: Record<string, (...args: unknown[]) => unknown | Promise<unknown>>): void;
  /** Activate the stub (start handling requests). */
  activate(): void;
  /** Deactivate the stub. */
  deactivate(): void;
}

class ServiceStub implements IServiceStub {
  readonly serviceName: string;
  private _active = false;
  private _impl: Record<string, (...args: unknown[]) => unknown | Promise<unknown>> = {};
  private readonly _channel: IChannel;

  constructor(channel: IChannel, serviceName: string) {
    this._channel = channel;
    this.serviceName = serviceName;
  }

  get active(): boolean { return this._active; }

  setImplementation(impl: Record<string, (...args: unknown[]) => unknown | Promise<unknown>>): void {
    this._impl = impl;
  }

  activate(): void {
    if (this._active) return;
    this._active = true;

    this._channel.onRequest(async (payload: unknown) => {
      const call = payload as MethodCall;

      // Handle ping
      if (call.method === '__ping__') {
        return { success: true };
      }

      const method = this._impl[call.method];
      if (!method) {
        return {
          success: false,
          error: `Method "${call.method}" not found on service "${this.serviceName}"`,
        } as MethodResult;
      }

      try {
        const result = await method(...call.args);
        return {
          success: true,
          value: result,
        } as MethodResult;
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        } as MethodResult;
      }
    });

    this._channel.activate();
  }

  deactivate(): void {
    if (!this._active) return;
    this._active = false;
    this._channel.deactivate();
  }

  dispose(): void {
    this.deactivate();
    this._impl = {};
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROXY FACTORY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a typed service proxy that returns a Proxy object matching
 * the shape of T. Method calls on the returned object are transparently
 * forwarded via IPC.
 *
 * Usage:
 *   interface MyService {
 *     getData(id: string): Promise<Data>;
 *     saveData(data: Data): Promise<void>;
 *   }
 *   const proxy = createTypedProxy<MyService>(channel, 'my-service');
 *   const data = await proxy.getData('123'); // sends IPC request
 */
function createTypedProxy<T extends Record<string, (...args: any[]) => any>>(
  channel: IChannel,
  serviceName: string,
  config?: Partial<ServiceProxyConfig>,
): T & IServiceProxy {
  const proxy = new ServiceProxy(channel, { serviceName, ...config });

  return new Proxy(proxy as any, {
    get(target: ServiceProxy, prop: string | symbol) {
      if (prop in target) {
        return (target as any)[prop];
      }
      if (typeof prop === 'string') {
        return (...args: unknown[]) => target.invoke(prop, ...args);
      }
      return undefined;
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  ServiceProxy,
  ServiceStub,
  createTypedProxy,
  DEFAULT_PROXY_CONFIG,
};

export type {
  IServiceProxy,
  IServiceStub,
  ServiceProxyConfig,
  MethodCall,
  MethodResult,
};
