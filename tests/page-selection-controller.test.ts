import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PageSelectionController } from '../src/ui/components/page-selection/page-selection-controller';
import type { FindBlock, FindRun, FindTextSource } from '../src/browser/navigation-controls/find-in-page';

const FS = 16;
const CHAR = 8;
function block(text: string, x0: number, y: number): FindBlock {
  const runs: FindRun[] = [];
  let x = x0;
  for (const token of text.split(/(\s+)/).filter(Boolean)) {
    runs.push({ text: token, x, y, fontSize: FS, width: token.length * CHAR });
    x += token.length * CHAR;
  }
  return { runs };
}
const SOURCE: FindTextSource = { getBlocks: () => [block('Hello brave new world', 10, 20), block('Second paragraph', 10, 60)] };

// The 800x600 page bitmap is shown at half size (400x300) at the top-left of the area.
const SCALE = 0.5;
const client = (pageX: number, pageY: number): { clientX: number; clientY: number } => ({ clientX: pageX * SCALE, clientY: pageY * SCALE });
const xOf = (charIndex: number): number => 10 + charIndex * CHAR;

describe('PageSelectionController', () => {
  let area: HTMLElement;
  let page: HTMLCanvasElement;
  let controller: PageSelectionController;

  const mouse = (type: string, target: EventTarget, pageX: number, pageY: number, init: MouseEventInit = {}): MouseEvent => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, detail: 1, ...client(pageX, pageY), ...init });
    target.dispatchEvent(event);
    return event;
  };
  const drag = (fromX: number, toX: number, y = 14): void => {
    mouse('mousedown', page, fromX, y);
    mouse('mousemove', document, toX, y);
    mouse('mouseup', document, toX, y);
  };

  beforeEach(() => {
    area = document.createElement('div');
    page = document.createElement('canvas');
    page.width = 800;
    page.height = 600;
    page.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300, x: 0, y: 0, toJSON: () => ({}) });
    Object.defineProperty(area, 'clientWidth', { value: 400 });
    Object.defineProperty(area, 'clientHeight', { value: 300 });
    area.appendChild(page);
    document.body.appendChild(area);
    controller = new PageSelectionController({ area, source: SOURCE });
    controller.attach();
  });
  afterEach(() => { controller.dispose(); area.remove(); });

  it('selects the text that is dragged over, and draws it over the page', () => {
    drag(xOf(6), xOf(11));
    expect(controller.hasSelection).toBe(true);
    expect(controller.text()).toBe('brave');
    expect(area.querySelectorAll('canvas.nova-selection-overlay')).toHaveLength(1);
    expect((area.querySelector('canvas.nova-selection-overlay') as HTMLElement).style.pointerEvents).toBe('none');
  });

  it('follows the pointer while it is down, even outside the page', () => {
    mouse('mousedown', page, xOf(6), 14);
    mouse('mousemove', document, 5000, 5000); // far past the end of the page
    expect(controller.text()).toBe('brave new world\nSecond paragraph');
    mouse('mouseup', document, 5000, 5000);
  });

  it('a double-click selects a word and a triple-click the whole block', () => {
    mouse('mousedown', page, xOf(8), 14, { detail: 2 });
    expect(controller.text()).toBe('brave');
    mouse('mousedown', page, xOf(8), 14, { detail: 3 });
    expect(controller.text()).toBe('Hello brave new world');
  });

  it('Shift-click extends the selection', () => {
    drag(xOf(0), xOf(5));
    mouse('mousedown', page, xOf(11), 14, { shiftKey: true });
    expect(controller.text()).toBe('Hello brave');
  });

  it('a plain click selects nothing and clears an earlier selection', () => {
    drag(xOf(6), xOf(11));
    mouse('mousedown', page, xOf(1), 14);
    mouse('mouseup', document, xOf(1), 14);
    expect(controller.hasSelection).toBe(false);
    expect(area.querySelector('canvas.nova-selection-overlay')).toBeNull();
  });

  it('ignores other mouse buttons, so a right-click keeps the selection', () => {
    drag(xOf(6), xOf(11));
    mouse('mousedown', page, xOf(1), 14, { button: 2 });
    expect(controller.text()).toBe('brave');
  });

  it('a drag that ends over a link does not also follow it: the click after a drag is swallowed once', () => {
    const clicked = vi.fn();
    page.addEventListener('click', clicked);
    drag(xOf(6), xOf(11));
    page.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...client(xOf(11), 14) }));
    expect(clicked).not.toHaveBeenCalled();
    page.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...client(xOf(11), 14) }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('a click without a drag still reaches the page (links keep working)', () => {
    const clicked = vi.fn();
    page.addEventListener('click', clicked);
    mouse('mousedown', page, xOf(1), 14);
    mouse('mouseup', document, xOf(1), 14);
    page.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('knows whether a client point is on the selection', () => {
    drag(xOf(6), xOf(11));
    expect(controller.containsClientPoint(...Object.values(client(xOf(8), 14)) as [number, number])).toBe(true);
    expect(controller.containsClientPoint(...Object.values(client(xOf(1), 14)) as [number, number])).toBe(false);
  });

  it('selects everything on a rendered page, and clears', () => {
    expect(controller.selectAll()).toBe(true);
    expect(controller.text()).toBe('Hello brave new world\nSecond paragraph');
    controller.clear();
    expect(controller.hasSelection).toBe(false);
    expect(area.querySelector('canvas.nova-selection-overlay')).toBeNull();
  });

  it('selects nothing where there is no page bitmap (built-in pages are real DOM)', () => {
    page.remove();
    expect(controller.selectAll()).toBe(false);
  });

  it('takes focus out of a text field when a selection starts, so Ctrl+C copies the page text', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);
    mouse('mousedown', page, xOf(6), 14);
    mouse('mouseup', document, xOf(6), 14);
    expect(document.activeElement).not.toBe(input);
    input.remove();
  });

  it('stops listening when disposed', () => {
    controller.dispose();
    drag(xOf(6), xOf(11));
    expect(controller.hasSelection).toBe(false);
  });
});
