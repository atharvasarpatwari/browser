declare module 'electron' {
  export const shell: {
    openExternal(url: string): Promise<void>;
  };
}

/** Preload bridge — exposed via contextBridge in electron/preload.cjs */
interface NovaPreloadBridge {
  require(name: string): unknown;
  process: {
    readonly platform: string;
    readonly arch: string;
    readonly pid: number;
    readonly version: string;
    readonly versions: { node?: string; chrome?: string; electron?: string };
    readonly env: Record<string, string | undefined>;
    on(event: string, handler: (...args: unknown[]) => void): void;
    listeners(event: string): ((...args: unknown[]) => void)[];
    removeAllListeners(event: string): void;
  };
  buffer: {
    from(data: string | ArrayBufferView, encoding?: string): Uint8Array;
    alloc(size: number, fill?: number): Uint8Array;
    concat(list: Uint8Array[], totalLength?: number): Uint8Array;
    isBuffer(obj: unknown): boolean;
  };
}

interface Window {
  nova?: NovaPreloadBridge;
}
