import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { ITransport, TransportConfig, TransportData, TransportHandler, TransportErrorHandler, TransportCloseHandler } from './transport';

// ─────────────────────────────────────────────────────────────────────────────
// CHILD PROCESS TRANSPORT
// Wraps Node.js child_process.fork() IPC channel as an ITransport.
// Used by the parent (browser) process to communicate with renderer processes.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_CHILD_TRANSPORT_CONFIG: TransportConfig = {
  localId: 'main',
  remoteId: 'child',
  maxMessageSize: 16 * 1024 * 1024,
  connectTimeoutMs: 10_000,
  highWaterMark: 0,
  lowWaterMark: 0,
};

export class ChildProcessTransport implements ITransport {
  readonly id: string;
  private _connected = false;
  private _bufferedAmount = 0;
  private _process: ChildProcess | null = null;
  private _config: TransportConfig;
  private readonly _dataHandlers: TransportHandler[] = [];
  private readonly _errorHandlers: TransportErrorHandler[] = [];
  private readonly _closeHandlers: TransportCloseHandler[] = [];
  private readonly _drainHandlers: (() => void)[] = [];
  private readonly _onMessage = (data: unknown) => {
    if (typeof data === 'string' && this._connected) {
      for (const h of this._dataHandlers) {
        try { h(data); } catch (err) {
          for (const eh of this._errorHandlers) {
            try { eh(err instanceof Error ? err : new Error(String(err))); } catch { /* swallow */ }
          }
        }
      }
    }
  };

  private constructor(config?: Partial<TransportConfig>) {
    this._config = { ...DEFAULT_CHILD_TRANSPORT_CONFIG, ...config };
    this.id = `child-${this._config.remoteId}`;
  }

  /**
   * Fork a child process and return a connected transport.
   */
  static fork(
    modulePath: string,
    args: string[] = [],
    options: Record<string, unknown> = {},
  ): ChildProcessTransport {
    const processId = (options as any).env?.NOVA_PROCESS_ID ?? randomUUID();
    const transport = new ChildProcessTransport({
      localId: 'main',
      remoteId: processId,
    });
    transport._process = fork(modulePath, args, {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      ...options,
    });
    transport._attachListeners();
    return transport;
  }

  /**
   * Attach to an existing child process's IPC channel.
   */
  static fromChildProcess(child: ChildProcess, config?: Partial<TransportConfig>): ChildProcessTransport {
    const transport = new ChildProcessTransport(config);
    transport._process = child;
    transport._attachListeners();
    return transport;
  }

  private _attachListeners(): void {
    if (!this._process?.channel) {
      throw new Error('No IPC channel available — did you fork with stdio: "ipc"?');
    }
    this._process.on('message', this._onMessage);
    this._process.on('error', (error: Error) => {
      if (!this._connected) return;
      for (const h of this._errorHandlers) {
        try { h(error); } catch { /* swallow */ }
      }
    });
    this._process.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      if (!this._connected) return;
      this._connected = false;
      for (const h of this._closeHandlers) {
        try { h(); } catch { /* swallow */ }
      }
    });
  }

  get connected(): boolean { return this._connected && this._process !== null && this._process.connected === true; }
  get localId(): string { return this._config.localId; }
  get remoteId(): string { return this._config.remoteId; }
  get bufferedAmount(): number { return this._bufferedAmount; }

  /** The underlying child process. */
  get childProcess(): ChildProcess | null { return this._process; }

  async connect(): Promise<void> {
    if (this._connected) return;
    this._connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    this._connected = false;
    if (this._process) {
      try { this._process.disconnect(); } catch { /* already exited */ }
    }
  }

  async send(data: TransportData): Promise<void> {
    if (!this._connected) throw new Error('Transport not connected');
    if (!this._process?.channel) throw new Error('No IPC channel available');
    if (this._config.maxMessageSize > 0 &&
        new TextEncoder().encode(data).byteLength > this._config.maxMessageSize) {
      throw new Error(`Message size exceeds limit`);
    }
    this._process.send(data);
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
    if (this._process) {
      this._process.removeListener('message', this._onMessage);
      try { this._process.disconnect(); } catch { /* already exited */ }
      this._process = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHILD-SIDE TRANSPORT
// Wraps the child process global `process` object as an ITransport.
// Used by the renderer process to communicate back to the parent.
// ─────────────────────────────────────────────────────────────────────────────

export class ChildSideTransport implements ITransport {
  readonly id: string;
  private _connected = false;
  private _bufferedAmount = 0;
  private _config: TransportConfig;
  private readonly _dataHandlers: TransportHandler[] = [];
  private readonly _errorHandlers: TransportErrorHandler[] = [];
  private readonly _closeHandlers: TransportCloseHandler[] = [];
  private readonly _drainHandlers: (() => void)[] = [];

  constructor(config?: Partial<TransportConfig>) {
    const processId = process.env.NOVA_PROCESS_ID ?? 'unknown';
    this._config = {
      ...DEFAULT_CHILD_TRANSPORT_CONFIG,
      localId: processId,
      remoteId: 'main',
      ...config,
    };
    this.id = `childside-${this._config.localId}`;
  }

  get connected(): boolean { return this._connected; }
  get localId(): string { return this._config.localId; }
  get remoteId(): string { return this._config.remoteId; }
  get bufferedAmount(): number { return this._bufferedAmount; }

  async connect(): Promise<void> {
    if (this._connected) return;
    this._connected = true;
    process.on('message', this._onMessage);
    process.on('disconnect', this._onDisconnect);
  }

  private readonly _onMessage = (data: unknown) => {
    if (typeof data === 'string' && this._connected) {
      for (const h of this._dataHandlers) {
        try { h(data); } catch (err) {
          for (const eh of this._errorHandlers) {
            try { eh(err instanceof Error ? err : new Error(String(err))); } catch { /* swallow */ }
          }
        }
      }
    }
  };

  private readonly _onDisconnect = () => {
    if (!this._connected) return;
    this._connected = false;
    for (const h of this._closeHandlers) {
      try { h(); } catch { /* swallow */ }
    }
  };

  async disconnect(): Promise<void> {
    if (!this._connected) return;
    this._connected = false;
    process.removeListener('message', this._onMessage);
    process.removeListener('disconnect', this._onDisconnect);
    for (const h of this._closeHandlers) {
      try { h(); } catch { /* swallow */ }
    }
  }

  async send(data: TransportData): Promise<void> {
    if (!this._connected) throw new Error('Transport not connected');
    if (!process.send) throw new Error('No IPC channel available in child process');
    if (this._config.maxMessageSize > 0 &&
        new TextEncoder().encode(data).byteLength > this._config.maxMessageSize) {
      throw new Error(`Message size exceeds limit`);
    }
    process.send(data);
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
    process.removeListener('message', this._onMessage);
    process.removeListener('disconnect', this._onDisconnect);
  }
}
