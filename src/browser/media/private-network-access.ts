import type { IDisposable } from '../../app/dependency-container';

interface IPrivateNetworkAccessService extends IDisposable {
  classifyIp(ip: string): PnaAddressSpace;
  classifyHost(host: string, resolvedIp: string): PnaAddressSpace;
  checkRequest(sourceIp: string, targetIp: string, isSecure?: boolean): PnaDecision;
  checkHostRequest(sourceHost: string, targetHost: string, targetResolvedIp: string, isSecure?: boolean): PnaDecision;
  setMode(mode: PnaMode): void;
  getMode(): PnaMode;
  addAllowedTarget(host: string): void;
  removeAllowedTarget(host: string): void;
  isAllowedTarget(host: string): boolean;
  getBlockedCount(): number;
  onEvent(handler: PnaEventHandler): () => void;
}

type PnaAddressSpace = 'public' | 'private' | 'local' | 'reserved';
type PnaMode = 'disabled' | 'warn' | 'block' | 'block-unless-secure';
type PnaDecision = 'allowed' | 'blocked' | 'warn';
type PnaEventKind = 'checked' | 'blocked' | 'warned' | 'target-allowed' | 'target-removed';
type PnaEventHandler = (event: PnaEvent) => void;

interface PnaEvent {
  readonly kind: PnaEventKind;
  readonly data?: Record<string, unknown>;
}

const ADDRESS_SPACE_ORDER: Record<PnaAddressSpace, number> = {
  public: 0,
  private: 1,
  local: 2,
  reserved: 3,
};

class PrivateNetworkAccessService implements IPrivateNetworkAccessService {
  private _mode: PnaMode = 'block-unless-secure';
  private _allowedTargets = new Set<string>();
  private _blockedCount = 0;
  private _handlers = new Set<PnaEventHandler>();

  classifyIp(ip: string): PnaAddressSpace {
    const trimmed = ip.trim().toLowerCase();
    if (!trimmed) return 'reserved';
    if (trimmed.indexOf(':') >= 0) return this.classifyIpv6(trimmed);
    return this.classifyIpv4(trimmed);
  }

  classifyHost(host: string, resolvedIp: string): PnaAddressSpace {
    const clean = host.replace(/^\[|\]$/g, '').toLowerCase();
    if (clean === 'localhost') return 'local';
    return this.classifyIp(resolvedIp || clean);
  }

  checkRequest(sourceIp: string, targetIp: string, isSecure = true): PnaDecision {
    if (this._mode === 'disabled') {
      this.emit({ kind: 'checked', data: { sourceIp, targetIp, decision: 'allowed', reason: 'disabled' } });
      return 'allowed';
    }

    const sourceClass = this.classifyIp(sourceIp);
    const targetClass = this.classifyIp(targetIp);

    if (this._allowedTargets.has(targetIp.toLowerCase())) {
      this.emit({ kind: 'checked', data: { sourceIp, targetIp, decision: 'allowed', reason: 'allowlist' } });
      return 'allowed';
    }

    if (targetClass === 'reserved') {
      this.emit({ kind: 'warned', data: { sourceIp, targetIp, decision: 'warn', reason: 'reserved-target' } });
      if (this._mode === 'warn') return 'warn';
      this._blockedCount++;
      this.emit({ kind: 'blocked', data: { sourceIp, targetIp, reason: 'reserved-target' } });
      return 'blocked';
    }

    const targetMoreLocal = ADDRESS_SPACE_ORDER[targetClass] > ADDRESS_SPACE_ORDER[sourceClass];
    if (!targetMoreLocal) {
      this.emit({ kind: 'checked', data: { sourceIp, targetIp, decision: 'allowed' } });
      return 'allowed';
    }

    if (this._mode === 'warn') {
      this.emit({ kind: 'warned', data: { sourceIp, targetIp, decision: 'warn' } });
      return 'warn';
    }

    const granted = this._allowedTargets.has(targetIp.toLowerCase());
    const allowed = this._mode === 'block-unless-secure' && isSecure && granted;
    if (allowed) {
      this.emit({ kind: 'checked', data: { sourceIp, targetIp, decision: 'allowed', reason: 'secure-context' } });
      return 'allowed';
    }

    this._blockedCount++;
    this.emit({ kind: 'blocked', data: { sourceIp, targetIp, sourceClass, targetClass, reason: 'private-network-access' } });
    return 'blocked';
  }

  checkHostRequest(sourceHost: string, targetHost: string, targetResolvedIp: string, isSecure = true): PnaDecision {
    const sourceIp = this.hostToProbe(sourceHost);
    const targetIp = targetResolvedIp || this.hostToProbe(targetHost);
    return this.checkRequest(sourceIp, targetIp, isSecure);
  }

  setMode(mode: PnaMode): void {
    this._mode = mode;
  }

  getMode(): PnaMode {
    return this._mode;
  }

  addAllowedTarget(host: string): void {
    const lower = host.toLowerCase();
    this._allowedTargets.add(lower);
    this.emit({ kind: 'target-allowed', data: { host: lower } });
  }

  removeAllowedTarget(host: string): void {
    const lower = host.toLowerCase();
    this._allowedTargets.delete(lower);
    this.emit({ kind: 'target-removed', data: { host: lower } });
  }

  isAllowedTarget(host: string): boolean {
    return this._allowedTargets.has(host.toLowerCase());
  }

  getBlockedCount(): number {
    return this._blockedCount;
  }

  onEvent(handler: PnaEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: PnaEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._allowedTargets.clear();
    this._blockedCount = 0;
  }

  private hostToProbe(host: string): string {
    const clean = host.replace(/^\[|\]$/g, '').toLowerCase();
    if (clean === 'localhost') return '127.0.0.1';
    return clean;
  }

  private classifyIpv4(ip: string): PnaAddressSpace {
    const parts = ip.split('.');
    if (parts.length !== 4) return 'reserved';
    const octets: number[] = [];
    for (const p of parts) {
      if (!/^\d{1,3}$/.test(p)) return 'reserved';
      const n = Number(p);
      if (n > 255) return 'reserved';
      octets.push(n);
    }
    const [a, b] = octets;
    if (a === 0 || a >= 224) return 'reserved';
    if (a === 127) return 'local';
    if (a === 10) return 'private';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 100 && b >= 64 && b <= 127) return 'private';
    if (a === 169 && b === 254) return 'local';
    return 'public';
  }

  private classifyIpv6(ip: string): PnaAddressSpace {
    const expanded = this.expandIpv6(ip);
    if (!expanded) return 'reserved';
    const first = expanded[0];
    const second = expanded[1];
    if (first === 0 && second === 0) {
      if (expanded[7] === 1) return 'local';
      return 'reserved';
    }
    if ((first & 0xfe00) === 0xfc00) return 'private';
    if ((first & 0xffc0) === 0xfe80) return 'local';
    if ((first & 0xff00) === 0xff00) return 'reserved';
    return 'public';
  }

  private expandIpv6(ip: string): number[] | null {
    let address = ip.trim().toLowerCase();
    const zoneIndex = address.indexOf('%');
    if (zoneIndex >= 0) address = address.slice(0, zoneIndex);

    const ipv4Match = address.match(/(.*:)(\d+\.\d+\.\d+\.\d+)$/);
    let groups: string[];
    if (ipv4Match) {
      const v4 = ipv4Match[2].split('.').map(Number);
      const v4Group = ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16);
      groups = (ipv4Match[1] + v4Group).split(':');
    } else {
      groups = address.split(':');
    }

    const emptyIndex = groups.indexOf('');
    if (emptyIndex >= 0) {
      if (groups[0] === '') groups.shift();
      if (groups[groups.length - 1] === '') groups.pop();
      const marker = groups.indexOf('');
      if (marker < 0) return null;
      const missing = 8 - (groups.length - 1);
      if (missing < 1) return null;
      groups.splice(marker, 1, ...new Array(missing).fill('0'));
    }

    if (groups.length !== 8) return null;

    const out: number[] = [];
    for (const g of groups) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  }
}

export { PrivateNetworkAccessService };
export type { IPrivateNetworkAccessService, PnaAddressSpace, PnaMode, PnaDecision, PnaEvent, PnaEventKind, PnaEventHandler };
