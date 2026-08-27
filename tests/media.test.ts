import { describe, it, expect, beforeEach, vi } from 'vitest';

import { AudioElement } from '../src/browser/media/audio';
import { VideoElement, KNOWN_QUALITIES } from '../src/browser/media/video';
import { MediaSource, SourceBufferImpl } from '../src/browser/media/media-source';
import { MediaKeys, MediaKeySessionImpl, MediaKeySystemAccessImpl, requestMediaKeySystemAccess, isKeySystemSupported } from '../src/browser/media/eme';
import { AudioContextImpl, AudioParam, AudioBufferImpl, OscillatorNode, GainNode, AnalyserNode } from '../src/browser/media/webaudio';
import { VideoDecoderImpl, AudioDecoderImpl, VideoEncoderImpl, AudioEncoderImpl, isCodecSupported } from '../src/browser/media/webcodecs';

/* ============================================================
   1. Audio
   ============================================================ */
describe('AudioElement', () => {
  let audio: AudioElement;

  beforeEach(() => {
    audio = new AudioElement();
  });

  it('starts with default state', () => {
    expect(audio.paused).toBe(true);
    expect(audio.ended).toBe(false);
    expect(audio.volume).toBe(1);
    expect(audio.muted).toBe(false);
    expect(audio.playbackRate).toBe(1);
    expect(audio.src).toBe('');
  });

  it('load sets src and transitions state', () => {
    expect(audio.load('https://example.com/audio.mp3')).toBe(true);
    expect(audio.src).toBe('https://example.com/audio.mp3');
    expect(audio.readyState).toBe('metadata');
  });

  it('load returns false for empty url', () => {
    expect(audio.load('')).toBe(false);
  });

  it('play starts playback', () => {
    audio.load('https://example.com/audio.mp3');
    expect(audio.play()).toBe(true);
    expect(audio.paused).toBe(false);
  });

  it('play returns false without src', () => {
    expect(audio.play()).toBe(false);
  });

  it('pause pauses playback', () => {
    audio.load('https://example.com/audio.mp3');
    audio.play();
    expect(audio.pause()).toBe(true);
    expect(audio.paused).toBe(true);
  });

  it('stop resets position', () => {
    audio.load('https://example.com/audio.mp3');
    audio.play();
    audio.stop();
    expect(audio.paused).toBe(true);
    expect(audio.ended).toBe(false);
  });

  it('seek changes currentTime', () => {
    audio.load('https://example.com/audio.mp3');
    expect(audio.seek(10)).toBe(true);
    expect(audio.currentTime).toBe(10);
  });

  it('seek returns false for invalid time', () => {
    audio.load('https://example.com/audio.mp3');
    expect(audio.seek(-1)).toBe(false);
  });

  it('setVolume clamps to 0-1', () => {
    audio.setVolume(0.5);
    expect(audio.volume).toBe(0.5);
    audio.setVolume(2);
    expect(audio.volume).toBe(1);
    audio.setVolume(-1);
    expect(audio.volume).toBe(0);
  });

  it('setMuted toggles mute', () => {
    audio.setMuted(true);
    expect(audio.muted).toBe(true);
    audio.setMuted(false);
    expect(audio.muted).toBe(false);
  });

  it('setPlaybackRate clamps to valid range', () => {
    audio.setPlaybackRate(2);
    expect(audio.playbackRate).toBe(2);
    audio.setPlaybackRate(0);
    expect(audio.playbackRate).toBe(0.0625);
    audio.setPlaybackRate(20);
    expect(audio.playbackRate).toBe(16);
  });

  it('emits load event', () => {
    const handler = vi.fn();
    audio.onEvent(handler);
    audio.load('https://example.com/audio.mp3');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'load' }));
  });

  it('emits play event', () => {
    const handler = vi.fn();
    audio.onEvent(handler);
    audio.load('https://example.com/audio.mp3');
    audio.play();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'play' }));
  });

  it('emits ended event when playback completes', async () => {
    const handler = vi.fn();
    audio.onEvent(handler);
    audio.load('https://example.com/short.mp3');
    // Wait for canplay to fire so duration is set
    await new Promise(r => setTimeout(r, 150));
    // Seek to just before the end so the next tick triggers ended
    audio.seek(audio.duration - 0.1);
    audio.play();
    await new Promise(r => setTimeout(r, 500));
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ended' }));
  });

  it('dispose cleans up', () => {
    audio.load('https://example.com/audio.mp3');
    audio.dispose();
    expect(audio.src).toBe('');
    expect(audio.paused).toBe(true);
  });

  it('onEvent unsubscribe works', () => {
    const handler = vi.fn();
    const unsub = audio.onEvent(handler);
    audio.load('https://example.com/audio.mp3');
    expect(handler).toHaveBeenCalled();
    unsub();
    handler.mockClear();
    audio.load('https://other.com/audio.mp3');
    expect(handler).not.toHaveBeenCalled();
  });
});

/* ============================================================
   2. Video
   ============================================================ */
describe('VideoElement', () => {
  let video: VideoElement;

  beforeEach(() => {
    video = new VideoElement();
  });

  it('starts with default state', () => {
    expect(video.paused).toBe(true);
    expect(video.volume).toBe(1);
    expect(video.videoWidth).toBe(0);
    expect(video.videoHeight).toBe(0);
  });

  it('load sets src and metadata', () => {
    expect(video.load('https://example.com/video.mp4')).toBe(true);
    expect(video.src).toBe('https://example.com/video.mp4');
    expect(video.videoWidth).toBeGreaterThan(0);
    expect(video.videoHeight).toBeGreaterThan(0);
  });

  it('has text tracks after load', () => {
    video.load('https://example.com/video.mp4');
    expect(video.textTracks.length).toBeGreaterThan(0);
  });

  it('has audio tracks after load', () => {
    video.load('https://example.com/video.mp4');
    expect(video.audioTracks.length).toBeGreaterThan(0);
  });

  it('has video tracks after load', () => {
    video.load('https://example.com/video.mp4');
    expect(video.videoTracks.length).toBeGreaterThan(0);
  });

  it('qualities returns known list', () => {
    expect(video.qualities).toEqual(KNOWN_QUALITIES);
  });

  it('setQuality changes current quality', () => {
    expect(video.setQuality('1080p')).toBe(true);
    expect(video.currentQuality).toBe('1080p');
  });

  it('setQuality returns false for unknown', () => {
    expect(video.setQuality('unknown')).toBe(false);
  });

  it('setFullscreen emits event', () => {
    const handler = vi.fn();
    video.onEvent(handler);
    video.setFullscreen(true);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'fullscreen' }));
  });

  it('play starts playback', () => {
    video.load('https://example.com/video.mp4');
    expect(video.play()).toBe(true);
    expect(video.paused).toBe(false);
  });

  it('seek changes currentTime', () => {
    video.load('https://example.com/video.mp4');
    expect(video.seek(30)).toBe(true);
    expect(video.currentTime).toBe(30);
  });

  it('dispose cleans up', () => {
    video.load('https://example.com/video.mp4');
    video.dispose();
    expect(video.src).toBe('');
    expect(video.paused).toBe(true);
  });
});

/* ============================================================
   3. Media Source Extensions
   ============================================================ */
describe('MediaSource', () => {
  let ms: MediaSource;

  beforeEach(() => {
    ms = new MediaSource();
  });

  it('starts closed', () => {
    expect(ms.readyState).toBe('closed');
  });

  it('create transitions to open', () => {
    const url = ms.create('test-source');
    expect(url).toBe('test-source');
    expect(ms.readyState).toBe('open');
  });

  it('addSourceBuffer creates buffer', () => {
    ms.create('test');
    const buf = ms.addSourceBuffer('video/mp4; codecs="avc1.4D401E"');
    expect(buf).toBeDefined();
    expect(buf.mimeType).toBe('video/mp4; codecs="avc1.4D401E"');
  });

  it('endOfStream sets ended state', () => {
    ms.create('test');
    ms.endOfStream();
    expect(ms.readyState).toBe('ended');
  });

  it('sourceBuffers returns added buffers', () => {
    ms.create('test');
    ms.addSourceBuffer('audio/mp4; codecs="mp4a.40.2"');
    expect(ms.sourceBuffers).toHaveLength(1);
  });

  it('removeSourceBuffer removes buffer', () => {
    ms.create('test');
    const buf = ms.addSourceBuffer('video/mp4');
    ms.removeSourceBuffer(buf);
    expect(ms.sourceBuffers).toHaveLength(0);
  });

  it('setDuration sets duration', () => {
    ms.setDuration(120);
    expect(ms.duration).toBe(120);
  });

  it('emits sourceopen event', () => {
    const handler = vi.fn();
    ms.onEvent(handler);
    ms.create('test');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'sourceopen' }));
  });

  it('dispose cleans up', () => {
    ms.create('test');
    ms.addSourceBuffer('video/mp4');
    ms.dispose();
    expect(ms.readyState).toBe('closed');
    expect(ms.sourceBuffers).toHaveLength(0);
  });
});

describe('SourceBuffer', () => {
  it('appends data and updates buffered ranges', () => new Promise<void>((resolve) => {
    const buf = new SourceBufferImpl('video/mp4');
    expect(buf.updating).toBe(false);
    buf.appendBuffer(new Uint8Array([0, 1, 2, 3]));
    expect(buf.updating).toBe(true);
    setTimeout(() => {
      expect(buf.updating).toBe(false);
      expect(buf.buffered.length).toBeGreaterThan(0);
      resolve();
    }, 100);
  }));

  it('remove filters buffered ranges', () => new Promise<void>((resolve) => {
    const buf = new SourceBufferImpl('video/mp4');
    buf.appendBuffer(new Uint8Array(1024));
    setTimeout(() => {
      buf.remove(0, 0.5);
      setTimeout(() => {
        expect(buf.updating).toBe(false);
        resolve();
      }, 100);
    }, 100);
  }));

  it('abort stops updating', () => {
    const buf = new SourceBufferImpl('video/mp4');
    buf.appendBuffer(new Uint8Array(1));
    buf.abort();
    expect(buf.updating).toBe(false);
  });

  it('setMode changes mode', () => {
    const buf = new SourceBufferImpl('video/mp4');
    buf.setMode('sequence');
    expect(buf.mode).toBe('sequence');
  });

  it('dispose cleans up', () => {
    const buf = new SourceBufferImpl('video/mp4');
    buf.appendBuffer(new Uint8Array(1));
    buf.dispose();
    expect(buf.buffered).toHaveLength(0);
  });
});

/* ============================================================
   4. Encrypted Media Extensions
   ============================================================ */
describe('EME', () => {
  it('isKeySystemSupported returns true for known systems', () => {
    expect(isKeySystemSupported('com.widevine.alpha', {
      initDataTypes: ['cenc'],
      audioCapabilities: [{ contentType: 'audio/mp4', robustness: '' }],
      videoCapabilities: [{ contentType: 'video/mp4', robustness: '' }],
      distinctiveIdentifier: 'optional',
      persistentState: 'optional',
      sessionTypes: ['temporary'],
      label: '',
    })).toBe(true);
  });

  it('isKeySystemSupported returns false for unknown', () => {
    expect(isKeySystemSupported('com.fake.drm', {
      initDataTypes: ['cenc'], audioCapabilities: [], videoCapabilities: [],
      distinctiveIdentifier: 'optional', persistentState: 'optional',
      sessionTypes: ['temporary'], label: '',
    })).toBe(false);
  });

  it('requestMediaKeySystemAccess succeeds for supported system', async () => {
    const access = await requestMediaKeySystemAccess('org.w3.clearkey', [
      {
        initDataTypes: ['cenc'],
        audioCapabilities: [{ contentType: 'audio/mp4', robustness: '' }],
        videoCapabilities: [{ contentType: 'video/mp4', robustness: '' }],
        distinctiveIdentifier: 'optional',
        persistentState: 'optional',
        sessionTypes: ['temporary'],
        label: '',
      },
    ]);
    expect(access.keySystem).toBe('org.w3.clearkey');
    const config = access.getConfiguration();
    expect(config.initDataTypes).toContain('cenc');
  });

  it('requestMediaKeySystemAccess rejects for unsupported', async () => {
    await expect(requestMediaKeySystemAccess('com.fake.drm', [
      {
        initDataTypes: ['cenc'], audioCapabilities: [], videoCapabilities: [],
        distinctiveIdentifier: 'optional', persistentState: 'optional',
        sessionTypes: ['temporary'], label: '',
      },
    ])).rejects.toThrow();
  });

  it('MediaKeys creates sessions', () => {
    const keys = new MediaKeys('org.w3.clearkey');
    const session = keys.createSession('temporary');
    expect(session.sessionId).toBeDefined();
    expect(session.keyStatuses.size).toBe(0);
  });

  it('MediaKeySession generateRequest sets key status', async () => {
    const keys = new MediaKeys('org.w3.clearkey');
    const session = keys.createSession();
    const initData = new Uint8Array(16).buffer;
    await session.generateRequest('cenc', initData);
    expect(session.keyStatuses.size).toBe(1);
    const statuses = [...session.keyStatuses.values()];
    expect(statuses[0]).toBe('status-pending');
  });

  it('MediaKeySession close resolves closed promise', async () => {
    const keys = new MediaKeys('org.w3.clearkey');
    const session = keys.createSession();
    await session.close();
    await expect(session.closed).resolves.toBeUndefined();
  });

  it('MediaKeys setServerCertificate returns true', async () => {
    const keys = new MediaKeys('org.w3.clearkey');
    const result = await keys.setServerCertificate(new Uint8Array(32).buffer);
    expect(result).toBe(true);
  });
});

/* ============================================================
   5. WebAudio
   ============================================================ */
describe('AudioContext', () => {
  let ctx: AudioContextImpl;

  beforeEach(() => {
    ctx = new AudioContextImpl();
  });

  it('starts running', () => {
    expect(ctx.state).toBe('running');
    expect(ctx.sampleRate).toBe(44100);
    expect(ctx.currentTime).toBeGreaterThanOrEqual(0);
  });

  it('suspend pauses state', async () => {
    await ctx.suspend();
    expect(ctx.state).toBe('suspended');
  });

  it('resume restarts after suspend', async () => {
    await ctx.suspend();
    await ctx.resume();
    expect(ctx.state).toBe('running');
  });

  it('close transitions to closed', async () => {
    await ctx.close();
    expect(ctx.state).toBe('closed');
  });

  it('close is idempotent', async () => {
    await ctx.close();
    await ctx.close();
    expect(ctx.state).toBe('closed');
  });

  it('createOscillator returns OscillatorNode', () => {
    const osc = ctx.createOscillator();
    expect(osc.type).toBe('sine');
    expect(osc.frequency.value).toBe(440);
  });

  it('createGain returns GainNode with gain 1', () => {
    const gain = ctx.createGain();
    expect(gain.gain.value).toBe(1);
  });

  it('createAnalyser returns AnalyserNode', () => {
    const an = ctx.createAnalyser();
    expect(an.fftSize).toBe(2048);
    expect(an.frequencyBinCount).toBe(1024);
  });

  it('createBiquadFilter returns filter', () => {
    const filter = ctx.createBiquadFilter();
    expect(filter.type).toBe('lowpass');
    expect(filter.frequency.value).toBe(350);
  });

  it('createDelay returns delay node', () => {
    const delay = ctx.createDelay(2);
    expect(delay.delayTime.value).toBe(0);
  });

  it('createConvolver returns convolver', () => {
    const conv = ctx.createConvolver();
    expect(conv.normalize).toBe(true);
  });

  it('createBuffer creates audio buffer', () => {
    const buf = ctx.createBuffer(2, 44100, 44100);
    expect(buf.numberOfChannels).toBe(2);
    expect(buf.duration).toBe(1);
    expect(buf.sampleRate).toBe(44100);
  });

  it('createBufferSource returns source', () => {
    const src = ctx.createBufferSource();
    expect(src.playbackRate.value).toBe(1);
    expect(src.loop).toBe(false);
  });

  it('destination has maxChannelCount', () => {
    expect(ctx.destination.maxChannelCount).toBe(2);
  });

  it('listener has default position', () => {
    expect(ctx.listener.positionX).toBe(0);
    expect(ctx.listener.positionY).toBe(0);
    expect(ctx.listener.positionZ).toBe(0);
  });

  it('listener setPosition updates position', () => {
    ctx.listener.setPosition(1, 2, 3);
    expect(ctx.listener.positionX).toBe(1);
    expect(ctx.listener.positionY).toBe(2);
    expect(ctx.listener.positionZ).toBe(3);
  });

  it('creates dynamics compressor', () => {
    const comp = ctx.createDynamicsCompressor();
    expect(comp.threshold.value).toBe(-24);
    expect(comp.ratio.value).toBe(12);
  });

  it('creates wave shaper', () => {
    const ws = ctx.createWaveShaper();
    expect(ws.curve).toBeNull();
    expect(ws.oversample).toBe('none');
  });

  it('creates constant source', () => {
    const cs = ctx.createConstantSource();
    expect(cs.offset.value).toBe(1);
  });

  it('creates stereo panner', () => {
    const sp = ctx.createStereoPanner();
    expect(sp.pan.value).toBe(0);
  });

  it('emits statechange on close', () => {
    const handler = vi.fn();
    ctx.onEvent(handler);
    ctx.close();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'statechange' }));
  });

  it('dispose cleans up', () => {
    ctx.dispose();
    expect(ctx.state).toBe('closed');
  });
});

describe('AudioParam', () => {
  it('has default value', () => {
    const p = new AudioParam(0.5, 0, 1);
    expect(p.value).toBe(0.5);
  });

  it('setValueAtTime changes value', () => {
    const p = new AudioParam(0);
    p.setValueAtTime(0.75, 0);
    expect(p.value).toBe(0.75);
  });

  it('clamps to range', () => {
    const p = new AudioParam(0.5, 0, 1);
    p.setValue(2);
    expect(p.value).toBe(1);
    p.setValue(-1);
    expect(p.value).toBe(0);
  });

  it('linearRampToValueAtTime sets value', () => {
    const p = new AudioParam(0);
    p.linearRampToValueAtTime(1, 1);
    expect(p.value).toBe(1);
  });
});

describe('AudioBuffer', () => {
  it('stores channel data', () => {
    const buf = new AudioBufferImpl(2, 4, 44100);
    expect(buf.numberOfChannels).toBe(2);
    expect(buf.length).toBe(4);
    expect(buf.sampleRate).toBe(44100);
    const channel = buf.getChannelData(0);
    expect(channel.length).toBe(4);
  });

  it('copyToChannel and copyFromChannel work', () => {
    const buf = new AudioBufferImpl(1, 4, 44100);
    const source = new Float32Array([1, 2, 3, 4]);
    buf.copyToChannel(source, 0);
    const dest = new Float32Array(4);
    buf.copyFromChannel(dest, 0);
    expect(dest[0]).toBe(1);
    expect(dest[3]).toBe(4);
  });
});

describe('OscillatorNode', () => {
  it('changes type', () => {
    const osc = new OscillatorNode();
    osc.setType('square');
    expect(osc.type).toBe('square');
  });

  it('frequency can be modified', () => {
    const osc = new OscillatorNode();
    osc.frequency.setValue(880);
    expect(osc.frequency.value).toBe(880);
  });

  it('stop emits ended', () => {
    const osc = new OscillatorNode();
    const handler = vi.fn();
    osc.onEvent(handler);
    osc.stop();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ended' }));
  });
});

describe('GainNode', () => {
  it('gain starts at 1', () => {
    const gain = new GainNode();
    expect(gain.gain.value).toBe(1);
  });

  it('connect returns destination', () => {
    const gain = new GainNode();
    const dest = new GainNode();
    const result = gain.connect(dest);
    expect(result).toBe(dest);
  });

  it('disconnect removes connection', () => {
    const gain = new GainNode();
    const dest = new GainNode();
    gain.connect(dest);
    gain.disconnect(dest);
  });
});

/* ============================================================
   6. WebCodecs
   ============================================================ */
describe('isCodecSupported', () => {
  it('returns true for known codecs', () => {
    expect(isCodecSupported('avc1.4D401E')).toBe(true);
    expect(isCodecSupported('vp8')).toBe(true);
    expect(isCodecSupported('opus')).toBe(true);
  });

  it('returns false for unknown codecs', () => {
    expect(isCodecSupported('x264')).toBe(false);
    expect(isCodecSupported('fake')).toBe(false);
  });
});

describe('VideoDecoder', () => {
  let decoder: VideoDecoderImpl;

  beforeEach(() => {
    decoder = new VideoDecoderImpl();
  });

  it('starts unconfigured', () => {
    expect(decoder.state).toBe('unconfigured');
  });

  it('configure transitions to configured', () => {
    decoder.configure({ codec: 'vp8' });
    expect(decoder.state).toBe('configured');
  });

  it('configure with unsupported codec emits error', () => {
    const handler = vi.fn();
    decoder.onEvent(handler);
    decoder.configure({ codec: 'fake' });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }));
  });

  it('decode emits output', () => new Promise<void>((resolve) => {
    const handler = vi.fn();
    decoder.onEvent(handler);
    decoder.configure({ codec: 'vp8' });
    const chunk = { type: 'key' as const, timestamp: 0, duration: 33, byteLength: 100, copyTo: () => {} };
    decoder.decode(chunk);
    setTimeout(() => {
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'output' }));
      resolve();
    }, 150);
  }));

  it('reset returns to unconfigured', () => {
    decoder.configure({ codec: 'vp8' });
    decoder.reset();
    expect(decoder.state).toBe('unconfigured');
  });

  it('flush resolves', async () => {
    await expect(decoder.flush()).resolves.toBeUndefined();
  });

  it('dispose transitions to closed', () => {
    decoder.dispose();
    expect(decoder.state).toBe('closed');
  });
});

describe('AudioDecoder', () => {
  let decoder: AudioDecoderImpl;

  beforeEach(() => {
    decoder = new AudioDecoderImpl();
  });

  it('configure with opus succeeds', () => {
    decoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 });
    expect(decoder.state).toBe('configured');
  });

  it('decode emits output', () => new Promise<void>((resolve) => {
    const handler = vi.fn();
    decoder.onEvent(handler);
    decoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 });
    const chunk = { type: 'key' as const, timestamp: 0, duration: 100, byteLength: 50, copyTo: () => {} };
    decoder.decode(chunk);
    setTimeout(() => {
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'output' }));
      resolve();
    }, 150);
  }));

  it('dispose cleans up', () => {
    decoder.dispose();
    expect(decoder.state).toBe('closed');
  });
});

describe('VideoEncoder', () => {
  let encoder: VideoEncoderImpl;

  beforeEach(() => {
    encoder = new VideoEncoderImpl();
  });

  it('configure with VP9 succeeds', () => {
    encoder.configure({ codec: 'vp09.00.10.08', width: 1920, height: 1080, bitrate: 5000000 });
    expect(encoder.state).toBe('configured');
  });

  it('encode emits output', () => new Promise<void>((resolve) => {
    const handler = vi.fn();
    encoder.onEvent(handler);
    encoder.configure({ codec: 'vp8', width: 640, height: 480, bitrate: 1000000 });
    encoder.encode({ timestamp: 0, duration: 33, codedWidth: 640, codedHeight: 480, displayWidth: 640, displayHeight: 480, format: 'NV12', copyTo: async () => [], close: () => {} });
    setTimeout(() => {
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'output' }));
      resolve();
    }, 150);
  }));

  it('flush resolves', async () => {
    await expect(encoder.flush()).resolves.toBeUndefined();
  });

  it('dispose cleans up', () => {
    encoder.dispose();
    expect(encoder.state).toBe('closed');
  });
});

describe('AudioEncoder', () => {
  let encoder: AudioEncoderImpl;

  beforeEach(() => {
    encoder = new AudioEncoderImpl();
  });

  it('configure with flac succeeds', () => {
    encoder.configure({ codec: 'flac', sampleRate: 44100, numberOfChannels: 2, bitrate: 320000 });
    expect(encoder.state).toBe('configured');
  });

  it('dispose cleans up', () => {
    encoder.dispose();
    expect(encoder.state).toBe('closed');
  });
});
