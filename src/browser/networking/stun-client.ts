/**
 * @file src/browser/networking/stun-client.ts
 *
 * A minimal STUN client (RFC 5389 subset) over UDP.
 *
 * This is the real networking primitive underneath ICE candidate gathering
 * and connectivity checks (see ice-agent.ts) — it sends a genuine STUN
 * Binding Request over a real UDP socket (owned by the main process behind
 * the socket-owner wire, surfaced to the renderer as an IDgramHandle) and
 * parses a genuine Binding Response,
 * including the XOR-MAPPED-ADDRESS attribute that reveals the sender's
 * public IP:port as seen by the STUN server (or by a peer, for connectivity
 * checks — STUN binding requests are also how ICE peers confirm a candidate
 * pair actually works, not just used against public STUN servers).
 *
 * Scope: Binding Request/Response only (no STUN authentication, no TURN
 * ALLOCATE — TURN relay candidates are out of scope for this phase, see
 * doc/webrtc-implementation-plan.md).
 *
 * BYTE REPRESENTATION (2026-09-06): this file was converted from `Buffer` to
 * plain `Uint8Array` + the pure codecs in `byte-codecs.ts`, matching what the
 * TCP/TLS side (`socket-handle.ts`/`socket-proxy.ts`) already did in Phase 2.
 * It no longer touches the Node `Buffer` global at all — safe under
 * `contextIsolation: true` with no polyfill dependency, same as the rest of
 * the dgram/UDP path (dgram-handle.ts, ice-agent.ts, quic-transport.ts) after
 * that same pass.
 *
 * https://www.rfc-editor.org/rfc/rfc5389
 */

import { loadNodeBuiltin } from './node-builtins';
import { readUInt16BE, writeUInt16BE, readUInt32BE, writeUInt32BE, bytesEqual, concatBytes } from './byte-codecs';

// ── STUN wire constants (RFC 5389 §6) ───────────────────────────────────────

const MAGIC_COOKIE = 0x2112a442;
const HEADER_LENGTH = 20;

const enum StunMessageType {
  BindingRequest = 0x0001,
  BindingSuccessResponse = 0x0101,
  BindingErrorResponse = 0x0111,
}

const enum StunAttributeType {
  MappedAddress = 0x0001,
  XorMappedAddress = 0x0020,
  ErrorCode = 0x0009,
  Software = 0x8022,
}

const ADDRESS_FAMILY_IPV4 = 0x01;
const ADDRESS_FAMILY_IPV6 = 0x02;

// The 96-bit STUN magic cookie, as a reusable 4-byte array, used to XOR
// IP addresses in XOR-MAPPED-ADDRESS (RFC 5389 §15.2).
//
// Lazily computed (not at module scope) purely out of habit from the
// Buffer-era version of this file — a plain Uint8Array has no such
// availability concern, but there's no harm in keeping the laziness.
let _magicCookieBytes: Uint8Array | null = null;
function magicCookieBytes(): Uint8Array {
  if (!_magicCookieBytes) {
    const b = new Uint8Array(4);
    writeUInt32BE(b, MAGIC_COOKIE, 0);
    _magicCookieBytes = b;
  }
  return _magicCookieBytes;
}

export interface StunAddress {
  readonly family: 4 | 6;
  readonly address: string;
  readonly port: number;
}

export interface StunMessage {
  readonly type: number;
  readonly transactionId: Uint8Array;
  readonly attributes: Map<number, Uint8Array>;
}

export class StunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StunError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Transaction ID ───────────────────────────────────────────────────────────

function randomTransactionId(): Uint8Array {
  const crypto = loadNodeBuiltin<typeof import('node:crypto')>('node:crypto');
  if (crypto) return new Uint8Array(crypto.randomBytes(12));
  // Fallback (non-cryptographic — only used if the crypto builtin is somehow
  // unavailable, which shouldn't happen inside Electron's preload bridge).
  const buf = new Uint8Array(12);
  for (let i = 0; i < 12; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}

// ── Encoding ──────────────────────────────────────────────────────────────

/** Encodes a STUN Binding Request. Returns the packet and the transaction ID to match against the response. */
export function encodeBindingRequest(transactionId: Uint8Array = randomTransactionId()): { packet: Uint8Array; transactionId: Uint8Array } {
  if (transactionId.length !== 12) {
    throw new StunError(`STUN transaction ID must be 12 bytes, got ${transactionId.length}`);
  }
  const header = new Uint8Array(HEADER_LENGTH);
  writeUInt16BE(header, StunMessageType.BindingRequest, 0);
  writeUInt16BE(header, 0, 2); // message length — no attributes in a bare binding request
  writeUInt32BE(header, MAGIC_COOKIE, 4);
  header.set(transactionId, 8);
  return { packet: header, transactionId };
}

/** Encodes a STUN Binding Success Response carrying an XOR-MAPPED-ADDRESS for `mappedAddress`. */
export function encodeBindingSuccessResponse(transactionId: Uint8Array, mappedAddress: StunAddress): Uint8Array {
  const attr = encodeXorMappedAddress(mappedAddress, transactionId);
  const header = new Uint8Array(HEADER_LENGTH);
  writeUInt16BE(header, StunMessageType.BindingSuccessResponse, 0);
  writeUInt16BE(header, attr.length, 2);
  writeUInt32BE(header, MAGIC_COOKIE, 4);
  header.set(transactionId, 8);
  return concatBytes([header, attr]);
}

function encodeXorMappedAddress(addr: StunAddress, _transactionId: Uint8Array): Uint8Array {
  if (addr.family !== 4) {
    throw new StunError('Only IPv4 XOR-MAPPED-ADDRESS encoding is implemented');
  }
  const value = new Uint8Array(8);
  value[0] = 0;
  value[1] = ADDRESS_FAMILY_IPV4;
  const xport = addr.port ^ (MAGIC_COOKIE >>> 16);
  writeUInt16BE(value, xport, 2);
  const ipParts = addr.address.split('.').map(Number);
  if (ipParts.length !== 4 || ipParts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    throw new StunError(`Invalid IPv4 address: ${addr.address}`);
  }
  for (let i = 0; i < 4; i++) {
    value[4 + i] = ipParts[i]! ^ magicCookieBytes()[i]!;
  }
  const header = new Uint8Array(4);
  writeUInt16BE(header, StunAttributeType.XorMappedAddress, 0);
  writeUInt16BE(header, value.length, 2);
  return concatBytes([header, value]);
}

// ── Decoding ──────────────────────────────────────────────────────────────

/** Returns null (rather than throwing) for anything that isn't a well-formed STUN message — callers use this to demux STUN packets from other traffic on a shared UDP socket. */
export function decodeStunMessage(buf: Uint8Array): StunMessage | null {
  if (buf.length < HEADER_LENGTH) return null;
  // Top 2 bits of a STUN message are always 0 (RFC 5389 §6) — this is the
  // primary demux signal when STUN shares a socket with other traffic.
  if ((buf[0]! & 0xc0) !== 0) return null;

  const type = readUInt16BE(buf, 0);
  const length = readUInt16BE(buf, 2);
  const cookie = readUInt32BE(buf, 4);
  if (cookie !== MAGIC_COOKIE) return null;
  if (HEADER_LENGTH + length > buf.length) return null;

  const transactionId = buf.slice(8, 20);
  const attributes = new Map<number, Uint8Array>();

  let offset = HEADER_LENGTH;
  const end = HEADER_LENGTH + length;
  while (offset + 4 <= end) {
    const attrType = readUInt16BE(buf, offset);
    const attrLength = readUInt16BE(buf, offset + 2);
    const valueStart = offset + 4;
    const valueEnd = valueStart + attrLength;
    if (valueEnd > end) break;
    attributes.set(attrType, buf.slice(valueStart, valueEnd));
    // Attributes are padded to a 4-byte boundary.
    offset = valueStart + attrLength + ((4 - (attrLength % 4)) % 4);
  }

  return { type, transactionId, attributes };
}

/** Parses XOR-MAPPED-ADDRESS (preferred) or falls back to legacy MAPPED-ADDRESS. IPv4 only. */
export function parseMappedAddress(message: StunMessage): StunAddress | null {
  const xor = message.attributes.get(StunAttributeType.XorMappedAddress);
  if (xor && xor.length >= 8) {
    const family = xor[1]!;
    if (family !== ADDRESS_FAMILY_IPV4) return null;
    const port = readUInt16BE(xor, 2) ^ (MAGIC_COOKIE >>> 16);
    const octets = [0, 1, 2, 3].map((i) => xor[4 + i]! ^ magicCookieBytes()[i]!);
    return { family: 4, address: octets.join('.'), port };
  }

  const mapped = message.attributes.get(StunAttributeType.MappedAddress);
  if (mapped && mapped.length >= 8) {
    const family = mapped[1]!;
    if (family !== ADDRESS_FAMILY_IPV4) return null;
    const port = readUInt16BE(mapped, 2);
    const octets = [0, 1, 2, 3].map((i) => mapped[4 + i]!);
    return { family: 4, address: octets.join('.'), port };
  }

  return null;
}

// ── UDP transport ─────────────────────────────────────────────────────────

/**
 * The sender/responder surface stunBindingRequest needs. Every member exists
 * on both a renderer-side {@link IDgramHandle} (the socket-owner wire) and a
 * real `node:dgram` socket — the latter keeps tests able to put a real socket
 * on the other end of the loopback wire, and lets the responder role run on a
 * real peer process.
 */
export interface StunSocket {
  on(evt: 'message', handler: (msg: Uint8Array, rinfo: { address: string; port: number }) => void): unknown;
  on(evt: 'error', handler: (err: Error) => void): unknown;
  once(evt: 'error', handler: (err: Error) => void): unknown;
  removeListener(evt: 'message', handler: (msg: Uint8Array, rinfo: { address: string; port: number }) => void): unknown;
  removeListener(evt: 'error', handler: (err: Error) => void): unknown;
  send(data: Uint8Array, port?: number, address?: string): unknown;
}

/**
 * Sends a Binding Request on an already-bound dgram socket and resolves with
 * the responder's XOR-MAPPED-ADDRESS. Retries with exponential backoff (RFC
 * 5389 §7.2.1's Ti/Rc schedule, simplified) since STUN runs over unreliable
 * UDP and a lost request/response must not hang the caller forever.
 */
export function stunBindingRequest(
  socket: StunSocket,
  host: string,
  port: number,
  options: { timeoutMs?: number; retries?: number } = {},
): Promise<StunAddress> {
  const { timeoutMs = 500, retries = 3 } = options;
  const { packet, transactionId } = encodeBindingRequest();

  return new Promise((resolve, reject) => {
    let sends = 0; // number of packets actually sent (initial send + retries)
    let settled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const onMessage = (msg: Uint8Array, rinfo: { address: string; port: number }) => {
      if (settled) return;
      const parsed = decodeStunMessage(msg);
      if (!parsed) return;
      if (!bytesEqual(parsed.transactionId, transactionId)) return; // not our transaction
      if (parsed.type !== StunMessageType.BindingSuccessResponse) {
        settle(() => reject(new StunError(`STUN request to ${host}:${port} was rejected (type=0x${parsed.type.toString(16)})`)));
        return;
      }
      const mapped = parseMappedAddress(parsed);
      if (!mapped) {
        settle(() => reject(new StunError('STUN Binding Success Response had no usable mapped address')));
        return;
      }
      settle(() => resolve(mapped));
    };

    const onSocketError = (err: Error) => {
      settle(() => reject(new StunError(`STUN request to ${host}:${port} failed: ${err.message}`)));
    };

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket.removeListener('message', onMessage);
      socket.removeListener('error', onSocketError);
      fn();
    };

    const send = () => {
      try {
        socket.send(packet, port, host);
      } catch (err) {
        settle(() => reject(new StunError(`Failed to send STUN request: ${err instanceof Error ? err.message : String(err)}`)));
        return;
      }
      sends++;
      retryTimer = setTimeout(() => {
        if (sends <= retries) {
          send();
        } else {
          settle(() => reject(new StunError(`STUN request to ${host}:${port} timed out after ${retries} retries`)));
        }
      }, timeoutMs);
    };

    socket.on('message', onMessage);
    // Without an error listener a dgram 'error' event throws as an uncaught
    // exception and crashes the process; a socket error mid-request should
    // reject the promise instead (RFC 5389 retransmission is only about lost
    // datagrams, not fatal socket failures).
    socket.on('error', onSocketError);
    send();
  });
}

/** Responds to a STUN Binding Request received on `socket` by echoing the sender's observed address — used on the "answering" side of a peer-to-peer connectivity check, not just against public STUN servers. */
export function respondToBindingRequest(
  socket: StunSocket,
  message: StunMessage,
  observedFrom: { address: string; port: number },
): void {
  const response = encodeBindingSuccessResponse(message.transactionId, {
    family: 4,
    address: observedFrom.address,
    port: observedFrom.port,
  });
  socket.send(response, observedFrom.port, observedFrom.address);
}

export { StunMessageType, StunAttributeType, MAGIC_COOKIE };
