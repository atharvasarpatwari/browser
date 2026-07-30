import type { IDisposable } from '../../app/dependency-container';

type RTCSignalingState = 'stable' | 'have-local-offer' | 'have-remote-offer' | 'have-local-pranswer' | 'have-remote-pranswer' | 'closed';
type RTCIceGatheringState = 'new' | 'gathering' | 'complete';
type RTCIceConnectionState = 'new' | 'checking' | 'connected' | 'completed' | 'disconnected' | 'failed' | 'closed';

interface IRTCPeerConnection extends IDisposable {
  readonly signalingState: RTCSignalingState;
  readonly iceGatheringState: RTCIceGatheringState;
  readonly iceConnectionState: RTCIceConnectionState;
  createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescription>;
  createAnswer(options?: RTCAnswerOptions): Promise<RTCSessionDescription>;
  setLocalDescription(desc: RTCSessionDescription): Promise<void>;
  setRemoteDescription(desc: RTCSessionDescription): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidate): Promise<void>;
  close(): void;
  onEvent(handler: RTCEventHandler): () => void;
}

interface RTCSessionDescription {
  readonly type: string;
  readonly sdp: string;
}

interface RTCIceCandidate {
  readonly candidate: string;
  readonly sdpMid: string | null;
  readonly sdpMLineIndex: number | null;
}

interface RTCOfferOptions {
  iceRestart?: boolean;
}

interface RTCAnswerOptions { }

interface RTCEvent {
  readonly kind: RTCEventKind;
  readonly data?: Record<string, unknown>;
}

type RTCEventKind = 'icecandidate' | 'iceconnectionstatechange' | 'signalingstatechange' | 'track';
type RTCEventHandler = (event: RTCEvent) => void;

let _rtcId = 1;

class RTCPeerConnection implements IRTCPeerConnection {
  private _signalingState: RTCSignalingState = 'stable';
  private _iceGatheringState: RTCIceGatheringState = 'new';
  private _iceConnectionState: RTCIceConnectionState = 'new';
  private _localDescription: RTCSessionDescription | null = null;
  private _remoteDescription: RTCSessionDescription | null = null;
  private _handlers = new Set<RTCEventHandler>();
  private _id = _rtcId++;

  get signalingState(): RTCSignalingState { return this._signalingState; }
  get iceGatheringState(): RTCIceGatheringState { return this._iceGatheringState; }
  get iceConnectionState(): RTCIceConnectionState { return this._iceConnectionState; }
  get localDescription(): RTCSessionDescription | null { return this._localDescription; }
  get remoteDescription(): RTCSessionDescription | null { return this._remoteDescription; }

  async createOffer(_options?: RTCOfferOptions): Promise<RTCSessionDescription> {
    this._signalingState = 'have-local-offer';
    this.emit({ kind: 'signalingstatechange', data: { state: this._signalingState } });
    return {
      type: 'offer',
      sdp: `v=0\no=- ${this._id} 2 IN IP4 127.0.0.1\ns=-\nt=0 0\nm=audio 9 UDP/TLS/RTP/SAVPF 111\na=mid:audio\na=msid:stream1 audio1\na=ssrc:${this._id} cname:simulcast`,
    };
  }

  async createAnswer(_options?: RTCAnswerOptions): Promise<RTCSessionDescription> {
    this._signalingState = 'stable';
    this.emit({ kind: 'signalingstatechange', data: { state: this._signalingState } });
    return {
      type: 'answer',
      sdp: `v=0\no=- ${this._id} 3 IN IP4 127.0.0.1\ns=-\nt=0 0\nm=audio 9 UDP/TLS/RTP/SAVPF 111\na=mid:audio\na=ssrc:${this._id} cname:simulcast`,
    };
  }

  async setLocalDescription(desc: RTCSessionDescription): Promise<void> {
    this._localDescription = desc;
    this._iceGatheringState = 'gathering';
    this.emit({ kind: 'icecandidate', data: { candidate: null } });
    this._iceGatheringState = 'complete';
    this._iceConnectionState = 'checking';
    this.emit({ kind: 'iceconnectionstatechange', data: { state: this._iceConnectionState } });
  }

  async setRemoteDescription(desc: RTCSessionDescription): Promise<void> {
    this._remoteDescription = desc;
    if (desc.type === 'offer') {
      this._signalingState = 'have-remote-offer';
    } else if (desc.type === 'answer') {
      this._signalingState = 'stable';
      this._iceConnectionState = 'connected';
      this.emit({ kind: 'iceconnectionstatechange', data: { state: 'connected' } });
    }
    this.emit({ kind: 'signalingstatechange', data: { state: this._signalingState } });
  }

  async addIceCandidate(_candidate: RTCIceCandidate): Promise<void> {
    this._iceConnectionState = 'connected';
    this.emit({ kind: 'iceconnectionstatechange', data: { state: 'connected' } });
  }

  close(): void {
    this._signalingState = 'closed';
    this._iceConnectionState = 'closed';
    this._iceGatheringState = 'complete';
    this.emit({ kind: 'signalingstatechange', data: { state: 'closed' } });
    this.emit({ kind: 'iceconnectionstatechange', data: { state: 'closed' } });
  }

  onEvent(handler: RTCEventHandler): () => void {
    this._handlers.add(handler);
    return () => { this._handlers.delete(handler); };
  }

  protected emit(event: RTCEvent): void {
    for (const h of this._handlers) {
      try { h(event); } catch { }
    }
  }

  dispose(): void {
    this.close();
    this._handlers.clear();
  }
}

export { RTCPeerConnection };
export type { IRTCPeerConnection, RTCSignalingState, RTCIceGatheringState, RTCIceConnectionState, RTCSessionDescription, RTCIceCandidate, RTCOfferOptions, RTCAnswerOptions, RTCEvent, RTCEventKind, RTCEventHandler };
