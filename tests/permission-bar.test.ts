import { describe, it, expect } from 'vitest';
import { PermissionBar } from '../src/ui/components/permission-bar/permission-bar';

function createContainer(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

function clickButton(container: HTMLElement, text: string): void {
  const buttons = Array.from(container.querySelectorAll('button'));
  const btn = buttons.find((b) => b.textContent === text);
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('PermissionBar (unit)', () => {
  it('shows the bar with correct origin/permission copy, resolves "granted" on Allow', async () => {
    const bar = new PermissionBar();
    const container = createContainer();
    bar.attach(container);

    expect(bar.isVisible()).toBe(false);
    const pending = bar.request('https://example.com', 'geolocation');
    expect(bar.isVisible()).toBe(true);
    expect(container.textContent).toContain('example.com');
    expect(container.textContent).toContain('Know your location');

    clickButton(container, 'Allow');
    expect(await pending).toBe('granted');
    expect(bar.isVisible()).toBe(false);
  });

  it('resolves "denied" on Block', async () => {
    const bar = new PermissionBar();
    const container = createContainer();
    bar.attach(container);

    const pending = bar.request('https://example.com', 'notifications');
    clickButton(container, 'Block');
    expect(await pending).toBe('denied');
  });

  it('a second request made while one is pending queues instead of clobbering the first', async () => {
    const bar = new PermissionBar();
    const container = createContainer();
    bar.attach(container);

    const first = bar.request('https://a.test', 'geolocation');
    const second = bar.request('https://b.test', 'notifications');

    // First request's copy is still showing — second hasn't clobbered it.
    expect(container.textContent).toContain('a.test');
    expect(container.textContent).not.toContain('b.test');

    clickButton(container, 'Allow');
    expect(await first).toBe('granted');

    // Now the second request's copy shows.
    expect(bar.isVisible()).toBe(true);
    expect(container.textContent).toContain('b.test');

    clickButton(container, 'Block');
    expect(await second).toBe('denied');
    expect(bar.isVisible()).toBe(false);
  });

  it('dispose() resolves any still-pending request as denied', async () => {
    const bar = new PermissionBar();
    const container = createContainer();
    bar.attach(container);

    const pending = bar.request('https://example.com', 'clipboard-read');
    bar.dispose();

    expect(await pending).toBe('denied');
  });
});
