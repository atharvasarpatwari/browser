import type { IDisposable } from '../../app/dependency-container';

type SWState = 'installing' | 'installed' | 'activating' | 'activated' | 'redundant';

interface IServiceWorkerContainer extends IDisposable {
  readonly ready: Promise<ServiceWorkerRegistration>;
  readonly controller: ServiceWorker | null;
  register(scriptURL: string, options?: RegistrationOptions): Promise<ServiceWorkerRegistration>;
  getRegistration(clientURL?: string): Promise<ServiceWorkerRegistration | undefined>;
  getRegistrations(): Promise<ServiceWorkerRegistration[]>;
  onEvent(handler: SWEventHandler): () => void;
}

interface RegistrationOptions {
  scope?: string;
  type?: 'classic' | 'module';
  updateViaCache?: 'imports' | 'all' | 'none';
}

interface ServiceWorkerRegistration {
  readonly scope: string;
  readonly active: ServiceWorker | null;
  readonly installing: ServiceWorker | null;
  readonly waiting: ServiceWorker | null;
  readonly updateViaCache: string;
  update(): Promise<void>;
  unregister(): Promise<boolean>;
}

interface ServiceWorker {
  readonly scriptURL: string;
  state: SWState;
  postMessage(message: unknown): void;
}

interface SWEvent {
  readonly kind: SWEventKind;
  readonly data?: Record<string, unknown>;
}

type SWEventKind = 'register' | 'update' | 'unregister' | 'controllerchange' | 'error' | 'statechange' | 'message';
type SWEventHandler = (event: SWEvent) => void;

let _swId = 1;

class ServiceWorkerContainer implements IServiceWorkerContainer {
  private _registrations: ServiceWorkerRegistration[] = [];
  private _handlers = new Set<SWEventHandler>();
  private _readyResolve: ((reg: ServiceWorkerRegistration) => void) | null = null;
  readonly ready: Promise<ServiceWorkerRegistration>;
  private _controller: ServiceWorker | null = null;

  constructor() {
    this.ready = new Promise<ServiceWorkerRegistration>((resolve) => {
      this._readyResolve = resolve;
    });
  }

  get controller(): ServiceWorker | null { return this._controller; }

  async register(scriptURL: string, options?: RegistrationOptions): Promise<ServiceWorkerRegistration> {
    const scope = options?.scope ?? '/';
    const existing = this._registrations.find(r => r.scope === scope);
    if (existing) return existing;

    const self = this;

    const sw: ServiceWorker = {
      scriptURL,
      state: 'installing',
      postMessage(message: unknown) {
        self.emit({ kind: 'message', data: { message } });
      },
    };

    const reg: ServiceWorkerRegistration = {
      scope,
      active: null,
      installing: sw,
      waiting: null,
      updateViaCache: options?.updateViaCache ?? 'imports',
      async update() { },
      async unregister(): Promise<boolean> {
        const idx = self._registrations.indexOf(reg);
        if (idx >= 0) self._registrations.splice(idx, 1);
        self.emit({ kind: 'unregister', data: { scope } });
        return true;
      },
    };

    this._registrations.push(reg);

    setTimeout(() => {
      sw.state = 'installed';
      this.emit({ kind: 'statechange', data: { scriptURL, state: 'installed' } });
    }, 50);

    setTimeout(() => {
      sw.state = 'activating';
      this.emit({ kind: 'statechange', data: { scriptURL, state: 'activating' } });
    }, 100);

    setTimeout(() => {
      sw.state = 'activated';
      (reg as any).active = sw;
      this._controller = sw;
      this.emit({ kind: 'statechange', data: { scriptURL, state: 'activated' } });
      this.emit({ kind: 'controllerchange', data: { scriptURL } });
      if (this._readyResolve) {
        this._readyResolve(reg);
        this._readyResolve = null;
      }
    }, 150);

    this.emit({ kind: 'register', data: { scriptURL, scope } });
    return reg;
  }

  async getRegistration(clientURL?: string): Promise<ServiceWorkerRegistration | undefined> {
    const url = clientURL ?? '/';
    return this._registrations.find(r => url.startsWith(r.scope));
  }

  async getRegistrations(): Promise<ServiceWorkerRegistration[]> {
    return [...this._registrations];
  }

  onEvent(handler: SWEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: SWEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._registrations = [];
    this._controller = null;
    this._handlers.clear();
  }
}

export { ServiceWorkerContainer };
export type { IServiceWorkerContainer, ServiceWorkerRegistration, ServiceWorker, SWState, RegistrationOptions, SWEvent, SWEventKind, SWEventHandler };
