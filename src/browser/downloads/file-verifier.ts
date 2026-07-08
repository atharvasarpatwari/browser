import type { IDisposable } from '../../app/dependency-container';

type VerificationStatus = 'unknown' | 'safe' | 'suspicious' | 'malicious' | 'error';

interface FileVerificationResult {
  readonly filename: string;
  readonly status: VerificationStatus;
  readonly mimeType: string;
  readonly extension: string;
  readonly fileSize: number;
  readonly scanned: boolean;
  readonly threats: readonly string[];
  readonly details: string | null;
}

interface VerifierOptions {
  readonly maxFileSizeBytes: number;
  readonly blockedExtensions: ReadonlySet<string>;
  readonly suspiciousExtensions: ReadonlySet<string>;
  readonly scanEnabled: boolean;
}

const DEFAULT_OPTIONS: VerifierOptions = {
  maxFileSizeBytes: 500 * 1024 * 1024,
  blockedExtensions: new Set([
    '.exe', '.bat', '.cmd', '.com', '.msi', '.scr', '.pif',
    '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.ps1',
    '.psm1', '.psd1', '.reg', '.inf',
  ]),
  suspiciousExtensions: new Set([
    '.zip', '.rar', '.7z', '.tar', '.gz', '.docm', '.xlsm',
    '.pptm', '.jar', '.app', '.dmg',
  ]),
  scanEnabled: true,
};

interface IFileVerifier extends IDisposable {
  verify(filename: string, mimeType: string, fileSize: number): Promise<FileVerificationResult>;
  isExtensionBlocked(extension: string): boolean;
  isExtensionSuspicious(extension: string): boolean;
  getOptions(): VerifierOptions;
  updateOptions(options: Partial<VerifierOptions>): void;
}

class FileVerifier implements IFileVerifier {
  private options: VerifierOptions;

  constructor(options?: Partial<VerifierOptions>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  async verify(filename: string, mimeType: string, fileSize: number): Promise<FileVerificationResult> {
    const extension = this.getExtension(filename);
    const threats: string[] = [];

    if (fileSize > this.options.maxFileSizeBytes) {
      threats.push(`File exceeds maximum size of ${this.options.maxFileSizeBytes} bytes`);
    }

    if (this.isExtensionBlocked(extension)) {
      threats.push(`File extension "${extension}" is blocked for security reasons`);
    }

    if (this.isExtensionSuspicious(extension)) {
      threats.push(`File extension "${extension}" is potentially dangerous`);
    }

    const dangerousMimeTypes = [
      'application/x-msdownload',
      'application/x-msdos-program',
      'application/x-msinstaller',
      'application/x-javascript',
      'application/x-vbscript',
    ];

    if (dangerousMimeTypes.includes(mimeType.toLowerCase())) {
      threats.push(`MIME type "${mimeType}" is associated with executable content`);
    }

    let status: VerificationStatus = 'unknown';
    if (!this.options.scanEnabled) {
      status = 'unknown';
    } else if (threats.length === 0) {
      status = 'safe';
    } else if (threats.length <= 1) {
      status = 'suspicious';
    } else {
      status = 'malicious';
    }

    return {
      filename,
      status,
      mimeType,
      extension,
      fileSize,
      scanned: this.options.scanEnabled,
      threats,
      details: threats.length > 0 ? threats.join('; ') : null,
    };
  }

  isExtensionBlocked(extension: string): boolean {
    return this.options.blockedExtensions.has(extension.toLowerCase());
  }

  isExtensionSuspicious(extension: string): boolean {
    return this.options.suspiciousExtensions.has(extension.toLowerCase());
  }

  getOptions(): VerifierOptions {
    return { ...this.options };
  }

  updateOptions(options: Partial<VerifierOptions>): void {
    if (options.maxFileSizeBytes !== undefined) {
      this.options = { ...this.options, maxFileSizeBytes: options.maxFileSizeBytes };
    }
    if (options.blockedExtensions !== undefined) {
      this.options = { ...this.options, blockedExtensions: options.blockedExtensions };
    }
    if (options.suspiciousExtensions !== undefined) {
      this.options = { ...this.options, suspiciousExtensions: options.suspiciousExtensions };
    }
    if (options.scanEnabled !== undefined) {
      this.options = { ...this.options, scanEnabled: options.scanEnabled };
    }
  }

  private getExtension(filename: string): string {
    const dot = filename.lastIndexOf('.');
    return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
  }

  dispose(): void {
    this.options = { ...DEFAULT_OPTIONS };
  }
}

export { FileVerifier, DEFAULT_OPTIONS };
export type { IFileVerifier, FileVerificationResult, VerificationStatus, VerifierOptions };
