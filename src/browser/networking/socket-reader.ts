/**
 * @file src/browser/networking/socket-reader.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Buffered reader over an {@link ISocketHandle} used by the tunnel handshakes
 * (SOCKS and HTTP CONNECT). TCP is a byte stream, so a single `data` event can
 * carry bytes for multiple protocol replies — surplus bytes are buffered and
 * handed to later reads instead of being consumed by the current one.
 *
 * Supports fixed-length reads (`read`) and delimiter-terminated reads
 * (`readUntil`), both serviced from the same FIFO queue so a mixed sequence of
 * reads stays ordered.
 *
 * On `detach()` all event subscriptions are removed and any unconsumed bytes
 * are handed back; callers re-emit non-empty leftovers into the tunneled
 * stream via `handle.enqueueIncoming()`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { concatBytes, indexOfBytes } from './byte-codecs';
import type { ISocketHandle, SocketEventPayload } from './socket-handle';

/** Error raised when the peer socket errors/ends/closes mid-handshake. */
export class SocketReadError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'SocketReadError';
  }
}

type ReadRequest =
  | { kind: 'min'; min: number; resolve: (b: Uint8Array) => void; reject: (e: Error) => void }
  | { kind: 'until'; delim: Uint8Array; resolve: (b: Uint8Array) => void; reject: (e: Error) => void };

export class SocketReader {
  private buffer = new Uint8Array(0);
  private waiters: ReadRequest[] = [];
  private closed = false;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(
    private readonly socket: ISocketHandle,
    private readonly closedError: (cause?: Error) => Error = (cause) =>
      new SocketReadError(
        `Proxy closed the connection during the handshake${cause ? `: ${cause.message}` : ''}`,
        'CONN_CLOSED',
      ),
  ) {
    this.unsubscribers.push(
      socket.onEvent('data', this.onData),
      socket.onEvent('error', this.onError),
      socket.onEvent('end', this.onEnd),
      socket.onEvent('close', this.onClose),
    );
  }

  private onData = (payload: SocketEventPayload): void => {
    if (!(payload instanceof Uint8Array)) return;
    this.buffer = concatBytes([this.buffer, payload]);
    this.flush();
  };

  private onError = (payload: SocketEventPayload): void => {
    this.fail(this.closedError(payload instanceof Error ? payload : undefined));
  };

  private onEnd = (): void => {
    this.closed = true;
    this.fail(this.closedError());
  };

  private onClose = (): void => {
    this.closed = true;
    this.fail(this.closedError());
  };

  private fail(err: Error): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const w of pending) w.reject(err);
  }

  /** Read exactly `min` bytes (resolves as soon as they are buffered). */
  read(min: number): Promise<Uint8Array> {
    if (this.closed) return Promise.reject(this.closedError());
    return new Promise((resolve, reject) => {
      this.waiters.push({ kind: 'min', min, resolve, reject });
      this.flush();
    });
  }

  /** Read up to and including the given delimiter. */
  readUntil(delimiter: Uint8Array): Promise<Uint8Array> {
    if (this.closed) return Promise.reject(this.closedError());
    return new Promise((resolve, reject) => {
      this.waiters.push({ kind: 'until', delim: delimiter, resolve, reject });
      this.flush();
    });
  }

  private flush(): void {
    while (this.waiters.length > 0) {
      const w = this.waiters[0]!;
      let available: number | null = null;
      if (w.kind === 'min') {
        if (this.buffer.length >= w.min) available = w.min;
      } else {
        const idx = indexOfBytes(this.buffer, w.delim);
        if (idx !== -1) available = idx + w.delim.length;
      }
      if (available === null) return;
      this.waiters.shift();
      const out = this.buffer.subarray(0, available);
      this.buffer = this.buffer.subarray(available);
      w.resolve(out);
    }
  }

  /**
   * Stop listening and hand back any bytes not yet consumed by reads. Callers
   * should re-emit non-empty leftovers into the tunneled stream via
   * `handle.enqueueIncoming()`.
   */
  detach(): Uint8Array {
    for (const unsub of this.unsubscribers.splice(0)) unsub();
    const rest = this.buffer;
    this.buffer = new Uint8Array(0);
    return rest;
  }
}