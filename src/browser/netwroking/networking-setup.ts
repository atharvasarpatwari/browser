/**
 * @file src/browser/netwroking/networking-setup.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Factory that composes the networking stack with firewall enforcement.
 * Creates a firewall-guarded connection factory and wires it into the
 * establishConnection pipeline so every outbound socket passes through
 * policy evaluation first.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { ParsedIP, SocketConnection, ConnectionTarget } from './ip-protocol';
import { Firewall, applyBaselineRules, firewallGuardedOpenSocket, type FirewallOptions } from './firewall';
import type { IDisposable } from '../../app/dependency-container';

export interface NetworkingSetupOptions {
  firewallOptions?: FirewallOptions;
  /** If true, applies standard baseline rules (block mDNS, NetBIOS, SSDP; allow HTTP/HTTPS). */
  applyBaseline?: boolean;
}

export interface FirewallGuardedNetworking {
  readonly firewall: Firewall;
  /** Wraps an openSocket callback to enforce firewall rules before opening. */
  guardSocket(
    openSocket: (address: ParsedIP, port: number) => Promise<SocketConnection>,
    target: ConnectionTarget,
  ): (address: ParsedIP, port: number) => Promise<SocketConnection>;
}

export function createFirewallGuardedNetworking(
  options: NetworkingSetupOptions = {},
): FirewallGuardedNetworking {
  const { firewallOptions, applyBaseline = true } = options;
  const firewall = new Firewall(firewallOptions);

  if (applyBaseline) {
    applyBaselineRules(firewall);
  }

  return {
    firewall,
    guardSocket(openSocket, target) {
      return firewallGuardedOpenSocket(firewall, async (address: ParsedIP, port: number) => {
        return openSocket(address, port);
      });
    },
  };
}
