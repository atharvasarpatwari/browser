import { describe, it, expect, vi } from 'vitest';
import { createMutableElement, createMutableTextNode, createMutableDocument, appendChild } from '../src/browser/rendering/html5/dom';
import {
  Event,
  MouseEvent,
  KeyboardEvent,
  FocusEvent,
  InputEvent,
  CustomEvent,
  CAPTURING_PHASE,
  AT_TARGET,
  BUBBLING_PHASE,
  addEventListener,
  removeEventListener,
  dispatchEvent,
  setOnHandler,
  getOnHandler,
  getEventListeners,
  type EventListener,
} from '../src/browser/rendering/html5/events';
import { attachShadow } from '../src/browser/rendering/html5/shadow';

// ─────────────────────────────────────────────────────────────────────────────
// EVENT BASE CLASS
// ─────────────────────────────────────────────────────────────────────────────

describe('Event', () => {
  it('should create with default options', () => {
    const e = new Event('click');
    expect(e.type).toBe('click');
    expect(e.bubbles).toBe(false);
    expect(e.cancelable).toBe(false);
    expect(e.composed).toBe(false);
    expect(e.target).toBeNull();
    expect(e.currentTarget).toBeNull();
    expect(e.eventPhase).toBe(0);
    expect(e.defaultPrevented).toBe(false);
  });

  it('should accept options', () => {
    const e = new Event('submit', { bubbles: true, cancelable: true, composed: true });
    expect(e.bubbles).toBe(true);
    expect(e.cancelable).toBe(true);
    expect(e.composed).toBe(true);
  });

  it('should set timestamp', () => {
    const before = Date.now();
    const e = new Event('click');
    const after = Date.now();
    expect(e.timestamp).toBeGreaterThanOrEqual(before);
    expect(e.timestamp).toBeLessThanOrEqual(after);
  });

  it('preventDefault should work when cancelable', () => {
    const e = new Event('click', { cancelable: true });
    e.preventDefault();
    expect(e.defaultPrevented).toBe(true);
  });

  it('preventDefault should not work when not cancelable', () => {
    const e = new Event('click', { cancelable: false });
    e.preventDefault();
    expect(e.defaultPrevented).toBe(false);
  });

  it('stopPropagation should set flag', () => {
    const e = new Event('click');
    expect(e.isPropagationStopped).toBe(false);
    e.stopPropagation();
    expect(e.isPropagationStopped).toBe(true);
  });

  it('stopImmediatePropagation should set both flags', () => {
    const e = new Event('click');
    e.stopImmediatePropagation();
    expect(e.isPropagationStopped).toBe(true);
    expect(e.isImmediatePropagationStopped).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENT SUBCLASSES
// ─────────────────────────────────────────────────────────────────────────────

describe('MouseEvent', () => {
  it('should create with default values', () => {
    const e = new MouseEvent('click');
    expect(e.type).toBe('click');
    expect(e.bubbles).toBe(true);
    expect(e.cancelable).toBe(true);
    expect(e.clientX).toBe(0);
    expect(e.clientY).toBe(0);
    expect(e.button).toBe(0);
    expect(e.ctrlKey).toBe(false);
  });

  it('should accept options', () => {
    const e = new MouseEvent('mousedown', {
      clientX: 100,
      clientY: 200,
      button: 1,
      ctrlKey: true,
      shiftKey: true,
    });
    expect(e.clientX).toBe(100);
    expect(e.clientY).toBe(200);
    expect(e.button).toBe(1);
    expect(e.ctrlKey).toBe(true);
    expect(e.shiftKey).toBe(true);
  });
});

describe('KeyboardEvent', () => {
  it('should create with default values', () => {
    const e = new KeyboardEvent('keydown');
    expect(e.type).toBe('keydown');
    expect(e.key).toBe('');
    expect(e.code).toBe('');
    expect(e.repeat).toBe(false);
  });

  it('should accept options', () => {
    const e = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      repeat: true,
    });
    expect(e.key).toBe('Enter');
    expect(e.code).toBe('Enter');
    expect(e.repeat).toBe(true);
  });
});

describe('FocusEvent', () => {
  it('should create with defaults', () => {
    const e = new FocusEvent('focus');
    expect(e.type).toBe('focus');
    expect(e.bubbles).toBe(false);
    expect(e.relatedTarget).toBeNull();
  });
});

describe('InputEvent', () => {
  it('should create with defaults', () => {
    const e = new InputEvent('input');
    expect(e.type).toBe('input');
    expect(e.data).toBeNull();
    expect(e.inputType).toBe('');
  });

  it('should accept options', () => {
    const e = new InputEvent('input', { data: 'hello', inputType: 'insertText' });
    expect(e.data).toBe('hello');
    expect(e.inputType).toBe('insertText');
  });
});

describe('CustomEvent', () => {
  it('should create with detail', () => {
    const e = new CustomEvent('my-event', { detail: { foo: 'bar' } });
    expect(e.type).toBe('my-event');
    expect(e.detail).toEqual({ foo: 'bar' });
  });

  it('should default detail to null', () => {
    const e = new CustomEvent('my-event');
    expect(e.detail).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADD / REMOVE EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

describe('addEventListener / removeEventListener', () => {
  it('should register and fire a listener', () => {
    const el = createMutableElement('div');
    const handler = vi.fn();
    addEventListener(el, 'click', handler);
    dispatchEvent(el, new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should fire multiple listeners', () => {
    const el = createMutableElement('div');
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    addEventListener(el, 'click', handler1);
    addEventListener(el, 'click', handler2);
    dispatchEvent(el, new Event('click'));
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });

  it('should not fire for different event types', () => {
    const el = createMutableElement('div');
    const handler = vi.fn();
    addEventListener(el, 'click', handler);
    dispatchEvent(el, new Event('mousedown'));
    expect(handler).not.toHaveBeenCalled();
  });

  it('should remove a listener', () => {
    const el = createMutableElement('div');
    const handler = vi.fn();
    addEventListener(el, 'click', handler);
    dispatchEvent(el, new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);
    removeEventListener(el, 'click', handler);
    dispatchEvent(el, new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should not duplicate registration', () => {
    const el = createMutableElement('div');
    const handler = vi.fn();
    addEventListener(el, 'click', handler);
    addEventListener(el, 'click', handler);
    dispatchEvent(el, new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should allow same callback with capture and non-capture', () => {
    const el = createMutableElement('div');
    const handler = vi.fn();
    addEventListener(el, 'click', handler, { capture: true });
    addEventListener(el, 'click', handler, { capture: false });
    dispatchEvent(el, new Event('click', { bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('should support once option', () => {
    const el = createMutableElement('div');
    const handler = vi.fn();
    addEventListener(el, 'click', handler, { once: true });
    dispatchEvent(el, new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);
    dispatchEvent(el, new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should ignore non-function callbacks', () => {
    const el = createMutableElement('div');
    addEventListener(el, 'click', null as any);
    // Should not throw
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TWO-PHASE DISPATCH (CAPTURE + BUBBLE)
// ─────────────────────────────────────────────────────────────────────────────

describe('Two-phase dispatch', () => {
  it('should fire capture phase before target phase', () => {
    const doc = createMutableDocument();
    const parent = createMutableElement('div');
    const child = createMutableElement('span');
    appendChild(doc, parent);
    appendChild(parent, child);

    const order: string[] = [];
    addEventListener(parent, 'click', () => order.push('capture-parent'), { capture: true });
    addEventListener(child, 'click', () => order.push('target'));

    dispatchEvent(child, new Event('click', { bubbles: true }));
    expect(order).toEqual(['capture-parent', 'target']);
  });

  it('should fire bubble phase after target phase', () => {
    const doc = createMutableDocument();
    const parent = createMutableElement('div');
    const child = createMutableElement('span');
    appendChild(doc, parent);
    appendChild(parent, child);

    const order: string[] = [];
    addEventListener(parent, 'click', () => order.push('bubble-parent'));
    addEventListener(child, 'click', () => order.push('target'));

    dispatchEvent(child, new Event('click', { bubbles: true }));
    expect(order).toEqual(['target', 'bubble-parent']);
  });

  it('should fire full capture → target → bubble sequence', () => {
    const doc = createMutableDocument();
    const grandparent = createMutableElement('div');
    const parent = createMutableElement('div');
    const child = createMutableElement('span');
    appendChild(doc, grandparent);
    appendChild(grandparent, parent);
    appendChild(parent, child);

    const order: string[] = [];
    addEventListener(grandparent, 'click', () => order.push('capture-gp'), { capture: true });
    addEventListener(parent, 'click', () => order.push('capture-p'), { capture: true });
    addEventListener(child, 'click', () => order.push('target'));
    addEventListener(parent, 'click', () => order.push('bubble-p'));
    addEventListener(grandparent, 'click', () => order.push('bubble-gp'));

    dispatchEvent(child, new Event('click', { bubbles: true }));
    expect(order).toEqual(['capture-gp', 'capture-p', 'target', 'bubble-p', 'bubble-gp']);
  });

  it('should not bubble if bubbles=false', () => {
    const doc = createMutableDocument();
    const parent = createMutableElement('div');
    const child = createMutableElement('span');
    appendChild(doc, parent);
    appendChild(parent, child);

    const order: string[] = [];
    addEventListener(parent, 'click', () => order.push('bubble-parent'));
    addEventListener(child, 'click', () => order.push('target'));

    dispatchEvent(child, new Event('click', { bubbles: false }));
    expect(order).toEqual(['target']);
  });

  it('should set correct event phases', () => {
    const doc = createMutableDocument();
    const parent = createMutableElement('div');
    const child = createMutableElement('span');
    appendChild(doc, parent);
    appendChild(parent, child);

    const phases: number[] = [];
    addEventListener(parent, 'click', (e) => phases.push(e.eventPhase), { capture: true });
    addEventListener(child, 'click', (e) => phases.push(e.eventPhase));
    addEventListener(parent, 'click', (e) => phases.push(e.eventPhase));

    dispatchEvent(child, new Event('click', { bubbles: true }));
    expect(phases).toEqual([CAPTURING_PHASE, AT_TARGET, BUBBLING_PHASE]);
  });

  it('should set target and currentTarget correctly', () => {
    const doc = createMutableDocument();
    const parent = createMutableElement('div');
    const child = createMutableElement('span');
    appendChild(doc, parent);
    appendChild(parent, child);

    const targets: any[] = [];
    addEventListener(parent, 'click', (e) => {
      targets.push({ phase: e.eventPhase, target: e.target === child, currentTarget: e.currentTarget === parent });
    }, { capture: true });
    addEventListener(child, 'click', (e) => {
      targets.push({ phase: e.eventPhase, target: e.target === child, currentTarget: e.currentTarget === child });
    });

    dispatchEvent(child, new Event('click', { bubbles: true }));
    expect(targets[0]).toEqual({ phase: CAPTURING_PHASE, target: true, currentTarget: true });
    expect(targets[1]).toEqual({ phase: AT_TARGET, target: true, currentTarget: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// STOP PROPAGATION
// ─────────────────────────────────────────────────────────────────────────────

describe('stopPropagation', () => {
  it('should stop bubble propagation', () => {
    const doc = createMutableDocument();
    const parent = createMutableElement('div');
    const child = createMutableElement('span');
    appendChild(doc, parent);
    appendChild(parent, child);

    const order: string[] = [];
    addEventListener(child, 'click', () => {
      order.push('target');
    });
    addEventListener(parent, 'click', () => {
      order.push('bubble-parent-stopped');
      // This handler won't fire because child stops propagation
    });

    // Actually, parent's bubble listener fires because child's target fires first
    // Let me restructure: stop at target
    const order2: string[] = [];
    addEventListener(parent, 'click', () => order2.push('bubble-parent'));
    addEventListener(child, 'click', (e) => {
      order2.push('target-stopped');
      e.stopPropagation();
    });

    dispatchEvent(child, new Event('click', { bubbles: true }));
    expect(order2).toEqual(['target-stopped']);
  });

  it('should stop capture propagation', () => {
    const doc = createMutableDocument();
    const grandparent = createMutableElement('div');
    const parent = createMutableElement('div');
    const child = createMutableElement('span');
    appendChild(doc, grandparent);
    appendChild(grandparent, parent);
    appendChild(parent, child);

    const order: string[] = [];
    addEventListener(grandparent, 'click', (e) => {
      order.push('capture-gp-stop');
      e.stopPropagation();
    }, { capture: true });
    addEventListener(parent, 'click', () => order.push('capture-p'));
    addEventListener(child, 'click', () => order.push('target'));

    dispatchEvent(child, new Event('click', { bubbles: true }));
    expect(order).toEqual(['capture-gp-stop']);
  });

  it('stopImmediatePropagation should stop other listeners on same node', () => {
    const el = createMutableElement('div');
    const order: string[] = [];
    addEventListener(el, 'click', (e) => {
      order.push('first');
      e.stopImmediatePropagation();
    });
    addEventListener(el, 'click', () => order.push('second'));

    dispatchEvent(el, new Event('click'));
    expect(order).toEqual(['first']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PREVENT DEFAULT
// ─────────────────────────────────────────────────────────────────────────────

describe('preventDefault', () => {
  it('dispatchEvent should return false when preventDefault is called', () => {
    const el = createMutableElement('div');
    addEventListener(el, 'click', (e) => {
      e.preventDefault();
    });

    const result = dispatchEvent(el, new Event('click', { cancelable: true }));
    expect(result).toBe(false);
  });

  it('dispatchEvent should return true when preventDefault is not called', () => {
    const el = createMutableElement('div');
    addEventListener(el, 'click', () => {});

    const result = dispatchEvent(el, new Event('click', { cancelable: true }));
    expect(result).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ON* PROPERTY HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

describe('on* property handlers', () => {
  it('should set and get an on* handler', () => {
    const el = createMutableElement('div');
    const handler = vi.fn();
    setOnHandler(el, 'click', handler);
    expect(getOnHandler(el, 'click')).toBe(handler);
  });

  it('should remove handler when set to null', () => {
    const el = createMutableElement('div');
    setOnHandler(el, 'click', vi.fn());
    setOnHandler(el, 'click', null);
    expect(getOnHandler(el, 'click')).toBeNull();
  });

  it('should fire on* handler during dispatch', () => {
    const el = createMutableElement('div');
    const handler = vi.fn();
    setOnHandler(el, 'click', handler);
    dispatchEvent(el, new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should fire on* handler only in bubble/target phase, not capture', () => {
    const doc = createMutableDocument();
    const parent = createMutableElement('div');
    const child = createMutableElement('span');
    appendChild(doc, parent);
    appendChild(parent, child);

    const order: string[] = [];
    setOnHandler(parent, 'click', () => order.push('on-parent'));
    addEventListener(parent, 'click', () => order.push('capture-parent'), { capture: true });
    addEventListener(child, 'click', () => order.push('target'));

    dispatchEvent(child, new Event('click', { bubbles: true }));
    // on* handler fires during target/bubble phase, not capture
    expect(order).toEqual(['capture-parent', 'target', 'on-parent']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('should handle dispatching on a node with no parent', () => {
    const el = createMutableElement('div');
    const handler = vi.fn();
    addEventListener(el, 'click', handler);
    dispatchEvent(el, new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should handle nested bubbling correctly', () => {
    const doc = createMutableDocument();
    const a = createMutableElement('a');
    const b = createMutableElement('b');
    const c = createMutableElement('c');
    appendChild(doc, a);
    appendChild(a, b);
    appendChild(b, c);

    const order: string[] = [];
    addEventListener(a, 'click', () => order.push('a'));
    addEventListener(b, 'click', () => order.push('b'));
    addEventListener(c, 'click', () => order.push('c'));

    dispatchEvent(c, new Event('click', { bubbles: true }));
    expect(order).toEqual(['c', 'b', 'a']);
  });

  it('should handle removing listener during dispatch', () => {
    const el = createMutableElement('div');
    const handler1 = vi.fn(() => {
      removeEventListener(el, 'click', handler2);
    });
    const handler2 = vi.fn();
    addEventListener(el, 'click', handler1);
    addEventListener(el, 'click', handler2);

    dispatchEvent(el, new Event('click'));
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1); // was called before removal took effect

    // Second dispatch — only handler1 should fire
    dispatchEvent(el, new Event('click'));
    expect(handler1).toHaveBeenCalledTimes(2);
    expect(handler2).toHaveBeenCalledTimes(1); // removed
  });

  it('should handle event on text node', () => {
    const text = createMutableTextNode('hello');
    const handler = vi.fn();
    addEventListener(text, 'click', handler);
    dispatchEvent(text, new Event('click'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('getEventListeners should return registered listeners', () => {
    const el = createMutableElement('div');
    const h1 = vi.fn();
    const h2 = vi.fn();
    addEventListener(el, 'click', h1);
    addEventListener(el, 'mouseover', h2);
    const listeners = getEventListeners(el);
    expect(listeners.length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSED FLAG (shadow DOM boundary crossing)
// ─────────────────────────────────────────────────────────────────────────────

describe('composed flag — shadow DOM boundary crossing', () => {
  it('non-composed event should stop at shadow root boundary', () => {
    const doc = createMutableDocument();
    const host = createMutableElement('div');
    const inner = createMutableElement('span');
    appendChild(doc, host);
    appendChild(host, inner);

    // Attach shadow root with inner child
    const shadow = attachShadow(host, { mode: 'open' });
    // Move inner into shadow root
    appendChild(shadow as any, inner);

    const outerHandler = vi.fn();
    const innerHandler = vi.fn();
    addEventListener(host, 'click', outerHandler);
    addEventListener(inner, 'click', innerHandler);

    // Non-composed: should not reach host listener
    dispatchEvent(inner, new Event('click', { bubbles: true }));
    expect(innerHandler).toHaveBeenCalledTimes(1);
    expect(outerHandler).not.toHaveBeenCalled();
  });

  it('composed event should cross shadow root boundary', () => {
    const doc = createMutableDocument();
    const host = createMutableElement('div');
    const inner = createMutableElement('span');
    appendChild(doc, host);

    const shadow = attachShadow(host, { mode: 'open' });
    appendChild(shadow as any, inner);

    const outerHandler = vi.fn();
    const innerHandler = vi.fn();
    addEventListener(host, 'click', outerHandler);
    addEventListener(inner, 'click', innerHandler);

    // Composed: should reach host listener
    dispatchEvent(inner, new Event('click', { bubbles: true, composed: true }));
    expect(innerHandler).toHaveBeenCalledTimes(1);
    expect(outerHandler).toHaveBeenCalledTimes(1);
  });

  it('non-composed event should capture only within shadow boundary', () => {
    const doc = createMutableDocument();
    const host = createMutableElement('div');
    const inner = createMutableElement('span');
    appendChild(doc, host);

    const shadow = attachShadow(host, { mode: 'open' });
    appendChild(shadow as any, inner);

    const order: string[] = [];
    addEventListener(host, 'click', () => order.push('outer-capture'), { capture: true });
    addEventListener(inner, 'click', () => order.push('target'));

    dispatchEvent(inner, new Event('click', { bubbles: true }));
    // Only target fires — outer capture is across shadow boundary
    expect(order).toEqual(['target']);
  });

  it('composed event should capture across shadow boundary', () => {
    const doc = createMutableDocument();
    const host = createMutableElement('div');
    const inner = createMutableElement('span');
    appendChild(doc, host);

    const shadow = attachShadow(host, { mode: 'open' });
    appendChild(shadow as any, inner);

    const order: string[] = [];
    addEventListener(host, 'click', () => order.push('outer-capture'), { capture: true });
    addEventListener(inner, 'click', () => order.push('target'));

    dispatchEvent(inner, new Event('click', { bubbles: true, composed: true }));
    expect(order).toEqual(['outer-capture', 'target']);
  });

  it('non-composed event default should be false', () => {
    const e = new Event('click');
    expect(e.composed).toBe(false);
  });

  it('composed flag should be preserved on event object', () => {
    const e = new Event('click', { composed: true });
    expect(e.composed).toBe(true);
  });
});
