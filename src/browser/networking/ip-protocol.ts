/**
 * @file src/browser/networking/ip-protocol.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Low-level IP protocol handling for NovaBrowser's networking layer:
 *
 *   - Parse, validate, and serialize IPv4 / IPv6 addresses (incl. IPv6
 *     zone IDs, CIDR notation, embedded IPv4-mapped tails)
 *   - Classify addresses and evaluate CIDR membership
 *   - Resolve hostnames to IP addresses (DNS abstraction) with TTL-aware
 *     caching, negative caching, timeouts, and retry/backoff
 *   - Enforce a real Private Network Access (PNA) style security policy
 *   - Establish connections using a Happy Eyeballs (RFC 8305) dual-stack
 *     strategy, with per-attempt timeouts, retries, DNS-rebinding
 *     revalidation, and a small connection pool
 *
 * Complements dns-resolver.ts (which handles hostname→string-address mapping
 * at a higher layer). This module provides structured ParsedIP types,
 * classification, CIDR logic, and connection establishment.
 *
 * Zero external dependencies. Compiles clean under strict TypeScript.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 *  Abstraction      IDnsResolver hides resolution strategy; DNSResolver
 *                   implementations are swappable (system, mock, DoH).
 *  Encapsulation    Cache internals, retry state, and pool internals are
 *                   private; callers interact through public contracts.
 *  Single-Resp.     Each class/function handles one concern (parsing,
 *                   caching, connection, pooling).
 *  Open / Closed    New DNS resolvers or connection strategies implement
 *                   the existing interfaces without modifying this file.
 *  Liskov Sub.      All DNSResolver implementations are interchangeable.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { IDisposable } from '../../app/dependency-container';

// =========================================================================
// 1. Types
// =========================================================================

export type IPVersion = 4 | 6;

export interface ParsedIPv4 {
  version: 4;
  octets: [number, number, number, number];
  raw: string;
}

export interface ParsedIPv6 {
  version: 6;
  groups: number[];
  zoneId?: string;
  raw: string;
}

export type ParsedIP = ParsedIPv4 | ParsedIPv6;

export type IPClassification =
  | 'loopback'
  | 'private'
  | 'link-local'
  | 'multicast'
  | 'unspecified'
  | 'broadcast'
  | 'public';

export interface CIDRRange {
  base: ParsedIP;
  prefixLength: number;
}

export interface DNSRecord {
  hostname: string;
  address: ParsedIP;
  ttlSeconds: number;
  resolvedAt: number;
}

export interface ConnectionTarget {
  hostname: string;
  port: number;
  protocol: 'http' | 'https' | 'ws' | 'wss';
}

export type SocketState = 'connecting' | 'open' | 'closed' | 'error';

export interface SocketConnection {
  target: ConnectionTarget;
  resolvedAddress: ParsedIP;
  state: SocketState;
  localPort?: number;
  openedAt?: number;
}

// ── Error taxonomy ─────────────────────────────────────────────────────────

export class IPProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IPProtocolError';
  }
}

export class DNSResolutionError extends IPProtocolError {
  constructor(public readonly hostname: string, message: string) {
    super(message);
    this.name = 'DNSResolutionError';
  }
}

export class DNSTimeoutError extends DNSResolutionError {
  constructor(hostname: string, timeoutMs: number) {
    super(hostname, `DNS resolution for "${hostname}" timed out after ${timeoutMs}ms`);
    this.name = 'DNSTimeoutError';
  }
}

export class PrivateNetworkAccessError extends IPProtocolError {
  constructor(public readonly hostname: string, public readonly address: string) {
    super(
      `Blocked by Private Network Access policy: "${hostname}" resolved to ` +
        `${address}, a private/local address not permitted for this request context`,
    );
    this.name = 'PrivateNetworkAccessError';
  }
}

export class ConnectionEstablishmentError extends IPProtocolError {
  constructor(
    public readonly target: ConnectionTarget,
    public readonly attempts: number,
    cause: unknown,
  ) {
    super(
      `Failed to connect to ${target.hostname}:${target.port} after ${attempts} attempt(s). ` +
        `Last error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'ConnectionEstablishmentError';
  }
}

// =========================================================================
// 2. IPv4 parsing & validation
// =========================================================================

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function parseIPv4(input: string): ParsedIPv4 | null {
  const trimmed = input.trim();
  const match = IPV4_PATTERN.exec(trimmed);
  if (!match) return null;

  const octets: number[] = [];
  for (let i = 1; i <= 4; i++) {
    const part = match[i]!;
    if (part.length > 1 && part.startsWith('0')) return null;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return null;
    octets.push(value);
  }

  return {
    version: 4,
    octets: octets as [number, number, number, number],
    raw: trimmed,
  };
}

export function isValidIPv4(input: string): boolean {
  return parseIPv4(input) !== null;
}

// =========================================================================
// 3. IPv6 parsing & validation (with zone IDs)
// =========================================================================

export function parseIPv6(input: string): ParsedIPv6 | null {
  const originalRaw = input.trim();
  let raw = originalRaw;

  if (raw.startsWith('[') && raw.endsWith(']')) {
    raw = raw.slice(1, -1);
  }

  let zoneId: string | undefined;
  const percentIdx = raw.indexOf('%');
  if (percentIdx !== -1) {
    zoneId = raw.slice(percentIdx + 1);
    if (zoneId.length === 0) return null;
    raw = raw.slice(0, percentIdx);
  }

  let ipv4Tail: ParsedIPv4 | null = null;
  const lastColon = raw.lastIndexOf(':');
  if (lastColon !== -1) {
    const tail = raw.slice(lastColon + 1);
    if (tail.includes('.')) {
      ipv4Tail = parseIPv4(tail);
      if (!ipv4Tail) return null;
      raw = raw.slice(0, lastColon + 1) + '0:0';
    }
  }

  const doubleColonCount = (raw.match(/::/g) || []).length;
  if (doubleColonCount > 1) return null;

  let groups: string[];
  if (raw.includes('::')) {
    const [left = '', right = ''] = raw.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missing = 8 - (leftGroups.length + rightGroups.length);
    if (missing < 0) return null;
    groups = [...leftGroups, ...Array(missing).fill('0'), ...rightGroups];
  } else {
    groups = raw.split(':');
  }

  if (groups.length !== 8) return null;

  const parsedGroups: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
    parsedGroups.push(parseInt(g, 16));
  }

  if (ipv4Tail) {
    const [a, b, c, d] = ipv4Tail.octets;
    parsedGroups[6] = (a << 8) | b;
    parsedGroups[7] = (c << 8) | d;
  }

  const result: ParsedIPv6 = { version: 6, groups: parsedGroups, raw: originalRaw };
  if (zoneId !== undefined) result.zoneId = zoneId;
  return result;
}

export function isValidIPv6(input: string): boolean {
  return parseIPv6(input) !== null;
}

// =========================================================================
// 4. Unified parse + serialize
// =========================================================================

export function parseIP(input: string): ParsedIP | null {
  return parseIPv4(input) ?? parseIPv6(input);
}

export function isValidIP(input: string): boolean {
  return parseIP(input) !== null;
}

export function serializeIP(ip: ParsedIP): string {
  if (ip.version === 4) {
    return ip.octets.join('.');
  }
  const base = compressIPv6Groups(ip.groups);
  return ip.zoneId ? `${base}%${ip.zoneId}` : base;
}

export function serializeIPForURL(ip: ParsedIP): string {
  return ip.version === 4 ? serializeIP(ip) : `[${serializeIP(ip)}]`;
}

function compressIPv6Groups(groups: number[]): string {
  const hex = groups.map((g) => g.toString(16));

  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;

  for (let i = 0; i < hex.length; i++) {
    if (hex[i] === '0') {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }

  if (bestLen < 2) return hex.join(':');

  const before = hex.slice(0, bestStart).join(':');
  const after = hex.slice(bestStart + bestLen).join(':');
  return `${before}::${after}`;
}

// =========================================================================
// 5. Comparison, equality, and numeric conversion
// =========================================================================

export function ipToBigInt(ip: ParsedIP): bigint {
  if (ip.version === 4) {
    return ip.octets.reduce((acc, o) => (acc << 8n) | BigInt(o), 0n);
  }
  return ip.groups.reduce((acc, g) => (acc << 16n) | BigInt(g), 0n);
}

export function ipEquals(a: ParsedIP, b: ParsedIP): boolean {
  if (a.version !== b.version) return false;
  return ipToBigInt(a) === ipToBigInt(b);
}

export function sortIPs(ips: ParsedIP[]): ParsedIP[] {
  return [...ips].sort((a, b) => {
    if (a.version !== b.version) return a.version - b.version;
    const av = ipToBigInt(a);
    const bv = ipToBigInt(b);
    return av < bv ? -1 : av > bv ? 1 : 0;
  });
}

// =========================================================================
// 6. CIDR parsing & membership testing
// =========================================================================

export function parseCIDR(input: string): CIDRRange | null {
  const trimmed = input.trim();
  const slashIdx = trimmed.lastIndexOf('/');
  if (slashIdx === -1) return null;

  const addrPart = trimmed.slice(0, slashIdx);
  const prefixPart = trimmed.slice(slashIdx + 1);

  const base = parseIP(addrPart);
  if (!base) return null;

  const prefixLength = Number(prefixPart);
  const maxPrefix = base.version === 4 ? 32 : 128;
  if (!Number.isInteger(prefixLength) || prefixLength < 0 || prefixLength > maxPrefix) return null;

  return { base, prefixLength };
}

export function isInCIDR(ip: ParsedIP, range: CIDRRange): boolean {
  if (ip.version !== range.base.version) return false;

  const bits = ip.version === 4 ? 32 : 128;
  const ipVal = ipToBigInt(ip);
  const baseVal = ipToBigInt(range.base);

  if (range.prefixLength === 0) return true;
  const shift = BigInt(bits - range.prefixLength);
  return ipVal >> shift === baseVal >> shift;
}

export function isInAnyCIDR(ip: ParsedIP, cidrs: string[]): boolean {
  for (const c of cidrs) {
    const range = parseCIDR(c);
    if (range && isInCIDR(ip, range)) return true;
  }
  return false;
}

// =========================================================================
// 7. Address classification
// =========================================================================

export function classifyIP(ip: ParsedIP): IPClassification {
  return ip.version === 4 ? classifyIPv4(ip) : classifyIPv6(ip);
}

function classifyIPv4(ip: ParsedIPv4): IPClassification {
  const [a, b, c, d] = ip.octets;

  if (a === 127) return 'loopback';
  if (a === 0 && b === 0 && c === 0 && d === 0) return 'unspecified';
  if (a === 255 && b === 255 && c === 255 && d === 255) return 'broadcast';
  if (a === 10) return 'private';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'private';
  if (a === 169 && b === 254) return 'link-local';
  if (a >= 224 && a <= 239) return 'multicast';
  return 'public';
}

function classifyIPv6(ip: ParsedIPv6): IPClassification {
  const g = ip.groups;

  const isAllZero = (upTo: number) => g.slice(0, upTo).every((v) => v === 0);

  if (isAllZero(7) && g[7] === 1) return 'loopback';
  if (isAllZero(8)) return 'unspecified';
  if ((g[0]! & 0xffc0) === 0xfe80) return 'link-local';
  if ((g[0]! & 0xfe00) === 0xfc00) return 'private';
  if ((g[0]! & 0xff00) === 0xff00) return 'multicast';

  if (isAllZero(4) && g[4] === 0 && g[5] === 0xffff) {
    const a = (g[6]! >> 8) & 0xff;
    const b = g[6]! & 0xff;
    const embedded: ParsedIPv4 = {
      version: 4,
      octets: [a, b, (g[7]! >> 8) & 0xff, g[7]! & 0xff],
      raw: '',
    };
    return classifyIPv4(embedded);
  }

  return 'public';
}

export function isPrivateOrLocal(ip: ParsedIP): boolean {
  const cls = classifyIP(ip);
  return cls === 'private' || cls === 'loopback' || cls === 'link-local' || cls === 'unspecified';
}

// =========================================================================
// 8. Security policy — Private Network Access (PNA) enforcement
// =========================================================================

export interface SecurityContext {
  originIsPrivate: boolean;
  allowedPrivateHosts?: string[];
  disablePNA?: boolean;
}

export function enforcePrivateNetworkAccess(
  record: DNSRecord,
  context: SecurityContext,
): void {
  if (context.disablePNA) return;

  const targetIsPrivate = isPrivateOrLocal(record.address);
  if (!targetIsPrivate) return;

  if (context.originIsPrivate) return;

  if (context.allowedPrivateHosts?.includes(record.hostname)) return;

  throw new PrivateNetworkAccessError(record.hostname, serializeIP(record.address));
}

// =========================================================================
// 9. DNS resolution abstraction
// =========================================================================

export interface DNSResolverBackend {
  resolve(hostname: string, preferredVersion?: IPVersion): Promise<DNSRecord[]>;
}

export interface CachingDNSResolverOptions {
  negativeCacheTtlSeconds?: number;
  maxTtlSeconds?: number;
}

export class CachingDNSResolver implements DNSResolverBackend, IDisposable {
  private cache = new Map<string, DNSRecord[]>();
  private negativeCache = new Map<string, number>();
  private readonly negativeCacheTtlSeconds: number;
  private readonly maxTtlSeconds: number;

  constructor(
    private readonly upstream: DNSResolverBackend,
    options: CachingDNSResolverOptions = {},
  ) {
    this.negativeCacheTtlSeconds = options.negativeCacheTtlSeconds ?? 30;
    this.maxTtlSeconds = options.maxTtlSeconds ?? 3600;
  }

  async resolve(hostname: string, preferredVersion?: IPVersion): Promise<DNSRecord[]> {
    const negExpiry = this.negativeCache.get(hostname);
    if (negExpiry !== undefined) {
      if (Date.now() < negExpiry) {
        throw new DNSResolutionError(hostname, `"${hostname}" is in negative DNS cache (recently failed)`);
      }
      this.negativeCache.delete(hostname);
    }

    const cached = this.cache.get(hostname);
    if (cached && cached.every((r) => !this.isExpired(r))) {
      return this.filterByVersion(cached, preferredVersion);
    }

    try {
      const records = await this.upstream.resolve(hostname, preferredVersion);
      if (records.length === 0) {
        this.negativeCache.set(hostname, Date.now() + this.negativeCacheTtlSeconds * 1000);
        return [];
      }
      const capped = records.map((r) => ({
        ...r,
        ttlSeconds: Math.min(r.ttlSeconds, this.maxTtlSeconds),
      }));
      this.cache.set(hostname, capped);
      return this.filterByVersion(capped, preferredVersion);
    } catch (err) {
      this.negativeCache.set(hostname, Date.now() + this.negativeCacheTtlSeconds * 1000);
      throw err;
    }
  }

  invalidate(hostname: string): void {
    this.cache.delete(hostname);
    this.negativeCache.delete(hostname);
  }

  clear(): void {
    this.cache.clear();
    this.negativeCache.clear();
  }

  get size(): number {
    return this.cache.size + this.negativeCache.size;
  }

  dispose(): void {
    this.clear();
  }

  private isExpired(record: DNSRecord): boolean {
    return Date.now() - record.resolvedAt > record.ttlSeconds * 1000;
  }

  private filterByVersion(records: DNSRecord[], version?: IPVersion): DNSRecord[] {
    if (!version) return records;
    const filtered = records.filter((r) => r.address.version === version);
    return filtered.length > 0 ? filtered : records;
  }
}

export class LiteralAwareResolver implements DNSResolverBackend {
  constructor(private readonly upstream: DNSResolverBackend) {}

  async resolve(hostname: string, preferredVersion?: IPVersion): Promise<DNSRecord[]> {
    const literal = parseIP(hostname);
    if (literal) {
      return [
        {
          hostname,
          address: literal,
          ttlSeconds: Number.MAX_SAFE_INTEGER,
          resolvedAt: Date.now(),
        },
      ];
    }
    return this.upstream.resolve(hostname, preferredVersion);
  }
}

export class ResilientDNSResolver implements DNSResolverBackend {
  constructor(
    private readonly upstream: DNSResolverBackend,
    private readonly options: { timeoutMs?: number; maxRetries?: number; backoffBaseMs?: number } = {},
  ) {}

  async resolve(hostname: string, preferredVersion?: IPVersion): Promise<DNSRecord[]> {
    const timeoutMs = this.options.timeoutMs ?? 5000;
    const maxRetries = this.options.maxRetries ?? 2;
    const backoffBaseMs = this.options.backoffBaseMs ?? 200;

    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await withTimeout(
          this.upstream.resolve(hostname, preferredVersion),
          timeoutMs,
          () => new DNSTimeoutError(hostname, timeoutMs),
        );
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries) {
          await delay(backoffBaseMs * 2 ** attempt);
        }
      }
    }

    if (lastError instanceof IPProtocolError) throw lastError;
    throw new DNSResolutionError(hostname, `Resolution failed after ${maxRetries + 1} attempts`);
  }
}

// =========================================================================
// 10. Async utilities
// =========================================================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// =========================================================================
// 11. Happy Eyeballs dual-stack ordering + connection establishment
// =========================================================================

export function orderForHappyEyeballs(records: DNSRecord[]): DNSRecord[] {
  const v6 = records.filter((r) => r.address.version === 6);
  const v4 = records.filter((r) => r.address.version === 4);
  const ordered: DNSRecord[] = [];
  const max = Math.max(v6.length, v4.length);
  for (let i = 0; i < max; i++) {
    if (v6[i]) ordered.push(v6[i]!);
    if (v4[i]) ordered.push(v4[i]!);
  }
  return ordered;
}

export interface EstablishConnectionOptions {
  securityContext?: SecurityContext;
  connectTimeoutMs?: number;
  maxAttempts?: number;
  attemptDelayMs?: number;
  onAttempt?: (record: DNSRecord, attemptNumber: number) => void;
}

export async function establishConnection(
  target: ConnectionTarget,
  resolver: DNSResolverBackend,
  openSocket: (address: ParsedIP, port: number) => Promise<SocketConnection>,
  options: EstablishConnectionOptions = {},
): Promise<SocketConnection> {
  const {
    securityContext = { originIsPrivate: false },
    connectTimeoutMs = 10_000,
    maxAttempts = 4,
    attemptDelayMs = 250,
    onAttempt,
  } = options;

  const records = await resolver.resolve(target.hostname);
  if (records.length === 0) {
    throw new DNSResolutionError(target.hostname, `No addresses resolved for "${target.hostname}"`);
  }

  const ordered = orderForHappyEyeballs(records).slice(0, maxAttempts);

  let lastError: unknown;
  let attemptNumber = 0;

  for (const record of ordered) {
    attemptNumber++;
    onAttempt?.(record, attemptNumber);

    enforcePrivateNetworkAccess(record, securityContext);

    try {
      const connection = await withTimeout(
        openSocket(record.address, target.port),
        connectTimeoutMs,
        () => new IPProtocolError(`Connection attempt to ${serializeIP(record.address)}:${target.port} timed out`),
      );
      return { ...connection, target, resolvedAddress: record.address, openedAt: Date.now() };
    } catch (err) {
      lastError = err;
      if (attemptNumber < ordered.length) {
        await delay(attemptDelayMs);
      }
    }
  }

  throw new ConnectionEstablishmentError(target, attemptNumber, lastError);
}

// =========================================================================
// 12. Connection pooling
// =========================================================================

interface PooledEntry {
  connection: SocketConnection;
  lastUsedAt: number;
}

export interface ConnectionPoolOptions {
  maxIdleTimeMs?: number;
  maxPerOrigin?: number;
}

export class ConnectionPool implements IDisposable {
  private pools = new Map<string, PooledEntry[]>();
  private readonly maxIdleTimeMs: number;
  private readonly maxPerOrigin: number;

  constructor(options: ConnectionPoolOptions = {}) {
    this.maxIdleTimeMs = options.maxIdleTimeMs ?? 30_000;
    this.maxPerOrigin = options.maxPerOrigin ?? 6;
  }

  private poolKey(target: ConnectionTarget): string {
    return `${target.protocol}://${target.hostname}:${target.port}`;
  }

  acquire(target: ConnectionTarget): SocketConnection | null {
    const key = this.poolKey(target);
    this.evictStale(key);
    const pool = this.pools.get(key);
    if (!pool || pool.length === 0) return null;

    const entry = pool.pop()!;
    return entry.connection.state === 'open' ? entry.connection : null;
  }

  release(connection: SocketConnection): void {
    if (connection.state !== 'open') return;
    const key = this.poolKey(connection.target);
    const pool = this.pools.get(key) ?? [];
    if (pool.length >= this.maxPerOrigin) return;
    pool.push({ connection, lastUsedAt: Date.now() });
    this.pools.set(key, pool);
  }

  get size(): number {
    let count = 0;
    for (const pool of this.pools.values()) {
      count += pool.length;
    }
    return count;
  }

  private evictStale(key: string): void {
    const pool = this.pools.get(key);
    if (!pool) return;
    const fresh = pool.filter((e) => Date.now() - e.lastUsedAt < this.maxIdleTimeMs);
    this.pools.set(key, fresh);
  }

  clear(): void {
    this.pools.clear();
  }

  dispose(): void {
    this.clear();
  }
}

// =========================================================================
// 13. Convenience namespace export
// =========================================================================

export const IPProtocol = {
  parseIPv4,
  parseIPv6,
  parseIP,
  isValidIPv4,
  isValidIPv6,
  isValidIP,
  serializeIP,
  serializeIPForURL,
  ipToBigInt,
  ipEquals,
  sortIPs,
  parseCIDR,
  isInCIDR,
  isInAnyCIDR,
  classifyIP,
  isPrivateOrLocal,
  enforcePrivateNetworkAccess,
  orderForHappyEyeballs,
  establishConnection,
  ConnectionPool,
  CachingDNSResolver,
  LiteralAwareResolver,
  ResilientDNSResolver,
};

export default IPProtocol;
