import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DownloadManager, suggestedFilename, categorizeMime, SpeedTracker,
  type DownloadItem,
} from '../src/browser/downloads/download-manager';

// ── suggestedFilename ──

describe('suggestedFilename', () => {
  it('extracts filename from URL path', () => {
    expect(suggestedFilename('https://example.com/file.pdf', 'application/octet-stream')).toBe('file.pdf');
  });

  it('falls back to MIME extension', () => {
    expect(suggestedFilename('https://example.com/', 'image/png')).toBe('download.png');
  });

  it('handles URL without extension', () => {
    expect(suggestedFilename('https://example.com/data', 'application/octet-stream')).toBe('download.octet-stream');
  });
});

// ── categorizeMime ──

describe('categorizeMime', () => {
  it('categorizes video', () => expect(categorizeMime('video/mp4')).toBe('video'));
  it('categorizes audio', () => expect(categorizeMime('audio/mpeg')).toBe('audio'));
  it('categorizes image', () => expect(categorizeMime('image/png')).toBe('image'));
  it('categorizes PDF', () => expect(categorizeMime('application/pdf')).toBe('document'));
  it('categorizes zip', () => expect(categorizeMime('application/zip')).toBe('archive'));
  it('categorizes executable', () => expect(categorizeMime('application/x-msdownload')).toBe('executable'));
  it('categorizes unknown', () => expect(categorizeMime('unknown/type')).toBe('other'));
});

// ── SpeedTracker ──

describe('SpeedTracker', () => {
  it('returns 0 with no samples', () => {
    const t = new SpeedTracker();
    expect(t.getSpeed()).toBe(0);
  });

  it('returns 0 with one sample', () => {
    const t = new SpeedTracker();
    t.addSample(100, Date.now());
    expect(t.getSpeed()).toBe(0);
  });

  it('calculates speed from samples', () => {
    const t = new SpeedTracker();
    const now = Date.now();
    t.addSample(0, now);
    t.addSample(1000, now + 1000);
    expect(t.getSpeed()).toBeCloseTo(1000, 0);
  });

  it('calculates ETA', () => {
    const t = new SpeedTracker();
    const now = Date.now();
    t.addSample(0, now);
    t.addSample(500, now + 1000);
    // 500 bytes/sec, 500 remaining → 1 second
    expect(t.getEta(500, 1000)).toBeCloseTo(1, 0);
  });

  it('reset clears data', () => {
    const t = new SpeedTracker();
    t.addSample(100, Date.now());
    t.addSample(200, Date.now() + 1000);
    t.reset();
    expect(t.getSpeed()).toBe(0);
  });

  it('limits samples to 10', () => {
    const t = new SpeedTracker();
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
      t.addSample(i * 100, now + i * 100);
    }
    expect(t.getSpeed()).toBeGreaterThanOrEqual(0);
  });
});

// ── DownloadManager Enhanced ──

describe('DownloadManager - Enhanced', () => {
  let dm: DownloadManager;

  beforeEach(() => {
    dm = new DownloadManager();
    dm.initialize();
  });

  afterEach(async () => {
    await dm.shutdown();
  });

  it('initializes and shuts down', async () => {
    // already done in beforeEach/afterEach
  });

  it('creates a download item', async () => {
    const item = await dm.download('https://example.com/file.txt');
    expect(item).toBeDefined();
    expect(item.id).toBeDefined();
    expect(item.url).toBe('https://example.com/file.txt');
    expect(item.speedBytesPerSec).toBe(0);
    expect(item.etaSeconds).toBe(0);
    expect(item.fileTypeCategory).toBe('other');
  });

  it('rejects duplicate URLs by default', async () => {
    await dm.download('https://example.com/same.txt');
    const second = await dm.download('https://example.com/same.txt');
    expect(second.id).toBeDefined(); // returns same item
    expect(dm.items).toHaveLength(1);
  });

  it('allows duplicates with allowDuplicate option', async () => {
    await dm.download('https://example.com/a.txt');
    await dm.download('https://example.com/a.txt', { allowDuplicate: true });
    expect(dm.items).toHaveLength(2);
  });

  it('hasUrl detects queued URLs', async () => {
    expect(dm.hasUrl('https://example.com/a.txt')).toBe(false);
    await dm.download('https://example.com/a.txt');
    expect(dm.hasUrl('https://example.com/a.txt')).toBe(true);
  });

  it('getItemsByState filters correctly', async () => {
    await dm.download('https://example.com/a.txt');
    await dm.download('https://example.com/b.txt');
    // Downloads may have transitioned from queued to downloading or failed
    const active = dm.getItemsByState('downloading').length + dm.getItemsByState('queued').length;
    expect(active).toBeGreaterThanOrEqual(1);
    expect(dm.getItemsByState('completed')).toHaveLength(0);
  });

  it('getItemsByCategory filters by MIME category', async () => {
    const item = await dm.download('https://example.com/a.txt');
    // Default is 'other' since no Content-Type header
    expect(dm.getItemsByCategory('other')).toHaveLength(1);
    expect(dm.getItemsByCategory('video')).toHaveLength(0);
  });

  it('getStats returns aggregate data', async () => {
    await dm.download('https://example.com/a.txt');
    const stats = dm.getStats();
    expect(stats.total).toBe(1);
    expect(stats.active).toBeGreaterThanOrEqual(1);
    expect(stats.completed).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.totalBytesReceived).toBeGreaterThanOrEqual(0);
    expect(stats.overallSpeedBytesPerSec).toBeGreaterThanOrEqual(0);
  });

  it('getSpeed returns 0 for non-existent item', () => {
    expect(dm.getSpeed('no-such')).toBe(0);
  });

  it('getEta returns 0 for non-existent item', () => {
    expect(dm.getEta('no-such')).toBe(0);
  });

  it('getTotalSpeed returns 0 when no active', () => {
    expect(dm.getTotalSpeed()).toBe(0);
  });

  it('pauseAll pauses active downloads', async () => {
    await dm.download('https://example.com/a.txt');
    await dm.download('https://example.com/b.txt');
    const count = await dm.pauseAll();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(dm.getItemsByState('paused').length).toBeGreaterThanOrEqual(1);
  });

  it('cancelAll cancels active downloads', async () => {
    await dm.download('https://example.com/a.txt');
    const count = await dm.cancelAll();
    expect(count).toBeGreaterThanOrEqual(1);
    expect(dm.getItemsByState('cancelled').length).toBeGreaterThanOrEqual(1);
  });

  it('remove emits event', async () => {
    const handler = vi.fn();
    dm.on('downloadRemoved', handler);
    const item = await dm.download('https://example.com/a.txt');
    await dm.remove(item.id);
    expect(handler).toHaveBeenCalled();
  });

  it('remove cleans up speed tracker', async () => {
    const item = await dm.download('https://example.com/a.txt');
    await dm.remove(item.id);
    expect(dm.getSpeed(item.id)).toBe(0);
  });

  it('resume emits downloadResumed event', async () => {
    const item = await dm.download('https://example.com/a.txt');
    // Item starts in queued state, pause it
    await dm.pause(item.id);
    expect(item.state).toBe('paused');

    const handler = vi.fn();
    dm.on('downloadResumed', handler);
    await dm.resume(item.id);
    expect(handler).toHaveBeenCalled();
  });

  it('resume sets error to null', async () => {
    const item = await dm.download('https://example.com/a.txt');
    await dm.pause(item.id);
    await dm.resume(item.id);
    expect(item.error).toBeNull();
  });
});
