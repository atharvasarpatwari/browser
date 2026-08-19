/**
 * @file CssTransitionEngine — Handles CSS transitions by diffing computed
 * styles across recalc and spawning overlay KeyframeEffects for changed
 * properties. Works through the same overlay pipeline as CSS animations
 * (no computedStyle mutation).
 */

import type { IDomTree, DomElement, DomDocument } from './dom-tree';
import {
  Animation,
  KeyframeEffect,
  type AnimationTimeline,
} from './compositing/animation-engine';

/** Properties that support CSS transitions. */
const TRANSITIONABLE_PROPERTIES = new Set([
  'opacity',
  'transform',
  'color',
  'background-color',
  'border-color',
  'border-top-color',
  'border-right-color',
  'border-bottom-color',
  'border-left-color',
  'outline-color',
  'text-decoration-color',
  'column-rule-color',
  'caret-color',
  'width',
  'height',
  'max-width',
  'max-height',
  'min-width',
  'min-height',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'top',
  'right',
  'bottom',
  'left',
  'font-size',
  'line-height',
  'letter-spacing',
  'word-spacing',
  'border-width',
  'border-radius',
  'gap',
  'z-index',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'order',
]);

export interface CssTransitionEngineOptions {
  domTree: IDomTree;
  timeline: AnimationTimeline;
  /** Register a transition animation in the animator's target registry. */
  registerAnimation: (anim: Animation) => void;
  /** Unregister a transition animation. */
  unregisterAnimation: (anim: Animation) => void;
}

interface TransitionSpec {
  property: string;
  duration: number;
  delay: number;
  timingFunction: string;
}

interface TransitionEntry {
  anim: Animation;
  property: string;
}

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

/**
 * Split a CSS comma-separated list, respecting parentheses.
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

/**
 * Parse transition-* longhands into per-property specs.
 */
function parseTransitionSpecs(style: ReadonlyMap<string, string> | undefined): TransitionSpec[] {
  if (!style) return [];
  const properties = splitCssList(style.get('transition-property') ?? 'none');
  if (properties.length === 0 || (properties.length === 1 && properties[0] === 'none')) return [];

  const durations = splitCssList(style.get('transition-duration') ?? '0s');
  const delays = splitCssList(style.get('transition-delay') ?? '0s');
  const timingFns = splitCssList(style.get('transition-timing-function') ?? 'ease');

  const specs: TransitionSpec[] = [];
  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i]!;
    if (prop === 'none' || !prop) continue;
    if (!TRANSITIONABLE_PROPERTIES.has(prop)) continue;
    specs.push({
      property: prop,
      duration: parseCssTime(durations[i] ?? '0s'),
      delay: parseCssTime(delays[i] ?? '0s'),
      timingFunction: timingFns[i] ?? 'ease',
    });
  }
  return specs;
}

/**
 * CssTransitionEngine — Diffs computed styles after recalc and spawns
 * overlay animations for properties that have CSS transitions defined.
 */
export class CssTransitionEngine {
  private readonly domTree: IDomTree;
  private readonly timeline: AnimationTimeline;
  private readonly registerAnim: (anim: Animation) => void;
  private readonly unregisterAnim: (anim: Animation) => void;
  /** Previous computed style snapshot per element domId. */
  private readonly prevStyles = new Map<string, Map<string, string>>();
  /** Active transition animations per element domId. */
  private readonly activeTransitions = new Map<string, TransitionEntry[]>();

  constructor(options: CssTransitionEngineOptions) {
    this.domTree = options.domTree;
    this.timeline = options.timeline;
    this.registerAnim = options.registerAnimation;
    this.unregisterAnim = options.unregisterAnimation;
  }

  /**
   * Called after style recalc to detect property changes and spawn
   * transition animations. Should be called once per frame, after
   * the style recalc callback but before paint.
   */
  sync(document: DomDocument | null): void {
    if (!document) return;
    const seen = new Set<string>();

    this.walk(document, (el) => {
      const style = el.computedStyle;
      if (!style || el.nodeType !== 'element') return;

      seen.add(el.domId);
      const specs = parseTransitionSpecs(style);
      if (specs.length === 0) return;

      const prev = this.prevStyles.get(el.domId);
      const current = style;

      for (const spec of specs) {
        const prevVal = prev?.get(spec.property);
        const curVal = current.get(spec.property);
        if (prevVal === undefined || curVal === undefined || prevVal === curVal) continue;
        if (spec.duration <= 0) continue;

        this.spawnTransition(el, spec, prevVal, curVal);
      }
    });

    // Clean up transitions for elements that no longer exist.
    for (const [domId, entries] of this.activeTransitions) {
      if (!seen.has(domId)) {
        for (const entry of entries) {
          this.unregisterAnim(entry.anim);
          entry.anim.cancel();
        }
        this.activeTransitions.delete(domId);
      }
    }

    // Snapshot current styles for next frame's diff.
    for (const [domId] of this.prevStyles) {
      if (!seen.has(domId)) this.prevStyles.delete(domId);
    }
    this.walk(document, (el) => {
      const style = el.computedStyle;
      if (!style || el.nodeType !== 'element') return;
      this.prevStyles.set(el.domId, new Map(style));
    });
  }

  dispose(): void {
    for (const entries of this.activeTransitions.values()) {
      for (const entry of entries) {
        this.unregisterAnim(entry.anim);
        entry.anim.cancel();
      }
    }
    this.activeTransitions.clear();
    this.prevStyles.clear();
  }

  private spawnTransition(
    el: DomElement,
    spec: TransitionSpec,
    fromValue: string,
    toValue: string,
  ): void {
    // Cancel any existing transition for this property on this element.
    const existing = this.activeTransitions.get(el.domId);
    if (existing) {
      const idx = existing.findIndex(e => e.property === spec.property);
      if (idx !== -1) {
        this.unregisterAnim(existing[idx]!.anim);
        existing[idx]!.anim.cancel();
        existing.splice(idx, 1);
      }
    }

    const keyframes = [
      { offset: 0, properties: { [spec.property]: fromValue } },
      { offset: 1, properties: { [spec.property]: toValue } },
    ];

    const effect = new KeyframeEffect(el.domId, keyframes, {
      duration: spec.duration,
      delay: spec.delay,
      iterations: 1,
      direction: 'normal',
      fill: 'forwards',
      easing: spec.timingFunction,
    });

    const anim = new Animation(effect, this.timeline);
    anim.start();
    this.registerAnim(anim);

    let entries = this.activeTransitions.get(el.domId);
    if (!entries) {
      entries = [];
      this.activeTransitions.set(el.domId, entries);
    }
    entries.push({ anim, property: spec.property });

    this.domTree.markDirty(el, 'paint');
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
