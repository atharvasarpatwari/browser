import type { IDisposable } from '../../app/dependency-container';
import type { ExtensionLoader } from '../../browser/extensions/extension-loader';
import type { Permissions } from '../../browser/extensions/permissions';
import { createExtensionFromManifest } from '../../browser/extensions/manifest';
import { showPermissionDialog } from '../components/permission-dialog';

interface IExtensionsPage extends IDisposable {
  readonly isMounted: boolean;
  mount(container: HTMLElement): void;
  unmount(): void;
  setExtensions(loader: ExtensionLoader, permissions: Permissions): void;
}

class ExtensionsPage implements IExtensionsPage {
  private loader: ExtensionLoader | null = null;
  private permissions: Permissions | null = null;
  private container: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private manifestInput: HTMLTextAreaElement | null = null;
  private installError: HTMLElement | null = null;
  private _mounted = false;

  get isMounted(): boolean {
    return this._mounted;
  }

  setExtensions(loader: ExtensionLoader, permissions: Permissions): void {
    this.loader = loader;
    this.permissions = permissions;
    this.renderList();
  }

  mount(container: HTMLElement): void {
    this.container = container;
    this.container.className = 'extensions-page';
    this.container.style.cssText = 'display:flex;flex-direction:column;gap:20px;height:100%;overflow-y:auto;padding:24px 32px;box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif;background:var(--bg-body,#0f0f0f);color:var(--text-primary,#e0e0e0);';
    this.build();
    this._mounted = true;
  }

  unmount(): void {
    if (this.container) {
      this.container.innerHTML = '';
      this.container = null;
    }
    this.listEl = null;
    this.manifestInput = null;
    this.installError = null;
    this._mounted = false;
  }

  dispose(): void {
    this.unmount();
  }

  private build(): void {
    if (!this.container) return;

    const title = document.createElement('h2');
    title.textContent = 'Extensions';
    title.style.cssText = 'margin:0;font-size:20px;font-weight:600;';
    this.container.appendChild(title);

    this.listEl = document.createElement('div');
    this.listEl.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
    this.container.appendChild(this.listEl);

    const installSection = document.createElement('div');
    installSection.style.cssText = 'border-top:1px solid var(--border-subtle,rgba(255,255,255,.06));padding-top:16px;display:flex;flex-direction:column;gap:8px;';

    const installTitle = document.createElement('h3');
    installTitle.textContent = 'Install extension';
    installTitle.style.cssText = 'margin:0;font-size:14px;font-weight:600;';
    installSection.appendChild(installTitle);

    const hint = document.createElement('p');
    hint.textContent = 'Paste a manifest.json to install. You’ll be asked to approve its requested permissions first.';
    hint.style.cssText = 'margin:0;font-size:12px;color:var(--text-tertiary,#6a6a68);';
    installSection.appendChild(hint);

    this.manifestInput = document.createElement('textarea');
    this.manifestInput.rows = 6;
    this.manifestInput.placeholder = '{ "manifest_version": 3, "name": "...", "version": "1.0", "permissions": ["storage"] }';
    this.manifestInput.style.cssText = 'width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--border-default,rgba(255,255,255,.1));border-radius:var(--radius-sm,4px);font-size:12px;font-family:monospace;background:var(--bg-elevated,#1c1c1e);color:var(--text-primary,#e0e0e0);resize:vertical;';
    installSection.appendChild(this.manifestInput);

    this.installError = document.createElement('div');
    this.installError.style.cssText = 'font-size:12px;color:#f87171;min-height:16px;';
    installSection.appendChild(this.installError);

    const installBtn = document.createElement('button');
    installBtn.type = 'button';
    installBtn.textContent = 'Install';
    installBtn.style.cssText = 'align-self:flex-start;padding:7px 14px;border:1px solid var(--border-default,rgba(255,255,255,.1));border-radius:var(--radius-sm,4px);font-size:13px;background:var(--bg-elevated,#1c1c1e);color:var(--text-primary,#e0e0e0);cursor:pointer;';
    installBtn.addEventListener('click', () => this.handleInstallClick());
    installSection.appendChild(installBtn);

    this.container.appendChild(installSection);

    this.renderList();
  }

  private handleInstallClick(): void {
    if (!this.loader || !this.permissions || !this.manifestInput || !this.installError) return;
    this.installError.textContent = '';

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(this.manifestInput.value) as Record<string, unknown>;
    } catch {
      this.installError.textContent = 'Not valid JSON.';
      return;
    }

    const basePath = `inline://${Date.now()}`;
    const { data, errors } = createExtensionFromManifest(raw, basePath);
    if (!data) {
      this.installError.textContent = errors.join(' ') || 'Invalid manifest.';
      return;
    }

    const requested = [...(data.manifest.permissions ?? []), ...(data.manifest.host_permissions ?? [])];
    const loader = this.loader;
    const permissions = this.permissions;
    const manifestInput = this.manifestInput;

    showPermissionDialog({
      title: `Add "${data.manifest.name}"?`,
      description: `Version ${data.manifest.version}. This extension is asking for:`,
      permissions: requested,
      onAllow: () => {
        if (requested.length > 0) permissions.grant(data.id, requested);
        loader.loadFromManifest(raw, basePath);
        manifestInput.value = '';
        this.renderList();
      },
      onDeny: () => {
        // Nothing was installed; nothing to undo.
      },
    });
  }

  private renderList(): void {
    if (!this.listEl || !this.loader) return;
    const extensions = this.loader.getAllExtensions();
    this.listEl.innerHTML = '';

    if (extensions.length === 0) {
      const empty = document.createElement('p');
      empty.textContent = 'No extensions installed.';
      empty.style.cssText = 'margin:0;font-size:13px;color:var(--text-tertiary,#6a6a68);';
      this.listEl.appendChild(empty);
      return;
    }

    for (const ext of extensions) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid var(--border-subtle,rgba(255,255,255,.06));border-radius:var(--radius-md,6px);background:var(--bg-surface,#161618);';

      const info = document.createElement('div');
      const name = document.createElement('div');
      name.textContent = `${ext.manifest.name} ${ext.manifest.version}`;
      name.style.cssText = 'font-weight:600;font-size:13px;';
      info.appendChild(name);
      if (ext.manifest.description) {
        const desc = document.createElement('div');
        desc.textContent = ext.manifest.description;
        desc.style.cssText = 'font-size:11.5px;color:var(--text-tertiary,#6a6a68);margin-top:2px;';
        info.appendChild(desc);
      }
      row.appendChild(info);

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:8px;';

      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.textContent = ext.enabled ? 'Disable' : 'Enable';
      toggleBtn.style.cssText = 'padding:6px 12px;border:1px solid var(--border-default,rgba(255,255,255,.1));border-radius:var(--radius-sm,4px);font-size:12px;background:var(--bg-elevated,#1c1c1e);color:var(--text-primary,#e0e0e0);cursor:pointer;';
      toggleBtn.addEventListener('click', () => {
        if (!this.loader) return;
        if (ext.enabled) this.loader.disable(ext.id);
        else this.loader.enable(ext.id);
        this.renderList();
      });
      actions.appendChild(toggleBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.style.cssText = 'padding:6px 12px;border:1px solid var(--border-default,rgba(255,255,255,.1));border-radius:var(--radius-sm,4px);font-size:12px;background:var(--bg-elevated,#1c1c1e);color:#f87171;cursor:pointer;';
      removeBtn.addEventListener('click', () => {
        if (!this.loader) return;
        this.loader.uninstall(ext.id);
        this.renderList();
      });
      actions.appendChild(removeBtn);

      row.appendChild(actions);
      this.listEl.appendChild(row);
    }
  }
}

export { ExtensionsPage };
export type { IExtensionsPage };
