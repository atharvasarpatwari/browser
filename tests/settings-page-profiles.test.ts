import { describe, it, expect } from 'vitest';
import { SettingsPage } from '../src/ui/pages/settings-page';
import { createProfileManager } from '../src/browser/settings/profiles';

function createContainer(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

function openProfilesSection(container: HTMLElement): void {
  const items = Array.from(container.querySelectorAll('.settings-nav-item'));
  const profilesItem = items.find((el) => el.textContent?.includes('Profiles'));
  profilesItem?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function profileRowNames(container: HTMLElement): string[] {
  const content = container.querySelector('.settings-content')!;
  // Each profile row's name div is a flex:1 sibling of the avatar circle —
  // simplest reliable selector is "any direct row div with a Switch/Remove
  // button inside it", but plain text content scanning is sufficient here
  // since this test only asserts on profile names appearing/disappearing.
  return Array.from(content.querySelectorAll('button'))
    .filter((b) => b.textContent === 'Remove')
    .map((b) => b.parentElement?.textContent ?? '');
}

function clickButtonInRow(container: HTMLElement, rowText: string, buttonText: string): void {
  const content = container.querySelector('.settings-content')!;
  const buttons = Array.from(content.querySelectorAll('button'));
  const btn = buttons.find((b) => b.textContent === buttonText && b.parentElement?.textContent?.includes(rowText));
  btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('SettingsPage — Profiles section (real ProfileManager, no mocks)', () => {
  it('renders one row per existing profile, with the default profile shown', () => {
    const manager = createProfileManager();
    const page = new SettingsPage(undefined, manager);
    const container = createContainer();
    page.mount(container);

    openProfilesSection(container);

    expect(profileRowNames(container).some((t) => t.includes('Default'))).toBe(true);
  });

  it('creating a profile via the inline form adds it to the list', () => {
    const manager = createProfileManager();
    const page = new SettingsPage(undefined, manager);
    const container = createContainer();
    page.mount(container);
    openProfilesSection(container);

    const content = container.querySelector('.settings-content')!;
    const input = content.querySelector('input[type="text"]') as HTMLInputElement;
    input.value = 'Work';
    const createBtn = Array.from(content.querySelectorAll('button')).find((b) => b.textContent === 'Create');
    createBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(profileRowNames(container).some((t) => t.includes('Work'))).toBe(true);
    expect(manager.getProfiles().some((p) => p.name === 'Work')).toBe(true);
  });

  it('clicking Switch on a profile makes it active and moves the Active badge', () => {
    const manager = createProfileManager();
    const other = manager.createProfile('Work');
    const page = new SettingsPage(undefined, manager);
    const container = createContainer();
    page.mount(container);
    openProfilesSection(container);

    clickButtonInRow(container, 'Work', 'Switch');

    expect(manager.getActiveProfile().id).toBe(other.id);
    const content = container.querySelector('.settings-content')!;
    const activeBadge = Array.from(content.querySelectorAll('span')).find((s) => s.textContent === 'Active');
    expect(activeBadge?.parentElement?.textContent).toContain('Work');
  });

  it('clicking Remove on a non-default profile removes it from the list', () => {
    const manager = createProfileManager();
    manager.createProfile('Work');
    const page = new SettingsPage(undefined, manager);
    const container = createContainer();
    page.mount(container);
    openProfilesSection(container);

    clickButtonInRow(container, 'Work', 'Remove');

    expect(profileRowNames(container).some((t) => t.includes('Work'))).toBe(false);
    expect(manager.getProfiles().some((p) => p.name === 'Work')).toBe(false);
  });

  it('renders an empty list gracefully when no ProfileManager was supplied', () => {
    const page = new SettingsPage();
    const container = createContainer();
    page.mount(container);

    expect(() => openProfilesSection(container)).not.toThrow();
    expect(profileRowNames(container)).toEqual([]);
  });
});
