/**
 * @file src/browser/js/rtc-api.ts
 *
 * WebRTC — Phase 1: `RTCPeerConnection` + `RTCDataChannel`, real ICE/STUN
 * candidate gathering and connectivity over real UDP sockets (see
 * ../networking/ice-agent.ts, ../networking/stun-client.ts), exposed to page
 * JavaScript as `window.RTCPeerConnection` for the first time — the previous
 * `src/browser/media/webrtc.ts` was a fully simulated stand-in never wired
 * into the JS VM's global scope.
 *
 * HONEST SCOPE — read before assuming this interoperates with a real browser:
 *   - ICE candidate gathering/exchange and connectivity checks are real STUN
 *     over real UDP (RFC 5389/8445 subset — see ice-agent.ts for exactly
 *     what's simplified: single component, no TURN, no STUN
 *     message-integrity/authentication).
 *   - The data channel is NOT real SCTP-over-DTLS. It's a small
 *     Nova-specific reliable-framing protocol (see ReliableChannel below)
 *     layered directly over the UDP pair ICE selects. Two Nova instances can
 *     talk to each other. **A real browser (Chrome/Firefox/etc.) cannot
 *     negotiate a data channel with Nova today** — that needs DTLS + real
 *     SCTP, which is Phase 2 (see doc/webrtc-implementation-plan.md).
 *   - No audio/video. `getUserMedia`/`MediaStream`/SRTP are not implemented
 *     — this file is data-channel only.
 *   - No TURN relay — only host + server-reflexive candidates, so peers
 *     behind symmetric NAT with no STUN-friendly path won't connect.
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

// ── SDP (Nova-specific — see the HONEST SCOPE note above) ──────────────────

let _sessionCounter = 1;

function buildSdp(type: 'offer' | 'answer', candidates: readonly IceCandidate[], label: string | null): string {
  const sessionId = _sessionCounter++;
  const port = candidates[0]?.port ?? 9;
  const lines = [
    'v=0',
    `o=- ${sessionId} 2 IN IP4 127.0.0.1`,
    's=-',
    't=0 0',
    // NOVA/DATACHANNEL is a deliberately non-standard protocol token — this
    // is NOT "UDP/DTLS/SCTP" because it isn't; see the HONEST SCOPE note.
    `m=application ${port} NOVA/DATACHANNEL`,
    'c=IN IP4 0.0.0.0',
    'a=mid:0',
  ];
  if (label !== null) lines.push(`a=label:${label}`);
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

function parseSdpLabel(sdp: string): string | null {
  const match = sdp.match(/^a=label:(.+)$/m);
  return match ? match[1]!.trim() : null;
}

// ── ReliableChannel — Nova's data-channel framing over the ICE-selected UDP pair ──

const FRAME_DATA = 0x01;
const FRAME_ACK = 0x02;
const RETRANSMIT_MS = 200;
const MAX_RETRIES = 5;

class ReliableChannel {
  private readonly ice: IceAgent;
  private sendSeq = 0;
  private recvSeq = 0;
  private pendingSend: { resolve: () => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout>; attempts: number; frame: Buffer } | null = null;
  private sendQueue: Array<{ payload: Buffer; resolve: () => void; reject: (err: Error) => void }> = [];
  onMessage: ((payload: Buffer) => void) | null = null;

  constructor(ice: IceAgent) {
    this.ice = ice;
    this.ice.onData((msg) => this.handleIncoming(msg));
  }

  send(payload: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      this.sendQueue.push({ payload, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.pendingSend || this.sendQueue.length === 0) return;
    const { payload, resolve, reject } = this.sendQueue.shift()!;
    const seq = this.sendSeq;
    const frame = Buffer.alloc(7 + payload.length);
    frame.writeUInt8(FRAME_DATA, 0);
    frame.writeUInt32BE(seq, 1);
    frame.writeUInt16BE(payload.length, 5);
    payload.copy(frame, 7);

    const attempt = (attempts: number) => {
      try {
        this.ice.send(frame);
      } catch (err) {
        this.pendingSend = null;
        reject(err instanceof Error ? err : new Error(String(err)));
        this.pump();
        return;
      }
      const timer = setTimeout(() => {
        if (!this.pendingSend) return;
        if (attempts >= MAX_RETRIES) {
          this.pendingSend = null;
          reject(new Error(`RTCDataChannel: no ACK for message after ${MAX_RETRIES} retries`));
          this.pump();
        } else {
          attempt(attempts + 1);
        }
      }, RETRANSMIT_MS);
      this.pendingSend = { resolve, reject, timer, attempts, frame };
    };
    attempt(0);
    this.sendSeq++;
  }

  private handleIncoming(msg: Buffer): void {
    if (msg.length < 1) return;
    const type = msg.readUInt8(0);

    if (type === FRAME_ACK && msg.length >= 5) {
      const ackSeq = msg.readUInt32BE(1);
      // Match against the seq of the frame currently in flight (stop-and-wait
      // means only one is outstanding at a time), not a value derived from the
      // send counter — self-documenting and robust if this ever grows into
      // multiple in-flight frames.
      if (this.pendingSend && this.pendingSend.frame.readUInt32BE(1) === ackSeq) {
        clearTimeout(this.pendingSend.timer);
        const { resolve } = this.pendingSend;
        this.pendingSend = null;
        resolve();
        this.pump();
      }
      return;
    }

    if (type === FRAME_DATA && msg.length >= 7) {
      const seq = msg.readUInt32BE(1);
      const len = msg.readUInt16BE(5);
      const payload = msg.subarray(7, 7 + len);

      // Always ACK — including duplicates, since a lost ACK is what causes
      // the sender to retransmit a frame we already delivered.
      const ack = Buffer.alloc(5);
      ack.writeUInt8(FRAME_ACK, 0);
      ack.writeUInt32BE(seq, 1);
      try { this.ice.send(ack); } catch { /* peer may already be gone */ }

      if (seq === this.recvSeq) {
        this.recvSeq++;
        if (this.onMessage) this.onMessage(Buffer.from(payload));
      }
      // seq < recvSeq: duplicate, already delivered, ACK re-sent above.
      // seq > recvSeq: out-of-order — dropped in this Phase 1 stop-and-wait
      // scheme (documented limitation; the sender will retransmit).
    }
  }

  dispose(): void {
    if (this.pendingSend) {
      clearTimeout(this.pendingSend.timer);
      this.pendingSend.reject(new Error('RTCDataChannel closed'));
      this.pendingSend = null;
    }
    for (const q of this.sendQueue) q.reject(new Error('RTCDataChannel closed'));
    this.sendQueue = [];
  }
}

// ── RTCDataChannel (JS-visible object) ──────────────────────────────────────

interface DataChannelInternal {
  __dcLabel: string;
  __dcState: 'connecting' | 'open' | 'closing' | 'closed';
  __dcHandlers: Map<string, Set<JSFunction>>;
  __dcChannel: ReliableChannel | null;
}

function createDataChannelBundle(eventLoop: EventLoop, label: string): {
  jsObject: JSObject & DataChannelInternal;
  markOpen: (channel: ReliableChannel) => void;
  markClosed: () => void;
  deliverMessage: (data: string | ArrayBuffer) => void;
} {
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
      const fn = args[1];
      dc.__dcHandlers.get(type)?.delete(fn as JSFunction);
      return undefined;
    }),
    writable: true, enumerable: true, configurable: true,
  });
  proto.properties.set('send', {
    value: createNativeFunction('send', (_this, args) => {
      const dc = _this as JSObject & DataChannelInternal;
      if (dc.__dcState !== 'open' || !dc.__dcChannel) {
        throw new DOMException("Failed to execute 'send' on 'RTCDataChannel': the channel is not open.", 'InvalidStateError');
      }
      const data = args[0];
      const text = typeof data === 'string' ? data : toString(data);
      dc.__dcChannel.send(Buffer.from(text, 'utf8')).catch((err) => {
        eventLoop.enqueueMicrotask(() => {
          emitHandlerEvent(dc, dc.__dcHandlers, 'error', createEventObject('error', { message: err.message }));
        });
      });
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
      dc.__dcChannel?.dispose();
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
  dc.__dcChannel = null;
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
    markOpen: (channel: ReliableChannel) => {
      dc.__dcChannel = channel;
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
  __pcLocalChannel: { jsObject: JSObject & DataChannelInternal; markOpen: (c: ReliableChannel) => void; markClosed: () => void; deliverMessage: (d: string | ArrayBuffer) => void } | null;
  __pcConnectivityStarted: boolean;
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

  function maybeStartConnectivityChecks(pc: JSObject & PeerConnectionInternal): void {
    if (pc.__pcConnectivityStarted) return;
    if (pc.__pcSignalingState !== 'stable') return;
    if (!pc.__pcLocalDescription || !pc.__pcRemoteDescription) return;
    if (pc.__pcRemoteCandidates.length === 0) return;
    pc.__pcConnectivityStarted = true;

    setIceConnectionState(pc, 'checking');
    pc.__pcIce.checkConnectivity(pc.__pcRemoteCandidates).then(
      () => {
        setIceConnectionState(pc, 'connected');
        const reliable = new ReliableChannel(pc.__pcIce);

        if (pc.__pcLocalChannel) {
          // We called createDataChannel() ourselves — bring it up.
          reliable.onMessage = (payload) => pc.__pcLocalChannel!.deliverMessage(payload.toString('utf8'));
          pc.__pcLocalChannel.markOpen(reliable);
        } else {
          // The remote side created the channel — announce it via 'datachannel'.
          const remoteSdp = toString(getProp(pc.__pcRemoteDescription!, 'sdp') ?? '');
          const label = parseSdpLabel(remoteSdp) ?? 'data';
          const bundle = createDataChannelBundle(eventLoop, label);
          reliable.onMessage = (payload) => bundle.deliverMessage(payload.toString('utf8'));
          // Dispatch 'datachannel' (inside a microtask, since callJSFunction can
          // only run a page handler from the interpreter context) and only THEN
          // markOpen() — markOpen enqueues the 'open' event as a subsequent
          // microtask, so the ondatachannel handler can attach onopen before
          // 'open' fires. Ordering these the other way makes B's channel never
          // appear open to the page.
          eventLoop.enqueueMicrotask(() => {
            emitHandlerEvent(pc, pc.__pcHandlers, 'datachannel', createEventObject('datachannel', { channel: bundle.jsObject }));
            bundle.markOpen(reliable);
          });
        }
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
      if (pc.__pcLocalChannel) {
        throw new DOMException('Nova Phase 1 supports exactly one RTCDataChannel per connection.', 'NotSupportedError');
      }
      const label = args[0] !== undefined ? toString(args[0]) : '';
      const bundle = createDataChannelBundle(eventLoop, label);
      pc.__pcLocalChannel = bundle;
      return bundle.jsObject;
    }),
    writable: true, enumerable: true, configurable: true,
  });

  // ── createOffer() ─────────────────────────────────────────────────────────
  proto.properties.set('createOffer', {
    value: createNativeFunction('createOffer', (_this) => {
      const pc = _this as JSObject & PeerConnectionInternal;
      const p = createWiredPromise(eventLoop);
      ensureGathered(pc).then(
        () => {
          const label = pc.__pcLocalChannel ? toString(getProp(pc.__pcLocalChannel.jsObject, 'label') ?? '') : null;
          const sdp = buildSdp('offer', pc.__pcLocalCandidates, label);
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
      ensureGathered(pc).then(
        () => {
          const label = pc.__pcLocalChannel ? toString(getProp(pc.__pcLocalChannel.jsObject, 'label') ?? '') : null;
          const sdp = buildSdp('answer', pc.__pcLocalCandidates, label);
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
      // retried against in Phase 1 — documented limitation.
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
      pc.__pcLocalChannel?.markClosed();
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
    pc.__pcLocalChannel = null;
    pc.__pcConnectivityStarted = false;

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
