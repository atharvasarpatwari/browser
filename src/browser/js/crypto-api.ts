// ─────────────────────────────────────────────────────────────────────────────
// WEB CRYPTO API — window.crypto (getRandomValues, randomUUID, subtle)
// ─────────────────────────────────────────────────────────────────────────────
//
// Real cryptographic primitives are never hand-rolled here: every operation
// delegates to Node's own spec-compliant `node:crypto` webcrypto implementation
// (loaded through the same contextIsolation-safe bridge used elsewhere —
// see node-builtins.ts). This file is purely a bridge between Nova's own
// JSValue/JSObject representation and real native JS values/Promises, mirroring
// the pattern already used in fetch-api.ts (Promise.resolve(...).then(fulfill/reject)).

import type { JSValue, JSObject, JSFunction, JSObjectWithMeta } from './values';
import { createObject, createArray, createNativeFunction, toString, toNumber, JSError } from './values';
import type { EventLoop } from './event-loop';
import { createWiredPromise, fulfillPromise, rejectPromise } from './promise';
import { wrapArrayBuffer } from './typed-arrays';
import { loadNodeBuiltin } from '../networking/node-builtins';

interface NodeSubtleCrypto {
  digest(algorithm: unknown, data: BufferSource): Promise<ArrayBuffer>;
  encrypt(algorithm: unknown, key: unknown, data: BufferSource): Promise<ArrayBuffer>;
  decrypt(algorithm: unknown, key: unknown, data: BufferSource): Promise<ArrayBuffer>;
  sign(algorithm: unknown, key: unknown, data: BufferSource): Promise<ArrayBuffer>;
  verify(algorithm: unknown, key: unknown, signature: BufferSource, data: BufferSource): Promise<boolean>;
  generateKey(algorithm: unknown, extractable: boolean, keyUsages: string[]): Promise<unknown>;
  importKey(format: string, keyData: unknown, algorithm: unknown, extractable: boolean, keyUsages: string[]): Promise<unknown>;
  exportKey(format: string, key: unknown): Promise<unknown>;
  deriveBits(algorithm: unknown, baseKey: unknown, length: number | null): Promise<ArrayBuffer>;
  deriveKey(algorithm: unknown, baseKey: unknown, derivedKeyAlgorithm: unknown, extractable: boolean, keyUsages: string[]): Promise<unknown>;
  wrapKey(format: string, key: unknown, wrappingKey: unknown, wrapAlgorithm: unknown): Promise<ArrayBuffer>;
  unwrapKey(format: string, wrappedKey: BufferSource, unwrappingKey: unknown, unwrapAlgorithm: unknown, unwrappedKeyAlgorithm: unknown, extractable: boolean, keyUsages: string[]): Promise<unknown>;
}
interface NodeWebcrypto {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
  randomUUID(): string;
  subtle: NodeSubtleCrypto;
}

function getNodeWebcrypto(): NodeWebcrypto | null {
  const nodeCrypto = loadNodeBuiltin<{ webcrypto: NodeWebcrypto }>('node:crypto');
  return nodeCrypto?.webcrypto ?? null;
}

// DOMException shim (simplified, matching fetch-api.ts's convention) — the
// runtime represents exceptions as plain "Name: message" strings.
function domException(name: string, message: string): string {
  return `${name}: ${message}`;
}

// ── CryptoKey wrapper ────────────────────────────────────────────────────────
// A CryptoKey is opaque to script — the real native key object never leaves
// this module, it's just held behind a WeakMap keyed by the wrapper JSObject.

const cryptoKeyNative = new WeakMap<JSObject, unknown>();
let cryptoKeyProto: JSObject | null = null;

function getCryptoKeyProto(): JSObject {
  if (cryptoKeyProto) return cryptoKeyProto;
  const proto = createObject(null);
  for (const prop of ['type', 'extractable', 'algorithm', 'usages'] as const) {
    proto.properties.set(prop, {
      value: undefined,
      getter: createNativeFunction(`get ${prop}`, (self) => {
        const native = cryptoKeyNative.get(self as JSObject) as Record<string, unknown> | undefined;
        return native ? toJSValue(native[prop]) : undefined;
      }),
      writable: false, enumerable: true, configurable: true,
    });
  }
  cryptoKeyProto = proto;
  return proto;
}

function wrapCryptoKey(nativeKey: unknown): JSObject {
  const obj = createObject(getCryptoKeyProto()) as JSObjectWithMeta;
  obj.__type_override = 'CryptoKey';
  cryptoKeyNative.set(obj, nativeKey);
  return obj;
}

// ── JSValue <-> native JS bridging ───────────────────────────────────────────

/** Convert a Nova JSValue (algorithm dict, BufferSource, CryptoKey, array, ...) into a real native JS value. */
function toNative(v: JSValue): unknown {
  if (v === null || v === undefined || typeof v !== 'object') return v;
  const obj = v as JSObjectWithMeta;
  if (cryptoKeyNative.has(obj)) return cryptoKeyNative.get(obj);
  if (obj.__nativeView) {
    const view = obj.__nativeView as { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  }
  if (obj.__nativeBuffer) return obj.__nativeBuffer;
  if (obj.type === 'array') {
    const len = toNumber((obj.properties.get('length')?.value ?? 0) as JSValue);
    const out: unknown[] = [];
    for (let i = 0; i < len; i++) out.push(toNative(obj.properties.get(String(i))?.value as JSValue));
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [key, prop] of obj.properties) {
    if (prop.enumerable === false) continue;
    out[key] = toNative(prop.value as JSValue);
  }
  return out;
}

/** Convert a real native JS value (a webcrypto result) into a Nova JSValue. */
function toJSValue(v: unknown): JSValue {
  if (v === null || v === undefined) return v as JSValue;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof ArrayBuffer) return wrapArrayBuffer(v);
  if (ArrayBuffer.isView(v)) {
    const view = v as ArrayBufferView;
    return wrapArrayBuffer((view.buffer as ArrayBuffer).slice(view.byteOffset, view.byteOffset + view.byteLength));
  }
  if (Array.isArray(v)) return createArray(v.map(toJSValue));
  if (typeof v === 'object') {
    const rec = v as Record<string, unknown>;
    // A native CryptoKey has no own enumerable properties at all (type/
    // extractable/algorithm/usages are prototype getters) — it must be
    // recognized and wrapped explicitly, or it silently falls through to
    // the generic dict branch below as an empty, useless object.
    if (v.constructor?.name === 'CryptoKey') return wrapCryptoKey(v);
    if ('publicKey' in rec && 'privateKey' in rec) {
      const pair = createObject(null);
      pair.properties.set('publicKey', { value: wrapCryptoKey(rec.publicKey), writable: true, enumerable: true, configurable: true });
      pair.properties.set('privateKey', { value: wrapCryptoKey(rec.privateKey), writable: true, enumerable: true, configurable: true });
      return pair;
    }
    const obj = createObject(null);
    for (const [key, val] of Object.entries(rec)) {
      obj.properties.set(key, { value: toJSValue(val), writable: true, enumerable: true, configurable: true });
    }
    return obj;
  }
  return undefined as unknown as JSValue;
}

function asyncSubtleMethod(
  eventLoop: EventLoop,
  name: string,
  invoke: (subtle: NodeSubtleCrypto, args: JSValue[]) => Promise<unknown>,
): JSFunction {
  return createNativeFunction(name, (_this, args) => {
    const p = createWiredPromise(eventLoop);
    const webcrypto = getNodeWebcrypto();
    if (!webcrypto) {
      rejectPromise(p, domException('NotSupportedError', 'crypto.subtle is not available in this context'));
      return p;
    }
    try {
      Promise.resolve(invoke(webcrypto.subtle, args)).then(
        (result) => fulfillPromise(p, toJSValue(result)),
        (err) => rejectPromise(p, domException('OperationError', err instanceof Error ? err.message : String(err))),
      );
    } catch (err) {
      rejectPromise(p, domException('OperationError', err instanceof Error ? err.message : String(err)));
    }
    return p;
  });
}

export function createSubtleCryptoObject(eventLoop: EventLoop): JSObject {
  const subtle = createObject(null);
  const def = (name: string, fn: JSFunction): void => {
    subtle.properties.set(name, { value: fn, writable: true, enumerable: true, configurable: true });
  };

  def('digest', asyncSubtleMethod(eventLoop, 'digest', (s, a) =>
    s.digest(toNative(a[0]), toNative(a[1]) as BufferSource)));

  def('encrypt', asyncSubtleMethod(eventLoop, 'encrypt', (s, a) =>
    s.encrypt(toNative(a[0]), toNative(a[1]), toNative(a[2]) as BufferSource)));

  def('decrypt', asyncSubtleMethod(eventLoop, 'decrypt', (s, a) =>
    s.decrypt(toNative(a[0]), toNative(a[1]), toNative(a[2]) as BufferSource)));

  def('sign', asyncSubtleMethod(eventLoop, 'sign', (s, a) =>
    s.sign(toNative(a[0]), toNative(a[1]), toNative(a[2]) as BufferSource)));

  def('verify', asyncSubtleMethod(eventLoop, 'verify', (s, a) =>
    s.verify(toNative(a[0]), toNative(a[1]), toNative(a[2]) as BufferSource, toNative(a[3]) as BufferSource)));

  def('generateKey', asyncSubtleMethod(eventLoop, 'generateKey', (s, a) =>
    s.generateKey(toNative(a[0]), Boolean(a[1]), toNative(a[2]) as string[])));

  def('importKey', asyncSubtleMethod(eventLoop, 'importKey', (s, a) =>
    s.importKey(toString(a[0]), toNative(a[1]), toNative(a[2]), Boolean(a[3]), toNative(a[4]) as string[])));

  def('exportKey', asyncSubtleMethod(eventLoop, 'exportKey', (s, a) =>
    s.exportKey(toString(a[0]), toNative(a[1]))));

  def('deriveBits', asyncSubtleMethod(eventLoop, 'deriveBits', (s, a) =>
    s.deriveBits(toNative(a[0]), toNative(a[1]), a[2] == null ? null : toNumber(a[2]))));

  def('deriveKey', asyncSubtleMethod(eventLoop, 'deriveKey', (s, a) =>
    s.deriveKey(toNative(a[0]), toNative(a[1]), toNative(a[2]), Boolean(a[3]), toNative(a[4]) as string[])));

  def('wrapKey', asyncSubtleMethod(eventLoop, 'wrapKey', (s, a) =>
    s.wrapKey(toString(a[0]), toNative(a[1]), toNative(a[2]), toNative(a[3]))));

  def('unwrapKey', asyncSubtleMethod(eventLoop, 'unwrapKey', (s, a) =>
    s.unwrapKey(
      toString(a[0]), toNative(a[1]) as BufferSource, toNative(a[2]),
      toNative(a[3]), toNative(a[4]), Boolean(a[5]), toNative(a[6]) as string[],
    )));

  return subtle;
}

export function createCryptoObject(eventLoop: EventLoop): JSObject {
  const crypto = createObject(null);

  crypto.properties.set('subtle', {
    value: createSubtleCryptoObject(eventLoop),
    writable: false, enumerable: true, configurable: false,
  });

  crypto.properties.set('getRandomValues', {
    value: createNativeFunction('getRandomValues', (_this, args) => {
      const target = args[0] as JSObjectWithMeta | undefined;
      const view = target?.__nativeView as { buffer: ArrayBuffer; byteOffset: number; byteLength: number } | undefined;
      if (!view) throw new JSError('TypeError: getRandomValues() requires an integer-typed ArrayBufferView');
      if (view.byteLength > 65536) {
        throw new JSError('QuotaExceededError: getRandomValues() can only fill up to 65536 bytes at a time');
      }
      const webcrypto = getNodeWebcrypto();
      if (!webcrypto) throw new JSError('NotSupportedError: crypto.getRandomValues is not available in this context');
      webcrypto.getRandomValues(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
      return target as JSValue;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  crypto.properties.set('randomUUID', {
    value: createNativeFunction('randomUUID', () => {
      const webcrypto = getNodeWebcrypto();
      if (!webcrypto) throw new JSError('NotSupportedError: crypto.randomUUID is not available in this context');
      return webcrypto.randomUUID();
    }),
    writable: true, enumerable: true, configurable: true,
  });

  return crypto;
}
