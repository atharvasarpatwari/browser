import type { IDisposable } from '../../app/dependency-container';

interface IAudioElement extends IDisposable {
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
  get readyState(): AudioReadyState;
  get networkState(): AudioNetworkState;
  get error(): AudioError | null;
  onEvent(handler: AudioEventHandler): () => void;
}

type AudioReadyState = 'none' | 'metadata' | 'current' | 'enough';
type AudioNetworkState = 'empty' | 'idle' | 'loading' | 'loaded';
type AudioErrorKind = 'network' | 'decode' | 'source' | 'unknown';
interface AudioError {
  readonly kind: AudioErrorKind;
  readonly message: string;
  readonly code: number;
}

type AudioEventKind = 'load' | 'play' | 'pause' | 'ended' | 'seek' | 'volume' | 'mute' | 'rate' | 'error' | 'timeupdate' | 'waiting' | 'canplay';
interface AudioEvent {
  readonly kind: AudioEventKind;
  readonly data?: Record<string, unknown>;
}

type AudioEventHandler = (event: AudioEvent) => void;

class AudioElement implements IAudioElement {
  private _src = '';
  private _volume = 1;
  private _muted = false;
  private _playbackRate = 1;
  private _paused = true;
  private _ended = false;
  private _currentTime = 0;
  private _duration = 0;
  private _readyState: AudioReadyState = 'none';
  private _networkState: AudioNetworkState = 'empty';
  private _error: AudioError | null = null;
  private handlers = new Set<AudioEventHandler>();
  private timeInterval: ReturnType<typeof setInterval> | null = null;

  get duration(): number { return this._duration; }
  get currentTime(): number { return this._currentTime; }
  get volume(): number { return this._volume; }
  get muted(): boolean { return this._muted; }
  get playbackRate(): number { return this._playbackRate; }
  get paused(): boolean { return this._paused; }
  get ended(): boolean { return this._ended; }
  get src(): string { return this._src; }
  get readyState(): AudioReadyState { return this._readyState; }
  get networkState(): AudioNetworkState { return this._networkState; }
  get error(): AudioError | null { return this._error; }

  load(url: string): boolean {
    if (!url) return false;
    this.stop();
    this._src = url;
    this._networkState = 'loading';
    this._error = null;
    this._ended = false;
    this._duration = Math.random() * 300 + 10;
    this._readyState = 'metadata';
    this.emit({ kind: 'load' });
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

  onEvent(handler: AudioEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  private emit(event: AudioEvent): void {
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
  }
}

export { AudioElement };
export type { IAudioElement, AudioReadyState, AudioNetworkState, AudioError, AudioErrorKind, AudioEvent, AudioEventKind, AudioEventHandler };
