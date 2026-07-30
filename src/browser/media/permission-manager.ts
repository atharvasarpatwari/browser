import type { IDisposable } from '../../app/dependency-container';

interface IPermissionManagerService extends IDisposable {
  queryPermission(origin: string, permission: ManagerPermissionName): Promise<ManagerPermissionState>;
  requestPermission(origin: string, permission: ManagerPermissionName): Promise<ManagerPermissionState>;
  revokePermission(origin: string, permission: ManagerPermissionName): Promise<void>;
  setPermission(origin: string, permission: ManagerPermissionName, state: ManagerPermissionState): void;
  getAllPermissions(origin: string): ManagerPermissionEntry[];
  resetAll(origin: string): void;
  revokeAll(origin: string): void;
  setUserGestureRequired(required: boolean): void;
  onEvent(handler: ManagerPermissionEventHandler): () => void;
}

type ManagerPermissionName =
  | 'camera' | 'microphone' | 'notifications' | 'geolocation'
  | 'persistent-storage' | 'midi' | 'sensors' | 'clipboard-read'
  | 'clipboard-write' | 'payment-handler' | 'push'
  | 'disk-filesystem' | 'screen-capture';

type ManagerPermissionState = 'prompt' | 'granted' | 'denied';
type ManagerPermissionEventKind = 'change' | 'grant' | 'deny' | 'expired' | 'reset';
type ManagerPermissionEventHandler = (event: ManagerPermissionEvent) => void;

interface ManagerPermissionEntry {
  readonly permission: ManagerPermissionName;
  readonly state: ManagerPermissionState;
  readonly origin: string;
  readonly lastModified: number;
  readonly expiresAt: number;
}

interface ManagerPermissionEvent {
  readonly kind: ManagerPermissionEventKind;
  readonly data?: Record<string, unknown>;
}

const PERMISSION_LIST: readonly ManagerPermissionName[] = [
  'camera', 'microphone', 'notifications', 'geolocation',
  'persistent-storage', 'midi', 'sensors', 'clipboard-read',
  'clipboard-write', 'payment-handler', 'push',
  'disk-filesystem', 'screen-capture',
];

class PermissionManagerService implements IPermissionManagerService {
  private _store = new Map<string, Map<ManagerPermissionName, { state: ManagerPermissionState; lastModified: number; expiresAt: number }>>();
  private _userGestureRequired = false;
  private _handlers = new Set<ManagerPermissionEventHandler>();

  async queryPermission(origin: string, permission: ManagerPermissionName): Promise<ManagerPermissionState> {
    const originStore = this._store.get(origin);
    if (!originStore) return 'prompt';
    const entry = originStore.get(permission);
    if (!entry) return 'prompt';
    if (entry.expiresAt > 0 && Date.now() >= entry.expiresAt) {
      originStore.delete(permission);
      this.emit({ kind: 'expired', data: { origin, permission } });
      return 'prompt';
    }
    return entry.state;
  }

  async requestPermission(origin: string, permission: ManagerPermissionName): Promise<ManagerPermissionState> {
    const current = await this.queryPermission(origin, permission);
    if (current !== 'prompt') return current;

    const granted = permission === 'notifications' || permission === 'clipboard-read' || permission === 'clipboard-write';
    const newState: ManagerPermissionState = granted ? 'granted' : 'prompt';
    this.setPermission(origin, permission, newState);
    this.emit({ kind: newState === 'granted' ? 'grant' : 'deny', data: { origin, permission } });
    return newState;
  }

  async revokePermission(origin: string, permission: ManagerPermissionName): Promise<void> {
    const originStore = this._store.get(origin);
    if (originStore) {
      originStore.delete(permission);
    }
    this.emit({ kind: 'change', data: { origin, permission, state: 'prompt' } });
  }

  setPermission(origin: string, permission: ManagerPermissionName, state: ManagerPermissionState): void {
    if (!this._store.has(origin)) {
      this._store.set(origin, new Map());
    }
    this._store.get(origin)!.set(permission, {
      state,
      lastModified: Date.now(),
      expiresAt: 0,
    });
    this.emit({ kind: 'change', data: { origin, permission, state } });
  }

  getAllPermissions(origin: string): ManagerPermissionEntry[] {
    const originStore = this._store.get(origin);
    if (!originStore) return [];
    const result: ManagerPermissionEntry[] = [];
    for (const [permission, entry] of originStore) {
      result.push({ permission, state: entry.state, origin, lastModified: entry.lastModified, expiresAt: entry.expiresAt });
    }
    return result;
  }

  resetAll(origin: string): void {
    this._store.delete(origin);
    this.emit({ kind: 'reset', data: { origin } });
  }

  revokeAll(origin: string): void {
    const originStore = this._store.get(origin);
    if (originStore) {
      for (const permission of originStore.keys()) {
        originStore.set(permission, { state: 'denied', lastModified: Date.now(), expiresAt: 0 });
      }
    }
    this.emit({ kind: 'change', data: { origin, action: 'revoke-all' } });
  }

  setUserGestureRequired(required: boolean): void {
    this._userGestureRequired = required;
  }

  onEvent(handler: ManagerPermissionEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: ManagerPermissionEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._store.clear();
  }
}

export { PermissionManagerService, PERMISSION_LIST };
export type { IPermissionManagerService, ManagerPermissionName, ManagerPermissionState, ManagerPermissionEntry, ManagerPermissionEvent, ManagerPermissionEventKind, ManagerPermissionEventHandler };
