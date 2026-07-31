/**
 * @file src/browser/networking/http-protocol.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Manage HTTP/1.1 and HTTP/2 protocol negotiation, frame handling, header
 * compression, and connection features. HTTP/3 (QUIC) is supported as an
 * optional protocol that can be enabled per-connection.
 *
 * Pipeline position
 * ─────────────────
 *   RequestManager.send()
 *        │
 *        ▼
 *   HttpProtocolManager.negotiate(url, capabilities)
 *        │
 *        ├──▶ HTTP/2?  → Http2Session (header compression, multiplexing)
 *        ├──▶ HTTP/3?  → Http3Session (QUIC transport, optional)
 *        └──▶ HTTP/1.1 → Http1Session (keep-alive, chunked encoding)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IHttpProtocolManager hides protocol selection behind
 *                   negotiate() and createSession().
 *  Encapsulation    HPACK table and frame parsing are private.
 *  Single-Resp.     This file manages protocol negotiation and sessions.
 *  Open / Closed    New protocols implement IHttpSession; the manager
 *                   never changes.
 *  Dependency-Inv.  Consumers depend on the interface, not the concrete.
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/** Supported HTTP protocol versions. */
enum HttpProtocolVersion {
  Http1_0  = 'HTTP/1.0',
  Http1_1  = 'HTTP/1.1',
  Http2    = 'HTTP/2',
  Http3    = 'HTTP/3',
}

/** Frame types for HTTP/2 binary framing. */
enum Http2FrameType {
  Data          = 0x0,
  Headers       = 0x1,
  Priority      = 0x2,
  RstStream     = 0x3,
  Settings      = 0x4,
  PushPromise   = 0x5,
  Ping          = 0x6,
  GoAway        = 0x7,
  WindowUpdate  = 0x8,
  Continuation  = 0x9,
}

/** HTTP/2 settings identifiers. */
enum Http2SettingId {
  HeaderTableSize      = 0x1,
  EnablePush           = 0x2,
  MaxConcurrentStreams = 0x3,
  InitialWindowSize    = 0x4,
  MaxFrameSize         = 0x5,
  MaxHeaderListSize    = 0x6,
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/** Negotiated protocol capabilities for a connection. */
interface ProtocolNegotiationResult {
  readonly version: HttpProtocolVersion;
  /** Whether the server supports header compression (HPACK for H2, QPACK for H3). */
  readonly headerCompression: boolean;
  /** Whether multiplexing is supported (H2/H3). */
  readonly multiplexing: boolean;
  /** Whether server push is enabled. */
  readonly serverPush: boolean;
  /** Maximum concurrent streams per connection. */
  readonly maxConcurrentStreams: number;
  /** Initial flow-control window size in bytes. */
  readonly initialWindowSize: number;
  /** Whether connection coalescing is possible (H2/H3). */
  readonly connectionCoalescing: boolean;
  /** Maximum frame size for data frames. */
  readonly maxFrameSize: number;
}

/** HTTP/2 settings exchanged during the connection preface. */
interface Http2Settings {
  readonly headerTableSize: number;
  readonly enablePush: boolean;
  readonly maxConcurrentStreams: number;
  readonly initialWindowSize: number;
  readonly maxFrameSize: number;
  readonly maxHeaderListSize: number;
}

/** An HTTP/2 frame header (9 bytes on the wire). */
interface Http2FrameHeader {
  readonly length: number;
  readonly type: Http2FrameType;
  readonly flags: number;
  readonly streamId: number;
}

/** A parsed HTTP/2 frame. */
interface Http2Frame {
  readonly header: Http2FrameHeader;
  readonly payload: Uint8Array;
}

/** A decoded HTTP header pair. */
interface HttpHeaderPair {
  readonly name: string;
  readonly value: string;
}

/** Client capabilities advertised during ALPN negotiation. */
interface ClientCapabilities {
  readonly supportedVersions: readonly HttpProtocolVersion[];
  readonly enableHttp3: boolean;
  readonly headerTableSize: number;
  readonly maxConcurrentStreams: number;
  readonly initialWindowSize: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IHttpSession extends IDisposable {
  readonly version: HttpProtocolVersion;
  readonly streamId: number;
  /** Encode headers using the session's compression (HPACK/QPACK). */
  encodeHeaders(headers: readonly HttpHeaderPair[]): Uint8Array;
  /** Decode a compressed header block into individual pairs. */
  decodeHeaders(encoded: Uint8Array): readonly HttpHeaderPair[];
  /** Create a new stream (H2/H3) or return the single stream (H1). */
  createStream(): number;
  /** Whether the session supports multiplexing. */
  canMultiplex(): boolean;
}

interface IHttpProtocolManager extends IDisposable {
  /** Negotiate the best protocol based on server ALPN and client capabilities. */
  negotiate(
    serverAlpn: readonly string[],
    clientCapabilities: ClientCapabilities,
  ): ProtocolNegotiationResult;
  /** Create a protocol session for the negotiated version. */
  createSession(version: HttpProtocolVersion): IHttpSession;
  /** Get default settings for a protocol version. */
  getDefaultSettings(version: HttpProtocolVersion): Http2Settings;
  /** Parse an HTTP/2 frame header from raw bytes. */
  parseFrameHeader(data: Uint8Array): Http2FrameHeader;
  /** Build an HTTP/2 frame header as raw bytes. */
  buildFrameHeader(header: Http2FrameHeader): Uint8Array;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const HTTP2_DEFAULT_SETTINGS: Http2Settings = {
  headerTableSize:      4096,
  enablePush:           true,
  maxConcurrentStreams: 100,
  initialWindowSize:    65_535,
  maxFrameSize:         16_384,
  maxHeaderListSize:    262_144,
};

const HTTP2_FRAME_HEADER_SIZE = 9;

// ─────────────────────────────────────────────────────────────────────────────
// HPACK HEADER COMPRESSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * HPACK dynamic table for HTTP/2 header compression (RFC 7541).
 *
 * Maintains an indexed list of previously sent headers. Both encoder
 * and decoder share the same state, enabling efficient delta encoding.
 */
class HpackEncoder {
  private readonly table: HttpHeaderPair[] = [];
  private readonly staticTable: readonly HttpHeaderPair[] = [
    { name: ':authority',    value: '' },
    { name: ':method',       value: 'GET' },
    { name: ':method',       value: 'POST' },
    { name: ':path',         value: '/' },
    { name: ':scheme',       value: 'http' },
    { name: ':scheme',       value: 'https' },
    { name: ':status',       value: '200' },
    { name: ':status',       value: '204' },
    { name: ':status',       value: '304' },
    { name: ':status',       value: '404' },
    { name: 'accept-encoding', value: 'gzip, deflate' },
    { name: 'accept-language', value: '' },
    { name: 'accept-ranges',   value: '' },
    { name: 'accept',          value: '' },
    { name: 'authorization',   value: '' },
    { name: 'cache-control',   value: '' },
    { name: 'content-type',    value: '' },
    { name: 'cookie',          value: '' },
    { name: 'host',            value: '' },
    { name: 'user-agent',      value: '' },
  ];
  private tableSize = 0;
  private readonly maxTableSize: number;

  constructor(maxTableSize = HTTP2_DEFAULT_SETTINGS.headerTableSize) {
    this.maxTableSize = maxTableSize;
  }

  /**
   * Encode headers into a compressed representation.
   * Uses static table indexing for common headers and literal encoding
   * for new or changed values.
   */
  encode(headers: readonly HttpHeaderPair[]): Uint8Array {
    const bytes: number[] = [];

    for (const header of headers) {
      const idx = this.findInTable(header.name, header.value);
      if (idx !== -1) {
        // Indexed header field — 1-bit prefix + index.
        bytes.push(0x80 | idx);
      } else {
        const nameIdx = this.findNameInTable(header.name);
        if (nameIdx !== -1) {
          // Literal with incremental indexing — name reference.
          bytes.push(0x40 | nameIdx);
          this.writeString(header.value, bytes);
        } else {
          // Literal — new name, no indexing.
          bytes.push(0x00);
          this.writeString(header.name, bytes);
          this.writeString(header.value, bytes);
        }
        this.addToTable(header);
      }
    }

    return new Uint8Array(bytes);
  }

  /** Reset the dynamic table. */
  reset(): void {
    this.table.length = 0;
    this.tableSize = 0;
  }

  private findInTable(name: string, value: string): number {
    // Check static table first (1-indexed).
    for (let i = 0; i < this.staticTable.length; i++) {
      const e = this.staticTable[i]!;
      if (e.name === name && e.value === value) return i + 1;
    }
    // Check dynamic table.
    for (let i = 0; i < this.table.length; i++) {
      const e = this.table[i]!;
      if (e.name === name && e.value === value) {
        return this.staticTable.length + i + 1;
      }
    }
    return -1;
  }

  private findNameInTable(name: string): number {
    for (let i = 0; i < this.staticTable.length; i++) {
      if (this.staticTable[i]!.name === name) return i + 1;
    }
    for (let i = 0; i < this.table.length; i++) {
      if (this.table[i]!.name === name) {
        return this.staticTable.length + i + 1;
      }
    }
    return -1;
  }

  private addToTable(header: HttpHeaderPair): void {
    const entrySize = header.name.length + header.value.length + 32;
    this.table.unshift(header);
    this.tableSize += entrySize;

    while (this.tableSize > this.maxTableSize && this.table.length > 0) {
      const removed = this.table.pop()!;
      this.tableSize -= removed.name.length + removed.value.length + 32;
    }
  }

  private writeString(value: string, bytes: number[]): void {
    // Simple string encoding: length prefix + UTF-8 bytes.
    const encoded = new TextEncoder().encode(value);
    bytes.push(encoded.length & 0x7F);
    for (const b of encoded) {
      bytes.push(b);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP/1.1 SESSION
// ─────────────────────────────────────────────────────────────────────────────

/** HTTP/1.1 session — single stream, keep-alive, chunked encoding support. */
class Http1Session implements IHttpSession {
  readonly version = HttpProtocolVersion.Http1_1;
  private _streamId = 1;
  private keepAlive = true;

  get streamId(): number { return this._streamId; }

  encodeHeaders(headers: readonly HttpHeaderPair[]): Uint8Array {
    const lines: string[] = [];
    for (const h of headers) {
      lines.push(`${h.name}: ${h.value}\r\n`);
    }
    lines.push('\r\n');
    return new TextEncoder().encode(lines.join(''));
  }

  decodeHeaders(encoded: Uint8Array): readonly HttpHeaderPair[] {
    const text = new TextDecoder().decode(encoded);
    const pairs: HttpHeaderPair[] = [];
    const lines = text.split('\r\n');

    for (const line of lines) {
      if (line === '' || line.startsWith('HTTP/')) continue;
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      pairs.push({
        name: line.slice(0, colonIdx).trim().toLowerCase(),
        value: line.slice(colonIdx + 1).trim(),
      });
    }

    return pairs;
  }

  createStream(): number {
    // HTTP/1.1 has one stream per connection.
    return this._streamId;
  }

  canMultiplex(): boolean {
    return false;
  }

  setKeepAlive(enabled: boolean): void {
    this.keepAlive = enabled;
  }

  isKeepAlive(): boolean {
    return this.keepAlive;
  }

  dispose(): void { /* no-op for HTTP/1.1 */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP/2 SESSION
// ─────────────────────────────────────────────────────────────────────────────

/** HTTP/2 session — binary framing, HPACK compression, multiplexed streams. */
class Http2Session implements IHttpSession {
  readonly version = HttpProtocolVersion.Http2;
  private _streamId = 0;
  private readonly encoder: HpackEncoder;
  private readonly settings: Http2Settings;
  private nextStreamId = 1;

  constructor(settings?: Partial<Http2Settings>) {
    this.settings = { ...HTTP2_DEFAULT_SETTINGS, ...settings };
    this.encoder = new HpackEncoder(this.settings.headerTableSize);
  }

  get streamId(): number { return this._streamId; }

  encodeHeaders(headers: readonly HttpHeaderPair[]): Uint8Array {
    return this.encoder.encode(headers);
  }

  decodeHeaders(encoded: Uint8Array): readonly HttpHeaderPair[] {
    // Simplified decoding — in production, this would use the QPACK/HPACK
    // decoder with dynamic table support.
    const pairs: HttpHeaderPair[] = [];
    let i = 0;

    while (i < encoded.length) {
      const byte = encoded[i]!;

      if ((byte & 0x80) !== 0) {
        // Indexed header — static table only for simplicity.
        const idx = byte & 0x7F;
        if (idx > 0 && idx <= 20) {
          const staticEntry = [
            { name: ':authority', value: '' },
            { name: ':method', value: 'GET' },
            { name: ':method', value: 'POST' },
            { name: ':path', value: '/' },
            { name: ':scheme', value: 'http' },
            { name: ':scheme', value: 'https' },
            { name: ':status', value: '200' },
            { name: ':status', value: '204' },
            { name: ':status', value: '304' },
            { name: ':status', value: '404' },
            { name: 'accept-encoding', value: 'gzip, deflate' },
            { name: 'accept-language', value: '' },
            { name: 'accept-ranges', value: '' },
            { name: 'accept', value: '' },
            { name: 'authorization', value: '' },
            { name: 'cache-control', value: '' },
            { name: 'content-type', value: '' },
            { name: 'cookie', value: '' },
            { name: 'host', value: '' },
            { name: 'user-agent', value: '' },
          ][idx - 1];
          if (staticEntry) pairs.push({ ...staticEntry });
        }
        i++;
      } else {
        // Literal header — skip for now.
        i++;
        break;
      }
    }

    return pairs;
  }

  createStream(): number {
    this._streamId = this.nextStreamId;
    this.nextStreamId += 2; // Client streams use odd IDs.
    return this._streamId;
  }

  canMultiplex(): boolean {
    return true;
  }

  getSettings(): Http2Settings {
    return { ...this.settings };
  }

  /** Build an HTTP/2 SETTINGS frame payload. */
  buildSettingsFrame(): Uint8Array {
    const entries: Array<{ id: Http2SettingId; value: number }> = [
      { id: Http2SettingId.HeaderTableSize,      value: this.settings.headerTableSize },
      { id: Http2SettingId.EnablePush,            value: this.settings.enablePush ? 1 : 0 },
      { id: Http2SettingId.MaxConcurrentStreams,  value: this.settings.maxConcurrentStreams },
      { id: Http2SettingId.InitialWindowSize,     value: this.settings.initialWindowSize },
      { id: Http2SettingId.MaxFrameSize,          value: this.settings.maxFrameSize },
      { id: Http2SettingId.MaxHeaderListSize,     value: this.settings.maxHeaderListSize },
    ];

    const payload = new Uint8Array(entries.length * 6);
    let offset = 0;
    for (const entry of entries) {
      payload[offset]     = (entry.id >>> 24) & 0xFF;
      payload[offset + 1] = (entry.id >>> 16) & 0xFF;
      payload[offset + 2] = (entry.id >>> 8) & 0xFF;
      payload[offset + 3] = entry.id & 0xFF;
      payload[offset + 4] = (entry.value >>> 8) & 0xFF;
      payload[offset + 5] = entry.value & 0xFF;
      offset += 6;
    }

    return payload;
  }

  dispose(): void {
    this.encoder.reset();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP/3 SESSION (OPTIONAL — QUIC transport)
// ─────────────────────────────────────────────────────────────────────────────

/** HTTP/3 session — QUIC-based, 0-RTT, connection migration. */
class Http3Session implements IHttpSession {
  readonly version = HttpProtocolVersion.Http3;
  private _streamId = 0;
  private nextStreamId = 0;

  constructor(_settings?: Partial<Http2Settings>) {
    // HTTP/3 uses QPACK for header compression — simplified here.
  }

  get streamId(): number { return this._streamId; }

  encodeHeaders(headers: readonly HttpHeaderPair[]): Uint8Array {
    // Simplified QPACK encoding — in production, this would use
    // the full QPACK encoder with dynamic table and Huffman coding.
    const lines: string[] = [];
    for (const h of headers) {
      lines.push(`${h.name}: ${h.value}`);
    }
    return new TextEncoder().encode(lines.join('\n'));
  }

  decodeHeaders(encoded: Uint8Array): readonly HttpHeaderPair[] {
    const text = new TextDecoder().decode(encoded);
    const pairs: HttpHeaderPair[] = [];
    for (const line of text.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;
      pairs.push({
        name: line.slice(0, colonIdx).trim().toLowerCase(),
        value: line.slice(colonIdx + 1).trim(),
      });
    }
    return pairs;
  }

  createStream(): number {
    // HTTP/3 bidirectional streams use even IDs for clients.
    this._streamId = this.nextStreamId;
    this.nextStreamId += 4; // Client-initiated bidirectional streams.
    return this._streamId;
  }

  canMultiplex(): boolean {
    return true;
  }

  dispose(): void { /* no-op */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROTOCOL MANAGER
// ─────────────────────────────────────────────────────────────────────────────

class HttpProtocolManager implements IHttpProtocolManager {
  private http3Enabled: boolean;

  constructor(options?: { enableHttp3?: boolean }) {
    this.http3Enabled = options?.enableHttp3 ?? false;
  }

  // ── IHttpProtocolManager: negotiate ──────────────────────────────────

  negotiate(
    serverAlpn: readonly string[],
    clientCapabilities: ClientCapabilities,
  ): ProtocolNegotiationResult {
    // Determine best mutually-supported version.
    let selectedVersion = HttpProtocolVersion.Http1_1;

    const serverSupportsH3 = serverAlpn.includes('h3');
    const serverSupportsH2 = serverAlpn.includes('h2');
    const clientSupportsH3 = clientCapabilities.supportedVersions.includes(HttpProtocolVersion.Http3) &&
                             this.http3Enabled;
    const clientSupportsH2 = clientCapabilities.supportedVersions.includes(HttpProtocolVersion.Http2);

    // Preference order: H3 > H2 > H1.1 > H1.0
    if (serverSupportsH3 && clientSupportsH3 && clientCapabilities.enableHttp3) {
      selectedVersion = HttpProtocolVersion.Http3;
    } else if (serverSupportsH2 && clientSupportsH2) {
      selectedVersion = HttpProtocolVersion.Http2;
    } else if (serverAlpn.includes('http/1.1')) {
      selectedVersion = HttpProtocolVersion.Http1_1;
    } else if (serverAlpn.includes('http/1.0')) {
      selectedVersion = HttpProtocolVersion.Http1_0;
    }

    return this.buildNegotiationResult(selectedVersion);
  }

  // ── IHttpProtocolManager: createSession ─────────────────────────────

  createSession(version: HttpProtocolVersion): IHttpSession {
    switch (version) {
      case HttpProtocolVersion.Http3:    return new Http3Session();
      case HttpProtocolVersion.Http2:    return new Http2Session();
      case HttpProtocolVersion.Http1_1:  return new Http1Session();
      case HttpProtocolVersion.Http1_0:  return new Http1Session();
      default:
        throw new Error(`Unsupported HTTP protocol version: ${version}`);
    }
  }

  // ── IHttpProtocolManager: getDefaultSettings ────────────────────────

  getDefaultSettings(version: HttpProtocolVersion): Http2Settings {
    return { ...HTTP2_DEFAULT_SETTINGS };
  }

  // ── IHttpProtocolManager: parseFrameHeader ──────────────────────────

  parseFrameHeader(data: Uint8Array): Http2FrameHeader {
    if (data.length < HTTP2_FRAME_HEADER_SIZE) {
      throw new Error(`Frame header requires ${HTTP2_FRAME_HEADER_SIZE} bytes, got ${data.length}.`);
    }

    return {
      length:  (data[0]! << 16) | (data[1]! << 8) | data[2]!,
      type:    data[3]! as Http2FrameType,
      flags:   data[4]!,
      streamId: (data[5]! << 24) | (data[6]! << 16) | (data[7]! << 8) | data[8]!,
    };
  }

  // ── IHttpProtocolManager: buildFrameHeader ──────────────────────────

  buildFrameHeader(header: Http2FrameHeader): Uint8Array {
    const bytes = new Uint8Array(HTTP2_FRAME_HEADER_SIZE);
    bytes[0] = (header.length >>> 16) & 0xFF;
    bytes[1] = (header.length >>> 8) & 0xFF;
    bytes[2] = header.length & 0xFF;
    bytes[3] = header.type;
    bytes[4] = header.flags;
    bytes[5] = (header.streamId >>> 24) & 0xFF;
    bytes[6] = (header.streamId >>> 16) & 0xFF;
    bytes[7] = (header.streamId >>> 8) & 0xFF;
    bytes[8] = header.streamId & 0xFF;
    return bytes;
  }

  // ── IDisposable ─────────────────────────────────────────────────────

  dispose(): void { /* no-op */ }

  // ── Private helpers ─────────────────────────────────────────────────

  private buildNegotiationResult(version: HttpProtocolVersion): ProtocolNegotiationResult {
    const isH2OrH3 = version === HttpProtocolVersion.Http2 || version === HttpProtocolVersion.Http3;

    return {
      version,
      headerCompression: isH2OrH3,
      multiplexing:      isH2OrH3,
      serverPush:        isH2OrH3,
      maxConcurrentStreams: isH2OrH3 ? HTTP2_DEFAULT_SETTINGS.maxConcurrentStreams : 1,
      initialWindowSize:   isH2OrH3 ? HTTP2_DEFAULT_SETTINGS.initialWindowSize : 65_535,
      connectionCoalescing: isH2OrH3,
      maxFrameSize:        isH2OrH3 ? HTTP2_DEFAULT_SETTINGS.maxFrameSize : 16_384,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  HttpProtocolManager,
  Http1Session,
  Http2Session,
  Http3Session,
  HpackEncoder,
  HttpProtocolVersion,
  Http2FrameType,
  Http2SettingId,
  HTTP2_DEFAULT_SETTINGS,
  HTTP2_FRAME_HEADER_SIZE,
};

export type {
  IHttpProtocolManager,
  IHttpSession,
  ProtocolNegotiationResult,
  Http2Settings,
  Http2FrameHeader,
  Http2Frame,
  HttpHeaderPair,
  ClientCapabilities,
};
