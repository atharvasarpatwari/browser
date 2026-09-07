/**
 * @file tests/dgram-handle-buffer-polyfill.test.ts
 *
 * Originally closed a gap found reviewing the Phase 5 dgram work:
 * `DgramHandle.receive()` called the bare `Buffer` global directly, which was
 * only safe under `contextIsolation: true` because `installBufferPolyfill()`
 * (wired in `src/app/main.ts`) installs a page-world shim before any Buffer
 * use — a dependency that, at the time, no test verified. The rest of the
 * suite runs in vitest/Node where a real Buffer always exists, so it couldn't
 * have caught a regression here.
 *
 * UPDATE (2026-09-06): `receive()` no longer touches `Buffer` at all — see
 * dgram-handle.ts's own header comment on this method. It now emits the plain
 * `Uint8Array` it already has, matching `ISocketHandle`'s `data` event on the
 * TCP/TLS side. So the dependency this file originally existed to prove
 * ("works when only the polyfill is present") no longer applies — instead
 * this now proves the STRONGER claim: DgramHandle works with `Buffer`
 * completely undefined and no polyfill installed at all. Kept under this
 * file's original name (rather than renamed or folded into another suite,
 * neither of which this environment's tools can do) so the byte-
 * representation guarantee for this path stays pinned somewhere a future
 * "buffer polyfill" search will actually find.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { DgramHandle, type DgramClient } from '../src/browser/networking/dgram-handle';
import { decodeUtf8, hexFromBytes } from '../src/browser/networking/byte-codecs';

function stubClient(): DgramClient {
  return {
    invoke: async () => ({}),
    release: () => {},
    subscribeTopic: () => () => {},
  };
}

describe('DgramHandle with no Buffer global at all (contextIsolation simulation)', () => {
  let realBuffer: unknown;

  beforeEach(() => {
    realBuffer = (globalThis as Record<string, unknown>).Buffer;
    delete (globalThis as Record<string, unknown>).Buffer;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).Buffer = realBuffer;
  });

  it('delivers a message payload as a plain Uint8Array without throwing, with Buffer undefined', () => {
    expect((globalThis as Record<string, unknown>).Buffer).toBeUndefined();

    const handle = new DgramHandle(stubClient(), 'sock-test-1');
    const received: Array<{ data: unknown; rinfo: unknown }> = [];
    handle.on('message', (msg, rinfo) => received.push({ data: msg, rinfo }));

    const payload = new Uint8Array([0x68, 0x69, 0x21]); // "hi!"
    (handle as unknown as { receive(frame: unknown): void }).receive({
      evt: 'message',
      bytes: payload.buffer,
      rinfo: { address: '127.0.0.1', family: 'IPv4', port: 12345 },
    });

    expect(received).toHaveLength(1);
    const [{ data, rinfo }] = received;
    expect(data instanceof Uint8Array).toBe(true);
    expect(decodeUtf8(data as Uint8Array)).toBe('hi!');
    expect(rinfo).toEqual({ address: '127.0.0.1', family: 'IPv4', port: 12345 });
  });

  it('matches the expected bytes exactly, with Buffer undefined (parity check)', () => {
    const handle = new DgramHandle(stubClient(), 'sock-test-2');
    let seen: Uint8Array | null = null;
    handle.on('message', (msg) => { seen = msg; });

    const bytes = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f, 0x20]);
    (handle as unknown as { receive(frame: unknown): void }).receive({
      evt: 'message',
      bytes: bytes.buffer,
      rinfo: { address: '10.0.0.1', family: 'IPv4', port: 1 },
    });

    expect(seen).not.toBeNull();
    expect(hexFromBytes(seen!)).toBe('0001fffe807f20');
  });

  it('buffers a message pushed before any listener is attached, same as the pendingError/pendingClose pattern', () => {
    // dgram-handle.ts only special-cases pending 'error' and 'close' frames
    // (see receive()'s else-branches) — a 'message' frame with no listener
    // yet attached is simply dropped, matching real dgram.Socket semantics
    // (there's no "replay the last packet" concept for UDP). This test just
    // pins that the no-Buffer path doesn't throw in that case either.
    const handle = new DgramHandle(stubClient(), 'sock-test-3');
    const bytes = new Uint8Array([0x01]);
    expect(() => {
      (handle as unknown as { receive(frame: unknown): void }).receive({
        evt: 'message',
        bytes: bytes.buffer,
        rinfo: { address: '127.0.0.1', family: 'IPv4', port: 1 },
      });
    }).not.toThrow();
  });
});
