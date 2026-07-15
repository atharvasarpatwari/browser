/**
 * @file html5/events.ts
 * DOM Event System — standard WHATWG DOM Events Level 3 implementation.
 *
 * Provides:
 *   - Event base class with stopPropagation, stopImmediatePropagation, preventDefault
 *   - Event phases: CAPTURING_PHASE, AT_TARGET, BUBBLING_PHASE
 *   - Event subclasses: MouseEvent, KeyboardEvent, FocusEvent, InputEvent, CustomEvent
 *   - EventTarget functions: addEventListener, removeEventListener, dispatchEvent
 *   - Two-phase dispatch: capture (root→target) then bubble (target→root)
 *   - on* property handler support
 *   - once, capture, passive options
 */

import type { HtmlNode, HtmlElement, HtmlDocument } from './dom';
import { NodeType } from './dom';

// ─────────────────────────────────────────────────────────────────────────────
// EVENT PHASES
// ─────────────────────────────────────────────────────────────────────────────

export const CAPTURING_PHASE = 1;
export const AT_TARGET       = 2;
export const BUBBLING_PHASE  = 3;

// ─────────────────────────────────────────────────────────────────────────────
// EVENT BASE CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class Event {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  readonly timestamp: number;

  target: HtmlNode | null = null;
  currentTarget: HtmlNode | null = null;
  eventPhase: number = 0;
  isTrusted: boolean = false;

  private _stopPropagation = false;
  private _stopImmediatePropagation = false;
  private _defaultPrevented = false;
  private _cancelled = false;

  constructor(type: string, options?: EventInit) {
    this.type = type;
    this.bubbles = options?.bubbles ?? false;
    this.cancelable = options?.cancelable ?? false;
    this.composed = options?.composed ?? false;
    this.timestamp = Date.now();
  }

  get defaultPrevented(): boolean {
    return this._defaultPrevented;
  }

  get cancelled(): boolean {
    return this._cancelled;
  }

  get cancelBubble(): boolean {
    return this._stopPropagation;
  }

  get isPropagationStopped(): boolean {
    return this._stopPropagation;
  }

  get isImmediatePropagationStopped(): boolean {
    return this._stopImmediatePropagation;
  }

  preventDefault(): void {
    if (this.cancelable) {
      this._defaultPrevented = true;
    }
  }

  stopPropagation(): void {
    this._stopPropagation = true;
  }

  stopImmediatePropagation(): void {
    this._stopPropagation = true;
    this._stopImmediatePropagation = true;
  }

  /** @internal — called by dispatch logic */
  _setTarget(node: HtmlNode | null): void {
    this.target = node;
  }

  _setCurrentTarget(node: HtmlNode | null): void {
    this.currentTarget = node;
  }

  _setPhase(phase: number): void {
    this.eventPhase = phase;
  }

  _cancelledFlag(): boolean {
    return this._cancelled;
  }

  _setCancelled(v: boolean): void {
    this._cancelled = v;
  }

  _stopImmediateFlag(): boolean {
    return this._stopImmediatePropagation;
  }

  _stopPropagationFlag(): boolean {
    return this._stopPropagation;
  }

  stopImmediatePropagationFlag(): boolean {
    return this._stopImmediatePropagation;
  }

  stopPropagationFlag(): boolean {
    return this._stopPropagation;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT INIT INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

export interface EventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}

export interface MouseEventInit extends EventInit {
  screenX?: number;
  screenY?: number;
  clientX?: number;
  clientY?: number;
  button?: number;
  buttons?: number;
  relatedTarget?: HtmlNode | null;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export interface KeyboardEventInit extends EventInit {
  key?: string;
  code?: string;
  location?: number;
  repeat?: boolean;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export interface FocusEventInit extends EventInit {
  relatedTarget?: HtmlNode | null;
}

export interface InputEventInit extends EventInit {
  data?: string | null;
  inputType?: string;
}

export interface CustomEventInit<T = unknown> extends EventInit {
  detail?: T;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT SUBCLASSES
// ─────────────────────────────────────────────────────────────────────────────

export class MouseEvent extends Event {
  readonly screenX: number;
  readonly screenY: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
  readonly buttons: number;
  relatedTarget: HtmlNode | null;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;

  constructor(type: string, options?: MouseEventInit) {
    super(type, { bubbles: true, cancelable: true, ...options });
    this.screenX = options?.screenX ?? 0;
    this.screenY = options?.screenY ?? 0;
    this.clientX = options?.clientX ?? 0;
    this.clientY = options?.clientY ?? 0;
    this.button = options?.button ?? 0;
    this.buttons = options?.buttons ?? 0;
    this.relatedTarget = options?.relatedTarget ?? null;
    this.ctrlKey = options?.ctrlKey ?? false;
    this.shiftKey = options?.shiftKey ?? false;
    this.altKey = options?.altKey ?? false;
    this.metaKey = options?.metaKey ?? false;
  }
}

export class KeyboardEvent extends Event {
  readonly key: string;
  readonly code: string;
  readonly location: number;
  readonly repeat: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;

  constructor(type: string, options?: KeyboardEventInit) {
    super(type, { bubbles: true, cancelable: true, ...options });
    this.key = options?.key ?? '';
    this.code = options?.code ?? '';
    this.location = options?.location ?? 0;
    this.repeat = options?.repeat ?? false;
    this.ctrlKey = options?.ctrlKey ?? false;
    this.shiftKey = options?.shiftKey ?? false;
    this.altKey = options?.altKey ?? false;
    this.metaKey = options?.metaKey ?? false;
  }
}

export class FocusEvent extends Event {
  relatedTarget: HtmlNode | null;

  constructor(type: string, options?: FocusEventInit) {
    super(type, { bubbles: false, cancelable: false, ...options });
    this.relatedTarget = options?.relatedTarget ?? null;
  }
}

export class InputEvent extends Event {
  readonly data: string | null;
  readonly inputType: string;

  constructor(type: string, options?: InputEventInit) {
    super(type, { bubbles: true, cancelable: true, ...options });
    this.data = options?.data ?? null;
    this.inputType = options?.inputType ?? '';
  }
}

export class CustomEvent<T = unknown> extends Event {
  readonly detail: T;

  constructor(type: string, options?: CustomEventInit<T>) {
    super(type, { bubbles: false, cancelable: false, ...options });
    this.detail = (options?.detail ?? null) as T;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENT LISTENER REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────

export interface EventListenerOptions {
  capture?: boolean;
  once?: boolean;
  passive?: boolean;
}

export interface EventListenerEntry {
  type: string;
  callback: EventListener;
  capture: boolean;
  once: boolean;
  passive: boolean;
}

export type EventListener = (event: Event) => void;

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL LISTENER STORAGE  (keyed by node identity)
// ─────────────────────────────────────────────────────────────────────────────

const listenerMap = new WeakMap<HtmlNode, EventListenerEntry[]>();

function getListeners(node: HtmlNode): EventListenerEntry[] {
  let list = listenerMap.get(node);
  if (!list) {
    list = [];
    listenerMap.set(node, list);
  }
  return list;
}

// ─────────────────────────────────────────────────────────────────────────────
// ON* PROPERTY HANDLER STORAGE
// ─────────────────────────────────────────────────────────────────────────────

const onHandlerMap = new WeakMap<HtmlNode, Map<string, EventListener>>();

function getOnHandlers(node: HtmlNode): Map<string, EventListener> {
  let map = onHandlerMap.get(node);
  if (!map) {
    map = new Map();
    onHandlerMap.set(node, map);
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// EVENTTARGET FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register an event listener on a node.
 */
export function addEventListener(
  node: HtmlNode,
  type: string,
  callback: EventListener,
  options?: boolean | EventListenerOptions,
): void {
  if (typeof callback !== 'function') return;

  const opts = typeof options === 'boolean'
    ? { capture: options }
    : options ?? {};

  const entry: EventListenerEntry = {
    type,
    callback,
    capture: opts.capture ?? false,
    once: opts.once ?? false,
    passive: opts.passive ?? false,
  };

  const listeners = getListeners(node);

  // Prevent duplicate registration (same type + callback + capture)
  const duplicate = listeners.find(
    l => l.type === type && l.callback === callback && l.capture === entry.capture,
  );
  if (duplicate) return;

  listeners.push(entry);
}

/**
 * Remove an event listener from a node.
 */
export function removeEventListener(
  node: HtmlNode,
  type: string,
  callback: EventListener,
  options?: boolean | EventListenerOptions,
): void {
  const capture = typeof options === 'boolean' ? options : options?.capture ?? false;
  const listeners = getListeners(node);
  const idx = listeners.findIndex(
    l => l.type === type && l.callback === callback && l.capture === capture,
  );
  if (idx >= 0) {
    listeners.splice(idx, 1);
  }
}

/**
 * Dispatch an event on a node. Implements two-phase dispatch:
 *   1. Capture phase: root → target (walking up ancestors, collecting path)
 *   2. Target phase: target node fires all listeners
 *   3. Bubble phase: target → root (walking up ancestors)
 *
 * Returns false if preventDefault was called, true otherwise.
 */
export function dispatchEvent(node: HtmlNode, event: Event): boolean {
  // Set the target
  event._setTarget(node);

  // Build the ancestor chain for propagation
  const ancestors: HtmlNode[] = [];
  let current: HtmlNode | null = node.parent as HtmlNode | null;
  while (current) {
    ancestors.push(current);
    current = current.parent as HtmlNode | null;
  }

  // ─── CAPTURE PHASE ────────────────────────────────────────────────────
  // Walk from root (last ancestor) down to parent of target
  if (event.bubbles) {
    event._setPhase(CAPTURING_PHASE);
    for (let i = ancestors.length - 1; i >= 0; i--) {
      const ancestor = ancestors[i];
      event._setCurrentTarget(ancestor);
      if (invokeListeners(ancestor, event, true)) break;
      if (event._stopPropagationFlag()) break;
    }
  }

  // ─── TARGET PHASE ─────────────────────────────────────────────────────
  // At the target, all listeners fire regardless of capture flag (per spec).
  if (!event._stopPropagationFlag()) {
    event._setPhase(AT_TARGET);
    event._setCurrentTarget(node);
    invokeListeners(node, event, false);
    if (!event._stopPropagationFlag()) {
      invokeListeners(node, event, true);
    }
  }

  // ─── BUBBLE PHASE ─────────────────────────────────────────────────────
  if (event.bubbles && !event._stopPropagationFlag()) {
    event._setPhase(BUBBLING_PHASE);
    for (const ancestor of ancestors) {
      event._setCurrentTarget(ancestor);
      if (invokeListeners(ancestor, event, false)) break;
      if (event._stopPropagationFlag()) break;
    }
  }

  // ─── CLEANUP ──────────────────────────────────────────────────────────
  event._setCurrentTarget(null);
  event._setPhase(0);

  // Remove once-listeners
  cleanupOnceListeners(node);
  for (const ancestor of ancestors) {
    cleanupOnceListeners(ancestor);
  }

  return !event.defaultPrevented;
}

/**
 * Invoke all listeners on a node for a given event.
 * @param isCapture  whether we're matching capture-phase listeners
 * @returns true if propagation was stopped
 */
function invokeListeners(node: HtmlNode, event: Event, isCapture: boolean): boolean {
  const listeners = getListeners(node);

  // Collect matching listeners first (to avoid issues with mid-iteration removal)
  const matching: EventListenerEntry[] = [];
  for (const entry of listeners) {
    if (entry.type === event.type && entry.capture === isCapture) {
      matching.push(entry);
    }
  }

  // Also check on* property handlers
  const onHandlers = onHandlerMap.get(node);
  if (onHandlers) {
    const handler = onHandlers.get(event.type);
    if (handler && !isCapture) {
      matching.push({
        type: event.type,
        callback: handler,
        capture: false,
        once: false,
        passive: false,
      });
    }
  }

  for (const entry of matching) {
    if (event._stopImmediateFlag()) break;
    try {
      entry.callback.call(event.currentTarget, event);
    } catch (_e) {
      // Swallow errors in event handlers to prevent breaking propagation
    }
    if (entry.once) {
      entry._markedForRemoval = true;
    }
  }

  return event._stopPropagationFlag();
}

function cleanupOnceListeners(node: HtmlNode): void {
  const listeners = getListeners(node);
  for (let i = listeners.length - 1; i >= 0; i--) {
    if ((listeners[i] as any)._markedForRemoval) {
      listeners.splice(i, 1);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ON* PROPERTY HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Set an on* event handler (e.g., node.onclick = handler).
 * Setting to null removes the handler. Only one handler per event type.
 */
export function setOnHandler(node: HtmlNode, eventType: string, handler: EventListener | null): void {
  const map = getOnHandlers(node);
  if (handler) {
    map.set(eventType, handler);
  } else {
    map.delete(eventType);
  }
}

/**
 * Get the on* event handler for a given event type.
 */
export function getOnHandler(node: HtmlNode, eventType: string): EventListener | null {
  const map = onHandlerMap.get(node);
  return map?.get(eventType) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: getEventListeners (for testing/debugging)
// ─────────────────────────────────────────────────────────────────────────────

export function getEventListeners(node: HtmlNode): readonly EventListenerEntry[] {
  return listenerMap.get(node) ?? [];
}
