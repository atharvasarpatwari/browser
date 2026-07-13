/**
 * @file src/browser/netwroking/connection-pool.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Manage a pool of reusable network connections with keep-alive semantics,
 * per-host limits, idle timeout, connection health checks, and HTTP/2
 * multiplexing awareness. Reduces TCP/TLS handshake overhead for sites
 * that open multiple connections to the same origin.
 *
 * Pipeline position
 * ─────────────────
 *   RequestManager.send()
 *        │
 *        ▼
 *   ConnectionPool.acquire(hostname, port)
 *        │
 *        ├──▶ idle connection? → reuse (HTTP/1.1 keep-alive or H2 session)
 *        ├──▶ at limit?        → wait or evict oldest
 *        └──▶ no pool?         → create new connection
 *
 *   RequestManager completes request
 *        │
 *        ▼
 *   ConnectionPool.release(id)
 *        │
 *        └──▶ mark idle → available for reuse
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IConnectionPool hides pooling behind acquire/release.
 *  Encapsulation    Connection state machines are private.
 *  Single-Resp.     This file manages connection pooling — nothing else.
 *  Open / Closed    New connection types implement IPooledConnection.
 *  Dependency-Inv.  Callers depend on IConnectionPool, not the concrete.
 */

import type { IDisposable } from '../../app/dependency-container';

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/** Connection lifecycle states. */
enum ConnectionState {
  Idle       = 'idle',
  Active     = 'active',
  Draining   = 'draining',
  Closed     = 'closed',
  Failed     = 'failed',
}

/** HTTP protocol version for the connection. */
enum ConnectionProtocol {
  Http1_0 = 'HTTP/1.0',
  Http1_1 = 'HTTP/1.1',
  Http2   = 'HTTP/2',
  Http3   = 'HTTP/3',
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/** A pooled network connection. */
interface IPooledConnection {
  readonly id: string;
  readonly hostname: string;
  readonly port: number;
  readonly protocol: ConnectionProtocol;
  readonly state: ConnectionState;
  readonly createdAt: number;
  readonly lastUsedAt: number;
  readonly requestCount: number;
  /** Whether this connection supports multiplexing (H2/H3). */
  readonly multiplexing: boolean;
  /** Maximum concurrent streams (1 for H1, >1 for H2/H3). */
  readonly maxStreams: number;
  /** Number of currently active streams on this connection. */
  readonly activeStreams: number;
  /** Whether the connection uses TLS. */
  readonly secure: boolean;
}

/** Request to acquire a connection from the pool. */
interface ConnectionAcquireRequest {
  readonly hostname: string;
  readonly port: number;
  readonly secure: boolean;
  readonly preferredProtocol?: ConnectionProtocol;
  /** Whether the caller needs multiplexing. */
  readonly needsMultiplexing: boolean;
}

/** Result of acquiring a connection. */
interface ConnectionAcquireResult {
  readonly connection: IPooledConnection;
  /** Whether this is a reused connection (vs newly created). */
  readonly reused: boolean;
  /** Time in ms to acquire the connection. */
  readonly acquireTimeMs: number;
}

/** Pool configuration. */
interface ConnectionPoolConfig {
  /** Maximum total connections across all hosts. */
  readonly maxConnections: number;
  /** Maximum connections per host. */
  readonly maxPerHost: number;
  /** Idle timeout in ms before a connection is evicted. */
  readonly idleTimeoutMs: number;
  /** Maximum lifetime in ms regardless of usage. */
  readonly maxLifetimeMs: number;
  /** Interval in ms to run health checks on idle connections. */
  readonly healthCheckIntervalMs: number;
  /** Whether to enable keep-alive for HTTP/1.1 connections. */
  readonly enableKeepAlive: boolean;
  /** Keep-alive timeout in ms for HTTP/1.1 connections. */
  readonly keepAliveTimeoutMs: number;
  /** Maximum concurrent streams for HTTP/2 connections. */
  readonly http2MaxStreams: number;
}

/** Pool statistics. */
interface ConnectionPoolStats {
  readonly totalConnections: number;
  readonly idleConnections: number;
  readonly activeConnections: number;
  readonly connectionsPerHost: ReadonlyMap<string, number>;
  readonly totalAcquisitions: number;
  readonly totalReuses: number;
  readonly totalEvictions: number;
  readonly totalCreated: number;
  readonly totalClosed: number;
  readonly averageAcquireTimeMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IConnectionPool extends IDisposable {
  /** Acquire a connection for a request. Returns existing or creates new. */
  acquire(request: ConnectionAcquireRequest): Promise<ConnectionAcquireResult>;
  /** Release a connection back to the pool. */
  release(connectionId: string): void;
  /** Mark a connection as failed (won't be reused). */
  markFailed(connectionId: string, error?: Error): void;
  /** Close a specific connection immediately. */
  close(connectionId: string): boolean;
  /** Close all idle connections. */
  closeIdle(): number;
  /** Close all connections. */
  closeAll(): void;
  /** Get a connection by ID. */
  getConnection(id: string): IPooledConnection | null;
  /** Get all connections for a host. */
  getConnectionsForHost(hostname: string): readonly IPooledConnection[];
  /** Get pool stats. */
  getStats(): ConnectionPoolStats;
  /** Get pool config. */
  getConfig(): ConnectionPoolConfig;
  /** Update pool config. */
  updateConfig(config: Partial<ConnectionPoolConfig>): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_POOL_CONFIG: ConnectionPoolConfig = {
  maxConnections:        256,
  maxPerHost:            6,
  idleTimeoutMs:         90_000,      // 90 seconds
  maxLifetimeMs:         300_000,     // 5 minutes
  healthCheckIntervalMs: 30_000,      // 30 seconds
  enableKeepAlive:       true,
  keepAliveTimeoutMs:    60_000,      // 60 seconds
  http2MaxStreams:        100,
};

// ─────────────────────────────────────────────────────────────────────────────
// POOLED CONNECTION
// ─────────────────────────────────────────────────────────────────────────────

class PooledConnection implements IPooledConnection {
  private _state: ConnectionState;
  private _lastUsedAt: number;
  private _requestCount: number;
  private _activeStreams: number;
  private readonly _createdAt: number;

  constructor(
    readonly id: string,
    readonly hostname: string,
    readonly port: number,
    readonly protocol: ConnectionProtocol,
    readonly secure: boolean,
    readonly multiplexing: boolean,
    readonly maxStreams: number,
  ) {
    this._state = ConnectionState.Idle;
    this._lastUsedAt = Date.now();
    this._requestCount = 0;
    this._activeStreams = 0;
    this._createdAt = Date.now();
  }

  get state(): ConnectionState { return this._state; }
  get createdAt(): number { return this._createdAt; }
  get lastUsedAt(): number { return this._lastUsedAt; }
  get requestCount(): number { return this._requestCount; }
  get activeStreams(): number { return this._activeStreams; }

  activate(): void {
    this._state = ConnectionState.Active;
    this._lastUsedAt = Date.now();
    this._requestCount++;
    this._activeStreams++;
  }

  deactivate(): void {
    this._activeStreams = Math.max(0, this._activeStreams - 1);
    this._lastUsedAt = Date.now();
    if (this._activeStreams === 0) {
      this._state = ConnectionState.Idle;
    }
  }

  drain(): void {
    this._state = ConnectionState.Draining;
  }

  close(): void {
    this._state = ConnectionState.Closed;
    this._activeStreams = 0;
  }

  fail(): void {
    this._state = ConnectionState.Failed;
    this._activeStreams = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CONNECTION POOL
// ─────────────────────────────────────────────────────────────────────────────

class ConnectionPool implements IConnectionPool {
  private readonly connections = new Map<string, PooledConnection>();
  private readonly hostIndex = new Map<string, Set<string>>();
  private config: ConnectionPoolConfig;
  private totalAcquisitions = 0;
  private totalReuses = 0;
  private totalEvictions = 0;
  private totalCreated = 0;
  private totalClosed = 0;
  private acquireTimeSum = 0;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config?: Partial<ConnectionPoolConfig>) {
    this.config = { ...DEFAULT_POOL_CONFIG, ...config };
  }

  // ── IConnectionPool: acquire ───────────────────────────────────────

  async acquire(request: ConnectionAcquireRequest): Promise<ConnectionAcquireResult> {
    const startTime = Date.now();
    this.totalAcquisitions++;

    // 1. Try to find an idle connection for this host.
    const hostKey = `${request.hostname}:${request.port}`;
    const candidateIds = this.hostIndex.get(hostKey);

    if (candidateIds) {
      for (const id of candidateIds) {
        const conn = this.connections.get(id);
        if (!conn) continue;

        if (conn.state === ConnectionState.Idle) {
          // Check if it supports what we need.
          if (request.needsMultiplexing && !conn.multiplexing) continue;

          // Check lifetime.
          if (this.isExpired(conn)) {
            this.evict(conn);
            continue;
          }

          conn.activate();
          this.totalReuses++;

          return {
            connection: conn,
            reused: true,
            acquireTimeMs: Date.now() - startTime,
          };
        }
      }
    }

    // 2. Check connection limits.
    if (this.connections.size >= this.config.maxConnections) {
      this.evictOldest();
    }

    const hostConns = this.hostIndex.get(hostKey)?.size ?? 0;
    if (hostConns >= this.config.maxPerHost) {
      this.evictOldestForHost(hostKey);
    }

    // 3. Create a new connection.
    const protocol = request.needsMultiplexing
      ? ConnectionProtocol.Http2
      : ConnectionProtocol.Http1_1;

    const conn = new PooledConnection(
      this.generateId(),
      request.hostname,
      request.port,
      protocol,
      request.secure,
      request.needsMultiplexing,
      request.needsMultiplexing ? this.config.http2MaxStreams : 1,
    );

    conn.activate();
    this.registerConnection(conn);
    this.totalCreated++;

    return {
      connection: conn,
      reused: false,
      acquireTimeMs: Date.now() - startTime,
    };
  }

  // ── IConnectionPool: release ───────────────────────────────────────

  release(connectionId: string): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    conn.deactivate();

    // If the pool is full, close instead of keeping idle.
    if (this.connections.size > this.config.maxConnections) {
      this.closeConnection(conn);
    }
  }

  // ── IConnectionPool: markFailed / close ────────────────────────────

  markFailed(connectionId: string, _error?: Error): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;
    conn.fail();
    this.closeConnection(conn);
  }

  close(connectionId: string): boolean {
    const conn = this.connections.get(connectionId);
    if (!conn) return false;
    this.closeConnection(conn);
    return true;
  }

  closeIdle(): number {
    let closed = 0;
    for (const conn of [...this.connections.values()]) {
      if (conn.state === ConnectionState.Idle) {
        this.closeConnection(conn);
        closed++;
      }
    }
    return closed;
  }

  closeAll(): void {
    for (const conn of this.connections.values()) {
      conn.close();
    }
    this.connections.clear();
    this.hostIndex.clear();
  }

  // ── IConnectionPool: inspection ────────────────────────────────────

  getConnection(id: string): IPooledConnection | null {
    return this.connections.get(id) ?? null;
  }

  getConnectionsForHost(hostname: string): readonly IPooledConnection[] {
    const result: IPooledConnection[] = [];
    for (const conn of this.connections.values()) {
      if (conn.hostname === hostname) result.push(conn);
    }
    return result;
  }

  getStats(): ConnectionPoolStats {
    let idle = 0;
    let active = 0;
    const perHost = new Map<string, number>();

    for (const conn of this.connections.values()) {
      if (conn.state === ConnectionState.Idle) idle++;
      if (conn.state === ConnectionState.Active) active++;

      const host = conn.hostname;
      perHost.set(host, (perHost.get(host) ?? 0) + 1);
    }

    return {
      totalConnections: this.connections.size,
      idleConnections: idle,
      activeConnections: active,
      connectionsPerHost: perHost,
      totalAcquisitions: this.totalAcquisitions,
      totalReuses: this.totalReuses,
      totalEvictions: this.totalEvictions,
      totalCreated: this.totalCreated,
      totalClosed: this.totalClosed,
      averageAcquireTimeMs: this.totalAcquisitions > 0
        ? Math.round(this.acquireTimeSum / this.totalAcquisitions)
        : 0,
    };
  }

  getConfig(): ConnectionPoolConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<ConnectionPoolConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ── IDisposable ─────────────────────────────────────────────────────

  dispose(): void {
    this.closeAll();
    if (this.healthCheckTimer !== null) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────

  private registerConnection(conn: PooledConnection): void {
    this.connections.set(conn.id, conn);
    const hostKey = `${conn.hostname}:${conn.port}`;
    if (!this.hostIndex.has(hostKey)) {
      this.hostIndex.set(hostKey, new Set());
    }
    this.hostIndex.get(hostKey)!.add(conn.id);
  }

  private unregisterConnection(conn: PooledConnection): void {
    this.connections.delete(conn.id);
    const hostKey = `${conn.hostname}:${conn.port}`;
    const ids = this.hostIndex.get(hostKey);
    if (ids) {
      ids.delete(conn.id);
      if (ids.size === 0) this.hostIndex.delete(hostKey);
    }
  }

  private closeConnection(conn: PooledConnection): void {
    conn.close();
    this.unregisterConnection(conn);
    this.totalClosed++;
  }

  private evict(conn: PooledConnection): void {
    conn.drain();
    if (conn.activeStreams === 0) {
      this.closeConnection(conn);
      this.totalEvictions++;
    }
  }

  private evictOldest(): void {
    // First try to evict idle connections.
    let oldest: PooledConnection | null = null;
    for (const conn of this.connections.values()) {
      if (conn.state === ConnectionState.Idle) {
        if (!oldest || conn.lastUsedAt < oldest.lastUsedAt) {
          oldest = conn;
        }
      }
    }
    if (oldest) {
      this.evict(oldest);
      return;
    }

    // No idle connections — evict the oldest active as a last resort.
    let oldestActive: PooledConnection | null = null;
    for (const conn of this.connections.values()) {
      if (conn.state === ConnectionState.Active) {
        if (!oldestActive || conn.lastUsedAt < oldestActive.lastUsedAt) {
          oldestActive = conn;
        }
      }
    }
    if (oldestActive) {
      this.closeConnection(oldestActive);
      this.totalEvictions++;
    }
  }

  private evictOldestForHost(hostKey: string): void {
    const ids = this.hostIndex.get(hostKey);
    if (!ids) return;

    let oldest: PooledConnection | null = null;
    for (const id of ids) {
      const conn = this.connections.get(id);
      if (conn && conn.state === ConnectionState.Idle) {
        if (!oldest || conn.lastUsedAt < oldest.lastUsedAt) {
          oldest = conn;
        }
      }
    }
    if (oldest) this.evict(oldest);
  }

  private isExpired(conn: PooledConnection): boolean {
    const now = Date.now();
    if (now - conn.createdAt > this.config.maxLifetimeMs) return true;
    if (conn.state === ConnectionState.Idle &&
        now - conn.lastUsedAt > this.config.idleTimeoutMs) return true;
    return false;
  }

  private generateId(): string {
    return `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  ConnectionPool,
  ConnectionState,
  ConnectionProtocol,
  DEFAULT_POOL_CONFIG,
};

export type {
  IConnectionPool,
  IPooledConnection,
  ConnectionAcquireRequest,
  ConnectionAcquireResult,
  ConnectionPoolConfig,
  ConnectionPoolStats,
};
