import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createFirewallGuardedNetworking,
  type FirewallGuardedNetworking,
  type NetworkingSetupOptions,
} from '../src/browser/networking/networking-setup';
import {
  Firewall,
  applyBaselineRules,
  FirewallBlockedError,
} from '../src/browser/networking/firewall';
import type { ParsedIP, SocketConnection, ConnectionTarget } from '../src/browser/networking/ip-protocol';

describe('networking-setup', () => {
  describe('createFirewallGuardedNetworking', () => {
    let result: FirewallGuardedNetworking;

    beforeEach(() => {
      result = createFirewallGuardedNetworking();
    });

    it('creates a firewall instance', () => {
      expect(result.firewall).toBeInstanceOf(Firewall);
    });

    it('applies baseline rules by default', () => {
      const rules = result.firewall.getRules();
      const ids = rules.map(r => r.id);
      expect(ids).toContain('block-mdns');
      expect(ids).toContain('block-netbios');
      expect(ids).toContain('block-ssdp');
      expect(ids).toContain('allow-standard-web-ports');
      expect(ids).toContain('allow-https-port');
    });

    it('does not apply baseline rules when applyBaseline is false', () => {
      const res = createFirewallGuardedNetworking({ applyBaseline: false });
      const rules = res.firewall.getRules();
      expect(rules.length).toBe(0);
    });

    it('passes firewall options through', () => {
      const res = createFirewallGuardedNetworking({
        firewallOptions: { defaultAction: 'allow' },
      });
      const decision = res.firewall.evaluate({
        hostname: 'unknown.example.com',
        port: 9999,
        protocol: 'https',
      });
      expect(decision.action).toBe('allow');
    });

    it('guardSocket returns a function', () => {
      const mockOpenSocket = vi.fn(async (address: ParsedIP, port: number): Promise<SocketConnection> => ({
        target: { hostname: 'test.com', port: 443, protocol: 'https' },
        resolvedAddress: address,
        state: 'open',
        openedAt: Date.now(),
      }));

      const guarded = result.guardSocket(mockOpenSocket, {
        hostname: 'test.com',
        port: 443,
        protocol: 'https',
      });

      expect(typeof guarded).toBe('function');
    });

    it('guardSocket allows connections that pass firewall rules', async () => {
      const mockOpenSocket = vi.fn(async (address: ParsedIP, port: number): Promise<SocketConnection> => ({
        target: { hostname: 'example.com', port: 443, protocol: 'https' },
        resolvedAddress: address,
        state: 'open',
        openedAt: Date.now(),
      }));

      const guarded = result.guardSocket(mockOpenSocket, {
        hostname: 'example.com',
        port: 443,
        protocol: 'https',
      });

      const addr: ParsedIP = { version: 4, octets: [93, 184, 216, 34], raw: '93.184.216.34' };
      const conn = await guarded(addr, 443);

      expect(conn.state).toBe('open');
      expect(mockOpenSocket).toHaveBeenCalledOnce();
    });

    it('guardSocket blocks connections that fail firewall rules', async () => {
      const res = createFirewallGuardedNetworking({
        firewallOptions: { defaultAction: 'deny' },
        applyBaseline: false,
      });

      const mockOpenSocket = vi.fn(async (address: ParsedIP, port: number): Promise<SocketConnection> => ({
        target: { hostname: 'blocked.com', port: 443, protocol: 'https' },
        resolvedAddress: address,
        state: 'open',
        openedAt: Date.now(),
      }));

      const guarded = res.guardSocket(mockOpenSocket, {
        hostname: 'blocked.com',
        port: 443,
        protocol: 'https',
      });

      const addr: ParsedIP = { version: 4, octets: [1, 2, 3, 4], raw: '1.2.3.4' };

      await expect(guarded(addr, 443)).rejects.toThrow(FirewallBlockedError);
      expect(mockOpenSocket).not.toHaveBeenCalled();
    });

    it('guardSocket blocks mDNS (port 5353) with baseline rules', async () => {
      const mockOpenSocket = vi.fn(async (address: ParsedIP, port: number): Promise<SocketConnection> => ({
        target: { hostname: '224.0.0.251', port: 5353, protocol: 'https' },
        resolvedAddress: address,
        state: 'open',
        openedAt: Date.now(),
      }));

      const guarded = result.guardSocket(mockOpenSocket, {
        hostname: '224.0.0.251',
        port: 5353,
        protocol: 'https',
      });

      const addr: ParsedIP = { version: 4, octets: [224, 0, 0, 251], raw: '224.0.0.251' };

      await expect(guarded(addr, 5353)).rejects.toThrow(FirewallBlockedError);
      expect(mockOpenSocket).not.toHaveBeenCalled();
    });

    it('guardSocket blocks NetBIOS ports (137-139) with baseline rules', async () => {
      const mockOpenSocket = vi.fn(async (address: ParsedIP, port: number): Promise<SocketConnection> => ({
        target: { hostname: '10.0.0.1', port, protocol: 'https' },
        resolvedAddress: address,
        state: 'open',
        openedAt: Date.now(),
      }));

      const guarded = result.guardSocket(mockOpenSocket, {
        hostname: '10.0.0.1',
        port: 137,
        protocol: 'https',
      });

      const addr: ParsedIP = { version: 4, octets: [10, 0, 0, 1], raw: '10.0.0.1' };

      await expect(guarded(addr, 137)).rejects.toThrow(FirewallBlockedError);
      expect(mockOpenSocket).not.toHaveBeenCalled();
    });

    it('guardSocket allows HTTPS (port 443) with baseline rules', async () => {
      const mockOpenSocket = vi.fn(async (address: ParsedIP, port: number): Promise<SocketConnection> => ({
        target: { hostname: 'example.com', port: 443, protocol: 'https' },
        resolvedAddress: address,
        state: 'open',
        openedAt: Date.now(),
      }));

      const guarded = result.guardSocket(mockOpenSocket, {
        hostname: 'example.com',
        port: 443,
        protocol: 'https',
      });

      const addr: ParsedIP = { version: 4, octets: [93, 184, 216, 34], raw: '93.184.216.34' };
      const conn = await guarded(addr, 443);

      expect(conn.state).toBe('open');
    });

    it('guardSocket allows HTTP (port 80) with baseline rules', async () => {
      const mockOpenSocket = vi.fn(async (address: ParsedIP, port: number): Promise<SocketConnection> => ({
        target: { hostname: 'example.com', port: 80, protocol: 'http' },
        resolvedAddress: address,
        state: 'open',
        openedAt: Date.now(),
      }));

      const guarded = result.guardSocket(mockOpenSocket, {
        hostname: 'example.com',
        port: 80,
        protocol: 'http',
      });

      const addr: ParsedIP = { version: 4, octets: [93, 184, 216, 34], raw: '93.184.216.34' };
      const conn = await guarded(addr, 80);

      expect(conn.state).toBe('open');
    });

    it('guardSocket blocks private network addresses on non-allowed ports', async () => {
      const res = createFirewallGuardedNetworking({
        firewallOptions: { blockPrivateNetworksByDefault: true },
        applyBaseline: false,
      });

      const mockOpenSocket = vi.fn(async (address: ParsedIP, port: number): Promise<SocketConnection> => ({
        target: { hostname: '192.168.1.1', port, protocol: 'https' },
        resolvedAddress: address,
        state: 'open',
        openedAt: Date.now(),
      }));

      const guarded = res.guardSocket(mockOpenSocket, {
        hostname: '192.168.1.1',
        port: 8080,
        protocol: 'https',
      });

      const addr: ParsedIP = { version: 4, octets: [192, 168, 1, 1], raw: '192.168.1.1' };

      await expect(guarded(addr, 8080)).rejects.toThrow();
      expect(mockOpenSocket).not.toHaveBeenCalled();
    });
  });

  describe('integration with establishConnection', () => {
    it('can be used to create a guarded connection factory', async () => {
      const { firewall, guardSocket } = createFirewallGuardedNetworking();

      const openSocket = async (address: ParsedIP, port: number): Promise<SocketConnection> => ({
        target: { hostname: 'example.com', port, protocol: 'https' as const },
        resolvedAddress: address,
        state: 'open' as const,
        openedAt: Date.now(),
      });

      const guardedOpenSocket = guardSocket(openSocket, {
        hostname: 'example.com',
        port: 443,
        protocol: 'https',
      });

      const addr: ParsedIP = { version: 4, octets: [93, 184, 216, 34], raw: '93.184.216.34' };
      const conn = await guardedOpenSocket(addr, 443);

      expect(conn.state).toBe('open');
      expect(conn.resolvedAddress).toEqual(addr);
    });

    it('firewall is accessible for rule management', () => {
      const { firewall } = createFirewallGuardedNetworking();

      firewall.blockHostname('evil.com', 'Block evil domain');

      const rules = firewall.getRules();
      const evilRule = rules.find(r => r.id === 'block-host-evil.com');
      expect(evilRule).toBeDefined();
      expect(evilRule!.action).toBe('deny');
    });
  });
});
