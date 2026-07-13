import { describe, it, expect, beforeEach } from 'vitest';
import {
  GatewayProtocolManager,
  GatewayCategory,
  GatewayProtocolType,
  UnknownGatewayProtocolError,
  GatewayConnectionError,
  BUILT_IN_GATEWAYS,
  DEFAULT_PROXY_CONFIG,
  DEFAULT_DNS_CONFIG,
  DEFAULT_TUNNEL_CONFIG,
} from '../src/browser/netwroking/gateway-protocols';

describe('GatewayProtocolManager', () => {
  let manager: GatewayProtocolManager;

  beforeEach(() => {
    manager = new GatewayProtocolManager();
  });

  describe('resolve', () => {
    it('should resolve a socks5:// URL', () => {
      const result = manager.resolve('socks5://proxy.example.com:1080');
      expect(result).not.toBeNull();
      expect(result!.category).toBe(GatewayCategory.Proxy);
      expect(result!.protocol).toBe(GatewayProtocolType.SOCKS5);
      expect(result!.label).toBe('SOCKS5 Proxy');
      expect(result!.isEncrypted).toBe(false);
      expect(result!.defaultPort).toBe(1080);
    });

    it('should resolve a stun: URL', () => {
      const result = manager.resolve('stun:stun.l.google.com:19302');
      expect(result).not.toBeNull();
      expect(result!.category).toBe(GatewayCategory.NAT);
      expect(result!.protocol).toBe(GatewayProtocolType.STUN);
      expect(result!.label).toBe('STUN');
    });

    it('should resolve a dns+https: URL (DoH)', () => {
      const result = manager.resolve('https+dns:https://cloudflare-dns.com/dns-query');
      expect(result).not.toBeNull();
      expect(result!.category).toBe(GatewayCategory.DNS);
      expect(result!.protocol).toBe(GatewayProtocolType.DNSOverHTTPS);
      expect(result!.label).toBe('DNS over HTTPS (DoH)');
      expect(result!.isEncrypted).toBe(true);
    });

    it('should resolve a wg: URL (WireGuard)', () => {
      const result = manager.resolve('wg://vpn.example.com');
      expect(result).not.toBeNull();
      expect(result!.category).toBe(GatewayCategory.Tunnel);
      expect(result!.protocol).toBe(GatewayProtocolType.WireGuard);
      expect(result!.label).toBe('WireGuard VPN');
      expect(result!.isEncrypted).toBe(true);
    });

    it('should return null for an unknown scheme', () => {
      const result = manager.resolve('foobar://something');
      expect(result).toBeNull();
    });

    it('should return null for an invalid URL', () => {
      const result = manager.resolve('not a url');
      expect(result).toBeNull();
    });
  });

  describe('resolveScheme', () => {
    it('should resolve http-proxy: scheme', () => {
      const result = manager.resolveScheme('http-proxy:');
      expect(result).not.toBeNull();
      expect(result!.category).toBe(GatewayCategory.Proxy);
      expect(result!.protocol).toBe(GatewayProtocolType.HTTPProxy);
      expect(result!.label).toBe('HTTP Proxy');
      expect(result!.isEncrypted).toBe(false);
      expect(result!.defaultPort).toBe(8080);
    });

    it('should resolve tls+dns: scheme (DoT)', () => {
      const result = manager.resolveScheme('tls+dns:');
      expect(result).not.toBeNull();
      expect(result!.category).toBe(GatewayCategory.DNS);
      expect(result!.protocol).toBe(GatewayProtocolType.DNSOverTLS);
      expect(result!.isEncrypted).toBe(true);
      expect(result!.defaultPort).toBe(853);
    });

    it('should resolve captive: scheme', () => {
      const result = manager.resolveScheme('captive:');
      expect(result).not.toBeNull();
      expect(result!.category).toBe(GatewayCategory.Access);
      expect(result!.protocol).toBe(GatewayProtocolType.CaptivePortal);
      expect(result!.requiresAuth).toBe(true);
    });

    it('should return null for an unregistered scheme', () => {
      const result = manager.resolveScheme('not-real:');
      expect(result).toBeNull();
    });
  });

  describe('category helpers', () => {
    it('isProxy should return true for socks5:', () => {
      expect(manager.isProxy('socks5:')).toBe(true);
    });

    it('isProxy should return false for dns:', () => {
      expect(manager.isProxy('dns:')).toBe(false);
    });

    it('isDNS should return true for https+dns:', () => {
      expect(manager.isDNS('https+dns:')).toBe(true);
    });

    it('isDNS should return false for stun:', () => {
      expect(manager.isDNS('stun:')).toBe(false);
    });

    it('isTunnel should return true for wg:', () => {
      expect(manager.isTunnel('wg:')).toBe(true);
    });

    it('isTunnel should return false for socks5:', () => {
      expect(manager.isTunnel('socks5:')).toBe(false);
    });

    it('isNAT should return true for stun:', () => {
      expect(manager.isNAT('stun:')).toBe(true);
    });

    it('isNAT should return false for turn:', () => {
      expect(manager.isNAT('turn:')).toBe(true);
    });

    it('isAccess should return true for radius:', () => {
      expect(manager.isAccess('radius:')).toBe(true);
    });

    it('isAccess should return false for stun:', () => {
      expect(manager.isAccess('stun:')).toBe(false);
    });

    it('isEncrypted should return true for tls+dns:', () => {
      expect(manager.isEncrypted('tls+dns:')).toBe(true);
    });

    it('isEncrypted should return false for dns:', () => {
      expect(manager.isEncrypted('dns:')).toBe(false);
    });
  });

  describe('getSchemes', () => {
    it('should return all registered schemes', () => {
      const schemes = manager.getSchemes();
      expect(schemes.length).toBeGreaterThanOrEqual(52);
      expect(schemes).toContain('socks5:');
      expect(schemes).toContain('dns:');
      expect(schemes).toContain('stun:');
      expect(schemes).toContain('wg:');
      expect(schemes).toContain('radius:');
      expect(schemes).toContain('cdn:');
      expect(schemes).toContain('ssdp:');
    });
  });

  describe('getSchemesByCategory', () => {
    it('should return all proxy schemes', () => {
      const proxySchemes = manager.getSchemesByCategory(GatewayCategory.Proxy);
      expect(proxySchemes).toContain('http-proxy:');
      expect(proxySchemes).toContain('https-proxy:');
      expect(proxySchemes).toContain('socks4:');
      expect(proxySchemes).toContain('socks4a:');
      expect(proxySchemes).toContain('socks5:');
      expect(proxySchemes).toContain('pac+http:');
      expect(proxySchemes).toContain('pac+https:');
      expect(proxySchemes).toContain('wpad:');
    });

    it('should return all DNS schemes', () => {
      const dnsSchemes = manager.getSchemesByCategory(GatewayCategory.DNS);
      expect(dnsSchemes).toContain('dns:');
      expect(dnsSchemes).toContain('dns+udp:');
      expect(dnsSchemes).toContain('dns+tcp:');
      expect(dnsSchemes).toContain('https+dns:');
      expect(dnsSchemes).toContain('tls+dns:');
      expect(dnsSchemes).toContain('quic+dns:');
      expect(dnsSchemes).toContain('dnssec:');
      expect(dnsSchemes).toContain('mdns:');
    });

    it('should return all tunnel schemes', () => {
      const tunnelSchemes = manager.getSchemesByCategory(GatewayCategory.Tunnel);
      expect(tunnelSchemes).toContain('ssh-tunnel:');
      expect(tunnelSchemes).toContain('wg:');
      expect(tunnelSchemes).toContain('openvpn:');
      expect(tunnelSchemes).toContain('ipsec:');
      expect(tunnelSchemes).toContain('ikev2:');
      expect(tunnelSchemes).toContain('l2tp:');
      expect(tunnelSchemes).toContain('gre:');
      expect(tunnelSchemes).toContain('vxlan:');
      expect(tunnelSchemes).toContain('geneve:');
    });

    it('should return all NAT traversal schemes', () => {
      const natSchemes = manager.getSchemesByCategory(GatewayCategory.NAT);
      expect(natSchemes).toContain('upnp:');
      expect(natSchemes).toContain('nat-pmp:');
      expect(natSchemes).toContain('pcp:');
      expect(natSchemes).toContain('stun:');
      expect(natSchemes).toContain('stuns:');
      expect(natSchemes).toContain('turn:');
      expect(natSchemes).toContain('turns:');
      expect(natSchemes).toContain('ice:');
    });

    it('should return all access schemes', () => {
      const accessSchemes = manager.getSchemesByCategory(GatewayCategory.Access);
      expect(accessSchemes).toContain('captive:');
      expect(accessSchemes).toContain('radius:');
      expect(accessSchemes).toContain('radiustls:');
      expect(accessSchemes).toContain('tacacs:');
      expect(accessSchemes).toContain('dot1x:');
      expect(accessSchemes).toContain('wispr:');
    });
  });

  describe('getProxySchemes / getDNSSchemes / getTunnelSchemes / getNATSchemes / getAccessSchemes', () => {
    it('getProxySchemes should return all proxy schemes', () => {
      const proxySchemes = manager.getProxySchemes();
      expect(proxySchemes).toContain('socks5:');
      expect(proxySchemes).toContain('http-proxy:');
    });

    it('getDNSSchemes should return all DNS schemes', () => {
      const dnsSchemes = manager.getDNSSchemes();
      expect(dnsSchemes).toContain('dns:');
      expect(dnsSchemes).toContain('https+dns:');
    });

    it('getTunnelSchemes should return all tunnel schemes', () => {
      const tunnelSchemes = manager.getTunnelSchemes();
      expect(tunnelSchemes).toContain('wg:');
      expect(tunnelSchemes).toContain('openvpn:');
    });

    it('getNATSchemes should return all NAT schemes', () => {
      const natSchemes = manager.getNATSchemes();
      expect(natSchemes).toContain('stun:');
      expect(natSchemes).toContain('turn:');
    });

    it('getAccessSchemes should return all access schemes', () => {
      const accessSchemes = manager.getAccessSchemes();
      expect(accessSchemes).toContain('captive:');
      expect(accessSchemes).toContain('radius:');
    });
  });

  describe('register / unregister', () => {
    it('should register a custom gateway protocol', () => {
      const registered = manager.register({
        scheme: 'custom-proxy:',
        category: GatewayCategory.Proxy,
        protocol: GatewayProtocolType.HTTPProxy,
        label: 'Custom Proxy',
        isEncrypted: false,
        defaultPort: 9090,
        requiresAuth: true,
        supportsUDP: false,
        supportsTCP: true,
        remoteDNS: false,
      });
      expect(registered).toBe(true);

      const result = manager.resolveScheme('custom-proxy:');
      expect(result).not.toBeNull();
      expect(result!.label).toBe('Custom Proxy');
      expect(result!.defaultPort).toBe(9090);
      expect(result!.requiresAuth).toBe(true);
    });

    it('should return false when replacing an existing protocol', () => {
      const registered = manager.register({
        scheme: 'socks5:',
        category: GatewayCategory.Proxy,
        protocol: GatewayProtocolType.SOCKS5,
        label: 'Replaced SOCKS5',
        isEncrypted: false,
        defaultPort: 1080,
        requiresAuth: false,
        supportsUDP: true,
        supportsTCP: true,
        remoteDNS: true,
      });
      expect(registered).toBe(false);
    });

    it('should unregister a protocol', () => {
      const existed = manager.unregister('socks5:');
      expect(existed).toBe(true);
      expect(manager.resolveScheme('socks5:')).toBeNull();
    });

    it('should return false when unregistering a non-existent protocol', () => {
      const existed = manager.unregister('non-existent:');
      expect(existed).toBe(false);
    });
  });

  describe('built-in gateway count', () => {
    it('should have at least 52 built-in gateway registrations', () => {
      expect(BUILT_IN_GATEWAYS.length).toBeGreaterThanOrEqual(52);
    });

    it('should have all 8 categories represented', () => {
      const categories = new Set(BUILT_IN_GATEWAYS.map(g => g.category));
      expect(categories.size).toBe(8);
      expect(categories.has(GatewayCategory.Proxy)).toBe(true);
      expect(categories.has(GatewayCategory.DNS)).toBe(true);
      expect(categories.has(GatewayCategory.Tunnel)).toBe(true);
      expect(categories.has(GatewayCategory.NAT)).toBe(true);
      expect(categories.has(GatewayCategory.Access)).toBe(true);
      expect(categories.has(GatewayCategory.LoadBalancer)).toBe(true);
      expect(categories.has(GatewayCategory.CDN)).toBe(true);
      expect(categories.has(GatewayCategory.Discovery)).toBe(true);
    });
  });

  describe('encrypted vs unencrypted', () => {
    it('should mark socks5: as unencrypted', () => {
      expect(manager.isEncrypted('socks5:')).toBe(false);
    });

    it('should mark https-proxy: as encrypted', () => {
      expect(manager.isEncrypted('https-proxy:')).toBe(true);
    });

    it('should mark tls+dns: as encrypted', () => {
      expect(manager.isEncrypted('tls+dns:')).toBe(true);
    });

    it('should mark stun: as unencrypted', () => {
      expect(manager.isEncrypted('stun:')).toBe(false);
    });

    it('should mark stuns: as encrypted', () => {
      expect(manager.isEncrypted('stuns:')).toBe(true);
    });

    it('should mark wg: as encrypted', () => {
      expect(manager.isEncrypted('wg:')).toBe(true);
    });

    it('should mark openvpn: as encrypted', () => {
      expect(manager.isEncrypted('openvpn:')).toBe(true);
    });

    it('should mark gre: as unencrypted', () => {
      expect(manager.isEncrypted('gre:')).toBe(false);
    });
  });

  describe('auth requirements', () => {
    it('socks5: should not require auth by default', () => {
      const result = manager.resolveScheme('socks5:');
      expect(result!.requiresAuth).toBe(false);
    });

    it('wg: should require auth', () => {
      const result = manager.resolveScheme('wg:');
      expect(result!.requiresAuth).toBe(true);
    });

    it('openvpn: should require auth', () => {
      const result = manager.resolveScheme('openvpn:');
      expect(result!.requiresAuth).toBe(true);
    });

    it('turn: should require auth', () => {
      const result = manager.resolveScheme('turn:');
      expect(result!.requiresAuth).toBe(true);
    });

    it('stun: should not require auth', () => {
      const result = manager.resolveScheme('stun:');
      expect(result!.requiresAuth).toBe(false);
    });
  });

  describe('UDP vs TCP support', () => {
    it('socks5: should support both UDP and TCP', () => {
      const result = manager.resolveScheme('socks5:');
      expect(result!.supportsUDP).toBe(true);
      expect(result!.supportsTCP).toBe(true);
    });

    it('http-proxy: should support TCP only', () => {
      const result = manager.resolveScheme('http-proxy:');
      expect(result!.supportsUDP).toBe(false);
      expect(result!.supportsTCP).toBe(true);
    });

    it('wg: should support UDP only', () => {
      const result = manager.resolveScheme('wg:');
      expect(result!.supportsUDP).toBe(true);
      expect(result!.supportsTCP).toBe(false);
    });

    it('dns+udp: should support UDP only', () => {
      const result = manager.resolveScheme('dns+udp:');
      expect(result!.supportsUDP).toBe(true);
      expect(result!.supportsTCP).toBe(false);
    });

    it('tls+dns: should support TCP only', () => {
      const result = manager.resolveScheme('tls+dns:');
      expect(result!.supportsUDP).toBe(false);
      expect(result!.supportsTCP).toBe(true);
    });
  });

  describe('remote DNS', () => {
    it('socks5: should support remote DNS', () => {
      const result = manager.resolveScheme('socks5:');
      expect(result!.remoteDNS).toBe(true);
    });

    it('socks4: should not support remote DNS', () => {
      const result = manager.resolveScheme('socks4:');
      expect(result!.remoteDNS).toBe(false);
    });

    it('socks4a: should support remote DNS', () => {
      const result = manager.resolveScheme('socks4a:');
      expect(result!.remoteDNS).toBe(true);
    });

    it('dns: should support remote DNS', () => {
      const result = manager.resolveScheme('dns:');
      expect(result!.remoteDNS).toBe(true);
    });

    it('mdns: should not support remote DNS', () => {
      const result = manager.resolveScheme('mdns:');
      expect(result!.remoteDNS).toBe(false);
    });
  });
});

describe('GatewayProtocolManager — default configs', () => {
  it('DEFAULT_PROXY_CONFIG should have null proxies and localhost noProxy', () => {
    expect(DEFAULT_PROXY_CONFIG.httpProxy).toBeNull();
    expect(DEFAULT_PROXY_CONFIG.httpsProxy).toBeNull();
    expect(DEFAULT_PROXY_CONFIG.socksProxy).toBeNull();
    expect(DEFAULT_PROXY_CONFIG.pacUrl).toBeNull();
    expect(DEFAULT_PROXY_CONFIG.useWpad).toBe(false);
    expect(DEFAULT_PROXY_CONFIG.noProxy).toContain('localhost');
    expect(DEFAULT_PROXY_CONFIG.noProxy).toContain('127.0.0.1');
  });

  it('DEFAULT_DNS_CONFIG should have null DNS servers', () => {
    expect(DEFAULT_DNS_CONFIG.primaryDns).toBeNull();
    expect(DEFAULT_DNS_CONFIG.secondaryDns).toBeNull();
    expect(DEFAULT_DNS_CONFIG.dohUrl).toBeNull();
    expect(DEFAULT_DNS_CONFIG.dotUrl).toBeNull();
    expect(DEFAULT_DNS_CONFIG.doqUrl).toBeNull();
    expect(DEFAULT_DNS_CONFIG.useDnssec).toBe(false);
    expect(DEFAULT_DNS_CONFIG.searchDomains).toEqual([]);
  });

  it('DEFAULT_TUNNEL_CONFIG should have no VPN', () => {
    expect(DEFAULT_TUNNEL_CONFIG.vpnType).toBe('none');
    expect(DEFAULT_TUNNEL_CONFIG.vpnServer).toBeNull();
    expect(DEFAULT_TUNNEL_CONFIG.autoConnect).toBe(false);
  });
});

describe('GatewayProtocolManager — metadata', () => {
  let manager: GatewayProtocolManager;

  beforeEach(() => {
    manager = new GatewayProtocolManager();
  });

  it('socks5: should have RFC 1928 in metadata', () => {
    const result = manager.resolveScheme('socks5:');
    expect(result!.metadata).toHaveProperty('rfc', '1928');
    expect(result!.metadata).toHaveProperty('version', '5');
  });

  it('dns: should have RFC 1035 in metadata', () => {
    const result = manager.resolveScheme('dns:');
    expect(result!.metadata).toHaveProperty('rfc', '1035');
  });

  it('stun: should have RFC 8489 in metadata', () => {
    const result = manager.resolveScheme('stun:');
    expect(result!.metadata).toHaveProperty('rfc', '8489');
  });

  it('wg: should have WireGuard protocol in metadata', () => {
    const result = manager.resolveScheme('wg:');
    expect(result!.metadata).toHaveProperty('protocol', 'WireGuard');
  });
});

describe('Error classes', () => {
  it('UnknownGatewayProtocolError should have the scheme property', () => {
    const err = new UnknownGatewayProtocolError('foo:');
    expect(err.name).toBe('UnknownGatewayProtocolError');
    expect(err.scheme).toBe('foo:');
    expect(err.message).toContain('foo:');
  });

  it('GatewayConnectionError should have gateway and target URLs', () => {
    const err = new GatewayConnectionError(
      'socks5://proxy:1080',
      'https://example.com',
      'Connection refused',
    );
    expect(err.name).toBe('GatewayConnectionError');
    expect(err.gatewayUrl).toBe('socks5://proxy:1080');
    expect(err.targetUrl).toBe('https://example.com');
    expect(err.message).toContain('Connection refused');
  });
});
