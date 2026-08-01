import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TabSession, TabSessionEventBus } from '../src/browser/tabs/tab-session';
import type { NavigationEntry } from '../src/browser/navigation/navigation-controller';

function makeEntry(url = 'https://example.com'): NavigationEntry {
  return { id: `nav-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, url, title: '', timestamp: Date.now(), type: 'other' as any, scrollX: 0, scrollY: 0, parsedUrl: null as any, state: null };
}

describe('TabSession', () => {
  describe('construction', () => {
    it('should default url to about:blank', () => {
      const tab = new TabSession();
      expect(tab.url).toBe('about:blank');
    });

    it('should accept a custom url', () => {
      const tab = new TabSession('https://example.com');
      expect(tab.url).toBe('https://example.com');
    });

    it('should generate unique ids for two sessions', () => {
      const a = new TabSession();
      const b = new TabSession();
      expect(a.id).not.toBe(b.id);
    });
  });

  describe('setters with events', () => {
    let tab: TabSession;

    beforeEach(() => {
      tab = new TabSession();
    });

    it('setTitle emits titleChanged only when value changes', () => {
      const handler = vi.fn();
      tab.on('titleChanged', handler);
      tab.setTitle('New Title');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ kind: 'titleChanged', title: 'New Title', tabId: tab.id });
      expect(tab.title).toBe('New Title');
    });

    it('setUrl emits urlChanged only when value changes', () => {
      const handler = vi.fn();
      tab.on('urlChanged', handler);
      tab.setUrl('https://example.com');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ kind: 'urlChanged', url: 'https://example.com', tabId: tab.id });
      expect(tab.url).toBe('https://example.com');
    });

    it('setFavicon emits faviconChanged', () => {
      const handler = vi.fn();
      tab.on('faviconChanged', handler);
      tab.setFavicon('https://example.com/favicon.ico');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ kind: 'faviconChanged', favicon: 'https://example.com/favicon.ico' });
      expect(tab.favicon).toBe('https://example.com/favicon.ico');
    });

    it('setLoading emits loadingStateChanged', () => {
      const handler = vi.fn();
      tab.on('loadingStateChanged', handler);
      tab.setLoading(true);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ kind: 'loadingStateChanged', loading: true });
      expect(tab.loading).toBe(true);
    });

    it('setAudible emits audibleChanged', () => {
      const handler = vi.fn();
      tab.on('audibleChanged', handler);
      tab.setAudible(true);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ kind: 'audibleChanged', audible: true });
      expect(tab.audible).toBe(true);
    });

    it('setMuted emits mutedChanged', () => {
      const handler = vi.fn();
      tab.on('mutedChanged', handler);
      tab.setMuted(true);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ kind: 'mutedChanged', muted: true });
      expect(tab.muted).toBe(true);
    });

    it('setPinned emits pinnedChanged', () => {
      const handler = vi.fn();
      tab.on('pinnedChanged', handler);
      tab.setPinned(true);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ kind: 'pinnedChanged', pinned: true });
      expect(tab.pinned).toBe(true);
    });

    it('setGroupId emits groupChanged', () => {
      const handler = vi.fn();
      tab.on('groupChanged', handler);
      tab.setGroupId('grp-1');
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0]).toMatchObject({ kind: 'groupChanged', groupId: 'grp-1' });
      expect(tab.groupId).toBe('grp-1');
    });
  });

  describe('no-change suppression', () => {
    let tab: TabSession;

    beforeEach(() => {
      tab = new TabSession();
    });

    it('setTitle with same value does NOT emit', () => {
      const handler = vi.fn();
      tab.on('titleChanged', handler);
      tab.setTitle('');
      expect(handler).not.toHaveBeenCalled();
    });

    it('setUrl with same value does NOT emit', () => {
      const handler = vi.fn();
      tab.on('urlChanged', handler);
      tab.setUrl('about:blank');
      expect(handler).not.toHaveBeenCalled();
    });

    it('setPinned with same value does NOT emit', () => {
      const handler = vi.fn();
      tab.on('pinnedChanged', handler);
      tab.setPinned(false);
      expect(handler).not.toHaveBeenCalled();
    });

    it('setGroupId with same value does NOT emit', () => {
      const handler = vi.fn();
      tab.on('groupChanged', handler);
      tab.setGroupId(null);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('history navigation', () => {
    let tab: TabSession;

    beforeEach(() => {
      tab = new TabSession();
    });

    it('pushHistory adds an entry', () => {
      tab.pushHistory(makeEntry('https://a.com'));
      expect(tab.history.length).toBe(1);
      expect(tab.history[0].url).toBe('https://a.com');
    });

    it('canGoBack returns false initially', () => {
      expect(tab.canGoBack()).toBe(false);
    });

    it('canGoForward returns false initially', () => {
      expect(tab.canGoForward()).toBe(false);
    });

    it('canGoBack returns true after a push', () => {
      tab.pushHistory(makeEntry('https://a.com'));
      tab.pushHistory(makeEntry('https://b.com'));
      expect(tab.canGoBack()).toBe(true);
    });

    it('pushHistory truncates forward entries', () => {
      tab.pushHistory(makeEntry('https://a.com'));
      tab.pushHistory(makeEntry('https://b.com'));
      tab.pushHistory(makeEntry('https://c.com'));
      expect(tab.history.length).toBe(3);
      expect(tab.canGoForward()).toBe(false);

      tab.pushHistory(makeEntry('https://d.com'));
      expect(tab.history.length).toBe(4);
      expect(tab.canGoForward()).toBe(false);
    });
  });

  describe('getState', () => {
    it('should return correct snapshot with all fields', () => {
      const tab = new TabSession('https://x.com');
      tab.setTitle('My Title');
      tab.setPinned(true);
      tab.setGroupId('g1');
      const state = tab.getState();
      expect(state).toEqual({
        id: tab.id,
        url: 'https://x.com',
        title: 'My Title',
        favicon: null,
        loading: false,
        audible: false,
        muted: false,
        pinned: true,
        groupId: 'g1',
        historyLength: 0,
        canGoBack: false,
        canGoForward: false,
      });
    });

    it('should reflect current state after mutations', () => {
      const tab = new TabSession();
      tab.setUrl('https://a.com');
      tab.setLoading(true);
      tab.setAudible(true);
      tab.setMuted(true);
      tab.pushHistory(makeEntry('https://a.com'));
      tab.pushHistory(makeEntry('https://b.com'));
      const state = tab.getState();
      expect(state.url).toBe('https://a.com');
      expect(state.loading).toBe(true);
      expect(state.audible).toBe(true);
      expect(state.muted).toBe(true);
      expect(state.historyLength).toBe(2);
      expect(state.canGoBack).toBe(true);
      expect(state.canGoForward).toBe(false);
    });
  });

  describe('multiple event listeners', () => {
    it('should call multiple handlers on the same event type', () => {
      const tab = new TabSession();
      const h1 = vi.fn();
      const h2 = vi.fn();
      tab.on('titleChanged', h1);
      tab.on('titleChanged', h2);
      tab.setTitle('Hello');
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('off() removes handler so it no longer fires', () => {
      const tab = new TabSession();
      const handler = vi.fn();
      tab.on('titleChanged', handler);
      tab.setTitle('First');
      expect(handler).toHaveBeenCalledTimes(1);
      tab.off('titleChanged', handler);
      tab.setTitle('Second');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('dispose', () => {
    it('clears history', () => {
      const tab = new TabSession();
      tab.pushHistory(makeEntry('https://a.com'));
      tab.pushHistory(makeEntry('https://b.com'));
      tab.dispose();
      expect(tab.history.length).toBe(0);
    });

    it('resets history index', () => {
      const tab = new TabSession();
      tab.pushHistory(makeEntry('https://a.com'));
      tab.dispose();
      expect(tab.historyIndex).toBe(-1);
    });

    it('events stop firing after dispose', () => {
      const tab = new TabSession();
      const handler = vi.fn();
      tab.on('titleChanged', handler);
      tab.dispose();
      tab.setTitle('Should Not Fire');
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe('TabSessionEventBus', () => {
  it('on/off/emit should work correctly', () => {
    const bus = new TabSessionEventBus();
    const handler = vi.fn();
    bus.on('titleChanged', handler);
    bus.emit({ kind: 'titleChanged', tabId: 't1', title: 'Hi' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ kind: 'titleChanged', tabId: 't1', title: 'Hi' });
    bus.off('titleChanged', handler);
    bus.emit({ kind: 'titleChanged', tabId: 't1', title: 'Hi' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('handler error does not crash the bus', () => {
    const bus = new TabSessionEventBus();
    const badHandler = vi.fn(() => { throw new Error('boom'); });
    const goodHandler = vi.fn();
    bus.on('urlChanged', badHandler);
    bus.on('urlChanged', goodHandler);
    expect(() => {
      bus.emit({ kind: 'urlChanged', tabId: 't1', url: 'https://x.com' });
    }).not.toThrow();
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  it('dispose clears all handlers', () => {
    const bus = new TabSessionEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('titleChanged', h1);
    bus.on('urlChanged', h2);
    bus.dispose();
    bus.emit({ kind: 'titleChanged', tabId: 't1', title: 'X' });
    bus.emit({ kind: 'urlChanged', tabId: 't1', url: 'https://x.com' });
    expect(h1).not.toHaveBeenCalled();
    expect(h2).not.toHaveBeenCalled();
  });
});
