/**
 * @file src/browser/networking/gateway-protocols.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Define and manage all internet gateway protocols that enable the browser
 * to access the internet through various network infrastructure.
 *
 * Gateway protocols sit between the browser and the internet, handling:
 *   1. Proxy gateways       — route traffic through intermediate servers
 *   2. DNS gateways         — resolve domain names across network boundaries
 *   3. Tunnel gateways      — encapsulate traffic across incompatible networks
 *   4. NAT traversal        — punch through network address translation
 *   5. Network access       — authenticate and authorize network connections
 *   6. Load balancing       — distribute traffic across backend servers
 *   7. Content delivery     — cache and serve content from edge locations
 *   8. Service discovery    — find services on the local network
 *
 *   BrowserEngine
 *        │  GatewayProtocolManager.resolve(url)
 *        ▼
 *   GatewayProtocolResult
 *        │  category: "proxy" | "dns" | "tunnel" | "nat" | "access" | "lb" | "cdn" | "discovery"
 *        ▼
 *   RequestManager uses the gateway info to:
 *     - Route through the correct proxy
 *     - Resolve DNS via the appropriate gateway
 *     - Establish tunnels when needed
 *     - Handle NAT traversal for P2P
 *     - Authenticate with captive portals
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IGatewayProtocolManager hides the registry from callers.
 *  Encapsulation    All protocol maps are private; callers use resolve() only.
 *  Single-Resp.     Only maps gateway URLs to handler metadata — no fetching.
 *  Open / Closed    New gateway protocols are added via register() without
 *                   modifying the class itself.
 *  Dependency-Inv.  Receives no concrete dependencies; pure lookup service.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The category of gateway protocol.
 */
enum GatewayCategory {
  /** Proxy servers (HTTP, HTTPS, SOCKS4, SOCKS5). */
  Proxy        = 'proxy',
  /** DNS resolution gateways (DNS, DoH, DoT, DoQ). */
  DNS          = 'dns',
  /** Network tunnels (SSH, VPN, WireGuard, GRE, IPIP). */
  Tunnel       = 'tunnel',
  /** NAT traversal (UPnP, NAT-PMP, PCP, STUN, TURN, ICE). */
  NAT          = 'nat',
  /** Network access / authentication (Captive Portal, RADIUS, 802.1X). */
  Access       = 'access',
  /** Load balancing (health checks, backend routing). */
  LoadBalancer = 'load-balancer',
  /** Content delivery networks (CDN edge servers). */
  CDN          = 'cdn',
  /** Service discovery (mDNS, SSDP, Bonjour, Avahi). */
  Discovery    = 'discovery',
}

/**
 * The specific protocol within a gateway category.
 */
enum GatewayProtocolType {
  // ── Proxy protocols ─────────────────────────────────────────────────────
  /** HTTP proxy (RFC 7230) — forwards plain HTTP requests. */
  HTTPProxy         = 'http-proxy',
  /** HTTPS/CONNECT proxy (RFC 7231 §4.3.6) — tunnels TLS through proxy. */
  HTTPSProxy        = 'https-proxy',
  /** SOCKS4 proxy — simple TCP proxy (RFC 1928 predecessor). */
  SOCKS4            = 'socks4',
  /** SOCKS4a proxy — SOCKS4 with remote DNS resolution. */
  SOCKS4a           = 'socks4a',
  /** SOCKS5 proxy (RFC 1928) — TCP/UDP proxy with auth and remote DNS. */
  SOCKS5            = 'socks5',
  /** PAC — Proxy Auto-Configuration (WPAD/WPAD). */
  PAC               = 'pac',
  /** WPAD — Web Proxy Auto-Discovery Protocol. */
  WPAD              = 'wpad',
  /** HTTP/2 CONNECT — RFC 8441, tunnelling over HTTP/2. */
  HTTP2Connect      = 'http2-connect',

  // ── DNS protocols ───────────────────────────────────────────────────────
  /** Standard DNS over UDP/TCP (RFC 1035). */
  DNS               = 'dns',
  /** DNS over HTTPS — DoH (RFC 8484). */
  DNSOverHTTPS      = 'dns-over-https',
  /** DNS over TLS — DoT (RFC 7858). */
  DNSOverTLS        = 'dns-over-tls',
  /** DNS over QUIC — DoQ (RFC 9250). */
  DNSOverQUIC       = 'dns-over-quic',
  /** DNS over UDP with DNSSEC (RFC 4033–4035). */
  DNSSEC            = 'dnssec',
  /** mDNS — Multicast DNS for local resolution (RFC 6762). */
  mDNS              = 'mdns',

  // ── Tunnel protocols ────────────────────────────────────────────────────
  /** SSH tunnel (RFC 4251) — encrypted tunnel over SSH. */
  SSHTunnel         = 'ssh-tunnel',
  /** WireGuard tunnel — modern VPN (RFC draft). */
  WireGuard         = 'wireguard',
  /** OpenVPN tunnel — SSL/TLS VPN. */
  OpenVPN           = 'openvpn',
  /** IPSec/IKEv2 tunnel (RFC 7296). */
  IPSec             = 'ipsec',
  /** IKEv2 tunnel (RFC 7296). */
  IKEv2             = 'ikev2',
  /** L2TP tunnel (RFC 2661). */
  L2TP              = 'l2tp',
  /** GRE tunnel (RFC 2784). */
  GRE               = 'gre',
  /** IPIP tunnel. */
  IPIP              = 'ipip',
  /** VXLAN tunnel (RFC 7348). */
  VXLAN             = 'vxlan',
  /** Geneve tunnel (RFC 8926). */
  Geneve            = 'geneve',
  /** 6to4 tunnel (RFC 3056) — IPv6 over IPv4. */
  SixToFour         = '6to4',
  /** ISATAP tunnel — Intra-Site Automatic Tunnel Addressing Protocol. */
  ISATAP            = 'isatap',
  /** Teredo tunnel (RFC 4380) — IPv6 NAT traversal. */
  Teredo            = 'teredo',

  // ── NAT traversal protocols ─────────────────────────────────────────────
  /** UPnP — Universal Plug and Play (IGD). */
  UPnP              = 'upnp',
  /** NAT-PMP — NAT Port Mapping Protocol. */
  NATPMP            = 'nat-pmp',
  /** PCP — Port Control Protocol (RFC 6887). */
  PCP               = 'pcp',
  /** STUN — Session Traversal Utilities for NAT (RFC 8489). */
  STUN              = 'stun',
  /** TURN — Traversal Using Relays around NAT (RFC 8656). */
  TURN              = 'turn',
  /** ICE — Interactive Connectivity Establishment (RFC 8445). */
  ICE               = 'ice',

  // ── Network access protocols ────────────────────────────────────────────
  /** Captive Portal Detection (RFC 8908 / RFC 6739). */
  CaptivePortal     = 'captive-portal',
  /** RADIUS — Remote Authentication Dial-In User Service (RFC 2865). */
  RADIUS            = 'radius',
  /** TACACS+ — Terminal Access Controller Access-Control System Plus. */
  TACACSPlus        = 'tacacs-plus',
  /** 802.1X — Port-Based Network Access Control. */
  IEEE8021X         = 'ieee-802-1x',
  /** WISPr — Wireless ISP (captive portal roaming). */
  WISPr             = 'wispr',

  // ── Load balancing protocols ────────────────────────────────────────────
  /** Health check — backend server availability probing. */
  HealthCheck       = 'health-check',
  /** Consul service mesh health. */
  ConsulHealth      = 'consul-health',

  // ── CDN protocols ───────────────────────────────────────────────────────
  /** CDN edge — content served from nearest edge server. */
  CDNEdge           = 'cdn-edge',
  /** CDN push — origin-to-edge content synchronization. */
  CDNPush           = 'cdn-push',
  /** CDN pull — edge-fetches from origin on cache miss. */
  CDNPull           = 'cdn-pull',

  // ── Service discovery protocols ─────────────────────────────────────────
  /** SSDP — Simple Service Discovery Protocol (UPnP). */
  SSDP              = 'ssdp',
  /** Bonjour — Apple's service discovery (based on mDNS/DNS-SD). */
  Bonjour           = 'bonjour',
  /** Avahi — Linux mDNS/DNS-SD implementation. */
  Avahi             = 'avahi',
  /** DNS-SD — DNS Service Discovery (RFC 6763). */
  DNSSD             = 'dns-sd',
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Describes how the browser should handle a gateway protocol.
 */
interface GatewayProtocolResult {
  /** The gateway category. */
  readonly category: GatewayCategory;
  /** The specific protocol type within the category. */
  readonly protocol: GatewayProtocolType;
  /** Human-readable label for the UI. */
  readonly label: string;
  /** Whether connections using this protocol are encrypted. */
  readonly isEncrypted: boolean;
  /** Default port number, or null when not applicable. */
  readonly defaultPort: number | null;
  /** Whether this gateway requires authentication. */
  readonly requiresAuth: boolean;
  /** Whether this gateway supports UDP. */
  readonly supportsUDP: boolean;
  /** Whether this gateway supports TCP. */
  readonly supportsTCP: boolean;
  /** Whether this gateway resolves DNS remotely. */
  readonly remoteDNS: boolean;
  /** Additional metadata specific to the protocol. */
  readonly metadata: Readonly<Record<string, unknown>>;
}

/**
 * Registration descriptor for a gateway protocol.
 */
interface GatewayRegistration {
  readonly scheme: string;
  readonly category: GatewayCategory;
  readonly protocol: GatewayProtocolType;
  readonly label: string;
  readonly isEncrypted: boolean;
  readonly defaultPort: number | null;
  readonly requiresAuth: boolean;
  readonly supportsUDP: boolean;
  readonly supportsTCP: boolean;
  readonly remoteDNS: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IGatewayProtocolManager {
  /**
   * Resolve a gateway URL to its handler metadata.
   * @param url  Gateway URL including scheme, e.g. "socks5://proxy:1080"
   * @returns The handler result, or null if scheme is unknown.
   */
  resolve(url: string): GatewayProtocolResult | null;

  /**
   * Resolve a scheme string to its handler metadata.
   * @param scheme  Protocol scheme including colon, e.g. "socks5:"
   * @returns The handler result, or null if scheme is unknown.
   */
  resolveScheme(scheme: string): GatewayProtocolResult | null;

  /** True when the scheme is registered as a proxy protocol. */
  isProxy(scheme: string): boolean;

  /** True when the scheme is registered as a DNS protocol. */
  isDNS(scheme: string): boolean;

  /** True when the scheme is registered as a tunnel protocol. */
  isTunnel(scheme: string): boolean;

  /** True when the scheme is registered as a NAT traversal protocol. */
  isNAT(scheme: string): boolean;

  /** True when the scheme is registered as a network access protocol. */
  isAccess(scheme: string): boolean;

  /** True when the scheme uses an encrypted transport. */
  isEncrypted(scheme: string): boolean;

  /**
   * Register or override a gateway protocol handler.
   * @returns true if new, false if replaced an existing one.
   */
  register(registration: GatewayRegistration): boolean;

  /** Remove a gateway protocol by scheme. Returns true if it existed. */
  unregister(scheme: string): boolean;

  /** Return all registered schemes. */
  getSchemes(): readonly string[];

  /** Return all schemes in a given category. */
  getSchemesByCategory(category: GatewayCategory): readonly string[];

  /** Return all proxy schemes. */
  getProxySchemes(): readonly string[];

  /** Return all DNS schemes. */
  getDNSSchemes(): readonly string[];

  /** Return all tunnel schemes. */
  getTunnelSchemes(): readonly string[];

  /** Return all NAT traversal schemes. */
  getNATSchemes(): readonly string[];

  /** Return all network access schemes. */
  getAccessSchemes(): readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR CLASSES
// ─────────────────────────────────────────────────────────────────────────────

class UnknownGatewayProtocolError extends Error {
  readonly scheme: string;
  constructor(scheme: string) {
    super(`Unknown gateway protocol scheme: "${scheme}". No handler registered.`);
    this.name = 'UnknownGatewayProtocolError';
    this.scheme = scheme;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class GatewayConnectionError extends Error {
  readonly gatewayUrl: string;
  readonly targetUrl: string;
  constructor(gatewayUrl: string, targetUrl: string, message: string) {
    super(`Gateway "${gatewayUrl}" failed connecting to "${targetUrl}": ${message}`);
    this.name = 'GatewayConnectionError';
    this.gatewayUrl = gatewayUrl;
    this.targetUrl = targetUrl;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN GATEWAY PROTOCOL REGISTRATIONS
// ─────────────────────────────────────────────────────────────────────────────

const BUILT_IN_GATEWAYS: readonly GatewayRegistration[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  //  PROXY GATEWAY PROTOCOLS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    scheme: 'http-proxy:',
    category: GatewayCategory.Proxy,
    protocol: GatewayProtocolType.HTTPProxy,
    label: 'HTTP Proxy',
    isEncrypted: false,
    defaultPort: 8080,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { rfc: '7230', version: '1.1' },
  },
  {
    scheme: 'https-proxy:',
    category: GatewayCategory.Proxy,
    protocol: GatewayProtocolType.HTTPSProxy,
    label: 'HTTPS/CONNECT Proxy',
    isEncrypted: true,
    defaultPort: 443,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { rfc: '7231', method: 'CONNECT' },
  },
  {
    scheme: 'socks4:',
    category: GatewayCategory.Proxy,
    protocol: GatewayProtocolType.SOCKS4,
    label: 'SOCKS4 Proxy',
    isEncrypted: false,
    defaultPort: 1080,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { rfc: null, version: '4' },
  },
  {
    scheme: 'socks4a:',
    category: GatewayCategory.Proxy,
    protocol: GatewayProtocolType.SOCKS4a,
    label: 'SOCKS4a Proxy',
    isEncrypted: false,
    defaultPort: 1080,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: true,
    metadata: { rfc: null, version: '4a', remoteDNS: true },
  },
  {
    scheme: 'socks5:',
    category: GatewayCategory.Proxy,
    protocol: GatewayProtocolType.SOCKS5,
    label: 'SOCKS5 Proxy',
    isEncrypted: false,
    defaultPort: 1080,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: true,
    remoteDNS: true,
    metadata: { rfc: '1928', version: '5', auth: ['none', 'username'] },
  },
  {
    scheme: 'pac+http:',
    category: GatewayCategory.Proxy,
    protocol: GatewayProtocolType.PAC,
    label: 'Proxy Auto-Config (HTTP)',
    isEncrypted: false,
    defaultPort: 80,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { type: 'PAC', transport: 'http' },
  },
  {
    scheme: 'pac+https:',
    category: GatewayCategory.Proxy,
    protocol: GatewayProtocolType.PAC,
    label: 'Proxy Auto-Config (HTTPS)',
    isEncrypted: true,
    defaultPort: 443,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { type: 'PAC', transport: 'https' },
  },
  {
    scheme: 'wpad:',
    category: GatewayCategory.Proxy,
    protocol: GatewayProtocolType.WPAD,
    label: 'Web Proxy Auto-Discovery',
    isEncrypted: false,
    defaultPort: 80,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { rfc: null, discovery: 'DHCP/DNS' },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  DNS GATEWAY PROTOCOLS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    scheme: 'dns:',
    category: GatewayCategory.DNS,
    protocol: GatewayProtocolType.DNS,
    label: 'DNS',
    isEncrypted: false,
    defaultPort: 53,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: true,
    remoteDNS: true,
    metadata: { rfc: '1035', transport: 'UDP/TCP' },
  },
  {
    scheme: 'dns+udp:',
    category: GatewayCategory.DNS,
    protocol: GatewayProtocolType.DNS,
    label: 'DNS (UDP)',
    isEncrypted: false,
    defaultPort: 53,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: false,
    remoteDNS: true,
    metadata: { rfc: '1035', transport: 'UDP' },
  },
  {
    scheme: 'dns+tcp:',
    category: GatewayCategory.DNS,
    protocol: GatewayProtocolType.DNS,
    label: 'DNS (TCP)',
    isEncrypted: false,
    defaultPort: 53,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: true,
    metadata: { rfc: '1035', transport: 'TCP' },
  },
  {
    scheme: 'https+dns:',
    category: GatewayCategory.DNS,
    protocol: GatewayProtocolType.DNSOverHTTPS,
    label: 'DNS over HTTPS (DoH)',
    isEncrypted: true,
    defaultPort: 443,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: true,
    metadata: { rfc: '8484', format: 'JSON/WireFormat' },
  },
  {
    scheme: 'tls+dns:',
    category: GatewayCategory.DNS,
    protocol: GatewayProtocolType.DNSOverTLS,
    label: 'DNS over TLS (DoT)',
    isEncrypted: true,
    defaultPort: 853,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: true,
    metadata: { rfc: '7858' },
  },
  {
    scheme: 'quic+dns:',
    category: GatewayCategory.DNS,
    protocol: GatewayProtocolType.DNSOverQUIC,
    label: 'DNS over QUIC (DoQ)',
    isEncrypted: true,
    defaultPort: 784,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: false,
    remoteDNS: true,
    metadata: { rfc: '9250' },
  },
  {
    scheme: 'dnssec:',
    category: GatewayCategory.DNS,
    protocol: GatewayProtocolType.DNSSEC,
    label: 'DNSSEC',
    isEncrypted: false,
    defaultPort: 53,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: true,
    remoteDNS: true,
    metadata: { rfc: '4033', signed: true },
  },
  {
    scheme: 'mdns:',
    category: GatewayCategory.DNS,
    protocol: GatewayProtocolType.mDNS,
    label: 'Multicast DNS (mDNS)',
    isEncrypted: false,
    defaultPort: 5353,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { rfc: '6762', multicast: '224.0.0.251' },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  TUNNEL GATEWAY PROTOCOLS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    scheme: 'ssh-tunnel:',
    category: GatewayCategory.Tunnel,
    protocol: GatewayProtocolType.SSHTunnel,
    label: 'SSH Tunnel',
    isEncrypted: true,
    defaultPort: 22,
    requiresAuth: true,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { rfc: '4251', tunnelType: 'local-remote-dynamic' },
  },
  {
    scheme: 'wg:',
    category: GatewayCategory.Tunnel,
    protocol: GatewayProtocolType.WireGuard,
    label: 'WireGuard VPN',
    isEncrypted: true,
    defaultPort: 51820,
    requiresAuth: true,
    supportsUDP: true,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { protocol: 'WireGuard', os: 'kernel' },
  },
  {
    scheme: 'openvpn:',
    category: GatewayCategory.Tunnel,
    protocol: GatewayProtocolType.OpenVPN,
    label: 'OpenVPN',
    isEncrypted: true,
    defaultPort: 1194,
    requiresAuth: true,
    supportsUDP: true,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { transport: 'UDP/TCP', tls: true },
  },
  {
    scheme: 'ipsec:',
    category: GatewayCategory.Tunnel,
    protocol: GatewayProtocolType.IPSec,
    label: 'IPSec VPN',
    isEncrypted: true,
    defaultPort: 500,
    requiresAuth: true,
    supportsUDP: true,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { rfc: '4301', protocols: ['ESP', 'AH'] },
  },
  {
    scheme: 'ikev2:',
    category: GatewayCategory.Tunnel,
    protocol: GatewayProtocolType.IKEv2,
    label: 'IKEv2 VPN',
    isEncrypted: true,
    defaultPort: 500,
    requiresAuth: true,
    supportsUDP: true,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { rfc: '7296' },
  },
  {
    scheme: 'l2tp:',
    category: GatewayCategory.Tunnel,
    protocol: GatewayProtocolType.L2TP,
    label: 'L2TP Tunnel',
    isEncrypted: false,
    defaultPort: 1701,
    requiresAuth: true,
    supportsUDP: true,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { rfc: '2661', typicallyWithIPSec: true },
  },
  {
    scheme: 'gre:',
    category: GatewayCategory.Tunnel,
    protocol: GatewayProtocolType.GRE,
    label: 'GRE Tunnel',
    isEncrypted: false,
    defaultPort: null,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { rfc: '2784', protocolNumber: 47 },
  },
  {
    scheme: 'ipip:',
    category: GatewayCategory.Tunnel,
    protocol: GatewayProtocolType.IPIP,
    label: 'IPIP Tunnel',
    isEncrypted: false,
    defaultPort: null,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { rfc: '2003', encapsulation: 'IPv4-in-IPv4' },
  },
  {
    scheme: 'vxlan:',
    category: GatewayCategory.Tunnel,
    protocol: GatewayProtocolType.VXLAN,
    label: 'VXLAN Tunnel',
    isEncrypted: false,
    defaultPort: 4789,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { rfc: '7348', vni: '24-bit' },
  },
  {
    scheme: 'geneve:',
    category: GatewayCategory.Tunnel,
    protocol: GatewayProtocolType.Geneve,
    label: 'Geneve Tunnel',
    isEncrypted: false,
    defaultPort: 6081,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { rfc: '8926' },
  },
  {
    scheme: '6to4:',
    category: GatewayCategory.Tunnel,
    protocol: GatewayProtocolType.SixToFour,
    label: '6to4 Tunnel',
    isEncrypted: false,
    defaultPort: null,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { rfc: '3056', prefix: '2002::/16' },
  },
  {
    scheme: 'isatap:',
    category: GatewayCategory.Tunnel,
    protocol: GatewayProtocolType.ISATAP,
    label: 'ISATAP Tunnel',
    isEncrypted: false,
    defaultPort: null,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { prefix: '0000:5efe' },
  },
  {
    scheme: 'teredo:',
    category: GatewayCategory.Tunnel,
    protocol: GatewayProtocolType.Teredo,
    label: 'Teredo Tunnel',
    isEncrypted: false,
    defaultPort: 3544,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { rfc: '4380', prefix: '2001:0000::/32' },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  NAT TRAVERSAL PROTOCOLS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    scheme: 'upnp:',
    category: GatewayCategory.NAT,
    protocol: GatewayProtocolType.UPnP,
    label: 'UPnP (IGD)',
    isEncrypted: false,
    defaultPort: null,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { rfc: null, spec: 'UPnP IGD v2', discovery: 'SSDP' },
  },
  {
    scheme: 'nat-pmp:',
    category: GatewayCategory.NAT,
    protocol: GatewayProtocolType.NATPMP,
    label: 'NAT-PMP',
    isEncrypted: false,
    defaultPort: 5351,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { rfc: null, apple: true },
  },
  {
    scheme: 'pcp:',
    category: GatewayCategory.NAT,
    protocol: GatewayProtocolType.PCP,
    label: 'Port Control Protocol',
    isEncrypted: false,
    defaultPort: 5351,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { rfc: '6887', successor: 'NAT-PMP' },
  },
  {
    scheme: 'stun:',
    category: GatewayCategory.NAT,
    protocol: GatewayProtocolType.STUN,
    label: 'STUN',
    isEncrypted: false,
    defaultPort: 3478,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { rfc: '8489', altPort: 5349 },
  },
  {
    scheme: 'stuns:',
    category: GatewayCategory.NAT,
    protocol: GatewayProtocolType.STUN,
    label: 'STUN (TLS)',
    isEncrypted: true,
    defaultPort: 5349,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { rfc: '8489', tls: true },
  },
  {
    scheme: 'turn:',
    category: GatewayCategory.NAT,
    protocol: GatewayProtocolType.TURN,
    label: 'TURN',
    isEncrypted: false,
    defaultPort: 3478,
    requiresAuth: true,
    supportsUDP: true,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { rfc: '8656', relay: true },
  },
  {
    scheme: 'turns:',
    category: GatewayCategory.NAT,
    protocol: GatewayProtocolType.TURN,
    label: 'TURN (TLS)',
    isEncrypted: true,
    defaultPort: 5349,
    requiresAuth: true,
    supportsUDP: true,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { rfc: '8656', relay: true, tls: true },
  },
  {
    scheme: 'ice:',
    category: GatewayCategory.NAT,
    protocol: GatewayProtocolType.ICE,
    label: 'ICE',
    isEncrypted: false,
    defaultPort: null,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { rfc: '8445', usesSTUN: true, usesTURN: true },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  NETWORK ACCESS GATEWAY PROTOCOLS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    scheme: 'captive:',
    category: GatewayCategory.Access,
    protocol: GatewayProtocolType.CaptivePortal,
    label: 'Captive Portal',
    isEncrypted: true,
    defaultPort: 443,
    requiresAuth: true,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { rfc: '8908', detection: 'HTTP-200/captive.apple.com' },
  },
  {
    scheme: 'radius:',
    category: GatewayCategory.Access,
    protocol: GatewayProtocolType.RADIUS,
    label: 'RADIUS',
    isEncrypted: false,
    defaultPort: 1812,
    requiresAuth: true,
    supportsUDP: true,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { rfc: '2865', accountingPort: 1813 },
  },
  {
    scheme: 'radiustls:',
    category: GatewayCategory.Access,
    protocol: GatewayProtocolType.RADIUS,
    label: 'RADIUS (TLS)',
    isEncrypted: true,
    defaultPort: 2083,
    requiresAuth: true,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { rfc: '6614', radsec: true },
  },
  {
    scheme: 'tacacs:',
    category: GatewayCategory.Access,
    protocol: GatewayProtocolType.TACACSPlus,
    label: 'TACACS+',
    isEncrypted: true,
    defaultPort: 49,
    requiresAuth: true,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { encryption: true },
  },
  {
    scheme: 'dot1x:',
    category: GatewayCategory.Access,
    protocol: GatewayProtocolType.IEEE8021X,
    label: '802.1X',
    isEncrypted: false,
    defaultPort: null,
    requiresAuth: true,
    supportsUDP: false,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { ieee: '802.1X-2010', eap: true },
  },
  {
    scheme: 'wispr:',
    category: GatewayCategory.Access,
    protocol: GatewayProtocolType.WISPr,
    label: 'WISPr',
    isEncrypted: true,
    defaultPort: 443,
    requiresAuth: true,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { version: '2.0', wifi: true },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  LOAD BALANCING PROTOCOLS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    scheme: 'health:',
    category: GatewayCategory.LoadBalancer,
    protocol: GatewayProtocolType.HealthCheck,
    label: 'Health Check',
    isEncrypted: false,
    defaultPort: null,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { methods: ['HTTP GET', 'TCP connect', 'ICMP'] },
  },
  {
    scheme: 'consul:',
    category: GatewayCategory.LoadBalancer,
    protocol: GatewayProtocolType.ConsulHealth,
    label: 'Consul Health',
    isEncrypted: true,
    defaultPort: 8500,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { serviceMesh: true },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  CDN GATEWAY PROTOCOLS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    scheme: 'cdn:',
    category: GatewayCategory.CDN,
    protocol: GatewayProtocolType.CDNEdge,
    label: 'CDN Edge',
    isEncrypted: true,
    defaultPort: 443,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { edgeCaching: true },
  },
  {
    scheme: 'cdn+push:',
    category: GatewayCategory.CDN,
    protocol: GatewayProtocolType.CDNPush,
    label: 'CDN Push',
    isEncrypted: true,
    defaultPort: 443,
    requiresAuth: true,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { direction: 'origin-to-edge' },
  },
  {
    scheme: 'cdn+pull:',
    category: GatewayCategory.CDN,
    protocol: GatewayProtocolType.CDNPull,
    label: 'CDN Pull',
    isEncrypted: true,
    defaultPort: 443,
    requiresAuth: false,
    supportsUDP: false,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { direction: 'edge-to-origin' },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  //  SERVICE DISCOVERY PROTOCOLS
  // ═══════════════════════════════════════════════════════════════════════════

  {
    scheme: 'ssdp:',
    category: GatewayCategory.Discovery,
    protocol: GatewayProtocolType.SSDP,
    label: 'SSDP',
    isEncrypted: false,
    defaultPort: 1900,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: false,
    remoteDNS: false,
    metadata: { rfc: null, multicast: '239.255.255.250' },
  },
  {
    scheme: 'bonjour:',
    category: GatewayCategory.Discovery,
    protocol: GatewayProtocolType.Bonjour,
    label: 'Bonjour',
    isEncrypted: false,
    defaultPort: 5353,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { apple: true, usesMDNS: true },
  },
  {
    scheme: 'avahi:',
    category: GatewayCategory.Discovery,
    protocol: GatewayProtocolType.Avahi,
    label: 'Avahi',
    isEncrypted: false,
    defaultPort: 5353,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { linux: true, usesMDNS: true },
  },
  {
    scheme: 'dnssd:',
    category: GatewayCategory.Discovery,
    protocol: GatewayProtocolType.DNSSD,
    label: 'DNS Service Discovery',
    isEncrypted: false,
    defaultPort: 5353,
    requiresAuth: false,
    supportsUDP: true,
    supportsTCP: true,
    remoteDNS: false,
    metadata: { rfc: '6763', usesMDNS: true },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class GatewayProtocolManager implements IGatewayProtocolManager {
  private readonly handlers = new Map<string, GatewayProtocolResult>();

  constructor() {
    for (const reg of BUILT_IN_GATEWAYS) {
      this.handlers.set(reg.scheme, {
        category:   reg.category,
        protocol:   reg.protocol,
        label:      reg.label,
        isEncrypted: reg.isEncrypted,
        defaultPort: reg.defaultPort,
        requiresAuth: reg.requiresAuth,
        supportsUDP:  reg.supportsUDP,
        supportsTCP:  reg.supportsTCP,
        remoteDNS:    reg.remoteDNS,
        metadata:     { ...reg.metadata },
      });
    }
  }

  resolve(url: string): GatewayProtocolResult | null {
    try {
      const u = new URL(url);
      return this.handlers.get(u.protocol) ?? null;
    } catch {
      return null;
    }
  }

  resolveScheme(scheme: string): GatewayProtocolResult | null {
    return this.handlers.get(scheme) ?? null;
  }

  isProxy(scheme: string): boolean {
    return this.handlers.get(scheme)?.category === GatewayCategory.Proxy;
  }

  isDNS(scheme: string): boolean {
    return this.handlers.get(scheme)?.category === GatewayCategory.DNS;
  }

  isTunnel(scheme: string): boolean {
    return this.handlers.get(scheme)?.category === GatewayCategory.Tunnel;
  }

  isNAT(scheme: string): boolean {
    return this.handlers.get(scheme)?.category === GatewayCategory.NAT;
  }

  isAccess(scheme: string): boolean {
    return this.handlers.get(scheme)?.category === GatewayCategory.Access;
  }

  isEncrypted(scheme: string): boolean {
    return this.handlers.get(scheme)?.isEncrypted ?? false;
  }

  register(registration: GatewayRegistration): boolean {
    const existed = this.handlers.has(registration.scheme);
    this.handlers.set(registration.scheme, {
      category:    registration.category,
      protocol:    registration.protocol,
      label:       registration.label,
      isEncrypted: registration.isEncrypted,
      defaultPort: registration.defaultPort,
      requiresAuth: registration.requiresAuth,
      supportsUDP:  registration.supportsUDP,
      supportsTCP:  registration.supportsTCP,
      remoteDNS:    registration.remoteDNS,
      metadata:     { ...registration.metadata },
    });
    return !existed;
  }

  unregister(scheme: string): boolean {
    return this.handlers.delete(scheme);
  }

  getSchemes(): readonly string[] {
    return [...this.handlers.keys()];
  }

  getSchemesByCategory(category: GatewayCategory): readonly string[] {
    const schemes: string[] = [];
    for (const [scheme, handler] of this.handlers) {
      if (handler.category === category) schemes.push(scheme);
    }
    return schemes;
  }

  getProxySchemes(): readonly string[] {
    return this.getSchemesByCategory(GatewayCategory.Proxy);
  }

  getDNSSchemes(): readonly string[] {
    return this.getSchemesByCategory(GatewayCategory.DNS);
  }

  getTunnelSchemes(): readonly string[] {
    return this.getSchemesByCategory(GatewayCategory.Tunnel);
  }

  getNATSchemes(): readonly string[] {
    return this.getSchemesByCategory(GatewayCategory.NAT);
  }

  getAccessSchemes(): readonly string[] {
    return this.getSchemesByCategory(GatewayCategory.Access);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GATEWAY CONFIGURATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default proxy configuration for the browser.
 */
interface ProxyConfig {
  /** HTTP proxy URL (e.g. "http://proxy:8080"). */
  readonly httpProxy: string | null;
  /** HTTPS proxy URL (e.g. "https://proxy:443"). */
  readonly httpsProxy: string | null;
  /** SOCKS5 proxy URL (e.g. "socks5://proxy:1080"). */
  readonly socksProxy: string | null;
  /** No-proxy list — hosts that bypass the proxy. */
  readonly noProxy: readonly string[];
  /** PAC file URL. */
  readonly pacUrl: string | null;
  /** Whether to use WPAD for auto-discovery. */
  readonly useWpad: boolean;
}

/**
 * Default DNS configuration for the browser.
 */
interface DnsConfig {
  /** Primary DNS server URL. */
  readonly primaryDns: string | null;
  /** Secondary DNS server URL. */
  readonly secondaryDns: string | null;
  /** DNS over HTTPS server URL. */
  readonly dohUrl: string | null;
  /** DNS over TLS server URL. */
  readonly dotUrl: string | null;
  /** DNS over QUIC server URL. */
  readonly doqUrl: string | null;
  /** Whether to use DNSSEC validation. */
  readonly useDnssec: boolean;
  /** Custom DNS suffixes. */
  readonly searchDomains: readonly string[];
}

/**
 * Default tunnel configuration for the browser.
 */
interface TunnelConfig {
  /** VPN type to use. */
  readonly vpnType: 'wireguard' | 'openvpn' | 'ipsec' | 'ikev2' | 'none';
  /** VPN server URL. */
  readonly vpnServer: string | null;
  /** Whether to auto-connect on untrusted networks. */
  readonly autoConnect: boolean;
}

const DEFAULT_PROXY_CONFIG: ProxyConfig = {
  httpProxy:   null,
  httpsProxy:  null,
  socksProxy:  null,
  noProxy:     ['localhost', '127.0.0.1', '::1'],
  pacUrl:      null,
  useWpad:     false,
};

const DEFAULT_DNS_CONFIG: DnsConfig = {
  primaryDns:    null,
  secondaryDns:  null,
  dohUrl:        null,
  dotUrl:        null,
  doqUrl:        null,
  useDnssec:     false,
  searchDomains: [],
};

const DEFAULT_TUNNEL_CONFIG: TunnelConfig = {
  vpnType:     'none',
  vpnServer:   null,
  autoConnect: false,
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  GatewayProtocolManager,
  GatewayCategory,
  GatewayProtocolType,
  UnknownGatewayProtocolError,
  GatewayConnectionError,
  BUILT_IN_GATEWAYS,
  DEFAULT_PROXY_CONFIG,
  DEFAULT_DNS_CONFIG,
  DEFAULT_TUNNEL_CONFIG,
};

export type {
  IGatewayProtocolManager,
  GatewayProtocolResult,
  GatewayRegistration,
  ProxyConfig,
  DnsConfig,
  TunnelConfig,
};
