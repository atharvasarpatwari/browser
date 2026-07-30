import type { IDisposable } from '../../app/dependency-container';

interface IVideoDecoder extends IDisposable {
  configure(config: VideoDecoderConfig): void;
  decode(chunk: EncodedVideoChunk): void;
  flush(): Promise<void>;
  reset(): void;
  get state(): CodecState;
  get decodeQueueSize(): number;
  onEvent(handler: VideoDecoderEventHandler): () => void;
}

interface IAudioDecoder extends IDisposable {
  configure(config: AudioDecoderConfig): void;
  decode(chunk: EncodedAudioChunk): void;
  flush(): Promise<void>;
  reset(): void;
  get state(): CodecState;
  get decodeQueueSize(): number;
  onEvent(handler: AudioDecoderEventHandler): () => void;
}

interface IVideoEncoder extends IDisposable {
  configure(config: VideoEncoderConfig): void;
  encode(frame: VideoFrame): void;
  flush(): Promise<void>;
  reset(): void;
  get state(): CodecState;
  get encodeQueueSize(): number;
  onEvent(handler: VideoEncoderEventHandler): () => void;
}

interface IAudioEncoder extends IDisposable {
  configure(config: AudioEncoderConfig): void;
  encode(frame: AudioData): void;
  flush(): Promise<void>;
  reset(): void;
  get state(): CodecState;
  get encodeQueueSize(): number;
  onEvent(handler: AudioEncoderEventHandler): () => void;
}

type CodecState = 'unconfigured' | 'configured' | 'closed';

interface VideoDecoderConfig {
  codec: string;
  description?: ArrayBuffer | null;
  codedWidth?: number;
  codedHeight?: number;
  displayWidth?: number;
  displayHeight?: number;
  hardwareAcceleration?: 'prefer-hardware' | 'prefer-software' | 'no-preference';
  optimizeForLatency?: boolean;
}

interface AudioDecoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: ArrayBuffer | null;
}

interface VideoEncoderConfig {
  codec: string;
  width: number;
  height: number;
  bitrate: number;
  framerate?: number;
  alpha?: 'discard' | 'keep';
  hardwareAcceleration?: 'prefer-hardware' | 'prefer-software' | 'no-preference';
  scalabilityMode?: string;
  latencyMode?: 'realtime' | 'quality';
}

interface AudioEncoderConfig {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  bitrate: number;
}

interface EncodedVideoChunk {
  readonly type: EncodedChunkType;
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;
  copyTo(destination: ArrayBuffer): void;
}

interface EncodedAudioChunk {
  readonly type: EncodedChunkType;
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;
  copyTo(destination: ArrayBuffer): void;
}

type EncodedChunkType = 'key' | 'delta';

interface VideoFrame {
  readonly timestamp: number;
  readonly duration: number | null;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly format: VideoPixelFormat | null;
  copyTo(destination: ArrayBuffer, layout: VideoFrameCopyLayout[]): Promise<VideoFrameCopyLayout[]>;
  close(): void;
}

type VideoPixelFormat = 'I420' | 'I420A' | 'I422' | 'I444' | 'NV12' | 'RGBA' | 'RGBX' | 'BGRA' | 'BGRX';

interface VideoFrameCopyLayout {
  readonly offset: number;
  readonly stride: number;
}

interface AudioData {
  readonly timestamp: number;
  readonly duration: number | null;
  readonly numberOfChannels: number;
  readonly numberOfFrames: number;
  readonly sampleRate: number;
  readonly format: AudioSampleFormat;
  copyTo(destination: ArrayBuffer, options: AudioDataCopyToOptions): void;
  close(): void;
}

type AudioSampleFormat = 'u8' | 's16' | 's32' | 'f32' | 'u8-planar' | 's16-planar' | 's32-planar' | 'f32-planar';

interface AudioDataCopyToOptions {
  planeIndex: number;
  frameOffset?: number;
  frameCount?: number;
  format?: AudioSampleFormat;
}

interface EncodedVideoChunkMetadata {
  decoderConfig?: VideoDecoderConfig | null;
  svc?: SvcOutputMetadata | null;
}

interface SvcOutputMetadata {
  temporalLayerId: number;
}

interface EncodedAudioChunkMetadata {
  decoderConfig?: AudioDecoderConfig | null;
}

interface VideoFrameOutputMetadata {
  svc?: SvcOutputMetadata | null;
}

type VideoDecoderEventKind = 'output' | 'error';
interface VideoDecoderEvent {
  readonly kind: VideoDecoderEventKind;
  readonly decoder: IVideoDecoder;
  readonly data?: Record<string, unknown>;
}
type VideoDecoderEventHandler = (event: VideoDecoderEvent) => void;

type AudioDecoderEventKind = 'output' | 'error';
interface AudioDecoderEvent {
  readonly kind: AudioDecoderEventKind;
  readonly decoder: IAudioDecoder;
  readonly data?: Record<string, unknown>;
}
type AudioDecoderEventHandler = (event: AudioDecoderEvent) => void;

type VideoEncoderEventKind = 'output' | 'error';
interface VideoEncoderEvent {
  readonly kind: VideoEncoderEventKind;
  readonly encoder: IVideoEncoder;
  readonly data?: Record<string, unknown>;
}
type VideoEncoderEventHandler = (event: VideoEncoderEvent) => void;

type AudioEncoderEventKind = 'output' | 'error';
interface AudioEncoderEvent {
  readonly kind: AudioEncoderEventKind;
  readonly encoder: IAudioEncoder;
  readonly data?: Record<string, unknown>;
}
type AudioEncoderEventHandler = (event: AudioEncoderEvent) => void;

function isCodecSupported(codec: string): boolean {
  const supported = [
    'avc1.42E01E', 'avc1.4D401E', 'avc1.64001E',
    'hvc1.1.6.L93.0', 'hev1.1.6.L93.0',
    'vp8', 'vp09.00.10.08', 'vp09.00.11.08',
    'av01.0.00M.08', 'av01.1.00M.08',
    'mp4a.40.2', 'opus', 'vorbis',
    'flac', 'pcm-f32', 'pcm-s16',
  ];
  return supported.some(s => codec.startsWith(s.split('.')[0]) || codec === s);
}

class EncodedVideoChunkImpl implements EncodedVideoChunk {
  readonly type: EncodedChunkType;
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;
  private data: ArrayBuffer;

  constructor(type: EncodedChunkType, timestamp: number, duration: number | null, data: ArrayBuffer) {
    this.type = type; this.timestamp = timestamp; this.duration = duration;
    this.data = data; this.byteLength = data.byteLength;
  }

  copyTo(destination: ArrayBuffer): void {
    const src = new Uint8Array(this.data);
    const dst = new Uint8Array(destination);
    const len = Math.min(src.length, dst.length);
    for (let i = 0; i < len; i++) dst[i] = src[i];
  }
}

class EncodedAudioChunkImpl implements EncodedAudioChunk {
  readonly type: EncodedChunkType;
  readonly timestamp: number;
  readonly duration: number | null;
  readonly byteLength: number;
  private data: ArrayBuffer;

  constructor(type: EncodedChunkType, timestamp: number, duration: number | null, data: ArrayBuffer) {
    this.type = type; this.timestamp = timestamp; this.duration = duration;
    this.data = data; this.byteLength = data.byteLength;
  }

  copyTo(destination: ArrayBuffer): void {
    const src = new Uint8Array(this.data);
    const dst = new Uint8Array(destination);
    const len = Math.min(src.length, dst.length);
    for (let i = 0; i < len; i++) dst[i] = src[i];
  }
}

class VideoFrameImpl implements VideoFrame {
  readonly timestamp: number;
  readonly duration: number | null;
  readonly codedWidth: number;
  readonly codedHeight: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly format: VideoPixelFormat | null;
  private data: ArrayBuffer;
  private _closed = false;

  constructor(timestamp: number, duration: number | null, width: number, height: number, format: VideoPixelFormat = 'NV12') {
    this.timestamp = timestamp; this.duration = duration;
    this.codedWidth = width; this.codedHeight = height;
    this.displayWidth = width; this.displayHeight = height;
    this.format = format;
    this.data = new ArrayBuffer(width * height * 4);
  }

  async copyTo(_destination: ArrayBuffer, _layout: VideoFrameCopyLayout[]): Promise<VideoFrameCopyLayout[]> {
    return [{ offset: 0, stride: this.codedWidth }];
  }

  close(): void { this._closed = true; }
}

class AudioDataImpl implements AudioData {
  readonly timestamp: number;
  readonly duration: number | null;
  readonly numberOfChannels: number;
  readonly numberOfFrames: number;
  readonly sampleRate: number;
  readonly format: AudioSampleFormat;
  private data: ArrayBuffer;
  private _closed = false;

  constructor(timestamp: number, duration: number | null, channels: number, frames: number, sampleRate: number, format: AudioSampleFormat = 'f32') {
    this.timestamp = timestamp; this.duration = duration;
    this.numberOfChannels = channels; this.numberOfFrames = frames;
    this.sampleRate = sampleRate; this.format = format;
    this.data = new ArrayBuffer(channels * frames * 4);
  }

  copyTo(_destination: ArrayBuffer, _options: AudioDataCopyToOptions): void {}
  close(): void { this._closed = true; }
}

abstract class CodecBase<TEvent, THandler extends (...args: unknown[]) => void> implements IDisposable {
  protected _state: CodecState = 'unconfigured';
  protected _queueSize = 0;
  protected handlers = new Set<THandler>();
  protected configApplied = false;

  get state(): CodecState { return this._state; }
  get decodeQueueSize(): number { return this._queueSize; }
  get encodeQueueSize(): number { return this._queueSize; }

  abstract configure(config: unknown): void;
  abstract reset(): void;

  onEvent(handler: THandler): () => void {
    this.handlers.add(handler as THandler);
    return () => { this.handlers.delete(handler as THandler); };
  }

  protected emit(event: TEvent): void {
    for (const h of this.handlers) {
      try { (h as Function)(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this._state = 'closed';
    this.handlers.clear();
    this._queueSize = 0;
  }
}

class VideoDecoderImpl extends CodecBase<VideoDecoderEvent, VideoDecoderEventHandler> implements IVideoDecoder {
  private config: VideoDecoderConfig | null = null;

  configure(config: VideoDecoderConfig): void {
    if (!isCodecSupported(config.codec)) {
      this.emit({ kind: 'error', decoder: this, data: { message: `Unsupported codec: ${config.codec}` } });
      return;
    }
    this.config = config;
    this._state = 'configured';
    this.configApplied = true;
  }

  decode(_chunk: EncodedVideoChunk): void {
    if (this._state !== 'configured') return;
    this._queueSize++;
    setTimeout(() => {
      this._queueSize = Math.max(0, this._queueSize - 1);
      const frame = new VideoFrameImpl(_chunk.timestamp, _chunk.duration, this.config?.codedWidth ?? 1920, this.config?.codedHeight ?? 1080);
      this.emit({ kind: 'output', decoder: this, data: { frame } });
    }, 50);
  }

  async flush(): Promise<void> {
    this._queueSize = 0;
  }

  reset(): void {
    this.config = null;
    this._state = 'unconfigured';
    this._queueSize = 0;
    this.configApplied = false;
  }
}

class AudioDecoderImpl extends CodecBase<AudioDecoderEvent, AudioDecoderEventHandler> implements IAudioDecoder {
  private config: AudioDecoderConfig | null = null;

  configure(config: AudioDecoderConfig): void {
    if (!isCodecSupported(config.codec)) {
      this.emit({ kind: 'error', decoder: this, data: { message: `Unsupported codec: ${config.codec}` } });
      return;
    }
    this.config = config;
    this._state = 'configured';
    this.configApplied = true;
  }

  decode(_chunk: EncodedAudioChunk): void {
    if (this._state !== 'configured') return;
    this._queueSize++;
    setTimeout(() => {
      this._queueSize = Math.max(0, this._queueSize - 1);
      const data = new AudioDataImpl(_chunk.timestamp, _chunk.duration, this.config?.numberOfChannels ?? 2, 1024, this.config?.sampleRate ?? 44100);
      this.emit({ kind: 'output', decoder: this, data: { data } });
    }, 50);
  }

  async flush(): Promise<void> { this._queueSize = 0; }

  reset(): void {
    this.config = null;
    this._state = 'unconfigured';
    this._queueSize = 0;
    this.configApplied = false;
  }
}

class VideoEncoderImpl extends CodecBase<VideoEncoderEvent, VideoEncoderEventHandler> implements IVideoEncoder {
  private config: VideoEncoderConfig | null = null;

  get encodeQueueSize(): number { return this._queueSize; }

  configure(config: VideoEncoderConfig): void {
    if (!isCodecSupported(config.codec)) {
      this.emit({ kind: 'error', encoder: this, data: { message: `Unsupported codec: ${config.codec}` } });
      return;
    }
    this.config = config;
    this._state = 'configured';
    this.configApplied = true;
  }

  encode(_frame: VideoFrame): void {
    if (this._state !== 'configured') return;
    this._queueSize++;
    setTimeout(() => {
      this._queueSize = Math.max(0, this._queueSize - 1);
      const data = new ArrayBuffer(1024);
      const chunk = new EncodedVideoChunkImpl('key', _frame.timestamp, _frame.duration, data);
      this.emit({ kind: 'output', encoder: this, data: { chunk } });
    }, 50);
  }

  async flush(): Promise<void> { this._queueSize = 0; }

  reset(): void {
    this.config = null;
    this._state = 'unconfigured';
    this._queueSize = 0;
    this.configApplied = false;
  }
}

class AudioEncoderImpl extends CodecBase<AudioEncoderEvent, AudioEncoderEventHandler> implements IAudioEncoder {
  private config: AudioEncoderConfig | null = null;

  get encodeQueueSize(): number { return this._queueSize; }

  configure(config: AudioEncoderConfig): void {
    if (!isCodecSupported(config.codec)) {
      this.emit({ kind: 'error', encoder: this, data: { message: `Unsupported codec: ${config.codec}` } });
      return;
    }
    this.config = config;
    this._state = 'configured';
    this.configApplied = true;
  }

  encode(_frame: AudioData): void {
    if (this._state !== 'configured') return;
    this._queueSize++;
    setTimeout(() => {
      this._queueSize = Math.max(0, this._queueSize - 1);
      const data = new ArrayBuffer(256);
      const chunk = new EncodedAudioChunkImpl('key', _frame.timestamp, _frame.duration, data);
      this.emit({ kind: 'output', encoder: this, data: { chunk } });
    }, 50);
  }

  async flush(): Promise<void> { this._queueSize = 0; }

  reset(): void {
    this.config = null;
    this._state = 'unconfigured';
    this._queueSize = 0;
    this.configApplied = false;
  }
}

function isConfigSupported(config: VideoDecoderConfig | AudioDecoderConfig | VideoEncoderConfig | AudioEncoderConfig): boolean {
  return isCodecSupported((config as any).codec);
}

export {
  VideoDecoderImpl, AudioDecoderImpl, VideoEncoderImpl, AudioEncoderImpl,
  EncodedVideoChunkImpl, EncodedAudioChunkImpl, VideoFrameImpl, AudioDataImpl,
  isCodecSupported, isConfigSupported,
};
export type {
  IVideoDecoder, IAudioDecoder, IVideoEncoder, IAudioEncoder,
  CodecState, VideoDecoderConfig, AudioDecoderConfig, VideoEncoderConfig, AudioEncoderConfig,
  EncodedVideoChunk, EncodedAudioChunk, EncodedChunkType,
  VideoFrame, VideoPixelFormat, VideoFrameCopyLayout,
  AudioData, AudioSampleFormat, AudioDataCopyToOptions,
  EncodedVideoChunkMetadata, EncodedAudioChunkMetadata, VideoFrameOutputMetadata,
  VideoDecoderEvent, VideoDecoderEventKind, VideoDecoderEventHandler,
  AudioDecoderEvent, AudioDecoderEventKind, AudioDecoderEventHandler,
  VideoEncoderEvent, VideoEncoderEventKind, VideoEncoderEventHandler,
  AudioEncoderEvent, AudioEncoderEventKind, AudioEncoderEventHandler,
};
