import type { IDisposable } from '../../app/dependency-container';

interface IMediaSource extends IDisposable {
  create(sourceUrl?: string): string;
  addSourceBuffer(mimeType: string): ISourceBuffer;
  removeSourceBuffer(buffer: ISourceBuffer): void;
  endOfStream(error?: string): void;
  setDuration(duration: number): void;
  get duration(): number;
  get readyState(): MediaSourceReadyState;
  get sourceBuffers(): ISourceBuffer[];
  get activeSourceBuffers(): ISourceBuffer[];
  onEvent(handler: MediaSourceEventHandler): () => void;
}

interface ISourceBuffer extends IDisposable {
  appendBuffer(data: ArrayBuffer | Uint8Array): void;
  remove(start: number, end: number): void;
  abort(): void;
  updateTimestampOffset(offset: number): void;
  updateAppendWindowStart(start: number): void;
  updateAppendWindowEnd(end: number): void;
  get mode(): SourceBufferMode;
  setMode(mode: SourceBufferMode): void;
  get mimeType(): string;
  get updating(): boolean;
  get buffered(): TimeRange[];
  get timestampOffset(): number;
  get appendWindowStart(): number;
  get appendWindowEnd(): number;
  onEvent(handler: SourceBufferEventHandler): () => void;
}

type MediaSourceReadyState = 'closed' | 'open' | 'ended';
type SourceBufferMode = 'segments' | 'sequence';
type TimeRange = { start: number; end: number };

type MediaSourceEventKind = 'sourceopen' | 'sourceended' | 'sourceclose' | 'error';
interface MediaSourceEvent {
  readonly kind: MediaSourceEventKind;
  readonly data?: Record<string, unknown>;
}
type MediaSourceEventHandler = (event: MediaSourceEvent) => void;

type SourceBufferEventKind = 'updatestart' | 'update' | 'updateend' | 'error' | 'abort';
interface SourceBufferEvent {
  readonly kind: SourceBufferEventKind;
  readonly buffer: ISourceBuffer;
  readonly data?: Record<string, unknown>;
}
type SourceBufferEventHandler = (event: SourceBufferEvent) => void;

let msCounter = 0;

class SourceBufferImpl implements ISourceBuffer {
  private _mimeType: string;
  private _mode: SourceBufferMode = 'segments';
  private _updating = false;
  private _timestampOffset = 0;
  private _appendWindowStart = 0;
  private _appendWindowEnd = Infinity;
  private _buffered: TimeRange[] = [];
  private _bufferedData = new Uint8Array(0);
  private handlers = new Set<SourceBufferEventHandler>();

  constructor(mimeType: string) {
    this._mimeType = mimeType;
  }

  get mimeType(): string { return this._mimeType; }
  get updating(): boolean { return this._updating; }
  get buffered(): TimeRange[] { return [...this._buffered]; }
  get timestampOffset(): number { return this._timestampOffset; }
  get appendWindowStart(): number { return this._appendWindowStart; }
  get appendWindowEnd(): number { return this._appendWindowEnd; }
  get mode(): SourceBufferMode { return this._mode; }
  setMode(mode: SourceBufferMode): void { this._mode = mode; }

  appendBuffer(data: ArrayBuffer | Uint8Array): void {
    this._updating = true;
    this.emit({ kind: 'updatestart', buffer: this });
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    const combined = new Uint8Array(this._bufferedData.length + bytes.length);
    combined.set(this._bufferedData);
    combined.set(bytes, this._bufferedData.length);
    this._bufferedData = combined;
    const totalDuration = this._bufferedData.length / 1024;
    const existing = this._buffered.length > 0 ? this._buffered[this._buffered.length - 1].end : 0;
    this._buffered.push({ start: existing, end: existing + totalDuration });
    setTimeout(() => {
      this._updating = false;
      this.emit({ kind: 'update', buffer: this });
      this.emit({ kind: 'updateend', buffer: this });
    }, 50);
  }

  remove(start: number, end: number): void {
    this._updating = true;
    this.emit({ kind: 'updatestart', buffer: this });
    this._buffered = this._buffered.filter(r => r.end <= start || r.start >= end);
    setTimeout(() => {
      this._updating = false;
      this.emit({ kind: 'update', buffer: this, data: { removeStart: start, removeEnd: end } });
      this.emit({ kind: 'updateend', buffer: this });
    }, 50);
  }

  abort(): void {
    this._updating = false;
    this.emit({ kind: 'abort', buffer: this });
  }

  updateTimestampOffset(offset: number): void { this._timestampOffset = offset; }
  updateAppendWindowStart(start: number): void { this._appendWindowStart = start; }
  updateAppendWindowEnd(end: number): void { this._appendWindowEnd = end; }

  onEvent(handler: SourceBufferEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: SourceBufferEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.handlers.clear();
    this._buffered = [];
    this._bufferedData = new Uint8Array(0);
    this._updating = false;
  }
}

class MediaSource implements IMediaSource {
  private _duration = 0;
  private _readyState: MediaSourceReadyState = 'closed';
  private _sourceBuffers: Map<string, SourceBufferImpl> = new Map();
  private _objectUrl: string;
  private handlers = new Set<MediaSourceEventHandler>();

  constructor(sourceUrl?: string) {
    this._objectUrl = sourceUrl ?? `mediasource-${++msCounter}`;
  }

  get duration(): number { return this._duration; }
  get readyState(): MediaSourceReadyState { return this._readyState; }
  get sourceBuffers(): ISourceBuffer[] { return [...this._sourceBuffers.values()]; }
  get activeSourceBuffers(): ISourceBuffer[] { return [...this._sourceBuffers.values()]; }

  create(sourceUrl?: string): string {
    if (sourceUrl) this._objectUrl = sourceUrl;
    this._readyState = 'open';
    this.emit({ kind: 'sourceopen' });
    return this._objectUrl;
  }

  addSourceBuffer(mimeType: string): ISourceBuffer {
    if (this._readyState !== 'open') throw new Error('MediaSource is not open');
    const buf = new SourceBufferImpl(mimeType);
    this._sourceBuffers.set(mimeType, buf);
    return buf;
  }

  removeSourceBuffer(buffer: ISourceBuffer): void {
    for (const [key, val] of this._sourceBuffers) {
      if (val === buffer) {
        this._sourceBuffers.delete(key);
        buffer.dispose();
        return;
      }
    }
  }

  endOfStream(error?: string): void {
    this._readyState = 'ended';
    this.emit({ kind: 'sourceended', data: { error: error ?? null } });
  }

  setDuration(duration: number): void {
    this._duration = Math.max(0, duration);
  }

  onEvent(handler: MediaSourceEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: MediaSourceEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this._readyState = 'closed';
    for (const buf of this._sourceBuffers.values()) buf.dispose();
    this._sourceBuffers.clear();
    this.handlers.clear();
    this.emit({ kind: 'sourceclose' });
  }
}

export { MediaSource, SourceBufferImpl };
export type { IMediaSource, ISourceBuffer, MediaSourceReadyState, SourceBufferMode, TimeRange, MediaSourceEvent, MediaSourceEventKind, MediaSourceEventHandler, SourceBufferEvent, SourceBufferEventKind, SourceBufferEventHandler };
