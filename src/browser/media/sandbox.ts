import type { IDisposable } from '../../app/dependency-container';
import { SandboxManager } from '../security/sandbox-manager';
import { SandboxEnforcer } from '../security/sandbox-enforcer';

interface ISandboxService extends IDisposable {
  setFlags(origin: string, flags: string[]): void;
  getFlags(origin: string): readonly string[];
  removeOrigin(origin: string): void;
  hasFlag(origin: string, flag: string): boolean;
  enforce(origin: string, action: string): boolean;
  getAllowedOrigins(): string[];
  onEvent(handler: SandboxEventHandler): () => void;
}

type SandboxEventKind = 'flag-set' | 'flag-removed' | 'action-blocked' | 'action-allowed';
type SandboxEventHandler = (event: SandboxEvent) => void;

interface SandboxEvent {
  readonly kind: SandboxEventKind;
  readonly data?: Record<string, unknown>;
}

const SANDBOX_FLAGS = [
  'allow-same-origin',
  'allow-scripts',
  'allow-forms',
  'allow-popups',
  'allow-modals',
  'allow-orientation-lock',
  'allow-pointer-lock',
  'allow-presentation',
  'allow-top-navigation',
  'allow-top-navigation-by-user-activation',
  'allow-downloads',
] as const;

class SandboxService implements ISandboxService {
  private _flags = new Map<string, Set<string>>();
  private _enforcer: SandboxEnforcer;
  private _handlers = new Set<SandboxEventHandler>();

  constructor() {
    this._enforcer = new SandboxEnforcer();
  }

  setFlags(origin: string, flags: string[]): void {
    const set = new Set(flags.map(f => f.startsWith('allow-') ? f : `allow-${f}`));
    this._flags.set(origin, set);
    this.emit({ kind: 'flag-set', data: { origin, flags: [...set] } });
  }

  getFlags(origin: string): readonly string[] {
    return [...(this._flags.get(origin) ?? new Set())];
  }

  removeOrigin(origin: string): void {
    this._flags.delete(origin);
    this.emit({ kind: 'flag-removed', data: { origin } });
  }

  hasFlag(origin: string, flag: string): boolean {
    const flags = this._flags.get(origin);
    if (!flags) return false;
    const normalized = flag.startsWith('allow-') ? flag : `allow-${flag}`;
    return flags.has(normalized);
  }

  enforce(origin: string, action: string): boolean {
    const flags = this._flags.get(origin);
    if (!flags) return false;

    if (action === 'script' && !flags.has('allow-scripts')) {
      this.emit({ kind: 'action-blocked', data: { origin, action } });
      return false;
    }
    if (action === 'form' && !flags.has('allow-forms')) {
      this.emit({ kind: 'action-blocked', data: { origin, action } });
      return false;
    }
    if (action === 'popup' && !flags.has('allow-popups')) {
      this.emit({ kind: 'action-blocked', data: { origin, action } });
      return false;
    }

    this.emit({ kind: 'action-allowed', data: { origin, action } });
    return true;
  }

  getAllowedOrigins(): string[] {
    return [...this._flags.keys()];
  }

  onEvent(handler: SandboxEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: SandboxEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._flags.clear();
    this._enforcer.dispose();
  }
}

export { SandboxService, SANDBOX_FLAGS };
export type { ISandboxService, SandboxEvent, SandboxEventKind, SandboxEventHandler };
