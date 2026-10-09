/**
 * @file src/browser/js/rtc-api.ts
 *
 * WebRTC — `RTCPeerConnection` + `RTCDataChannel`, exposed to page JavaScript
 * as `window.RTCPeerConnection`. Real ICE/STUN candidate gathering and
 * connectivity over real UDP sockets (../networking/ice-agent.ts), real DTLS
 * 1.2 (../networking/dtls/) for the encrypted record layer, and real SCTP
 * (../networking/sctp-transport.ts) for the reliable multiplexed stream
 * transport DCEP (RFC 8832) negotiates data channels over — replacing the
 * Phase 1 `ReliableChannel` (unencrypted, Nova-specific stop-and-wait, one
 * channel only, `m=NOVA/DATACHANNEL`).
 *
 * HONEST SCOPE — read before assuming this interoperates with a real browser:
 *   - ICE candidate gathering/exchange and connectivity checks are real STUN
 *     over real UDP (RFC 5389/8445 subset — see ice-agent.ts for exactly
 *     what's simplified: single component, no TURN, no STUN
 *     message-integrity/authentication).
 *   - DTLS is real RFC 6347/RFC 5288 (ECDHE-ECDSA-AES128-GCM-SHA256 only);
 *     SCTP is real RFC 4960 (see sctp-transport.ts for its own documented
 *     simplifications: no fast-retransmit, no congestion control, no chunk
 *     bundling). Two Nova instances negotiate and exchange data over this
 *     real stack today. Real-browser interop (Chrome/Firefox/etc.) is the
 *     Phase 2.4 gate — not yet run.
 *   - No audio/video. `getUserMedia`/`MediaStream`/SRTP are not implemented
 *     — this file is data-channel only.
 *   - No TURN relay — only host + server-reflexive candidates, so peers
 *     behind symmetric NAT with no STUN-friendly path won't connect.
 *   - No RFC 6525 stream reset — closing a data channel is local-only
 *     bookkeeping; the SCTP stream itself is never formally torn down.
 *
 * Follows the JS-global registration pattern from websocket-api.ts: a
 * constructor built via createObject(null)/callable:true/nativeFn, wired
 * into createGlobalEnv() in index.ts.
 */

import type { JSValue, JSObject, JSFunction } from './values';
import { createObject, createNativeFunction, toString, callJSFunction } from './values';
import type { EventLoop } from './event-loop';
import { createWiredPromise, fulfillPromise, rejectPromise } from './promise';
import {
  IceAgent,
  IceError,
  formatCandidateSdp,
  parseCandidateSdp,
  type IceCandidate,
} from '../networking/ice-agent';
import { writeUInt16BE, readUInt16BE, decodeUtf8, encodeUtf8 } from '../networking/byte-codecs';
import { DtlsEndpoint, type DtlsRole } from '../networking/dtls/dtls-handshake';
import { generateSelfSignedP256Cert, type SelfSignedCert } from '../networking/dtls/x509-der';
import { SctpAssociation, PPID_DCEP, PPID_WEBRTC_STRING, type SctpRole } from '../networking/sctp-transport';

// ── Small local helpers (mirrors websocket-api.ts's own copies) ────────────

function setProp(obj: JSObject, name: string, value: JSValue, writable = true, enumerable = true): void {
  obj.properties.set(name, { value, writable, enumerable, configurable: true });
}

function getProp(obj: JSObject, name: string): JSValue | undefined {
  return obj.properties.get(name)?.value;
}

function createEventObject(type: string, extra?: Record<string, JSValue>): JSObject {
  const e = createObject(null);
  e.properties.set('type', { value: type, writable: false, enumerable: true, configurable: false });
  e.properties.set('bubbles', { value: false, writable: false, enumerable: true, configurable: false });
  e.properties.set('cancelable', { value: false, writable: false, enumerable: true, configurable: false });
  e.properties.set('timestamp', { value: Date.now(), writable: false, enumerable: true, configurable: false });
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      e.properties.set(k, { value: v, writable: false, enumerable: true, configurable: false });
    }
  }
  return e;
}

class DOMException extends Error {
  constructor(message?: string, name?: string) {
    super(message);
    this.name = name ?? 'DOMException';
  }
}

function isClosure(v: JSValue | undefined): v is JSFunction {
  return typeof v === 'object' && v !== null && (v as { type?: string }).type === 'closure';
}

function emitHandlerEvent(obj: JSObject, handlerMap: Map<string, Set<JSFunction>> | undefined, type: string, eventObj: JSObject): void {
  const onProp = obj.properties.get(`on${type}`);
  if (onProp && isClosure(onProp.value)) {
    try { callJSFunction(onProp.value, obj, [eventObj]); }
    catch (err) { console.error(`[RTC] on${type} handler threw:`, err); }
  }
  const handlers = handlerMap?.get(type);
  if (handlers) {
    for (const h of handlers) {
      try { callJSFunction(h, obj, [eventObj]); }
      catch (err) { console.error(`[RTC] ${type} handler threw:`, err); }
    }
  }
}

// ── SDP (real UDP/DTLS/SCTP media line — RFC 8839/RFC 8841-shaped) ─────────

let _sessionCounter = 1;

function buildSdp(type: 'offer' | 'answer', candidates: readonly IceCandidate[], fingerprintSha256: string, setup: 'actpass' | 'active'): string {
  const sessionId = _sessionCounter++;
  const port = candidates[0]?.port ?? 9;
  const lines = [
    'v=0',
    `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    `m=application ${port} UDP/DTLS/SCTP webrtc-datachannel`,
    'c=IN IP4 0.0.0.0',
    'a=mid:0',
    `a=setup:${setup}`,
    `a=fingerprint:sha-256 ${fingerprintSha256}`,
    'a=sctp-port:5000',
    'a=max-message-size:262144',
  ];
  for (const c of candidates) lines.push(`a=candidate:${formatCandidateSdp(c).replace(/^candidate:/, '')}`);
  lines.push('a=end-of-candidates');
  return lines.join('\r\n') + '\r\n';
}

function parseSdpCandidates(sdp: string): IceCandidate[] {
  const out: IceCandidate[] = [];
  for (const rawLine of sdp.split(/\r?\n/)) {
    const line = rawLine.startsWith('a=') ? rawLine.slice(2) : rawLine;
    if (!line.startsWith('candidate:')) continue;
    const c = parseCandidateSdp(line);
    if (c) out.push(c);
  }
  return out;
}

function parseSdpFingerprint(sdp: string): string | null {
  const match = sdp.match(/^a=fingerprint:sha-256 (.+)$/im);
  return match ? match[1]!.trim() : null;
}

// ── DCEP (RFC 8832) — in-band data-channel open/ack over SCTP stream 0..N ──

const DCEP_DATA_CHANNEL_ACK = 0x02;
const DCEP_DATA_CHANNEL_OPEN = 0x03;
const DCEP_CHANNEL_TYPE_RELIABLE = 0x00;

function buildDcepOpen(label: string): Uint8Array {
  const labelBytes = encodeUtf8(label);
  const out = new Uint8Array(12 + labelBytes.length);
  out[0] = DCEP_DATA_CHANNEL_OPEN;
  out[1] = DCEP_CHANNEL_TYPE_RELIABLE;
  // bytes 2-3 Priority, 4-7 Reliability Parameter — left zero (unused for a reliable, ordered channel)
  writeUInt16BE(out, labelBytes.length, 8);
  writeUInt16BE(out, 0, 10); // Protocol Length — no subprotocol
  out.set(labelBytes, 12);
  return out;
}

function parseDcepOpenLabel(data: Uint8Array): string {
  const labelLen = readUInt16BE(data, 8);
  return decodeUtf8(data.subarray(12, 12 + labelLen));
}

function buildDcepAck(): Uint8Array {
  return new Uint8Array([DCEP_DATA_CHANNEL_ACK]);
}

// ── RTCDataChannel (JS-visible object) ──────────────────────────────────────

interface DataChannelInternal {
  __dcLabel: string;
  __dcState: 'connecting' | 'open' | 'closing' | 'closed';
  __dcHandlers: Map<string, Set<JSFunction>>;
  __dcSend: ((text: string) => void) | null;
}

interface DataChannelBundle {
  jsObject: JSObject & DataChannelInternal;
  markOpen: (sendFn: (text: string) => void) => void;
  markClosed: () => void;
  deliverMessage: (data: string | ArrayBuffer) => void;
}

function createDataChannelBundle(eventLoop: EventLoop, label: string): DataChannelBundle {
  const proto = createObject(null);

  proto.properties.set('addEventListener', {
    value: createNativeFunction('addEventListener', (_this, args) => {
      const dc = _this as JSObject & DataChannelInternal;
      const type = toString(args[0]);
      const fn = args[1];
      if (!isClosure(fn)) return undefined;
      if (!dc.__dcHandlers.has(type)) dc.__dcHandlers.set(type, new Set());
      dc.__dcHandlers.get(type)!.add(fn);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  proto.properties.set('removeEventListener', {
    value: createNativeFunction('removeEventListener', (_this, args) => {
      const dc = _this as JSObject & DataChannelInternal;
      const type = toString(args[0]);
      dc.__dcHandlers.get(type)?.delete(args[1] as JSFunction);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  proto.properties.set('send', {
    value: createNativeFunction('send', (_this, args) => {
      const dc = _this as JSObject & DataChannelInternal;
      if (dc.__dcState !== 'open' || !dc.__dcSend) {
        throw new DOMException("Failed to execute 'send' on 'RTCDataChannel': the channel is not open.", 'InvalidStateError');
      }
      const data = args[0];
      const text = typeof data === 'string' ? data : toString(data);
      try {
        dc.__dcSend(text);
      } catch (err) {
        eventLoop.enqueueMicrotask(() => {
          emitHandlerEvent(dc, dc.__dcHandlers, 'error', createEventObject('error', { message: err instanceof Error ? err.message : String(err) }));
        });
      }
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  proto.properties.set('close', {
    value: createNativeFunction('close', (_this) => {
      const dc = _this as JSObject & DataChannelInternal;
      if (dc.__dcState === 'closed' || dc.__dcState === 'closing') return undefined;
      dc.__dcState = 'closing';
      setProp(dc, 'readyState', 'closing', false, false);
      dc.__dcSend = null;
      dc.__dcState = 'closed';
      setProp(dc, 'readyState', 'closed', false, false);
      eventLoop.enqueueMicrotask(() => emitHandlerEvent(dc, dc.__dcHandlers, 'close', createEventObject('close')));
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  const dc = createObject(proto) as JSObject & DataChannelInternal;
  dc.__dcLabel = label;
  dc.__dcState = 'connecting';
  dc.__dcHandlers = new Map();
  dc.__dcSend = null;
  setProp(dc, 'label', label, false, false);
  setProp(dc, 'ordered', true, false, false);
  setProp(dc, 'readyState', 'connecting', false, false);
  setProp(dc, 'bufferedAmount', 0, false, false);
  setProp(dc, 'onopen', null, true, false);
  setProp(dc, 'onmessage', null, true, false);
  setProp(dc, 'onclose', null, true, false);
  setProp(dc, 'onerror', null, true, false);

  return {
    jsObject: dc,
    markOpen: (sendFn: (text: string) => void) => {
      dc.__dcSend = sendFn;
      dc.__dcState = 'open';
      setProp(dc, 'readyState', 'open', false, false);
      eventLoop.enqueueMicrotask(() => emitHandlerEvent(dc, dc.__dcHandlers, 'open', createEventObject('open')));
    },
    markClosed: () => {
      if (dc.__dcState === 'closed') return;
      dc.__dcState = 'closed';
      setProp(dc, 'readyState', 'closed', false, false);
      eventLoop.enqueueMicrotask(() => emitHandlerEvent(dc, dc.__dcHandlers, 'close', createEventObject('close')));
    },
    deliverMessage: (data: string | ArrayBuffer) => {
      eventLoop.enqueueMicrotask(() => {
        const jsData: JSValue = typeof data === 'string' ? data : (data as unknown as JSValue);
        emitHandlerEvent(dc, dc.__dcHandlers, 'message', createEventObject('message', { data: jsData }));
      });
    },
  };
}

// ── RTCSessionDescription / RTCIceCandidate (simple value classes) ─────────

export function createRTCSessionDescriptionClass(): JSObject {
  return createNativeFunction('RTCSessionDescription', (_this, args) => {
    const init = args[0] as JSObject | undefined;
    const obj = createObject(null);
    const type = init ? toString(getProp(init, 'type') ?? 'offer') : 'offer';
    const sdp = init ? toString(getProp(init, 'sdp') ?? '') : '';
    setProp(obj, 'type', type, false, true);
    setProp(obj, 'sdp', sdp, false, true);
    setProp(obj, 'toJSON', createNativeFunction('toJSON', (self) => {
      const s = self as JSObject;
      const out = createObject(null);
      setProp(out, 'type', getProp(s, 'type') ?? '');
      setProp(out, 'sdp', getProp(s, 'sdp') ?? '');
      return out;
    }), true, false);
    return obj;
  }) as unknown as JSObject;
}

export function createRTCIceCandidateClass(): JSObject {
  return createNativeFunction('RTCIceCandidate', (_this, args) => {
    const init = args[0] as JSObject | undefined;
    const obj = createObject(null);
    setProp(obj, 'candidate', init ? toString(getProp(init, 'candidate') ?? '') : '', false, true);
    setProp(obj, 'sdpMid', init ? (getProp(init, 'sdpMid') ?? null) : null, false, true);
    setProp(obj, 'sdpMLineIndex', init ? (getProp(init, 'sdpMLineIndex') ?? null) : null, false, true);
    setProp(obj, 'toJSON', createNativeFunction('toJSON', (self) => {
      const s = self as JSObject;
      const out = createObject(null);
      setProp(out, 'candidate', getProp(s, 'candidate') ?? '');
      setProp(out, 'sdpMid', getProp(s, 'sdpMid') ?? null);
      setProp(out, 'sdpMLineIndex', getProp(s, 'sdpMLineIndex') ?? null);
      return out;
    }), true, false);
    return obj;
  }) as unknown as JSObject;
}

// ── RTCPeerConnection ────────────────────────────────────────────────────────

type SignalingState = 'stable' | 'have-local-offer' | 'have-remote-offer' | 'closed';
type IceGatheringState = 'new' | 'gathering' | 'complete';
type IceConnectionState = 'new' | 'checking' | 'connected' | 'failed' | 'closed';

interface PendingLocalChannel {
  bundle: DataChannelBundle;
}

interface PeerConnectionInternal {
  __pcIce: IceAgent;
  __pcHandlers: Map<string, Set<JSFunction>>;
  __pcSignalingState: SignalingState;
  __pcIceGatheringState: IceGatheringState;
  __pcIceConnectionState: IceConnectionState;
  __pcLocalDescription: JSObject | null;
  __pcRemoteDescription: JSObject | null;
  __pcGathered: boolean;
  __pcLocalCandidates: IceCandidate[];
  __pcRemoteCandidates: IceCandidate[];
  __pcConnectivityStarted: boolean;
  __pcIsOfferer: boolean;
  __pcCertPromise: Promise<SelfSignedCert>;
  __pcRemoteFingerprint: string | null;
  __pcDtls: DtlsEndpoint | null;
  __pcSctp: SctpAssociation | null;
  __pcNextLocalStreamId: number;
  __pcChannelsByStream: Map<number, DataChannelBundle>;
  __pcPendingLocalChannels: PendingLocalChannel[];
}

export interface RtcApiOptions {
  /** Overrides the default public STUN server (used when the page doesn't pass its own `iceServers`) — mainly for tests, to point at an in-process mock STUN server instead of the real internet. */
  defaultStunServer?: { host: string; port: number } | null;
}

function parseStunServerFromConfig(config: JSObject | undefined, fallback: { host: string; port: number } | null): { host: string; port: number } | undefined {
  if (config) {
    const iceServers = getProp(config, 'iceServers');
    if (Array.isArray(iceServers)) {
      for (const entry of iceServers) {
        if (typeof entry !== 'object' || entry === null) continue;
        const urls = getProp(entry as JSObject, 'urls');
        const urlList = Array.isArray(urls) ? urls : urls !== undefined ? [urls] : [];
        for (const u of urlList) {
          const url = toString(u);
          const match = url.match(/^stuns?:([^:?]+)(?::(\d+))?/);
          if (match) return { host: match[1]!, port: match[2] ? Number(match[2]) : 3478 };
        }
      }
    }
  }
  return fallback ?? undefined;
}

export function createRTCPeerConnectionClass(eventLoop: EventLoop, options: RtcApiOptions = {}): JSObject {
  const proto = createObject(null);

  function fireStateEvent(pc: JSObject & PeerConnectionInternal, kind: 'signalingstatechange' | 'iceconnectionstatechange') {
    eventLoop.enqueueMicrotask(() => emitHandlerEvent(pc, pc.__pcHandlers, kind, createEventObject(kind)));
  }

  function setSignalingState(pc: JSObject & PeerConnectionInternal, state: SignalingState) {
    pc.__pcSignalingState = state;
    setProp(pc, 'signalingState', state, false, false);
    fireStateEvent(pc, 'signalingstatechange');
  }

  function setIceConnectionState(pc: JSObject & PeerConnectionInternal, state: IceConnectionState) {
    pc.__pcIceConnectionState = state;
    setProp(pc, 'iceConnectionState', state, false, false);
    fireStateEvent(pc, 'iceconnectionstatechange');
  }

  async function ensureGathered(pc: JSObject & PeerConnectionInternal): Promise<void> {
    if (pc.__pcGathered) return;
    pc.__pcIceGatheringState = 'gathering';
    setProp(pc, 'iceGatheringState', 'gathering', false, false);
    const candidates = await pc.__pcIce.gather();
    pc.__pcLocalCandidates = candidates;
    pc.__pcGathered = true;
    pc.__pcIceGatheringState = 'complete';
    setProp(pc, 'iceGatheringState', 'complete', false, false);

    for (const c of candidates) {
      eventLoop.enqueueMicrotask(() => {
        const candObj = createObject(null);
        setProp(candObj, 'candidate', formatCandidateSdp(c), false, true);
        setProp(candObj, 'sdpMid', '0', false, true);
        setProp(candObj, 'sdpMLineIndex', 0, false, true);
        emitHandlerEvent(pc, pc.__pcHandlers, 'icecandidate', createEventObject('icecandidate', { candidate: candObj }));
      });
    }
    eventLoop.enqueueMicrotask(() => {
      emitHandlerEvent(pc, pc.__pcHandlers, 'icecandidate', createEventObject('icecandidate', { candidate: null }));
    });
  }

  /** Opens a locally-created channel over SCTP once the association exists: assigns a stream id and sends the DCEP OPEN. The channel itself transitions to 'open' only once the peer's DCEP ACK arrives. */
  function openLocalChannel(pc: JSObject & PeerConnectionInternal, pending: PendingLocalChannel): void {
    const streamId = pc.__pcNextLocalStreamId;
    pc.__pcNextLocalStreamId += 2;
    pc.__pcChannelsByStream.set(streamId, pending.bundle);
    pc.__pcSctp!.sendMessage(streamId, PPID_DCEP, buildDcepOpen(pending.bundle.jsObject.__dcLabel));
  }

  function handleSctpMessage(pc: JSObject & PeerConnectionInternal, streamId: number, ppid: number, data: Uint8Array): void {
    if (ppid === PPID_DCEP) {
      const msgType = data[0];
      if (msgType === DCEP_DATA_CHANNEL_OPEN) {
        const label = parseDcepOpenLabel(data);
        const bundle = createDataChannelBundle(eventLoop, label);
        pc.__pcChannelsByStream.set(streamId, bundle);
        pc.__pcSctp!.sendMessage(streamId, PPID_DCEP, buildDcepAck());
        // Dispatch 'datachannel' first (inside a microtask, since callJSFunction can
        // only run a page handler from the interpreter context) and only THEN
        // markOpen() — markOpen enqueues its own 'open' microtask, so the page's
        // ondatachannel handler gets a chance to attach onopen before 'open' fires.
        eventLoop.enqueueMicrotask(() => {
          emitHandlerEvent(pc, pc.__pcHandlers, 'datachannel', createEventObject('datachannel', { channel: bundle.jsObject }));
          bundle.markOpen((text) => pc.__pcSctp!.sendMessage(streamId, PPID_WEBRTC_STRING, encodeUtf8(text)));
        });
      } else if (msgType === DCEP_DATA_CHANNEL_ACK) {
        const bundle = pc.__pcChannelsByStream.get(streamId);
        bundle?.markOpen((text) => pc.__pcSctp!.sendMessage(streamId, PPID_WEBRTC_STRING, encodeUtf8(text)));
      }
      return;
    }
    if (ppid === PPID_WEBRTC_STRING) {
      pc.__pcChannelsByStream.get(streamId)?.deliverMessage(decodeUtf8(data));
    }
  }

  function maybeStartConnectivityChecks(pc: JSObject & PeerConnectionInternal): void {
    if (pc.__pcConnectivityStarted) return;
    if (pc.__pcSignalingState !== 'stable') return;
    if (!pc.__pcLocalDescription || !pc.__pcRemoteDescription) return;
    if (pc.__pcRemoteCandidates.length === 0) return;
    pc.__pcConnectivityStarted = true;

    setIceConnectionState(pc, 'checking');
    pc.__pcIce.checkConnectivity(pc.__pcRemoteCandidates).then(
      async () => {
        setIceConnectionState(pc, 'connected');

        // The other peer's own connectivity check can resolve before this side's does and
        // start sending its first DTLS ClientHello/HelloVerifyRequest immediately — IceAgent
        // itself buffers any datagram that arrives before `onData` installs a real handler
        // (see ice-agent.ts), so nothing is lost in the gap while the (async-generated) cert
        // and DtlsEndpoint are still being constructed below.
        const dtlsRole: DtlsRole = pc.__pcIsOfferer ? 'server' : 'client';
        const cert = await pc.__pcCertPromise;
        const dtls = new DtlsEndpoint({ role: dtlsRole, cert, send: (bytes) => pc.__pcIce.send(bytes) });
        pc.__pcDtls = dtls;
        pc.__pcIce.onData((bytes) => dtls.onReceive(bytes));

        let dtlsResult;
        try {
          dtlsResult = await dtls.handshakeDone;
        } catch (err) {
          setIceConnectionState(pc, 'failed');
          console.error('[RTCPeerConnection] DTLS handshake failed:', err instanceof Error ? err.message : err);
          return;
        }
        if (pc.__pcRemoteFingerprint && dtlsResult.peerFingerprintSha256 !== pc.__pcRemoteFingerprint) {
          setIceConnectionState(pc, 'failed');
          console.error(
            `[RTCPeerConnection] DTLS fingerprint mismatch: SDP declared ${pc.__pcRemoteFingerprint}, peer presented ${dtlsResult.peerFingerprintSha256}`,
          );
          return;
        }

        const sctpRole: SctpRole = dtlsRole;
        const sctp = new SctpAssociation({
          role: sctpRole,
          send: (bytes) => { void dtls.sendApplicationData(bytes); },
          onMessage: (streamId, ppid, data) => handleSctpMessage(pc, streamId, ppid, data),
        });
        dtls.onApplicationData = (bytes) => sctp.onReceive(bytes);
        pc.__pcSctp = sctp;
        pc.__pcNextLocalStreamId = sctpRole === 'client' ? 0 : 1;

        await sctp.associationEstablished;
        for (const pending of pc.__pcPendingLocalChannels.splice(0)) openLocalChannel(pc, pending);
      },
      (err: unknown) => {
        setIceConnectionState(pc, 'failed');
        console.error('[RTCPeerConnection] ICE connectivity failed:', err instanceof Error ? err.message : err);
      },
    );
  }

  // ── addEventListener / removeEventListener ──────────────────────────────
  proto.properties.set('addEventListener', {
    value: createNativeFunction('addEventListener', (_this, args) => {
      const pc = _this as JSObject & PeerConnectionInternal;
      const type = toString(args[0]);
      const fn = args[1];
      if (!isClosure(fn)) return undefined;
      if (!pc.__pcHandlers.has(type)) pc.__pcHandlers.set(type, new Set());
      pc.__pcHandlers.get(type)!.add(fn);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  proto.properties.set('removeEventListener', {
    value: createNativeFunction('removeEventListener', (_this, args) => {
      const pc = _this as JSObject & PeerConnectionInternal;
      const type = toString(args[0]);
      pc.__pcHandlers.get(type)?.delete(args[1] as JSFunction);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── createDataChannel(label) ─────────────────────────────────────────────
  proto.properties.set('createDataChannel', {
    value: createNativeFunction('createDataChannel', (_this, args) => {
      const pc = _this as JSObject & PeerConnectionInternal;
      if (pc.__pcSignalingState === 'closed') {
        throw new DOMException("Failed to execute 'createDataChannel' on 'RTCPeerConnection': the connection is closed.", 'InvalidStateError');
      }
      const label = args[0] !== undefined ? toString(args[0]) : '';
      const bundle = createDataChannelBundle(eventLoop, label);
      if (pc.__pcSctp) {
        openLocalChannel(pc, { bundle });
      } else {
        pc.__pcPendingLocalChannels.push({ bundle });
      }
      return bundle.jsObject;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── createOffer() ─────────────────────────────────────────────────────────
  proto.properties.set('createOffer', {
    value: createNativeFunction('createOffer', (_this) => {
      const pc = _this as JSObject & PeerConnectionInternal;
      pc.__pcIsOfferer = true;
      const p = createWiredPromise(eventLoop);
      Promise.all([ensureGathered(pc), pc.__pcCertPromise]).then(
        ([, cert]) => {
          const sdp = buildSdp('offer', pc.__pcLocalCandidates, cert.fingerprintSha256, 'actpass');
          const desc = createObject(null);
          setProp(desc, 'type', 'offer', false, true);
          setProp(desc, 'sdp', sdp, false, true);
          fulfillPromise(p, desc);
        },
        (err: unknown) => rejectPromise(p, new DOMException(err instanceof Error ? err.message : String(err), 'OperationError') as unknown as JSValue),
      );
      return p;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── createAnswer() ────────────────────────────────────────────────────────
  proto.properties.set('createAnswer', {
    value: createNativeFunction('createAnswer', (_this) => {
      const pc = _this as JSObject & PeerConnectionInternal;
      const p = createWiredPromise(eventLoop);
      if (pc.__pcSignalingState !== 'have-remote-offer') {
        rejectPromise(p, new DOMException("Failed to execute 'createAnswer': no remote offer is set.", 'InvalidStateError') as unknown as JSValue);
        return p;
      }
      Promise.all([ensureGathered(pc), pc.__pcCertPromise]).then(
        ([, cert]) => {
          const sdp = buildSdp('answer', pc.__pcLocalCandidates, cert.fingerprintSha256, 'active');
          const desc = createObject(null);
          setProp(desc, 'type', 'answer', false, true);
          setProp(desc, 'sdp', sdp, false, true);
          fulfillPromise(p, desc);
        },
        (err: unknown) => rejectPromise(p, new DOMException(err instanceof Error ? err.message : String(err), 'OperationError') as unknown as JSValue),
      );
      return p;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── setLocalDescription(desc) ────────────────────────────────────────────
  proto.properties.set('setLocalDescription', {
    value: createNativeFunction('setLocalDescription', (_this, args) => {
      const pc = _this as JSObject & PeerConnectionInternal;
      const p = createWiredPromise(eventLoop);
      const descInit = args[0] as JSObject | undefined;
      if (!descInit) {
        rejectPromise(p, new DOMException("Failed to execute 'setLocalDescription': 1 argument required.", 'TypeError') as unknown as JSValue);
        return p;
      }
      const type = toString(getProp(descInit, 'type') ?? '');
      pc.__pcLocalDescription = descInit;
      setProp(pc, 'localDescription', descInit, false, false);
      setSignalingState(pc, type === 'answer' ? 'stable' : 'have-local-offer');
      ensureGathered(pc).then(
        () => { fulfillPromise(p, undefined); maybeStartConnectivityChecks(pc); },
        (err: unknown) => rejectPromise(p, new DOMException(err instanceof Error ? err.message : String(err), 'OperationError') as unknown as JSValue),
      );
      return p;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── setRemoteDescription(desc) ───────────────────────────────────────────
  proto.properties.set('setRemoteDescription', {
    value: createNativeFunction('setRemoteDescription', (_this, args) => {
      const pc = _this as JSObject & PeerConnectionInternal;
      const p = createWiredPromise(eventLoop);
      const descInit = args[0] as JSObject | undefined;
      if (!descInit) {
        rejectPromise(p, new DOMException("Failed to execute 'setRemoteDescription': 1 argument required.", 'TypeError') as unknown as JSValue);
        return p;
      }
      const type = toString(getProp(descInit, 'type') ?? '');
      const sdp = toString(getProp(descInit, 'sdp') ?? '');
      pc.__pcRemoteDescription = descInit;
      setProp(pc, 'remoteDescription', descInit, false, false);
      pc.__pcRemoteCandidates = parseSdpCandidates(sdp);
      pc.__pcRemoteFingerprint = parseSdpFingerprint(sdp);
      setSignalingState(pc, type === 'answer' ? 'stable' : 'have-remote-offer');
      fulfillPromise(p, undefined);
      maybeStartConnectivityChecks(pc);
      return p;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── addIceCandidate(candidate) ───────────────────────────────────────────
  proto.properties.set('addIceCandidate', {
    value: createNativeFunction('addIceCandidate', (_this, args) => {
      const pc = _this as JSObject & PeerConnectionInternal;
      const p = createWiredPromise(eventLoop);
      const init = args[0] as JSObject | undefined;
      if (init) {
        const candStr = toString(getProp(init, 'candidate') ?? '');
        const parsed = candStr ? parseCandidateSdp(candStr) : null;
        if (parsed) pc.__pcRemoteCandidates.push(parsed);
      }
      fulfillPromise(p, undefined);
      // Trickle candidates arriving after checks have already started aren't
      // retried against — documented limitation (unchanged from Phase 1).
      maybeStartConnectivityChecks(pc);
      return p;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── close() ───────────────────────────────────────────────────────────────
  proto.properties.set('close', {
    value: createNativeFunction('close', (_this) => {
      const pc = _this as JSObject & PeerConnectionInternal;
      if (pc.__pcSignalingState === 'closed') return undefined;
      for (const bundle of pc.__pcChannelsByStream.values()) bundle.markClosed();
      for (const pending of pc.__pcPendingLocalChannels) pending.bundle.markClosed();
      pc.__pcSctp?.close();
      pc.__pcIce.close();
      setIceConnectionState(pc, 'closed');
      setSignalingState(pc, 'closed');
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── Constructor ──────────────────────────────────────────────────────────
  const nativeFn = createNativeFunction('RTCPeerConnection', (_this, args) => {
    const config = args[0] as JSObject | undefined;
    const stunServer = parseStunServerFromConfig(config, options.defaultStunServer ?? null);

    const pc = createObject(proto) as JSObject & PeerConnectionInternal;
    pc.__pcIce = new IceAgent({ stunServer });
    pc.__pcHandlers = new Map();
    pc.__pcSignalingState = 'stable';
    pc.__pcIceGatheringState = 'new';
    pc.__pcIceConnectionState = 'new';
    pc.__pcLocalDescription = null;
    pc.__pcRemoteDescription = null;
    pc.__pcGathered = false;
    pc.__pcLocalCandidates = [];
    pc.__pcRemoteCandidates = [];
    pc.__pcConnectivityStarted = false;
    pc.__pcIsOfferer = false;
    pc.__pcCertPromise = generateSelfSignedP256Cert();
    pc.__pcRemoteFingerprint = null;
    pc.__pcDtls = null;
    pc.__pcSctp = null;
    pc.__pcNextLocalStreamId = 0;
    pc.__pcChannelsByStream = new Map();
    pc.__pcPendingLocalChannels = [];

    setProp(pc, 'signalingState', 'stable', false, false);
    setProp(pc, 'iceGatheringState', 'new', false, false);
    setProp(pc, 'iceConnectionState', 'new', false, false);
    setProp(pc, 'localDescription', null, false, false);
    setProp(pc, 'remoteDescription', null, false, false);
    setProp(pc, 'onicecandidate', null, true, false);
    setProp(pc, 'oniceconnectionstatechange', null, true, false);
    setProp(pc, 'onsignalingstatechange', null, true, false);
    setProp(pc, 'ondatachannel', null, true, false);

    return pc;
  });

  const ctor = createObject(null);
  ctor.type = 'function';
  ctor.callable = true;
  ctor.nativeFn = nativeFn.nativeFn;
  ctor.properties.set('prototype', { value: proto, writable: false, enumerable: false, configurable: false });

  return ctor;
}

export { IceError };
export type { IceCandidate };
