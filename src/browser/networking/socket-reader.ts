/**
 * @file src/browser/networking/socket-reader.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Buffered reader over a Node `net` socket used by the tunnel handshakes
 * (SOCKS and HTTP CONNECT). TCP is a byte stream, so a single `data` event can
 * carry bytes for multiple protocol replies — surplus bytes are buffered and
 * handed to later reads instead of being consumed by the current one.
 *
 * Supports fixed-length reads (`read`) and delimiter-terminated reads
 * (`readUntil`), both serviced from the same FIFO queue so a mixed sequence of
 * reads stays ordered.
 *
 * On `detach()` all listeners are removed and any unconsumed bytes are handed
 * back; callers re-emit non-empty leftovers into the tunneled stream.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Socket } from 'node:net';

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
  | { kind: 'min'; min: number; resolve: (b: Buffer) => void; reject: (e: Error) => void }
  | { kind: 'until'; delim: Buffer; resolve: (b: Buffer) => void; reject: (e: Error) => void };

export class SocketReader {
  private buffer = Buffer.alloc(0);
  private waiters: ReadRequest[] = [];
  private closed = false;

  constructor(
    private readonly socket: Socket,
    private readonly closedError: (cause?: Error) => Error = (cause) =>
      new SocketReadError(
        `Proxy closed the connection during the handshake${cause ? `: ${cause.message}` : ''}`,
        'CONN_CLOSED',
      ),
  ) {
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('end', this.onEnd);
    socket.on('close', this.onClose);
  }

  private onData = (chunk: Buffer): void => {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.flush();
  };

  private onError = (err: Error): void => {
    this.fail(this.closedError(err));
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
  read(min: number): Promise<Buffer> {
    if (this.closed) return Promise.reject(this.closedError());
    return new Promise((resolve, reject) => {
      this.waiters.push({ kind: 'min', min, resolve, reject });
      this.flush();
    });
  }

  /** Read up to and including the given delimiter. */
  readUntil(delimiter: Buffer): Promise<Buffer> {
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
        const idx = this.buffer.indexOf(w.delim);
        if (idx !== -1) available = idx + w.delim.length;
      }
      if (available === null) return;
      this.waiters.shift();
      const out = this.buffer.subarray(0, available);
      this.buffer = this.buffer.subarray(available);
      w.resolve(Buffer.from(out));
    }
  }

  /**
   * Stop listening and hand back any bytes not yet consumed by reads. Callers
   * should re-emit non-empty leftovers into the tunneled stream.
   */
  detach(): Buffer {
    this.socket.removeListener('data', this.onData);
    this.socket.removeListener('error', this.onError);
    this.socket.removeListener('end', this.onEnd);
    this.socket.removeListener('close', this.onClose);
    const rest = this.buffer;
    this.buffer = Buffer.alloc(0);
    return rest;
  }
}
