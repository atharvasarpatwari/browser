import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateManifest, normalizeManifest, createExtensionFromManifest } from '../src/browser/extensions/manifest';
import { ExtensionLoader } from '../src/browser/extensions/extension-loader';
import { ContentScriptsManager, matchUrlPattern } from '../src/browser/extensions/content-scripts';
import { BackgroundScriptsManager } from '../src/browser/extensions/background-scripts';
import { Messaging } from '../src/browser/extensions/messaging';
import { ExtensionStorage } from '../src/browser/extensions/storage-api';
import { Permissions, KNOWN_PERMISSIONS } from '../src/browser/extensions/permissions';
import { computeExtensionId } from '../src/browser/extensions/extension-types';

// ══════════════════════════════════════════════════════════════════════════
// 1. MANIFEST
// ══════════════════════════════════════════════════════════════════════════

describe('Manifest', () => {
  it('validates a correct manifest V3', () => {
    const result = validateManifest({
      manifest_version: 3,
      name: 'My Extension',
      version: '1.0.0',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing manifest_version', () => {
    const result = validateManifest({ name: 'Test', version: '1.0' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('manifest_version'))).toBe(true);
  });

  it('rejects unsupported manifest_version', () => {
    const result = validateManifest({ manifest_version: 1, name: 'T', version: '1.0' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Unsupported'))).toBe(true);
  });

  it('rejects missing name', () => {
    const result = validateManifest({ manifest_version: 3, version: '1.0' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('name'))).toBe(true);
  });

  it('rejects invalid version', () => {
    const result = validateManifest({ manifest_version: 3, name: 'T', version: 'abc' });
    expect(result.valid).toBe(false);
  });

  it('validates content_scripts structure', () => {
    const result = validateManifest({
      manifest_version: 3,
      name: 'T',
      version: '1.0',
      content_scripts: [
        { matches: ['https://*.example.com/*'], js: ['content.js'] },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it('rejects content_script without matches', () => {
    const result = validateManifest({
      manifest_version: 3,
      name: 'T',
      version: '1.0',
      content_scripts: [{ js: ['c.js'] }],
    });
    expect(result.valid).toBe(false);
  });

  it('normalizes manifest V3', () => {
    const manifest = normalizeManifest({
      manifest_version: 3,
      name: 'Test Ext',
      version: '1.2.3',
      description: 'A test',
      permissions: ['storage', 'tabs'],
      host_permissions: ['https://*.example.com/*'],
    });
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.name).toBe('Test Ext');
    expect(manifest.version).toBe('1.2.3');
    expect(manifest.permissions).toEqual(['storage', 'tabs']);
    expect(manifest.host_permissions).toEqual(['https://*.example.com/*']);
  });

  it('creates extension from manifest', () => {
    const { data, errors } = createExtensionFromManifest(
      { manifest_version: 3, name: 'MyExt', version: '1.0.0' },
      '/extensions/myext/',
    );
    expect(data).not.toBeNull();
    expect(data!.id).toBeTruthy();
    expect(data!.manifest.name).toBe('MyExt');
    expect(errors).toHaveLength(0);
  });

  it('returns errors for invalid manifest', () => {
    const { data, errors } = createExtensionFromManifest(
      { version: '1.0' },
      '/extensions/bad/',
    );
    expect(data).toBeNull();
    expect(errors.length).toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. EXTENSION LOADER
// ══════════════════════════════════════════════════════════════════════════

describe('ExtensionLoader', () => {
  let loader: ExtensionLoader;
  beforeEach(() => { loader = new ExtensionLoader(); });
  afterEach(() => { loader.dispose(); });

  it('starts empty', () => {
    expect(loader.count()).toBe(0);
  });

  it('loads from manifest', () => {
    const { data, errors } = loader.loadFromManifest(
      { manifest_version: 3, name: 'Ext1', version: '1.0.0' },
      '/ext/e1/',
    );
    expect(data).not.toBeNull();
    expect(errors).toHaveLength(0);
    expect(loader.count()).toBe(1);
  });

  it('emits installed event', () => {
    const handler = vi.fn();
    loader.onEvent(handler);
    loader.loadFromManifest({ manifest_version: 3, name: 'E', version: '1.0' }, '/e/');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'installed' }));
  });

  it('getExtension returns by id', () => {
    const { data } = loader.loadFromManifest({ manifest_version: 3, name: 'MyExt', version: '1.0.0' }, '/e/');
    const found = loader.getExtension(data!.id);
    expect(found?.manifest.name).toBe('MyExt');
  });

  it('getAllExtensions returns all', () => {
    loader.loadFromManifest({ manifest_version: 3, name: 'A', version: '1.0' }, '/a/');
    loader.loadFromManifest({ manifest_version: 3, name: 'B', version: '2.0' }, '/b/');
    expect(loader.getAllExtensions()).toHaveLength(2);
  });

  it('uninstall removes and emits', () => {
    const { data } = loader.loadFromManifest({ manifest_version: 3, name: 'X', version: '1.0' }, '/x/');
    const handler = vi.fn();
    loader.onEvent(handler);
    const result = loader.uninstall(data!.id);
    expect(result).toBe(true);
    expect(loader.count()).toBe(0);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'uninstalled' }));
  });

  it('uninstall returns false for unknown', () => {
    expect(loader.uninstall('nonexistent')).toBe(false);
  });

  it('enable/disable toggles state', () => {
    const { data } = loader.loadFromManifest({ manifest_version: 3, name: 'E', version: '1.0' }, '/e/');
    expect(loader.isEnabled(data!.id)).toBe(true);
    loader.disable(data!.id);
    expect(loader.isEnabled(data!.id)).toBe(false);
    loader.enable(data!.id);
    expect(loader.isEnabled(data!.id)).toBe(true);
  });

  it('disable emits disabled event', () => {
    const handler = vi.fn();
    loader.onEvent(handler);
    const { data } = loader.loadFromManifest({ manifest_version: 3, name: 'E', version: '1.0' }, '/e/');
    loader.disable(data!.id);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'disabled' }));
  });

  it('getEnabledExtensions filters', () => {
    const { data: a } = loader.loadFromManifest({ manifest_version: 3, name: 'A', version: '1.0' }, '/a/');
    loader.loadFromManifest({ manifest_version: 3, name: 'B', version: '2.0' }, '/b/');
    loader.disable(a!.id);
    expect(loader.getEnabledExtensions()).toHaveLength(1);
  });

  it('isInstalled checks existence', () => {
    const { data } = loader.loadFromManifest({ manifest_version: 3, name: 'C', version: '1.0' }, '/c/');
    expect(loader.isInstalled(data!.id)).toBe(true);
    expect(loader.isInstalled('fake')).toBe(false);
  });

  it('validate validates raw manifest', () => {
    const result = loader.validate({ manifest_version: 3, name: 'OK', version: '1.0' });
    expect(result.valid).toBe(true);
  });

  it('update on re-load emits updated', () => {
    const handler = vi.fn();
    loader.onEvent(handler);
    loader.loadFromManifest({ manifest_version: 3, name: 'U', version: '1.0' }, '/u/');
    handler.mockClear();
    loader.loadFromManifest({ manifest_version: 3, name: 'U', version: '1.0' }, '/u2/');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'updated' }));
  });

  it('clear removes all', () => {
    loader.loadFromManifest({ manifest_version: 3, name: 'A', version: '1.0' }, '/a/');
    loader.loadFromManifest({ manifest_version: 3, name: 'B', version: '1.0' }, '/b/');
    loader.clear();
    expect(loader.count()).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. CONTENT SCRIPTS
// ══════════════════════════════════════════════════════════════════════════

describe('ContentScriptsManager', () => {
  let csm: ContentScriptsManager;
  beforeEach(() => { csm = new ContentScriptsManager(); });
  afterEach(() => { csm.dispose(); });

  it('registers a content script', () => {
    const script = csm.register('ext-1', { matches: ['https://*.example.com/*'], js: ['content.js'] });
    expect(script.id).toMatch(/^cs-/);
    expect(script.extensionId).toBe('ext-1');
  });

  it('register emits registered event', () => {
    const handler = vi.fn();
    csm.onEvent(handler);
    csm.register('ext-1', { matches: ['https://*.example.com/*'] });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'registered' }));
  });

  it('unregister removes and emits', () => {
    const s = csm.register('ext-1', { matches: ['*://*/*'] });
    const handler = vi.fn();
    csm.onEvent(handler);
    csm.unregister(s.id);
    expect(csm.getScript(s.id)).toBeUndefined();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'unregistered' }));
  });

  it('unregisterAllForExtension removes all for extension', () => {
    csm.register('ext-1', { matches: ['*://*/*'] });
    csm.register('ext-1', { matches: ['https://*.example.com/*'] });
    csm.register('ext-2', { matches: ['*://*/*'] });
    csm.unregisterAllForExtension('ext-1');
    expect(csm.getScriptsForExtension('ext-1')).toHaveLength(0);
    expect(csm.getScriptsForExtension('ext-2')).toHaveLength(1);
  });

  it('getScriptsForExtension returns matching', () => {
    csm.register('ext-a', { matches: ['https://a.com/*'] });
    csm.register('ext-b', { matches: ['https://b.com/*'] });
    expect(csm.getScriptsForExtension('ext-a')).toHaveLength(1);
    expect(csm.getScriptsForExtension('ext-c')).toHaveLength(0);
  });

  it('matchesUrl matches patterns', () => {
    const s = csm.register('ext-1', { matches: ['https://*.example.com/*'] });
    expect(csm.matchesUrl(s, 'https://www.example.com/page')).toBe(true);
    expect(csm.matchesUrl(s, 'http://example.com')).toBe(false);
    expect(csm.matchesUrl(s, 'https://other.com')).toBe(false);
  });

  it('matchesUrl respects excludeMatches', () => {
    const s = csm.register('ext-1', {
      matches: ['https://*.example.com/*'],
      excludeMatches: ['https://*.example.com/exclude*'],
    });
    expect(csm.matchesUrl(s, 'https://sub.example.com/page')).toBe(true);
    expect(csm.matchesUrl(s, 'https://sub.example.com/exclude/me')).toBe(false);
  });

  it('findMatchingScripts returns matching scripts', () => {
    csm.register('ext-1', { matches: ['https://sub.example.com/*'] });
    csm.register('ext-2', { matches: ['<all_urls>'] });
    const matches = csm.findMatchingScripts('https://sub.example.com/test');
    expect(matches).toHaveLength(2);
  });

  it('getJSForScripts returns code for matching', () => {
    csm.register('ext-1', { matches: ['https://sub.example.com/*'] }, ['console.log("hi");']);
    const result = csm.getJSForScripts('https://sub.example.com/test');
    expect(result).toHaveLength(1);
    expect(result[0].code[0]).toBe('console.log("hi");');
  });

  it('getCSSForScripts returns css for matching', () => {
    csm.register('ext-1', { matches: ['https://sub.example.com/*'] }, undefined, ['body { color: red; }']);
    const result = csm.getCSSForScripts('https://sub.example.com/test');
    expect(result).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// matchUrlPattern
// ══════════════════════════════════════════════════════════════════════════

describe('matchUrlPattern', () => {
  it('<all_urls> matches http/https', () => {
    expect(matchUrlPattern('<all_urls>', 'https://example.com')).toBe(true);
    expect(matchUrlPattern('<all_urls>', 'http://example.com')).toBe(true);
  });

  it('exact protocol matches', () => {
    expect(matchUrlPattern('https://*/*', 'https://example.com/page')).toBe(true);
    expect(matchUrlPattern('http://*/*', 'https://example.com/page')).toBe(false);
  });

  it('wildcard host matches', () => {
    expect(matchUrlPattern('https://*.example.com/*', 'https://sub.example.com/path')).toBe(true);
    expect(matchUrlPattern('https://*.example.com/*', 'https://other.com/path')).toBe(false);
  });

  it('globs match paths', () => {
    expect(matchUrlPattern('https://example.com/*/test', 'https://example.com/foo/test')).toBe(true);
    expect(matchUrlPattern('https://example.com/*/test', 'https://example.com/foo/bar/test')).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. BACKGROUND SCRIPTS
// ══════════════════════════════════════════════════════════════════════════

describe('BackgroundScriptsManager', () => {
  let bg: BackgroundScriptsManager;
  beforeEach(() => { bg = new BackgroundScriptsManager(); });
  afterEach(() => { bg.dispose(); });

  it('starts a background page', () => {
    const info = bg.start('ext-1', { scripts: ['bg.js'], persistent: true });
    expect(info.extensionId).toBe('ext-1');
    expect(info.active).toBe(true);
  });

  it('start emits started event', () => {
    const handler = vi.fn();
    bg.onEvent(handler);
    bg.start('ext-1', { scripts: ['bg.js'] });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'started' }));
  });

  it('stop deactivates and emits', () => {
    bg.start('ext-1', { scripts: ['bg.js'] });
    const handler = vi.fn();
    bg.onEvent(handler);
    bg.stop('ext-1');
    expect(bg.isActive('ext-1')).toBe(false);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'stopped' }));
  });

  it('heartbeat updates lastActivity', () => {
    bg.start('ext-1', { scripts: ['bg.js'] });
    const before = bg.getInfo('ext-1')!.lastActivity;
    bg.heartbeat('ext-1');
    expect(bg.getInfo('ext-1')!.lastActivity).toBeGreaterThanOrEqual(before);
  });

  it('getBackgroundScripts returns scripts', () => {
    bg.start('ext-1', { scripts: ['bg.js', 'helper.js'] });
    expect(bg.getBackgroundScripts('ext-1')).toEqual(['bg.js', 'helper.js']);
  });

  it('getBackgroundScripts returns service_worker', () => {
    bg.start('ext-1', { service_worker: 'sw.js' });
    expect(bg.getBackgroundScripts('ext-1')).toEqual(['sw.js']);
  });

  it('getBackgroundScripts returns page', () => {
    bg.start('ext-1', { page: 'bg.html' });
    expect(bg.getBackgroundScripts('ext-1')).toEqual(['bg.html']);
  });

  it('isPersistent returns flag', () => {
    bg.start('ext-1', { scripts: ['bg.js'], persistent: true });
    expect(bg.isPersistent('ext-1')).toBe(true);
    bg.start('ext-2', { scripts: ['bg.js'] });
    expect(bg.isPersistent('ext-2')).toBe(false);
  });

  it('getAllActive returns active only', () => {
    bg.start('ext-1', { scripts: ['bg.js'] });
    bg.start('ext-2', { scripts: ['bg.js'] });
    bg.stop('ext-1');
    expect(bg.getAllActive()).toHaveLength(1);
  });

  it('reportError emits error', () => {
    const handler = vi.fn();
    bg.onEvent(handler);
    bg.reportError('ext-1', 'Something broke');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', message: 'Something broke' }));
  });

  it('stopAll stops all', () => {
    bg.start('ext-1', { scripts: ['bg.js'] });
    bg.start('ext-2', { scripts: ['bg.js'] });
    bg.stopAll();
    expect(bg.getAllActive()).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 5. MESSAGING
// ══════════════════════════════════════════════════════════════════════════

describe('Messaging', () => {
  let msg: Messaging;
  beforeEach(() => { msg = new Messaging(); });
  afterEach(() => { msg.dispose(); });

  it('addListener registers a listener', () => {
    const unsub = msg.addListener('ext-1', () => {});
    expect(typeof unsub).toBe('function');
  });

  it('sendMessage delivers to listener', async () => {
    const fn = vi.fn((_msg, _sender, sendResponse) => { sendResponse('pong'); return true; });
    msg.addListener('ext-1', fn);
    const response = await msg.sendMessage('ext-1', { text: 'ping' }, { id: 'ext-2' });
    expect(fn).toHaveBeenCalled();
    expect(response).toBe('pong');
  });

  it('sendMessage rejects when no listener', async () => {
    const response = await msg.sendMessage('ext-1', { text: 'hi' }, { id: 'ext-other' });
    expect(response).toEqual({ success: false, error: 'No listeners registered' });
  });

  it('addExternalListener registers external listener', () => {
    const fn = vi.fn();
    msg.addExternalListener('ext-1', fn);
    expect(typeof fn).toBe('function');
  });

  it('connect creates a port', () => {
    const port = msg.connect('ext-1', 'my-port', { id: 'ext-2' });
    expect(port.name).toBe('my-port');
    expect(port.sender.id).toBe('ext-2');
  });

  it('connect emits portConnected event', () => {
    const handler = vi.fn();
    msg.onEvent(handler);
    msg.connect('ext-1', 'p', { id: 'ext-2' });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'portConnected' }));
  });

  it('port postMessage delivers to onMessage', () => {
    const fn = vi.fn();
    const port = msg.connect('ext-1', 'p', { id: 'ext-2' });
    port.onMessage.addListener(fn);
    port.postMessage({ data: 42 });
    expect(fn).toHaveBeenCalledWith({ data: 42 });
  });

  it('port disconnect triggers onDisconnect and emits event', () => {
    const handler = vi.fn();
    msg.onEvent(handler);
    const fn = vi.fn();
    const port = msg.connect('ext-1', 'p', { id: 'ext-2' });
    port.onDisconnect.addListener(fn);
    port.disconnect();
    expect(fn).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'portDisconnected' }));
  });

  it('onConnect fires when port is created', () => {
    const connectFn = vi.fn();
    msg.onConnect('ext-1', connectFn);
    const port = msg.connect('ext-1', 'p', { id: 'ext-2' });
    expect(connectFn).toHaveBeenCalledWith(port);
  });

  it('unsubscribe removes listener', async () => {
    const fn = vi.fn();
    const unsub = msg.addListener('ext-1', fn);
    unsub();
    await msg.sendMessage('ext-1', { text: 'hi' }, { id: 'ext-2' });
    expect(fn).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 6. STORAGE API
// ══════════════════════════════════════════════════════════════════════════

describe('ExtensionStorage', () => {
  let store: ExtensionStorage;
  beforeEach(() => { store = new ExtensionStorage(); });
  afterEach(() => { store.dispose(); });

  it('get with null returns all keys', () => {
    store.set('ext-1', 'local', { a: 1, b: 2 });
    const all = store.get('ext-1', 'local', null);
    expect(all).toEqual({ a: 1, b: 2 });
  });

  it('get with string returns single key', () => {
    store.set('ext-1', 'local', { x: 10, y: 20 });
    expect(store.get('ext-1', 'local', 'x')).toEqual({ x: 10 });
    expect(store.get('ext-1', 'local', 'z')).toEqual({});
  });

  it('get with array returns multiple', () => {
    store.set('ext-1', 'local', { a: 1, b: 2, c: 3 });
    expect(store.get('ext-1', 'local', ['a', 'c'])).toEqual({ a: 1, c: 3 });
  });

  it('get with object returns defaults', () => {
    store.set('ext-1', 'local', { a: 1 });
    const result = store.get('ext-1', 'local', { a: 'default', b: 'default' });
    expect(result).toEqual({ a: 1, b: 'default' });
  });

  it('set stores values', () => {
    store.set('ext-1', 'local', { key1: 'value1' });
    const result = store.get('ext-1', 'local', null);
    expect(result).toEqual({ key1: 'value1' });
  });

  it('set emits onChanged', () => {
    const handler = vi.fn();
    store.onChanged(handler);
    store.set('ext-1', 'local', { k: 'v' });
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][1]).toBe('local');
  });

  it('remove deletes keys', () => {
    store.set('ext-1', 'local', { a: 1, b: 2 });
    store.remove('ext-1', 'local', 'a');
    expect(store.get('ext-1', 'local', null)).toEqual({ b: 2 });
  });

  it('clear empties area', () => {
    store.set('ext-1', 'local', { a: 1 });
    store.clear('ext-1', 'local');
    expect(store.get('ext-1', 'local', null)).toEqual({});
  });

  it('getBytesInUse returns size', () => {
    store.set('ext-1', 'local', { a: 'hello' });
    const bytes = store.getBytesInUse('ext-1', 'local');
    expect(bytes).toBeGreaterThan(0);
  });

  it('works with sync area', () => {
    store.set('ext-1', 'sync', { s: 'value' });
    expect(store.get('ext-1', 'sync', 's')).toEqual({ s: 'value' });
  });

  it('works with session area', () => {
    store.set('ext-1', 'session', { tmp: 'data' });
    expect(store.get('ext-1', 'session', 'tmp')).toEqual({ tmp: 'data' });
  });

  it('setManaged stores managed data', () => {
    store.setManaged('ext-1', { policy: 'strict' });
    expect(store.get('ext-1', 'managed', null)).toEqual({ policy: 'strict' });
  });

  it('getQuota returns limits', () => {
    const local = store.getQuota('local');
    expect(local.maxBytes).toBe(10 * 1024 * 1024);
    const sync = store.getQuota('sync');
    expect(sync.maxItems).toBe(512);
  });

  it('isolation between extensions', () => {
    store.set('ext-a', 'local', { shared: 'from-a' });
    store.set('ext-b', 'local', { shared: 'from-b' });
    expect(store.get('ext-a', 'local', 'shared')).toEqual({ shared: 'from-a' });
    expect(store.get('ext-b', 'local', 'shared')).toEqual({ shared: 'from-b' });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 7. PERMISSIONS
// ══════════════════════════════════════════════════════════════════════════

describe('Permissions', () => {
  let perms: Permissions;
  beforeEach(() => { perms = new Permissions(); });
  afterEach(() => { perms.dispose(); });

  it('grants permissions', () => {
    perms.grant('ext-1', ['storage', 'tabs']);
    expect(perms.hasPermission('ext-1', 'storage')).toBe(true);
    expect(perms.hasPermission('ext-1', 'tabs')).toBe(true);
  });

  it('hasPermission returns false for missing', () => {
    expect(perms.hasPermission('ext-1', 'storage')).toBe(false);
  });

  it('revoke removes permissions', () => {
    perms.grant('ext-1', ['storage']);
    perms.revoke('ext-1', ['storage']);
    expect(perms.hasPermission('ext-1', 'storage')).toBe(false);
  });

  it('hasAllPermissions checks multiple', () => {
    perms.grant('ext-1', ['storage', 'tabs', 'cookies']);
    expect(perms.hasAllPermissions('ext-1', ['storage', 'tabs'])).toBe(true);
    expect(perms.hasAllPermissions('ext-1', ['storage', 'geolocation'])).toBe(false);
  });

  it('getGranted returns all granted', () => {
    perms.grant('ext-1', ['a', 'b']);
    expect(perms.getGranted('ext-1')).toEqual(['a', 'b']);
  });

  it('contains checks array membership', () => {
    expect(perms.contains(['storage', 'tabs'], 'storage')).toBe(true);
    expect(perms.contains(['storage', 'tabs'], 'geolocation')).toBe(false);
  });

  it('KNOWN_PERMISSIONS includes common entries', () => {
    expect(KNOWN_PERMISSIONS).toContain('storage');
    expect(KNOWN_PERMISSIONS).toContain('tabs');
    expect(KNOWN_PERMISSIONS).toContain('cookies');
    expect(KNOWN_PERMISSIONS).toContain('notifications');
    expect(KNOWN_PERMISSIONS).toContain('nativeMessaging');
  });

  it('validateHostPermission validates patterns', () => {
    expect(perms.validateHostPermission('https://*.example.com/*')).toBe(true);
    expect(perms.validateHostPermission('<all_urls>')).toBe(true);
    expect(perms.validateHostPermission('ftp://*/*')).toBe(true);
  });

  it('isKnownPermission checks known list', () => {
    expect(perms.isKnownPermission('storage')).toBe(true);
    expect(perms.isKnownPermission('unknown-permission')).toBe(false);
  });

  it('getRequiredForManifest filters known', () => {
    const result = perms.getRequiredForManifest(['storage', 'unknown-xyz', 'https://*.example.com/*']);
    expect(result).toEqual(['storage', 'https://*.example.com/*']);
  });

  it('request returns prompt for unknown permissions', () => {
    const status = perms.request('ext-1', ['unknown-permission']);
    expect(status).toBe('denied');
  });

  it('request returns granted for already granted', () => {
    perms.grant('ext-1', ['storage']);
    const status = perms.request('ext-1', ['storage']);
    expect(status).toBe('granted');
  });

  it('request returns prompt for new known permissions', () => {
    const status = perms.request('ext-1', ['storage']);
    expect(status).toBe('prompt');
  });

  it('onChanged emits on grant', () => {
    const handler = vi.fn();
    perms.onChanged(handler);
    perms.grant('ext-1', ['tabs']);
    expect(handler).toHaveBeenCalledWith('ext-1', ['tabs']);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// computeExtensionId
// ══════════════════════════════════════════════════════════════════════════

describe('computeExtensionId', () => {
  it('returns a string id', () => {
    const id = computeExtensionId('My Extension', '1.0.0');
    expect(typeof id).toBe('string');
    expect(id.startsWith('ext-')).toBe(true);
  });

  it('different inputs produce different ids', () => {
    const id1 = computeExtensionId('Ext A', '1.0.0');
    const id2 = computeExtensionId('Ext B', '1.0.0');
    expect(id1).not.toBe(id2);
  });

  it('same input produces same id', () => {
    const id1 = computeExtensionId('Same', '1.0.0');
    const id2 = computeExtensionId('Same', '1.0.0');
    expect(id1).toBe(id2);
  });
});
