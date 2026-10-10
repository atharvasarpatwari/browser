import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextMenu } from '../src/ui/components/context-menu/context-menu';
import type { ContextMenuItem } from '../src/ui/components/context-menu/context-menu';

describe('ContextMenu', () => {
  let menu: ContextMenu;
  let target: HTMLElement;

  const rows = () => [...document.querySelectorAll<HTMLElement>('.nova-context-menu > div')];
  const labels = () => rows().map((r) => r.textContent);
  const visible = () => document.querySelector('.nova-context-menu') !== null;
  const tick = () => vi.advanceTimersByTime(0);
  const dispatch = (type: string, on: EventTarget = target, init: EventInit & { key?: string } = {}) => {
    const event = type === 'keydown' ? new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init }) : new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    on.dispatchEvent(event);
  };
  const items = (action = vi.fn()): ContextMenuItem[] => [{ label: 'One', action }, { separator: true }, { label: 'Two' }];

  beforeEach(() => {
    vi.useFakeTimers();
    menu = new ContextMenu();
    target = document.createElement('div');
    document.body.appendChild(target);
  });

  afterEach(() => {
    menu.dispose();
    target.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('shows its rows, and choosing one runs it and closes the menu', () => {
    const one = vi.fn();
    menu.show(10, 10, items(one));
    expect(labels()).toEqual(['One', '', 'Two']); // the middle div is the separator
    expect(menu.isVisible).toBe(true);
    rows()[0]!.click();
    expect(one).toHaveBeenCalledTimes(1);
    expect(visible()).toBe(false);
    expect(menu.isVisible).toBe(false);
  });

  it('does not run, or react to, a disabled item', () => {
    const action = vi.fn();
    menu.show(10, 10, [{ label: 'Off', disabled: true, action }]);
    expect(rows()[0]!.style.pointerEvents).toBe('none');
  });

  it('closes on a click or right-click outside, but not on one inside', () => {
    menu.show(10, 10, items());
    tick();
    dispatch('mousedown', rows()[0]!);
    dispatch('contextmenu', rows()[0]!);
    expect(visible()).toBe(true);

    dispatch('mousedown', target);
    expect(visible()).toBe(false);

    menu.show(10, 10, items());
    tick();
    dispatch('contextmenu', target);
    expect(visible()).toBe(false);
  });

  it('closes on Escape, and ignores other keys', () => {
    menu.show(10, 10, items());
    tick();
    dispatch('keydown', document, { key: 'a' });
    expect(visible()).toBe(true);
    dispatch('keydown', document, { key: 'Escape' });
    expect(visible()).toBe(false);
  });

  it('is not closed by the event that opened it', () => {
    target.addEventListener('contextmenu', (e) => { e.preventDefault(); menu.show(10, 10, items()); });
    dispatch('contextmenu');
    expect(visible()).toBe(true); // the event has reached the document by now
    tick();
    expect(visible()).toBe(true);
  });

  it('opens a second menu from a right-click after an item was chosen from the first (a stale listener used to close it at once)', () => {
    const open = (e: Event) => { e.preventDefault(); menu.show(10, 10, items()); };
    target.addEventListener('contextmenu', open);

    dispatch('contextmenu');
    tick();
    rows()[0]!.click(); // choose an item: the first menu closes
    expect(visible()).toBe(false);

    dispatch('contextmenu');
    expect(visible()).toBe(true);
    tick();
    expect(visible()).toBe(true);
  });

  it('replaces a menu that is still open when the user right-clicks again', () => {
    const open = (e: Event) => { e.preventDefault(); menu.show(10, 10, items()); };
    target.addEventListener('contextmenu', open);
    dispatch('contextmenu');
    tick();
    dispatch('contextmenu');
    expect(document.querySelectorAll('.nova-context-menu')).toHaveLength(1);
    tick();
    expect(document.querySelectorAll('.nova-context-menu')).toHaveLength(1);
  });

  it('leaves no document listeners behind however the menu closes', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const count = (spy: typeof add, type: string) => spy.mock.calls.filter((c) => c[0] === type).length;
    const closers: Array<() => void> = [
      () => rows()[0]!.click(),
      () => dispatch('mousedown', target),
      () => dispatch('keydown', document, { key: 'Escape' }),
      () => menu.hide(),
      () => menu.dispose(),
    ];
    for (const close of closers) {
      menu.show(10, 10, items());
      tick();
      close();
    }
    for (const type of ['mousedown', 'contextmenu', 'keydown']) {
      expect(count(add, type), type).toBe(closers.length);
      expect(count(remove, type), type).toBe(closers.length);
    }
  });

  it('registers nothing when it is closed before the arming tick', () => {
    const add = vi.spyOn(document, 'addEventListener');
    menu.show(10, 10, items());
    menu.hide();
    tick();
    expect(add.mock.calls.filter((c) => ['mousedown', 'contextmenu', 'keydown'].includes(c[0] as string))).toHaveLength(0);
  });
});
