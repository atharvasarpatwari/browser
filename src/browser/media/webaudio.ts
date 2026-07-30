import type { IDisposable } from '../../app/dependency-container';

interface IAudioContext extends IDisposable {
  get currentTime(): number;
  get sampleRate(): number;
  get state(): AudioContextState;
  get baseLatency(): number;
  get outputLatency(): number;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  createOscillator(): IOscillatorNode;
  createGain(): IGainNode;
  createAnalyser(): IAnalyserNode;
  createBiquadFilter(): IBiquadFilterNode;
  createDelay(maxDelay?: number): IDelayNode;
  createConvolver(): IConvolverNode;
  createChannelMerger(count?: number): IChannelMergerNode;
  createChannelSplitter(count?: number): IChannelSplitterNode;
  createDynamicsCompressor(): IDynamicsCompressorNode;
  createWaveShaper(): IWaveShaperNode;
  createConstantSource(): IConstantSourceNode;
  createStereoPanner(): IStereoPannerNode;
  createBuffer(channels: number, length: number, sampleRate: number): IAudioBuffer;
  createBufferSource(): IAudioBufferSourceNode;
  createMediaStreamSource(stream: unknown): IMediaStreamAudioSourceNode;
  createMediaStreamDestination(): IMediaStreamAudioDestinationNode;
  get destination(): IAudioDestinationNode;
  get listener(): IAudioListener;
  onEvent(handler: AudioContextEventHandler): () => void;
}

type AudioContextState = 'running' | 'suspended' | 'closed';
type AudioContextEventKind = 'statechange' | 'error';
interface AudioContextEvent {
  readonly kind: AudioContextEventKind;
  readonly data?: Record<string, unknown>;
}
type AudioContextEventHandler = (event: AudioContextEvent) => void;

type AudioNodeChannelCountMode = 'max' | 'clamped-max' | 'explicit';
type AudioNodeChannelInterpretation = 'speakers' | 'discrete';

interface IAudioNode extends IDisposable {
  connect(destination: IAudioNode): IAudioNode;
  disconnect(destination?: IAudioNode): void;
  get numberOfInputs(): number;
  get numberOfOutputs(): number;
  get channelCount(): number;
  setChannelCount(count: number): void;
  get channelCountMode(): AudioNodeChannelCountMode;
  setChannelCountMode(mode: AudioNodeChannelCountMode): void;
  get channelInterpretation(): AudioNodeChannelInterpretation;
  setChannelInterpretation(interp: AudioNodeChannelInterpretation): void;
}

interface IAudioDestinationNode extends IAudioNode {
  get maxChannelCount(): number;
}

interface IAudioListener {
  get positionX(): number;
  get positionY(): number;
  get positionZ(): number;
  get forwardX(): number;
  get forwardY(): number;
  get forwardZ(): number;
  get upX(): number;
  get upY(): number;
  get upZ(): number;
  setPosition(x: number, y: number, z: number): void;
  setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void;
}

interface IAudioParam extends IDisposable {
  get value(): number;
  setValue(value: number): void;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
  exponentialRampToValueAtTime(value: number, time: number): void;
  setTargetAtTime(target: number, time: number, timeConstant: number): void;
  setValueCurveAtTime(values: Float32Array, time: number, duration: number): void;
  cancelScheduledValues(time: number): void;
  cancelAndHoldAtTime(time: number): void;
  get defaultValue(): number;
  get minValue(): number;
  get maxValue(): number;
}

interface IAudioBuffer {
  get sampleRate(): number;
  get length(): number;
  get duration(): number;
  get numberOfChannels(): number;
  getChannelData(channel: number): Float32Array;
  copyFromChannel(destination: Float32Array, channelNumber: number, startInChannel?: number): void;
  copyToChannel(source: Float32Array, channelNumber: number, startInChannel?: number): void;
}

interface IOscillatorNode extends IAudioNode {
  get type(): OscillatorType;
  setType(type: OscillatorType): void;
  get frequency(): IAudioParam;
  get detune(): IAudioParam;
  start(when?: number): void;
  stop(when?: number): void;
  onEvent(handler: OscillatorEventHandler): () => void;
}
type OscillatorType = 'sine' | 'square' | 'sawtooth' | 'triangle' | 'custom';
type OscillatorEventKind = 'ended';
interface OscillatorEvent { readonly kind: OscillatorEventKind; }
type OscillatorEventHandler = (event: OscillatorEvent) => void;

interface IGainNode extends IAudioNode {
  get gain(): IAudioParam;
}

interface IAnalyserNode extends IAudioNode {
  get fftSize(): number;
  setFftSize(size: number): void;
  get frequencyBinCount(): number;
  get minDecibels(): number;
  setMinDecibels(db: number): void;
  get maxDecibels(): number;
  setMaxDecibels(db: number): void;
  get smoothingTimeConstant(): number;
  setSmoothingTimeConstant(c: number): void;
  getFloatFrequencyData(array: Float32Array): void;
  getByteFrequencyData(array: Uint8Array): void;
  getFloatTimeDomainData(array: Float32Array): void;
  getByteTimeDomainData(array: Uint8Array): void;
}

interface IBiquadFilterNode extends IAudioNode {
  get type(): BiquadFilterType;
  setType(type: BiquadFilterType): void;
  get frequency(): IAudioParam;
  get detune(): IAudioParam;
  get Q(): IAudioParam;
  get gain(): IAudioParam;
  getFrequencyResponse(freqHz: Float32Array, magResponse: Float32Array, phaseResponse: Float32Array): void;
}
type BiquadFilterType = 'lowpass' | 'highpass' | 'bandpass' | 'lowshelf' | 'highshelf' | 'peaking' | 'notch' | 'allpass';

interface IDelayNode extends IAudioNode {
  get delayTime(): IAudioParam;
}

interface IConvolverNode extends IAudioNode {
  get buffer(): IAudioBuffer | null;
  setBuffer(buffer: IAudioBuffer | null): void;
  get normalize(): boolean;
  setNormalize(normalize: boolean): void;
}

interface IChannelMergerNode extends IAudioNode {}
interface IChannelSplitterNode extends IAudioNode {}

interface IDynamicsCompressorNode extends IAudioNode {
  get threshold(): IAudioParam;
  get knee(): IAudioParam;
  get ratio(): IAudioParam;
  get attack(): IAudioParam;
  get release(): IAudioParam;
  get reduction(): number;
}

interface IWaveShaperNode extends IAudioNode {
  get curve(): Float32Array | null;
  setCurve(curve: Float32Array | null): void;
  get oversample(): OverSampleType;
  setOversample(type: OverSampleType): void;
}
type OverSampleType = 'none' | '2x' | '4x';

interface IConstantSourceNode extends IAudioNode {
  get offset(): IAudioParam;
  start(when?: number): void;
  stop(when?: number): void;
}

interface IStereoPannerNode extends IAudioNode {
  get pan(): IAudioParam;
}

interface IAudioBufferSourceNode extends IAudioNode {
  get buffer(): IAudioBuffer | null;
  setBuffer(buffer: IAudioBuffer | null): void;
  get playbackRate(): IAudioParam;
  get detune(): IAudioParam;
  get loop(): boolean;
  setLoop(loop: boolean): void;
  get loopStart(): number;
  setLoopStart(start: number): void;
  get loopEnd(): number;
  setLoopEnd(end: number): void;
  start(when?: number, offset?: number, duration?: number): void;
  stop(when?: number): void;
  onEvent(handler: OscillatorEventHandler): () => void;
}

interface IMediaStreamAudioSourceNode extends IAudioNode {}
interface IMediaStreamAudioDestinationNode extends IAudioNode {}

class AudioParam implements IAudioParam {
  private _value: number;
  private _defaultValue: number;
  private _minValue: number;
  private _maxValue: number;

  constructor(defaultValue: number, minValue = -Infinity, maxValue = Infinity) {
    this._value = defaultValue;
    this._defaultValue = defaultValue;
    this._minValue = minValue;
    this._maxValue = maxValue;
  }

  get value(): number { return this._value; }
  get defaultValue(): number { return this._defaultValue; }
  get minValue(): number { return this._minValue; }
  get maxValue(): number { return this._maxValue; }

  setValue(value: number): void { this._value = Math.max(this._minValue, Math.min(this._maxValue, value)); }
  setValueAtTime(value: number, _time: number): void { this._value = value; }
  linearRampToValueAtTime(value: number, _time: number): void { this._value = value; }
  exponentialRampToValueAtTime(value: number, _time: number): void { if (value > 0) this._value = value; }
  setTargetAtTime(target: number, _time: number, _timeConstant: number): void { this._value = target; }
  setValueCurveAtTime(_values: Float32Array, _time: number, _duration: number): void {}
  cancelScheduledValues(_time: number): void {}
  cancelAndHoldAtTime(_time: number): void {}

  dispose(): void {}
}

class AudioBufferImpl implements IAudioBuffer {
  private _sampleRate: number;
  private _length: number;
  private _channels: Float32Array[];
  private _duration: number;

  constructor(channels: number, length: number, sampleRate: number) {
    this._sampleRate = sampleRate;
    this._length = length;
    this._duration = length / sampleRate;
    this._channels = [];
    for (let i = 0; i < channels; i++) {
      this._channels.push(new Float32Array(length));
    }
  }

  get sampleRate(): number { return this._sampleRate; }
  get length(): number { return this._length; }
  get duration(): number { return this._duration; }
  get numberOfChannels(): number { return this._channels.length; }

  getChannelData(channel: number): Float32Array {
    if (channel < 0 || channel >= this._channels.length) throw new Error('Channel out of range');
    return this._channels[channel];
  }

  copyFromChannel(destination: Float32Array, channelNumber: number, startInChannel = 0): void {
    const data = this._channels[channelNumber];
    const len = Math.min(destination.length, data.length - startInChannel);
    for (let i = 0; i < len; i++) destination[i] = data[startInChannel + i];
  }

  copyToChannel(source: Float32Array, channelNumber: number, startInChannel = 0): void {
    const data = this._channels[channelNumber];
    const len = Math.min(source.length, data.length - startInChannel);
    for (let i = 0; i < len; i++) data[startInChannel + i] = source[i];
  }
}

class AudioNodeBase implements IAudioNode {
  protected _outputs: IAudioNode[] = [];
  protected _inputs: IAudioNode[] = [];
  protected _channelCount = 2;
  protected _channelCountMode: AudioNodeChannelCountMode = 'max';
  protected _channelInterpretation: AudioChannelInterpretation = 'speakers';

  get numberOfInputs(): number { return this._inputs.length; }
  get numberOfOutputs(): number { return this._outputs.length; }
  get channelCount(): number { return this._channelCount; }
  get channelCountMode(): AudioNodeChannelCountMode { return this._channelCountMode; }
  get channelInterpretation(): AudioChannelInterpretation { return this._channelInterpretation; }

  setChannelCount(count: number): void { this._channelCount = Math.max(1, count); }
  setChannelCountMode(mode: AudioNodeChannelCountMode): void { this._channelCountMode = mode; }
  setChannelInterpretation(interp: AudioChannelInterpretation): void { this._channelInterpretation = interp; }

  connect(destination: IAudioNode): IAudioNode {
    this._outputs.push(destination);
    return destination;
  }

  disconnect(destination?: IAudioNode): void {
    if (destination) {
      this._outputs = this._outputs.filter(n => n !== destination);
    } else {
      this._outputs = [];
    }
  }

  dispose(): void {
    this._outputs = [];
    this._inputs = [];
  }
}

class AudioDestinationNode extends AudioNodeBase implements IAudioDestinationNode {
  private _maxChannelCount = 2;
  get maxChannelCount(): number { return this._maxChannelCount; }
}

class AudioListenerImpl implements IAudioListener {
  private _positionX = 0; private _positionY = 0; private _positionZ = 0;
  private _forwardX = 0; private _forwardY = 0; private _forwardZ = -1;
  private _upX = 0; private _upY = 1; private _upZ = 0;
  get positionX(): number { return this._positionX; }
  get positionY(): number { return this._positionY; }
  get positionZ(): number { return this._positionZ; }
  get forwardX(): number { return this._forwardX; }
  get forwardY(): number { return this._forwardY; }
  get forwardZ(): number { return this._forwardZ; }
  get upX(): number { return this._upX; }
  get upY(): number { return this._upY; }
  get upZ(): number { return this._upZ; }
  setPosition(x: number, y: number, z: number): void { this._positionX = x; this._positionY = y; this._positionZ = z; }
  setOrientation(fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    this._forwardX = fx; this._forwardY = fy; this._forwardZ = fz;
    this._upX = ux; this._upY = uy; this._upZ = uz;
  }
}

class OscillatorNode extends AudioNodeBase implements IOscillatorNode {
  private _type: OscillatorType = 'sine';
  private _frequency: IAudioParam;
  private _detune: IAudioParam;
  private handlers = new Set<OscillatorEventHandler>();

  constructor() {
    super();
    this._frequency = new AudioParam(440, 0, 22000);
    this._detune = new AudioParam(0, -1200, 1200);
  }

  get type(): OscillatorType { return this._type; }
  get frequency(): IAudioParam { return this._frequency; }
  get detune(): IAudioParam { return this._detune; }

  setType(type: OscillatorType): void { this._type = type; }
  start(_when?: number): void {}
  stop(_when?: number): void { this.emit({ kind: 'ended' }); }

  onEvent(handler: OscillatorEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }
  private emit(event: OscillatorEvent): void {
    for (const h of this.handlers) { try { h(event); } catch { /* swallow */ } }
  }
}

class GainNode extends AudioNodeBase implements IGainNode {
  private _gain: IAudioParam;
  constructor() { super(); this._gain = new AudioParam(1, 0, 1); }
  get gain(): IAudioParam { return this._gain; }
}

class AnalyserNode extends AudioNodeBase implements IAnalyserNode {
  private _fftSize = 2048;
  private _minDecibels = -100;
  private _maxDecibels = -30;
  private _smoothingTimeConstant = 0.8;
  get fftSize(): number { return this._fftSize; }
  get frequencyBinCount(): number { return this._fftSize / 2; }
  get minDecibels(): number { return this._minDecibels; }
  get maxDecibels(): number { return this._maxDecibels; }
  get smoothingTimeConstant(): number { return this._smoothingTimeConstant; }
  setFftSize(size: number): void { this._fftSize = Math.max(32, Math.min(32768, size)); }
  setMinDecibels(db: number): void { this._minDecibels = db; }
  setMaxDecibels(db: number): void { this._maxDecibels = db; }
  setSmoothingTimeConstant(c: number): void { this._smoothingTimeConstant = Math.max(0, Math.min(1, c)); }
  getFloatFrequencyData(array: Float32Array): void { array.fill(-Infinity); }
  getByteFrequencyData(array: Uint8Array): void { array.fill(0); }
  getFloatTimeDomainData(array: Float32Array): void { array.fill(0); }
  getByteTimeDomainData(array: Uint8Array): void { array.fill(128); }
}

class BiquadFilterNode extends AudioNodeBase implements IBiquadFilterNode {
  private _type: BiquadFilterType = 'lowpass';
  private _frequency: IAudioParam;
  private _detune: IAudioParam;
  private _Q: IAudioParam;
  private _gain: IAudioParam;
  constructor() {
    super();
    this._frequency = new AudioParam(350, 0, 22000);
    this._detune = new AudioParam(0, -1200, 1200);
    this._Q = new AudioParam(1, 0.0001, 1000);
    this._gain = new AudioParam(0, -40, 40);
  }
  get type(): BiquadFilterType { return this._type; }
  get frequency(): IAudioParam { return this._frequency; }
  get detune(): IAudioParam { return this._detune; }
  get Q(): IAudioParam { return this._Q; }
  get gain(): IAudioParam { return this._gain; }
  setType(type: BiquadFilterType): void { this._type = type; }
  getFrequencyResponse(_freqHz: Float32Array, magResponse: Float32Array, _phaseResponse: Float32Array): void {
    magResponse.fill(1);
  }
}

class DelayNode extends AudioNodeBase implements IDelayNode {
  private _delayTime: IAudioParam;
  constructor(maxDelay = 1) { super(); this._delayTime = new AudioParam(0, 0, maxDelay); }
  get delayTime(): IAudioParam { return this._delayTime; }
}

class ConvolverNode extends AudioNodeBase implements IConvolverNode {
  private _buffer: IAudioBuffer | null = null;
  private _normalize = true;
  get buffer(): IAudioBuffer | null { return this._buffer; }
  get normalize(): boolean { return this._normalize; }
  setBuffer(buffer: IAudioBuffer | null): void { this._buffer = buffer; }
  setNormalize(normalize: boolean): void { this._normalize = normalize; }
}

class ChannelMergerNode extends AudioNodeBase implements IChannelMergerNode {
  constructor(count = 2) { super(); this._channelCount = count; }
}
class ChannelSplitterNode extends AudioNodeBase implements IChannelSplitterNode {
  constructor(count = 2) { super(); this._channelCount = count; }
}

class DynamicsCompressorNode extends AudioNodeBase implements IDynamicsCompressorNode {
  private _threshold: IAudioParam; private _knee: IAudioParam;
  private _ratio: IAudioParam; private _attack: IAudioParam;
  private _release: IAudioParam; private _reduction = 0;
  constructor() {
    super();
    this._threshold = new AudioParam(-24, -100, 0);
    this._knee = new AudioParam(30, 0, 40);
    this._ratio = new AudioParam(12, 1, 20);
    this._attack = new AudioParam(0.003, 0, 1);
    this._release = new AudioParam(0.25, 0, 1);
  }
  get threshold(): IAudioParam { return this._threshold; }
  get knee(): IAudioParam { return this._knee; }
  get ratio(): IAudioParam { return this._ratio; }
  get attack(): IAudioParam { return this._attack; }
  get release(): IAudioParam { return this._release; }
  get reduction(): number { return this._reduction; }
}

class WaveShaperNode extends AudioNodeBase implements IWaveShaperNode {
  private _curve: Float32Array | null = null;
  private _oversample: OverSampleType = 'none';
  get curve(): Float32Array | null { return this._curve; }
  get oversample(): OverSampleType { return this._oversample; }
  setCurve(curve: Float32Array | null): void { this._curve = curve; }
  setOversample(type: OverSampleType): void { this._oversample = type; }
}

class ConstantSourceNode extends AudioNodeBase implements IConstantSourceNode {
  private _offset: IAudioParam;
  constructor() { super(); this._offset = new AudioParam(1); }
  get offset(): IAudioParam { return this._offset; }
  start(_when?: number): void {}
  stop(_when?: number): void {}
}

class StereoPannerNode extends AudioNodeBase implements IStereoPannerNode {
  private _pan: IAudioParam;
  constructor() { super(); this._pan = new AudioParam(0, -1, 1); }
  get pan(): IAudioParam { return this._pan; }
}

class AudioBufferSourceNode extends AudioNodeBase implements IAudioBufferSourceNode {
  private _buffer: IAudioBuffer | null = null;
  private _playbackRate: IAudioParam;
  private _detune: IAudioParam;
  private _loop = false;
  private _loopStart = 0;
  private _loopEnd = 0;
  private handlers = new Set<OscillatorEventHandler>();

  constructor() {
    super();
    this._playbackRate = new AudioParam(1, 0.0625, 16);
    this._detune = new AudioParam(0, -1200, 1200);
  }
  get buffer(): IAudioBuffer | null { return this._buffer; }
  get playbackRate(): IAudioParam { return this._playbackRate; }
  get detune(): IAudioParam { return this._detune; }
  get loop(): boolean { return this._loop; }
  get loopStart(): number { return this._loopStart; }
  get loopEnd(): number { return this._loopEnd; }
  setBuffer(buffer: IAudioBuffer | null): void { this._buffer = buffer; }
  setLoop(loop: boolean): void { this._loop = loop; }
  setLoopStart(start: number): void { this._loopStart = start; }
  setLoopEnd(end: number): void { this._loopEnd = end; }
  start(_when?: number, _offset?: number, _duration?: number): void {}
  stop(_when?: number): void { this.emit({ kind: 'ended' }); }

  onEvent(handler: OscillatorEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }
  private emit(event: OscillatorEvent): void {
    for (const h of this.handlers) { try { h(event); } catch { /* swallow */ } }
  }
}

class MediaStreamAudioSourceNode extends AudioNodeBase implements IMediaStreamAudioSourceNode {}
class MediaStreamAudioDestinationNode extends AudioNodeBase implements IMediaStreamAudioDestinationNode {}

class AudioContextImpl implements IAudioContext {
  private _currentTime = 0;
  private _sampleRate = 44100;
  private _state: AudioContextState = 'running';
  private _baseLatency = 0.01;
  private _outputLatency = 0.02;
  private _destination: AudioDestinationNode;
  private _listener: AudioListenerImpl;
  private handlers = new Set<AudioContextEventHandler>();
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this._destination = new AudioDestinationNode();
    this._listener = new AudioListenerImpl();
    this.startTick();
  }

  get currentTime(): number { return this._currentTime; }
  get sampleRate(): number { return this._sampleRate; }
  get state(): AudioContextState { return this._state; }
  get baseLatency(): number { return this._baseLatency; }
  get outputLatency(): number { return this._outputLatency; }
  get destination(): IAudioDestinationNode { return this._destination; }
  get listener(): IAudioListener { return this._listener; }

  async resume(): Promise<void> {
    if (this._state !== 'suspended') return;
    this._state = 'running';
    this.startTick();
    this.emit({ kind: 'statechange', data: { state: 'running' } });
  }

  async suspend(): Promise<void> {
    if (this._state !== 'running') return;
    this._state = 'suspended';
    this.stopTick();
    this.emit({ kind: 'statechange', data: { state: 'suspended' } });
  }

  async close(): Promise<void> {
    if (this._state === 'closed') return;
    this._state = 'closed';
    this.stopTick();
    this.emit({ kind: 'statechange', data: { state: 'closed' } });
  }

  createOscillator(): IOscillatorNode { return new OscillatorNode(); }
  createGain(): IGainNode { return new GainNode(); }
  createAnalyser(): IAnalyserNode { return new AnalyserNode(); }
  createBiquadFilter(): IBiquadFilterNode { return new BiquadFilterNode(); }
  createDelay(maxDelay?: number): IDelayNode { return new DelayNode(maxDelay); }
  createConvolver(): IConvolverNode { return new ConvolverNode(); }
  createChannelMerger(count?: number): IChannelMergerNode { return new ChannelMergerNode(count); }
  createChannelSplitter(count?: number): IChannelSplitterNode { return new ChannelSplitterNode(count); }
  createDynamicsCompressor(): IDynamicsCompressorNode { return new DynamicsCompressorNode(); }
  createWaveShaper(): IWaveShaperNode { return new WaveShaperNode(); }
  createConstantSource(): IConstantSourceNode { return new ConstantSourceNode(); }
  createStereoPanner(): IStereoPannerNode { return new StereoPannerNode(); }
  createBuffer(channels: number, length: number, sampleRate: number): IAudioBuffer {
    return new AudioBufferImpl(channels, length, sampleRate);
  }
  createBufferSource(): IAudioBufferSourceNode { return new AudioBufferSourceNode(); }
  createMediaStreamSource(_stream: unknown): IMediaStreamAudioSourceNode { return new MediaStreamAudioSourceNode(); }
  createMediaStreamDestination(): IMediaStreamAudioDestinationNode { return new MediaStreamAudioDestinationNode(); }

  private startTick(): void {
    this.stopTick();
    this.tickInterval = setInterval(() => { this._currentTime += 0.025; }, 25);
  }
  private stopTick(): void {
    if (this.tickInterval !== null) { clearInterval(this.tickInterval); this.tickInterval = null; }
  }

  onEvent(handler: AudioContextEventHandler): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }
  private emit(event: AudioContextEvent): void {
    for (const h of this.handlers) { try { h(event); } catch { /* swallow */ } }
  }

  dispose(): void {
    this.stopTick();
    this._state = 'closed';
    this._destination.dispose();
    this.handlers.clear();
  }
}

export {
  AudioContextImpl, AudioParam, AudioBufferImpl, AudioBufferSourceNode,
  AudioDestinationNode, AudioListenerImpl, OscillatorNode, GainNode,
  AnalyserNode, BiquadFilterNode, DelayNode, ConvolverNode,
  ChannelMergerNode, ChannelSplitterNode, DynamicsCompressorNode,
  WaveShaperNode, ConstantSourceNode, StereoPannerNode,
  MediaStreamAudioSourceNode, MediaStreamAudioDestinationNode,
};
export type {
  IAudioContext, IAudioNode, IAudioDestinationNode, IAudioListener, IAudioParam, IAudioBuffer,
  IOscillatorNode, IGainNode, IAnalyserNode, IBiquadFilterNode, IDelayNode,
  IConvolverNode, IChannelMergerNode, IChannelSplitterNode, IDynamicsCompressorNode,
  IWaveShaperNode, IConstantSourceNode, IStereoPannerNode,
  IAudioBufferSourceNode, IMediaStreamAudioSourceNode, IMediaStreamAudioDestinationNode,
  AudioContextState, AudioContextEvent, AudioContextEventKind, AudioContextEventHandler,
  OscillatorType, BiquadFilterType, OverSampleType,
  AudioNodeChannelCountMode, AudioNodeChannelInterpretation,
};
