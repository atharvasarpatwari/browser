import type { IDisposable } from '../../app/dependency-container';
import { loadNodeBuiltin } from './node-builtins';
import { concatBytes, decodeUtf8, encodeUtf8, hexFromBytes, indexOfBytes } from './byte-codecs';

interface MultipartField {
  readonly name: string;
  readonly value: string;
  readonly contentType?: string;
}

interface MultipartFile {
  readonly name: string;
  readonly filename: string;
  readonly contentType: string;
  readonly data: Uint8Array | string;
}

interface MultipartBody {
  readonly contentType: string;
  readonly body: Uint8Array;
  readonly boundary: string;
}

interface IMultipartBuilder extends IDisposable {
  build(fields?: readonly MultipartField[], files?: readonly MultipartFile[]): MultipartBody;
  parse(contentType: string, body: Uint8Array): Promise<{ fields: MultipartField[]; files: MultipartFile[] }>;
}

class MultipartBuilder implements IMultipartBuilder {
  private boundaryCounter = 0;

  build(fields?: readonly MultipartField[], files?: readonly MultipartFile[]): MultipartBody {
    const boundary = this.generateBoundary();
    const parts: Uint8Array[] = [];

    if (fields) {
      for (const field of fields) {
        parts.push(this.encodeField(field, boundary));
      }
    }

    if (files) {
      for (const file of files) {
        parts.push(this.encodeFile(file, boundary));
      }
    }

    parts.push(encodeUtf8(`--${boundary}--\r\n`));

    return {
      contentType: `multipart/form-data; boundary=${boundary}`,
      body: concatBytes(parts),
      boundary,
    };
  }

  async parse(contentType: string, body: Uint8Array): Promise<{ fields: MultipartField[]; files: MultipartFile[] }> {
    const boundary = this.extractBoundary(contentType);
    if (!boundary) {
      throw new MultipartError('No boundary found in Content-Type');
    }

    const fields: MultipartField[] = [];
    const files: MultipartFile[] = [];

    const parts = this.splitByBoundary(body, boundary);
    for (const part of parts) {
      const parsed = this.parsePart(part);
      if (parsed) {
        const isFile = parsed.filename !== undefined;
        if (isFile) {
          files.push({
            name: parsed.name,
            filename: parsed.filename!,
            contentType: parsed.contentType || 'application/octet-stream',
            data: parsed.data,
          });
        } else {
          fields.push({
            name: parsed.name,
            value: decodeUtf8(parsed.data),
            contentType: parsed.contentType,
          });
        }
      }
    }

    return { fields, files };
  }

  private generateBoundary(): string {
    this.boundaryCounter++;
    const crypto = loadNodeBuiltin<typeof import('node:crypto')>('node:crypto');
    const rand = crypto ? hexFromBytes(new Uint8Array(crypto.randomBytes(16))) : this.randomHexFallback(16);
    return `----NovaFormBoundary${rand}${this.boundaryCounter}`;
  }

  private randomHexFallback(numBytes: number): string {
    let out = '';
    for (let i = 0; i < numBytes; i++) {
      out += Math.floor(Math.random() * 256).toString(16).padStart(2, '0');
    }
    return out;
  }

  private encodeField(field: MultipartField, boundary: string): Uint8Array {
    const lines: string[] = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${field.name}"`,
    ];
    if (field.contentType) {
      lines.push(`Content-Type: ${field.contentType}`);
    }
    lines.push('');
    lines.push(field.value);
    lines.push('');
    return encodeUtf8(lines.join('\r\n'));
  }

  private encodeFile(file: MultipartFile, boundary: string): Uint8Array {
    const headerLines: string[] = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"`,
      `Content-Type: ${file.contentType}`,
      '',
      '',
    ];
    const header = encodeUtf8(headerLines.join('\r\n'));
    const data = typeof file.data === 'string' ? encodeUtf8(file.data) : file.data;
    return concatBytes([header, data, encodeUtf8('\r\n')]);
  }

  private extractBoundary(contentType: string): string | null {
    const match = /boundary=([^;\s]+)/i.exec(contentType);
    return match ? match[1]!.replace(/^"|"$/g, '') : null;
  }

  private splitByBoundary(body: Uint8Array, boundary: string): Uint8Array[] {
    const delim = encodeUtf8(`--${boundary}`);
    const parts: Uint8Array[] = [];

    let pos = 0;
    while (pos < body.length) {
      const delimStart = indexOfBytes(body, delim, pos);
      if (delimStart === -1) break;

      const segmentStart = delimStart + delim.length;
      const nextDelim = indexOfBytes(body, delim, segmentStart);
      if (nextDelim === -1) break;

      // Closing boundary ("--boundary--") terminates the body.
      if (body[segmentStart] === 0x2d && body[segmentStart + 1] === 0x2d) break;

      let seg = body.subarray(segmentStart, nextDelim);
      if (seg.length >= 2 && seg[0] === 0x0d && seg[1] === 0x0a) seg = seg.subarray(2);
      if (seg.length >= 2 && seg[seg.length - 2] === 0x0d && seg[seg.length - 1] === 0x0a) seg = seg.subarray(0, seg.length - 2);

      if (seg.length > 0) {
        parts.push(seg);
      }
      pos = nextDelim;
    }

    return parts;
  }

  private parsePart(part: Uint8Array): { name: string; filename?: string; contentType?: string; data: Uint8Array } | null {
    const crlfCrlf = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]);
    const headerEndIdx = indexOfBytes(part, crlfCrlf);
    if (headerEndIdx === -1) return null;

    const headerSection = decodeUtf8(part.subarray(0, headerEndIdx));
    const data = part.subarray(headerEndIdx + 4);

    const nameMatch = /Content-Disposition:[^;]*;\s*name="([^"]*)"/i.exec(headerSection);
    if (!nameMatch) return null;
    const name = nameMatch[1]!;

    const filenameMatch = /filename="([^"]*)"/i.exec(headerSection);
    const filename = filenameMatch ? filenameMatch[1] : undefined;

    const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerSection);
    const contentType = ctMatch ? ctMatch[1]!.trim() : undefined;

    return { name, filename, contentType, data };
  }

  dispose(): void {
    this.boundaryCounter = 0;
  }
}

class MultipartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultipartError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export { MultipartBuilder, MultipartError };
export type { IMultipartBuilder, MultipartBody, MultipartField, MultipartFile };
