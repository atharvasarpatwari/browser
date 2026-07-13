import { describe, it, expect, vi } from 'vitest';
import { HistoryService, HistoryServiceEventBus } from '../src/browser/history/history-service';
import { InMemoryHistoryStore } from '../src/browser/storage/history-store';
import { NavigationController } from '../src/browser/navigation/navigation-controller';
import { UrlParser } from '../src/browser/navigation/url-parser';

describe('InMemoryHistoryStore', () => {
  it('should add a visit', async () => {
    const store = new InMemoryHistoryStore();
    const entry = await store.addVisit('https://example.com', 'Example', false);
    expect(entry.url).toBe('https://example.com');
    expect(entry.title).toBe('Example');
    expect(entry.visitCount).toBe(1);
    expect(entry.typedCount).toBe(0);
    expect(store.totalEntries).toBe(1);
  });

  it('should increment visit count for existing URL', async () => {
    const store = new InMemoryHistoryStore();
    await store.addVisit('https://example.com', 'Example', false);
    const entry2 = await store.addVisit('https://example.com', 'Example Updated', true);
    expect(entry2.visitCount).toBe(2);
    expect(entry2.typedCount).toBe(1);
    expect(entry2.title).toBe('Example Updated');
    expect(store.totalEntries).toBe(1);
  });

  it('should query with text filter', async () => {
    const store = new InMemoryHistoryStore();
    await store.addVisit('https://alpha.com', 'Alpha Site', false);
    await store.addVisit('https://beta.com', 'Beta Site', false);
    const result = await store.query({ query: 'alpha' });
    expect(result.entries).toHaveLength(1);
    expect(result.totalCount).toBe(1);
    expect(result.hasMore).toBe(false);
  });

  it('should query with fromTime/toTime', async () => {
    const store = new InMemoryHistoryStore();
    const now = Date.now();
    await store.addVisit('https://old.com', 'Old', false);
    // simulate by adjusting ... not possible since store uses Date.now()
    // just verify the filter contract
    const result = await store.query({ fromTime: 0, toTime: now + 100000 });
    expect(result.entries).toHaveLength(1);
  });

  it('query with empty filter should return all entries', async () => {
    const store = new InMemoryHistoryStore();
    await store.addVisit('https://a.com', 'A', false);
    await store.addVisit('https://b.com', 'B', false);
    const result = await store.query({});
    expect(result.entries).toHaveLength(2);
    expect(result.totalCount).toBe(2);
  });

  it('query should paginate with offset and maxResults', async () => {
    const store = new InMemoryHistoryStore();
    for (let i = 0; i < 10; i++) {
      await store.addVisit(`https://site${i}.com`, `Site ${i}`, false);
    }
    const result = await store.query({ maxResults: 3, offset: 0 });
    expect(result.entries).toHaveLength(3);
    expect(result.totalCount).toBe(10);
    expect(result.hasMore).toBe(true);
  });

  it('getRecent should return most recent entries', async () => {
    const store = new InMemoryHistoryStore();
    await store.addVisit('https://a.com', 'A', false);
    await store.addVisit('https://b.com', 'B', false);
    const recent = await store.getRecent(1);
    expect(recent).toHaveLength(1);
    expect(recent[0]!.url).toBe('https://b.com');
  });

  it('getFrecents should score by visit+typed count', async () => {
    const store = new InMemoryHistoryStore();
    await store.addVisit('https://low.com', 'Low', false);
    await store.addVisit('https://high.com', 'High', true);
    await store.addVisit('https://high.com', 'High', true);
    const frecents = await store.getFrecents();
    // high should be first due to typedCount * 0.7 score
    expect(frecents[0]!.url).toBe('https://high.com');
  });

  it('deleteEntry should remove an entry', async () => {
    const store = new InMemoryHistoryStore();
    const entry = await store.addVisit('https://del.com', 'Del', false);
    expect(await store.deleteEntry(entry.id)).toBe(true);
    expect(store.totalEntries).toBe(0);
  });

  it('deleteEntry should return false for missing id', async () => {
    const store = new InMemoryHistoryStore();
    expect(await store.deleteEntry('missing')).toBe(false);
  });

  it('deleteRange should remove entries within range', async () => {
    const store = new InMemoryHistoryStore();
    const now = Date.now();
    await store.addVisit('https://a.com', 'A', false);
    const count = await store.deleteRange(0, now + 100000);
    expect(count).toBe(1);
    expect(store.totalEntries).toBe(0);
  });

  it('deleteRange should not remove entries outside range', async () => {
    const store = new InMemoryHistoryStore();
    await store.addVisit('https://a.com', 'A', false);
    const count = await store.deleteRange(1, 1);
    expect(count).toBe(0);
    expect(store.totalEntries).toBe(1);
  });

  it('deleteAll should clear everything', async () => {
    const store = new InMemoryHistoryStore();
    await store.addVisit('https://a.com', 'A', false);
    await store.deleteAll();
    expect(store.totalEntries).toBe(0);
  });

  it('getEntryByUrl should find by exact url', async () => {
    const store = new InMemoryHistoryStore();
    await store.addVisit('https://example.com', 'Ex', false);
    expect(await store.getEntryByUrl('https://example.com')).not.toBeNull();
    expect(await store.getEntryByUrl('https://other.com')).toBeNull();
  });

  it('dispose should clear all entries', () => {
    const store = new InMemoryHistoryStore();
    store.dispose();
    expect(store.totalEntries).toBe(0);
  });
});

describe('HistoryServiceEventBus', () => {
  it('should emit to registered handlers', () => {
    const bus = new HistoryServiceEventBus();
    const handler = vi.fn();
    bus.on('entryAdded', handler);
    bus.emit({ kind: 'entryAdded', entry: null as any });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('off should remove handler', () => {
    const bus = new HistoryServiceEventBus();
    const handler = vi.fn();
    bus.on('cleared', handler);
    bus.off('cleared', handler);
    bus.emit({ kind: 'cleared' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should handle exceptions gracefully', () => {
    const bus = new HistoryServiceEventBus();
    bus.on('entryAdded', () => { throw new Error('crash'); });
    expect(() => bus.emit({ kind: 'entryAdded', entry: null as any })).not.toThrow();
  });

  it('dispose should clear channels', () => {
    const bus = new HistoryServiceEventBus();
    const handler = vi.fn();
    bus.on('entriesDeleted', handler);
    bus.dispose();
    bus.emit({ kind: 'entriesDeleted', count: 1 });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('HistoryService', () => {
  it('should add a visit', async () => {
    const svc = new HistoryService();
    const entry = await svc.addVisit('https://example.com', 'Example', true);
    expect(entry.typedCount).toBe(1);
    expect(svc.totalEntries).toBe(1);
  });

  it('should query entries', async () => {
    const svc = new HistoryService();
    await svc.addVisit('https://example.com', 'Example', false);
    const result = await svc.query({});
    expect(result.totalCount).toBe(1);
  });

  it('should get recent entries', async () => {
    const svc = new HistoryService();
    await svc.addVisit('https://a.com', 'A', false);
    await svc.addVisit('https://b.com', 'B', false);
    const recent = await svc.getRecent(1);
    expect(recent).toHaveLength(1);
  });

  it('should get frecent entries', async () => {
    const svc = new HistoryService();
    await svc.addVisit('https://a.com', 'A', true);
    await svc.addVisit('https://b.com', 'B', false);
    const frecents = await svc.getFrecents();
    expect(frecents).toHaveLength(2);
  });

  it('should delete an entry', async () => {
    const svc = new HistoryService();
    const entry = await svc.addVisit('https://del.com', 'Del', false);
    expect(await svc.deleteEntry(entry.id)).toBe(true);
    expect(svc.totalEntries).toBe(0);
  });

  it('deleteEntry should return false for missing', async () => {
    const svc = new HistoryService();
    expect(await svc.deleteEntry('missing')).toBe(false);
  });

  it('should delete a range', async () => {
    const svc = new HistoryService();
    await svc.addVisit('https://a.com', 'A', false);
    const count = await svc.deleteRange(0, Date.now() + 100000);
    expect(count).toBe(1);
  });

  it('should delete all', async () => {
    const svc = new HistoryService();
    await svc.addVisit('https://a.com', 'A', false);
    await svc.deleteAll();
    expect(svc.totalEntries).toBe(0);
  });

  it('should get entry by url', async () => {
    const svc = new HistoryService();
    await svc.addVisit('https://example.com', 'Ex', false);
    expect(await svc.getEntryByUrl('https://example.com')).not.toBeNull();
  });

  it('should emit entryAdded event', async () => {
    const svc = new HistoryService();
    const handler = vi.fn();
    svc.on('entryAdded', handler);
    await svc.addVisit('https://example.com', 'Ex', false);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should emit entriesDeleted on deleteEntry', async () => {
    const svc = new HistoryService();
    const handler = vi.fn();
    svc.on('entriesDeleted', handler);
    const entry = await svc.addVisit('https://del.com', 'Del', false);
    await svc.deleteEntry(entry.id);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ kind: 'entriesDeleted', count: 1 }));
  });

  it('should emit entriesDeleted on deleteRange', async () => {
    const svc = new HistoryService();
    const handler = vi.fn();
    svc.on('entriesDeleted', handler);
    await svc.addVisit('https://a.com', 'A', false);
    await svc.deleteRange(0, Date.now() + 100000);
    expect(handler).toHaveBeenCalled();
  });

  it('should emit cleared on deleteAll', async () => {
    const svc = new HistoryService();
    const handler = vi.fn();
    svc.on('cleared', handler);
    await svc.deleteAll();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('not emit entriesDeleted when deleteEntry returns false', async () => {
    const svc = new HistoryService();
    const handler = vi.fn();
    svc.on('entriesDeleted', handler);
    await svc.deleteEntry('missing');
    expect(handler).not.toHaveBeenCalled();
  });

  it('not emit entriesDeleted when deleteRange returns 0', async () => {
    const svc = new HistoryService();
    const handler = vi.fn();
    svc.on('entriesDeleted', handler);
    await svc.deleteRange(1, 1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('connectController should add navigation listener', async () => {
    const parser = new UrlParser();
    const controller = new NavigationController(parser);
    const svc = new HistoryService();

    svc.connectController(controller);
    await controller.navigate('https://example.com');

    expect(svc.totalEntries).toBe(1);
    const entry = await svc.getEntryByUrl('https://example.com/');
    expect(entry).not.toBeNull();
  });

  it('disconnectController should remove navigation listener', async () => {
    const parser = new UrlParser();
    const controller = new NavigationController(parser);
    const svc = new HistoryService();

    svc.connectController(controller);
    svc.disconnectController(controller);
    await controller.navigate('https://example.com');

    expect(svc.totalEntries).toBe(0);
  });

  it('connectController should not double-register same controller', async () => {
    const parser = new UrlParser();
    const controller = new NavigationController(parser);
    const svc = new HistoryService();

    svc.connectController(controller);
    svc.connectController(controller);
    await controller.navigate('https://example.com');

    expect(svc.totalEntries).toBe(1);
  });

  it('initialize and shutdown should work', async () => {
    const svc = new HistoryService();
    await svc.initialize();
    await svc.shutdown();
  });

  it('on/off should work', async () => {
    const svc = new HistoryService();
    const handler = vi.fn();
    svc.on('entryAdded', handler);
    svc.off('entryAdded', handler);
    await svc.addVisit('https://example.com', 'Ex', false);
    expect(handler).not.toHaveBeenCalled();
  });
});
