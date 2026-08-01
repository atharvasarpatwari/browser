import type { IDisposable } from '../../app/dependency-container';
import type { HttpHeaderPair } from './http-protocol';
import { HttpProtocolVersion } from './http-protocol';

enum QuicPacketType {
  Initial       = 0x00,
  Handshake     = 0x20,
  ZeroRtt       = 0x10,
  OneRtt        = 0x40,
  Retry         = 0x30,
  VersionNegotiation = 0x80,
}

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
  buffer: Buffer[];
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
  sendStreamData(streamId: number, data: Buffer): Promise<void>;
  readStream(streamId: number): Promise<Buffer>;
  sendCryptoData(data: Buffer): Promise<void>;
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
  private cryptoBuffer = Buffer.alloc(0);
  private destConnectionId: Buffer | null = null;
  private srcConnectionId: Buffer | null = null;
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

    const dgram = await import('node:dgram');
    this.socket = dgram.createSocket('udp4');

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

      this.socket.on('message', (msg: Buffer) => {
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

  async sendStreamData(streamId: number, data: Buffer): Promise<void> {
    const stream = this.streams.get(streamId);
    if (!stream || stream.state === 'closed') {
      throw new QuicStreamClosedError(streamId);
    }

    const frame = this.buildStreamFrame(streamId, data, false);
    await this.sendPacket(QuicPacketType.OneRtt, frame);
  }

  async readStream(streamId: number): Promise<Buffer> {
    const stream = this.streams.get(streamId);
    if (!stream) throw new QuicStreamClosedError(streamId);
    if (stream.buffer.length === 0) return Buffer.alloc(0);
    const result = Buffer.concat(stream.buffer);
    stream.buffer = [];
    return result;
  }

  async sendCryptoData(data: Buffer): Promise<void> {
    const frame = this.buildCryptoFrame(data);
    await this.sendPacket(QuicPacketType.Handshake, frame);
  }

  private async sendInitialPacket(): Promise<void> {
    const frame = this.buildCryptoFrame(Buffer.from('QUIC initial handshake'));
    await this.sendPacket(QuicPacketType.Initial, frame);
  }

  private async sendPacket(packetType: QuicPacketType, payload: Buffer): Promise<void> {
    if (!this.socket) throw new QuicError('QUIC socket not connected', 0);

    const packet = this.buildPacket(packetType, payload);
    try {
      this.socket.send(packet);
    } catch (err) {
      throw new QuicError(`Failed to send QUIC packet: ${err instanceof Error ? err.message : String(err)}`, 0);
    }
  }

  private buildPacket(packetType: QuicPacketType, payload: Buffer): Buffer {
    const pn = this.packetNumber++;
    const pnBytes = this.encodePacketNumber(pn);

    let header: Buffer;

    if (packetType === QuicPacketType.VersionNegotiation) {
      header = Buffer.concat([
        Buffer.from([0x80 | 0x00]),
        this.destConnectionId ?? Buffer.alloc(0),
        this.srcConnectionId ?? Buffer.alloc(0),
        Buffer.from([0x00, 0x00, 0x00, 0x01]),
      ]);
    } else if (packetType === QuicPacketType.Initial) {
      const tokenLength = 0;
      const tokenBytes = Buffer.alloc(0);
      const length = 2 + 1 + this.destConnectionId!.length + this.srcConnectionId!.length + tokenLength + pnBytes.length + payload.length;
      const lengthBytes = Buffer.alloc(2);
      lengthBytes.writeUInt16BE(length, 0);

      header = Buffer.concat([
        Buffer.from([0xC0 | (packetType >> 4 & 0x03)]),
        Buffer.from([this.destConnectionId!.length]),
        this.destConnectionId!,
        Buffer.from([this.srcConnectionId!.length]),
        this.srcConnectionId!,
        tokenBytes,
        lengthBytes,
        Buffer.from([packetType | pnBytes.length - 1]),
        pnBytes,
      ]);
    } else if (packetType === QuicPacketType.Handshake || packetType === QuicPacketType.OneRtt) {
      header = Buffer.concat([
        Buffer.from([0xC0 | (packetType >> 4 & 0x03)]),
        Buffer.from([this.destConnectionId!.length]),
        this.destConnectionId!,
        Buffer.from([this.srcConnectionId!.length]),
        this.srcConnectionId!,
        Buffer.from([packetType | pnBytes.length - 1]),
        pnBytes,
      ]);
    } else {
      header = Buffer.concat([
        Buffer.from([packetType | pnBytes.length - 1]),
        this.destConnectionId ?? Buffer.alloc(0),
        pnBytes,
      ]);
    }

    return Buffer.concat([header, payload]);
  }

  private buildStreamFrame(streamId: number, data: Buffer, fin: boolean): Buffer {
    const type = QuicFrameType.Stream | (fin ? 0x01 : 0x00) | 0x04 | 0x02;
    const streamIdBytes = this.encodeVarInt(streamId);
    const offsetBytes = this.encodeVarInt(0);
    const lengthBytes = this.encodeVarInt(data.length);

    return Buffer.concat([
      Buffer.from([type]),
      streamIdBytes,
      offsetBytes,
      lengthBytes,
      data,
    ]);
  }

  private buildCryptoFrame(data: Buffer): Buffer {
    const offsetBytes = this.encodeVarInt(0);
    const lengthBytes = this.encodeVarInt(data.length);

    return Buffer.concat([
      Buffer.from([QuicFrameType.Crypto]),
      offsetBytes,
      lengthBytes,
      data,
    ]);
  }

  private async sendConnectionClose(): Promise<void> {
    const frame = Buffer.from([
      QuicFrameType.ConnectionClose,
      0x00, 0x00, 0x00, 0x00,
      0x00,
    ]);
    try {
      await this.sendPacket(QuicPacketType.OneRtt, frame);
    } catch { }
  }

  private handlePacket(data: Buffer): void {
    if (data.length < 1) return;
    const formBit = data[0]! & 0x80;

    if (formBit === 0) {
      this.handleShortHeader(data);
    } else {
      this.handleLongHeader(data);
    }
  }

  private handleLongHeader(data: Buffer): void {
    const type = data[0]! & 0x30;
    if (type === QuicPacketType.Initial >> 4) {
      this._state = QuicConnectionState.Handshaking;
      const payloadStart = this.findPayloadStart(data);
      if (payloadStart < data.length) {
        this.handleFrames(data.slice(payloadStart));
      }
    } else if (type === QuicPacketType.Handshake >> 4 || type === QuicPacketType.OneRtt >> 4) {
      if (this._state === QuicConnectionState.Handshaking) {
        this._state = QuicConnectionState.Established;
      }
      const payloadStart = this.findPayloadStart(data);
      if (payloadStart < data.length) {
        this.handleFrames(data.slice(payloadStart));
      }
    }
  }

  private handleShortHeader(data: Buffer): void {
    const connIdLen = this.destConnectionId?.length ?? 0;
    const payloadStart = 1 + connIdLen + 1;
    if (payloadStart < data.length) {
      this.handleFrames(data.slice(payloadStart));
    }
  }

  private findPayloadStart(data: Buffer): number {
    let offset = 1;
    const type = data[0]!;
    const isInitial = (type & 0x30) === 0x00;
    const isZeroRtt = (type & 0x30) === 0x10;
    const isHandshake = (type & 0x30) === 0x20;
    const isOneRtt = (type & 0x30) === 0x30;

    if (isInitial || isZeroRtt || isHandshake) {
      const destLen = data[offset]!; offset += 1;
      offset += destLen;
      const srcLen = data[offset]!; offset += 1;
      offset += srcLen;
      if (isInitial) {
        const tokenLen = this.decodeVarInt(data.slice(offset)).value;
        offset += this.decodeVarInt(data.slice(offset)).length;
        offset += tokenLen;
      }
      offset += 2;
      offset += 1;
      offset += 1;
    } else if (isOneRtt) {
      offset += this.destConnectionId?.length ?? 0;
      offset += 1;
    } else {
      offset += this.destConnectionId?.length ?? 0;
      offset += 1;
    }

    return Math.min(offset, data.length);
  }

  private handleFrames(payload: Buffer): void {
    let offset = 0;

    while (offset < payload.length) {
      const frameType = payload[offset]!;
      offset++;

      if (frameType === QuicFrameType.Padding) {
        while (offset < payload.length && payload[offset] === 0x00) offset++;
      } else if (frameType === QuicFrameType.Crypto) {
        const { value: off, length: offLen } = this.decodeVarInt(payload.slice(offset));
        offset += offLen;
        const { value: len, length: lenLen } = this.decodeVarInt(payload.slice(offset));
        offset += lenLen;
        const cryptoData = payload.slice(offset, offset + len);
        offset += len;
        this.cryptoBuffer = Buffer.concat([this.cryptoBuffer, cryptoData]);
      } else if ((frameType & 0xF8) === QuicFrameType.Stream) {
        const hasOffset = (frameType & 0x04) !== 0;
        const hasLength = (frameType & 0x02) !== 0;
        const fin = (frameType & 0x01) !== 0;

        let streamId: number;
        { const r = this.decodeVarInt(payload.slice(offset)); streamId = r.value; offset += r.length; }

        let streamOffset = 0;
        if (hasOffset) { const r = this.decodeVarInt(payload.slice(offset)); streamOffset = r.value; offset += r.length; }

        let dataLen = payload.length - offset;
        if (hasLength) { const r = this.decodeVarInt(payload.slice(offset)); dataLen = r.value; offset += r.length; }

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
        this.sendPacket(QuicPacketType.OneRtt, Buffer.from([QuicFrameType.Ping]));
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

  private encodeVarInt(value: number): Buffer {
    if (value < 64) return Buffer.from([value]);
    if (value < 16384) {
      const buf = Buffer.alloc(2);
      buf.writeUInt16BE(value | 0x4000, 0);
      return buf;
    }
    if (value < 1_073_741_824) {
      const buf = Buffer.alloc(4);
      buf.writeUInt32BE(value | 0x80000000, 0);
      return buf;
    }
    const buf = Buffer.alloc(8);
    const hi = Math.floor(value / 0x100000000);
    const lo = value >>> 0;
    buf.writeUInt32BE(hi, 0);
    buf.writeUInt32BE(lo, 4);
    buf[0] = buf[0]! | 0xC0;
    return buf;
  }

  private decodeVarInt(data: Buffer): { value: number; length: number } {
    if (data.length === 0) return { value: 0, length: 0 };
    const prefix = data[0]! >> 6;
    const mask = 0x3F;

    switch (prefix) {
      case 0: return { value: data[0]! & mask, length: 1 };
      case 1: {
        if (data.length < 2) return { value: 0, length: 0 };
        return { value: ((data[0]! & mask) << 8) | data[1]!, length: 2 };
      }
      case 2: {
        if (data.length < 4) return { value: 0, length: 0 };
        return { value: ((data[0]! & mask) << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!, length: 4 };
      }
      case 3: {
        if (data.length < 8) return { value: 0, length: 0 };
        const hi = ((data[0]! & mask) << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!;
        const lo = (data[4]! << 24) | (data[5]! << 16) | (data[6]! << 8) | data[7]!;
        return { value: hi * 0x100000000 + lo, length: 8 };
      }
      default: return { value: 0, length: 0 };
    }
  }

  private encodePacketNumber(pn: number): Buffer {
    if (pn < 128) return Buffer.from([pn]);
    if (pn < 32768) {
      const buf = Buffer.alloc(2);
      buf.writeUInt16BE(pn, 0);
      return buf;
    }
    const buf = Buffer.alloc(4);
    buf.writeUInt32BE(pn, 0);
    return buf;
  }

  private generateConnectionId(): Buffer {
    const crypto = require('crypto');
    return crypto.randomBytes(8);
  }

  private startPingTimer(): void {
    this.pingTimer = setInterval(() => {
      if (this._state === QuicConnectionState.Established && this.socket) {
        this.sendPacket(QuicPacketType.OneRtt, Buffer.from([QuicFrameType.Ping]));
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
    this.cryptoBuffer = Buffer.alloc(0);
  }
}

export {
  QuicConnection,
  QuicConnectionState,
  QuicPacketType,
  QuicFrameType,
  QuicStreamClosedError,
  QuicError,
  DEFAULT_QUIC_CONFIG,
};
export type { IQuicConnection, QuicStream, QuicConnectionConfig };
