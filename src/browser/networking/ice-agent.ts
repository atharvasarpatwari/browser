/**
 * @file src/browser/networking/ice-agent.ts
 *
 * A simplified ICE agent (RFC 8445 subset) for WebRTC — real UDP candidate
 * gathering and real STUN connectivity checks between two Nova peers.
 *
 * What's real: host candidates (actual local interface addresses via
 * `node:os`), server-reflexive candidates (a real STUN Binding Request to a
 * public STUN server over a real UDP socket via `node:dgram`), and
 * connectivity checks (real STUN Binding Requests exchanged directly with
 * the remote peer's candidates — the same mechanism, reused, per RFC 8445).
 *
 * What's simplified vs. full RFC 8445: single component (data channel only —
 * no separate RTP/RTCP components), no TURN/relay candidates, no full
 * candidate-pair priority/nomination state machine — candidates are tried in
 * priority order and the first pair that answers a connectivity check is
 * selected. See doc/webrtc-implementation-plan.md for what's deferred and
 * why.
 */

import { loadNodeBuiltin } from './node-builtins';
import { stunBindingRequest, respondToBindingRequest, decodeStunMessage, StunMessageType, type StunAddress } from './stun-client';

type DgramModule = typeof import('node:dgram');
type UdpSocket = ReturnType<DgramModule['createSocket']>;
type OsModule = typeof import('node:os');

export type IceCandidateType = 'host' | 'srflx';

export interface IceCandidate {
  readonly foundation: string;
  readonly component: 1;
  readonly protocol: 'udp';
  readonly priority: number;
  readonly ip: string;
  readonly port: number;
  readonly type: IceCandidateType;
  readonly relatedAddress?: string;
  readonly relatedPort?: number;
}

export class IceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IceError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Priority (RFC 8445 §5.1.2.1, simplified — single interface/component) ──

const TYPE_PREFERENCE: Record<IceCandidateType, number> = { host: 126, srflx: 100 };

function computePriority(type: IceCandidateType, localPreference: number): number {
  return (TYPE_PREFERENCE[type] << 24) | (localPreference << 8) | (256 - 1);
}

let foundationCounter = 1;
function nextFoundation(): string {
  return String(foundationCounter++);
}

// ── SDP candidate line (RFC 5245/8839 a=candidate syntax) ───────────────────

export function formatCandidateSdp(c: IceCandidate): string {
  let line = `candidate:${c.foundation} ${c.component} ${c.protocol} ${c.priority} ${c.ip} ${c.port} typ ${c.type}`;
  if (c.type === 'srflx' && c.relatedAddress && c.relatedPort !== undefined) {
    line += ` raddr ${c.relatedAddress} rport ${c.relatedPort}`;
  }
  return line;
}

export function parseCandidateSdp(line: string): IceCandidate | null {
  const body = line.startsWith('candidate:') ? line.slice('candidate:'.length) : line.replace(/^a=candidate:/, '');
  const parts = body.trim().split(/\s+/);
  if (parts.length < 8) return null;
  const [foundation, componentStr, protocol, priorityStr, ip, portStr, typKeyword, type] = parts;
  if (typKeyword !== 'typ' || (type !== 'host' && type !== 'srflx')) return null;
  if (protocol!.toLowerCase() !== 'udp') return null;

  const candidate: IceCandidate = {
    foundation: foundation!,
    component: 1,
    protocol: 'udp',
    priority: Number(priorityStr),
    ip: ip!,
    port: Number(portStr),
    type: type as IceCandidateType,
  };

  const raddrIdx = parts.indexOf('raddr');
  const rportIdx = parts.indexOf('rport');
  if (raddrIdx !== -1 && rportIdx !== -1) {
    return { ...candidate, relatedAddress: parts[raddrIdx + 1], relatedPort: Number(parts[rportIdx + 1]) };
  }
  return candidate;
}

// ── ICE Agent ─────────────────────────────────────────────────────────────

export interface IceAgentOptions {
  /** Public STUN server used to discover a server-reflexive candidate. Omit to gather host candidates only (fine for two peers on the same LAN). */
  stunServer?: { host: string; port: number };
}

export type IceDataHandler = (data: Buffer) => void;

/**
 * Owns one UDP socket for the lifetime of a peer connection's data path.
 * That single socket is used for: outbound STUN (gathering + connectivity
 * checks), inbound STUN (answering the remote peer's own checks), and — once
 * a pair is selected — the data channel's application traffic, demuxed from
 * STUN by decodeStunMessage's magic-cookie check (RFC 5389 §7.3 dictates
 * exactly this kind of demuxing is safe).
 */
export class IceAgent {
  private socket: UdpSocket | null = null;
  private readonly options: IceAgentOptions;
  private localCandidates: IceCandidate[] = [];
  private selectedRemote: IceCandidate | null = null;
  private dataHandler: IceDataHandler | null = null;
  private closed = false;

  constructor(options: IceAgentOptions = {}) {
    this.options = options;
  }

  /** Set the handler for non-STUN datagrams received after a pair is selected — this is how rtc-api.ts's RTCDataChannel receives bytes. */
  onData(handler: IceDataHandler | null): void {
    this.dataHandler = handler;
  }

  get boundPort(): number | null {
    return this.socket ? this.socket.address().port : null;
  }

  /** Binds the UDP socket and gathers host + (optionally) server-reflexive candidates. Safe to call once per agent. */
  async gather(): Promise<IceCandidate[]> {
    const dgram = loadNodeBuiltin<DgramModule>('node:dgram');
    if (!dgram) throw new IceError('Node dgram builtin is unavailable in this runtime');

    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (msg: Buffer, rinfo: { address: string; port: number }) => this.handleMessage(msg, rinfo));
    // Persistent error handler: without one, a dgram 'error' event on a socket
    // this agent owns would throw as an uncaught exception and crash the whole
    // process. Individual failures (a send to an unreachable peer, etc.) are
    // non-fatal to the agent's other candidates, so swallow them here and let
    // the caller's own checks surface connectivity problems.
    this.socket.on('error', () => {
      /* non-fatal socket error — keep the agent running */
    });

    const bindResult: Error | null = await new Promise<Error | null>((resolve) => {
      const onBindError = (err: Error) => resolve(err);
      this.socket!.once('error', onBindError);
      this.socket!.bind(0, () => {
        this.socket!.removeListener('error', onBindError);
        resolve(null);
      });
    });

    if (bindResult) {
      // Leave the agent in a clean state: release the (possibly half-bound)
      // socket so a later close()/checkConnectivity() isn't operating on a
      // broken one, then surface the bind failure.
      this.close();
      throw new IceError(`Failed to bind ICE socket: ${bindResult.message}`);
    }
    if (!this.boundPort) {
      this.close();
      throw new IceError('Failed to determine the bound ICE port');
    }

    const port = this.boundPort;
    const candidates: IceCandidate[] = [];

    for (const ip of this.listLocalIpv4Addresses()) {
      candidates.push({
        foundation: nextFoundation(),
        component: 1,
        protocol: 'udp',
        priority: computePriority('host', 65535),
        ip,
        port,
        type: 'host',
      });
    }

    if (this.options.stunServer) {
      try {
        const mapped = await stunBindingRequest(this.socket, this.options.stunServer.host, this.options.stunServer.port);
        const related = candidates.find((c) => c.type === 'host')?.ip ?? '0.0.0.0';
        candidates.push(this.srflxCandidateFrom(mapped, related, port));
      } catch {
        // Server-reflexive discovery failing (offline, blocked UDP, unreachable
        // STUN server) isn't fatal — host candidates alone still let two peers
        // on the same LAN (or with one behind no NAT) connect.
      }
    }

    this.localCandidates = candidates;
    return candidates;
  }

  private srflxCandidateFrom(mapped: StunAddress, relatedAddress: string, relatedPort: number): IceCandidate {
    return {
      foundation: nextFoundation(),
      component: 1,
      protocol: 'udp',
      priority: computePriority('srflx', 65535),
      ip: mapped.address,
      port: mapped.port,
      type: 'srflx',
      relatedAddress,
      relatedPort,
    };
  }

  private listLocalIpv4Addresses(): string[] {
    const os = loadNodeBuiltin<OsModule>('node:os');
    if (!os) return [];
    const results: string[] = [];
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] ?? []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          results.push(iface.address);
        }
      }
    }
    return results;
  }

  /**
   * Tries remote candidates in priority order, sending a real STUN Binding
   * Request to each over the same bound socket. The first candidate to
   * answer is selected as the pair for the data channel. Throws if none
   * answer within their retry budget — the caller (RTCPeerConnection) should
   * surface this as `iceConnectionState = 'failed'`.
   */
  async checkConnectivity(remoteCandidates: readonly IceCandidate[]): Promise<IceCandidate> {
    if (!this.socket) throw new IceError('checkConnectivity called before gather()');
    if (remoteCandidates.length === 0) throw new IceError('No remote candidates to check');

    const ordered = [...remoteCandidates].sort((a, b) => b.priority - a.priority);
    const errors: string[] = [];

    for (const candidate of ordered) {
      try {
        await stunBindingRequest(this.socket, candidate.ip, candidate.port, { timeoutMs: 300, retries: 2 });
        this.selectedRemote = candidate;
        return candidate;
      } catch (err) {
        errors.push(`${candidate.ip}:${candidate.port} — ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    throw new IceError(`No candidate pair became reachable:\n${errors.join('\n')}`);
  }

  /** Sends raw application data to the selected pair. Throws if no pair has been selected yet. */
  send(data: Buffer): void {
    if (!this.socket || !this.selectedRemote) {
      throw new IceError('Cannot send before a candidate pair is selected');
    }
    this.socket.send(data, this.selectedRemote.port, this.selectedRemote.ip);
  }

  get selectedPair(): IceCandidate | null {
    return this.selectedRemote;
  }

  private handleMessage(msg: Buffer, rinfo: { address: string; port: number }): void {
    const stun = decodeStunMessage(msg);
    if (stun) {
      // Answer inbound connectivity checks from the remote peer. Responses to
      // OUR outbound requests are consumed by stunBindingRequest's own
      // temporary listener (matched by transaction ID) and never reach here
      // as unhandled — but a stray/duplicate response is harmless to ignore.
      if (stun.type === StunMessageType.BindingRequest && !this.closed) {
        respondToBindingRequest(this.socket!, stun, rinfo);
      }
      return;
    }
    if (this.dataHandler) this.dataHandler(msg);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.socket) {
      try { this.socket.close(); } catch { /* already closed */ }
      this.socket = null;
    }
  }
}
