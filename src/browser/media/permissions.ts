import type { IDisposable } from '../../app/dependency-container';

type PermissionName = 'geolocation' | 'notifications' | 'clipboard-read' | 'clipboard-write' | 'midi' | 'camera' | 'microphone' | 'speaker' | 'device-info' | 'background-sync' | 'bluetooth' | 'persistent-storage' | 'ambient-light-sensor' | 'accelerometer' | 'gyroscope' | 'magnetometer' | 'push';
type PermissionStatus = 'granted' | 'denied' | 'prompt';

interface IPermissionService extends IDisposable {
  query(permission: PermissionName): Promise<PermissionResult>;
  request(permission: PermissionName): Promise<PermissionStatus>;
  revoke(permission: PermissionName): Promise<void>;
  onEvent(handler: PermissionEventHandler): () => void;
}

interface PermissionResult {
  readonly name: PermissionName;
  readonly state: PermissionStatus;
  onchange: (() => void) | null;
}

interface PermissionEvent {
  readonly kind: PermissionEventKind;
  readonly data?: Record<string, unknown>;
}

type PermissionEventKind = 'change' | 'grant' | 'deny';
type PermissionEventHandler = (event: PermissionEvent) => void;

class PermissionService implements IPermissionService {
  private _store = new Map<PermissionName, PermissionStatus>();
  private _handlers = new Set<PermissionEventHandler>();

  constructor() {
    for (const name of ['geolocation', 'notifications', 'clipboard-read', 'clipboard-write', 'midi', 'camera', 'microphone', 'speaker', 'device-info', 'background-sync', 'bluetooth', 'persistent-storage', 'ambient-light-sensor', 'accelerometer', 'gyroscope', 'magnetometer', 'push'] as PermissionName[]) {
      this._store.set(name, 'prompt');
    }
  }

  async query(permission: PermissionName): Promise<PermissionResult> {
    const state = this._store.get(permission) ?? 'prompt';
    const result: PermissionResult = { name: permission, state, onchange: null };
    return result;
  }

  async request(permission: PermissionName): Promise<PermissionStatus> {
    const state = this._store.get(permission) ?? 'prompt';
    if (state !== 'prompt') return state;

    const granted = permission === 'notifications' || permission === 'clipboard-read' || permission === 'clipboard-write';
    const newState: PermissionStatus = granted ? 'granted' : 'prompt';
    this._store.set(permission, newState);
    this.emit({ kind: newState === 'granted' ? 'grant' : 'deny', data: { permission } });
    this.emit({ kind: 'change', data: { permission, state: newState } });
    return newState;
  }

  async revoke(permission: PermissionName): Promise<void> {
    this._store.set(permission, 'prompt');
    this.emit({ kind: 'change', data: { permission, state: 'prompt' } });
  }

  setPermission(permission: PermissionName, state: PermissionStatus): void {
    this._store.set(permission, state);
    this.emit({ kind: 'change', data: { permission, state } });
  }

  onEvent(handler: PermissionEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: PermissionEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._store.clear();
  }
}

export { PermissionService };
export type { IPermissionService, PermissionName, PermissionStatus, PermissionResult, PermissionEvent, PermissionEventKind, PermissionEventHandler };
