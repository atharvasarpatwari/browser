/**
 * @file src/common/ipc/transport.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Abstract transport layer for IPC. A transport is responsible for moving
 * serialized bytes between processes. Implementations:
 *
 *   • InProcessTransport   — same JS context (for testing / monolith mode)
 *   • WorkerTransport      — Web Worker / Node worker_threads
 *   • ChildProcessTransport — Node child_process (fork/spawn)
 *   • SocketTransport      — TCP/Unix socket (for out-of-process)
 *
 * The IPC system depends only on ITransport, not on any concrete transport.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 *  Abstraction      ITransport is the only type the IPC channel system uses.
 *  Encapsulation    Transport internals (worker handles, sockets) are private.
 *  Single-Resp.     Transport only moves bytes — it doesn't interpret messages.
 *  Open / Closed    New transports are added by implementing ITransport.
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

/** A raw message ready for transport. */
type TransportData = string;

/** Handler for incoming data. */
type TransportHandler = (data: TransportData) => void;

/** Handler for transport errors. */
type TransportErrorHandler = (error: Error) => void;

/** Handler for transport close. */
type TransportCloseHandler = () => void;

/** Configuration for a transport. */
interface TransportConfig {
  /** Name/ID of the local endpoint. */
  readonly localId: string;
  /** Name/ID of the remote endpoint. */
  readonly remoteId: string;
  /** Maximum message size in bytes (0 = unlimited). */
  readonly maxMessageSize: number;
  /** Timeout in ms for connection establishment. */
  readonly connectTimeoutMs: number;
}

const DEFAULT_TRANSPORT_CONFIG: TransportConfig = {
  localId: 'local',
  remoteId: 'remote',
  maxMessageSize: 16 * 1024 * 1024, // 16MB
  connectTimeoutMs: 10_000,
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface ITransport extends IDisposable {
  /** Unique identifier for this transport instance. */
  readonly id: string;
  /** Whether the transport is currently connected. */
  readonly connected: boolean;
  /** The local endpoint ID. */
  readonly localId: string;
  /** The remote endpoint ID. */
  readonly remoteId: string;

  /** Connect to the remote endpoint. */
  connect(): Promise<void>;
  /** Disconnect from the remote endpoint. */
  disconnect(): Promise<void>;
  /** Send data to the remote endpoint. */
  send(data: TransportData): Promise<void>;
  /** Register a handler for incoming data. */
  onData(handler: TransportHandler): void;
  /** Register a handler for transport errors. */
  onError(handler: TransportErrorHandler): void;
  /** Register a handler for transport close. */
  onClose(handler: TransportCloseHandler): void;
  /** Remove a data handler. */
  offData(handler: TransportHandler): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-PROCESS TRANSPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * An in-process transport for testing and monolith mode.
 * Messages are delivered synchronously via direct function calls.
 */
class InProcessTransport implements ITransport {
  readonly id: string;
  private _connected = false;
  private _remote: InProcessTransport | null = null;
  private readonly _dataHandlers: TransportHandler[] = [];
  private readonly _errorHandlers: TransportErrorHandler[] = [];
  private readonly _closeHandlers: TransportCloseHandler[] = [];
  private readonly _config: TransportConfig;

  constructor(config?: Partial<TransportConfig>) {
    this._config = { ...DEFAULT_TRANSPORT_CONFIG, ...config };
    this.id = `inproc-${this._config.localId}-${this._config.remoteId}`;
  }

  get connected(): boolean { return this._connected; }
  get localId(): string { return this._config.localId; }
  get remoteId(): string { return this._config.remoteId; }

  /**
   * Bind this transport to a remote transport (for in-process use).
   * Both transports share a direct reference.
   */
  bind(remote: InProcessTransport): void {
    this._remote = remote;
    remote._remote = this;
  }

  async connect(): Promise<void> {
    if (this._connected) return;
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    this._connected = false;
    for (const h of this._closeHandlers) {
      try { h(); } catch { /* swallow */ }
    }
  }

  async send(data: TransportData): Promise<void> {
    if (!this._connected || !this._remote) {
      throw new Error('Transport not connected');
    }
    if (this._config.maxMessageSize > 0 &&
        Buffer.byteLength(data) > this._config.maxMessageSize) {
      throw new Error(`Message size exceeds limit: ${Buffer.byteLength(data)} > ${this._config.maxMessageSize}`);
    }
    // Deliver to remote's data handlers
    for (const h of this._remote._dataHandlers) {
      try { h(data); } catch (err) {
        for (const eh of this._remote._errorHandlers) {
          try { eh(err instanceof Error ? err : new Error(String(err))); } catch { /* swallow */ }
        }
      }
    }
  }

  onData(handler: TransportHandler): void {
    this._dataHandlers.push(handler);
  }

  onError(handler: TransportErrorHandler): void {
    this._errorHandlers.push(handler);
  }

  onClose(handler: TransportCloseHandler): void {
    this._closeHandlers.push(handler);
  }

  offData(handler: TransportHandler): void {
    const i = this._dataHandlers.indexOf(handler);
    if (i !== -1) this._dataHandlers.splice(i, 1);
  }

  dispose(): void {
    this._connected = false;
    this._dataHandlers.length = 0;
    this._errorHandlers.length = 0;
    this._closeHandlers.length = 0;
    this._remote = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT EMITTER TRANSPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A transport backed by Node.js EventEmitter (for child_process IPC channels).
 * Wraps a standard Node IPC channel (process.send / process.on('message')).
 */
class EventEmitterTransport implements ITransport {
  readonly id: string;
  private _connected = false;
  private readonly _emitter: { send(data: string): void; on(event: string, handler: (...args: any[]) => void): void; removeListener(event: string, handler: (...args: any[]) => void): void };
  private readonly _dataHandlers: TransportHandler[] = [];
  private readonly _errorHandlers: TransportErrorHandler[] = [];
  private readonly _closeHandlers: TransportCloseHandler[] = [];
  private readonly _config: TransportConfig;
  private readonly _onMessage = (data: unknown) => {
    if (typeof data === 'string') {
      for (const h of this._dataHandlers) {
        try { h(data); } catch (err) {
          for (const eh of this._errorHandlers) {
            try { eh(err instanceof Error ? err : new Error(String(err))); } catch { /* swallow */ }
          }
        }
      }
    }
  };

  constructor(
    emitter: { send(data: string): void; on(event: string, handler: (...args: any[]) => void): void; removeListener(event: string, handler: (...args: any[]) => void): void },
    config?: Partial<TransportConfig>,
  ) {
    this._emitter = emitter;
    this._config = { ...DEFAULT_TRANSPORT_CONFIG, ...config };
    this.id = `emitter-${this._config.localId}-${this._config.remoteId}`;
  }

  get connected(): boolean { return this._connected; }
  get localId(): string { return this._config.localId; }
  get remoteId(): string { return this._config.remoteId; }

  async connect(): Promise<void> {
    if (this._connected) return;
    this._emitter.on('message', this._onMessage);
    this._emitter.on('close', () => {
      this._connected = false;
      for (const h of this._closeHandlers) {
        try { h(); } catch { /* swallow */ }
      }
    });
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    this._connected = false;
    this._emitter.removeListener('message', this._onMessage);
    for (const h of this._closeHandlers) {
      try { h(); } catch { /* swallow */ }
    }
  }

  async send(data: TransportData): Promise<void> {
    if (!this._connected) throw new Error('Transport not connected');
    if (this._config.maxMessageSize > 0 &&
        Buffer.byteLength(data) > this._config.maxMessageSize) {
      throw new Error(`Message size exceeds limit`);
    }
    this._emitter.send(data);
  }

  onData(handler: TransportHandler): void { this._dataHandlers.push(handler); }
  onError(handler: TransportErrorHandler): void { this._errorHandlers.push(handler); }
  onClose(handler: TransportCloseHandler): void { this._closeHandlers.push(handler); }
  offData(handler: TransportHandler): void {
    const i = this._dataHandlers.indexOf(handler);
    if (i !== -1) this._dataHandlers.splice(i, 1);
  }

  dispose(): void {
    this._connected = false;
    this._dataHandlers.length = 0;
    this._errorHandlers.length = 0;
    this._closeHandlers.length = 0;
    this._emitter.removeListener('message', this._onMessage);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FACTORY
// ─────────────────────────────────────────────────────────────────────────────

function createInProcessPair(
  configA?: Partial<TransportConfig>,
  configB?: Partial<TransportConfig>,
): [InProcessTransport, InProcessTransport] {
  const a = new InProcessTransport({ ...configA, localId: configA?.localId ?? 'a', remoteId: configA?.remoteId ?? 'b' });
  const b = new InProcessTransport({ ...configB, localId: configB?.localId ?? 'b', remoteId: configB?.remoteId ?? 'a' });
  a.bind(b);
  return [a, b];
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  InProcessTransport,
  EventEmitterTransport,
  createInProcessPair,
  DEFAULT_TRANSPORT_CONFIG,
};

export type {
  ITransport,
  TransportConfig,
  TransportData,
  TransportHandler,
  TransportErrorHandler,
  TransportCloseHandler,
};
