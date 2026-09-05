/**
 * @file src/browser/networking/socket-owner.ts
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RESPONSIBILITY
 * ─────────────────────────────────────────────────────────────────────────────
 * Owns every live `net.Socket`/`tls.TLSSocket` on behalf of a renderer. The
 * renderer drives sockets exclusively through the socket-proxy wire; this
 * class is the terminal that holds the real sockets.
 *
 * Under `contextIsolation: true` in Electron this class runs in the main
 * process (see `electron/socket-owner.cjs`, Phase 5). The same implementation
 * backs the in-process default used by tests and non-bridged runtimes: here it
 * lives in the same JS context as the renderer modules, but the wire protocol
 * is identical, so the migration to the real process boundary is transparent.
 *
 * Socket events are pushed to the renderer as {@link SocketEventFrame}s over
 * the same channel, keyed by the socket id topic.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { loadNodeBuiltin } from './node-builtins';
import { toArrayBuffer, type SocketEventFrame, type SocketEventType } from './socket-handle';

/** Request payloads (renderer → owner). */
interface OpenTcpMessage { readonly kind: 'open-tcp'; readonly socketId: string; readonly host: string; readonly port: number; readonly tls: boolean; }
interface WriteMessage { readonly kind: 'write'; readonly socketId: string; readonly bytes: ArrayBuffer; }
interface SocketMessage { readonly kind: 'destroy' | 'get-peer-certificate'; readonly socketId: string; }
interface UpgradeTlsMessage { readonly kind: 'upgrade-tls'; readonly socketId: string; readonly servername: string; }

type OwnerRequest =
  | OpenTcpMessage
  | WriteMessage
  | SocketMessage
  | UpgradeTlsMessage
  | { readonly kind: string; readonly socketId?: string };

/** The owner needs send + onRequest from the renderer-facing channel. */
interface OwnerChannel {
  onRequest(handler: (payload: unknown) => Promise<unknown>): void;
  send(topicOrPayload: unknown, maybePayload?: unknown): Promise<void>;
}

interface OwnedSocket {
  /** Either a raw `net.Socket` or a `tls.TLSSocket` after a TLS upgrade. */
  socket: import('node:net').Socket | import('node:tls').TLSSocket;
}

const WIRE_EVENTS: readonly SocketEventType[] = ['data', 'error', 'end', 'close', 'connect', 'secureConnect'];

/** Terminal that owns real net/tls sockets reached through the proxy wire. */
export class SocketOwner {
  private readonly sockets = new Map<string, OwnedSocket>();

  constructor(private readonly channel: OwnerChannel) {
    this.channel.onRequest((payload) => this.route(payload));
  }

  private async route(payload: unknown): Promise<unknown> {
    if (payload === null || typeof payload !== 'object') {
      throw new Error('socket-owner: malformed request payload');
    }
    const msg = payload as OwnerRequest;
    switch (msg.kind) {
      case 'open-tcp': return this.openTcp(payload as OpenTcpMessage);
      case 'write': return this.write(payload as WriteMessage);
      case 'destroy': return this.destroy(payload as SocketMessage);
      case 'get-peer-certificate': return this.getPeerCertificate(payload as SocketMessage);
      case 'upgrade-tls': return this.upgradeTls(payload as UpgradeTlsMessage);
      default: throw new Error(`socket-owner: unknown rpc '${String(msg.kind)}'`);
    }
  }

  private openTcp(msg: OpenTcpMessage): { ok: true } {
    const net = loadNodeBuiltin<typeof import('node:net')>('node:net');
    if (!net) {
      throw new Error('socket-owner: node:net is unavailable in this runtime');
    }
    const tls = msg.tls ? loadNodeBuiltin<typeof import('node:tls')>('node:tls') : null;
    if (msg.tls && !tls) {
      throw new Error('socket-owner: node:tls is unavailable in this runtime');
    }
    const socket = msg.tls
      ? tls!.connect({
          host: msg.host,
          port: msg.port,
          servername: ipOrUndefined(msg.host),
          rejectUnauthorized: false,
        })
      : net.connect({ host: msg.host, port: msg.port });
    this.sockets.set(msg.socketId, { socket });
    this.wire(msg.socketId, socket);
    return { ok: true };
  }

  /** Attach owner-side listeners that translate socket events into pushes. */
  private wire(socketId: string, socket: import('node:net').Socket | import('node:tls').TLSSocket): void {
    socket.on('data', (chunk: Uint8Array) => {
      this.push(socketId, { evt: 'data', bytes: toArrayBuffer(chunk) });
    });
    socket.on('error', (err: Error) => {
      this.push(socketId, { evt: 'error', error: err });
    });
    socket.on('end', () => {
      this.push(socketId, { evt: 'end' });
    });
    socket.on('close', () => {
      this.push(socketId, { evt: 'close' });
    });
    socket.on('connect', () => {
      this.push(socketId, { evt: 'connect' });
    });
    socket.on('secureConnect', () => {
      this.push(socketId, { evt: 'secureConnect' });
    });
  }

  /** Drop our listeners (the socket is being destroyed or TLS-wrapped). */
  private unwire(_socketId: string, socket: import('node:net').Socket | import('node:tls').TLSSocket): void {
    for (const evt of WIRE_EVENTS) {
      socket.removeAllListeners(evt);
    }
  }

  /** Fire-and-forget event push. A released socket id drops the message. */
  private push(socketId: string, frame: SocketEventFrame): void {
    void this.channel.send(socketId, frame).catch(() => { /* released socket */ });
  }

  private require(msg: { socketId: string }): OwnedSocket {
    const entry = this.sockets.get(msg.socketId);
    if (!entry) {
      throw new Error(`socket-owner: unknown socket '${msg.socketId}'`);
    }
    return entry;
  }

  private async write(msg: WriteMessage): Promise<{ ok: true }> {
    const entry = this.require(msg);
    await new Promise<void>((resolve, reject) => {
      entry.socket.write(Buffer.from(msg.bytes), (err?: Error | null) => {
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
    return { ok: true };
  }

  private destroy(msg: SocketMessage): { ok: true } {
    const entry = this.sockets.get(msg.socketId);
    this.sockets.delete(msg.socketId);
    if (entry) {
      this.unwire(msg.socketId, entry.socket);
      entry.socket.destroy();
    }
    return { ok: true };
  }

  private getPeerCertificate(msg: SocketMessage): { certificate: CertificateWire | null } {
    const entry = this.require(msg);
    const peerCert = (entry.socket as import('node:tls').TLSSocket).getPeerCertificate;
    if (typeof peerCert !== 'function') return { certificate: null };
    const raw = peerCert.call(entry.socket, true) as PeerCertificateLike | null;
    if (!raw) {
      return { certificate: null };
    }
    const chain = encodeCertificateChain(raw);
    const certificate = chain.length > 0 ? { ...chain[0], chain } : null;
    return { certificate };
  }

  private upgradeTls(msg: UpgradeTlsMessage): { ok: true } {
    const entry = this.require(msg);
    const tls = loadNodeBuiltin<typeof import('node:tls')>('node:tls');
    if (!tls) {
      throw new Error('socket-owner: node:tls is unavailable in this runtime');
    }
    // The raw socket's stream is taken over by the TLS layer, so our own data
    // listeners would see ciphertext. Drop every listener before wrapping.
    this.unwire(msg.socketId, entry.socket);
    const tlsSocket = tls.connect({
      socket: entry.socket,
      servername: ipOrUndefined(msg.servername),
      rejectUnauthorized: false,
    });
    entry.socket = tlsSocket;
    this.wire(msg.socketId, tlsSocket);
    return { ok: true };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CERTIFICATE WIRE ENCODING
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal shape of the object returned by `tls.TLSSocket.getPeerCertificate`. */
interface PeerCertificateLike {
  subject?: { CN?: string; [k: string]: unknown };
  issuer?: { CN?: string; [k: string]: unknown };
  subjectaltname?: string;
  valid_from?: string;
  valid_to?: string;
  serialNumber?: string;
  fingerprint?: string;
  fingerprint256?: string;
  sigalg?: string;
  pubkey?: { asymmetricKeyType?: string; asymmetricKeySize?: number };
  basicConstraints?: { CA?: boolean } | null;
  issuerCertificate?: PeerCertificateLike | null;
}

/**
 * Wire-safe view of one certificate in a chain. `node:getPeerCertificate(true)`
 * links `issuerCertificate` back to itself for self-signed/root certificates,
 * which the IPC serializer cannot encode — so the chain is flattened here, on
 * the main side, into plain primitive objects with the cycle replaced by an
 * ordered sibling `chain` array (leaf first).
 */
interface CertificateWire {
  subject?: { CN?: string; [k: string]: unknown };
  issuer?: { CN?: string; [k: string]: unknown };
  subjectaltname?: string;
  valid_from?: string;
  valid_to?: string;
  serialNumber?: string;
  fingerprint?: string;
  fingerprint256?: string;
  sigalg?: string;
  pubkeyAlgorithm?: string;
  keySize?: number;
  basicConstraints?: { CA?: boolean } | null;
  chain: CertificateWire[];
}

function encodeCertificateChain(raw: PeerCertificateLike): CertificateWire[] {
  const wire = (cert: PeerCertificateLike): CertificateWire => ({
    subject: cert.subject ?? undefined,
    issuer: cert.issuer ?? undefined,
    subjectaltname: cert.subjectaltname ?? undefined,
    valid_from: cert.valid_from ?? undefined,
    valid_to: cert.valid_to ?? undefined,
    serialNumber: cert.serialNumber ?? undefined,
    fingerprint: cert.fingerprint ?? undefined,
    fingerprint256: cert.fingerprint256 ?? undefined,
    sigalg: cert.sigalg ?? undefined,
    pubkeyAlgorithm: cert.pubkey?.asymmetricKeyType ?? undefined,
    keySize: cert.pubkey?.asymmetricKeySize ?? undefined,
    basicConstraints: cert.basicConstraints ?? undefined,
    chain: [],
  });

  const chain: CertificateWire[] = [];
  const seen = new Set<PeerCertificateLike>();
  let current: PeerCertificateLike | null = raw;
  while (current && !seen.has(current)) {
    seen.add(current);
    chain.push(wire(current));
    current = current.issuerCertificate ?? null;
  }
  return chain;
}

/**
 * `tls.connect` rejects numeric IP literals as `servername` (RFC 6066 forbids
 * IPs in SNI). Pass the host only when it looks like a DNS name.
 */
function ipOrUndefined(host: string): string | undefined {
  return host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? undefined : host;
}