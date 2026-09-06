/**
 * @file src/browser/networking/socket-proxy.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Renderer-facing client of the socket-owner wire. Every socket the renderer
 * opens is represented here as an {@link ISocketHandle} implemented with:
 *
 *   • `request('open-tcp' | 'write' | 'destroy' | ...)` RPCs for outbound I/O
 *   • topic pushes (topic = socket id) carrying `SocketEventFrame`s for events
 *
 * Bytes cross the wire as `ArrayBuffer`s (the serializer's `ArrayBuffer`
 * type-tag converts them to plain arrays on the wire). Connections are always
 * opened through this proxy, so no module in the networking layer touches
 * `net`/`tls` directly.
 *
 * A module-level shared instance is resolved lazily. In a bridged Electron
 * renderer it is wired to the real IPC transport (Phase 6 — see
 * socket-proxy-design.md's file-by-file table; this comment previously said
 * "Phase 5", which is actually the dgram/UDP slice — corrected 2026-09-06);
 * everywhere else it falls back to an in-process owner over an in-process
 * transport pair — the exact code path tests exercise, now with a real
 * process boundary behind it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Channel } from '../../common/ipc/channel';
import { createInProcessPair } from '../../common/ipc/transport';
import { SocketOwner } from './socket-owner';
import { DgramHandle, type DgramEventFrame, type IDgramHandle } from './dgram-handle';
import {
  SocketEventRouter,
  toArrayBuffer,
  toError,
  type ISocketHandle,
  type SocketEventFrame,
  type SocketEventPayload,
  type SocketEventType,
} from './socket-handle';

// ─────────────────────────────────────────────────────────────────────────────
// WIRE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const CHANNEL_NAME = 'nova:net';

const ONE_SHOT_EVENTS: readonly SocketEventType[] = ['error', 'end', 'close', 'connect', 'secureConnect'];

/** Minimally-typed view of the IPC channel the proxy drives. */
interface SocketChannel {
  subscribe<T>(topic: string, handler: (payload: T) => void): () => void;
  request<TPayload, TResult>(payload: TPayload, timeoutMs?: number): Promise<TResult>;
}

/**
 * The IPC surface the preload exposes for the nova:net wire (Phase 6 — see
 * socket-proxy-design.md's file-by-file table; not Phase 5, which is the
 * dgram/UDP slice — corrected 2026-09-06, same mislabeling as this file's
 * header comment and createDefaultSocketProxy's doc comment below).
 */
interface NovaIpcBridge {
  request(payload: unknown): Promise<unknown>;
  on(handler: (envelope: unknown) => void): () => void;
}

/** Socket ids only need to be stable routing keys within one proxy instance. */
function defaultSocketId(): string {
  return `sock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET HANDLE
// ─────────────────────────────────────────────────────────────────────────────

/** ISocketHandle implementation backed by the socket-proxy wire. */
class SocketHandle implements ISocketHandle {
  private readonly router = new SocketEventRouter();
  private readonly pendingOneShot = new Map<SocketEventType, SocketEventPayload>();
  private bufferedData: Uint8Array[] = [];

  constructor(
    private readonly proxy: SocketProxy,
    readonly id: string,
  ) {}

  write(bytes: Uint8Array): Promise<void> {
    return this.proxy.invoke(this.id, 'write', { bytes: toArrayBuffer(bytes) }).then(() => undefined);
  }

  destroy(): Promise<void> {
    this.proxy.release(this.id);
    return this.proxy.invoke(this.id, 'destroy').then(() => undefined).catch(() => undefined);
  }

  getPeerCertificate(): Promise<unknown> {
    return this.proxy.invoke(this.id, 'get-peer-certificate')
      .then((result) => (result as { certificate?: unknown } | null)?.certificate ?? null);
  }

  upgradeTls(servername: string): Promise<void> {
    return this.proxy.invoke(this.id, 'upgrade-tls', { servername }).then(() => undefined);
  }

  enqueueIncoming(bytes: Uint8Array): void {
    if (this.router.has('data')) {
      this.router.emit('data', bytes);
    } else {
      this.bufferedData.push(bytes);
    }
  }

  onEvent(evt: SocketEventType, handler: (payload: SocketEventPayload) => void): () => void {
    if (evt === 'data') {
      const unsub = this.router.on('data', handler);
      if (this.bufferedData.length > 0) {
        const pending = this.bufferedData;
        this.bufferedData = [];
        for (const bytes of pending) {
          try { handler(bytes); } catch { /* isolated */ }
        }
      }
      return unsub;
    }
    const pending = this.pendingOneShot.get(evt);
    if (pending !== undefined) {
      this.pendingOneShot.delete(evt);
      try { handler(pending); } catch { /* isolated */ }
    }
    return this.router.on(evt, handler);
  }

  /** Dispatch a pushed frame from the owner. */
  receive(frame: SocketEventFrame): void {
    if (frame.evt === 'data') {
      const bytes = frame.bytes ? new Uint8Array(frame.bytes) : new Uint8Array(0);
      if (this.router.has('data')) {
        this.router.emit('data', bytes);
      } else {
        this.bufferedData.push(bytes);
      }
      return;
    }
    const payload: SocketEventPayload = frame.evt === 'error'
      ? toError(frame.error ?? new Error('socket error'))
      : undefined;
    if (this.router.has(frame.evt)) {
      this.router.emit(frame.evt, payload);
    } else if (ONE_SHOT_EVENTS.includes(frame.evt) && !this.pendingOneShot.has(frame.evt)) {
      this.pendingOneShot.set(frame.evt, payload);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET PROXY
// ─────────────────────────────────────────────────────────────────────────────

/** Options for opening a socket through the proxy. */
export interface OpenTcpOptions {
  readonly host: string;
  readonly port: number;
  readonly tls?: boolean;
}

/** Renderer-side client of the socket-owner wire. */
export class SocketProxy {
  private readonly handles = new Map<string, SocketHandle>();
  private readonly dgramHandles = new Map<string, DgramHandle>();
  private readonly unsubs = new Map<string, () => void>();

  constructor(
    private readonly channel: SocketChannel,
    private readonly createId: () => string = defaultSocketId,
  ) {}

  /**
   * Register+own the topic subscription for a socket id, replacing any prior
   * subscription for the same id (the in-process fallback reuses ids rarely,
   * the bridged path always creates fresh ones).
   */
  subscribeTopic(socketId: string, handler: (frame: unknown) => void): () => void {
    const unsub = this.channel.subscribe(socketId, handler);
    const prev = this.unsubs.get(socketId);
    if (prev) prev();
    this.unsubs.set(socketId, unsub);
    return unsub;
  }

  /**
   * Open a TCP (or TLS) connection owned by the main process. The topic
   * subscription is registered BEFORE the request so no pushed events can be
   * lost to ordering; versioned events are buffered by the handle anyway.
   */
  async openTcp(options: OpenTcpOptions): Promise<ISocketHandle> {
    const socketId = this.createId();
    const handle = new SocketHandle(this, socketId);
    this.subscribeTopic(socketId, (frame: unknown) => {
      if (frame && typeof frame === 'object' && 'evt' in frame) {
        handle.receive(frame as SocketEventFrame);
      }
    });
    this.handles.set(socketId, handle);
    try {
      await this.channel.request(
        { kind: 'open-tcp', socketId, host: options.host, port: options.port, tls: options.tls ?? false },
      );
    } catch (err) {
      this.release(socketId);
      throw err;
    }
    return handle;
  }

  /**
   * Open a UDP socket owned by the main process. The same wire pattern as
   * openTcp: subscribe the topic first, then request the owner to create it.
   */
  async openDgram(): Promise<IDgramHandle> {
    const socketId = this.createId();
    const handle = new DgramHandle(this, socketId);
    this.subscribeTopic(socketId, (frame: unknown) => {
      if (frame && typeof frame === 'object' && 'evt' in frame) {
        handle.receive(frame as DgramEventFrame);
      }
    });
    this.dgramHandles.set(socketId, handle);
    try {
      await this.channel.request({ kind: 'open-dgram', socketId });
    } catch (err) {
      this.release(socketId);
      throw err;
    }
    return handle;
  }

  /** Send an owner RPC for a socket. */
  invoke(socketId: string, kind: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    return this.channel.request({ kind, socketId, ...extra });
  }

  /** Unsubscribe the topic and forget the handle (events are dropped). */
  release(socketId: string): void {
    const unsub = this.unsubs.get(socketId);
    if (unsub) {
      unsub();
      this.unsubs.delete(socketId);
    }
    this.handles.delete(socketId);
    this.dgramHandles.delete(socketId);
  }

  /** Tear down every live handle subscription. */
  dispose(): void {
    for (const socketId of [...this.unsubs.keys()]) {
      this.release(socketId);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED INSTANCE
// ─────────────────────────────────────────────────────────────────────────────

let explicitProxy: SocketProxy | null = null;
let sharedProxy: SocketProxy | null = null;

/** Override the shared instance (tests inject an explicit wire here). */
export function setSocketProxy(proxy: SocketProxy | null): void {
  explicitProxy = proxy;
}

/** The shared renderer socket proxy; created lazily. */
export function getSocketProxy(): SocketProxy {
  if (explicitProxy) return explicitProxy;
  if (!sharedProxy) {
    sharedProxy = createDefaultSocketProxy();
  }
  return sharedProxy;
}

/** Reset parsing; in usable-in-tests form. */
export function resetSocketProxy(): void {
  explicitProxy = null;
  if (sharedProxy) {
    sharedProxy.dispose();
    sharedProxy = null;
  }
}

/**
 * Bridge channel: subscribes topics locally and dispatches owner pushes that
 * arrive over `window.nova.ipc` (preload) as `{ socketId, frame }` envelopes.
 * RPCs are plain `ipcRenderer.invoke('nova:net', payload)` round-trips.
 */
function createBridgeChannel(ipc: NovaIpcBridge): SocketChannel {
  const topics = new Map<string, Set<(payload: unknown) => void>>();
  ipc.on((envelope: unknown) => {
    if (envelope === null || typeof envelope !== 'object') return;
    const { socketId, frame } = envelope as { socketId?: unknown; frame?: unknown };
    if (typeof socketId !== 'string') return;
    const handlers = topics.get(socketId);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try { handler(frame); } catch { /* isolated */ }
    }
  });
  return {
    subscribe<T>(topic: string, handler: (payload: T) => void): () => void {
      let set = topics.get(topic);
      if (!set) {
        set = new Set<(payload: unknown) => void>();
        topics.set(topic, set);
      }
      set.add(handler as (payload: unknown) => void);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        set.delete(handler as (payload: unknown) => void);
        if (set.size === 0) topics.delete(topic);
      };
    },
    request<TPayload, TResult>(payload: TPayload): Promise<TResult> {
      return Promise.resolve(ipc.request(payload) as Promise<TResult>);
    },
  };
}

/** True when the bridged Electron IPC transport is available in this world. */
function getNovaIpcBridge(): NovaIpcBridge | null {
  if (typeof globalThis === 'undefined') return null;
  const bridge = (globalThis as { nova?: { ipc?: NovaIpcBridge } }).nova;
  return bridge?.ipc ?? null;
}

/**
 * Default wiring. In a bridged Electron renderer (Phase 6 — see
 * socket-proxy-design.md's file-by-file table) the renderer channel
 * is created over the preload IPC transport; in every other runtime an
 * in-process owner over an in-process transport pair keeps the node-side
 * sockets available.
 */
function createDefaultSocketProxy(): SocketProxy {
  const bridge = getNovaIpcBridge();
  if (bridge) {
    return new SocketProxy(createBridgeChannel(bridge));
  }
  const [ownerTransport, rendererTransport] = createInProcessPair(
    { localId: 'socket-owner', remoteId: 'socket-renderer' },
    { localId: 'socket-renderer', remoteId: 'socket-owner' },
  );
  void ownerTransport.connect();
  void rendererTransport.connect();
  const ownerChannel = new Channel(ownerTransport, { name: CHANNEL_NAME, direction: 'main-to-renderer' }, 'main');
  const rendererChannel = new Channel(rendererTransport, { name: CHANNEL_NAME, direction: 'renderer-to-main' }, 'renderer');
  ownerChannel.activate();
  rendererChannel.activate();
  void new SocketOwner(ownerChannel);
  return new SocketProxy(rendererChannel);
}