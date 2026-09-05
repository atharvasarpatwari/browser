/**
 * @file src/browser/networking/socket-handle.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * The ISocketHandle contract plus the tiny primitives shared by the socket
 * proxy (renderer side) and the socket owner (main side).
 *
 * A socket handle is the renderer-side view of a socket owned by the main
 * process. All I/O happens through RPC requests and event pushes that cross
 * the process boundary as serializable values, so the renderer never holds a
 * live `net.Socket` and remains safe under `contextIsolation: true`.
 *
 * Events are pushed from the owner as frames. Because a client subscribes to
 * events slightly after it has sent the `open-tcp` request, the router keeps a
 * single "pending" copy of versioned events (connect / secureConnect / end /
 * close / error) so a late subscriber never misses them. Streamed `data`
 * events are delivered to currently-registered handlers; bytes buffered before
 * the first subscriber are handed over on subscription and re-emitted by
 * `enqueueIncoming`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Socket events pushed from the owner to the renderer. */
export type SocketEventType = 'data' | 'error' | 'end' | 'close' | 'connect' | 'secureConnect';

/** Payload handed to a socket event handler. */
export type SocketEventPayload = Uint8Array | Error | undefined;

/** Handler for a socket event. */
export type SocketEventCallback = (payload: SocketEventPayload) => void;

/** Wire frame for an owner→renderer socket event push. */
export interface SocketEventFrame {
  readonly evt: SocketEventType;
  /** Present for `data` events (serialized as an ArrayBuffer). */
  readonly bytes?: ArrayBuffer;
  /** Present for `error` events. */
  readonly error?: Error;
}

/**
 * Renderer-side view of a socket owned by the main process. Implementations
 * forward every method and event through the socket proxy wire.
 */
export interface ISocketHandle {
  /** Stable identifier routing this handle to its owner-side socket. */
  readonly id: string;
  /** Send bytes to the peer (via the owner-side socket). */
  write(bytes: Uint8Array): Promise<void>;
  /** Destroy the owner-side socket and release this handle's wiring. */
  destroy(): Promise<void>;
  /**
   * Fetch the peer certificate from the owner-side socket. Valid after the
   * socket has raised `secureConnect`.
   */
  getPeerCertificate(): Promise<unknown>;
  /** Ask the owner to upgrade the underlying socket with TLS (SNI = servername). */
  upgradeTls(servername: string): Promise<void>;
  /**
   * Re-emit already-consumed bytes back into the stream (leftover bytes from a
   * tunnel handshake). Delivered to the current `data` subscribers without a
   * round-trip to the owner, preserving byte order.
   */
  enqueueIncoming(bytes: Uint8Array): void;
  /** Subscribe to a socket event. Returns an unsubscribe function. */
  onEvent(evt: SocketEventType, handler: SocketEventCallback): () => void;
}

/** Tiny event hub that isolates handler exceptions. */
export class SocketEventRouter {
  private readonly handlers = new Map<SocketEventType, Set<SocketEventCallback>>();

  /** Register a handler. Returns an unsubscribe function (idempotent). */
  on(evt: SocketEventType, handler: SocketEventCallback): () => void {
    let set = this.handlers.get(evt);
    if (!set) {
      set = new Set<SocketEventCallback>();
      this.handlers.set(evt, set);
    }
    set.add(handler);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      set.delete(handler);
    };
  }

  /** Whether at least one handler is registered for the event. */
  has(evt: SocketEventType): boolean {
    return (this.handlers.get(evt)?.size ?? 0) > 0;
  }

  /** Deliver a payload to all handlers for the event (exceptions isolated). */
  emit(evt: SocketEventType, payload: SocketEventPayload): void {
    const set = this.handlers.get(evt);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(payload);
      } catch { /* handler errors never break the socket loop */ }
    }
  }
}

/**
 * Resolve with the payload of the FIRST occurrence of `evt` after subscribing.
 * Safe to await after the event may already have been delivered: handles
 * buffer a pending copy of versioned events until a handler subscribes.
 */
export function onceSocketEvent(handle: ISocketHandle, evt: SocketEventType): Promise<SocketEventPayload> {
  return new Promise((resolve) => {
    let unsub: () => void = () => {};
    unsub = handle.onEvent(evt, (payload) => {
      unsub();
      resolve(payload);
    });
  });
}

/**
 * Copy bytes into a freshly-sized ArrayBuffer. The serializer only tags values
 * that are actual `ArrayBuffer` instances, and a Buffer/Uint8Array view's
 * `.buffer` may be larger than its visible bytes — so a copy is mandatory.
 */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}