/**
 * @file CssAnimationAnimator — Bridges CSS @keyframes and the Web Animations
 * API into the reflow/repaint pipeline via an animated-style overlay.
 *
 * Animated values are NOT written into computedStyle. The animator keeps its
 * own element→animation registry and resolves current animated opacity on
 * demand at paint time (resolveOpacity), so the base computed styles stay
 * untouched and no restore logic is needed when an animation ends.
 */

import type { IDomTree, DomElement, DomDocument } from './dom-tree';
import {
  Animation,
  KeyframeEffect,
  type AnimationTimeline,
  type Keyframe,
  type KeyframeEffectOptions,
} from './compositing/animation-engine';
import type { CssKeyframesRule } from './css5/types';

export type KeyframesProvider = () => Map<string, CssKeyframesRule>;

export interface CssAnimationAnimatorOptions {
  domTree: IDomTree;
  timeline: AnimationTimeline;
  getKeyframes?: KeyframesProvider;
}

export interface CssAnimationSpec {
  readonly name: string;
  readonly duration: number;
  readonly delay: number;
  readonly iterations: number;
  readonly direction: KeyframeEffectOptions['direction'];
  readonly fill: KeyframeEffectOptions['fill'];
  readonly easing: string;
  readonly paused: boolean;
}

interface CssAnimationEntry {
  readonly spec: CssAnimationSpec;
  readonly animation: Animation;
}

const DEFAULT_SPEC: CssAnimationSpec = {
  name: '',
  duration: 0,
  delay: 0,
  iterations: 1,
  direction: 'normal',
  fill: 'none',
  easing: 'ease',
  paused: false,
};

/**
 * Split a CSS comma-separated list, respecting parentheses so values such as
 * `cubic-bezier(0.1, 0.2, 0.3, 0.4)` are not split mid-function.
 */
function splitCssList(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map(p => p.trim()).filter(p => p.length > 0);
}

/** Parse a CSS time value (`500ms`, `1.5s`, or a bare number treated as ms). */
function parseCssTime(value: string): number {
  const v = value.trim();
  if (v.endsWith('ms')) {
    const n = parseFloat(v);
    return isFinite(n) ? n : 0;
  }
  if (v.endsWith('s')) {
    const n = parseFloat(v) * 1000;
    return isFinite(n) ? n : 0;
  }
  const n = parseFloat(v);
  return isFinite(n) ? n : 0;
}

/** Parse `infinite`, `2.5`, `1` into an iteration count (Infinity allowed). */
function parseIterations(value: string): number {
  const v = value.trim();
  if (v === 'infinite') return Infinity;
  const n = parseFloat(v);
  return isFinite(n) ? n : 1;
}

/** Convert `from` / `to` / `50%` keyframe selectors into numeric offsets. */
function parseKeyframeOffset(selector: string): number {
  const s = selector.trim();
  if (s === 'from') return 0;
  if (s === 'to') return 1;
  const n = parseFloat(s) / 100;
  return isFinite(n) ? n : 0;
}

/** Convert a parsed @keyframes rule into engine Keyframe[]. */
function cssKeyframesToKeyframes(rule: CssKeyframesRule): Keyframe[] {
  const result: Keyframe[] = [];
  for (const kf of rule.keyframes) {
    const properties: Record<string, string> = {};
    for (const decl of kf.declarations) {
      properties[decl.property] = decl.value;
    }
    if (Object.keys(properties).length === 0) continue;
    // A keyframe block may list multiple selectors (e.g. `0%, 100% { ... }`).
    for (const selector of kf.selectors) {
      result.push({ offset: parseKeyframeOffset(selector), properties });
    }
  }
  result.sort((a, b) => a.offset - b.offset);
  return result;
}

/**
 * Build the animation specs from the element's computed `animation-*`
 * longhands. Computed styles carry expanded longhands (single or
 * comma-separated lists for multiple animations).
 */
function parseAnimationSpecs(style: ReadonlyMap<string, string> | undefined): CssAnimationSpec[] {
  const names = splitCssList(style?.get('animation-name') ?? '');
  if (names.length === 0 || (names.length === 1 && names[0] === 'none')) return [];

  const durations = splitCssList(style?.get('animation-duration') ?? '0s');
  const delays = splitCssList(style?.get('animation-delay') ?? '0s');
  const iterations = splitCssList(style?.get('animation-iteration-count') ?? '1');
  const directions = splitCssList(style?.get('animation-direction') ?? 'normal');
  const fills = splitCssList(style?.get('animation-fill-mode') ?? 'none');
  const easings = splitCssList(style?.get('animation-timing-function') ?? 'ease');
  const playStates = splitCssList(style?.get('animation-play-state') ?? 'running');

  const specs: CssAnimationSpec[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!;
    if (!name || name === 'none') continue;
    const direction = (directions[i] ?? 'normal') as CssAnimationSpec['direction'];
    const fill = (fills[i] ?? 'none') as CssAnimationSpec['fill'];
    const validDirection = direction === 'normal' || direction === 'reverse'
      || direction === 'alternate' || direction === 'alternate-reverse';
    const validFill = fill === 'none' || fill === 'forwards' || fill === 'backwards' || fill === 'both';
    specs.push({
      ...DEFAULT_SPEC,
      name,
      duration: parseCssTime(durations[i] ?? '0s'),
      delay: parseCssTime(delays[i] ?? '0s'),
      iterations: parseIterations(iterations[i] ?? '1'),
      direction: validDirection ? direction : 'normal',
      fill: validFill ? fill : 'none',
      easing: easings[i] ?? 'ease',
      paused: (playStates[i] ?? 'running') === 'paused',
    });
  }
  return specs;
}

function specEquals(a: CssAnimationSpec, b: CssAnimationSpec): boolean {
  return a.name === b.name
    && a.duration === b.duration
    && a.delay === b.delay
    && a.iterations === b.iterations
    && a.direction === b.direction
    && a.fill === b.fill
    && a.easing === b.easing
    && a.paused === b.paused;
}

/**
 * Tracks CSS-driven and JS-created animations and exposes current animated
 * values as an overlay over the cascade.
 */
export class CssAnimationAnimator {
  /** CSS-driven animations per element domId (for reconciliation). */
  private readonly cssAnimations = new Map<string, CssAnimationEntry[]>();
  /** All tracked animations (CSS + WAAPI) per element domId. */
  private readonly targets = new Map<string, Set<Animation>>();
  private readonly domTree: IDomTree;
  private readonly timeline: AnimationTimeline;
  private readonly getKeyframes: KeyframesProvider;
  private document: DomDocument | null = null;
  private _prefersReducedMotion = false;
  onAnimationEvent: ((event: { type: string; target: DomElement; animationName: string; currentTime: number }) => void) | null = null;

  constructor(options: CssAnimationAnimatorOptions) {
    this.domTree = options.domTree;
    this.timeline = options.timeline;
    this.getKeyframes = options.getKeyframes ?? (() => new Map());
  }

  get timelineRef(): AnimationTimeline {
    return this.timeline;
  }

  set prefersReducedMotion(value: boolean) {
    this._prefersReducedMotion = value;
  }

  get prefersReducedMotion(): boolean {
    return this._prefersReducedMotion;
  }

  /**
   * Reconcile CSS-driven animations against the current document's computed
   * styles. Called once per processed frame, after style recalc.
   */
  sync(document: DomDocument | null): void {
    if (!document) return;
    this.document = document;
    const keyframes = this.getKeyframes();
    const seen = new Set<string>();

    this.walk(document, (el) => {
      const style = el.computedStyle;
      if (!style || el.nodeType !== 'element') return;
      const specs = parseAnimationSpecs(style);
      const applicable = specs.filter(s => !s.paused && keyframes.has(s.name));
      if (applicable.length === 0) return;

      seen.add(el.domId);
      const previous = this.cssAnimations.get(el.domId) ?? [];
      const next: CssAnimationEntry[] = [];

      for (const spec of applicable) {
        const existing = previous.find(e => e.spec.name === spec.name);
        if (existing && specEquals(existing.spec, spec)) {
          next.push(existing);
        } else {
          if (existing) this.destroy(existing.animation);
          if (this._prefersReducedMotion) continue;
          const anim = this.createCssAnimation(el, spec, keyframes.get(spec.name)!);
          if (anim) {
            next.push({ spec, animation: anim });
            this.domTree.markDirty(el, 'paint');
          }
        }
      }

      for (const entry of previous) {
        if (!next.includes(entry)) {
          this.destroy(entry.animation);
        }
      }

      this.cssAnimations.set(el.domId, next);
    });

    // Remove any CSS animations for elements that no longer carry one.
    for (const [domId, entries] of this.cssAnimations) {
      if (!seen.has(domId)) {
        for (const entry of entries) this.destroy(entry.animation);
        this.cssAnimations.delete(domId);
      }
    }
  }

  /**
   * Register a WAAPI-created animation (element.animate()) so its animated
   * values are resolved at paint time too.
   */
  registerAnimation(anim: Animation): void {
    const domId = anim.effect.target;
    let set = this.targets.get(domId);
    if (!set) {
      set = new Set();
      this.targets.set(domId, set);
    }
    set.add(anim);
  }

  /** Remove a WAAPI-created animation from the registry. */
  unregisterAnimation(anim: Animation): void {
    const domId = anim.effect.target;
    const set = this.targets.get(domId);
    if (!set) return;
    set.delete(anim);
    if (set.size === 0) this.targets.delete(domId);
  }

  /** Resolve the current animated opacity for an element, or null. */
  resolveOpacity(el: DomElement): number | null {
    const set = this.targets.get(el.domId);
    if (!set || set.size === 0) return null;

    let result: number | null = null;
    for (const anim of set) {
      if (anim.playState === 'idle') continue;
      const props = anim.getComputedProperties();
      const raw = props['opacity'];
      if (raw === undefined) continue;
      const n = parseFloat(raw);
      if (isFinite(n)) result = n;
    }
    return result;
  }

  /** Resolve the current animated transform for an element, or null. */
  resolveTransform(el: DomElement): string | null {
    const set = this.targets.get(el.domId);
    if (!set || set.size === 0) return null;

    let result: string | null = null;
    for (const anim of set) {
      if (anim.playState === 'idle') continue;
      const props = anim.getComputedProperties();
      const raw = props['transform'];
      if (raw === undefined) continue;
      result = raw;
    }
    return result;
  }

  /** Whether any tracked animation is still producing frames. */
  hasActiveAnimations(): boolean {
    for (const set of this.targets.values()) {
      for (const anim of set) {
        if (anim.playState === 'running' || anim.playState === 'paused') return true;
        if (anim.playState === 'finished') {
          const fill = anim.effect.fill;
          if (fill === 'forwards' || fill === 'both') return true;
        }
      }
    }
    return false;
  }

  dispose(): void {
    for (const entries of this.cssAnimations.values()) {
      for (const entry of entries) this.destroy(entry.animation);
    }
    this.cssAnimations.clear();
    this.targets.clear();
  }

  private dispatchAnimationEvent(event: import('./compositing/animation-engine').AnimationLifecycleEvent): void {
    if (!this.document) return;
    const el = this.domTree.getElementById(event.target);
    if (!el) return;
    const domEvent = {
      type: event.type,
      target: el,
      animationName: event.animationName,
      currentTime: event.currentTime,
    };
    if (this.onAnimationEvent) {
      this.onAnimationEvent(domEvent);
    }
  }

  private createCssAnimation(
    el: DomElement,
    spec: CssAnimationSpec,
    rule: CssKeyframesRule,
  ): Animation | null {
    const keyframes = cssKeyframesToKeyframes(rule);
    if (keyframes.length === 0) return null;
    const effect = new KeyframeEffect(el.domId, keyframes, {
      duration: spec.duration,
      delay: spec.delay,
      iterations: spec.iterations,
      direction: spec.direction,
      fill: spec.fill,
      easing: spec.easing,
    });
    const anim = new Animation(effect, this.timeline);
    anim.setEventHandler((event) => {
      this.dispatchAnimationEvent(event);
    });
    anim.start();
    this.registerAnimation(anim);
    return anim;
  }

  private destroy(anim: Animation): void {
    this.unregisterAnimation(anim);
    anim.cancel();
  }

  private walk(document: DomDocument, visit: (el: DomElement) => void): void {
    const root = document.htmlElement ?? document.bodyElement;
    if (!root) return;
    const stack: DomElement[] = [root];
    while (stack.length > 0) {
      const el = stack.pop()!;
      visit(el);
      for (const child of el.children) {
        if (child.nodeType === 'element') stack.push(child as DomElement);
      }
    }
  }
}
