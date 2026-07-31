/**
 * @file src/browser/networking/protocol-handler.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Central registry that maps every internet protocol scheme to its handler.
 *
 *   ProtocolHandlerRegistry
 *        │  resolve(scheme)
 *        ▼
 *   ProtocolHandlerResult
 *        │  type: "network" | "internal" | "external" | "blocked"
 *        ▼
 *   BrowserEngine uses the result type to decide:
 *     - network  → fetch via RequestManager / WebSocket / FTP
 *     - internal → render in-browser (data:, blob:, file:)
 *     - external → delegate to OS (mailto:, tel:, ssh:)
 *     - blocked  → refuse to navigate
 *
 * Protocols covered:
 *   Web:           http, https
 *   WebSocket:     ws, wss
 *   File Transfer: ftp, ftps, sftp
 *   Local:         file
 *   Internal:      data, blob, about, nova
 *   External:      mailto, tel, sms, smsto, ssh
 *   Torrent:       magnet
 *   Usenet:        news, nntp
 *   Deprecated:    gopher, wais
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OOP PRINCIPLES
 * ─────────────────────────────────────────────────────────────────────────────
 *  Abstraction      IProtocolHandlerRegistry hides the registry from callers.
 *  Encapsulation    All handler maps are private; callers use resolve() only.
 *  Single-Resp.     Only maps schemes to handler metadata — no fetching.
 *  Open / Closed    New protocols are added via register() without editing
 *                   the class itself.
 *  Dependency-Inv.  Receives no concrete dependencies; pure lookup service.
 */

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How the browser should handle a protocol.
 */
enum ProtocolHandlerType {
  /** Fetched over the network (HTTP, HTTPS, WS, WSS, FTP, FTPS, SFTP). */
  Network    = 'network',
  /** Rendered in-browser without network (data:, blob:, file:, about:, nova:). */
  Internal   = 'internal',
  /** Delegated to the OS or an external application (mailto:, tel:, ssh:). */
  External   = 'external',
  /** Never allowed (javascript:, vbscript:). */
  Blocked    = 'blocked',
}

/**
 * Specific transport type for network protocols.
 */
enum NetworkTransport {
  /** Standard HTTP/1.1 or HTTP/2 via fetch(). */
  HTTP       = 'http',
  /** WebSocket (RFC 6455). */
  WebSocket  = 'websocket',
  /** FTP / FTPS file transfer. */
  FTP        = 'ftp',
  /** SFTP over SSH. */
  SFTP       = 'sftp',
}

// ─────────────────────────────────────────────────────────────────────────────
// VALUE OBJECTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Describes how the browser should handle a given protocol scheme.
 */
interface ProtocolHandlerResult {
  /** The resolved handler type. */
  readonly type: ProtocolHandlerType;
  /** Human-readable label for the UI (e.g. "HTTPS", "WebSocket", "Email"). */
  readonly label: string;
  /** Whether connections using this protocol are encrypted. */
  readonly isEncrypted: boolean;
  /** Default port number, or null when the scheme has no conventional port. */
  readonly defaultPort: number | null;
  /** For network protocols, which transport to use. Null for non-network. */
  readonly transport: NetworkTransport | null;
  /** For external protocols, the OS scheme to open (e.g. "mailto:", "tel:"). */
  readonly externalScheme: string | null;
}

/**
 * Registration descriptor for a custom protocol handler.
 */
interface ProtocolRegistration {
  readonly scheme: string;
  readonly type: ProtocolHandlerType;
  readonly label: string;
  readonly isEncrypted: boolean;
  readonly defaultPort: number | null;
  readonly transport: NetworkTransport | null;
  readonly externalScheme: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CONTRACT
// ─────────────────────────────────────────────────────────────────────────────

interface IProtocolHandlerRegistry {
  /**
   * Resolve a protocol scheme to its handler metadata.
   * @param scheme  Protocol including trailing colon, e.g. "https:"
   * @returns The handler result, or null if scheme is unknown.
   */
  resolve(scheme: string): ProtocolHandlerResult | null;

  /** True when the scheme is registered as blocked. */
  isBlocked(scheme: string): boolean;

  /** True when the scheme is registered and not blocked. */
  isAllowed(scheme: string): boolean;

  /** True when the scheme uses an encrypted transport. */
  isEncrypted(scheme: string): boolean;

  /**
   * Register or override a protocol handler.
   * @returns true if this is a new registration, false if it replaced an existing one.
   */
  register(registration: ProtocolRegistration): boolean;

  /** Remove a protocol handler by scheme. Returns true if it existed. */
  unregister(scheme: string): boolean;

  /** Return all registered schemes. */
  getSchemes(): readonly string[];

  /** Return all blocked schemes. */
  getBlockedSchemes(): readonly string[];

  /** Return all allowed (non-blocked) schemes. */
  getAllowedSchemes(): readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR CLASSES
// ─────────────────────────────────────────────────────────────────────────────

class UnknownProtocolError extends Error {
  readonly scheme: string;
  constructor(scheme: string) {
    super(`Unknown protocol scheme: "${scheme}". No handler registered.`);
    this.name = 'UnknownProtocolError';
    this.scheme = scheme;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class BlockedProtocolHandlerError extends Error {
  readonly scheme: string;
  constructor(scheme: string) {
    super(`Protocol "${scheme}" is blocked and cannot be handled.`);
    this.name = 'BlockedProtocolHandlerError';
    this.scheme = scheme;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILT-IN PROTOCOL REGISTRATIONS
// ─────────────────────────────────────────────────────────────────────────────

const BUILT_IN_PROTOCOLS: readonly ProtocolRegistration[] = [
  // ── Web protocols ─────────────────────────────────────────────────────────
  {
    scheme: 'http:',
    type: ProtocolHandlerType.Network,
    label: 'HTTP',
    isEncrypted: false,
    defaultPort: 80,
    transport: NetworkTransport.HTTP,
    externalScheme: null,
  },
  {
    scheme: 'https:',
    type: ProtocolHandlerType.Network,
    label: 'HTTPS',
    isEncrypted: true,
    defaultPort: 443,
    transport: NetworkTransport.HTTP,
    externalScheme: null,
  },

  // ── WebSocket protocols ───────────────────────────────────────────────────
  {
    scheme: 'ws:',
    type: ProtocolHandlerType.Network,
    label: 'WebSocket',
    isEncrypted: false,
    defaultPort: 80,
    transport: NetworkTransport.WebSocket,
    externalScheme: null,
  },
  {
    scheme: 'wss:',
    type: ProtocolHandlerType.Network,
    label: 'WebSocket Secure',
    isEncrypted: true,
    defaultPort: 443,
    transport: NetworkTransport.WebSocket,
    externalScheme: null,
  },

  // ── File transfer protocols ───────────────────────────────────────────────
  {
    scheme: 'ftp:',
    type: ProtocolHandlerType.Network,
    label: 'FTP',
    isEncrypted: false,
    defaultPort: 21,
    transport: NetworkTransport.FTP,
    externalScheme: null,
  },
  {
    scheme: 'ftps:',
    type: ProtocolHandlerType.Network,
    label: 'FTPS',
    isEncrypted: true,
    defaultPort: 990,
    transport: NetworkTransport.FTP,
    externalScheme: null,
  },
  {
    scheme: 'sftp:',
    type: ProtocolHandlerType.Network,
    label: 'SFTP',
    isEncrypted: true,
    defaultPort: 22,
    transport: NetworkTransport.SFTP,
    externalScheme: null,
  },

  // ── Local file protocol ───────────────────────────────────────────────────
  {
    scheme: 'file:',
    type: ProtocolHandlerType.Internal,
    label: 'Local File',
    isEncrypted: true,
    defaultPort: null,
    transport: null,
    externalScheme: null,
  },

  // ── Internal protocols ────────────────────────────────────────────────────
  {
    scheme: 'data:',
    type: ProtocolHandlerType.Internal,
    label: 'Data URI',
    isEncrypted: true,
    defaultPort: null,
    transport: null,
    externalScheme: null,
  },
  {
    scheme: 'blob:',
    type: ProtocolHandlerType.Internal,
    label: 'Blob',
    isEncrypted: true,
    defaultPort: null,
    transport: null,
    externalScheme: null,
  },
  {
    scheme: 'about:',
    type: ProtocolHandlerType.Internal,
    label: 'About',
    isEncrypted: true,
    defaultPort: null,
    transport: null,
    externalScheme: null,
  },
  {
    scheme: 'nova:',
    type: ProtocolHandlerType.Internal,
    label: 'Nova',
    isEncrypted: true,
    defaultPort: null,
    transport: null,
    externalScheme: null,
  },

  // ── External handler protocols ────────────────────────────────────────────
  {
    scheme: 'mailto:',
    type: ProtocolHandlerType.External,
    label: 'Email',
    isEncrypted: true,
    defaultPort: null,
    transport: null,
    externalScheme: 'mailto:',
  },
  {
    scheme: 'tel:',
    type: ProtocolHandlerType.External,
    label: 'Telephone',
    isEncrypted: true,
    defaultPort: null,
    transport: null,
    externalScheme: 'tel:',
  },
  {
    scheme: 'sms:',
    type: ProtocolHandlerType.External,
    label: 'SMS',
    isEncrypted: true,
    defaultPort: null,
    transport: null,
    externalScheme: 'sms:',
  },
  {
    scheme: 'smsto:',
    type: ProtocolHandlerType.External,
    label: 'SMS',
    isEncrypted: true,
    defaultPort: null,
    transport: null,
    externalScheme: 'sms:',
  },
  {
    scheme: 'ssh:',
    type: ProtocolHandlerType.External,
    label: 'SSH',
    isEncrypted: true,
    defaultPort: 22,
    transport: null,
    externalScheme: 'ssh:',
  },

  // ── Torrent protocol ──────────────────────────────────────────────────────
  {
    scheme: 'magnet:',
    type: ProtocolHandlerType.External,
    label: 'Magnet Link',
    isEncrypted: true,
    defaultPort: null,
    transport: null,
    externalScheme: 'magnet:',
  },

  // ── Usenet protocols ──────────────────────────────────────────────────────
  {
    scheme: 'news:',
    type: ProtocolHandlerType.Network,
    label: 'Usenet',
    isEncrypted: false,
    defaultPort: 119,
    transport: NetworkTransport.HTTP,
    externalScheme: null,
  },
  {
    scheme: 'nntp:',
    type: ProtocolHandlerType.Network,
    label: 'NNTP',
    isEncrypted: false,
    defaultPort: 119,
    transport: NetworkTransport.HTTP,
    externalScheme: null,
  },

  // ── Legacy protocols ──────────────────────────────────────────────────────
  {
    scheme: 'gopher:',
    type: ProtocolHandlerType.Network,
    label: 'Gopher',
    isEncrypted: false,
    defaultPort: 70,
    transport: NetworkTransport.HTTP,
    externalScheme: null,
  },
  {
    scheme: 'wais:',
    type: ProtocolHandlerType.Network,
    label: 'WAIS',
    isEncrypted: false,
    defaultPort: 210,
    transport: NetworkTransport.HTTP,
    externalScheme: null,
  },

  // ── Blocked protocols ─────────────────────────────────────────────────────
  {
    scheme: 'javascript:',
    type: ProtocolHandlerType.Blocked,
    label: 'JavaScript',
    isEncrypted: false,
    defaultPort: null,
    transport: null,
    externalScheme: null,
  },
  {
    scheme: 'vbscript:',
    type: ProtocolHandlerType.Blocked,
    label: 'VBScript',
    isEncrypted: false,
    defaultPort: null,
    transport: null,
    externalScheme: null,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CONCRETE IMPLEMENTATION
// ─────────────────────────────────────────────────────────────────────────────

class ProtocolHandlerRegistry implements IProtocolHandlerRegistry {
  private readonly handlers = new Map<string, ProtocolHandlerResult>();

  constructor() {
    for (const reg of BUILT_IN_PROTOCOLS) {
      this.handlers.set(reg.scheme, { ...reg });
    }
  }

  resolve(scheme: string): ProtocolHandlerResult | null {
    return this.handlers.get(scheme) ?? null;
  }

  isBlocked(scheme: string): boolean {
    const h = this.handlers.get(scheme);
    return h?.type === ProtocolHandlerType.Blocked;
  }

  isAllowed(scheme: string): boolean {
    const h = this.handlers.get(scheme);
    return h !== undefined && h.type !== ProtocolHandlerType.Blocked;
  }

  isEncrypted(scheme: string): boolean {
    return this.handlers.get(scheme)?.isEncrypted ?? false;
  }

  register(registration: ProtocolRegistration): boolean {
    const existed = this.handlers.has(registration.scheme);
    this.handlers.set(registration.scheme, { ...registration });
    return !existed;
  }

  unregister(scheme: string): boolean {
    return this.handlers.delete(scheme);
  }

  getSchemes(): readonly string[] {
    return [...this.handlers.keys()];
  }

  getBlockedSchemes(): readonly string[] {
    const blocked: string[] = [];
    for (const [scheme, handler] of this.handlers) {
      if (handler.type === ProtocolHandlerType.Blocked) blocked.push(scheme);
    }
    return blocked;
  }

  getAllowedSchemes(): readonly string[] {
    const allowed: string[] = [];
    for (const [scheme, handler] of this.handlers) {
      if (handler.type !== ProtocolHandlerType.Blocked) allowed.push(scheme);
    }
    return allowed;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PROTOCOL CONSTANTS (derived from registry for backward compatibility)
// ─────────────────────────────────────────────────────────────────────────────

/** All scheme strings that are allowed for navigation (non-blocked). */
function buildAllowedProtocols(): Set<string> {
  const set = new Set<string>();
  for (const reg of BUILT_IN_PROTOCOLS) {
    if (reg.type !== ProtocolHandlerType.Blocked) {
      set.add(reg.scheme);
    }
  }
  return set;
}

/** All scheme strings that are permanently blocked. */
function buildBlockedProtocols(): Set<string> {
  const set = new Set<string>();
  for (const reg of BUILT_IN_PROTOCOLS) {
    if (reg.type === ProtocolHandlerType.Blocked) {
      set.add(reg.scheme);
    }
  }
  return set;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

export {
  ProtocolHandlerRegistry,
  ProtocolHandlerType,
  NetworkTransport,
  UnknownProtocolError,
  BlockedProtocolHandlerError,
  buildAllowedProtocols,
  buildBlockedProtocols,
  BUILT_IN_PROTOCOLS,
};

export type {
  IProtocolHandlerRegistry,
  ProtocolHandlerResult,
  ProtocolRegistration,
};
