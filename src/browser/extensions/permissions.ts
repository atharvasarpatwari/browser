import type { ExtensionHostPermission } from './extension-types';

export type PermissionStatus = 'granted' | 'denied' | 'prompt';

export const KNOWN_PERMISSIONS: readonly ExtensionHostPermission[] = Object.freeze([
  'alarms', 'bookmarks', 'browsingData', 'clipboardRead', 'clipboardWrite',
  'contentSettings', 'contextMenus', 'cookies', 'debugger', 'declarativeContent',
  'declarativeNetRequest', 'desktopCapture', 'dns', 'downloads', 'enterprise',
  'favicon', 'fileBrowserHandler', 'fontSettings', 'gcm', 'geolocation',
  'history', 'identity', 'idle', 'management', 'nativeMessaging',
  'notifications', 'pageCapture', 'platformKeys', 'power', 'printerProvider',
  'privacy', 'processes', 'proxy', 'readingList', 'scripting',
  'search', 'sessions', 'storage', 'system.cpu', 'system.display',
  'system.memory', 'system.storage', 'tabCapture', 'tabs', 'topSites',
  'tts', 'unlimitedStorage', 'vpnProvider', 'wallpaper', 'webNavigation',
  'webRequest', 'webRequestBlocking',
]);

export const HOST_PERMISSION_PATTERN = /^(https?:\/\/|\*:\/\/|ftp:\/\/|file:\/\/)/;

export class Permissions {
  private granted = new Map<string, Set<string>>();
  private requested = new Map<string, Set<string>>();
  private handlers = new Set<(extensionId: string, permissions: string[]) => void>();

  grant(extensionId: string, permissions: string[]): void {
    const set = this.granted.get(extensionId) ?? new Set();
    for (const p of permissions) {
      set.add(p);
    }
    this.granted.set(extensionId, set);
    this.notify(extensionId, permissions);
  }

  revoke(extensionId: string, permissions: string[]): void {
    const set = this.granted.get(extensionId);
    if (!set) return;
    for (const p of permissions) {
      set.delete(p);
    }
  }

  hasPermission(extensionId: string, permission: string): boolean {
    const set = this.granted.get(extensionId);
    return set?.has(permission) ?? false;
  }

  hasAllPermissions(extensionId: string, permissions: string[]): boolean {
    return permissions.every(p => this.hasPermission(extensionId, p));
  }

  getGranted(extensionId: string): string[] {
    return [...(this.granted.get(extensionId) ?? [])];
  }

  contains(permissions: string[], permission: string): boolean {
    return permissions.includes(permission);
  }

  request(extensionId: string, permissions: string[]): PermissionStatus {
    const set = this.requested.get(extensionId) ?? new Set();
    for (const p of permissions) {
      set.add(p);
    }
    this.requested.set(extensionId, set);

    const allGranted = permissions.every(p => this.hasPermission(extensionId, p));
    if (allGranted) return 'granted';

    const allKnown = permissions.every(p => KNOWN_PERMISSIONS.includes(p));
    if (!allKnown) return 'denied';

    return 'prompt';
  }

  getRequested(extensionId: string): string[] {
    return [...(this.requested.get(extensionId) ?? [])];
  }

  validateHostPermission(pattern: string): boolean {
    return HOST_PERMISSION_PATTERN.test(pattern) || pattern === '<all_urls>';
  }

  isKnownPermission(permission: string): boolean {
    return KNOWN_PERMISSIONS.includes(permission);
  }

  getRequiredForManifest(permissions: string[]): string[] {
    return permissions.filter(p => this.isKnownPermission(p) || p === '<all_urls>' || this.validateHostPermission(p));
  }

  getOptionalFromManifest(permissions: string[]): string[] {
    return permissions.filter(p => this.isKnownPermission(p) || p === '<all_urls>' || this.validateHostPermission(p));
  }

  onChanged(handler: (extensionId: string, permissions: string[]) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  clear(): void {
    this.granted.clear();
    this.requested.clear();
  }

  dispose(): void {
    this.clear();
    this.handlers.clear();
  }

  private notify(extensionId: string, permissions: string[]): void {
    for (const h of this.handlers) {
      try { h(extensionId, permissions); } catch { }
    }
  }
}
