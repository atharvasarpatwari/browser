/**
 * @file src/common/ipc/socket-transport.ts
 *
 * Transport implementation using Node.js net/tls modules.
 * Provides TCP and Unix socket transports for out-of-process IPC.
 */

import type { ITransport, TransportConfig, TransportData, TransportHandler, TransportErrorHandler, TransportCloseHandler } from './transport';
import { DEFAULT_TRANSPORT_CONFIG } from './transport';

let _socketSeq = 0;

/**
 * TCP/Unix socket transport (client side).
 * Connects to a remote server via net.connect() or tls.connect().
 */
export class SocketTransport implements ITransport {
  readonly id: string;
  private _connected = false;
  private _bufferedAmount = 0;
  private _socket: any = null;
  private readonly _dataHandlers: TransportHandler[] = [];
  private readonly _errorHandlers: TransportErrorHandler[] = [];
  private readonly _closeHandlers: TransportCloseHandler[] = [];
  private readonly _drainHandlers: (() => void)[] = [];
  private readonly _config: TransportConfig;
  private readonly _options: {
    host: string;
    port: number;
    path?: string;
    useTLS: boolean;
    tlsOptions?: Record<string, unknown>;
  };

  constructor(
    options: {
      host?: string;
      port?: number;
      path?: string;
      useTLS?: boolean;
      tlsOptions?: Record<string, unknown>;
    },
    config?: Partial<TransportConfig>,
  ) {
    this._options = {
      host: options.host ?? '127.0.0.1',
      port: options.port ?? 0,
      path: options.path,
      useTLS: options.useTLS ?? false,
      tlsOptions: options.tlsOptions,
    };
    this._config = { ...DEFAULT_TRANSPORT_CONFIG, ...config };
    this.id = `socket-${this._config.localId}-${(++_socketSeq).toString(36)}`;
  }

  get connected(): boolean { return this._connected; }
  get localId(): string { return this._config.localId; }
  get remoteId(): string { return this._config.remoteId; }
  get bufferedAmount(): number { return this._bufferedAmount; }
  get socket(): any { return this._socket; }

  async connect(): Promise<void> {
    if (this._connected) return;

    const net = await import('net');

    return new Promise((resolve, reject) => {
      const connectOpts: any = this._options.path
        ? { path: this._options.path }
        : { host: this._options.host, port: this._options.port };

      const socket = net.connect(connectOpts);

      const onConnect = () => {
        cleanup();
        this._socket = socket;
        this._connected = true;
        socket.on('data', this._onData);
        socket.on('error', this._onError);
        socket.on('close', this._onClose);
        socket.on('drain', this._onDrain);
        resolve();
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const cleanup = () => {
        socket.removeListener('connect', onConnect);
        socket.removeListener('error', onError);
      };

      socket.on('connect', onConnect);
      socket.on('error', onError);
    });
  }

  async disconnect(): Promise<void> {
    if (!this._connected || !this._socket) return;
    this._connected = false;
    this._socket.removeListener('data', this._onData);
    this._socket.removeListener('error', this._onError);
    this._socket.removeListener('close', this._onClose);
    this._socket.removeListener('drain', this._onDrain);
    return new Promise((resolve) => {
      this._socket!.end(() => {
        this._socket = null;
        resolve();
      });
    });
  }

  async send(data: TransportData): Promise<void> {
    if (!this._connected || !this._socket) throw new Error('Socket transport not connected');
    if (this._config.maxMessageSize > 0 &&
        new TextEncoder().encode(data).byteLength > this._config.maxMessageSize) {
      throw new Error('Message size exceeds limit');
    }
    const buf = Buffer.from(data, 'utf-8');
    this._bufferedAmount += buf.length;
    const ok = this._socket.write(buf);
    if (!ok && this._config.highWaterMark > 0) {
      // Backpressure — wait for drain
      await new Promise<void>((resolve) => {
        const onDrain = () => {
          this._socket.removeListener('drain', onDrain);
          this._bufferedAmount = Math.max(0, this._bufferedAmount - buf.length);
          resolve();
        };
        this._socket.on('drain', onDrain);
      });
    } else {
      this._bufferedAmount = Math.max(0, this._bufferedAmount - buf.length);
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
    if (this._socket) {
      this._socket.removeAllListeners();
      try { this._socket.destroy(); } catch { /* swallow */ }
      this._socket = null;
    }
  }

  private _onData = (chunk: Buffer) => {
    const data = chunk.toString('utf-8');
    for (const h of this._dataHandlers) {
      try { h(data); } catch (err) {
        for (const eh of this._errorHandlers) {
          try { eh(err instanceof Error ? err : new Error(String(err))); } catch { /* swallow */ }
        }
      }
    }
  };

  private _onError = (err: Error) => {
    for (const h of this._errorHandlers) {
      try { h(err); } catch { /* swallow */ }
    }
  };

  private _onClose = () => {
    this._connected = false;
    for (const h of this._closeHandlers) {
      try { h(); } catch { /* swallow */ }
    }
  };

  private _onDrain = () => {
    for (const h of this._drainHandlers) {
      try { h(); } catch { /* swallow */ }
    }
  };
}

/**
 * TCP/Unix socket transport (server side).
 * Wraps an already-connected net.Server connection into ITransport.
 */
export class SocketServerTransport implements ITransport {
  readonly id: string;
  private _connected = false;
  private _bufferedAmount = 0;
  private _socket: any = null;
  private readonly _dataHandlers: TransportHandler[] = [];
  private readonly _errorHandlers: TransportErrorHandler[] = [];
  private readonly _closeHandlers: TransportCloseHandler[] = [];
  private readonly _drainHandlers: (() => void)[] = [];
  private readonly _config: TransportConfig;

  constructor(
    socket: any,
    config?: Partial<TransportConfig>,
  ) {
    this._socket = socket;
    this._config = { ...DEFAULT_TRANSPORT_CONFIG, ...config };
    this.id = `socket-server-${this._config.localId}-${(++_socketSeq).toString(36)}`;
  }

  get connected(): boolean { return this._connected; }
  get localId(): string { return this._config.localId; }
  get remoteId(): string { return this._config.remoteId; }
  get bufferedAmount(): number { return this._bufferedAmount; }
  get socket(): any { return this._socket; }

  async connect(): Promise<void> {
    if (this._connected) return;
    this._connected = true;
    this._socket.on('data', this._onData);
    this._socket.on('error', this._onError);
    this._socket.on('close', this._onClose);
    this._socket.on('drain', this._onDrain);
  }

  async disconnect(): Promise<void> {
    if (!this._connected || !this._socket) return;
    this._connected = false;
    this._socket.removeListener('data', this._onData);
    this._socket.removeListener('error', this._onError);
    this._socket.removeListener('close', this._onClose);
    this._socket.removeListener('drain', this._onDrain);
    return new Promise((resolve) => {
      this._socket!.end(() => resolve());
    });
  }

  async send(data: TransportData): Promise<void> {
    if (!this._connected || !this._socket) throw new Error('Socket transport not connected');
    if (this._config.maxMessageSize > 0 &&
        new TextEncoder().encode(data).byteLength > this._config.maxMessageSize) {
      throw new Error('Message size exceeds limit');
    }
    const buf = Buffer.from(data, 'utf-8');
    this._bufferedAmount += buf.length;
    const ok = this._socket.write(buf);
    if (!ok && this._config.highWaterMark > 0) {
      await new Promise<void>((resolve) => {
        const onDrain = () => {
          this._socket.removeListener('drain', onDrain);
          this._bufferedAmount = Math.max(0, this._bufferedAmount - buf.length);
          resolve();
        };
        this._socket.on('drain', onDrain);
      });
    } else {
      this._bufferedAmount = Math.max(0, this._bufferedAmount - buf.length);
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
    if (this._socket) {
      this._socket.removeAllListeners();
      try { this._socket.destroy(); } catch { /* swallow */ }
      this._socket = null;
    }
  }

  private _onData = (chunk: Buffer) => {
    const data = chunk.toString('utf-8');
    for (const h of this._dataHandlers) {
      try { h(data); } catch (err) {
        for (const eh of this._errorHandlers) {
          try { eh(err instanceof Error ? err : new Error(String(err))); } catch { /* swallow */ }
        }
      }
    }
  };

  private _onError = (err: Error) => {
    for (const h of this._errorHandlers) {
      try { h(err); } catch { /* swallow */ }
    }
  };

  private _onClose = () => {
    this._connected = false;
    for (const h of this._closeHandlers) {
      try { h(); } catch { /* swallow */ }
    }
  };

  private _onDrain = () => {
    for (const h of this._drainHandlers) {
      try { h(); } catch { /* swallow */ }
    }
  };
}
