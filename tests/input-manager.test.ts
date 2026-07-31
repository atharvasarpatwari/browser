import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InputManager } from '../src/platform/shared/input-manager';

describe('InputManager', () => {
  let manager: InputManager;

  beforeEach(() => {
    manager = new InputManager();
    manager.start();
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('start/stop lifecycle', () => {
    it('should start with a clean state', () => {
      expect(manager.isShiftDown).toBe(false);
      expect(manager.isCtrlDown).toBe(false);
      expect(manager.isAltDown).toBe(false);
      expect(manager.isMetaDown).toBe(false);
      expect(manager.isDragging).toBe(false);
      expect(manager.lastMouseX).toBe(0);
      expect(manager.lastMouseY).toBe(0);
    });

    it('should not double-register listeners on repeated start', () => {
      manager.start();
      manager.start();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      expect(manager.isShiftDown).toBe(false);
    });

    it('should stop listening after stop()', () => {
      manager.stop();
      let fired = false;
      manager.on('keydown', () => { fired = true; });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      expect(fired).toBe(false);
    });
  });

  describe('keyboard events', () => {
    it('should emit keydown with key/code/modifiers', () => {
      const handler = vi.fn();
      manager.on('keydown', handler);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', ctrlKey: true }));
      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0];
      expect(event.kind).toBe('keydown');
      expect(event.data.key).toBe('Enter');
      expect(event.data.code).toBe('Enter');
      expect(event.data.ctrlKey).toBe(true);
    });

    it('should emit keyup with repeat flag', () => {
      const handler = vi.fn();
      manager.on('keyup', handler);
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', repeat: true }));
      const event = handler.mock.calls[0][0];
      expect(event.kind).toBe('keyup');
      expect(event.data.repeat).toBe(true);
    });

    it('should track modifier state while keys are held', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', shiftKey: true }));
      expect(manager.isShiftDown).toBe(true);
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', shiftKey: false }));
      expect(manager.isShiftDown).toBe(false);
    });
  });

  describe('mouse events', () => {
    it('should emit mousedown with coordinates and button', () => {
      const handler = vi.fn();
      manager.on('mousedown', handler);
      window.dispatchEvent(new MouseEvent('mousedown', { clientX: 120, clientY: 80, button: 0, buttons: 1 }));
      const event = handler.mock.calls[0][0];
      expect(event.kind).toBe('mousedown');
      expect(event.data.x).toBe(120);
      expect(event.data.y).toBe(80);
      expect(event.data.button).toBe(0);
      expect(event.data.buttons).toBe(1);
    });

    it('should track the last mouse position on mousemove', () => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300, clientY: 200 }));
      expect(manager.lastMouseX).toBe(300);
      expect(manager.lastMouseY).toBe(200);
    });

    it('should emit mouseenter and mouseleave', () => {
      const enter = vi.fn();
      const leave = vi.fn();
      manager.on('mouseenter', enter);
      manager.on('mouseleave', leave);
      window.dispatchEvent(new MouseEvent('mouseenter', { clientX: 10, clientY: 10 }));
      window.dispatchEvent(new MouseEvent('mouseleave', { clientX: 10, clientY: 10 }));
      expect(enter).toHaveBeenCalledTimes(1);
      expect(leave).toHaveBeenCalledTimes(1);
    });
  });

  describe('drag and drop events', () => {
    function makeDragEvent(type: string, data: Record<string, string>): DragEvent {
      const dt = new DataTransfer();
      for (const [k, v] of Object.entries(data)) dt.setData(k, v);
      const event = new DragEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { configurable: true, value: dt });
      Object.defineProperty(event, 'clientX', { configurable: true, value: 50 });
      Object.defineProperty(event, 'clientY', { configurable: true, value: 60 });
      return event;
    }

    it('should emit dragstart with drag types and text payload', () => {
      const handler = vi.fn();
      manager.on('dragstart', handler);
      window.dispatchEvent(makeDragEvent('dragstart', { 'text/plain': 'hello' }));
      expect(handler).toHaveBeenCalledTimes(1);
      const event = handler.mock.calls[0][0];
      expect(event.kind).toBe('dragstart');
      expect(event.data.types).toContain('text/plain');
      expect(event.data.sourceText).toBe('hello');
      expect(manager.isDragging).toBe(true);
      expect(manager.activeDragText).toBe('hello');
    });

    it('should emit dragover and drop, and clear drag state on drop', () => {
      const over = vi.fn();
      const drop = vi.fn();
      manager.on('dragover', over);
      manager.on('drop', drop);
      window.dispatchEvent(makeDragEvent('dragstart', { 'text/plain': 'payload' }));
      window.dispatchEvent(makeDragEvent('dragover', { 'text/plain': 'payload' }));
      window.dispatchEvent(makeDragEvent('drop', { 'text/plain': 'payload' }));
      expect(over).toHaveBeenCalledTimes(1);
      expect(drop).toHaveBeenCalledTimes(1);
      const dropEvent = drop.mock.calls[0][0];
      expect(dropEvent.data.x).toBe(50);
      expect(dropEvent.data.y).toBe(60);
      expect(manager.isDragging).toBe(false);
      expect(manager.activeDragText).toBeNull();
    });

    it('should emit dragleave', () => {
      const handler = vi.fn();
      manager.on('dragleave', handler);
      window.dispatchEvent(makeDragEvent('dragleave', {}));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('handler safety', () => {
    it('should survive a throwing handler', () => {
      const bad = () => { throw new Error('boom'); };
      const good = vi.fn();
      manager.on('mousemove', bad);
      manager.on('mousemove', good);
      expect(() => window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 2 }))).not.toThrow();
      expect(good).toHaveBeenCalledTimes(1);
    });

    it('should allow off() to unsubscribe', () => {
      const handler = vi.fn();
      manager.on('keydown', handler);
      manager.off('keydown', handler);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
