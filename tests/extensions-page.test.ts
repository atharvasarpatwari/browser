import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ExtensionsPage } from '../src/ui/pages/extensions-page';
import { ExtensionLoader } from '../src/browser/extensions/extension-loader';
import { Permissions } from '../src/browser/extensions/permissions';
import { computeExtensionId } from '../src/browser/extensions/extension-types';

function createDomContainer(): HTMLElement {
  const div = document.createElement('div');
  div.id = 'test';
  return div;
}

const MANIFEST = {
  manifest_version: 3,
  name: 'Test Extension',
  version: '1.0',
  permissions: ['storage', 'tabs'],
  host_permissions: ['https://example.com/*'],
};

function install(container: HTMLElement, manifest: Record<string, unknown>): void {
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
  textarea.value = JSON.stringify(manifest);
  const installBtn = [...container.querySelectorAll('button')].find(b => b.textContent === 'Install')!;
  installBtn.click();
}

function clickDialogButton(label: 'Allow' | 'Deny'): void {
  const btn = [...document.querySelectorAll('button')].find(b => b.textContent === label)!;
  btn.click();
}

describe('ExtensionsPage', () => {
  let page: ExtensionsPage;
  let loader: ExtensionLoader;
  let permissions: Permissions;
  let container: HTMLElement;

  beforeEach(() => {
    page = new ExtensionsPage();
    loader = new ExtensionLoader();
    permissions = new Permissions();
    container = createDomContainer();
    page.mount(container);
    page.setExtensions(loader, permissions);
  });

  afterEach(() => {
    document.querySelectorAll('.nova-permission-dialog-overlay').forEach(el => el.remove());
  });

  it('shows "no extensions" when none are installed', () => {
    expect(container.textContent).toContain('No extensions installed');
  });

  it('shows the dialog listing the manifest\'s declared permissions before installing', () => {
    install(container, MANIFEST);
    const items = [...document.querySelectorAll('.nova-permission-dialog-overlay li')].map(li => li.textContent);
    expect(items).toEqual(['storage', 'tabs', 'https://example.com/*']);
    expect(loader.getAllExtensions()).toHaveLength(0);
  });

  it('Deny leaves nothing installed and nothing granted', () => {
    install(container, MANIFEST);
    clickDialogButton('Deny');
    expect(loader.getAllExtensions()).toHaveLength(0);
    const id = computeExtensionId(MANIFEST.name, MANIFEST.version);
    expect(permissions.getGranted(id)).toHaveLength(0);
  });

  it('Allow grants the requested permissions and installs the extension', () => {
    install(container, MANIFEST);
    clickDialogButton('Allow');

    const installed = loader.getAllExtensions();
    expect(installed).toHaveLength(1);
    expect(installed[0]!.manifest.name).toBe('Test Extension');
    expect(permissions.hasAllPermissions(installed[0]!.id, ['storage', 'tabs', 'https://example.com/*'])).toBe(true);
    expect(container.textContent).toContain('Test Extension');
  });

  it('shows a validation error and no dialog for an invalid manifest', () => {
    install(container, { manifest_version: 3 }); // missing required name/version
    expect(document.querySelector('.nova-permission-dialog-overlay')).toBeNull();
    expect(loader.getAllExtensions()).toHaveLength(0);
  });

  it('Disable keeps the extension listed but toggles its enabled state', () => {
    install(container, MANIFEST);
    clickDialogButton('Allow');
    const disableBtn = [...container.querySelectorAll('button')].find(b => b.textContent === 'Disable')!;
    disableBtn.click();

    const installed = loader.getAllExtensions();
    expect(installed).toHaveLength(1);
    expect(installed[0]!.enabled).toBe(false);
    expect(container.textContent).toContain('Test Extension');
  });
});
