import { describe, it, expect } from 'vitest';
import { SettingsPage } from '../src/ui/pages/settings-page';
import { PersistentPermissionStore } from '../src/browser/storage/persistent-stores';

function createContainer(): HTMLElement {
  const div = document.createElement('div');
  document.body.appendChild(div);
  return div;
}

function openPermissionsSection(container: HTMLElement): void {
  const items = Array.from(container.querySelectorAll('.settings-nav-item'));
  const item = items.find((el) => el.textContent?.includes('Permissions'));
  item?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function permissionRowTexts(container: HTMLElement): string[] {
  const content = container.querySelector('.settings-content')!;
  return Array.from(content.querySelectorAll('button'))
    .filter((b) => b.textContent === 'Revoke')
    .map((b) => b.parentElement?.textContent ?? '');
}

describe('SettingsPage — Permissions section (real PersistentPermissionStore, no mocks)', () => {
  it('renders one row per granted permission', () => {
    const store = new PersistentPermissionStore();
    store.set('https://example.com', 'geolocation', 'granted');
    const page = new SettingsPage(undefined, undefined, store);
    const container = createContainer();
    page.mount(container);

    openPermissionsSection(container);

    const rows = permissionRowTexts(container);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('https://example.com');
    expect(rows[0]).toContain('geolocation');
    expect(rows[0]).toContain('granted');
  });

  it('clicking Revoke removes the grant from the store and the list', () => {
    const store = new PersistentPermissionStore();
    store.set('https://example.com', 'notifications', 'granted');
    const page = new SettingsPage(undefined, undefined, store);
    const container = createContainer();
    page.mount(container);
    openPermissionsSection(container);

    const content = container.querySelector('.settings-content')!;
    const revokeBtn = Array.from(content.querySelectorAll('button')).find((b) => b.textContent === 'Revoke');
    revokeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(permissionRowTexts(container)).toEqual([]);
    expect(store.get('https://example.com', 'notifications')).toBeUndefined();
  });

  it('shows an empty state when no permissions are granted', () => {
    const store = new PersistentPermissionStore();
    const page = new SettingsPage(undefined, undefined, store);
    const container = createContainer();
    page.mount(container);

    openPermissionsSection(container);

    expect(permissionRowTexts(container)).toEqual([]);
    expect(container.querySelector('.settings-content')!.textContent).toContain('No permissions granted yet');
  });

  it('renders the empty state gracefully when no PersistentPermissionStore was supplied', () => {
    const page = new SettingsPage();
    const container = createContainer();
    page.mount(container);

    expect(() => openPermissionsSection(container)).not.toThrow();
    expect(permissionRowTexts(container)).toEqual([]);
  });
});
