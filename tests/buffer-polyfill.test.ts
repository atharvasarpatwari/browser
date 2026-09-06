/**
 * @file tests/buffer-polyfill.test.ts
 *
 * Verifies the page-world Buffer polyfill against Node's real Buffer:
 * every encoding round-trip, numeric accessors, concat/copy, and search
 * are parity-checked so the renderer (contextIsolation, no nodeIntegration)
 * can trust the shim that pngjs and the base64 helpers rely on.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Buffer as RealBuffer } from 'node:buffer';
import { BufferShim, installBufferPolyfill } from '../src/browser/buffer-polyfill';

function resetGlobal(): void {
  delete (globalThis as Record<string, unknown>).Buffer;
}

describe('buffer-polyfill', () => {
  beforeEach(() => {
    resetGlobal();
  });

  it('installBufferPolyfill injects a global Buffer', () => {
    installBufferPolyfill();
    expect((globalThis as Record<string, unknown>).Buffer).toBe(BufferShim);
  });

  it('installBufferPolyfill is a no-op when a Buffer already exists', () => {
    (globalThis as Record<string, unknown>).Buffer = RealBuffer;
    installBufferPolyfill();
    expect((globalThis as Record<string, unknown>).Buffer).toBe(RealBuffer);
  });

  it('encodes and decodes utf8 with proper multi-byte handling', () => {
    const src = 'héllo — wörld ✓ 中文';
    const ours = BufferShim.from(src, 'utf8');
    const real = RealBuffer.from(src, 'utf8');
    expect(ours.length).toBe(real.length);
    for (let i = 0; i < ours.length; i++) expect(ours[i]).toBe(real[i]);
    expect(ours.toString('utf8')).toBe(src);
    expect(ours.toString()).toBe(src);
  });

  it('encodes and decodes base64', () => {
    const src = '\x00\x01\x02\xff\xfe byte payload more';
    const real = RealBuffer.from(src, 'binary');
    const ours = BufferShim.from(real.toString('base64'), 'base64');
    expect(ours.equals(BufferShim.from(src, 'binary'))).toBe(true);
    expect(ours.toString('base64')).toBe(real.toString('base64'));
    expect(ours.toString('binary')).toBe(src);
  });

  it('encodes and decodes hex', () => {
    const src = '\x0a\xff\x00\x7f';
    const real = RealBuffer.from(src, 'binary');
    const ours = BufferShim.from(real.toString('hex'), 'hex');
    expect(ours.toString('hex')).toBe(real.toString('hex').toLowerCase());
    expect(ours.length).toBe(real.length);
  });

  it('handles ascii/latin1/binary as single-byte encodings', () => {
    const src = 'plain ascii text';
    expect(BufferShim.from(src, 'ascii').toString('ascii')).toBe(src);
    expect(BufferShim.from(src, 'binary').toString('latin1')).toBe(src);
    expect(BufferShim.from(src, 'latin1').toString('binary')).toBe(src);
  });

  it('alloc writes fill bytes and defaults to zero fill', () => {
    const filled = BufferShim.alloc(4, 0xab);
    expect(Array.from(filled)).toEqual([0xab, 0xab, 0xab, 0xab]);
    const zero = BufferShim.alloc(4);
    expect(Array.from(zero)).toEqual([0, 0, 0, 0]);
    const padded = BufferShim.alloc(6, 'ab', 'ascii');
    expect(Array.from(padded)).toEqual([0x61, 0x62, 0x61, 0x62, 0x61, 0x62]);
  });

  it('from() copies array buffers, typed arrays, and array-likes', () => {
    const ab = new Uint8Array([1, 2, 3, 4]).buffer;
    expect(Array.from(BufferShim.from(ab))).toEqual([1, 2, 3, 4]);
    const view = new Uint8Array([1, 2, 3, 4]).subarray(1, 3);
    expect(Array.from(BufferShim.from(view))).toEqual([2, 3]);
    expect(Array.from(BufferShim.from([9, 8, 7]))).toEqual([9, 8, 7]);
  });

  it('concat produces a full copy with correct total length', () => {
    const a = BufferShim.from('ab');
    const b = BufferShim.from('cde');
    const joined = BufferShim.concat([a, b], 5);
    expect(joined.toString('utf8')).toBe('abcde');
    const auto = BufferShim.concat([a, b]);
    expect(auto.length).toBe(5);
    expect(Array.from(BufferShim.concat([a, b], 1)).length).toBe(1);
  });

  it('read/write numeric accessors agree with Node Buffer (BE and LE)', () => {
    const ours = BufferShim.alloc(16);
    const real = RealBuffer.alloc(16);
    for (let i = 0; i < 4; i++) {
      ours.writeUInt16BE(i * 0x40 + 0x20, i * 2);
      real.writeUInt16BE(i * 0x40 + 0x20, i * 2);
      ours.writeUInt16LE(i * 0x40 + 0x20, i * 2 + 8);
      real.writeUInt16LE(i * 0x40 + 0x20, i * 2 + 8);
    }
    for (let i = 0; i < 16; i++) expect(ours[i]).toBe(real[i]);
    expect(ours.readUInt16BE(2)).toBe(real.readUInt16BE(2));
    expect(ours.readUInt16LE(10)).toBe(real.readUInt16LE(10));
    expect(ours.readUInt8(0)).toBe(real.readUInt8(0));
    ours.writeUInt32BE(0xdeadbeef, 0);
    real.writeUInt32BE(0xdeadbeef, 0);
    expect(ours.readUInt32BE(0)).toBe(real.readUInt32BE(0));
    ours.writeUInt32LE(0xdeadbeef, 4);
    real.writeUInt32LE(0xdeadbeef, 4);
    expect(ours.readUInt32LE(4)).toBe(real.readUInt32LE(4));
  });

  it('signed read/write accessors agree with Node Buffer', () => {
    const ours = BufferShim.alloc(8);
    const real = RealBuffer.alloc(8);
    ours.writeInt32BE(-12345, 0);
    real.writeInt32BE(-12345, 0);
    expect(ours.readInt32BE(0)).toBe(real.readInt32BE(0));
    ours.writeInt32LE(-12345, 4);
    real.writeInt32LE(-12345, 4);
    expect(ours.readInt32LE(4)).toBe(real.readInt32LE(4));
    ours.writeInt16BE(-32000, 0);
    real.writeInt16BE(-32000, 0);
    expect(ours.readInt16BE(0)).toBe(real.readInt16BE(0));
    ours.writeInt16LE(-32000, 2);
    real.writeInt16LE(-32000, 2);
    expect(ours.readInt16LE(2)).toBe(real.readInt16LE(2));
  });

  it('write() handles utf8 and offset semantics', () => {
    const ours = BufferShim.alloc(16);
    const real = RealBuffer.alloc(16);
    ours.write('hello', 2, 5);
    real.write('hello', 2, 5);
    for (let i = 0; i < 16; i++) expect(ours[i]).toBe(real[i]);
    expect(ours.toString('utf8', 2, 7)).toBe('hello');
  });

  it('copy() copies byte ranges into targets', () => {
    const src = BufferShim.from('abcdef');
    const dst = BufferShim.alloc(4);
    const n = src.copy(dst, 0, 1, 4);
    expect(n).toBe(3);
    expect(dst.toString('utf8', 0, 3)).toBe('bcd');
    expect(src.copy(BufferShim.alloc(2), 0, 0, 2)).toBe(2);
  });

  it('indexOf/lastIndexOf find single bytes and substrings', () => {
    const hay = BufferShim.from('find the needle in this haystack needlenow', 'ascii');
    const needle = BufferShim.from('needle');
    expect(hay.indexOf(0x6e)).toBe(2);
    expect(hay.indexOf(needle)).toBe(9);
    expect(hay.lastIndexOf(needle)).toBe(33);
    expect(hay.indexOf('zzz')).toBe(-1);
    expect(BufferShim.from([0xaa, 0x61, 0x61]).indexOf(0xaa)).toBe(0);
  });

  it('toString with start/end slices only that window', () => {
    const buf = BufferShim.from('0123456789');
    expect(buf.toString('utf8', 2, 5)).toBe('234');
  });

  it('isBuffer/isEncoding behave as expected', () => {
    installBufferPolyfill();
    expect(BufferShim.isBuffer(BufferShim.alloc(2))).toBe(true);
    expect(BufferShim.isBuffer(new Uint8Array(2))).toBe(false);
    expect(BufferShim.isEncoding('utf8')).toBe(true);
    expect(BufferShim.isEncoding('base64')).toBe(true);
    expect(BufferShim.isEncoding('utf16le')).toBe(false);
  });

  it('parity round-trip with Node Buffer for a realistic PNG chunk', () => {
    const real = RealBuffer.alloc(16);
    real.writeUInt32BE(13, 0);
    real.write('IHDR', 4, 4, 'ascii');
    real.writeUInt32BE(0x0000ffff, 8);
    real.writeUInt16BE(0x0100, 12);
    real[14] = 0xff;
    real[15] = 0x00;
    const ours = BufferShim.from(real);
    for (let i = 0; i < real.length; i++) expect(ours[i]).toBe(real[i]);
    expect(ours.readUInt32BE(0)).toBe(13);
    expect(ours.toString('ascii', 4, 8)).toBe('IHDR');
    expect(ours.readUInt32BE(8)).toBe(0x0000ffff);
    expect(ours.readUInt16BE(12)).toBe(0x0100);
  });
});