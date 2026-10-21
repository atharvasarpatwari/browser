import { describe, it, expect, beforeEach } from 'vitest';
import { TabStrip } from '../src/ui/components/tab-strip/tab-strip';
import { TabStripView } from '../src/ui/components/tab-strip/tab-strip.view';
import { TabManager } from '../src/browser/tabs/tab-manager';
import type { TabStripEventUnion } from '../src/ui/components/tab-strip/tab-strip';

function createDomContainer(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

function keydown(el: HTMLElement, key: string): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

describe('TabStripView keyboard navigation', () => {
  let manager: TabManager;
  let strip: TabStrip;
  let view: TabStripView;
  let container: HTMLElement;

  beforeEach(() => {
    manager = new TabManager();
    manager.createTab();
    manager.createTab();
    manager.createTab();
    strip = new TabStrip(manager);
    strip.syncWithManager();
    view = new TabStripView(strip);
    container = createDomContainer();
    view.attach(container);
    view.setEventHandler((e: TabStripEventUnion) => {
      if (e.kind === 'tabSelected') {
        manager.activateTab(e.tabId);
        strip.syncWithManager();
        view.update(strip.state);
      }
    });
    view.update(strip.state);
  });

  function tabEls(): HTMLElement[] {
    return [...container.querySelectorAll('.nova-tab')] as HTMLElement[];
  }

  it('renders a tablist with one tab role per tab', () => {
    expect(container.querySelector('[role="tablist"]')).not.toBeNull();
    const tabs = tabEls();
    expect(tabs).toHaveLength(3);
    for (const t of tabs) expect(t.getAttribute('role')).toBe('tab');
  });

  it('gives the active tab tabindex 0 and the rest -1 (roving tabindex)', () => {
    const tabs = tabEls();
    const activeId = strip.state.activeTabId;
    for (const t of tabs) {
      expect(t.tabIndex).toBe(t.dataset.tabId === activeId ? 0 : -1);
    }
  });

  it('ArrowRight moves to and activates the next tab, updating roving tabindex', () => {
    const tabs = tabEls();
    const first = tabs[0]!;
    first.focus();
    keydown(first, 'ArrowRight');

    const nextId = strip.state.tabs[1]!.id;
    expect(strip.state.activeTabId).toBe(nextId);
    const updated = tabEls();
    expect(updated.find(t => t.dataset.tabId === nextId)!.tabIndex).toBe(0);
    expect(updated.find(t => t.dataset.tabId === strip.state.tabs[0]!.id)!.tabIndex).toBe(-1);
  });

  it('ArrowLeft from the first tab wraps to the last tab', () => {
    const tabs = tabEls();
    const first = tabs[0]!;
    first.focus();
    keydown(first, 'ArrowLeft');
    expect(strip.state.activeTabId).toBe(strip.state.tabs[strip.state.tabs.length - 1]!.id);
  });

  it('Home/End jump to the first/last tab', () => {
    const tabs = tabEls();
    keydown(tabs[1]!, 'End');
    expect(strip.state.activeTabId).toBe(strip.state.tabs[strip.state.tabs.length - 1]!.id);
    keydown(tabEls()[1]!, 'Home');
    expect(strip.state.activeTabId).toBe(strip.state.tabs[0]!.id);
  });

  it('Enter/Space select the focused tab', () => {
    const tabs = tabEls();
    const third = tabs[2]!;
    keydown(third, 'Enter');
    expect(strip.state.activeTabId).toBe(third.dataset.tabId);
  });

  it('does nothing when keyboard nav is disabled', () => {
    view.setKeyboardNavEnabled(false);
    const activeBefore = strip.state.activeTabId;
    const tabs = tabEls();
    keydown(tabs[0]!, 'ArrowRight');
    expect(strip.state.activeTabId).toBe(activeBefore);
  });
});
