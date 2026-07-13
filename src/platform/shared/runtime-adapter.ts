import type { IDisposable } from '../../app/dependency-container';

type RuntimeEnvironment = 'electron' | 'browser' | 'node' | 'unknown';

interface RuntimeInfo {
  readonly environment: RuntimeEnvironment;
  readonly platform: string;
  readonly arch: string;
  readonly version: string;
  readonly electronVersion: string | null;
  readonly chromeVersion: string | null;
  readonly nodeVersion: string | null;
  readonly hasWindow: boolean;
  readonly hasProcess: boolean;
  readonly hasFetch: boolean;
  readonly language: string;
  readonly hardwareConcurrency: number;
}

interface FileSystemOps {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array | string): Promise<void>;
  deleteFile(path: string): Promise<boolean>;
  fileExists(path: string): Promise<boolean>;
  readDirectory(path: string): Promise<readonly string[]>;
  createDirectory(path: string): Promise<void>;
  getFileSize(path: string): Promise<number>;
}

interface ClipboardOps {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  readImage(): Promise<Uint8Array | null>;
  writeImage(data: Uint8Array): Promise<void>;
}

interface ScreenInfo {
  readonly width: number;
  readonly height: number;
  readonly availWidth: number;
  readonly availHeight: number;
  readonly colorDepth: number;
  readonly pixelDepth: number;
  readonly devicePixelRatio: number;
}

interface IRuntimeAdapter extends IDisposable {
  getRuntimeInfo(): RuntimeInfo;
  getFileSystem(): FileSystemOps;
  getClipboard(): ClipboardOps;
  getScreenInfo(): ScreenInfo;
  openExternal(url: string): Promise<void>;
  beep(): void;
  showSaveDialog(options?: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
  showOpenDialog(options?: { multiple?: boolean; filters?: Array<{ name: string; extensions: string[] }> }): Promise<readonly string[]>;
  getenv(key: string): string | undefined;
  exit(code: number): void;
  getProcessId(): number;
}

class RuntimeAdapter implements IRuntimeAdapter {
  private runtimeInfo: RuntimeInfo;

  constructor() {
    const hasWindow = typeof window !== 'undefined' && window !== null;
    const hasProcess = typeof process !== 'undefined' && process !== null;
    const hasFetch = typeof fetch !== 'undefined' && fetch !== null;

    let environment: RuntimeEnvironment = 'unknown';
    if (hasProcess && hasWindow) environment = 'electron';
    else if (hasWindow) environment = 'browser';
    else if (hasProcess) environment = 'node';

    this.runtimeInfo = {
      environment,
      platform: hasProcess ? process.platform : navigator.platform,
      arch: hasProcess ? process.arch : 'unknown',
      version: hasProcess ? process.version : '',
      electronVersion: hasProcess ? (process.versions as Record<string, string>).electron ?? null : null,
      chromeVersion: hasProcess ? (process.versions as Record<string, string>).chrome ?? null : null,
      nodeVersion: hasProcess ? process.versions.node ?? null : null,
      hasWindow,
      hasProcess,
      hasFetch,
      language: hasWindow ? navigator.language : 'en-US',
      hardwareConcurrency: hasWindow ? navigator.hardwareConcurrency : 1,
    };
  }

  getRuntimeInfo(): RuntimeInfo {
    const { language, hardwareConcurrency } = typeof navigator !== 'undefined' ? navigator : { language: 'en-US', hardwareConcurrency: 1 };
    return { ...this.runtimeInfo, language, hardwareConcurrency };
  }

  getFileSystem(): FileSystemOps {
    return {
      readFile: async (_path: string) => {
        throw new Error('File system not available in this runtime');
      },
      writeFile: async (_path: string, _data: Uint8Array | string) => {
        throw new Error('File system not available in this runtime');
      },
      deleteFile: async (_path: string) => false,
      fileExists: async (_path: string) => false,
      readDirectory: async (_path: string) => [],
      createDirectory: async (_path: string) => {
        throw new Error('File system not available in this runtime');
      },
      getFileSize: async (_path: string) => 0,
    };
  }

  getClipboard(): ClipboardOps {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      return {
        readText: () => navigator.clipboard.readText(),
        writeText: (text: string) => navigator.clipboard.writeText(text),
        readImage: async () => null,
        writeImage: async (_data: Uint8Array) => {
          throw new Error('Image clipboard not available');
        },
      };
    }
    return {
      readText: async () => '',
      writeText: async (_text: string) => {},
      readImage: async () => null,
      writeImage: async (_data: Uint8Array) => {},
    };
  }

  getScreenInfo(): ScreenInfo {
    if (typeof screen !== 'undefined') {
      return {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        colorDepth: screen.colorDepth,
        pixelDepth: screen.pixelDepth,
        devicePixelRatio: typeof devicePixelRatio !== 'undefined' ? devicePixelRatio : 1,
      };
    }
    return {
      width: 1920, height: 1080,
      availWidth: 1920, availHeight: 1040,
      colorDepth: 24, pixelDepth: 24,
      devicePixelRatio: 1,
    };
  }

  async openExternal(url: string): Promise<void> {
    if (this.runtimeInfo.environment === 'electron') {
      try {
        const electron = await import('electron');
        await electron.shell.openExternal(url);
      } catch {
        window.open(url, '_blank');
      }
    } else {
      window.open(url, '_blank');
    }
  }

  beep(): void {
    if (typeof Audio !== 'undefined') {
      try {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        osc.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } catch { /* audio not available */ }
    }
  }

  async showSaveDialog(_options?: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null> {
    return null;
  }

  async showOpenDialog(_options?: { multiple?: boolean; filters?: Array<{ name: string; extensions: string[] }> }): Promise<readonly string[]> {
    return [];
  }

  getenv(key: string): string | undefined {
    if (typeof process !== 'undefined' && process.env) {
      return process.env[key];
    }
    return undefined;
  }

  exit(code: number): void {
    if (typeof process !== 'undefined') {
      process.exit(code);
    }
  }

  getProcessId(): number {
    if (typeof process !== 'undefined' && process.pid) {
      return process.pid;
    }
    return Math.floor(Math.random() * 100000);
  }

  dispose(): void {}
}

export { RuntimeAdapter };
export type { IRuntimeAdapter, RuntimeInfo, FileSystemOps, ClipboardOps, ScreenInfo, RuntimeEnvironment };
