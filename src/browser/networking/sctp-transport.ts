/**
 * @file src/browser/networking/sctp-transport.ts
 *
 * SCTP (RFC 4960) association + reliable multiplexed streams, scoped to
 * WebRTC Phase 2 sub-phase 2.2 (`doc/2026-09-14-webrtc-phase2-dtls-sctp-plan.md`).
 * Sits directly above whatever datagram transport hands it bytes — in this
 * phase that's a raw UDP socket (see `tests/sctp-transport.test.ts`); phase
 * 2.3 reparents it onto the DTLS record layer (`dtls/`) instead.
 *
 * Implements: four-way association setup (INIT/INIT-ACK/COOKIE-ECHO/
 * COOKIE-ACK), DATA chunk fragmentation/reassembly (ordered + unordered),
 * cumulative + gap-ack SACKs, and TSN-timeout retransmission. CRC32c
 * (Castagnoli) checksums the whole packet per RFC 4960 §6.8 — a distinct
 * polynomial/table from the plain CRC32 already used elsewhere in this repo
 * (`canvas-context.ts`).
 *
 * ponytail: no fast-retransmit (3-dup-SACK rule), no congestion control
 * (cwnd), no chunk bundling (one DATA chunk per UDP datagram), and the
 * COOKIE_ECHO state cookie isn't HMAC-authenticated (no SYN-flood defense —
 * moot here since SCTP runs atop an already-authenticated DTLS channel in
 * real use). All of these are explicitly sanctioned simplifications in the
 * phase-2.2 plan ("basic TSN window/RTX with a conservative cwnd is enough
 * for correct interop"); upgrade trigger is real-world throughput/loss
 * measurements in the 2.4 interop gate, not a known correctness gap.
 */

import { concatBytes, readUInt16BE, writeUInt16BE, readUInt32BE, writeUInt32BE } from './byte-codecs';

/* -------------------------------------------------------------------------- */
/*  CRC32c (Castagnoli) — RFC 3309 / RFC 4960 §6.8                           */
/* -------------------------------------------------------------------------- */

const CRC32C_POLY_REFLECTED = 0x82f63b78;

function buildCrc32cTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) {
      c = c & 1 ? CRC32C_POLY_REFLECTED ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32C_TABLE = buildCrc32cTable();

/** CRC32c (Castagnoli) over `bytes`. Verified against the standard test vector `crc32c("123456789") === 0xE3069283`. */
export function crc32c(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32C_TABLE[(crc ^ bytes[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/* -------------------------------------------------------------------------- */
/*  Small local helpers (little-endian 32-bit — only the checksum field uses */
/*  this; every other SCTP field is big-endian, via byte-codecs).           */
/* -------------------------------------------------------------------------- */

function writeUInt32LE(out: Uint8Array, value: number, offset: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function pad4(bytes: Uint8Array): Uint8Array {
  const rem = bytes.length % 4;
  if (rem === 0) return bytes;
  return concatBytes([bytes, new Uint8Array(4 - rem)]);
}

/* -------------------------------------------------------------------------- */
/*  Common header (RFC 4960 §3.1) + whole-packet framing                     */
/* -------------------------------------------------------------------------- */

const COMMON_HEADER_LEN = 12;

export interface SctpPacketHeader {
  srcPort: number;
  dstPort: number;
  verificationTag: number;
}

function buildPacket(header: SctpPacketHeader, chunks: Uint8Array[]): Uint8Array {
  const body = concatBytes(chunks);
  const packet = new Uint8Array(COMMON_HEADER_LEN + body.length);
  writeUInt16BE(packet, header.srcPort, 0);
  writeUInt16BE(packet, header.dstPort, 2);
  writeUInt32BE(packet, header.verificationTag, 4);
  // checksum field (bytes 8..11) left zero for the CRC32c computation
  packet.set(body, COMMON_HEADER_LEN);
  const checksum = crc32c(packet);
  writeUInt32LE(packet, checksum, 8);
  return packet;
}

export interface ParsedChunk {
  type: number;
  flags: number;
  value: Uint8Array;
}

export interface ParsedPacket {
  srcPort: number;
  dstPort: number;
  verificationTag: number;
  checksumValid: boolean;
  chunks: ParsedChunk[];
}

function parsePacket(bytes: Uint8Array): ParsedPacket {
  if (bytes.length < COMMON_HEADER_LEN) throw new Error('parsePacket: truncated common header');
  const srcPort = readUInt16BE(bytes, 0);
  const dstPort = readUInt16BE(bytes, 2);
  const verificationTag = readUInt32BE(bytes, 4);
  const claimedChecksum = readUInt32LE(bytes, 8);

  const zeroed = bytes.slice();
  writeUInt32LE(zeroed, 0, 8);
  const checksumValid = crc32c(zeroed) === claimedChecksum;

  const chunks: ParsedChunk[] = [];
  let offset = COMMON_HEADER_LEN;
  while (offset + 4 <= bytes.length) {
    const type = bytes[offset]!;
    const flags = bytes[offset + 1]!;
    const length = readUInt16BE(bytes, offset + 2);
    if (length < 4 || offset + length > bytes.length) break; // truncated/malformed trailing chunk
    const value = bytes.subarray(offset + 4, offset + length);
    chunks.push({ type, flags, value });
    offset += length + ((4 - (length % 4)) % 4); // chunks are padded to a 4-byte boundary
  }
  return { srcPort, dstPort, verificationTag, checksumValid, chunks };
}

function buildChunk(type: number, flags: number, value: Uint8Array): Uint8Array {
  const length = 4 + value.length;
  const header = new Uint8Array(4);
  header[0] = type;
  header[1] = flags;
  writeUInt16BE(header, length, 2);
  return pad4(concatBytes([header, value]));
}

/* -------------------------------------------------------------------------- */
/*  Chunk types (RFC 4960 §3.2) and WebRTC data-channel PPIDs (RFC 8831 §8)   */
/* -------------------------------------------------------------------------- */

const ChunkType = {
  DATA: 0,
  INIT: 1,
  INIT_ACK: 2,
  SACK: 3,
  COOKIE_ECHO: 10,
  COOKIE_ACK: 11,
} as const;

export const PPID_DCEP = 50;
export const PPID_WEBRTC_STRING = 51;
export const PPID_WEBRTC_BINARY_PARTIAL = 52; // deprecated by RFC 8831, defined for completeness
export const PPID_WEBRTC_BINARY = 53;

const DATA_FLAG_UNORDERED = 0x04;
const DATA_FLAG_BEGIN = 0x02;
const DATA_FLAG_END = 0x01;

const DEFAULT_SCTP_PORT = 5000;
/** Keeps a 20KB test message well-fragmented without depending on real MTU discovery (out of scope here). */
const MAX_USER_DATA_PER_FRAGMENT = 1200;
const RTO_MS = 300;
const RTX_CHECK_INTERVAL_MS = 100;

/* -------------------------------------------------------------------------- */
/*  INIT / INIT ACK / COOKIE_ECHO / COOKIE_ACK                                */
/* -------------------------------------------------------------------------- */

interface InitFields {
  initiateTag: number;
  aRwnd: number;
  outboundStreams: number;
  inboundStreams: number;
  initialTsn: number;
}

function buildInitFields(f: InitFields): Uint8Array {
  const out = new Uint8Array(16);
  writeUInt32BE(out, f.initiateTag, 0);
  writeUInt32BE(out, f.aRwnd, 4);
  writeUInt16BE(out, f.outboundStreams, 8);
  writeUInt16BE(out, f.inboundStreams, 10);
  writeUInt32BE(out, f.initialTsn, 12);
  return out;
}

function parseInitFields(value: Uint8Array): InitFields {
  return {
    initiateTag: readUInt32BE(value, 0),
    aRwnd: readUInt32BE(value, 4),
    outboundStreams: readUInt16BE(value, 8),
    inboundStreams: readUInt16BE(value, 10),
    initialTsn: readUInt32BE(value, 12),
  };
}

const STATE_COOKIE_PARAM_TYPE = 0x0007;

function buildTlvParam(type: number, value: Uint8Array): Uint8Array {
  const header = new Uint8Array(4);
  writeUInt16BE(header, type, 0);
  writeUInt16BE(header, 4 + value.length, 2);
  return pad4(concatBytes([header, value]));
}

function buildInitChunk(f: InitFields): Uint8Array {
  return buildChunk(ChunkType.INIT, 0, buildInitFields(f));
}

function buildInitAckChunk(f: InitFields, stateCookie: Uint8Array): Uint8Array {
  const value = concatBytes([buildInitFields(f), buildTlvParam(STATE_COOKIE_PARAM_TYPE, stateCookie)]);
  return buildChunk(ChunkType.INIT_ACK, 0, value);
}

function parseInitAckChunk(value: Uint8Array): { init: InitFields; stateCookie: Uint8Array } {
  const init = parseInitFields(value);
  let offset = 16;
  let stateCookie: Uint8Array = new Uint8Array(0);
  while (offset + 4 <= value.length) {
    const type = readUInt16BE(value, offset);
    const length = readUInt16BE(value, offset + 2);
    const paramValue = value.subarray(offset + 4, offset + length);
    if (type === STATE_COOKIE_PARAM_TYPE) stateCookie = paramValue;
    offset += length + ((4 - (length % 4)) % 4);
  }
  return { init, stateCookie };
}

function buildCookieEchoChunk(cookie: Uint8Array): Uint8Array {
  return buildChunk(ChunkType.COOKIE_ECHO, 0, cookie);
}

function buildCookieAckChunk(): Uint8Array {
  return buildChunk(ChunkType.COOKIE_ACK, 0, new Uint8Array(0));
}

/* -------------------------------------------------------------------------- */
/*  DATA                                                                      */
/* -------------------------------------------------------------------------- */

interface DataChunk {
  tsn: number;
  streamId: number;
  ssn: number;
  ppid: number;
  payload: Uint8Array;
  begin: boolean;
  end: boolean;
  unordered: boolean;
}

function buildDataChunk(chunk: DataChunk): Uint8Array {
  const header = new Uint8Array(12);
  writeUInt32BE(header, chunk.tsn, 0);
  writeUInt16BE(header, chunk.streamId, 4);
  writeUInt16BE(header, chunk.ssn, 6);
  writeUInt32BE(header, chunk.ppid, 8);
  let flags = 0;
  if (chunk.unordered) flags |= DATA_FLAG_UNORDERED;
  if (chunk.begin) flags |= DATA_FLAG_BEGIN;
  if (chunk.end) flags |= DATA_FLAG_END;
  return buildChunk(ChunkType.DATA, flags, concatBytes([header, chunk.payload]));
}

function parseDataChunk(raw: ParsedChunk): DataChunk {
  const value = raw.value;
  return {
    tsn: readUInt32BE(value, 0),
    streamId: readUInt16BE(value, 4),
    ssn: readUInt16BE(value, 6),
    ppid: readUInt32BE(value, 8),
    payload: value.subarray(12),
    unordered: (raw.flags & DATA_FLAG_UNORDERED) !== 0,
    begin: (raw.flags & DATA_FLAG_BEGIN) !== 0,
    end: (raw.flags & DATA_FLAG_END) !== 0,
  };
}

/* -------------------------------------------------------------------------- */
/*  SACK                                                                      */
/* -------------------------------------------------------------------------- */

interface GapAckBlock {
  start: number; // offset from cumulativeTsnAck
  end: number;
}

interface SackFields {
  cumulativeTsnAck: number;
  aRwnd: number;
  gapAckBlocks: GapAckBlock[];
}

function buildSackChunk(f: SackFields): Uint8Array {
  const header = new Uint8Array(8);
  writeUInt32BE(header, f.cumulativeTsnAck, 0);
  writeUInt32BE(header, f.aRwnd, 4);
  const counts = new Uint8Array(4);
  writeUInt16BE(counts, f.gapAckBlocks.length, 0);
  writeUInt16BE(counts, 0, 2); // number of duplicate TSNs — not tracked (RTO-only RTX, no dup detection reporting)
  const blocks = new Uint8Array(f.gapAckBlocks.length * 4);
  f.gapAckBlocks.forEach((block, i) => {
    writeUInt16BE(blocks, block.start, i * 4);
    writeUInt16BE(blocks, block.end, i * 4 + 2);
  });
  return buildChunk(ChunkType.SACK, 0, concatBytes([header, counts, blocks]));
}

function parseSackChunk(value: Uint8Array): SackFields {
  const cumulativeTsnAck = readUInt32BE(value, 0);
  const aRwnd = readUInt32BE(value, 4);
  const numGapBlocks = readUInt16BE(value, 8);
  const gapAckBlocks: GapAckBlock[] = [];
  let offset = 12;
  for (let i = 0; i < numGapBlocks; i++) {
    gapAckBlocks.push({ start: readUInt16BE(value, offset), end: readUInt16BE(value, offset + 2) });
    offset += 4;
  }
  return { cumulativeTsnAck, aRwnd, gapAckBlocks };
}

/* -------------------------------------------------------------------------- */
/*  Association                                                               */
/* -------------------------------------------------------------------------- */

export type SctpRole = 'client' | 'server';

export interface SctpAssociationOptions {
  role: SctpRole;
  send: (bytes: Uint8Array) => void;
  /** Called once per fully-reassembled, in-order-delivered message. */
  onMessage?: (streamId: number, ppid: number, data: Uint8Array) => void;
}

interface OutstandingChunk {
  bytes: Uint8Array;
  sentAt: number;
}

interface ReassemblyState {
  fragments: Map<number, DataChunk>; // keyed by TSN
}

export class SctpAssociation {
  private readonly role: SctpRole;
  private readonly sendBytes: (bytes: Uint8Array) => void;
  private onMessage?: (streamId: number, ppid: number, data: Uint8Array) => void;

  private readonly myInitTag = randomUint32();
  private readonly myInitialTsn = randomUint32();
  private peerInitTag = 0;
  private peerInitialTsn = 0;
  private stateCookie: Uint8Array | null = null;

  private state: 'init-sent' | 'awaiting-init' | 'cookie-echo-sent' | 'init-ack-sent' | 'established';

  private nextTsn = 0; // set to myInitialTsn once chosen
  private readonly outstanding = new Map<number, OutstandingChunk>();
  private readonly outboundSsn = new Map<number, number>();
  private readonly pendingSends: Array<{ streamId: number; ppid: number; data: Uint8Array; unordered: boolean }> = [];

  private cumulativeTsnAck = -1; // "nothing received yet" sentinel; set to peerInitialTsn - 1 on association
  private readonly receivedOutOfOrder = new Set<number>();
  private readonly reassembly = new Map<number, ReassemblyState>(); // keyed by streamId
  private readonly expectedSsn = new Map<number, number>(); // keyed by streamId
  private readonly orderedPending = new Map<number, Map<number, { ppid: number; data: Uint8Array }>>(); // streamId -> ssn -> message

  private rtxTimer: ReturnType<typeof setInterval> | null = null;

  readonly associationEstablished: Promise<void>;
  private resolveEstablished!: () => void;

  constructor(options: SctpAssociationOptions) {
    this.role = options.role;
    this.sendBytes = options.send;
    this.onMessage = options.onMessage;
    this.state = this.role === 'client' ? 'init-sent' : 'awaiting-init';
    this.nextTsn = this.myInitialTsn;
    this.associationEstablished = new Promise((resolve) => {
      this.resolveEstablished = resolve;
    });

    if (this.role === 'client') {
      this.sendRawChunk(buildInitChunk(this.initFieldsOf(this.myInitTag, this.myInitialTsn)));
    }

    this.rtxTimer = setInterval(() => this.checkRetransmits(), RTX_CHECK_INTERVAL_MS);
  }

  setOnMessage(handler: (streamId: number, ppid: number, data: Uint8Array) => void): void {
    this.onMessage = handler;
  }

  close(): void {
    if (this.rtxTimer) clearInterval(this.rtxTimer);
    this.rtxTimer = null;
  }

  private initFieldsOf(initiateTag: number, initialTsn: number): InitFields {
    return { initiateTag, aRwnd: 1 << 20, outboundStreams: 65535, inboundStreams: 65535, initialTsn };
  }

  /** Before the peer's initiate tag is known (pre-association), packets go out with verification tag 0 (RFC 4960 §5.1, INIT only). */
  private sendRawChunk(chunk: Uint8Array): void {
    const verificationTag = this.peerInitTag || 0;
    this.sendBytes(buildPacket({ srcPort: DEFAULT_SCTP_PORT, dstPort: DEFAULT_SCTP_PORT, verificationTag }, [chunk]));
  }

  /* ---- Receive dispatch --------------------------------------------------- */

  onReceive(datagram: Uint8Array): void {
    const packet = parsePacket(datagram);
    if (!packet.checksumValid) return; // silently drop a corrupt packet — the sender's RTX timer will cover it
    for (const chunk of packet.chunks) {
      switch (chunk.type) {
        case ChunkType.INIT:
          this.handleInit(chunk);
          break;
        case ChunkType.INIT_ACK:
          this.handleInitAck(chunk);
          break;
        case ChunkType.COOKIE_ECHO:
          this.handleCookieEcho(chunk);
          break;
        case ChunkType.COOKIE_ACK:
          this.handleCookieAck();
          break;
        case ChunkType.DATA:
          this.handleData(parseDataChunk(chunk));
          break;
        case ChunkType.SACK:
          this.handleSack(parseSackChunk(chunk.value));
          break;
        default:
        // Unknown chunk type — ignore (no HEARTBEAT/ABORT/SHUTDOWN support in this phase).
      }
    }
  }

  private handleInit(chunk: ParsedChunk): void {
    if (this.state !== 'awaiting-init') return;
    const init = parseInitFields(chunk.value);
    this.peerInitTag = init.initiateTag;
    this.peerInitialTsn = init.initialTsn;
    this.cumulativeTsnAck = init.initialTsn - 1;

    this.stateCookie = new Uint8Array(16);
    crypto.getRandomValues(this.stateCookie);
    this.state = 'init-ack-sent';
    this.sendRawChunk(buildInitAckChunk(this.initFieldsOf(this.myInitTag, this.myInitialTsn), this.stateCookie));
  }

  private handleInitAck(chunk: ParsedChunk): void {
    if (this.state !== 'init-sent') return;
    const { init, stateCookie } = parseInitAckChunk(chunk.value);
    this.peerInitTag = init.initiateTag;
    this.peerInitialTsn = init.initialTsn;
    this.cumulativeTsnAck = init.initialTsn - 1;
    this.state = 'cookie-echo-sent';
    this.sendRawChunk(buildCookieEchoChunk(stateCookie));
  }

  private handleCookieEcho(chunk: ParsedChunk): void {
    if (this.state !== 'init-ack-sent' || !this.stateCookie) return;
    // ponytail: cookie accepted on byte match only, no HMAC — see file header.
    if (!bytesEqual(chunk.value, this.stateCookie)) return;
    this.state = 'established';
    this.sendRawChunk(buildCookieAckChunk());
    this.onEstablished();
  }

  private handleCookieAck(): void {
    if (this.state !== 'cookie-echo-sent') return;
    this.state = 'established';
    this.onEstablished();
  }

  private onEstablished(): void {
    this.resolveEstablished();
    const pending = this.pendingSends.splice(0);
    for (const p of pending) this.sendMessage(p.streamId, p.ppid, p.data, { unordered: p.unordered });
  }

  /* ---- Outbound data ------------------------------------------------------- */

  sendMessage(streamId: number, ppid: number, data: Uint8Array, options: { unordered?: boolean } = {}): void {
    if (this.state !== 'established') {
      this.pendingSends.push({ streamId, ppid, data, unordered: options.unordered ?? false });
      return;
    }
    const unordered = options.unordered ?? false;
    const ssn = unordered ? 0 : this.nextOutboundSsn(streamId);

    const fragments: Uint8Array[] = [];
    for (let offset = 0; offset < data.length; offset += MAX_USER_DATA_PER_FRAGMENT) {
      fragments.push(data.subarray(offset, offset + MAX_USER_DATA_PER_FRAGMENT));
    }
    if (fragments.length === 0) fragments.push(new Uint8Array(0));

    fragments.forEach((payload, i) => {
      const tsn = this.nextTsn++;
      const dataChunk: DataChunk = {
        tsn,
        streamId,
        ssn,
        ppid,
        payload,
        begin: i === 0,
        end: i === fragments.length - 1,
        unordered,
      };
      const chunkBytes = buildDataChunk(dataChunk);
      const packet = buildPacket({ srcPort: DEFAULT_SCTP_PORT, dstPort: DEFAULT_SCTP_PORT, verificationTag: this.peerInitTag }, [chunkBytes]);
      this.outstanding.set(tsn, { bytes: packet, sentAt: Date.now() });
      this.sendBytes(packet);
    });
  }

  private nextOutboundSsn(streamId: number): number {
    const current = this.outboundSsn.get(streamId) ?? 0;
    this.outboundSsn.set(streamId, (current + 1) & 0xffff);
    return current;
  }

  private checkRetransmits(): void {
    if (this.state !== 'established') return;
    const now = Date.now();
    for (const [tsn, entry] of this.outstanding) {
      if (now - entry.sentAt >= RTO_MS) {
        entry.sentAt = now;
        this.sendBytes(entry.bytes);
      }
      void tsn;
    }
  }

  /* ---- Inbound data + SACK generation --------------------------------------*/

  private handleData(chunk: DataChunk): void {
    this.recordReceivedTsn(chunk.tsn);

    let state = this.reassembly.get(chunk.streamId);
    if (!state) {
      state = { fragments: new Map() };
      this.reassembly.set(chunk.streamId, state);
    }
    state.fragments.set(chunk.tsn, chunk);
    this.tryReassemble(chunk.streamId, state);

    this.sendSack();
  }

  private tryReassemble(streamId: number, state: ReassemblyState): void {
    // Find every complete begin->end contiguous-TSN run currently buffered for this stream.
    for (const [tsn, candidate] of [...state.fragments].sort((a, b) => a[0] - b[0])) {
      if (!candidate.begin) continue;
      const run: DataChunk[] = [candidate];
      let cursor = tsn;
      let complete = candidate.end;
      while (!complete) {
        const next = state.fragments.get(cursor + 1);
        if (!next) break;
        run.push(next);
        cursor++;
        complete = next.end;
      }
      if (!complete) continue;

      for (const piece of run) state.fragments.delete(piece.tsn);
      const data = concatBytes(run.map((piece) => piece.payload));
      const { ppid, ssn, unordered } = candidate;

      if (unordered) {
        this.onMessage?.(streamId, ppid, data);
        continue;
      }
      let pending = this.orderedPending.get(streamId);
      if (!pending) {
        pending = new Map();
        this.orderedPending.set(streamId, pending);
      }
      pending.set(ssn, { ppid, data });
      this.flushOrdered(streamId, pending);
    }
  }

  private flushOrdered(streamId: number, pending: Map<number, { ppid: number; data: Uint8Array }>): void {
    let expected = this.expectedSsn.get(streamId) ?? 0;
    while (pending.has(expected)) {
      const message = pending.get(expected)!;
      pending.delete(expected);
      this.onMessage?.(streamId, message.ppid, message.data);
      expected = (expected + 1) & 0xffff;
    }
    this.expectedSsn.set(streamId, expected);
  }

  private recordReceivedTsn(tsn: number): void {
    if (tsn <= this.cumulativeTsnAck) return; // duplicate of an already-acked TSN
    this.receivedOutOfOrder.add(tsn);
    while (this.receivedOutOfOrder.has(this.cumulativeTsnAck + 1)) {
      this.cumulativeTsnAck++;
      this.receivedOutOfOrder.delete(this.cumulativeTsnAck);
    }
  }

  private sendSack(): void {
    const gapAckBlocks: GapAckBlock[] = [];
    const sorted = [...this.receivedOutOfOrder].sort((a, b) => a - b);
    let runStart = -1;
    let runEnd = -1;
    for (const tsn of sorted) {
      const offset = tsn - this.cumulativeTsnAck;
      if (runStart === -1) {
        runStart = offset;
        runEnd = offset;
      } else if (offset === runEnd + 1) {
        runEnd = offset;
      } else {
        gapAckBlocks.push({ start: runStart, end: runEnd });
        runStart = offset;
        runEnd = offset;
      }
    }
    if (runStart !== -1) gapAckBlocks.push({ start: runStart, end: runEnd });

    const sack = buildSackChunk({ cumulativeTsnAck: this.cumulativeTsnAck, aRwnd: 1 << 20, gapAckBlocks });
    this.sendBytes(buildPacket({ srcPort: DEFAULT_SCTP_PORT, dstPort: DEFAULT_SCTP_PORT, verificationTag: this.peerInitTag }, [sack]));
  }

  private handleSack(sack: SackFields): void {
    for (const tsn of this.outstanding.keys()) {
      if (tsn <= sack.cumulativeTsnAck) {
        this.outstanding.delete(tsn);
        continue;
      }
      for (const block of sack.gapAckBlocks) {
        const offset = tsn - sack.cumulativeTsnAck;
        if (offset >= block.start && offset <= block.end) {
          this.outstanding.delete(tsn);
          break;
        }
      }
    }
  }
}

function randomUint32(): number {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return readUInt32BE(bytes, 0);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
