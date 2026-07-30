import type { IDisposable } from '../../app/dependency-container';

interface IVideoElement extends IDisposable {
  load(url: string): boolean;
  play(): boolean;
  pause(): boolean;
  stop(): void;
  seek(time: number): boolean;
  setVolume(vol: number): void;
  setMuted(muted: boolean): void;
  setPlaybackRate(rate: number): void;
  get duration(): number;
  get currentTime(): number;
  get volume(): number;
  get muted(): boolean;
  get playbackRate(): number;
  get paused(): boolean;
  get ended(): boolean;
  get src(): string;
  get videoWidth(): number;
  get videoHeight(): number;
  get readyState(): VideoReadyState;
  get networkState(): VideoNetworkState;
  get error(): VideoError | null;
  get textTracks(): VideoTextTrack[];
  get audioTracks(): VideoAudioTrack[];
  get videoTracks(): VideoVideoTrack[];
  get qualities(): string[];
  get currentQuality(): string;
  setQuality(quality: string): boolean;
  setFullscreen(fs: boolean): void;
  onEvent(handler: VideoEventHandler): () => void;
}

type VideoReadyState = 'none' | 'metadata' | 'current' | 'enough';
type VideoNetworkState = 'empty' | 'idle' | 'loading' | 'loaded';
type VideoErrorKind = 'network' | 'decode' | 'source' | 'unknown';
interface VideoError {
  readonly kind: VideoErrorKind;
  readonly message: string;
  readonly code: number;
}

interface VideoTextTrack {
  readonly id: string;
  readonly label: string;
  readonly language: string;
  readonly kind: 'subtitles' | 'captions' | 'descriptions' | 'chapters' | 'metadata';
  readonly mode: 'disabled' | 'hidden' | 'showing';
}

interface VideoAudioTrack {
  readonly id: string;
  readonly label: string;
  readonly language: string;
  readonly enabled: boolean;
}

interface VideoVideoTrack {
  readonly id: string;
  readonly label: string;
  readonly selected: boolean;
}

type VideoEventKind = 'load' | 'play' | 'pause' | 'ended' | 'seek' | 'volume' | 'mute' | 'rate' | 'error' | 'timeupdate' | 'waiting' | 'canplay' | 'quality' | 'fullscreen' | 'resize';
interface VideoEvent {
  readonly kind: VideoEventKind;
  readonly data?: Record<string, unknown>;
}

type VideoEventHandler = (event: VideoEvent) => void;

const KNOWN_QUALITIES = ['2160p', '1440p', '1080p', '720p', '480p', '360p'];

class VideoElement implements IVideoElement {
  private _src = '';
  private _volume = 1;
  private _muted = false;
  private _playbackRate = 1;
  private _paused = true;
  private _ended = false;
  private _currentTime = 0;
  private _duration = 0;
  private _videoWidth = 0;
  private _videoHeight = 0;
  private _readyState: VideoReadyState = 'none';
  private _networkState: VideoNetworkState = 'empty';
  private _error: VideoError | null = null;
  private _textTracks: VideoTextTrack[] = [];
  private _audioTracks: VideoAudioTrack[] = [];
  private _videoTracks: VideoVideoTrack[] = [];
  private _qualities: string[] = KNOWN_QUALITIES;
  private _currentQuality = '720p';
  private _fullscreen = false;
  private handlers = new Set<VideoEventHandler>();
  private timeInterval: ReturnType<typeof setInterval> | null = null;

  get duration(): number { return this._duration; }
  get currentTime(): number { return this._currentTime; }
  get volume(): number { return this._volume; }
  get muted(): boolean { return this._muted; }
  get playbackRate(): number { return this._playbackRate; }
  get paused(): boolean { return this._paused; }
  get ended(): boolean { return this._ended; }
  get src(): string { return this._src; }
  get videoWidth(): number { return this._videoWidth; }
  get videoHeight(): number { return this._videoHeight; }
  get readyState(): VideoReadyState { return this._readyState; }
  get networkState(): VideoNetworkState { return this._networkState; }
  get error(): VideoError | null { return this._error; }
  get textTracks(): VideoTextTrack[] { return [...this._textTracks]; }
  get audioTracks(): VideoAudioTrack[] { return [...this._audioTracks]; }
  get videoTracks(): VideoVideoTrack[] { return [...this._videoTracks]; }
  get qualities(): string[] { return [...this._qualities]; }
  get currentQuality(): string { return this._currentQuality; }

  load(url: string): boolean {
    if (!url) return false;
    this.stop();
    this._src = url;
    this._networkState = 'loading';
    this._error = null;
    this._ended = false;
    this._videoWidth = 1920;
    this._videoHeight = 1080;
    this._duration = Math.random() * 6000 + 60;
    this._readyState = 'metadata';
    this._textTracks = [
      { id: 'en-sub', label: 'English', language: 'en', kind: 'subtitles', mode: 'disabled' },
      { id: 'es-sub', label: 'Spanish', language: 'es', kind: 'subtitles', mode: 'disabled' },
    ];
    this._audioTracks = [
      { id: 'en-audio', label: 'English', language: 'en', enabled: true },
      { id: 'es-audio', label: 'Spanish', language: 'es', enabled: false },
    ];
    this._videoTracks = [
      { id: 'main-video', label: 'Main', selected: true },
    ];
    this.emit({ kind: 'load', data: { width: this._videoWidth, height: this._videoHeight, duration: this._duration } });
    setTimeout(() => {
      this._readyState = 'enough';
      this._networkState = 'loaded';
      this.emit({ kind: 'canplay' });
    }, 100);
    return true;
  }

  play(): boolean {
    if (!this._src) return false;
    if (!this._paused) return true;
    this._paused = false;
    this._ended = false;
    this.emit({ kind: 'play' });
    this.startTimeUpdates();
    return true;
  }

  pause(): boolean {
    if (this._paused) return false;
    this._paused = true;
    this.stopTimeUpdates();
    this.emit({ kind: 'pause' });
    return true;
  }

  stop(): void {
    this.pause();
    this._currentTime = 0;
    this._ended = false;
  }

  seek(time: number): boolean {
    if (time < 0 || time > this._duration) return false;
    this._currentTime = time;
    this.emit({ kind: 'seek', data: { time } });
    return true;
  }

  setVolume(vol: number): void {
    this._volume = Math.max(0, Math.min(1, vol));
    this.emit({ kind: 'volume', data: { volume: this._volume } });
  }

  setMuted(muted: boolean): void {
    this._muted = muted;
    this.emit({ kind: 'mute', data: { muted: this._muted } });
  }

  setPlaybackRate(rate: number): void {
    this._playbackRate = Math.max(0.0625, Math.min(16, rate));
    this.emit({ kind: 'rate', data: { playbackRate: this._playbackRate } });
  }

  setQuality(quality: string): boolean {
    if (!this._qualities.includes(quality)) return false;
    this._currentQuality = quality;
    this.emit({ kind: 'quality', data: { quality } });
    return true;
  }

  setFullscreen(fs: boolean): void {
    this._fullscreen = fs;
    this.emit({ kind: 'fullscreen', data: { fullscreen: fs } });
  }

  private startTimeUpdates(): void {
    this.stopTimeUpdates();
    this.timeInterval = setInterval(() => {
      if (this._paused) return;
      this._currentTime += 0.25 * this._playbackRate;
      this.emit({ kind: 'timeupdate', data: { currentTime: this._currentTime } });
      if (this._currentTime >= this._duration) {
        this._paused = true;
        this._ended = true;
        this.stopTimeUpdates();
        this.emit({ kind: 'ended' });
      }
    }, 250);
  }

  private stopTimeUpdates(): void {
    if (this.timeInterval !== null) {
      clearInterval(this.timeInterval);
      this.timeInterval = null;
    }
  }

  onEvent(handler: VideoEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: VideoEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { /* swallow */ }
    }
  }

  dispose(): void {
    this.stopTimeUpdates();
    this.handlers.clear();
    this._src = '';
    this._paused = true;
    this._currentTime = 0;
    this._duration = 0;
    this._textTracks = [];
    this._audioTracks = [];
    this._videoTracks = [];
  }
}

export { VideoElement, KNOWN_QUALITIES };
export type { IVideoElement, VideoReadyState, VideoNetworkState, VideoError, VideoErrorKind, VideoTextTrack, VideoAudioTrack, VideoVideoTrack, VideoEvent, VideoEventKind, VideoEventHandler };
