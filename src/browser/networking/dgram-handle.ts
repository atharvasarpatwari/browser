/**
 * @file src/browser/networking/dgram-handle.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * The IDgramHandle contract plus the renderer-side proxy handle that backs it.
 *
 * A dgram handle is the renderer-side view of a UDP socket owned by the main
 * process. Exactly like ISocketHandle, all I/O flows through RPC requests and
 * event pushes crossing the process boundary as serializable values, so the
 * renderer never holds a live `node:dgram` socket under contextIsolation.
 *
 * The surface intentionally mirrors the real dgram.Socket subset the
 * networking layer actually uses (ice-agent, quic-transport, stun-client):
 *
 *   • bind(port[, cb]) / address() / connect(port, host[, cb])
 *   • send(payload[, port, host])                      (fire-and-forget callers)
 *   • on('message'|'error'|'close', ...) / once / removeListener
 *   • close()
 *
 * Wire frames are DgramEventFrames pushed by the owner on the socket-id topic:
 * `message` carries the datagram bytes (ArrayBuffer) + remote info, `error`
 * carries the Error, `close` carries none. Because a consumer subscribes
 * slightly after it issues the open/bind RPC, the handle keeps a pending copy
 * of the last versioned event (error/close) until a subscriber attaches.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { toArrayBuffer, toError } from './socket-handle';

/** Remote address info carried by a `message` event (mirrors dgram rinfo). */
export interface DgramRinfo {
  readonly address: string;
  readonly family: string;
  readonly port: number;
}

/** Dgram events pushed from the owner to the renderer. */
export type DgramEventType = 'message' | 'error' | 'close';

/** Wire frame for an owner→renderer dgram event push. */
export interface DgramEventFrame {
  readonly evt: DgramEventType;
  /** Present for `message` events (serialized as an ArrayBuffer). */
  readonly bytes?: ArrayBuffer;
  /** Present for `message` events. */
  readonly rinfo?: DgramRinfo;
  /** Present for `error` events. */
  readonly error?: Error;
}

/**
 * Renderer-side view of a UDP socket owned by the main process. The subset of
 * dgram.Socket used by the networking layer, mediated by the owner wire.
 */
export interface IDgramHandle {
  /** Stable identifier routing this handle to its owner-side socket. */
  readonly id: string;
  /**
   * Bind the owner-side socket to `port` (0 = ephemeral). Resolves (or fires
   * `callback`) when the owner socket is bound; rejects on bind errors. Await
   * the returned promise where a bind failure must surface, or pass a callback
   * for the fire-and-forget style the quic transport uses.
   */
  bind(port: number, callback?: () => void): Promise<void>;
  /** Present local address info once bound, null otherwise. */
  address(): { address: string; family: string; port: number } | null;
  /**
   * Connect the owner-side socket to `port`/`host` (connected UDP). After this,
   * `send` without an explicit address goes to the connected peer. Resolves (or
   * fires `callback`) on connect.
   */
  connect(port: number, host: string, callback?: () => void): Promise<void>;
  /**
   * Send a datagram. With `port`/`address` it targets a specific peer; without
   * them the owner uses the connected socket established by `connect`.
   */
  send(payload: Uint8Array, port?: number, address?: string): Promise<void>;
  /** Subscribe to a dgram event. */
  on(evt: 'message', handler: (msg: Buffer, rinfo: DgramRinfo) => void): void;
  on(evt: 'error', handler: (err: Error) => void): void;
  on(evt: 'close', handler: () => void): void;
  /** One-shot error subscription (bind-attempt pattern). */
  once(evt: 'error', handler: (err: Error) => void): void;
  /** Remove a previously-registered listener. */
  removeListener(evt: 'message', handler: (msg: Buffer, rinfo: DgramRinfo) => void): void;
  removeListener(evt: 'error', handler: (err: Error) => void): void;
  removeListener(evt: 'message' | 'error', handler: (...args: never[]) => void): void;
  /** Close the owner-side socket (fire-and-forget). */
  close(): void;
}

/** Minimal client surface of SocketProxy used by DgramHandle. */
export interface DgramClient {
  invoke(socketId: string, kind: string, extra?: Record<string, unknown>): Promise<unknown>;
  release(socketId: string): void;
  subscribeTopic(socketId: string, handler: (frame: unknown) => void): () => void;
}

interface DgramHandler { (...args: never[]): void; }

/** Tiny isolated event hub shared by all DgramHandle instances. */
class DgramEventHub {
  private readonly handlers = new Map<DgramEventType, Set<DgramHandler>>();

  add(evt: DgramEventType, handler: DgramHandler): void {
    let set = this.handlers.get(evt);
    if (!set) {
      set = new Set<DgramHandler>();
      this.handlers.set(evt, set);
    }
    set.add(handler);
  }

  remove(evt: DgramEventType, handler: DgramHandler): void {
    this.handlers.get(evt)?.delete(handler);
  }

  has(evt: DgramEventType): boolean {
    return (this.handlers.get(evt)?.size ?? 0) > 0;
  }

  emit(evt: DgramEventType, ...args: unknown[]): void {
    const set = this.handlers.get(evt);
    if (!set) return;
    for (const handler of [...set]) {
      try { handler(...(args as never[])); } catch { /* handler errors never break the socket loop */ }
    }
  }
}

/** IDgramHandle implementation backed by the socket-proxy wire. */
export class DgramHandle implements IDgramHandle {
  private readonly hub = new DgramEventHub();
  private pendingError: Error | null = null;
  private pendingClose = false;

  constructor(
    private readonly client: DgramClient,
    readonly id: string,
  ) {}

  bind(port: number, callback?: () => void): Promise<void> {
    return this.client.invoke(this.id, 'dgram-bind', { port })
      .then((result) => {
        const address = (result as { address?: { address: string; family: string; port: number } } | null)?.address;
        if (address) this.cachedAddress = address;
        callback?.();
      })
      .catch((err: unknown) => { throw err instanceof Error ? err : new Error(String(err)); });
  }

  address(): { address: string; family: string; port: number } | null {
    // address() is deliberately synchronous like dgram's. The owner caches the
    // bound address at bind time, so no RPC round-trip is needed here.
    return this.cachedAddress;
  }

  private cachedAddress: { address: string; family: string; port: number } | null = null;

  connect(port: number, host: string, callback?: () => void): Promise<void> {
    return this.client.invoke(this.id, 'dgram-connect', { port, host })
      .then(() => callback?.())
      .catch((err: unknown) => { throw err instanceof Error ? err : new Error(String(err)); });
  }

  send(payload: Uint8Array, port?: number, address?: string): Promise<void> {
    return this.client.invoke(this.id, 'dgram-send', {
      bytes: toArrayBuffer(payload),
      port: port ?? null,
      address: address ?? null,
    }).then(() => undefined);
  }

  on(evt: 'message', handler: (msg: Buffer, rinfo: DgramRinfo) => void): void;
  on(evt: 'error', handler: (err: Error) => void): void;
  on(evt: 'close', handler: () => void): void;
  on(evt: DgramEventType, handler: DgramHandler): void {
    if (evt === 'error' && this.pendingError) {
      const err = this.pendingError;
      this.pendingError = null;
      try { (handler as (err: Error) => void)(err); } catch { /* isolated */ }
    }
    if (evt === 'close' && this.pendingClose) {
      this.pendingClose = false;
      try { (handler as () => void)(); } catch { /* isolated */ }
    }
    this.hub.add(evt, handler);
  }

  once(evt: 'error', handler: (err: Error) => void): void {
    const wrapped: DgramHandler = (err: never) => {
      this.hub.remove(evt, wrapped);
      (handler as (err: Error) => void)(err);
    };
    if (this.pendingError) {
      const err = this.pendingError;
      this.pendingError = null;
      handler(err);
      return;
    }
    this.hub.add(evt, wrapped);
  }

  removeListener(evt: 'message', handler: (msg: Buffer, rinfo: DgramRinfo) => void): void;
  removeListener(evt: 'error', handler: (err: Error) => void): void;
  removeListener(evt: 'message' | 'error', handler: (...args: never[]) => void): void;
  removeListener(evt: 'message' | 'error', handler: (...args: never[]) => void): void {
    this.hub.remove(evt, handler as DgramHandler);
  }
  close(): void {
    void this.client.invoke(this.id, 'dgram-close').catch(() => undefined);
    this.client.release(this.id);
  }

  /**
   * Dispatch a pushed frame from the owner.
   *
   * NOTE ON `Buffer` USE (added in review, 2026-09-06): this runs
   * renderer-side, where `contextIsolation: true` means there is no bare Node
   * `Buffer` global — this line depends entirely on `installBufferPolyfill()`
   * (called once, in `src/app/main.ts`) having installed a page-world shim
   * before this ever executes. That dependency was previously undocumented
   * and untested (`buffer-polyfill.ts`'s own docs scoped it to "non-networking
   * sites"). It's an intentional choice, not an oversight — see the fuller
   * explanation in `buffer-polyfill.ts`'s header and `socket-proxy-design.md`
   * — but if this file is ever used somewhere `installBufferPolyfill()` hasn't
   * run, this throws `ReferenceError: Buffer is not defined`, the exact
   * failure mode the whole socket-proxy effort exists to eliminate.
   * `tests/dgram-handle-buffer-polyfill.test.ts` verifies this line actually
   * works with the real `Buffer` deleted and only the polyfill in its place.
   */
  receive(frame: DgramEventFrame): void {
    if (frame.evt === 'message') {
      const bytes = new Uint8Array(frame.bytes ?? new Uint8Array(0));
      const msg = Buffer.from(bytes);
      const rinfo: DgramRinfo = frame.rinfo ?? { address: '', family: 'IPv4', port: 0 };
      this.hub.emit('message', msg, rinfo);
      return;
    }
    if (frame.evt === 'error') {
      const err = frame.error instanceof Error ? frame.error : toError(frame.error, 'dgram socket error');
      if (this.hub.has('error')) {
        this.hub.emit('error', err);
      } else {
        this.pendingError = err;
      }
      return;
    }
    if (this.hub.has('close')) {
      this.hub.emit('close');
    } else {
      this.pendingClose = true;
    }
  }
}