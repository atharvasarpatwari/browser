import type { IDisposable } from '../../app/dependency-container';

interface IDnsRebindingProtectionService extends IDisposable {
  classifyIp(ip: string): IpClass;
  isPrivateOrLocalIp(ip: string): boolean;
  isIpLiteral(host: string): boolean;
  checkResolvedHost(host: string, ip: string): DnsRebindingDecision;
  setMode(mode: DnsRebindingMode): void;
  getMode(): DnsRebindingMode;
  addAllowedHost(host: string): void;
  removeAllowedHost(host: string): void;
  isAllowedHost(host: string): boolean;
  getAllowedHosts(): readonly string[];
  getBlockedCount(): number;
  onEvent(handler: DnsRebindingEventHandler): () => void;
}

type IpClass = 'public' | 'private' | 'loopback' | 'link-local' | 'reserved';
type DnsRebindingMode = 'block' | 'warn' | 'disabled';
type DnsRebindingDecision = 'allowed' | 'blocked' | 'warn';
type DnsRebindingEventKind = 'host-checked' | 'blocked' | 'warned' | 'host-allowed' | 'host-removed';
type DnsRebindingEventHandler = (event: DnsRebindingEvent) => void;

interface DnsRebindingEvent {
  readonly kind: DnsRebindingEventKind;
  readonly data?: Record<string, unknown>;
}

class DnsRebindingProtectionService implements IDnsRebindingProtectionService {
  private _mode: DnsRebindingMode = 'block';
  private _allowedHosts = new Set<string>();
  private _blockedCount = 0;
  private _handlers = new Set<DnsRebindingEventHandler>();

  classifyIp(ip: string): IpClass {
    const trimmed = ip.trim().toLowerCase();
    if (!trimmed) return 'reserved';
    if (trimmed.indexOf(':') >= 0) return this.classifyIpv6(trimmed);
    return this.classifyIpv4(trimmed);
  }

  isPrivateOrLocalIp(ip: string): boolean {
    const cls = this.classifyIp(ip);
    return cls === 'private' || cls === 'loopback' || cls === 'link-local' || cls === 'reserved';
  }

  isIpLiteral(host: string): boolean {
    const clean = host.replace(/^\[|\]$/g, '');
    return this.classifyIp(clean) !== 'reserved' || /^\d+\.\d+\.\d+\.\d+$/.test(clean);
  }

  checkResolvedHost(host: string, ip: string): DnsRebindingDecision {
    const lowerHost = host.toLowerCase();

    if (this._mode === 'disabled') {
      this.emit({ kind: 'host-checked', data: { host, ip, decision: 'allowed' } });
      return 'allowed';
    }

    const cls = this.classifyIp(ip);
    if (cls === 'public') {
      this.emit({ kind: 'host-checked', data: { host, ip, decision: 'allowed' } });
      return 'allowed';
    }

    if (this._allowedHosts.has(lowerHost) || this.isIpLiteral(lowerHost)) {
      this.emit({ kind: 'host-checked', data: { host, ip, decision: 'allowed' } });
      return 'allowed';
    }

    if (this._mode === 'block') {
      this._blockedCount++;
      this.emit({ kind: 'blocked', data: { host, ip, ipClass: cls, reason: 'dns-rebinding' } });
      return 'blocked';
    }

    this.emit({ kind: 'warned', data: { host, ip, ipClass: cls } });
    return 'warn';
  }

  setMode(mode: DnsRebindingMode): void {
    this._mode = mode;
  }

  getMode(): DnsRebindingMode {
    return this._mode;
  }

  addAllowedHost(host: string): void {
    const lower = host.toLowerCase();
    this._allowedHosts.add(lower);
    this.emit({ kind: 'host-allowed', data: { host: lower } });
  }

  removeAllowedHost(host: string): void {
    const lower = host.toLowerCase();
    this._allowedHosts.delete(lower);
    this.emit({ kind: 'host-removed', data: { host: lower } });
  }

  isAllowedHost(host: string): boolean {
    return this._allowedHosts.has(host.toLowerCase());
  }

  getAllowedHosts(): readonly string[] {
    return [...this._allowedHosts];
  }

  getBlockedCount(): number {
    return this._blockedCount;
  }

  onEvent(handler: DnsRebindingEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: DnsRebindingEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this._handlers.clear();
    this._allowedHosts.clear();
    this._blockedCount = 0;
  }

  private classifyIpv4(ip: string): IpClass {
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
    if (a === 0) return 'reserved';
    if (a === 10) return 'private';
    if (a === 127) return 'loopback';
    if (a === 169 && b === 254) return 'link-local';
    if (a === 172 && b >= 16 && b <= 31) return 'private';
    if (a === 192 && b === 168) return 'private';
    if (a === 100 && b >= 64 && b <= 127) return 'private';
    if (a >= 224) return 'reserved';
    return 'public';
  }

  private classifyIpv6(ip: string): IpClass {
    const expanded = this.expandIpv6(ip);
    if (!expanded) return 'reserved';
    const first = expanded[0];
    const second = expanded[1];
    const allZero = expanded.every((g) => g === 0);
    if (allZero) return 'reserved';
    if (first === 0 && second === 0) {
      if (expanded[7] === 1) return 'loopback';
      return 'reserved';
    }
    if ((first & 0xfe00) === 0xfc00) return 'private';
    if ((first & 0xffc0) === 0xfe80) return 'link-local';
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

export { DnsRebindingProtectionService };
export type { IDnsRebindingProtectionService, IpClass, DnsRebindingMode, DnsRebindingDecision, DnsRebindingEvent, DnsRebindingEventKind, DnsRebindingEventHandler };
