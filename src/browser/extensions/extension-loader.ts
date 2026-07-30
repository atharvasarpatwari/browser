import type { ExtensionData, ExtensionEvent, ExtensionEventHandler } from './extension-types';
import type { ExtensionManifest } from './extension-types';
import { createExtensionFromManifest, validateManifest } from './manifest';

export interface ExtensionSource {
  id: string;
  manifest: Record<string, unknown>;
  basePath: string;
  code?: Record<string, string>;
}

export class ExtensionLoader {
  private extensions = new Map<string, ExtensionData>();
  private handlers = new Set<ExtensionEventHandler>();

  loadFromSource(source: ExtensionSource): { data: ExtensionData | null; errors: string[] } {
    const { data, errors } = createExtensionFromManifest(source.manifest, source.basePath);
    if (!data) return { data: null, errors };

    const existing = this.extensions.get(data.id);
    if (existing) {
      existing.manifest = data.manifest;
      existing.basePath = data.basePath;
      existing.enabled = true;
      existing.installedAt = Date.now();
      this.emit({ kind: 'updated', extensionId: data.id });
      return { data: existing, errors };
    }

    this.extensions.set(data.id, data);
    this.emit({ kind: 'installed', extensionId: data.id });
    return { data, errors };
  }

  loadFromManifest(manifest: Record<string, unknown>, basePath: string): { data: ExtensionData | null; errors: string[] } {
    return this.loadFromSource({ id: '', manifest, basePath });
  }

  uninstall(extensionId: string): boolean {
    const ext = this.extensions.get(extensionId);
    if (!ext) return false;
    this.extensions.delete(extensionId);
    this.emit({ kind: 'uninstalled', extensionId });
    return true;
  }

  enable(extensionId: string): boolean {
    const ext = this.extensions.get(extensionId);
    if (!ext) return false;
    if (ext.enabled) return true;
    ext.enabled = true;
    this.emit({ kind: 'enabled', extensionId });
    return true;
  }

  disable(extensionId: string): boolean {
    const ext = this.extensions.get(extensionId);
    if (!ext) return false;
    if (!ext.enabled) return true;
    ext.enabled = false;
    this.emit({ kind: 'disabled', extensionId });
    return true;
  }

  getExtension(extensionId: string): ExtensionData | undefined {
    return this.extensions.get(extensionId);
  }

  getEnabledExtensions(): ExtensionData[] {
    return [...this.extensions.values()].filter(e => e.enabled);
  }

  getAllExtensions(): ExtensionData[] {
    return [...this.extensions.values()];
  }

  isInstalled(extensionId: string): boolean {
    return this.extensions.has(extensionId);
  }

  isEnabled(extensionId: string): boolean {
    return this.extensions.get(extensionId)?.enabled ?? false;
  }

  count(): number {
    return this.extensions.size;
  }

  validate(raw: Record<string, unknown>): { valid: boolean; errors: string[]; warnings: string[] } {
    return validateManifest(raw);
  }

  onEvent(handler: ExtensionEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  clear(): void {
    const ids = [...this.extensions.keys()];
    this.extensions.clear();
    for (const id of ids) {
      this.emit({ kind: 'uninstalled', extensionId: id });
    }
  }

  dispose(): void {
    this.clear();
    this.handlers.clear();
  }

  private emit(event: ExtensionEvent): void {
    for (const h of this.handlers) {
      try { h(event); } catch { }
    }
  }
}
