import { describe, it, expect, beforeEach, vi } from 'vitest';

import { MultiTabs } from '../src/browser/navigation-controls/multi-tabs';
import { TabGroupManager } from '../src/browser/navigation-controls/tab-groups';
import { TabSearch } from '../src/browser/navigation-controls/tab-search';
import { Back } from '../src/browser/navigation-controls/back';
import { Forward } from '../src/browser/navigation-controls/forward';
import { Reload } from '../src/browser/navigation-controls/reload';
import { HardReload } from '../src/browser/navigation-controls/hard-reload';
import { DownloadsService } from '../src/browser/navigation-controls/downloads';
import { BookmarksService } from '../src/browser/navigation-controls/bookmarks';
import { HistoryServiceWrapper } from '../src/browser/navigation-controls/history';
import { ReaderMode } from '../src/browser/navigation-controls/reader-mode';
import { PrintManager } from '../src/browser/navigation-controls/print';
import { ZoomManager, DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM, ZOOM_STEP } from '../src/browser/navigation-controls/zoom';
import { FindInPage } from '../src/browser/navigation-controls/find-in-page';

/* ============================================================
   1. MultiTabs
   ============================================================ */
describe('MultiTabs', () => {
  let tabs: MultiTabs;
  let mockMgr: any;

  beforeEach(() => {
    const created: any[] = [];
    mockMgr = {
      tabs: created,
      activeTabId: null,
      get activeTab() { return created.find((t: any) => t.id === this.activeTabId) ?? null; },
      count: 0,
      createTab: vi.fn((url?: string) => {
        const tab = { id: `tab-${created.length + 1}`, url: url || 'about:blank', title: 'New Tab', favicon: '', loading: false, audible: false, muted: false, pinned: false, groupId: null };
        created.push(tab);
        mockMgr.activeTabId = tab.id;
        mockMgr.count = created.length;
        return tab;
      }),
      removeTab: vi.fn((id: string) => {
        const idx = created.findIndex((t: any) => t.id === id);
        if (idx === -1) return false;
        created.splice(idx, 1);
        mockMgr.count = created.length;
        return true;
      }),
      activateTab: vi.fn((id: string) => { mockMgr.activeTabId = id; return true; }),
      getTab: vi.fn((id: string) => created.find((t: any) => t.id === id) ?? null),
      getTabIndex: vi.fn((id: string) => created.findIndex((t: any) => t.id === id)),
      moveTab: vi.fn(),
      setTabPinned: vi.fn(),
      setTabGroup: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    tabs = new MultiTabs(mockMgr);
  });

  it('creates tab via manager', () => {
    const tab = tabs.createTab();
    expect(tab).toBeDefined();
    expect(tab.id).toBe('tab-1');
    expect(tab.url).toBe('about:blank');
  });

  it('creates tab with custom url', () => {
    const tab = tabs.createTab('https://example.com');
    expect(tab.url).toBe('https://example.com');
  });

  it('getAllTabs delegates to manager', () => {
    tabs.createTab();
    expect(tabs.getAllTabs()).toHaveLength(1);
  });

  it('removeTab returns true for existing', () => {
    const tab = tabs.createTab();
    expect(tabs.removeTab(tab.id)).toBe(true);
  });

  it('removeTab returns false for missing', () => {
    expect(tabs.removeTab('nonexistent')).toBe(false);
  });

  it('activateTab switches active tab', () => {
    const t1 = tabs.createTab();
    const t2 = tabs.createTab();
    tabs.activateTab(t1.id);
    expect(mockMgr.activeTabId).toBe(t1.id);
  });

  it('count returns tab count', () => {
    expect(tabs.count).toBe(0);
    tabs.createTab();
    expect(tabs.count).toBe(1);
  });

  it('dispose detaches events', () => {
    const handler = vi.fn();
    tabs.onEvent(handler);
    tabs.dispose();
    expect(() => tabs.createTab()).not.toThrow();
  });

  it('onEvent subscribe receives manager events', () => {
    const handler = vi.fn();
    tabs.onEvent(handler);
    const tab = tabs.createTab();
    mockMgr.on.mock.calls.forEach(([type, fn]: [string, Function]) => {
      if (type === 'tabCreated') fn({ tab });
    });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'created' }));
    const unsub = tabs.onEvent(handler);
    unsub();
    handler.mockClear();
    mockMgr.on.mock.calls.forEach(([type, fn]: [string, Function]) => {
      if (type === 'tabCreated') fn({ tab });
    });
    expect(handler).not.toHaveBeenCalled();
  });
});

/* ============================================================
   2. TabGroupManager
   ============================================================ */
describe('TabGroupManager', () => {
  let groups: TabGroupManager;

  beforeEach(() => {
    groups = new TabGroupManager();
  });

  it('creates a group', () => {
    const g = groups.createGroup('test');
    expect(g).toBeDefined();
    expect(g.name).toBe('test');
    expect(g.tabIds).toEqual([]);
  });

  it('getAllGroups returns all groups', () => {
    groups.createGroup('g1');
    groups.createGroup('g2');
    expect(groups.getAllGroups()).toHaveLength(2);
  });

  it('size returns correct count', () => {
    expect(groups.size).toBe(0);
    groups.createGroup('g1');
    expect(groups.size).toBe(1);
  });

  it('addTabToGroup adds tabId', () => {
    const g = groups.createGroup('g1');
    groups.addTabToGroup(g.id, 'tab-1');
    expect(groups.getGroup(g.id)!.tabIds).toContain('tab-1');
  });

  it('removeTabFromGroup removes tabId', () => {
    const g = groups.createGroup('g1');
    groups.addTabToGroup(g.id, 'tab-1');
    groups.removeTabFromGroup('tab-1');
    expect(groups.getGroup(g.id)!.tabIds).not.toContain('tab-1');
  });

  it('removeGroup removes the group', () => {
    const g = groups.createGroup('g1');
    expect(groups.removeGroup(g.id)).toBe(true);
    expect(groups.size).toBe(0);
  });

  it('removeGroup returns false for missing', () => {
    expect(groups.removeGroup('nonexistent')).toBe(false);
  });

  it('getGroup returns null for missing', () => {
    expect(groups.getGroup('nonexistent')).toBeNull();
  });

  it('renameGroup updates name', () => {
    const g = groups.createGroup('old');
    groups.renameGroup(g.id, 'new');
    expect(groups.getGroup(g.id)!.name).toBe('new');
  });

  it('setGroupColor updates color', () => {
    const g = groups.createGroup('g1');
    groups.setGroupColor(g.id, 'red');
    expect(groups.getGroup(g.id)!.color).toBe('red');
  });

  it('setGroupCollapsed toggles collapse', () => {
    const g = groups.createGroup('g1');
    groups.setGroupCollapsed(g.id, true);
    expect(groups.getGroup(g.id)!.collapsed).toBe(true);
  });

  it('getGroupForTab returns group', () => {
    const g = groups.createGroup('g1');
    groups.addTabToGroup(g.id, 'tab-1');
    expect(groups.getGroupForTab('tab-1')!.id).toBe(g.id);
  });

  it('emits created event', () => {
    const handler = vi.fn();
    groups.onEvent(handler);
    groups.createGroup('g1');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'created' }));
  });

  it('emits removed event', () => {
    const handler = vi.fn();
    groups.onEvent(handler);
    const g = groups.createGroup('g1');
    groups.removeGroup(g.id);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'removed' }));
  });

  it('dispose clears all groups', () => {
    groups.createGroup('g1');
    groups.createGroup('g2');
    groups.dispose();
    expect(groups.size).toBe(0);
  });
});

/* ============================================================
   3. TabSearch
   ============================================================ */
describe('TabSearch', () => {
  let search: TabSearch;

  beforeEach(() => {
    search = new TabSearch();
  });

  it('search returns empty for empty input', () => {
    expect(search.search('')).toHaveLength(0);
  });

  it('search finds by title via tabs source', () => {
    search.setTabsSource(() => [
      { id: '1', title: 'Hello World', url: 'https://example.com' },
    ]);
    const r = search.search('hello');
    expect(r).toHaveLength(1);
    expect(r[0].tabId).toBe('1');
  });

  it('search finds by url', () => {
    search.setTabsSource(() => [
      { id: '1', title: 'Test', url: 'https://example.com/page' },
    ]);
    expect(search.search('example')).toHaveLength(1);
  });

  it('search is case-insensitive', () => {
    search.setTabsSource(() => [
      { id: '1', title: 'Hello World', url: 'https://example.com' },
    ]);
    expect(search.search('HELLO')).toHaveLength(1);
    expect(search.search('hello')).toHaveLength(1);
  });

  it('updates results when source changes', () => {
    search.setTabsSource(() => [
      { id: '1', title: 'Hello', url: 'https://example.com' },
    ]);
    expect(search.search('hello')).toHaveLength(1);
    search.setTabsSource(() => []);
    expect(search.search('hello')).toHaveLength(0);
  });

  it('sorts by score descending', () => {
    search.setTabsSource(() => [
      { id: '1', title: 'foo', url: 'https://example.com' },
      { id: '2', title: 'Foo Bar', url: 'https://example.com/foo' },
    ]);
    const r = search.search('foo');
    expect(r).toHaveLength(2);
    expect(r[0].score).toBeGreaterThanOrEqual(r[1].score);
  });

  it('dispose clears source', () => {
    search.setTabsSource(() => [
      { id: '1', title: 'Hello', url: 'https://example.com' },
    ]);
    search.dispose();
    expect(search.search('hello')).toHaveLength(0);
  });
});

/* ============================================================
   4. Back
   ============================================================ */
describe('Back', () => {
  let back: Back;
  let mockCtrl: any;

  beforeEach(() => {
    mockCtrl = {
      back: vi.fn(() => ({ success: true })),
      canGoBack: vi.fn(() => true),
    };
    back = new Back(mockCtrl);
  });

  it('canGoBack delegates to controller', () => {
    expect(back.canGoBack()).toBe(true);
    mockCtrl.canGoBack.mockReturnValue(false);
    expect(back.canGoBack()).toBe(false);
  });

  it('execute returns true when back succeeds', () => {
    expect(back.execute()).toBe(true);
    expect(mockCtrl.back).toHaveBeenCalled();
  });

  it('execute returns false when cannot go back', () => {
    mockCtrl.canGoBack.mockReturnValue(false);
    expect(back.execute()).toBe(false);
    expect(mockCtrl.back).not.toHaveBeenCalled();
  });

  it('onEvent subscribe/unsubscribe', () => {
    const handler = vi.fn();
    const unsub = back.onEvent(handler);
    back.execute();
    expect(handler).toHaveBeenCalled();
    unsub();
    handler.mockClear();
    back.execute();
    expect(handler).not.toHaveBeenCalled();
  });

  it('dispose clears event handlers', () => {
    const handler = vi.fn();
    back.onEvent(handler);
    back.dispose();
    mockCtrl.canGoBack.mockReturnValue(true);
    mockCtrl.back.mockReturnValue({ success: true });
    back.execute();
    expect(handler).not.toHaveBeenCalled();
  });
});

/* ============================================================
   5. Forward
   ============================================================ */
describe('Forward', () => {
  let fwd: Forward;
  let mockCtrl: any;

  beforeEach(() => {
    mockCtrl = {
      forward: vi.fn(() => ({ success: true })),
      canGoForward: vi.fn(() => true),
    };
    fwd = new Forward(mockCtrl);
  });

  it('canGoForward delegates to controller', () => {
    expect(fwd.canGoForward()).toBe(true);
    mockCtrl.canGoForward.mockReturnValue(false);
    expect(fwd.canGoForward()).toBe(false);
  });

  it('execute returns true when forward succeeds', () => {
    expect(fwd.execute()).toBe(true);
    expect(mockCtrl.forward).toHaveBeenCalled();
  });

  it('execute returns false when cannot go forward', () => {
    mockCtrl.canGoForward.mockReturnValue(false);
    expect(fwd.execute()).toBe(false);
    expect(mockCtrl.forward).not.toHaveBeenCalled();
  });

  it('dispose clears event handlers', () => {
    const handler = vi.fn();
    fwd.onEvent(handler);
    fwd.dispose();
    fwd.execute();
    expect(handler).not.toHaveBeenCalled();
  });
});

/* ============================================================
   6. Reload
   ============================================================ */
describe('Reload', () => {
  let reload: Reload;
  let mockCtrl: any;

  beforeEach(() => {
    mockCtrl = {
      reload: vi.fn(() => ({ success: true })),
      getCurrentEntry: vi.fn(() => ({ url: 'https://example.com' })),
    };
    reload = new Reload(mockCtrl);
  });

  it('execute calls controller.reload', () => {
    expect(reload.execute()).toBe(true);
    expect(mockCtrl.reload).toHaveBeenCalled();
  });

  it('canReload returns true with current entry', () => {
    expect(reload.canReload()).toBe(true);
  });

  it('canReload returns false without current entry', () => {
    mockCtrl.getCurrentEntry.mockReturnValue(null);
    expect(reload.canReload()).toBe(false);
  });

  it('execute returns false when cannot reload', () => {
    mockCtrl.getCurrentEntry.mockReturnValue(null);
    expect(reload.execute()).toBe(false);
    expect(mockCtrl.reload).not.toHaveBeenCalled();
  });

  it('dispose clears event handlers', () => {
    const handler = vi.fn();
    reload.onEvent(handler);
    reload.dispose();
    reload.execute();
    expect(handler).not.toHaveBeenCalled();
  });
});

/* ============================================================
   7. HardReload
   ============================================================ */
describe('HardReload', () => {
  let hardReload: HardReload;
  let mockCtrl: any;

  beforeEach(() => {
    mockCtrl = {
      navigateTo: vi.fn(() => ({ success: true })),
      getCurrentEntry: vi.fn(() => ({ url: 'https://example.com' })),
    };
    hardReload = new HardReload(mockCtrl);
  });

  it('execute calls controller.navigateTo with cache bust', () => {
    expect(hardReload.execute()).toBe(true);
    expect(mockCtrl.navigateTo).toHaveBeenCalled();
  });

  it('canReload returns false without current entry', () => {
    mockCtrl.getCurrentEntry.mockReturnValue(null);
    expect(hardReload.canReload()).toBe(false);
  });

  it('execute returns false when cannot reload', () => {
    mockCtrl.getCurrentEntry.mockReturnValue(null);
    expect(hardReload.execute()).toBe(false);
    expect(mockCtrl.navigateTo).not.toHaveBeenCalled();
  });
});

/* ============================================================
   8. DownloadsService
   ============================================================ */
describe('DownloadsService', () => {
  let downloads: DownloadsService;
  let mockMgr: any;

  beforeEach(() => {
    mockMgr = {
      getItems: vi.fn(() => []),
      getItem: vi.fn(() => null),
      pause: vi.fn(() => true),
      resume: vi.fn(() => true),
      cancel: vi.fn(() => true),
      remove: vi.fn(() => true),
      clearCompleted: vi.fn(),
      pauseAll: vi.fn(),
      resumeAll: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    };
    downloads = new DownloadsService(mockMgr);
  });

  it('getAll returns downloads from manager', () => {
    const item = { id: '1', url: 'https://example.com/file.pdf', filename: 'file.pdf', mimeType: 'application/pdf', totalBytes: 1000, receivedBytes: 1000, state: 'completed', error: null, createdAt: Date.now(), completedAt: Date.now(), speedBytesPerSec: 0, etaSeconds: 0, fileTypeCategory: 'document' };
    mockMgr.getItems.mockReturnValue([item]);
    expect(downloads.getAll()).toHaveLength(1);
    expect(downloads.getAll()[0].id).toBe('1');
  });

  it('pause delegates to manager', () => {
    downloads.pause('1');
    expect(mockMgr.pause).toHaveBeenCalledWith('1');
  });

  it('dispose cleans up', () => {
    downloads.dispose();
    expect(downloads.getAll()).toHaveLength(0);
  });
});

/* ============================================================
   9. BookmarksService
   ============================================================ */
describe('BookmarksService', () => {
  let bookmarks: BookmarksService;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      getTree: vi.fn(() => Promise.resolve([])),
      get: vi.fn(() => Promise.resolve(null)),
      getBookmarkByUrl: vi.fn(() => Promise.resolve(null)),
      search: vi.fn(() => Promise.resolve([])),
      addBookmark: vi.fn(() => Promise.resolve({ id: 'new', title: '', url: null, iconUrl: null, parentId: null, folder: false, children: [], addedTime: Date.now(), lastModifiedTime: Date.now(), synced: false })),
      addFolder: vi.fn(() => Promise.resolve({ id: 'new', title: '', url: null, iconUrl: null, parentId: null, folder: true, children: [], addedTime: Date.now(), lastModifiedTime: Date.now(), synced: false })),
      updateBookmark: vi.fn(() => Promise.resolve(null)),
      removeBookmark: vi.fn(() => Promise.resolve(true)),
      on: vi.fn(),
      off: vi.fn(),
    };
    bookmarks = new BookmarksService(mockService);
  });

  it('getTree returns bookmarks from service', async () => {
    await vi.waitFor(() => {
      expect(mockService.getTree).toHaveBeenCalled();
    });
    expect(bookmarks.getTree()).toHaveLength(0);
  });

  it('add creates bookmark via service', () => {
    mockService.getTree.mockResolvedValue([]);
    const bm = bookmarks.add('https://test.com', 'Test');
    expect(bm.title).toBe('Test');
    expect(mockService.addBookmark).toHaveBeenCalledWith(expect.objectContaining({ title: 'Test', url: 'https://test.com' }));
  });

  it('remove calls service.removeBookmark', () => {
    bookmarks.remove('1');
    expect(mockService.removeBookmark).toHaveBeenCalledWith('1');
  });

  it('dispose cleans up', () => {
    expect(() => bookmarks.dispose()).not.toThrow();
  });
});

/* ============================================================
   10. HistoryServiceWrapper
   ============================================================ */
describe('HistoryServiceWrapper', () => {
  let history: HistoryServiceWrapper;
  let mockService: any;

  beforeEach(() => {
    mockService = {
      query: vi.fn(() => Promise.resolve({ entries: [], totalCount: 0 })),
      getRecent: vi.fn(() => Promise.resolve([])),
      getFrecents: vi.fn(() => Promise.resolve([])),
      getEntryByUrl: vi.fn(() => Promise.resolve(null)),
      deleteEntry: vi.fn(() => Promise.resolve(true)),
      deleteAll: vi.fn(() => Promise.resolve(undefined)),
      on: vi.fn(),
      off: vi.fn(),
    };
    history = new HistoryServiceWrapper(mockService);
  });

  it('loads entries on construction', async () => {
    await vi.waitFor(() => {
      expect(mockService.query).toHaveBeenCalled();
    });
  });

  it('dispose cleans up', () => {
    expect(() => history.dispose()).not.toThrow();
  });
});

/* ============================================================
   11. ReaderMode
   ============================================================ */
describe('ReaderMode', () => {
  let reader: ReaderMode;

  beforeEach(() => {
    reader = new ReaderMode();
  });

  it('enter returns content for valid html', () => {
    const html = '<html><head><title>Test Article</title></head><body><article><p>Hello world</p></article></body></html>';
    const content = reader.enter(html);
    expect(content).not.toBeNull();
    expect(content!.title).toBe('Test Article');
  });

  it('enter returns null for empty html', () => {
    expect(reader.enter('')).toBeNull();
  });

  it('isActive returns true after enter', () => {
    reader.enter('<html><body><p>test</p></body></html>');
    expect(reader.isActive()).toBe(true);
  });

  it('isActive returns false after exit', () => {
    reader.enter('<html><body><p>test</p></body></html>');
    reader.exit();
    expect(reader.isActive()).toBe(false);
  });

  it('exit emits event', () => {
    const handler = vi.fn();
    reader.onEvent(handler);
    reader.enter('<html><body><p>test</p></body></html>');
    reader.exit();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'exited' }));
  });

  it('getContent returns null after exit', () => {
    reader.enter('<html><body><p>test</p></body></html>');
    reader.exit();
    expect(reader.getContent()).toBeNull();
  });

  it('dispose cleans up', () => {
    reader.enter('<html><body><p>test</p></body></html>');
    reader.dispose();
    expect(reader.isActive()).toBe(false);
  });
});

/* ============================================================
   12. PrintManager
   ============================================================ */
describe('PrintManager', () => {
  let printer: PrintManager;

  beforeEach(() => {
    printer = new PrintManager();
  });

  it('creates a print job', () => {
    const job = printer.print('https://example.com', 'Test');
    expect(job.id).toBeDefined();
    expect(job.url).toBe('https://example.com');
    expect(job.title).toBe('Test');
  });

  it('getAllJobs returns created jobs', () => {
    printer.print('https://example.com');
    printer.print('https://other.com');
    expect(printer.getAllJobs()).toHaveLength(2);
  });

  it('cancel changes job status', () => {
    const job = printer.print('https://example.com');
    expect(printer.cancel(job.id)).toBe(true);
    expect(printer.getJob(job.id)!.status).toBe('cancelled');
  });

  it('getActiveJobs returns pending jobs', () => {
    printer.print('https://example.com');
    expect(printer.getActiveJobs()).toHaveLength(1);
  });

  it('dispose cancels pending jobs', () => {
    printer.print('https://example.com');
    printer.dispose();
    expect(printer.getActiveJobs()).toHaveLength(0);
  });

  it('defaultOptions can be changed', () => {
    printer.setDefaultOptions({ landscape: true });
    expect(printer.defaultOptions.landscape).toBe(true);
  });
});

/* ============================================================
   13. ZoomManager
   ============================================================ */
describe('ZoomManager', () => {
  let zoom: ZoomManager;

  beforeEach(() => {
    zoom = new ZoomManager();
  });

  it('default zoom is 100', () => {
    expect(zoom.getZoom()).toBe(DEFAULT_ZOOM);
  });

  it('setZoom updates zoom', () => {
    expect(zoom.setZoom(150)).toBe(true);
    expect(zoom.getZoom()).toBe(150);
  });

  it('setZoom clamps to min/max', () => {
    zoom.setZoom(10);
    expect(zoom.getZoom()).toBe(MIN_ZOOM);
    zoom.setZoom(500);
    expect(zoom.getZoom()).toBe(MAX_ZOOM);
  });

  it('setZoom returns false for same value', () => {
    expect(zoom.setZoom(DEFAULT_ZOOM)).toBe(false);
  });

  it('zoomIn increases zoom', () => {
    zoom.zoomIn();
    expect(zoom.getZoom()).toBe(DEFAULT_ZOOM + ZOOM_STEP);
  });

  it('zoomOut decreases zoom', () => {
    zoom.zoomOut();
    expect(zoom.getZoom()).toBe(DEFAULT_ZOOM - ZOOM_STEP);
  });

  it('reset restores default', () => {
    zoom.setZoom(150);
    zoom.reset();
    expect(zoom.getZoom()).toBe(DEFAULT_ZOOM);
  });

  it('zoomIn does not exceed max', () => {
    zoom.setZoom(MAX_ZOOM);
    zoom.zoomIn();
    expect(zoom.getZoom()).toBe(MAX_ZOOM);
  });

  it('zoomOut does not go below min', () => {
    zoom.setZoom(MIN_ZOOM);
    zoom.zoomOut();
    expect(zoom.getZoom()).toBe(MIN_ZOOM);
  });

  it('emits changed event', () => {
    const handler = vi.fn();
    zoom.onEvent(handler);
    zoom.setZoom(150);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'changed' }));
  });

  it('dispose resets', () => {
    zoom.setZoom(150);
    zoom.dispose();
    expect(zoom.getZoom()).toBe(DEFAULT_ZOOM);
  });
});

/* ============================================================
   14. FindInPage
   ============================================================ */
describe('FindInPage', () => {
  let find: FindInPage;

  beforeEach(() => {
    find = new FindInPage();
  });

  it('find returns empty for empty query', () => {
    const r = find.find('');
    expect(r.total).toBe(0);
  });

  it('find returns matches', () => {
    const r = find.find('lorem', { caseSensitive: false });
    expect(r.total).toBeGreaterThan(0);
    expect(r.activeIndex).toBe(0);
  });

  it('findNext wraps around', () => {
    find.find('lorem');
    const first = find.getActiveMatch();
    find.findNext();
    expect(find.getActiveMatch()).not.toBeNull();
  });

  it('findPrevious wraps backwards', () => {
    find.find('lorem');
    find.findPrevious();
    expect(find.getCurrentIndex()).toBeGreaterThanOrEqual(0);
  });

  it('clear resets state', () => {
    find.find('lorem');
    find.clear();
    expect(find.getMatchCount()).toBe(0);
    expect(find.getActiveMatch()).toBeNull();
  });

  it('getCurrentIndex returns -1 after clear', () => {
    find.find('lorem');
    find.clear();
    expect(find.getCurrentIndex()).toBe(-1);
  });

  it('emits search event', () => {
    const handler = vi.fn();
    find.onEvent(handler);
    find.find('lorem');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'search' }));
  });

  it('emits cleared event', () => {
    const handler = vi.fn();
    find.onEvent(handler);
    find.find('lorem');
    find.clear();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cleared' }));
  });
});
