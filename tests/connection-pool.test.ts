import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConnectionPool,
  ConnectionState,
  ConnectionProtocol,
} from '../src/browser/networking/connection-pool';

describe('ConnectionPool', () => {
  let pool: ConnectionPool;

  beforeEach(() => {
    pool = new ConnectionPool({
      maxConnections: 10,
      maxPerHost: 3,
      idleTimeoutMs: 60_000,
      maxLifetimeMs: 300_000,
    });
  });

  describe('acquire', () => {
    it('should create a new connection', async () => {
      const result = await pool.acquire({
        hostname: 'example.com',
        port: 443,
        secure: true,
        needsMultiplexing: false,
      });

      expect(result.reused).toBe(false);
      expect(result.connection.hostname).toBe('example.com');
      expect(result.connection.port).toBe(443);
      expect(result.connection.secure).toBe(true);
      expect(result.connection.state).toBe(ConnectionState.Active);
    });

    it('should reuse an idle connection', async () => {
      const r1 = await pool.acquire({
        hostname: 'example.com',
        port: 443,
        secure: true,
        needsMultiplexing: false,
      });
      pool.release(r1.connection.id);

      const r2 = await pool.acquire({
        hostname: 'example.com',
        port: 443,
        secure: true,
        needsMultiplexing: false,
      });

      expect(r2.reused).toBe(true);
      expect(r2.connection.id).toBe(r1.connection.id);
    });

    it('should create multiplexed connection when needed', async () => {
      const result = await pool.acquire({
        hostname: 'example.com',
        port: 443,
        secure: true,
        needsMultiplexing: true,
      });

      expect(result.connection.multiplexing).toBe(true);
      expect(result.connection.protocol).toBe(ConnectionProtocol.Http2);
      expect(result.connection.maxStreams).toBe(100);
    });

    it('should not reuse non-multiplexing connection when multiplexing needed', async () => {
      const r1 = await pool.acquire({
        hostname: 'example.com',
        port: 443,
        secure: true,
        needsMultiplexing: false,
      });
      pool.release(r1.connection.id);

      const r2 = await pool.acquire({
        hostname: 'example.com',
        port: 443,
        secure: true,
        needsMultiplexing: true,
      });

      expect(r2.reused).toBe(false);
    });
  });

  describe('release', () => {
    it('should mark connection as idle after release', async () => {
      const result = await pool.acquire({
        hostname: 'example.com',
        port: 443,
        secure: true,
        needsMultiplexing: false,
      });

      pool.release(result.connection.id);
      const conn = pool.getConnection(result.connection.id);
      expect(conn!.state).toBe(ConnectionState.Idle);
    });
  });

  describe('markFailed', () => {
    it('should close a failed connection', async () => {
      const result = await pool.acquire({
        hostname: 'example.com',
        port: 443,
        secure: true,
        needsMultiplexing: false,
      });

      pool.markFailed(result.connection.id, new Error('timeout'));
      expect(pool.getConnection(result.connection.id)).toBeNull();
    });
  });

  describe('close', () => {
    it('should close a specific connection', async () => {
      const result = await pool.acquire({
        hostname: 'example.com',
        port: 443,
        secure: true,
        needsMultiplexing: false,
      });

      expect(pool.close(result.connection.id)).toBe(true);
      expect(pool.getConnection(result.connection.id)).toBeNull();
    });

    it('should close all idle connections', async () => {
      const r1 = await pool.acquire({ hostname: 'a.com', port: 443, secure: true, needsMultiplexing: false });
      const r2 = await pool.acquire({ hostname: 'b.com', port: 443, secure: true, needsMultiplexing: false });
      pool.release(r1.connection.id);
      pool.release(r2.connection.id);

      const closed = pool.closeIdle();
      expect(closed).toBe(2);
    });

    it('should close all connections', async () => {
      await pool.acquire({ hostname: 'a.com', port: 443, secure: true, needsMultiplexing: false });
      await pool.acquire({ hostname: 'b.com', port: 443, secure: true, needsMultiplexing: false });

      pool.closeAll();
      expect(pool.getStats().totalConnections).toBe(0);
    });
  });

  describe('inspection', () => {
    it('should get connections by host', async () => {
      await pool.acquire({ hostname: 'a.com', port: 443, secure: true, needsMultiplexing: false });
      await pool.acquire({ hostname: 'a.com', port: 80, secure: false, needsMultiplexing: false });
      await pool.acquire({ hostname: 'b.com', port: 443, secure: true, needsMultiplexing: false });

      const aConns = pool.getConnectionsForHost('a.com');
      expect(aConns.length).toBe(2);
    });
  });

  describe('limits', () => {
    it('should enforce per-host limit by evicting idle', async () => {
      const results = [];
      for (let i = 0; i < 4; i++) {
        const r = await pool.acquire({ hostname: 'limit.com', port: 443, secure: true, needsMultiplexing: false });
        pool.release(r.connection.id);
        results.push(r);
      }
      // The pool should have evicted at least one.
      const conns = pool.getConnectionsForHost('limit.com');
      expect(conns.length).toBeLessThanOrEqual(3);
    });

    it('should enforce global limit', async () => {
      const smallPool = new ConnectionPool({ maxConnections: 2, maxPerHost: 2 });
      const r1 = await smallPool.acquire({ hostname: 'a.com', port: 443, secure: true, needsMultiplexing: false });
      const r2 = await smallPool.acquire({ hostname: 'b.com', port: 443, secure: true, needsMultiplexing: false });
      const r3 = await smallPool.acquire({ hostname: 'c.com', port: 443, secure: true, needsMultiplexing: false });

      expect(smallPool.getStats().totalConnections).toBeLessThanOrEqual(2);
      smallPool.dispose();
    });
  });

  describe('stats', () => {
    it('should track acquisition stats', async () => {
      const r1 = await pool.acquire({ hostname: 'a.com', port: 443, secure: true, needsMultiplexing: false });
      pool.release(r1.connection.id);
      await pool.acquire({ hostname: 'a.com', port: 443, secure: true, needsMultiplexing: false });

      const stats = pool.getStats();
      expect(stats.totalAcquisitions).toBe(2);
      expect(stats.totalReuses).toBe(1);
      expect(stats.totalCreated).toBe(1);
    });
  });

  describe('config', () => {
    it('should return and update config', () => {
      expect(pool.getConfig().maxConnections).toBe(10);
      pool.updateConfig({ maxConnections: 20 });
      expect(pool.getConfig().maxConnections).toBe(20);
    });
  });

  describe('dispose', () => {
    it('should close everything', async () => {
      await pool.acquire({ hostname: 'a.com', port: 443, secure: true, needsMultiplexing: false });
      pool.dispose();
      expect(pool.getStats().totalConnections).toBe(0);
    });
  });
});
