import type { IDisposable } from '../../app/dependency-container';
import { loadNodeBuiltin } from './node-builtins';
import { decodeUtf8, encodeLatin1 } from './byte-codecs';

enum ContentCoding {
  Gzip    = 'gzip',
  Deflate = 'deflate',
  Brotli  = 'br',
  Identity = 'identity',
}

interface IContentDecoder extends IDisposable {
  decode(encoding: ContentCoding, data: Uint8Array): Promise<Uint8Array>;
  decodeFromString(encoding: string, data: string): Promise<Uint8Array>;
  isSupported(encoding: ContentCoding): boolean;
}

class ContentDecoder implements IContentDecoder {
  private brotliAvailable = false;

  constructor() {
    const zlib = loadNodeBuiltin<typeof import('node:zlib')>('node:zlib');
    if (zlib) {
      try {
        zlib.brotliDecompressSync(new Uint8Array(0));
        this.brotliAvailable = true;
      } catch {
        this.brotliAvailable = false;
      }
    }
  }

  async decode(encoding: ContentCoding, data: Uint8Array): Promise<Uint8Array> {
    if (encoding === ContentCoding.Identity || !data.length) return data;

    const zlib = loadNodeBuiltin<typeof import('node:zlib')>('node:zlib');
    if (!zlib) {
      throw new ContentEncodingError('node:zlib is unavailable in this runtime');
    }

    switch (encoding) {
      case ContentCoding.Gzip:
        return new Promise<Uint8Array>((resolve, reject) => {
          zlib.gunzip(data, (err, result) => {
            if (err) reject(new ContentEncodingError(`gzip decompression failed: ${err.message}`));
            else resolve(toBytes(result));
          });
        });

      case ContentCoding.Deflate:
        return new Promise<Uint8Array>((resolve, reject) => {
          zlib.inflate(data, (err, result) => {
            if (err) {
              zlib.inflateRaw(data, (err2, result2) => {
                if (err2) reject(new ContentEncodingError(`deflate decompression failed: ${err.message}, raw: ${err2.message}`));
                else resolve(toBytes(result2));
              });
            } else resolve(toBytes(result));
          });
        });

      case ContentCoding.Brotli:
        if (!this.brotliAvailable) {
          throw new ContentEncodingError('brotli decompression is not available in this runtime');
        }
        return new Promise<Uint8Array>((resolve, reject) => {
          zlib.brotliDecompress(data, (err, result) => {
            if (err) reject(new ContentEncodingError(`brotli decompression failed: ${err.message}`));
            else resolve(toBytes(result));
          });
        });

      default:
        throw new ContentEncodingError(`Unsupported content encoding: ${encoding}`);
    }
  }

  async decodeFromString(encoding: string, data: string): Promise<Uint8Array> {
    const coding = this.parseEncoding(encoding);
    return this.decode(coding, encodeLatin1(data));
  }

  isSupported(encoding: ContentCoding): boolean {
    if (encoding === ContentCoding.Identity) return true;
    if (encoding === ContentCoding.Brotli) return this.brotliAvailable;
    return true;
  }

  private parseEncoding(raw: string): ContentCoding {
    const lower = raw.trim().toLowerCase();
    if (lower.includes('gzip')) return ContentCoding.Gzip;
    if (lower.includes('deflate')) return ContentCoding.Deflate;
    if (lower.includes('br')) return ContentCoding.Brotli;
    return ContentCoding.Identity;
  }

  /** Decompress a full response body based on Content-Encoding header. */
  async decompressResponse(
    headers: ReadonlyMap<string, string>,
    body: string,
    bodyBinary: Uint8Array | null,
  ): Promise<{ body: string; bodyBinary: Uint8Array | null }> {
    const contentEncoding = headers.get('content-encoding');
    if (!contentEncoding || contentEncoding.trim().toLowerCase() === 'identity') {
      return { body, bodyBinary };
    }

    const sourceData = bodyBinary ?? encodeLatin1(body);
    const coding = this.parseEncoding(contentEncoding);
    const decoded = await this.decode(coding, sourceData);
    const decodedStr = decodeUtf8(decoded);

    const contentType = headers.get('content-type') ?? '';
    const isBinary = contentType.startsWith('image/')
      || contentType.startsWith('font/')
      || contentType.startsWith('audio/')
      || contentType.startsWith('video/');

    return {
      body: isBinary ? '' : decodedStr,
      bodyBinary: isBinary ? new Uint8Array(decoded) : null,
    };
  }

  dispose(): void { }
}

class ContentEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentEncodingError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const ACCEPT_ENCODING = 'gzip, deflate, br';

/** Normalize a zlib/Buffer result to a plain copy the bridge can carry. */
function toBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

export {
  ContentDecoder,
  ContentEncodingError,
  ContentCoding,
  ACCEPT_ENCODING,
};
export type { IContentDecoder };
