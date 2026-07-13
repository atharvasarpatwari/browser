import { describe, it, expect, beforeEach } from 'vitest';
import {
  HttpProtocolManager,
  Http1Session,
  Http2Session,
  Http3Session,
  HpackEncoder,
  HttpProtocolVersion,
  Http2FrameType,
  HTTP2_FRAME_HEADER_SIZE,
} from '../src/browser/netwroking/http-protocol';

describe('HttpProtocolManager', () => {
  let manager: HttpProtocolManager;

  beforeEach(() => {
    manager = new HttpProtocolManager();
  });

  describe('negotiate', () => {
    it('should negotiate HTTP/2 when both support it', () => {
      const result = manager.negotiate(['h2', 'http/1.1'], {
        supportedVersions: [HttpProtocolVersion.Http2, HttpProtocolVersion.Http1_1],
        enableHttp3: false,
        headerTableSize: 4096,
        maxConcurrentStreams: 100,
        initialWindowSize: 65535,
      });
      expect(result.version).toBe(HttpProtocolVersion.Http2);
      expect(result.multiplexing).toBe(true);
      expect(result.headerCompression).toBe(true);
      expect(result.maxConcurrentStreams).toBe(100);
    });

    it('should fallback to HTTP/1.1 when server only supports h1', () => {
      const result = manager.negotiate(['http/1.1'], {
        supportedVersions: [HttpProtocolVersion.Http2, HttpProtocolVersion.Http1_1],
        enableHttp3: false,
        headerTableSize: 4096,
        maxConcurrentStreams: 100,
        initialWindowSize: 65535,
      });
      expect(result.version).toBe(HttpProtocolVersion.Http1_1);
      expect(result.multiplexing).toBe(false);
      expect(result.maxConcurrentStreams).toBe(1);
    });

    it('should negotiate HTTP/3 when both support it and enabled', () => {
      const h3Manager = new HttpProtocolManager({ enableHttp3: true });
      const result = h3Manager.negotiate(['h3', 'h2', 'http/1.1'], {
        supportedVersions: [HttpProtocolVersion.Http3, HttpProtocolVersion.Http2],
        enableHttp3: true,
        headerTableSize: 4096,
        maxConcurrentStreams: 100,
        initialWindowSize: 65535,
      });
      expect(result.version).toBe(HttpProtocolVersion.Http3);
    });

    it('should not negotiate H3 when disabled', () => {
      const result = manager.negotiate(['h3', 'h2'], {
        supportedVersions: [HttpProtocolVersion.Http3, HttpProtocolVersion.Http2],
        enableHttp3: true,
        headerTableSize: 4096,
        maxConcurrentStreams: 100,
        initialWindowSize: 65535,
      });
      expect(result.version).toBe(HttpProtocolVersion.Http2);
    });
  });

  describe('createSession', () => {
    it('should create Http1Session for HTTP/1.1', () => {
      const session = manager.createSession(HttpProtocolVersion.Http1_1);
      expect(session).toBeInstanceOf(Http1Session);
      expect(session.canMultiplex()).toBe(false);
    });

    it('should create Http2Session for HTTP/2', () => {
      const session = manager.createSession(HttpProtocolVersion.Http2);
      expect(session).toBeInstanceOf(Http2Session);
      expect(session.canMultiplex()).toBe(true);
    });

    it('should create Http3Session for HTTP/3', () => {
      const session = manager.createSession(HttpProtocolVersion.Http3);
      expect(session).toBeInstanceOf(Http3Session);
      expect(session.canMultiplex()).toBe(true);
    });
  });

  describe('frame header', () => {
    it('should build and parse frame header round-trip', () => {
      const header = {
        length: 1024,
        type: Http2FrameType.Data,
        flags: 0x01,
        streamId: 3,
      };
      const bytes = manager.buildFrameHeader(header);
      expect(bytes.length).toBe(HTTP2_FRAME_HEADER_SIZE);

      const parsed = manager.parseFrameHeader(bytes);
      expect(parsed.length).toBe(1024);
      expect(parsed.type).toBe(Http2FrameType.Data);
      expect(parsed.flags).toBe(0x01);
      expect(parsed.streamId).toBe(3);
    });

    it('should throw on undersized frame header', () => {
      const bytes = new Uint8Array(5);
      expect(() => manager.parseFrameHeader(bytes)).toThrow();
    });
  });
});

describe('Http1Session', () => {
  it('should encode headers as HTTP/1.1 text', () => {
    const session = new Http1Session();
    const encoded = session.encodeHeaders([
      { name: 'host', value: 'example.com' },
      { name: 'accept', value: 'text/html' },
    ]);
    const text = new TextDecoder().decode(encoded);
    expect(text).toContain('host: example.com');
    expect(text).toContain('accept: text/html');
    expect(text).toContain('\r\n\r\n');
  });

  it('should not support multiplexing', () => {
    const session = new Http1Session();
    expect(session.canMultiplex()).toBe(false);
    expect(session.createStream()).toBe(1);
  });
});

describe('Http2Session', () => {
  it('should create multiple streams', () => {
    const session = new Http2Session();
    const s1 = session.createStream();
    const s2 = session.createStream();
    expect(s1).toBe(1);
    expect(s2).toBe(3); // Client streams use odd IDs.
  });

  it('should encode headers via HPACK', () => {
    const session = new Http2Session();
    const encoded = session.encodeHeaders([
      { name: ':method', value: 'GET' },
      { name: ':path', value: '/' },
    ]);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('should build settings frame', () => {
    const session = new Http2Session();
    const payload = session.buildSettingsFrame();
    expect(payload).toBeInstanceOf(Uint8Array);
    // 6 settings × 6 bytes each = 36 bytes.
    expect(payload.length).toBe(36);
  });

  it('should get settings', () => {
    const session = new Http2Session({ maxConcurrentStreams: 200 });
    expect(session.getSettings().maxConcurrentStreams).toBe(200);
  });
});

describe('Http3Session', () => {
  it('should create bidirectional streams', () => {
    const session = new Http3Session();
    const s1 = session.createStream();
    const s2 = session.createStream();
    expect(s1).toBe(0);
    expect(s2).toBe(4);
  });

  it('should support multiplexing', () => {
    const session = new Http3Session();
    expect(session.canMultiplex()).toBe(true);
  });
});

describe('HpackEncoder', () => {
  it('should encode headers', () => {
    const encoder = new HpackEncoder();
    const encoded = encoder.encode([
      { name: ':method', value: 'GET' },
      { name: ':path', value: '/' },
    ]);
    expect(encoded).toBeInstanceOf(Uint8Array);
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('should use static table for known headers', () => {
    const encoder = new HpackEncoder();
    const encoded = encoder.encode([{ name: ':method', value: 'GET' }]);
    // Indexed header = 1 byte.
    expect(encoded.length).toBe(1);
    expect(encoded[0]! & 0x80).toBe(0x80); // Indexed prefix bit.
  });

  it('should reset the dynamic table', () => {
    const encoder = new HpackEncoder();
    encoder.encode([{ name: 'x-custom', value: 'value' }]);
    encoder.reset();
    // After reset, the custom header is no longer in the table.
    const encoded = encoder.encode([{ name: 'x-custom', value: 'value' }]);
    expect(encoded.length).toBeGreaterThan(1); // Literal encoding.
  });
});
