/**
 * @file src/browser/buffer-polyfill.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Install a page-world `Buffer` global when the renderer has none.
 *
 * Under `contextIsolation: true, nodeIntegration: false` the renderer has no
 * bare Node `Buffer` global, yet a handful of non-networking sites still use
 * one (`pngjs`, base64 helpers, auto-updater download concatenation, minidump
 * capture). Rather than hand Node's real Buffer across the contextBridge (whose
 * instance methods are known to break on structured clone — the 08-23 disaster),
 * we provide a plain-JS Uint8Array subclass with the subset of the Buffer API
 * this codebase actually exercises. It is pure page-world JS: no privileges,
 * nothing crosses the bridge.
 *
 * The polyfill installs ONLY when no Buffer exists (in vitest/Node, the real
 * Buffer is present and is left untouched, so the test suite is unaffected).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function hexBytes(input: string): Uint8Array | null {
  if (input.length % 2 !== 0) return null;
  const out = new Uint8Array(input.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(input.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}

function base64Bytes(input: string): Uint8Array | null {
  try {
    const clean = input.replace(/\s+/g, '');
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  } catch {
    return null;
  }
}

function stringBytes(input: string, encoding: string): Uint8Array | null {
  switch (encoding) {
    case 'utf8':
    case 'utf-8':
      return new TextEncoder().encode(input);
    case 'ascii':
    case 'latin1':
    case 'binary': {
      const out = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i++) {
        out[i] = input.charCodeAt(i);
      }
      return out;
    }
    case 'hex':
      return hexBytes(input);
    case 'base64':
      return base64Bytes(input);
    default:
      return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

const HEX_DIGITS = '0123456789abcdef';

/** Page-world Buffer implementation (installed only when the global is absent). */
export class BufferShim extends Uint8Array {
  static isBuffer(value: unknown): boolean {
    return value instanceof BufferShim || (typeof Uint8Array !== 'undefined' && value instanceof Uint8Array && (value as { _isNovaBuffer?: boolean })._isNovaBuffer === true);
  }

  static isEncoding(encoding: string): boolean {
    return ['utf8', 'utf-8', 'ascii', 'latin1', 'binary', 'hex', 'base64'].includes(encoding);
  }

  static alloc(size: number, fill?: number | string, encoding?: string): BufferShim {
    const buf = new BufferShim(size);
    if (fill !== undefined) {
      if (typeof fill === 'number') {
        buf.fill(fill);
      } else {
        const bytes = stringBytes(fill, encoding ?? 'utf8');
        for (let i = 0; i < size; i++) {
          buf[i] = bytes![i % bytes!.length];
        }
      }
    }
    return buf;
  }

  static allocUnsafe(size: number): BufferShim {
    return new BufferShim(size);
  }

  static from(arrayLike: ArrayLike<number>): BufferShim;
  static from<T>(arrayLike: ArrayLike<T>, mapfn: (v: T, k: number) => number, thisArg?: any): BufferShim;
  static from(elements: Iterable<number>): BufferShim;
  static from<T>(elements: Iterable<T>, mapfn?: (v: T, k: number) => number, thisArg?: any): BufferShim;
  static from(value: string, encoding?: string): BufferShim;
  static from(value: ArrayBuffer | ArrayBufferView, encoding?: string): BufferShim;
  static from(value: ArrayLike<number> | ArrayLike<unknown> | Iterable<unknown> | ArrayBuffer | ArrayBufferView | string, encodingOrMap?: string | ((v: number, k: number) => number), thisArg?: any): BufferShim {
    if (typeof value === 'string') {
      const bytes = stringBytes(value, (encodingOrMap as string) ?? 'utf8');
      if (!bytes) throw new TypeError(`Unknown encoding: ${(encodingOrMap as string) ?? 'utf8'}`);
      return new BufferShim(bytes);
    }
    if (value instanceof ArrayBuffer) {
      return new BufferShim(new Uint8Array(value));
    }
    if (ArrayBuffer.isView(value)) {
      return new BufferShim(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    }
    const src = value as ArrayLike<number>;
    const arr = typeof encodingOrMap === 'function'
      ? Uint8Array.from(src, encodingOrMap, thisArg)
      : Uint8Array.from(src);
    return new BufferShim(arr);
  }

  static concat(list: readonly Uint8Array[], totalLength?: number): BufferShim {
    const length = totalLength ?? list.reduce((sum, chunk) => sum + chunk.length, 0);
    const buf = BufferShim.alloc(length);
    let offset = 0;
    for (const chunk of list) {
      const n = Math.min(chunk.length, length - offset);
      if (n <= 0) break;
      buf.set(chunk.subarray(0, n), offset);
      offset += n;
    }
    return buf;
  }

  toString(encoding?: string, start = 0, end = this.length): string {
    const enc = encoding ?? 'utf8';
    const slice = this.subarray(start, end);
    switch (enc) {
      case 'hex': {
        let out = '';
        for (let i = 0; i < slice.length; i++) {
          out += HEX_DIGITS[slice[i] >> 4] + HEX_DIGITS[slice[i] & 0x0f];
        }
        return out;
      }
      case 'base64':
        return bytesToBase64(slice);
      case 'ascii':
      case 'latin1':
      case 'binary': {
        let out = '';
        for (let i = 0; i < slice.length; i++) {
          out += String.fromCharCode(slice[i]);
        }
        return out;
      }
      case 'utf8':
      case 'utf-8':
      default:
        return new TextDecoder('utf-8').decode(slice);
    }
  }

  private view(offset: number): DataView {
    return new DataView(this.buffer, this.byteOffset + offset);
  }

  readUInt8(offset: number): number {
    return this[offset];
  }

  readUInt16BE(offset: number): number {
    return this.view(offset).getUint16(0, false);
  }

  readUInt16LE(offset: number): number {
    return this.view(offset).getUint16(0, true);
  }

  readUInt32BE(offset: number): number {
    return this.view(offset).getUint32(0, false);
  }

  readUInt32LE(offset: number): number {
    return this.view(offset).getUint32(0, true);
  }

  readInt8(offset: number): number {
    return this.view(offset).getInt8(0);
  }

  readInt16BE(offset: number): number {
    return this.view(offset).getInt16(0, false);
  }

  readInt16LE(offset: number): number {
    return this.view(offset).getInt16(0, true);
  }

  readInt32BE(offset: number): number {
    return this.view(offset).getInt32(0, false);
  }

  readInt32LE(offset: number): number {
    return this.view(offset).getInt32(0, true);
  }

  writeUInt8(value: number, offset = 0): number {
    this[offset] = value & 0xff;
    return offset + 1;
  }

  writeUInt16BE(value: number, offset = 0): number {
    this[offset] = (value >>> 8) & 0xff;
    this[offset + 1] = value & 0xff;
    return offset + 2;
  }

  writeUInt16LE(value: number, offset = 0): number {
    this[offset] = value & 0xff;
    this[offset + 1] = (value >>> 8) & 0xff;
    return offset + 2;
  }

  writeUInt32BE(value: number, offset = 0): number {
    this[offset] = (value >>> 24) & 0xff;
    this[offset + 1] = (value >>> 16) & 0xff;
    this[offset + 2] = (value >>> 8) & 0xff;
    this[offset + 3] = value & 0xff;
    return offset + 4;
  }

  writeUInt32LE(value: number, offset = 0): number {
    this[offset] = value & 0xff;
    this[offset + 1] = (value >>> 8) & 0xff;
    this[offset + 2] = (value >>> 16) & 0xff;
    this[offset + 3] = (value >>> 24) & 0xff;
    return offset + 4;
  }

  writeInt16BE(value: number, offset = 0): number {
    return this.writeUInt16BE(value & 0xffff, offset);
  }

  writeInt16LE(value: number, offset = 0): number {
    return this.writeUInt16LE(value & 0xffff, offset);
  }

  writeInt32BE(value: number, offset = 0): number {
    return this.writeUInt32BE(value >>> 0, offset);
  }

  writeInt32LE(value: number, offset = 0): number {
    return this.writeUInt32LE(value >>> 0, offset);
  }

  write(string: string, offset = 0, length = string.length, encoding = 'utf8'): number {
    const bytes = stringBytes(string, encoding);
    if (!bytes) throw new TypeError(`Unknown encoding: ${encoding}`);
    const n = Math.min(length, bytes.length, this.length - offset);
    this.set(bytes.subarray(0, n), offset);
    return n;
  }

  copy(target: Uint8Array, targetStart = 0, sourceStart = 0, sourceEnd = this.length): number {
    const n = Math.min(sourceEnd - sourceStart, target.length - targetStart);
    target.set(this.subarray(sourceStart, sourceStart + n), targetStart);
    return n;
  }

  indexOf(needle: Uint8Array | number | string, offset = 0, encoding?: string): number {
    if (typeof needle === 'number') {
      for (let i = offset; i < this.length; i++) {
        if (this[i] === (needle & 0xff)) return i;
      }
      return -1;
    }
    const hay = typeof needle === 'string' ? stringBytes(needle, encoding ?? 'utf8') : needle;
    if (!hay) return -1;
    if (hay.length === 0) return offset;
    outer:
    for (let i = offset; i <= this.length - hay.length; i++) {
      for (let j = 0; j < hay.length; j++) {
        if (this[i + j] !== hay[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  lastIndexOf(needle: Uint8Array | number | string, offset = this.length, encoding?: string): number {
    if (typeof needle === 'number') {
      for (let i = offset - 1; i >= 0; i--) {
        if (this[i] === (needle & 0xff)) return i;
      }
      return -1;
    }
    const hay = typeof needle === 'string' ? stringBytes(needle, encoding ?? 'utf8') : needle;
    if (!hay) return -1;
    for (let i = Math.min(offset, this.length) - hay.length; i >= 0; i--) {
      let match = true;
      for (let j = 0; j < hay.length; j++) {
        if (this[i + j] !== hay[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
    return -1;
  }

  equals(other: Uint8Array): boolean {
    if (this.length !== other.length) return false;
    for (let i = 0; i < this.length; i++) {
      if (this[i] !== other[i]) return false;
    }
    return true;
  }
}

/** Install the page-world Buffer if no global Buffer exists (idempotent). */
export function installBufferPolyfill(): void {
  if (typeof (globalThis as { Buffer?: unknown }).Buffer !== 'undefined') return;
  (BufferShim as unknown as Record<string, unknown>).Buffer = BufferShim;
  (globalThis as Record<string, unknown>).Buffer = BufferShim as unknown;
  Object.defineProperty(BufferShim.prototype, '_isNovaBuffer', { value: true, writable: false });
}