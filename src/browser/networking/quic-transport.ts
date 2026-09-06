/**
 * Nova's own QUIC-shaped reliable UDP transport. Consumes the pure wire seam in
 * `quic-wire.ts` (`buildLongHeaderPacket`/`parseLongHeaderPacket`) plus the
 * varint/packet-number codecs in `byte-codecs.ts` — those are the single source
 * of truth for the byte layout, and `tests/quic-wire.test.ts` gates the
 * self-to-self round trip.
 *
 * WIRE FORMAT (fixed 2026-09-06): the socket-proxy Phase 5 session documented
 * three wire-format bugs — the builder emitted the packet type in bits 0–1 of
 * the first byte while the parser read bits 4–5 (so every long-header packet
 * decoded as "Initial"), and the payload-start parser expected a
 * token-varint/2-byte-length/packet-number layout the builder never emitted
 * (no working self-to-self round trip). Both directions now route through
 * `quic-wire.ts`: type encoded in bits 4–5 (`QuicLongHeaderType`: Initial 0x00,
 * ZeroRtt 0x10, Handshake 0x20, OneRtt 0x30), Initial keeps its historical
 * 2-byte length field (value written, never read back), other types omit it,
 * and the packet number is skipped by its real 1/2/4-byte width. The old
 * `VersionNegotiation`/`Retry` packet types were never built or parsed by this
 * class and are retired.
 *
 * Also fixed here (same 32-bit signedness class as the varint WRITE bug
 * documented by that session): `decodeVarInt`'s 8-byte branch OR'd
 * `data[4] << 24` without `>>> 0`, so varints whose low 32 bits had the high
 * bit set decoded 2^32 short. `tests/quic-wire.test.ts` pins the regression.
 *
 * Plain-`Uint8Array` throughout (no Node `Buffer` global), so this file is safe
 * under `contextIsolation: true` and has no dependency on
 * `installBufferPolyfill()`.
 */
import type { IDisposable } from '../../app/dependency-container';
import type { HttpHeaderPair } from './http-protocol';
import { HttpProtocolVersion } from './http-protocol';
import { loadNodeBuiltin } from './node-builtins';
import { getSocketProxy } from './socket-proxy';
import { QuicLongHeaderType, buildLongHeaderPacket, parseLongHeaderPacket } from './quic-wire';
import { concatBytes, decodeVarInt, encodeUtf8, encodeVarInt } from './byte-codecs';

enum QuicFrameType {
  Padding      = 0x00,
  Ping         = 0x01,
  Ack          = 0x02,
  ResetStream  = 0x04,
  StopSending  = 0x05,
  Crypto       = 0x06,
  Data         = 0x07,
  Stream       = 0x08,
  MaxData      = 0x10,
  MaxStreamData = 0x11,
  MaxStreams   = 0x12,
  DataBlocked  = 0x14,
  StreamDataBlocked = 0x15,
  StreamsBlocked = 0x16,
  NewConnectionId = 0x18,
  RetireConnectionId = 0x19,
  PathChallenge = 0x1a,
  PathResponse = 0x1b,
  ConnectionClose = 0x1c,
  HandshakeDone = 0x1e,
}

enum QuicConnectionState {
  Listening,
  WaitingForInitial,
  Handshaking,
  Established,
  Closing,
  Closed,
}

interface QuicStream {
  readonly id: number;
  state: 'idle' | 'open' | 'half-closed' | 'closed';
  buffer: Uint8Array[];
  readonly created: number;
}

interface QuicConnectionConfig {
  readonly maxStreamsBidi: number;
  readonly maxStreamsUni: number;
  readonly maxData: number;
  readonly maxStreamData: number;
  readonly idleTimeout: number;
  readonly initialRtt: number;
}

const DEFAULT_QUIC_CONFIG: QuicConnectionConfig = {
  maxStreamsBidi: 100,
  maxStreamsUni: 100,
  maxData: 16_777_216,
  maxStreamData: 1_048_576,
  idleTimeout: 30_000,
  initialRtt: 100,
};

interface IQuicConnection extends IDisposable {
  readonly state: QuicConnectionState;
  connect(host: string, port: number): Promise<void>;
  close(): Promise<void>;
  openStream(): Promise<QuicStream>;
  sendStreamData(streamId: number, data: Uint8Array): Promise<void>;
  readStream(streamId: number): Promise<Uint8Array>;
  sendCryptoData(data: Uint8Array): Promise<void>;
  onStream: ((stream: QuicStream) => void) | null;
  onClose: ((error?: Error) => void) | null;
}

class QuicError extends Error {
  readonly code: number;
  constructor(message: string, code = 0) {
    super(message);
    this.name = 'QuicError';
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class QuicStreamClosedError extends QuicError {
  readonly streamId: number;
  constructor(streamId: number) {
    super(`QUIC stream ${streamId} is closed`, 0);
    this.name = 'QuicStreamClosedError';
    this.streamId = streamId;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class QuicConnection implements IQuicConnection {
  private _state: QuicConnectionState = QuicConnectionState.Listening;
  private socket: any = null;
  private host = '';
  private port = 0;
  private config: QuicConnectionConfig;
  private nextBidiStreamId = 0;
  private nextUniStreamId = 2;
  private streams = new Map<number, QuicStream>();
  private cryptoBuffer = new Uint8Array(0);
  private destConnectionId: Uint8Array | null = null;
  private srcConnectionId: Uint8Array | null = null;
  private packetNumber = 0;
  private connectedAt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  onStream: ((stream: QuicStream) => void) | null = null;
  onClose: ((error?: Error) => void) | null = null;

  constructor(config?: Partial<QuicConnectionConfig>) {
    this.config = { ...DEFAULT_QUIC_CONFIG, ...config };
  }

  get state(): QuicConnectionState { return this._state; }

  async connect(host: string, port: number): Promise<void> {
    if (this._state !== QuicConnectionState.Listening) {
      throw new QuicError('QUIC connection already in progress', 0);
    }

    this.host = host;
    this.port = port;
    this._state = QuicConnectionState.WaitingForInitial;
    this.srcConnectionId = this.generateConnectionId();
    this.destConnectionId = this.generateConnectionId();

    this.socket = await getSocketProxy().openDgram();

    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.cleanup();
        reject(new QuicError(`QUIC connection to ${host}:${port} timed out`, 0));
      }, this.config.idleTimeout);

      this.socket.on('error', (err: Error) => {
        clearTimeout(timeout);
        this._state = QuicConnectionState.Closed;
        reject(new QuicError(`QUIC socket error: ${err.message}`, 0));
      });

      this.socket.on('message', (msg: Uint8Array) => {
        clearTimeout(timeout);
        this.handlePacket(msg);
        if (this._state === QuicConnectionState.Established && !this.connectedAt) {
          this.connectedAt = Date.now();
          this.startPingTimer();
          resolve();
        }
      });

      this.socket.bind(0, () => {
        this.socket.connect(port, host, () => {
          this.sendInitialPacket();
        });
      });
    });
  }

  async close(): Promise<void> {
    if (this._state === QuicConnectionState.Closed) return;
    this._state = QuicConnectionState.Closing;
    await this.sendConnectionClose();
    this.cleanup();
    this._state = QuicConnectionState.Closed;
  }

  async openStream(): Promise<QuicStream> {
    const id = this.nextBidiStreamId;
    this.nextBidiStreamId += 4;

    const stream: QuicStream = {
      id,
      state: 'open' as const,
      buffer: [],
      created: Date.now(),
    };
    this.streams.set(id, stream);
    return stream;
  }

  async sendStreamData(streamId: number, data: Uint8Array): Promise<void> {
    const stream = this.streams.get(streamId);
    if (!stream || stream.state === 'closed') {
      throw new QuicStreamClosedError(streamId);
    }

    const frame = this.buildStreamFrame(streamId, data, false);
    await this.sendPacket(QuicLongHeaderType.OneRtt, frame);
  }

  async readStream(streamId: number): Promise<Uint8Array> {
    const stream = this.streams.get(streamId);
    if (!stream) throw new QuicStreamClosedError(streamId);
    if (stream.buffer.length === 0) return new Uint8Array(0);
    const result = concatBytes(stream.buffer);
    stream.buffer = [];
    return result;
  }

  async sendCryptoData(data: Uint8Array): Promise<void> {
    const frame = this.buildCryptoFrame(data);
    await this.sendPacket(QuicLongHeaderType.Handshake, frame);
  }

  private async sendInitialPacket(): Promise<void> {
    const frame = this.buildCryptoFrame(encodeUtf8('QUIC initial handshake'));
    await this.sendPacket(QuicLongHeaderType.Initial, frame);
  }

  private async sendPacket(packetType: QuicLongHeaderType, payload: Uint8Array): Promise<void> {
    if (!this.socket) throw new QuicError('QUIC socket not connected', 0);

    const packet = this.buildPacket(packetType, payload);
    try {
      this.socket.send(packet);
    } catch (err) {
      throw new QuicError(`Failed to send QUIC packet: ${err instanceof Error ? err.message : String(err)}`, 0);
    }
  }

  private buildPacket(packetType: QuicLongHeaderType, payload: Uint8Array): Uint8Array {
    const pn = this.packetNumber++;
    if (!this.destConnectionId || !this.srcConnectionId) {
      throw new QuicError('QUIC connection IDs not initialized', 0);
    }
    return buildLongHeaderPacket({
      type: packetType,
      destConnectionId: this.destConnectionId,
      srcConnectionId: this.srcConnectionId,
      packetNumber: pn,
      payload,
    });
  }

  private buildStreamFrame(streamId: number, data: Uint8Array, fin: boolean): Uint8Array {
    const type = QuicFrameType.Stream | (fin ? 0x01 : 0x00) | 0x04 | 0x02;

    return concatBytes([
      new Uint8Array([type]),
      encodeVarInt(streamId),
      encodeVarInt(0),
      encodeVarInt(data.length),
      data,
    ]);
  }

  private buildCryptoFrame(data: Uint8Array): Uint8Array {
    return concatBytes([
      new Uint8Array([QuicFrameType.Crypto]),
      encodeVarInt(0),
      encodeVarInt(data.length),
      data,
    ]);
  }

  private async sendConnectionClose(): Promise<void> {
    const frame = new Uint8Array([
      QuicFrameType.ConnectionClose,
      0x00, 0x00, 0x00, 0x00,
      0x00,
    ]);
    try {
      await this.sendPacket(QuicLongHeaderType.OneRtt, frame);
    } catch { }
  }

  private handlePacket(data: Uint8Array): void {
    if (data.length < 1) return;
    const formBit = data[0]! & 0x80;

    if (formBit === 0) {
      this.handleShortHeader(data);
    } else {
      this.handleLongHeader(data);
    }
  }

  private handleLongHeader(data: Uint8Array): void {
    const packet = parseLongHeaderPacket(data);
    if (!packet) return;
    const { type, payloadStart } = packet;
    if (type === QuicLongHeaderType.Initial) {
      this._state = QuicConnectionState.Handshaking;
      if (payloadStart < data.length) this.handleFrames(data.slice(payloadStart));
    } else if (type === QuicLongHeaderType.Handshake || type === QuicLongHeaderType.OneRtt) {
      if (this._state === QuicConnectionState.Handshaking) {
        this._state = QuicConnectionState.Established;
      }
      if (payloadStart < data.length) this.handleFrames(data.slice(payloadStart));
    }
  }

  private handleShortHeader(data: Uint8Array): void {
    const connIdLen = this.destConnectionId?.length ?? 0;
    const payloadStart = 1 + connIdLen + 1;
    if (payloadStart < data.length) {
      this.handleFrames(data.slice(payloadStart));
    }
  }

  private handleFrames(payload: Uint8Array): void {
    let offset = 0;

    while (offset < payload.length) {
      const frameType = payload[offset]!;
      offset++;

      if (frameType === QuicFrameType.Padding) {
        while (offset < payload.length && payload[offset] === 0x00) offset++;
      } else if (frameType === QuicFrameType.Crypto) {
        const { value: off, length: offLen } = decodeVarInt(payload.slice(offset));
        offset += offLen;
        const { value: len, length: lenLen } = decodeVarInt(payload.slice(offset));
        offset += lenLen;
        const cryptoData = payload.slice(offset, offset + len);
        offset += len;
        this.cryptoBuffer = concatBytes([this.cryptoBuffer, cryptoData]);
      } else if ((frameType & 0xF8) === QuicFrameType.Stream) {
        const hasOffset = (frameType & 0x04) !== 0;
        const hasLength = (frameType & 0x02) !== 0;
        const fin = (frameType & 0x01) !== 0;

        let streamId: number;
        { const r = decodeVarInt(payload.slice(offset)); streamId = r.value; offset += r.length; }

        let streamOffset = 0;
        if (hasOffset) { const r = decodeVarInt(payload.slice(offset)); streamOffset = r.value; offset += r.length; }

        let dataLen = payload.length - offset;
        if (hasLength) { const r = decodeVarInt(payload.slice(offset)); dataLen = r.value; offset += r.length; }

        const data = payload.slice(offset, offset + dataLen);
        offset += dataLen;

        let stream = this.streams.get(streamId);
        if (!stream) {
          stream = {
            id: streamId,
            state: fin ? 'half-closed' : 'open',
            buffer: [],
            created: Date.now(),
          };
          this.streams.set(streamId, stream);
          if (this.onStream) this.onStream(stream);
        }
        stream.buffer.push(data);
        if (fin) stream.state = 'half-closed';
      } else if (frameType === QuicFrameType.Ping) {
        this.sendPacket(QuicLongHeaderType.OneRtt, new Uint8Array([QuicFrameType.Ping]));
      } else if (frameType === QuicFrameType.ConnectionClose) {
        this._state = QuicConnectionState.Closed;
        if (this.onClose) this.onClose(new QuicError('Remote peer closed connection', 0));
        this.cleanup();
        break;
      } else if (frameType === QuicFrameType.HandshakeDone) {
        this._state = QuicConnectionState.Established;
      } else {
        break;
      }
    }
  }

  private generateConnectionId(): Uint8Array {
    const crypto = loadNodeBuiltin<typeof import('node:crypto')>('node:crypto');
    return crypto ? new Uint8Array(crypto.randomBytes(8)) : new Uint8Array(8);
  }

  private startPingTimer(): void {
    this.pingTimer = setInterval(() => {
      if (this._state === QuicConnectionState.Established && this.socket) {
        this.sendPacket(QuicLongHeaderType.OneRtt, new Uint8Array([QuicFrameType.Ping]));
      }
    }, 10_000);
  }

  private cleanup(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.socket) {
      try { this.socket.close(); } catch { }
      this.socket = null;
    }
    this._state = QuicConnectionState.Closed;
  }

  dispose(): void {
    this.cleanup();
    this.streams.clear();
    this.cryptoBuffer = new Uint8Array(0);
  }
}

export {
  QuicConnection,
  QuicConnectionState,
  QuicFrameType,
  QuicStreamClosedError,
  QuicError,
  DEFAULT_QUIC_CONFIG,
};
export type { IQuicConnection, QuicStream, QuicConnectionConfig };
export { QuicLongHeaderType as QuicPacketType } from './quic-wire';
