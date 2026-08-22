import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ThemeManager, createThemeManager, BUILT_IN_THEMES,
  detectSystemTheme, themeToCSSVariables,
} from '../src/browser/settings/themes';
import {
  ProfileManager, createProfileManager, randomAvatar,
} from '../src/browser/settings/profiles';
import {
  SyncEngine, createSyncEngine, deriveEncryptionKey, computeChecksum,
} from '../src/browser/settings/sync';
import {
  IncognitoManager, createIncognitoManager,
} from '../src/browser/settings/incognito';
import {
  GuestManager, createGuestManager,
} from '../src/browser/settings/guest';
import {
  SessionRestore, createSessionRestore,
  type SavedWindow, type SavedTab,
} from '../src/browser/settings/session-restore';
import {
  StartupPages, createStartupPages,
} from '../src/browser/settings/startup-pages';

function makeTab(overrides?: Partial<SavedTab>): SavedTab {
  return { id: 'tab-1', url: 'https://example.com', title: 'Example', favicon: '', scrollX: 0, scrollY: 0, zoomLevel: 1, lastActiveAt: Date.now(), formData: {}, ...overrides };
}

function makeWindow(overrides?: Partial<SavedWindow>): SavedWindow {
  return { id: 'win-1', x: 0, y: 0, width: 1200, height: 800, isMaximized: false, tabs: [makeTab()], activeTabIndex: 0, ...overrides };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. THEMES
// ═══════════════════════════════════════════════════════════════════════════════

describe('ThemeManager', () => {
  let tm: ThemeManager;
  beforeEach(() => { tm = createThemeManager(); });
  afterEach(() => { tm.dispose(); });

  it('initializes with system mode', () => { expect(tm.getMode()).toBe('system'); });
  it('getResolvedMode returns light or dark', () => { expect(['light', 'dark']).toContain(tm.getResolvedMode()); });
  it('getActiveTheme returns a built-in theme', () => { expect(tm.getActiveTheme().isBuiltIn).toBe(true); });
  it('BUILT_IN_THEMES has 2 entries', () => { expect(BUILT_IN_THEMES).toHaveLength(2); });
  it('setMode changes mode', () => { tm.setMode('light'); expect(tm.getMode()).toBe('light'); });
  it('setMode emits themeChanged', () => { const h = vi.fn(); tm.onEvent(h); tm.setMode('dark'); expect(h).toHaveBeenCalled(); });
  it('setCustomTheme switches to custom mode', () => {
    tm.addCustomTheme({ id: 'custom-1', name: 'My Theme', mode: 'dark', colors: { ...BUILT_IN_THEMES[0].colors }, isBuiltIn: false });
    tm.setCustomTheme('custom-1');
    expect(tm.getMode()).toBe('custom');
    expect(tm.getActiveTheme().id).toBe('custom-1');
  });
  it('addCustomTheme and removeCustomTheme', () => {
    tm.addCustomTheme({ id: 'c1', name: 'T', mode: 'light', colors: { ...BUILT_IN_THEMES[0].colors }, isBuiltIn: false });
    expect(tm.getCustomThemes()).toHaveLength(1);
    tm.removeCustomTheme('c1');
    expect(tm.getCustomThemes()).toHaveLength(0);
  });
  it('removeCustomTheme returns false for unknown', () => { expect(tm.removeCustomTheme('nope')).toBe(false); });
  it('getAllThemes includes built-in + custom', () => {
    tm.addCustomTheme({ id: 'c1', name: 'T', mode: 'light', colors: { ...BUILT_IN_THEMES[0].colors }, isBuiltIn: false });
    expect(tm.getAllThemes()).toHaveLength(3);
  });
  it('getThemeById finds built-in', () => { expect(tm.getThemeById('nova-dark')?.name).toBe('Nova Dark'); });
  it('getThemeById returns undefined for unknown', () => { expect(tm.getThemeById('nope')).toBeUndefined(); });
  it('themeToCSSVariables returns CSS vars string', () => {
    const vars = themeToCSSVariables(BUILT_IN_THEMES[0].colors);
    expect(vars).toContain('--bg-body:');
    expect(vars).toContain('--accent:');
  });
  it('detectSystemTheme returns light or dark', () => { expect(['light', 'dark']).toContain(detectSystemTheme()); });
  it('getConfig returns copy', () => { const c = tm.getConfig(); c.mode = 'light'; expect(tm.getMode()).toBe('system'); });
  it('setAccentColor and getAccentColor', () => { tm.setAccentColor('#ff0000'); expect(tm.getAccentColor()).toBe('#ff0000'); });
  it('onEvent returns unsubscribe', () => { const h = vi.fn(); const u = tm.onEvent(h); u(); tm.setMode('dark'); expect(h).not.toHaveBeenCalled(); });
  it('handler errors do not crash', () => { tm.onEvent(() => { throw new Error('x'); }); expect(() => tm.setMode('light')).not.toThrow(); });
  it('dispose clears handlers', () => { tm.dispose(); const h = vi.fn(); tm.onEvent(h); tm.setMode('dark'); expect(h).not.toHaveBeenCalled(); });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. PROFILES
// ═══════════════════════════════════════════════════════════════════════════════

describe('ProfileManager', () => {
  let pm: ProfileManager;
  beforeEach(() => { pm = createProfileManager(); });
  afterEach(() => { pm.dispose(); });

  it('starts with default profile', () => { expect(pm.getProfiles()).toHaveLength(1); expect(pm.getActiveProfile().isDefault).toBe(true); });
  it('createProfile adds a profile', () => {
    pm.createProfile('Work');
    expect(pm.getProfiles()).toHaveLength(2);
  });
  it('createProfile with options', () => {
    const p = pm.createProfile('Custom', { avatar: '🐱', color: 'red' });
    expect(p.avatar).toBe('🐱');
    expect(p.color).toBe('red');
  });
  it('createProfile emits event', () => { const h = vi.fn(); pm.onEvent(h); pm.createProfile('Test'); expect(h.mock.calls[0][0].kind).toBe('profileCreated'); });
  it('removeProfile removes non-default', () => {
    const p = pm.createProfile('Temp');
    expect(pm.removeProfile(p.id)).toBe(true);
    expect(pm.getProfiles()).toHaveLength(1);
  });
  it('removeProfile cannot remove default', () => { expect(pm.removeProfile('default')).toBe(false); });
  it('removeProfile cannot remove guest', () => {
    const p = pm.createProfile('Guest');
    (p as any).isGuest = true;
    expect(pm.removeProfile(p.id)).toBe(false);
  });
  it('switchProfile changes active', () => {
    const p = pm.createProfile('Work');
    expect(pm.switchProfile(p.id)).toBe(true);
    expect(pm.getActiveProfileId()).toBe(p.id);
  });
  it('switchProfile returns false for unknown', () => { expect(pm.switchProfile('nope')).toBe(false); });
  it('switchProfile returns false for incognito', () => {
    const p = pm.createProfile('Inc');
    (p as any).isIncognito = true;
    expect(pm.switchProfile(p.id)).toBe(false);
  });
  it('updateProfile changes name/avatar/color', () => {
    const p = pm.createProfile('Old');
    pm.updateProfile(p.id, { name: 'New', avatar: '🐶', color: 'green' });
    expect(pm.getProfile(p.id)?.name).toBe('New');
    expect(pm.getProfile(p.id)?.avatar).toBe('🐶');
    expect(pm.getProfile(p.id)?.color).toBe('green');
  });
  it('updateProfile returns false for unknown', () => { expect(pm.updateProfile('nope', { name: 'x' })).toBe(false); });
  it('getProfileData returns data', () => { expect(pm.getProfileData('default')).toBeDefined(); });
  it('setProfileData updates data', () => {
    pm.setProfileData('default', { bookmarks: [{ url: 'test' }] });
    expect(pm.getProfileData('default')?.bookmarks).toHaveLength(1);
  });
  it('setProfileData no-op for unknown', () => { pm.setProfileData('nope', {}); }); // should not throw
  it('randomAvatar returns a string', () => { expect(typeof randomAvatar()).toBe('string'); });
  it('getActiveProfile returns most recently active', () => {
    pm.createProfile('A');
    pm.createProfile('B');
    // Default should still be active
    expect(pm.getActiveProfile().id).toBe('default');
  });
  it('profiles sorted by lastActiveAt desc (except default first)', () => {
    const profiles = pm.getProfiles();
    expect(profiles[0].isDefault).toBe(true);
  });
  it('onEvent unsubscribe works', () => { const h = vi.fn(); const u = pm.onEvent(h); u(); pm.createProfile('X'); expect(h).not.toHaveBeenCalled(); });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. SYNC
// ═══════════════════════════════════════════════════════════════════════════════

describe('SyncEngine', () => {
  let se: SyncEngine;
  beforeEach(() => { se = createSyncEngine(); });
  afterEach(() => { se.dispose(); });

  it('starts disabled', () => { expect(se.getStatus()).toBe('disabled'); });
  it('deriveEncryptionKey returns hex string', () => { expect(deriveEncryptionKey('test')).toMatch(/^[a-f0-9]{64}$/); });
  it('computeChecksum returns short hex', () => { expect(computeChecksum({ a: 1 })).toMatch(/^[a-f0-9]{16}$/); });
  it('getDeviceId returns device string', () => { expect(se.getDeviceId()).toMatch(/^device-/); });
  it('getDevices returns empty initially', () => { expect(se.getDevices()).toHaveLength(0); });
  it('getConflicts returns empty initially', () => { expect(se.getConflicts()).toHaveLength(0); });
  it('getConfig returns copy', () => { const c = se.getConfig(); c.enabled = true; expect(se.getConfig().enabled).toBe(false); });
  it('enable sets status to syncing', async () => { await se.enable('pass'); expect(se.getStatus()).not.toBe('disabled'); });
  it('disable resets state', async () => { await se.enable('pass'); se.disable(); expect(se.getStatus()).toBe('disabled'); expect(se.getConfig().passphrase).toBe(''); });
  it('forceSync when disabled is no-op', async () => { await se.forceSync(); expect(se.getStatus()).toBe('disabled'); });
  it('getStats returns data', () => { const s = se.getStats(); expect(s.totalSynced).toBe(0); expect(s.deviceCount).toBe(0); });
  it('onEvent unsubscribe works', () => { const h = vi.fn(); const u = se.onEvent(h); u(); (se as any).emit = vi.fn(); expect(h).not.toHaveBeenCalled(); });
  it('resolveConflict removes conflict', () => {
    (se as any).conflicts = [{ recordId: 'r1', type: 'bookmarks', local: {}, remote: {} }];
    se.resolveConflict('r1', true);
    expect(se.getConflicts()).toHaveLength(0);
  });
  it('resolveConflict no-op for unknown', () => { se.resolveConflict('nope', true); }); // no throw
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. INCOGNITO
// ═══════════════════════════════════════════════════════════════════════════════

describe('IncognitoManager', () => {
  let im: IncognitoManager;
  beforeEach(() => { im = createIncognitoManager(); });
  afterEach(() => { im.dispose(); });

  it('starts inactive', () => { expect(im.isActive()).toBe(false); });
  it('activate creates session', () => {
    const s = im.activate();
    expect(im.isActive()).toBe(true);
    expect(s.sessionId).toMatch(/^incognito-/);
    expect(s.tabsOpened).toBe(1);
  });
  it('activate twice returns same session', () => {
    const s1 = im.activate();
    const s2 = im.activate();
    expect(s1.sessionId).toBe(s2.sessionId);
  });
  it('deactivate clears session', () => { im.activate(); im.deactivate(); expect(im.isActive()).toBe(false); });
  it('deactivate emits event', () => { const h = vi.fn(); im.onEvent(h); im.activate(); im.deactivate(); expect(h.mock.calls.some((c: any) => c[0].kind === 'modeDeactivated')).toBe(true); });
  it('recordVisit increments pages', () => { im.activate(); im.recordVisit('https://x.com'); expect(im.getSession()?.pagesVisited).toBe(1); });
  it('recordVisit no-op when inactive', () => { im.recordVisit('https://x.com'); expect(im.getStats().pagesVisited).toBe(0); });
  it('recordCookieBlocked increments', () => { im.activate(); im.recordCookieBlocked(); expect(im.getSession()?.cookiesBlocked).toBe(1); });
  it('recordTrackerBlocked increments', () => { im.activate(); im.recordTrackerBlocked(); expect(im.getSession()?.trackersBlocked).toBe(1); });
  it('getStats returns data', () => { im.activate(); const s = im.getStats(); expect(s.isActive).toBe(true); expect(s.sessionDuration).toBeGreaterThanOrEqual(0); });
  it('getConfig returns copy', () => { const c = im.getConfig(); c.enabled = false; expect(im.getConfig().enabled).toBe(true); });
  it('setConfig updates', () => { im.setConfig({ blockTrackers: false }); expect(im.getConfig().blockTrackers).toBe(false); });
  it('getSession returns undefined when inactive', () => { expect(im.getSession()).toBeUndefined(); });
  it('clearEphemeralData resets counters', () => { im.activate(); im.recordVisit('x'); im.recordCookieBlocked(); im.clearEphemeralData(); expect(im.getSession()?.pagesVisited).toBe(0); });
  it('dispose deactivates', () => { im.activate(); im.dispose(); expect(im.isActive()).toBe(false); });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. GUEST
// ═══════════════════════════════════════════════════════════════════════════════

describe('GuestManager', () => {
  let gm: GuestManager;
  beforeEach(() => { gm = createGuestManager(); });
  afterEach(() => { gm.dispose(); });

  it('starts inactive', () => { expect(gm.isActive()).toBe(false); });
  it('activate creates session', () => {
    const s = gm.activate();
    expect(gm.isActive()).toBe(true);
    expect(s.sessionId).toMatch(/^guest-/);
  });
  it('deactivate returns summary', () => {
    gm.activate();
    gm.recordTabOpened();
    gm.recordVisit('https://x.com');
    const summary = gm.deactivate();
    expect(summary.tabsOpened).toBe(2);
    expect(summary.pagesVisited).toBe(1);
    expect(gm.isActive()).toBe(false);
  });
  it('recordTabOpened increments', () => { gm.activate(); gm.recordTabOpened(); expect(gm.getSession()?.tabsOpened).toBe(2); });
  it('recordTabOpened respects maxTabs', () => {
    const g = createGuestManager({ maxTabs: 2 });
    g.activate();
    g.recordTabOpened(); // 2
    g.recordTabOpened(); // would be 3, but max is 2
    expect(g.getSession()?.tabsOpened).toBe(2);
    g.dispose();
  });
  it('recordVisit increments pages', () => { gm.activate(); gm.recordVisit('x'); expect(gm.getSession()?.pagesVisited).toBe(1); });
  it('recordDownload respects allowDownloads', () => {
    const g = createGuestManager({ allowDownloads: false });
    g.activate();
    expect(g.recordDownload()).toBe(false);
    g.dispose();
  });
  it('recordDownload returns true when allowed', () => { gm.activate(); expect(gm.recordDownload()).toBe(true); });
  it('getConfig returns copy', () => { const c = gm.getConfig(); c.enabled = false; expect(gm.getConfig().enabled).toBe(true); });
  it('setConfig updates', () => { gm.setConfig({ allowDownloads: false }); expect(gm.getConfig().allowDownloads).toBe(false); });
  it('getStats returns undefined when inactive', () => { expect(gm.getStats()).toBeUndefined(); });
  it('getStats returns summary when active', () => { gm.activate(); const s = gm.getStats(); expect(s).toBeDefined(); expect(s!.sessionId).toMatch(/^guest-/); });
  it('dispose deactivates', () => { gm.activate(); gm.dispose(); expect(gm.isActive()).toBe(false); });
  it('events fire correctly', () => {
    const events: string[] = [];
    gm.onEvent(e => events.push(e.kind));
    gm.activate();
    gm.recordTabOpened();
    gm.recordVisit('x');
    gm.deactivate();
    expect(events).toContain('modeActivated');
    expect(events).toContain('sessionEnded');
    expect(events).toContain('modeDeactivated');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. SESSION RESTORE
// ═══════════════════════════════════════════════════════════════════════════════

describe('SessionRestore', () => {
  let sr: SessionRestore;
  beforeEach(() => { sr = createSessionRestore(); });
  afterEach(() => { sr.dispose(); });

  it('starts with no saved session', () => { expect(sr.hasSavedSession()).toBe(false); });
  it('saveSession returns session', () => {
    const s = sr.saveSession([makeWindow()]);
    expect(s.sessionId).toBeDefined();
    expect(s.tabCount).toBe(1);
    expect(s.windowCount).toBe(1);
  });
  it('hasSavedSession returns true after save', () => { sr.saveSession([makeWindow()]); expect(sr.hasSavedSession()).toBe(true); });
  it('restoreSession returns saved session', () => {
    sr.saveSession([makeWindow()]);
    const restored = sr.restoreSession();
    expect(restored).toBeDefined();
    expect(restored!.tabCount).toBe(1);
  });
  it('restoreSession returns undefined when none saved', () => { expect(sr.restoreSession()).toBeUndefined(); });
  it('discardSession clears saved', () => { sr.saveSession([makeWindow()]); expect(sr.discardSession()).toBe(true); expect(sr.hasSavedSession()).toBe(false); });
  it('discardSession returns false when none', () => { expect(sr.discardSession()).toBe(false); });
  it('truncates tabs to maxTabsToRestore', () => {
    const sr2 = createSessionRestore({ maxTabsToRestore: 2 });
    const tabs = Array.from({ length: 5 }, (_, i) => makeTab({ id: `t${i}` }));
    sr2.saveSession([makeWindow({ tabs })]);
    expect(sr2.getSavedSession()!.tabCount).toBe(2);
    sr2.dispose();
  });
  it('getConfig returns copy', () => { const c = sr.getConfig(); c.restorePolicy = 'never'; expect(sr.getConfig().restorePolicy).toBe('always'); });
  it('setConfig updates', () => { sr.setConfig({ restorePolicy: 'never' }); expect(sr.getConfig().restorePolicy).toBe('never'); });
  it('shouldRestoreOnStartup returns false for never', () => {
    sr.setConfig({ restorePolicy: 'never' });
    sr.saveSession([makeWindow()]);
    expect(sr.shouldRestoreOnStartup()).toBe(false);
  });
  it('shouldRestoreOnStartup returns true for always with saved', () => { sr.saveSession([makeWindow()]); expect(sr.shouldRestoreOnStartup()).toBe(true); });
  it('shouldRestoreOnStartup returns false for always without saved', () => { expect(sr.shouldRestoreOnStartup()).toBe(false); });
  it('events fire on save/restore/discard', () => {
    const events: string[] = [];
    sr.onEvent(e => events.push(e.kind));
    sr.saveSession([makeWindow()]);
    sr.restoreSession();
    sr.discardSession();
    expect(events).toContain('sessionSaved');
    expect(events).toContain('sessionRestored');
    expect(events).toContain('sessionDiscarded');
  });
  it('onEvent unsubscribe works', () => { const h = vi.fn(); const u = sr.onEvent(h); u(); sr.saveSession([makeWindow()]); expect(h).not.toHaveBeenCalled(); });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. STARTUP PAGES
// ═══════════════════════════════════════════════════════════════════════════════

describe('StartupPages', () => {
  let sp: StartupPages;
  beforeEach(() => { sp = createStartupPages(); });
  afterEach(() => { sp.dispose(); });

  it('starts with new-tab action', () => { expect(sp.getAction()).toBe('new-tab'); });
  it('setAction changes action', () => { sp.setAction('specific-pages'); expect(sp.getAction()).toBe('specific-pages'); });
  it('addPage adds a page', () => {
    sp.addPage('https://google.com', 'Google');
    expect(sp.getPages()).toHaveLength(1);
    expect(sp.getPages()[0].url).toBe('https://google.com');
  });
  it('addPage auto-extracts title from URL', () => {
    sp.addPage('https://github.com');
    expect(sp.getPages()[0].title).toBe('github.com');
  });
  it('addPage with invalid URL uses url as title', () => {
    sp.addPage('about:blank');
    expect(sp.getPages()[0].title).toBe('about:blank');
  });
  it('removePage removes', () => {
    const p = sp.addPage('https://a.com');
    expect(sp.removePage(p.id)).toBe(true);
    expect(sp.getPages()).toHaveLength(0);
  });
  it('removePage returns false for unknown', () => { expect(sp.removePage('nope')).toBe(false); });
  it('updatePage changes url/title/pinned', () => {
    const p = sp.addPage('https://a.com', 'A');
    sp.updatePage(p.id, { url: 'https://b.com', title: 'B', pinned: true });
    const updated = sp.getPages()[0];
    expect(updated.url).toBe('https://b.com');
    expect(updated.title).toBe('B');
    expect(updated.pinned).toBe(true);
  });
  it('updatePage returns false for unknown', () => { expect(sp.updatePage('nope', { url: 'x' })).toBe(false); });
  it('reorderPage changes position', () => {
    const p1 = sp.addPage('https://a.com');
    const p2 = sp.addPage('https://b.com');
    sp.reorderPage(p2.id, 0);
    expect(sp.getPages()[0].id).toBe(p2.id);
  });
  it('reorderPage returns false for unknown', () => { expect(sp.reorderPage('nope', 0)).toBe(false); });
  it('getStartupPages returns new-tab for new-tab action', () => {
    const pages = sp.getStartupPages();
    expect(pages).toHaveLength(1);
    expect(pages[0].url).toBe('about:newtab');
  });
  it('getStartupPages returns pages for specific-pages', () => {
    sp.setAction('specific-pages');
    sp.addPage('https://google.com');
    expect(sp.getStartupPages()).toHaveLength(1);
  });
  it('getStartupPages returns empty for last-session', () => {
    sp.setAction('last-session');
    expect(sp.getStartupPages()).toHaveLength(0);
  });
  it('getStartupPages returns empty for continue-where-left', () => {
    sp.setAction('continue-where-left');
    expect(sp.getStartupPages()).toHaveLength(0);
  });
  it('getConfig returns copy', () => { const c = sp.getConfig(); c.action = 'continue-where-left'; expect(sp.getAction()).toBe('new-tab'); });
  it('setConfig updates', () => { sp.setConfig({ action: 'specific-pages', newWindow: false }); expect(sp.getAction()).toBe('specific-pages'); });
  it('events fire on add/remove/reorder', () => {
    const events: string[] = [];
    sp.onEvent(e => events.push(e.kind));
    const p = sp.addPage('https://a.com');
    sp.reorderPage(p.id, 0);
    sp.removePage(p.id);
    expect(events).toContain('pageAdded');
    expect(events).toContain('pageReordered');
    expect(events).toContain('pageRemoved');
  });
  it('onEvent unsubscribe works', () => { const h = vi.fn(); const u = sp.onEvent(h); u(); sp.addPage('https://x.com'); expect(h).not.toHaveBeenCalled(); });
});
