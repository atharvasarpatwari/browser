/**
 * @file src/common/ipc/serializer.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Safe serialization and deserialization of IPC messages for transport across
 * process boundaries. Uses a pre-process/post-process approach to handle types
 * that JSON.stringify drops (undefined, Date, RegExp, Map, Set, ArrayBuffer,
 * Error) — because JSON.stringify calls toJSON() BEFORE the replacer, which
 * means Date objects become strings before the replacer ever sees them.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 *  Abstraction      ISerializer hides the encoding format.
 *  Encapsulation    Encoding details are private.
 *  Single-Resp.     This module only serializes/deserializes — nothing else.
 */

import type { IPCMessage, SerializedError } from './message';
import { deserializeError, serializeError } from './message';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface ISerializer {
  /** Serialize an IPC message to a transportable format (e.g., string or Buffer). */
  encode(message: IPCMessage): string;
  /** Deserialize a transportable format back to an IPC message. */
  decode(data: string): IPCMessage;
  /** Check if data is a valid IPC message shape. */
  is_valid(data: unknown): data is IPCMessage;
}

// ─────────────────────────────────────────────────────────────────────────────
// TYPE TAGS FOR SPECIAL VALUES
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_TAG = '__ipc_type__';

type SpecialType =
  | 'undefined'
  | 'date'
  | 'regexp'
  | 'map'
  | 'set'
  | 'error'
  | 'arraybuffer'
  | 'bigint';

interface TaggedValue {
  [TYPE_TAG]: SpecialType;
  value: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-PROCESS (encode side)
// Walks the object tree and wraps special values with type tags
// BEFORE JSON.stringify runs, avoiding the toJSON() trap.
// ─────────────────────────────────────────────────────────────────────────────

function preprocess(value: unknown): unknown {
  if (value === undefined) {
    return { [TYPE_TAG]: 'undefined', value: null } as TaggedValue;
  }
  if (value === null) {
    return null;
  }
  if (value instanceof Date) {
    return { [TYPE_TAG]: 'date', value: value.toISOString() } as TaggedValue;
  }
  if (value instanceof RegExp) {
    return { [TYPE_TAG]: 'regexp', value: { source: value.source, flags: value.flags } } as TaggedValue;
  }
  if (value instanceof Map) {
    return { [TYPE_TAG]: 'map', value: [...value].map(([k, v]) => [preprocess(k), preprocess(v)]) } as TaggedValue;
  }
  if (value instanceof Set) {
    return { [TYPE_TAG]: 'set', value: [...value].map(v => preprocess(v)) } as TaggedValue;
  }
  if (value instanceof Error) {
    return { [TYPE_TAG]: 'error', value: serializeError(value) } as TaggedValue;
  }
  if (value instanceof ArrayBuffer) {
    const bytes = new Uint8Array(value);
    return { [TYPE_TAG]: 'arraybuffer', value: Array.from(bytes) } as TaggedValue;
  }
  if (typeof value === 'bigint') {
    return { [TYPE_TAG]: 'bigint', value: value.toString() } as TaggedValue;
  }
  if (Array.isArray(value)) {
    return value.map(item => preprocess(item));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = preprocess(v);
    }
    return result;
  }
  // Primitives (string, number, boolean) pass through unchanged
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST-PROCESS (decode side)
// Walks the parsed JSON tree and reconstructs special values from type tags.
// Handles undefined by setting properties on the parent object.
// ─────────────────────────────────────────────────────────────────────────────

function postprocess(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => postprocess(item));
  }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;

    // Check for tagged values
    if (TYPE_TAG in obj) {
      const tagged = obj as unknown as TaggedValue;
      switch (tagged[TYPE_TAG]) {
        case 'undefined':
          return undefined;
        case 'date':
          return new Date(tagged.value as string);
        case 'regexp': {
          const { source, flags } = tagged.value as { source: string; flags: string };
          return new RegExp(source, flags);
        }
        case 'map':
          return new Map(
            (tagged.value as [unknown, unknown][]).map(
              ([k, v]) => [postprocess(k), postprocess(v)] as [unknown, unknown],
            ),
          );
        case 'set':
          return new Set((tagged.value as unknown[]).map(v => postprocess(v)));
        case 'error':
          return deserializeError(tagged.value as SerializedError);
        case 'arraybuffer':
          return new Uint8Array(tagged.value as number[]).buffer;
        case 'bigint':
          return BigInt(tagged.value as string);
        default:
          return obj;
      }
    }

    // Regular object — recurse into properties
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      const processed = postprocess(v);
      if (processed === undefined) {
        // JSON.parse deletes keys when reviver returns undefined,
        // but we use a plain parse + postprocess, so we just set it
        result[k] = undefined;
      } else {
        result[k] = processed;
      }
    }
    return result;
  }
  return value;
}

// ─────────────────────────────────────────────────────────────────────────────
// JSON SERIALIZER
// ─────────────────────────────────────────────────────────────────────────────

class JSONSerializer implements ISerializer {
  encode(message: IPCMessage): string {
    const preprocessed = preprocess(message);
    return JSON.stringify(preprocessed);
  }

  decode(data: string): IPCMessage {
    const parsed = JSON.parse(data);
    const result = postprocess(parsed) as IPCMessage;
    if (!this.is_valid(result)) {
      throw new Error('Invalid IPC message: decoded data does not match IPCMessage shape');
    }
    return result;
  }

  is_valid(data: unknown): data is IPCMessage {
    if (typeof data !== 'object' || data === null) return false;
    const msg = data as Record<string, unknown>;
    return (
      typeof msg.id === 'string' &&
      typeof msg.channel === 'string' &&
      typeof msg.direction === 'string' &&
      typeof msg.timestamp === 'number' &&
      typeof msg.sourceProcessId === 'string' &&
      typeof msg.kind === 'string' &&
      ['fire-and-forget', 'request', 'response', 'stream-request', 'stream-chunk'].includes(msg.kind as string)
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export { JSONSerializer };
export type { ISerializer };
