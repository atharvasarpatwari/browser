import type { IDisposable } from '../../app/dependency-container';

type PermissionName =
  | 'notifications'
  | 'geolocation'
  | 'microphone'
  | 'camera'
  | 'clipboard-read'
  | 'clipboard-write'
  | 'midi'
  | 'midi-sysex'
  | 'payment'
  | 'screen-capture'
  | 'window-placement'
  | 'local-fonts'
  | 'idle-detection';

type PermissionState = 'granted' | 'denied' | 'prompt' | 'ask';

type PermissionDecision = 'always' | 'once' | 'session';

interface PermissionRequest {
  readonly origin: string;
  readonly name: PermissionName;
  readonly decision: PermissionDecision;
  readonly timestamp: number;
}

interface PermissionDescriptor {
  readonly origin: string;
  readonly name: PermissionName;
  readonly state: PermissionState;
  readonly lastUpdated: number;
}

interface PermissionConfig {
  readonly defaults: Record<PermissionName, PermissionState>;
  readonly allowOnceByDefault: boolean;
  readonly rememberDecisions: boolean;
  readonly maxStoredDecisions: number;
}

const DEFAULT_PERMISSION_CONFIG: PermissionConfig = {
  defaults: {
    'notifications': 'ask',
    'geolocation': 'ask',
    'microphone': 'ask',
    'camera': 'ask',
    'clipboard-read': 'ask',
    'clipboard-write': 'denied',
    'midi': 'prompt',
    'midi-sysex': 'denied',
    'payment': 'ask',
    'screen-capture': 'denied',
    'window-placement': 'denied',
    'local-fonts': 'prompt',
    'idle-detection': 'denied',
  },
  allowOnceByDefault: false,
  rememberDecisions: true,
  maxStoredDecisions: 1000,
};

const ALL_PERMISSION_NAMES: readonly PermissionName[] = [
  'notifications', 'geolocation', 'microphone', 'camera',
  'clipboard-read', 'clipboard-write', 'midi', 'midi-sysex',
  'payment', 'screen-capture', 'window-placement', 'local-fonts', 'idle-detection',
];

interface IPermissionManager extends IDisposable {
  request(origin: string, name: PermissionName): Promise<PermissionState>;
  query(origin: string, name: PermissionName): Promise<PermissionState>;
  setPermission(origin: string, name: PermissionName, state: PermissionState): Promise<void>;
  revoke(origin: string, name: PermissionName): Promise<boolean>;
  revokeAll(origin: string): Promise<number>;
  getPermissionsForOrigin(origin: string): Promise<readonly PermissionDescriptor[]>;
  getAllRequests(): Promise<readonly PermissionRequest[]>;
}

type PermissionStore = Map<string, Map<string, { state: PermissionState; lastUpdated: number }>>;

function originPermissionKey(origin: string, name: string): string {
  return `${origin}|${name}`;
}

class PermissionManager implements IPermissionManager {
  private readonly config: PermissionConfig;
  private readonly store: PermissionStore = new Map();
  private readonly requests: PermissionRequest[] = [];
  private readonly sessionDecisions = new Map<string, PermissionState>();

  constructor(config?: Partial<PermissionConfig>) {
    this.config = { ...DEFAULT_PERMISSION_CONFIG, ...config };
  }

  async request(origin: string, name: PermissionName): Promise<PermissionState> {
    const existing = await this.query(origin, name);
    if (existing !== 'prompt') return existing;

    const sessionKey = originPermissionKey(origin, name);
    const session = this.sessionDecisions.get(sessionKey);
    if (session) return session;

    this.requests.push({ origin, name, decision: 'once', timestamp: Date.now() });
    return 'prompt';
  }

  async query(origin: string, name: PermissionName): Promise<PermissionState> {
    const originStore = this.store.get(origin);
    if (originStore) {
      const entry = originStore.get(name);
      if (entry) return entry.state;
    }
    return this.mapDefault(this.config.defaults[name] ?? 'prompt');
  }

  async setPermission(origin: string, name: PermissionName, state: PermissionState): Promise<void> {
    if (!this.config.rememberDecisions) {
      this.sessionDecisions.set(originPermissionKey(origin, name), state);
      return;
    }

    if (!this.store.has(origin)) {
      this.store.set(origin, new Map());
    }

    const originStore = this.store.get(origin)!;
    originStore.set(name, { state, lastUpdated: Date.now() });

    if (this.countStored() > this.config.maxStoredDecisions) {
      this.evictOldest();
    }
  }

  async revoke(origin: string, name: PermissionName): Promise<boolean> {
    const originStore = this.store.get(origin);
    if (!originStore) return false;
    const result = originStore.delete(name);
    if (originStore.size === 0) this.store.delete(origin);
    return result;
  }

  async revokeAll(origin: string): Promise<number> {
    const originStore = this.store.get(origin);
    if (!originStore) return 0;
    const count = originStore.size;
    this.store.delete(origin);
    return count;
  }

  async getPermissionsForOrigin(origin: string): Promise<readonly PermissionDescriptor[]> {
    const originStore = this.store.get(origin);
    if (!originStore) return [];

    return [...originStore.entries()].map(([name, entry]) => ({
      origin,
      name: name as PermissionName,
      state: entry.state,
      lastUpdated: entry.lastUpdated,
    }));
  }

  async getAllRequests(): Promise<readonly PermissionRequest[]> {
    return [...this.requests];
  }

  private mapDefault(state: PermissionState): PermissionState {
    return state as PermissionState;
  }

  private countStored(): number {
    let count = 0;
    for (const originStore of this.store.values()) {
      count += originStore.size;
    }
    return count;
  }

  private evictOldest(): void {
    let oldestOrigin = '';
    let oldestName = '';
    let oldestTime = Infinity;

    for (const [origin, originStore] of this.store) {
      for (const [name, entry] of originStore) {
        if (entry.lastUpdated < oldestTime) {
          oldestTime = entry.lastUpdated;
          oldestOrigin = origin;
          oldestName = name;
        }
      }
    }

    if (oldestOrigin && oldestName) {
      const originStore = this.store.get(oldestOrigin);
      originStore?.delete(oldestName);
      if (originStore?.size === 0) this.store.delete(oldestOrigin);
    }
  }

  dispose(): void {
    this.store.clear();
    this.requests.length = 0;
    this.sessionDecisions.clear();
  }
}

export { PermissionManager, ALL_PERMISSION_NAMES, DEFAULT_PERMISSION_CONFIG };
export type { IPermissionManager, PermissionName, PermissionState, PermissionRequest, PermissionDescriptor, PermissionDecision, PermissionConfig };
