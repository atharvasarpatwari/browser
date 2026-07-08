import { describe, it, expect, vi } from 'vitest';
import { SettingsPage, DEFAULT_SECTIONS } from '../src/ui/pages/settings-page';

function createDomContainer(): HTMLElement {
  const div = document.createElement('div');
  div.id = 'test';
  return div;
}

describe('SettingsPage (unit)', () => {
  it('should initialize with default sections', () => {
    const page = new SettingsPage();
    expect(page.sections.length).toBeGreaterThan(0);
    expect(page.sections[0]!.id).toBe('general');
  });

  it('should initialize with custom sections', () => {
    const sections = [
      { id: 'custom', title: 'Custom', icon: 'C', settings: [{ key: 'opt', label: 'Option', description: 'Desc', type: 'boolean' as const, defaultValue: true }] },
    ];
    const page = new SettingsPage(sections);
    expect(page.sections).toHaveLength(1);
    expect(page.sections[0]!.id).toBe('custom');
  });

  it('should have default values for all settings', () => {
    const page = new SettingsPage();
    expect(page.getSetting('homePage')).toBe('about:blank');
    expect(page.getSetting('theme')).toBe('system');
    expect(page.getSetting('enableCsp')).toBe(true);
  });

  it('setSetting should update a value and emit event', () => {
    const page = new SettingsPage();
    const handler = vi.fn();
    page.on('settingChanged', handler);

    page.setSetting('theme', 'dark');
    expect(page.getSetting('theme')).toBe('dark');
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'settingChanged', key: 'theme', value: 'dark' })
    );
  });

  it('getSetting should return undefined for unknown key', () => {
    const page = new SettingsPage();
    expect(page.getSetting('nonexistent')).toBeUndefined();
  });

  it('resetToDefaults should restore all default values', () => {
    const page = new SettingsPage();
    page.setSetting('theme', 'dark');
    page.setSetting('homePage', 'https://example.com');
    page.resetToDefaults();
    expect(page.getSetting('theme')).toBe('system');
    expect(page.getSetting('homePage')).toBe('about:blank');
  });

  it('getActiveSection should return the current section id', () => {
    const page = new SettingsPage();
    expect(page.getActiveSection()).toBe('general');
  });

  it('setActiveSection should change the active section', () => {
    const page = new SettingsPage();
    page.setActiveSection('privacy');
    expect(page.getActiveSection()).toBe('privacy');
  });

  it('on/off should manage event handlers', () => {
    const page = new SettingsPage();
    const handler = vi.fn();
    page.on('settingChanged', handler);
    page.setSetting('theme', 'dark');
    expect(handler).toHaveBeenCalledTimes(1);
    page.off('settingChanged', handler);
    page.setSetting('theme', 'light');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('isMounted should reflect mount state', () => {
    const page = new SettingsPage();
    expect(page.isMounted).toBe(false);
  });

  it('dispose should unmount and clear', () => {
    const page = new SettingsPage();
    page.setSetting('theme', 'dark');
    page.dispose();
    expect(page.isMounted).toBe(false);
  });

  it('should call all handlers on any event', () => {
    const page = new SettingsPage();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    page.on('sectionChanged', handler1);
    page.on('settingChanged', handler2);
    page.setSetting('theme', 'dark');
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsPage (mount)', () => {
  it('mount should render the UI', () => {
    const page = new SettingsPage();
    const container = createDomContainer();
    page.mount(container);
    expect(page.isMounted).toBe(true);
    expect(container.className).toContain('settings-page');
    expect(container.querySelector('.settings-sidebar')).not.toBeNull();
    expect(container.querySelector('.settings-content')).not.toBeNull();
  });

  it('mount should set CSS classes', () => {
    const page = new SettingsPage();
    const container = createDomContainer();
    page.mount(container);
    expect(container.className).toContain('settings-page');
  });

  it('unmount should clean up the container', () => {
    const page = new SettingsPage();
    const container = createDomContainer();
    page.mount(container);
    page.unmount();
    expect(page.isMounted).toBe(false);
    expect(container.innerHTML).toBe('');
  });

  it('mount + unmount + mount works', () => {
    const page = new SettingsPage();
    const container = createDomContainer();
    page.mount(container);
    page.unmount();
    page.mount(container);
    expect(page.isMounted).toBe(true);
  });
});
