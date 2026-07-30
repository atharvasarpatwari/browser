import type { IDisposable } from '../../app/dependency-container';
import { parseCspHeader, combineCspPolicies } from '../security/csp-parser';
import type { CspPolicy, CspDirective } from '../security/csp-parser';

interface ICspService extends IDisposable {
  setPolicy(source: string, directive: string): void;
  removePolicy(source: string): void;
  getPolicy(source: string): CspPolicy | undefined;
  getAllPolicies(): CspPolicy[];
  evaluateDirective(directive: CspDirective, value: string): boolean;
  reportViolation(directive: string, blockedUri: string, documentUri: string, violatedDirective: string, originalPolicy: string): void;
  getViolationCount(): number;
  parsePolicy(directive: string): ReturnType<typeof parseCspHeader>;
  combinePolicies(policies: string[]): ReturnType<typeof combineCspPolicies>;
  onEvent(handler: CspEventHandler): () => void;
}

type CspEventKind = 'violation' | 'policy-set' | 'policy-removed' | 'block';
type CspEventHandler = (event: CspEvent) => void;

interface CspEvent {
  readonly kind: CspEventKind;
  readonly data?: Record<string, unknown>;
}

interface CspViolationRecord {
  readonly directive: string;
  readonly blockedUri: string;
  readonly documentUri: string;
  readonly violatedDirective: string;
  readonly originalPolicy: string;
  readonly timestamp: number;
}

class CspService implements ICspService {
  private _policies = new Map<string, CspPolicy>();
  private _violations: CspViolationRecord[] = [];
  private _handlers = new Set<CspEventHandler>();

  setPolicy(source: string, directive: string): void {
    const parsed = parseCspHeader(directive);
    this._policies.set(source, parsed);
    this.emit({ kind: 'policy-set', data: { source, directive } });
  }

  removePolicy(source: string): void {
    this._policies.delete(source);
    this.emit({ kind: 'policy-removed', data: { source } });
  }

  getPolicy(source: string): CspPolicy | undefined {
    return this._policies.get(source);
  }

  getAllPolicies(): CspPolicy[] {
    return [...this._policies.values()];
  }

  evaluateDirective(directive: CspDirective, value: string): boolean {
    if (directive === 'default-src' || directive === 'script-src' || directive === 'style-src') {
      return !value.includes("'none'");
    }
    return true;
  }

  reportViolation(directive: string, blockedUri: string, documentUri: string, violatedDirective: string, originalPolicy: string): void {
    this._violations.push({ directive, blockedUri, documentUri, violatedDirective, originalPolicy, timestamp: Date.now() });
    this.emit({ kind: 'violation', data: { directive, blockedUri } });
  }

  getViolationCount(): number {
    return this._violations.length;
  }

  parsePolicy(directive: string): ReturnType<typeof parseCspHeader> {
    return parseCspHeader(directive);
  }

  combinePolicies(policies: string[]): ReturnType<typeof combineCspPolicies> {
    return combineCspPolicies(policies);
  }

  onEvent(handler: CspEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: CspEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._policies.clear();
    this._violations = [];
  }
}

export { CspService };
export type { ICspService, CspEvent, CspEventKind, CspEventHandler };
