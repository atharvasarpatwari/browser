import type { IDisposable } from '../../app/dependency-container';

enum ContentCoding {
  Gzip    = 'gzip',
  Deflate = 'deflate',
  Brotli  = 'br',
  Identity = 'identity',
}

interface IContentDecoder extends IDisposable {
  decode(encoding: ContentCoding, data: Buffer): Promise<Buffer>;
  decodeFromString(encoding: string, data: string): Promise<Buffer>;
  isSupported(encoding: ContentCoding): boolean;
}

class ContentDecoder implements IContentDecoder {
  private brotliAvailable = false;

  constructor() {
    try {
      require('node:zlib');
      try { require('node:zlib').brotliDecompressSync(Buffer.alloc(0)); this.brotliAvailable = true; }
      catch { this.brotliAvailable = false; }
    } catch {
      this.brotliAvailable = false;
    }
  }

  async decode(encoding: ContentCoding, data: Buffer): Promise<Buffer> {
    if (encoding === ContentCoding.Identity || !data.length) return data;

    const zlib = await import('node:zlib');

    switch (encoding) {
      case ContentCoding.Gzip:
        return new Promise<Buffer>((resolve, reject) => {
          zlib.gunzip(data, (err, result) => {
            if (err) reject(new ContentEncodingError(`gzip decompression failed: ${err.message}`));
            else resolve(result);
          });
        });

      case ContentCoding.Deflate:
        return new Promise<Buffer>((resolve, reject) => {
          zlib.inflate(data, (err, result) => {
            if (err) {
              zlib.inflateRaw(data, (err2, result2) => {
                if (err2) reject(new ContentEncodingError(`deflate decompression failed: ${err.message}, raw: ${err2.message}`));
                else resolve(result2);
              });
            } else resolve(result);
          });
        });

      case ContentCoding.Brotli:
        if (!this.brotliAvailable) {
          throw new ContentEncodingError('brotli decompression is not available in this runtime');
        }
        return new Promise<Buffer>((resolve, reject) => {
          zlib.brotliDecompress(data, (err, result) => {
            if (err) reject(new ContentEncodingError(`brotli decompression failed: ${err.message}`));
            else resolve(result);
          });
        });

      default:
        throw new ContentEncodingError(`Unsupported content encoding: ${encoding}`);
    }
  }

  async decodeFromString(encoding: string, data: string): Promise<Buffer> {
    const coding = this.parseEncoding(encoding);
    return this.decode(coding, Buffer.from(data, 'latin1'));
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

    const sourceData = bodyBinary ? Buffer.from(bodyBinary) : Buffer.from(body, 'latin1');
    const coding = this.parseEncoding(contentEncoding);
    const decoded = await this.decode(coding, sourceData);
    const decodedStr = decoded.toString('utf-8');

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

export {
  ContentDecoder,
  ContentEncodingError,
  ContentCoding,
  ACCEPT_ENCODING,
};
export type { IContentDecoder };
