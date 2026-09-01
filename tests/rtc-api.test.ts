import { describe, it, expect, beforeEach } from 'vitest';
import { runJS, createGlobalEnv } from '../src/browser/js/index';
import { EventLoop } from '../src/browser/js/event-loop';

function makeMinimalDoc() {
  return {
    domId: 'doc-1', nodeType: 'document' as const, parent: null,
    children: [], htmlElement: null, headElement: null, bodyElement: null,
  };
}

function makeMinimalDomTree(doc: any) {
  return {
    buildFromHtml: () => doc, getNodeById: () => null, getElementById: () => null,
    getElementsByTagName: () => [], querySelector: () => null, querySelectorAll: () => [],
    insertBefore: () => {}, appendChild: () => {}, removeChild: () => {},
    setAttribute: () => {}, removeAttribute: () => {}, setTextContent: () => {},
    setComputedStyle: () => {}, setLayoutBox: () => {}, getMutations: () => [],
    clearMutations: () => {}, getDocument: () => doc, dispose: () => {},
  };
}

function createTestEnv() {
  const doc = makeMinimalDoc();
  const domTree = makeMinimalDomTree(doc);
  const eventLoop = new EventLoop();
  const env = createGlobalEnv(doc as any, domTree as any, eventLoop);
  return { env, eventLoop };
}

function runInEnv(code: string, env: any, eventLoop: EventLoop) {
  const doc = makeMinimalDoc();
  const domTree = makeMinimalDomTree(doc);
  return runJS(code, { document: doc as any, domTree: domTree as any, eventLoop, globalEnv: env });
}

async function pump(eventLoop: EventLoop, ms: number, steps = 4): Promise<void> {
  const stepMs = Math.max(1, Math.floor(ms / steps));
  for (let i = 0; i < steps; i++) {
    await new Promise((resolve) => setTimeout(resolve, stepMs));
    eventLoop.drainMicrotasks();
  }
}

describe('RTCPeerConnection — API surface (synchronous)', () => {
  let env: any;
  let eventLoop: EventLoop;

  beforeEach(() => {
    const testEnv = createTestEnv();
    env = testEnv.env;
    eventLoop = testEnv.eventLoop;
  });

  it('is exposed as a global constructor', () => {
    const r = runInEnv(`typeof RTCPeerConnection;`, env, eventLoop);
    expect(r.value).toBe('function');
    expect(r.error).toBeUndefined();
  });

  it('constructs with sensible initial state', () => {
    const r = runInEnv(`
      var pc = new RTCPeerConnection();
      [pc.signalingState, pc.iceGatheringState, pc.iceConnectionState, pc.localDescription, pc.remoteDescription].join('|');
    `, env, eventLoop);
    expect(r.value).toBe('stable|new|new||');
  });

  it('createDataChannel returns a channel with the given label, starting connecting', () => {
    const r = runInEnv(`
      var pc = new RTCPeerConnection();
      var dc = pc.createDataChannel('chat');
      dc.label + '|' + dc.readyState + '|' + dc.bufferedAmount;
    `, env, eventLoop);
    expect(r.value).toBe('chat|connecting|0');
  });

  it('rejects a second createDataChannel on the same connection (Phase 1 limitation)', () => {
    const r = runInEnv(`
      var pc = new RTCPeerConnection();
      pc.createDataChannel('a');
      pc.createDataChannel('b');
    `, env, eventLoop);
    expect(r.error?.message).toContain('one RTCDataChannel');
  });

  it('RTCSessionDescription and RTCIceCandidate constructors exist and store their fields', () => {
    const r = runInEnv(`
      var desc = new RTCSessionDescription({ type: 'offer', sdp: 'v=0' });
      var cand = new RTCIceCandidate({ candidate: 'candidate:1 1 udp 100 10.0.0.1 5000 typ host', sdpMid: '0', sdpMLineIndex: 0 });
      desc.type + '|' + desc.sdp + '|' + cand.sdpMid + '|' + cand.sdpMLineIndex;
    `, env, eventLoop);
    expect(r.value).toBe('offer|v=0|0|0');
  });
});

describe('RTCPeerConnection — full offer/answer/ICE/data-channel over real loopback UDP', () => {
  let env: any;
  let eventLoop: EventLoop;

  beforeEach(() => {
    const testEnv = createTestEnv();
    env = testEnv.env;
    eventLoop = testEnv.eventLoop;
  });

  it('two peer connections in the same process negotiate and exchange a real data-channel message', async () => {
    runInEnv(`
      var pcA = new RTCPeerConnection();
      var pcB = new RTCPeerConnection();
      var dcA = pcA.createDataChannel('chat');
      var dcBRef = null;
      var openedA = false;
      var openedB = false;
      var receivedOnB = '';
      var negotiationError = '';

      dcA.onopen = function() { openedA = true; };
      pcB.ondatachannel = function(ev) {
        dcBRef = ev.channel;
        dcBRef.onopen = function() { openedB = true; };
        dcBRef.onmessage = function(msgEv) { receivedOnB = msgEv.data; };
      };

      pcA.createOffer().then(function(offer) {
        pcA.setLocalDescription(offer).then(function() {
          pcB.setRemoteDescription(offer).then(function() {
            pcB.createAnswer().then(function(answer) {
              pcB.setLocalDescription(answer).then(function() {
                pcA.setRemoteDescription(answer).catch(function(e) { negotiationError = String(e); });
              }).catch(function(e) { negotiationError = String(e); });
            }).catch(function(e) { negotiationError = String(e); });
          }).catch(function(e) { negotiationError = String(e); });
        }).catch(function(e) { negotiationError = String(e); });
      }).catch(function(e) { negotiationError = String(e); });
      false;
    `, env, eventLoop);

    // Real work happens here: ICE gathering (host candidates, no STUN server
    // configured so no network round trip needed), then a real STUN
    // Binding Request/Response over loopback UDP for the connectivity
    // check, then the data channel's open handshake. Generous but bounded
    // real-time budget, pumped in steps so both real timers and the
    // engine's own microtask queue get to run.
    await pump(eventLoop, 1200, 6);

    const negErr = runInEnv(`negotiationError;`, env, eventLoop);
    expect(negErr.value).toBe('');

    const states = runInEnv(`pcA.iceConnectionState + '|' + pcB.iceConnectionState;`, env, eventLoop);
    expect(states.value).toBe('connected|connected');

    const opened = runInEnv(`openedA + '|' + openedB;`, env, eventLoop);
    expect(opened.value).toBe('true|true');

    runInEnv(`dcA.send('hello from A');`, env, eventLoop);
    await pump(eventLoop, 400, 3);

    const received = runInEnv(`receivedOnB;`, env, eventLoop);
    expect(received.value).toBe('hello from A');
  }, 8000);

  it('fires icecandidate events with real candidate strings during setLocalDescription', async () => {
    runInEnv(`
      var pc = new RTCPeerConnection();
      var candidates = [];
      var gatheringDone = false;
      pc.onicecandidate = function(ev) {
        if (ev.candidate === null) { gatheringDone = true; }
        else { candidates.push(ev.candidate.candidate); }
      };
      pc.createOffer().then(function(offer) { pc.setLocalDescription(offer); });
      false;
    `, env, eventLoop);

    await pump(eventLoop, 600, 4);

    const done = runInEnv(`gatheringDone;`, env, eventLoop);
    expect(done.value).toBe(true);

    const count = runInEnv(`candidates.length;`, env, eventLoop);
    expect(typeof count.value).toBe('number');
    // Every emitted candidate string should be well-formed SDP candidate syntax.
    const shapesOk = runInEnv(`
      candidates.every(function(c) { return c.indexOf('candidate:') === 0 && c.indexOf('typ host') !== -1; });
    `, env, eventLoop);
    if ((count.value as number) > 0) {
      expect(shapesOk.value).toBe(true);
    }
  }, 5000);
});
