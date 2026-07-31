import type { IDisposable } from '../../app/dependency-container';

interface MultipartField {
  readonly name: string;
  readonly value: string;
  readonly contentType?: string;
}

interface MultipartFile {
  readonly name: string;
  readonly filename: string;
  readonly contentType: string;
  readonly data: Buffer | string;
}

interface MultipartBody {
  readonly contentType: string;
  readonly body: Buffer;
  readonly boundary: string;
}

interface IMultipartBuilder extends IDisposable {
  build(fields?: readonly MultipartField[], files?: readonly MultipartFile[]): MultipartBody;
  parse(contentType: string, body: Buffer): Promise<{ fields: MultipartField[]; files: MultipartFile[] }>;
}

class MultipartBuilder implements IMultipartBuilder {
  private boundaryCounter = 0;

  build(fields?: readonly MultipartField[], files?: readonly MultipartFile[]): MultipartBody {
    const boundary = this.generateBoundary();
    const parts: Buffer[] = [];

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

    parts.push(Buffer.from(`--${boundary}--\r\n`));

    return {
      contentType: `multipart/form-data; boundary=${boundary}`,
      body: Buffer.concat(parts),
      boundary,
    };
  }

  async parse(contentType: string, body: Buffer): Promise<{ fields: MultipartField[]; files: MultipartFile[] }> {
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
            value: parsed.data.toString('utf-8'),
            contentType: parsed.contentType,
          });
        }
      }
    }

    return { fields, files };
  }

  private generateBoundary(): string {
    this.boundaryCounter++;
    const crypto = require('crypto');
    const rand = crypto.randomBytes(16).toString('hex');
    return `----NovaFormBoundary${rand}${this.boundaryCounter}`;
  }

  private encodeField(field: MultipartField, boundary: string): Buffer {
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
    return Buffer.from(lines.join('\r\n'));
  }

  private encodeFile(file: MultipartFile, boundary: string): Buffer {
    const headerLines: string[] = [
      `--${boundary}`,
      `Content-Disposition: form-data; name="${file.name}"; filename="${file.filename}"`,
      `Content-Type: ${file.contentType}`,
      '',
      '',
    ];
    const header = Buffer.from(headerLines.join('\r\n'));
    const data = typeof file.data === 'string' ? Buffer.from(file.data, 'utf-8') : file.data;
    const trailer = Buffer.from('\r\n');
    return Buffer.concat([header, data, trailer]);
  }

  private extractBoundary(contentType: string): string | null {
    const match = /boundary=([^;\s]+)/i.exec(contentType);
    return match ? match[1]!.replace(/^"|"$/g, '') : null;
  }

  private splitByBoundary(body: Buffer, boundary: string): Buffer[] {
    const bodyStr = body.toString('binary');
    const delim = `--${boundary}`;
    const parts: Buffer[] = [];

    const segments = bodyStr.split(delim);

    for (let i = 1; i < segments.length - 1; i++) {
      const seg = segments[i]!;

      if (seg.startsWith('--')) break;

      let start = 0;
      if (seg.charCodeAt(0) === 0x0D && seg.charCodeAt(1) === 0x0A) start = 2;

      let end = seg.length;
      if (end >= 2 && seg.charCodeAt(end - 2) === 0x0D && seg.charCodeAt(end - 1) === 0x0A) end -= 2;

      if (end > start) {
        parts.push(Buffer.from(seg.slice(start, end), 'binary'));
      }
    }

    return parts;
  }

  private parsePart(part: Buffer): { name: string; filename?: string; contentType?: string; data: Buffer } | null {
    const headerEndIdx = part.indexOf('\r\n\r\n');
    if (headerEndIdx === -1) return null;

    const headerSection = part.slice(0, headerEndIdx).toString('utf-8');
    const data = part.slice(headerEndIdx + 4);

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
