/**
 * @file src/common/ipc/worker-transport.ts
 *
 * Transport implementation using Node.js worker_threads.
 * Wraps the parentPort / worker communication into ITransport.
 */

import type { IDisposable } from '../../app/dependency-container';
import type {
  ITransport,
  TransportConfig,
  TransportData,
  TransportHandler,
  TransportErrorHandler,
  TransportCloseHandler,
} from './transport';
import { DEFAULT_TRANSPORT_CONFIG } from './transport';

let _workerSeq = 0;

/**
 * Parent-side transport: wraps a Worker instance.
 * Uses parentPort.on('message') / parentPort.postMessage().
 */
export class WorkerParentTransport implements ITransport {
  readonly id: string;
  private _connected = false;
  private _bufferedAmount = 0;
  private readonly _worker: { postMessage(data: unknown): void; on(event: string, handler: (...args: any[]) => void): void; removeListener(event: string, handler: (...args: any[]) => void): void };
  private readonly _dataHandlers: TransportHandler[] = [];
  private readonly _errorHandlers: TransportErrorHandler[] = [];
  private readonly _closeHandlers: TransportCloseHandler[] = [];
  private readonly _drainHandlers: (() => void)[] = [];
  private readonly _config: TransportConfig;

  constructor(
    worker: { postMessage(data: unknown): void; on(event: string, handler: (...args: any[]) => void): void; removeListener(event: string, handler: (...args: any[]) => void): void },
    config?: Partial<TransportConfig>,
  ) {
    this._worker = worker;
    this._config = { ...DEFAULT_TRANSPORT_CONFIG, ...config };
    this.id = `worker-parent-${this._config.localId}-${(++_workerSeq).toString(36)}`;
  }

  get connected(): boolean { return this._connected; }
  get localId(): string { return this._config.localId; }
  get remoteId(): string { return this._config.remoteId; }
  get bufferedAmount(): number { return this._bufferedAmount; }

  async connect(): Promise<void> {
    if (this._connected) return;
    this._worker.on('message', this._onMessage);
    this._worker.on('error', this._onError);
    this._worker.on('exit', this._onExit);
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    this._connected = false;
    this._worker.removeListener('message', this._onMessage);
    this._worker.removeListener('error', this._onError);
    this._worker.removeListener('exit', this._onExit);
    for (const h of this._closeHandlers) {
      try { h(); } catch { /* swallow */ }
    }
  }

  async send(data: TransportData): Promise<void> {
    if (!this._connected) throw new Error('Worker transport not connected');
    if (this._config.maxMessageSize > 0 &&
        new TextEncoder().encode(data).byteLength > this._config.maxMessageSize) {
      throw new Error('Message size exceeds limit');
    }
    this._bufferedAmount += data.length;
    try {
      this._worker.postMessage(data);
    } finally {
      this._bufferedAmount = Math.max(0, this._bufferedAmount - data.length);
      if (this._config.lowWaterMark > 0 && this._bufferedAmount <= this._config.lowWaterMark) {
        for (const h of this._drainHandlers) {
          try { h(); } catch { /* swallow */ }
        }
      }
    }
  }

  onData(handler: TransportHandler): void { this._dataHandlers.push(handler); }
  onError(handler: TransportErrorHandler): void { this._errorHandlers.push(handler); }
  onClose(handler: TransportCloseHandler): void { this._closeHandlers.push(handler); }
  onDrain(handler: () => void): void { this._drainHandlers.push(handler); }
  offData(handler: TransportHandler): void {
    const i = this._dataHandlers.indexOf(handler);
    if (i !== -1) this._dataHandlers.splice(i, 1);
  }
  offDrain(handler: () => void): void {
    const i = this._drainHandlers.indexOf(handler);
    if (i !== -1) this._drainHandlers.splice(i, 1);
  }

  dispose(): void {
    this._connected = false;
    this._dataHandlers.length = 0;
    this._errorHandlers.length = 0;
    this._closeHandlers.length = 0;
    this._drainHandlers.length = 0;
    this._worker.removeListener('message', this._onMessage);
    this._worker.removeListener('error', this._onError);
    this._worker.removeListener('exit', this._onExit);
  }

  private _onMessage = (data: unknown) => {
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

  private _onError = (err: Error) => {
    for (const h of this._errorHandlers) {
      try { h(err); } catch { /* swallow */ }
    }
  };

  private _onExit = () => {
    this._connected = false;
    for (const h of this._closeHandlers) {
      try { h(); } catch { /* swallow */ }
    }
  };
}

/**
 * Worker-side transport: uses the global `self` (or worker_threads parentPort).
 * Reads WORKER_PROCESS_ID from the global scope if available.
 */
export class WorkerSideTransport implements ITransport {
  readonly id: string;
  private _connected = false;
  private _bufferedAmount = 0;
  private readonly _port: { postMessage(data: unknown): void; on(event: string, handler: (...args: any[]) => void): void; removeListener(event: string, handler: (...args: any[]) => void): void };
  private readonly _dataHandlers: TransportHandler[] = [];
  private readonly _errorHandlers: TransportErrorHandler[] = [];
  private readonly _closeHandlers: TransportCloseHandler[] = [];
  private readonly _drainHandlers: (() => void)[] = [];
  private readonly _config: TransportConfig;

  constructor(
    port: { postMessage(data: unknown): void; on(event: string, handler: (...args: any[]) => void): void; removeListener(event: string, handler: (...args: any[]) => void): void },
    config?: Partial<TransportConfig>,
  ) {
    this._port = port;
    this._config = { ...DEFAULT_TRANSPORT_CONFIG, ...config };
    this.id = `worker-side-${this._config.localId}-${(++_workerSeq).toString(36)}`;
  }

  get connected(): boolean { return this._connected; }
  get localId(): string { return this._config.localId; }
  get remoteId(): string { return this._config.remoteId; }
  get bufferedAmount(): number { return this._bufferedAmount; }

  async connect(): Promise<void> {
    if (this._connected) return;
    this._port.on('message', this._onMessage);
    this._port.on('error', this._onError);
    this._port.on('exit', this._onExit);
    this._port.on('disconnect', this._onExit);
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    this._connected = false;
    this._port.removeListener('message', this._onMessage);
    this._port.removeListener('error', this._onError);
    this._port.removeListener('exit', this._onExit);
    this._port.removeListener('disconnect', this._onExit);
    for (const h of this._closeHandlers) {
      try { h(); } catch { /* swallow */ }
    }
  }

  async send(data: TransportData): Promise<void> {
    if (!this._connected) throw new Error('Worker transport not connected');
    if (this._config.maxMessageSize > 0 &&
        new TextEncoder().encode(data).byteLength > this._config.maxMessageSize) {
      throw new Error('Message size exceeds limit');
    }
    this._bufferedAmount += data.length;
    try {
      this._port.postMessage(data);
    } finally {
      this._bufferedAmount = Math.max(0, this._bufferedAmount - data.length);
      if (this._config.lowWaterMark > 0 && this._bufferedAmount <= this._config.lowWaterMark) {
        for (const h of this._drainHandlers) {
          try { h(); } catch { /* swallow */ }
        }
      }
    }
  }

  onData(handler: TransportHandler): void { this._dataHandlers.push(handler); }
  onError(handler: TransportErrorHandler): void { this._errorHandlers.push(handler); }
  onClose(handler: TransportCloseHandler): void { this._closeHandlers.push(handler); }
  onDrain(handler: () => void): void { this._drainHandlers.push(handler); }
  offData(handler: TransportHandler): void {
    const i = this._dataHandlers.indexOf(handler);
    if (i !== -1) this._dataHandlers.splice(i, 1);
  }
  offDrain(handler: () => void): void {
    const i = this._drainHandlers.indexOf(handler);
    if (i !== -1) this._drainHandlers.splice(i, 1);
  }

  dispose(): void {
    this._connected = false;
    this._dataHandlers.length = 0;
    this._errorHandlers.length = 0;
    this._closeHandlers.length = 0;
    this._drainHandlers.length = 0;
    this._port.removeListener('message', this._onMessage);
    this._port.removeListener('error', this._onError);
    this._port.removeListener('exit', this._onExit);
    this._port.removeListener('disconnect', this._onExit);
  }

  private _onMessage = (data: unknown) => {
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

  private _onError = (err: Error) => {
    for (const h of this._errorHandlers) {
      try { h(err); } catch { /* swallow */ }
    }
  };

  private _onExit = () => {
    this._connected = false;
    for (const h of this._closeHandlers) {
      try { h(); } catch { /* swallow */ }
    }
  };
}
