/**
 * @file input-manager.ts
 * @layer Platform — Shared
 *
 * Unified platform input handling: mouse, keyboard, and drag & drop.
 * Follows the same lifecycle pattern as {@link PlatformEvents} (event bus,
 * start()/stop(), dispose()).
 *
 * Events
 * ──────
 *   keydown / keyup      — { key, code, shiftKey, ctrlKey, altKey, metaKey, repeat }
 *   mousedown / mouseup  — { x, y, button, buttons, shiftKey, ctrlKey, altKey, metaKey }
 *   mousemove            — { x, y, buttons, shiftKey, ctrlKey, altKey, metaKey }
 *   mouseenter/leave     — { x, y }
 *   dragstart            — { x, y, types, sourceText }
 *   dragover / dragleave — { x, y, types }
 *   drop                 — { x, y, types, sourceText }
 *
 * The manager also exposes live modifier state (isShiftDown, isCtrlDown, …),
 * the last known mouse position, and the current drag payload.
 */

import type { IDisposable } from '../../app/dependency-container';

type InputEventType =
  | 'keydown' | 'keyup'
  | 'mousedown' | 'mouseup'
  | 'mousemove'
  | 'mouseenter' | 'mouseleave'
  | 'dragstart' | 'dragover' | 'dragleave' | 'drop';

interface ModifierState {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

interface MouseEventData extends ModifierState {
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly buttons: number;
}

interface KeyboardEventData extends ModifierState {
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
}

interface DragEventData extends ModifierState {
  readonly x: number;
  readonly y: number;
  readonly types: readonly string[];
  readonly sourceText: string | null;
}

type InputEvent =
  | { readonly kind: 'keydown' | 'keyup'; readonly data: KeyboardEventData; readonly timestamp: number }
  | { readonly kind: 'mousedown' | 'mouseup' | 'mousemove' | 'mouseenter' | 'mouseleave'; readonly data: MouseEventData; readonly timestamp: number }
  | { readonly kind: 'dragstart' | 'dragover' | 'dragleave' | 'drop'; readonly data: DragEventData; readonly timestamp: number };

interface IInputManager extends IDisposable {
  readonly isShiftDown: boolean;
  readonly isCtrlDown: boolean;
  readonly isAltDown: boolean;
  readonly isMetaDown: boolean;
  readonly lastMouseX: number;
  readonly lastMouseY: number;
  readonly isDragging: boolean;
  readonly activeDragText: string | null;
  start(): void;
  stop(): void;
  on(type: InputEventType, handler: (event: InputEvent) => void): void;
  off(type: InputEventType, handler: (event: InputEvent) => void): void;
}

type InputEventHandler = (event: InputEvent) => void;

class InputEventBus {
  private readonly channels = new Map<InputEventType, Set<InputEventHandler>>();

  on(type: InputEventType, handler: InputEventHandler): void {
    if (!this.channels.has(type)) this.channels.set(type, new Set());
    this.channels.get(type)!.add(handler);
  }

  off(type: InputEventType, handler: InputEventHandler): void {
    this.channels.get(type)?.delete(handler);
  }

  emit(event: InputEvent): void {
    const handlers = this.channels.get(event.kind);
    if (!handlers) return;
    for (const h of handlers) {
      try { h(event); } catch (err) {
        console.error(`[InputManager] Handler threw on "${event.kind}":`, err);
      }
    }
  }

  dispose(): void { this.channels.clear(); }
}

function readModifiers(e: KeyboardEvent | MouseEvent | DragEvent): ModifierState {
  return {
    shiftKey: e.shiftKey,
    ctrlKey: e.ctrlKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
  };
}

function readPoint(e: MouseEvent | DragEvent): { x: number; y: number } {
  return { x: e.clientX, y: e.clientY };
}

function readDragTypes(e: DragEvent): string[] {
  return Array.from(e.dataTransfer?.types ?? []);
}

function readDragText(e: DragEvent): string | null {
  return e.dataTransfer?.getData('text/plain') || null;
}

class InputManager implements IInputManager {
  private readonly bus = new InputEventBus();
  private _running = false;

  private modifiers: ModifierState = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };
  private _lastMouseX = 0;
  private _lastMouseY = 0;
  private _isDragging = false;
  private _dragText: string | null = null;

  private boundHandlers: Array<[string, EventListener]> = [];

  get isShiftDown(): boolean { return this.modifiers.shiftKey; }
  get isCtrlDown(): boolean { return this.modifiers.ctrlKey; }
  get isAltDown(): boolean { return this.modifiers.altKey; }
  get isMetaDown(): boolean { return this.modifiers.metaKey; }
  get lastMouseX(): number { return this._lastMouseX; }
  get lastMouseY(): number { return this._lastMouseY; }
  get isDragging(): boolean { return this._isDragging; }
  get activeDragText(): string | null { return this._dragText; }

  start(): void {
    if (this._running) return;
    this._running = true;

    if (typeof window === 'undefined') return;

    const add = (type: string, handler: EventListener) => {
      window.addEventListener(type, handler);
      this.boundHandlers.push([type, handler]);
    };

    add('keydown', (e: Event) => {
      const ke = e as KeyboardEvent;
      this.modifiers = readModifiers(ke);
      this.bus.emit({
        kind: 'keydown',
        timestamp: Date.now(),
        data: {
          ...this.modifiers,
          key: ke.key,
          code: ke.code,
          repeat: ke.repeat,
        },
      });
    });

    add('keyup', (e: Event) => {
      const ke = e as KeyboardEvent;
      this.modifiers = readModifiers(ke);
      this.bus.emit({
        kind: 'keyup',
        timestamp: Date.now(),
        data: {
          ...this.modifiers,
          key: ke.key,
          code: ke.code,
          repeat: ke.repeat,
        },
      });
    });

    add('mousedown', (e: Event) => {
      const me = e as MouseEvent;
      this.modifiers = readModifiers(me);
      const { x, y } = readPoint(me);
      this._lastMouseX = x;
      this._lastMouseY = y;
      this.bus.emit({
        kind: 'mousedown',
        timestamp: Date.now(),
        data: { ...this.modifiers, x, y, button: me.button, buttons: me.buttons },
      });
    });

    add('mouseup', (e: Event) => {
      const me = e as MouseEvent;
      this.modifiers = readModifiers(me);
      const { x, y } = readPoint(me);
      this._lastMouseX = x;
      this._lastMouseY = y;
      this.bus.emit({
        kind: 'mouseup',
        timestamp: Date.now(),
        data: { ...this.modifiers, x, y, button: me.button, buttons: me.buttons },
      });
    });

    add('mousemove', (e: Event) => {
      const me = e as MouseEvent;
      this.modifiers = readModifiers(me);
      const { x, y } = readPoint(me);
      this._lastMouseX = x;
      this._lastMouseY = y;
      this.bus.emit({
        kind: 'mousemove',
        timestamp: Date.now(),
        data: { ...this.modifiers, x, y, button: -1, buttons: me.buttons },
      });
    });

    add('mouseenter', (e: Event) => {
      const me = e as MouseEvent;
      const { x, y } = readPoint(me);
      this.bus.emit({
        kind: 'mouseenter',
        timestamp: Date.now(),
        data: { ...this.modifiers, x, y, button: -1, buttons: me.buttons },
      });
    });

    add('mouseleave', (e: Event) => {
      const me = e as MouseEvent;
      const { x, y } = readPoint(me);
      this.bus.emit({
        kind: 'mouseleave',
        timestamp: Date.now(),
        data: { ...this.modifiers, x, y, button: -1, buttons: me.buttons },
      });
    });

    add('dragstart', (e: Event) => {
      const de = e as DragEvent;
      this.modifiers = readModifiers(de);
      const { x, y } = readPoint(de);
      this._isDragging = true;
      this._dragText = readDragText(de);
      this.bus.emit({
        kind: 'dragstart',
        timestamp: Date.now(),
        data: { ...this.modifiers, x, y, types: readDragTypes(de), sourceText: this._dragText },
      });
    });

    add('dragover', (e: Event) => {
      const de = e as DragEvent;
      const { x, y } = readPoint(de);
      this._lastMouseX = x;
      this._lastMouseY = y;
      if (de.dataTransfer) {
        de.preventDefault();
        de.dataTransfer.dropEffect = 'copy';
      }
      this.bus.emit({
        kind: 'dragover',
        timestamp: Date.now(),
        data: { ...this.modifiers, x, y, types: readDragTypes(de), sourceText: this._dragText },
      });
    });

    add('dragleave', (e: Event) => {
      const de = e as DragEvent;
      const { x, y } = readPoint(de);
      this.bus.emit({
        kind: 'dragleave',
        timestamp: Date.now(),
        data: { ...this.modifiers, x, y, types: readDragTypes(de), sourceText: this._dragText },
      });
    });

    add('drop', (e: Event) => {
      const de = e as DragEvent;
      const { x, y } = readPoint(de);
      this._isDragging = false;
      this.bus.emit({
        kind: 'drop',
        timestamp: Date.now(),
        data: { ...this.modifiers, x, y, types: readDragTypes(de), sourceText: readDragText(de) ?? this._dragText },
      });
      this._dragText = null;
    });
  }

  stop(): void {
    if (!this._running) return;
    this._running = false;

    for (const [type, handler] of this.boundHandlers) {
      window.removeEventListener(type, handler);
    }
    this.boundHandlers = [];
    this._isDragging = false;
  }

  on(type: InputEventType, handler: InputEventHandler): void {
    this.bus.on(type, handler);
  }

  off(type: InputEventType, handler: InputEventHandler): void {
    this.bus.off(type, handler);
  }

  dispose(): void {
    this.stop();
    this.bus.dispose();
  }
}

export { InputManager, InputEventBus };
export type { IInputManager, InputEvent, InputEventType, InputEventHandler, MouseEventData, KeyboardEventData, DragEventData, ModifierState };
