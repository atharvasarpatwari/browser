import type { IDisposable } from '../../app/dependency-container';

type GeolocationPermission = 'granted' | 'denied' | 'prompt';

interface IGeolocationService extends IDisposable {
  getCurrentPosition(options?: PositionOptions): Promise<GeolocationPosition>;
  watchPosition(options?: PositionOptions): { id: number; cancel: () => void };
  clearWatch(id: number): void;
  onEvent(handler: GeolocationEventHandler): () => void;
}

interface PositionOptions {
  enableHighAccuracy?: boolean;
  timeout?: number;
  maximumAge?: number;
}

interface GeolocationPosition {
  readonly coords: GeolocationCoordinates;
  readonly timestamp: number;
}

interface GeolocationCoordinates {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracy: number;
  readonly altitude: number | null;
  readonly altitudeAccuracy: number | null;
  readonly heading: number | null;
  readonly speed: number | null;
}

interface GeolocationEvent {
  readonly kind: GeolocationEventKind;
  readonly data?: Record<string, unknown>;
}

type GeolocationEventKind = 'position' | 'error' | 'watch';
type GeolocationEventHandler = (event: GeolocationEvent) => void;

class GeolocationService implements IGeolocationService {
  private _permission: GeolocationPermission = 'prompt';
  private _handlers = new Set<GeolocationEventHandler>();
  private _watchCounter = 0;
  private _watchers = new Map<number, ReturnType<typeof setInterval>>();

  setPermission(p: GeolocationPermission): void {
    this._permission = p;
  }

  private mockPosition(): GeolocationPosition {
    return {
      coords: {
        latitude: 37.7749 + (Math.random() - 0.5) * 0.01,
        longitude: -122.4194 + (Math.random() - 0.5) * 0.01,
        accuracy: 10 + Math.random() * 20,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    };
  }

  async getCurrentPosition(options?: PositionOptions): Promise<GeolocationPosition> {
    if (this._permission === 'denied') {
      throw new Error('Geolocation permission denied');
    }
    this._permission = 'granted';

    const timeout = options?.timeout ?? Infinity;
    const result = await new Promise<GeolocationPosition>((resolve, reject) => {
      const timer = timeout < Infinity ? setTimeout(() => reject(new Error('Position timeout')), timeout) : undefined;
      setTimeout(() => {
        clearTimeout(timer);
        resolve(this.mockPosition());
      }, 10);
    });

    this.emit({ kind: 'position', data: { latitude: result.coords.latitude, longitude: result.coords.longitude } });
    return result;
  }

  watchPosition(options?: PositionOptions): { id: number; cancel: () => void } {
    const id = ++this._watchCounter;
    const interval = setInterval(() => {
      const pos = this.mockPosition();
      this.emit({ kind: 'position', data: { latitude: pos.coords.latitude, longitude: pos.coords.longitude } });
    }, options?.timeout ?? 5000);

    this._watchers.set(id, interval);
    this.emit({ kind: 'watch', data: { id } });

    return {
      id,
      cancel: () => this.clearWatch(id),
    };
  }

  clearWatch(id: number): void {
    const interval = this._watchers.get(id);
    if (interval) {
      clearInterval(interval);
      this._watchers.delete(id);
    }
  }

  onEvent(handler: GeolocationEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: GeolocationEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    for (const interval of this._watchers.values()) {
      clearInterval(interval);
    }
    this._watchers.clear();
    this._handlers.clear();
  }
}

export { GeolocationService };
export type { IGeolocationService, GeolocationPermission, PositionOptions, GeolocationPosition, GeolocationCoordinates, GeolocationEvent, GeolocationEventKind, GeolocationEventHandler };
