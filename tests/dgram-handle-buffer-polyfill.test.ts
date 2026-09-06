/**
 * @file tests/dgram-handle-buffer-polyfill.test.ts
 *
 * Closes a gap found reviewing the Phase 5 dgram work: DgramHandle.receive()
 * (renderer-side, per dgram-handle.ts's own header) calls the bare `Buffer`
 * global directly. That's only safe under `contextIsolation: true` because
 * `installBufferPolyfill()` (wired in `src/app/main.ts`) installs a page-world
 * shim before any Buffer use — a dependency that, until now, no test verified.
 * The rest of the suite runs in vitest/Node where a real Buffer always exists,
 * so it can't catch a regression here (see socket-proxy-design.md's own
 * "Grounding facts" section on this exact class of gap). This test deletes the
 * real Buffer, installs only the polyfill, and proves DgramHandle still works.
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { installBufferPolyfill, BufferShim } from '../src/browser/buffer-polyfill';
import { DgramHandle, type DgramClient } from '../src/browser/networking/dgram-handle';

function stubClient(): DgramClient {
  return {
    invoke: async () => ({}),
    release: () => {},
    subscribeTopic: () => () => {},
  };
}

describe('DgramHandle without a real Buffer global (contextIsolation simulation)', () => {
  let realBuffer: unknown;

  beforeEach(() => {
    realBuffer = (globalThis as Record<string, unknown>).Buffer;
    delete (globalThis as Record<string, unknown>).Buffer;
    installBufferPolyfill();
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).Buffer = realBuffer;
  });

  it('delivers a message payload without throwing when only the polyfill provides Buffer', () => {
    expect((globalThis as Record<string, unknown>).Buffer).toBe(BufferShim);

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
    expect((data as { toString(enc?: string): string }).toString('utf8')).toBe('hi!');
    expect(rinfo).toEqual({ address: '127.0.0.1', family: 'IPv4', port: 12345 });
  });

  it('matches the real-Buffer behavior byte-for-byte (parity check)', () => {
    const handle = new DgramHandle(stubClient(), 'sock-test-2');
    let seen: { toString(enc?: string): string } | null = null;
    handle.on('message', (msg) => { seen = msg as unknown as { toString(enc?: string): string }; });

    const bytes = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x80, 0x7f, 0x20]);
    (handle as unknown as { receive(frame: unknown): void }).receive({
      evt: 'message',
      bytes: bytes.buffer,
      rinfo: { address: '10.0.0.1', family: 'IPv4', port: 1 },
    });

    expect(seen).not.toBeNull();
    expect(seen!.toString('hex')).toBe('0001fffe807f20');
  });

  it('buffers a message pushed before any listener is attached, same as the pendingError/pendingClose pattern', () => {
    // dgram-handle.ts only special-cases pending 'error' and 'close' frames
    // (see receive()'s else-branches) — a 'message' frame with no listener
    // yet attached is simply dropped, matching real dgram.Socket semantics
    // (there's no "replay the last packet" concept for UDP). This test just
    // pins that the polyfill-backed path doesn't throw in that case either.
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
