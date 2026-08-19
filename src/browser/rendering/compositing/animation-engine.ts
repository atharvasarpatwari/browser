import { AnimationFrameService } from '../../media/request-animation-frame';
import { type DOMMatrix4x4, identity4x4, parseTransform, lerpNumber, lerpColor, lerpMatrices } from './transform-parser';

export interface Keyframe {
  offset: number;
  properties: Record<string, string>;
  easing?: string;
}

export interface KeyframeEffectOptions {
  duration: number;
  delay?: number;
  endDelay?: number;
  iterations?: number;
  iterationStart?: number;
  direction?: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  fill?: 'none' | 'forwards' | 'backwards' | 'both';
  easing?: string;
}

export type AnimationPlayState = 'idle' | 'running' | 'paused' | 'finished';

export interface AnimationEventMap {
  finish: { currentTime: number; target: Animation };
  cancel: { currentTime: number; target: Animation };
  remove: void;
}

type AnimationEventHandler = (event: AnimationEventMap[keyof AnimationEventMap]) => void;

function defaultEasing(t: number): number {
  return t;
}

function parseEasing(easing: string): (t: number) => number {
  const e = easing.trim();
  if (e === 'linear') return defaultEasing;
  if (e === 'ease') return cubicBezier(0.25, 0.1, 0.25, 1);
  if (e === 'ease-in') return cubicBezier(0.42, 0, 1, 1);
  if (e === 'ease-out') return cubicBezier(0, 0, 0.58, 1);
  if (e === 'ease-in-out') return cubicBezier(0.42, 0, 0.58, 1);

  const cubicMatch = e.match(/cubic-bezier\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/);
  if (cubicMatch) {
    return cubicBezier(
      parseFloat(cubicMatch[1]!),
      parseFloat(cubicMatch[2]!),
      parseFloat(cubicMatch[3]!),
      parseFloat(cubicMatch[4]!),
    );
  }
  return defaultEasing;
}

function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let a = 0, b = 1;
    for (let i = 0; i < 10; i++) {
      const mid = (a + b) / 2;
      const x = sampleCubicBezierX(mid, x1, x2);
      if (x < t) a = mid;
      else b = mid;
    }
    const t2 = (a + b) / 2;
    return sampleCubicBezierY(t2, y1, y2);
  };
}

function sampleCubicBezierX(t: number, x1: number, x2: number): number {
  return 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
}

function sampleCubicBezierY(t: number, y1: number, y2: number): number {
  return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
}

export type AnimationPropertyValue = string | number | DOMMatrix4x4;

export interface AnimationLifecycleEvent {
  type: 'animationstart' | 'animationiteration' | 'animationend';
  target: string;
  animationName: string;
  currentTime: number;
}

export type AnimationLifecycleEventHandler = (event: AnimationLifecycleEvent) => void;

function interpolateProperty(name: string, a: string, b: string, t: number): string {
  if (name === 'opacity' || name === 'transform') {
    const numA = parseFloat(a);
    const numB = parseFloat(b);
    if (!isNaN(numA) && !isNaN(numB)) {
      return String(lerpNumber(numA, numB, t));
    }
    if (a.startsWith('#')) return lerpColor(a, b, t);
    const matrixA = parseTransform(a);
    const matrixB = parseTransform(b);
    if (matrixA && matrixB) {
      const lerped = lerpMatrices(matrixA.matrix, matrixB.matrix, t);
      return `matrix3d(${lerped.m11},${lerped.m12},${lerped.m13},${lerped.m14},${lerped.m21},${lerped.m22},${lerped.m23},${lerped.m24},${lerped.m31},${lerped.m32},${lerped.m33},${lerped.m34},${lerped.m41},${lerped.m42},${lerped.m43},${lerped.m44})`;
    }
    return t < 0.5 ? a : b;
  }
  if (name === 'color' || name === 'background-color' || name === 'border-color'
      || name === 'border-top-color' || name === 'border-right-color'
      || name === 'border-bottom-color' || name === 'border-left-color'
      || name === 'outline-color' || name === 'text-decoration-color'
      || name === 'column-rule-color' || name === 'caret-color') {
    if (a.startsWith('#') || a.startsWith('rgb')) {
      return lerpColor(a, b, t);
    }
  }
  const numA = parseFloat(a);
  const numB = parseFloat(b);
  if (!isNaN(numA) && !isNaN(numB)) {
    return String(lerpNumber(numA, numB, t));
  }
  return t < 0.5 ? a : b;
}

export class KeyframeEffect {
  readonly target: string;
  readonly keyframes: Keyframe[];
  readonly duration: number;
  readonly delay: number;
  readonly endDelay: number;
  readonly iterations: number;
  readonly iterationStart: number;
  readonly direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  readonly fill: 'none' | 'forwards' | 'backwards' | 'both';
  readonly easing: (t: number) => number;
  readonly _propertySet: Set<string>;

  constructor(target: string, keyframes: Keyframe[], options?: KeyframeEffectOptions) {
    this.target = target;
    this.keyframes = keyframes.sort((a, b) => a.offset - b.offset);
    this.duration = options?.duration ?? 1000;
    this.delay = options?.delay ?? 0;
    this.endDelay = options?.endDelay ?? 0;
    this.iterations = options?.iterations ?? 1;
    this.iterationStart = options?.iterationStart ?? 0;
    this.direction = options?.direction ?? 'normal';
    this.fill = options?.fill ?? 'none';
    this.easing = options?.easing ? parseEasing(options.easing) : defaultEasing;

    this._propertySet = new Set<string>();
    for (const kf of this.keyframes) {
      for (const prop of Object.keys(kf.properties)) {
        this._propertySet.add(prop);
      }
    }
  }

  compute(time: number): Record<string, string> {
    if (this.keyframes.length === 0) return {};

    const totalDuration = this.duration * this.iterations;
    const effectiveTime = time - this.delay;

    if (effectiveTime < 0) {
      if (this.fill === 'backwards' || this.fill === 'both') {
        return this.sampleKeyframe(0);
      }
      return {};
    }

    if (effectiveTime > totalDuration + this.endDelay) {
      if (this.fill === 'forwards' || this.fill === 'both') {
        return this.sampleKeyframe(1);
      }
      return {};
    }

    if (effectiveTime >= totalDuration) {
      return this.sampleKeyframe(1);
    }

    const iterationDuration = this.duration;
    if (iterationDuration === 0) {
      return this.sampleKeyframe(1);
    }

    let iterationIndex = Math.floor(effectiveTime / iterationDuration);
    let iterationProgress = (effectiveTime % iterationDuration) / iterationDuration;

    if (this.direction === 'reverse' || this.direction === 'alternate-reverse') {
      if (this.direction === 'alternate-reverse') {
        if (iterationIndex % 2 === 0) iterationProgress = 1 - iterationProgress;
      } else {
        iterationProgress = 1 - iterationProgress;
      }
    } else if (this.direction === 'alternate') {
      if (iterationIndex % 2 === 1) iterationProgress = 1 - iterationProgress;
    }

    iterationProgress = this.easing(iterationProgress);

    return this.sampleKeyframe(iterationProgress);
  }

  get activeDuration(): number {
    return this.duration * this.iterations + this.delay + this.endDelay;
  }

  get endTime(): number {
    return this.delay + this.duration * this.iterations + this.endDelay;
  }

  private sampleKeyframe(t: number): Record<string, string> {
    if (t <= 0) return { ...this.keyframes[0]!.properties };
    if (t >= 1) return { ...this.keyframes[this.keyframes.length - 1]!.properties };

    let i = 0;
    for (; i < this.keyframes.length - 1; i++) {
      if (this.keyframes[i + 1]!.offset >= t) break;
    }

    const from = this.keyframes[i]!;
    const to = this.keyframes[Math.min(i + 1, this.keyframes.length - 1)]!;
    const localT = (t - from.offset) / (to.offset - from.offset || 1);
    const easedT = to.easing ? parseEasing(to.easing)(localT) : localT;

    const result: Record<string, string> = {};
    const allProps = new Set([...Object.keys(from.properties), ...Object.keys(to.properties)]);
    for (const prop of allProps) {
      const fromVal = from.properties[prop];
      const toVal = to.properties[prop];
      if (fromVal !== undefined && toVal !== undefined) {
        result[prop] = interpolateProperty(prop, fromVal, toVal, easedT);
      } else {
        result[prop] = (fromVal ?? toVal)!;
      }
    }
    return result;
  }
}

export class AnimationTimeline {
  readonly _animations = new Set<Animation>();
  private _frameService: AnimationFrameService;
  private _frameId: number | null = null;
  private _startTime: number | null = null;
  private _isRunning = false;

  constructor(frameService?: AnimationFrameService) {
    this._frameService = frameService ?? new AnimationFrameService();
  }

  get currentTime(): number {
    if (this._startTime === null) return 0;
    return performance.now() - this._startTime;
  }

  get animations(): readonly Animation[] {
    return [...this._animations];
  }

  get isRunning(): boolean {
    return this._isRunning;
  }

  attach(animation: Animation): void {
    this._animations.add(animation);
    if (!this._isRunning) {
      this.startLoop();
    }
  }

  detach(animation: Animation): void {
    this._animations.delete(animation);
    if (this._animations.size === 0 && this._isRunning) {
      this.stopLoop();
    }
  }

  pauseAll(): void {
    for (const anim of this._animations) {
      if (anim.playState === 'running') anim.pause();
    }
  }

  resumeAll(): void {
    for (const anim of this._animations) {
      if (anim.playState === 'paused') anim.start();
    }
  }

  private startLoop(): void {
    if (this._isRunning) return;
    this._isRunning = true;
    this._startTime = performance.now();
    this.scheduleFrame();
  }

  private stopLoop(): void {
    if (!this._isRunning) return;
    this._isRunning = false;
    if (this._frameId !== null) {
      this._frameService.cancel(this._frameId);
      this._frameId = null;
    }
  }

  private scheduleFrame(): void {
    if (!this._isRunning) return;
    this._frameId = this._frameService.request((now: number) => {
      this.tick(now);
    });
  }

  tick(now: number): void {
    if (!this._isRunning) return;

    const time = this._startTime !== null ? now - this._startTime : 0;

    for (const anim of this._animations) {
      anim._tick(time);
    }

    for (const anim of this._animations) {
      if (anim.playState === 'finished') {
        this._animations.delete(anim);
      }
    }

    if (this._animations.size > 0) {
      this.scheduleFrame();
    } else {
      this._isRunning = false;
      this._frameId = null;
    }
  }

  dispose(): void {
    this.stopLoop();
    this._animations.clear();
    this._frameService.dispose();
  }
}

export class Animation {
  effect: KeyframeEffect;
  readonly timeline: AnimationTimeline;
  private _playState: AnimationPlayState = 'idle';
  private _startTime: number | null = null;
  private _pauseTime: number | null = null;
  private _holdTime: number | null = null;
  private _currentTime: number = 0;
  private _finishedPromise: Promise<void>;
  private _finishResolve: (() => void) | null = null;
  private _finishReject: ((reason: unknown) => void) | null = null;
  private _onFinish: AnimationEventHandler | null = null;
  private _onCancel: AnimationEventHandler | null = null;
  private _onRemove: AnimationEventHandler | null = null;
  private _onAnimationEvent: AnimationLifecycleEventHandler | null = null;
  private _replaceState: 'active' | 'removed' | 'persisted' = 'active';
  private _pendingPlayTime: number | null = null;
  private _lastIteration = -1;
  private _started = false;

  onFinish: AnimationEventHandler | null;
  onCancel: AnimationEventHandler | null;
  onRemove: AnimationEventHandler | null;

  constructor(effect: KeyframeEffect, timeline: AnimationTimeline) {
    this.effect = effect;
    this.timeline = timeline;
    this.onFinish = null;
    this.onCancel = null;
    this.onRemove = null;
    this._finishedPromise = new Promise<void>((resolve, reject) => {
      this._finishResolve = resolve;
      this._finishReject = reject;
    });
    this._finishedPromise.catch(() => {});
  }

  get playState(): AnimationPlayState { return this._playState; }
  get finished(): Promise<void> { return this._finishedPromise; }
  get replaceState(): string { return this._replaceState; }
  get pending(): boolean { return this._pendingPlayTime !== null; }

  get currentTime(): number {
    if (this._holdTime !== null) return this._holdTime;
    if (this._startTime === null) return 0;
    return Math.max(0, this.timeline.currentTime - this._startTime);
  }

  start(): void {
    if (this._playState === 'running') return;
    this._playState = 'running';
    this._startTime = this.timeline.currentTime;
    this._holdTime = null;
    this._pendingPlayTime = null;
    this._started = false;
    this._lastIteration = -1;
    this.timeline.attach(this);
  }

  pause(): void {
    if (this._playState !== 'running') return;
    this._playState = 'paused';
    this._holdTime = this.currentTime;
    this._startTime = null;
    this._pendingPlayTime = null;
  }

  cancel(): void {
    if (this._playState === 'idle') return;
    this._playState = 'idle';
    this._startTime = null;
    this._holdTime = null;
    this._currentTime = 0;
    this._pendingPlayTime = null;
    this._replaceState = 'removed';
    this.timeline.detach(this);

    if (this._finishReject) {
      this._finishReject(new DOMException('Animation cancelled', 'AbortError'));
      this._finishedPromise = Promise.resolve();
    }
    if (this.onCancel) {
      this.onCancel({ currentTime: 0, target: this });
    }
  }

  finish(): void {
    if (this._playState === 'finished') return;
    this._playState = 'finished';
    this._currentTime = this.effect.endTime;
    this._holdTime = this._currentTime;
    this._startTime = null;
    this._pendingPlayTime = null;
    this.timeline.detach(this);

    this._dispatchEvent('animationend');

    if (this._finishResolve) this._finishResolve();
  }

  reverse(): void {
    const currentIterations = this.effect.iterations;
    this.effect = new KeyframeEffect(this.effect.target, [...this.effect.keyframes].reverse().map((kf, i, arr) => ({
      ...kf,
      offset: 1 - kf.offset,
    })), {
      duration: this.effect.duration,
      delay: this.effect.delay,
      endDelay: this.effect.endDelay,
      iterations: currentIterations,
      direction: 'normal',
      fill: this.effect.fill,
      easing: 'linear',
    });
    this.start();
  }

  remove(): void {
    this._replaceState = 'removed';
    if (this.onRemove) this.onRemove();
  }

  persist(): void {
    this._replaceState = 'persisted';
  }

  _tick(time: number): void {
    if (this._playState !== 'running') return;

    const localTime = this._startTime !== null ? time - this._startTime : this._holdTime ?? 0;

    if (localTime >= this.effect.endTime) {
      this.finish();
      return;
    }

    this._currentTime = localTime;
    this._holdTime = localTime;

    const totalDuration = this.effect.duration * this.effect.iterations;
    const currentIteration = Math.floor(localTime / this.effect.duration);

    if (!this._started) {
      this._started = true;
      this._dispatchEvent('animationstart');
    } else if (currentIteration > this._lastIteration && this._lastIteration >= 0) {
      this._dispatchEvent('animationiteration');
    }
    this._lastIteration = currentIteration;
  }

  getComputedProperties(time?: number): Record<string, string> {
    const t = time ?? this.currentTime;
    if (this._playState === 'idle') return {};
    return this.effect.compute(t);
  }

  setEventHandler(handler: AnimationLifecycleEventHandler | null): void {
    this._onAnimationEvent = handler;
  }

  private _dispatchEvent(type: AnimationLifecycleEvent['type']): void {
    if (this._onAnimationEvent) {
      this._onAnimationEvent({
        type,
        target: this.effect.target,
        animationName: '',
        currentTime: this._currentTime,
      });
    }
    if (this.onFinish && type === 'animationend') {
      this.onFinish({ currentTime: this._currentTime, target: this });
    }
  }

  dispose(): void {
    this.cancel();
    this.onFinish = null;
    this.onCancel = null;
    this.onRemove = null;
  }
}

export function createAnimation(
  target: string,
  keyframes: Keyframe[],
  options?: KeyframeEffectOptions,
  timeline?: AnimationTimeline,
): Animation {
  const effect = new KeyframeEffect(target, keyframes, options ?? { duration: 1000 });
  const tl = timeline ?? new AnimationTimeline();
  const anim = new Animation(effect, tl);
  return anim;
}
