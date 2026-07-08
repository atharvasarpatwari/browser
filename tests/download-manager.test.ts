import { describe, it, expect, vi } from 'vitest';
import { DownloadManager, DownloadManagerEventBus, suggestedFilename } from '../src/browser/downloads/download-manager';

describe('suggestedFilename', () => {
  it('should extract filename from url path', () => {
    expect(suggestedFilename('https://example.com/files/report.pdf', 'application/pdf')).toBe('report.pdf');
  });

  it('should fall back to mime extension when url has no filename', () => {
    expect(suggestedFilename('https://example.com/download', 'image/png')).toBe('download.png');
  });

  it('should handle urls without path segments', () => {
    const name = suggestedFilename('https://example.com', 'text/html');
    expect(name).toBe('download.html');
  });

  it('should handle invalid urls gracefully', () => {
    const name = suggestedFilename('not-a-valid-url', 'application/octet-stream');
    expect(name).toBe('download.octet-stream');
  });

  it('should handle unknown mime types', () => {
    const name = suggestedFilename('https://example.com/file', 'unknown/');
    expect(name).toBe('download.');
  });

  it('should handle mime type without subtype', () => {
    const name = suggestedFilename('https://example.com/file', 'text');
    expect(name).toBe('download.bin');
  });
});

describe('DownloadManagerEventBus', () => {
  it('should emit to registered handlers', () => {
    const bus = new DownloadManagerEventBus();
    const handler = vi.fn();
    bus.on('downloadCreated', handler);
    bus.emit({ kind: 'downloadCreated', item: null as any });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should not call handlers for other event types', () => {
    const bus = new DownloadManagerEventBus();
    const handler = vi.fn();
    bus.on('downloadCompleted', handler);
    bus.emit({ kind: 'downloadCreated', item: null as any });
    expect(handler).not.toHaveBeenCalled();
  });

  it('off should remove handler', () => {
    const bus = new DownloadManagerEventBus();
    const handler = vi.fn();
    bus.on('downloadProgress', handler);
    bus.off('downloadProgress', handler);
    bus.emit({ kind: 'downloadProgress', id: '1', receivedBytes: 0, totalBytes: 100, percent: 0 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should catch handler exceptions', () => {
    const bus = new DownloadManagerEventBus();
    bus.on('downloadCreated', () => { throw new Error('crash'); });
    expect(() => bus.emit({ kind: 'downloadCreated', item: null as any })).not.toThrow();
  });

  it('dispose should clear all channels', () => {
    const bus = new DownloadManagerEventBus();
    const handler = vi.fn();
    bus.on('downloadFailed', handler);
    bus.dispose();
    bus.emit({ kind: 'downloadFailed', id: '1', error: 'err' });
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('DownloadManager', () => {
  it('should create a download item', async () => {
    const dm = new DownloadManager();
    const item = await dm.download('https://example.com/file.zip');
    expect(item.id).toBeTruthy();
    expect(item.url).toBe('https://example.com/file.zip');
    expect(item.filename).toBe('file.zip');
    expect(dm.items).toHaveLength(1);
  });

  it('should use custom filename from options', async () => {
    const dm = new DownloadManager();
    const item = await dm.download('https://example.com/download', { filename: 'custom.zip' });
    expect(item.filename).toBe('custom.zip');
  });

  it('should use custom path from options', async () => {
    const dm = new DownloadManager();
    const item = await dm.download('https://example.com/f', { path: '/tmp/myfile.zip' });
    expect(item.path).toBe('/tmp/myfile.zip');
  });

  it('should set referrer when provided', async () => {
    const dm = new DownloadManager();
    const item = await dm.download('https://example.com/f', { referrer: 'https://referrer.com' });
    expect(item.referrer).toBe('https://referrer.com');
  });

  it('items should be sorted by createdAt descending', async () => {
    const dm = new DownloadManager();
    const item1 = await dm.download('https://example.com/1');
    const item2 = await dm.download('https://example.com/2');
    const items = dm.items;
    expect(items[0]!.id).toBe(item2.id);
    expect(items[1]!.id).toBe(item1.id);
  });

  it('should get item by id', async () => {
    const dm = new DownloadManager();
    const item = await dm.download('https://example.com/f');
    expect(dm.getItem(item.id)).not.toBeNull();
    expect(dm.getItem(item.id)!.id).toBe(item.id);
  });

  it('getItem should return null for missing id', () => {
    const dm = new DownloadManager();
    expect(dm.getItem('missing')).toBeNull();
  });

  it('pause should change state to paused', async () => {
    const dm = new DownloadManager();
    const item = await dm.download('https://example.com/f');
    (item as any).state = 'downloading';
    const paused = await dm.pause(item.id);
    expect(paused).toBe(true);
    expect(dm.getItem(item.id)!.state).toBe('paused');
  });

  it('pause should return false for missing item', async () => {
    const dm = new DownloadManager();
    expect(await dm.pause('missing')).toBe(false);
  });

  it('pause should return false for non-downloading item', async () => {
    const dm = new DownloadManager();
    const item = await dm.download('https://example.com/f');
    await dm.cancel(item.id);
    expect(await dm.pause(item.id)).toBe(false);
  });

  it('resume should change state to downloading', async () => {
    const dm = new DownloadManager();
    const item = await dm.download('https://example.com/f');
    (item as any).state = 'paused';
    const resumed = await dm.resume(item.id);
    expect(resumed).toBe(true);
  });

  it('resume should return false for non-paused item', async () => {
    const dm = new DownloadManager();
    const item = await dm.download('https://example.com/f');
    expect(await dm.resume(item.id)).toBe(false);
  });

  it('resume should return false for missing item', async () => {
    const dm = new DownloadManager();
    expect(await dm.resume('missing')).toBe(false);
  });

  it('cancel should change state to cancelled', async () => {
    const dm = new DownloadManager();
    const item = await dm.download('https://example.com/f');
    const cancelled = await dm.cancel(item.id);
    expect(cancelled).toBe(true);
    expect(dm.getItem(item.id)!.state).toBe('cancelled');
  });

  it('cancel should return false for completed items', async () => {
    const dm = new DownloadManager();
    const item = await dm.download('https://example.com/f');
    (item as any).state = 'completed';
    expect(await dm.cancel(item.id)).toBe(false);
  });

  it('cancel should return false for missing item', async () => {
    const dm = new DownloadManager();
    expect(await dm.cancel('missing')).toBe(false);
  });

  it('remove should delete an item', async () => {
    const dm = new DownloadManager();
    const item = await dm.download('https://example.com/f');
    const removed = await dm.remove(item.id);
    expect(removed).toBe(true);
    expect(dm.items).toHaveLength(0);
  });

  it('remove should return false for missing item', async () => {
    const dm = new DownloadManager();
    expect(await dm.remove('missing')).toBe(false);
  });

  it('clearCompleted should remove completed/failed/cancelled items', async () => {
    const dm = new DownloadManager();
    const item1 = await dm.download('https://example.com/1');
    const item2 = await dm.download('https://example.com/2');
    (item1 as any).state = 'completed';
    (item2 as any).state = 'failed';

    const cleared = await dm.clearCompleted();
    expect(cleared).toBe(2);
    expect(dm.items).toHaveLength(0);
  });

  it('clearCompleted should not remove active items', async () => {
    const dm = new DownloadManager();
    const keep = await dm.download('https://example.com/keep');
    (keep as any).state = 'queued';
    const del = await dm.download('https://example.com/del');

    const cleared = await dm.clearCompleted();
    expect(cleared).toBe(1);
    expect(dm.items).toHaveLength(1);
    expect(dm.items[0]!.id).toBe(keep.id);
  });

  it('should emit downloadCreated event', async () => {
    const dm = new DownloadManager();
    const handler = vi.fn();
    dm.on('downloadCreated', handler);
    await dm.download('https://example.com/f');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should emit downloadCancelled event', async () => {
    const dm = new DownloadManager();
    const handler = vi.fn();
    dm.on('downloadCancelled', handler);
    const item = await dm.download('https://example.com/f');
    await dm.cancel(item.id);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'downloadCancelled', id: item.id }),
    );
  });

  it('should emit downloadPaused event', async () => {
    const dm = new DownloadManager();
    const handler = vi.fn();
    dm.on('downloadPaused', handler);
    const item = await dm.download('https://example.com/f');
    (item as any).state = 'downloading';
    await dm.pause(item.id);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'downloadPaused', id: item.id }),
    );
  });

  it('initialize and shutdown should cancel active items', async () => {
    const dm = new DownloadManager();
    await dm.initialize();
    const item = await dm.download('https://example.com/f');
    await dm.shutdown();
    expect(['cancelled', 'failed']).toContain(dm.getItem(item.id)!.state);
  });

  it('on/off should work', async () => {
    const dm = new DownloadManager();
    const handler = vi.fn();
    dm.on('downloadCreated', handler);
    dm.off('downloadCreated', handler);
    await dm.download('https://example.com/f');
    expect(handler).not.toHaveBeenCalled();
  });

  it('activeCount should be 0 when no downloads', () => {
    const dm = new DownloadManager();
    expect(dm.activeCount).toBe(0);
  });
});
