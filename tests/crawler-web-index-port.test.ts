import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebIndexPort } from '../src/browser/crawler/web-index-port';

vi.mock('../src/browser/crawler/crawler-client', () => ({
  searchWebIndex: vi.fn(),
  getStats: vi.fn(),
}));

import { searchWebIndex, getStats } from '../src/browser/crawler/crawler-client';

describe('WebIndexPort', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns an empty cache synchronously on the first call for a new query', () => {
    vi.mocked(searchWebIndex).mockResolvedValue([]);
    const port = new WebIndexPort();
    expect(port.search('quantum')).toEqual([]);
  });

  it('populates the cache and notifies listeners once the async search resolves', async () => {
    vi.mocked(searchWebIndex).mockResolvedValue([
      { url: 'https://a.com/1', title: 'Quantum', snippet: 'a <mark>quantum</mark> intro', score: -0.5, fetchedAt: 100 },
    ]);
    const port = new WebIndexPort();
    const onChange = vi.fn();
    port.onChange(onChange);

    port.search('quantum');
    await new Promise((r) => setTimeout(r, 0)); // let the microtask queue drain

    expect(onChange).toHaveBeenCalledTimes(1);
    const hits = port.search('quantum');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.snippet).toBe('a quantum intro'); // <mark> tags stripped out, never left as raw HTML
    expect(hits[0]!.highlights).toEqual([[2, 9]]);
    expect(hits[0]!.visitedAt).toBe(100);
  });

  it('resets to an empty cache when the query changes, then refreshes for the new query', async () => {
    vi.mocked(searchWebIndex)
      .mockResolvedValueOnce([{ url: 'https://a.com/1', title: 'A', snippet: 'a', score: -1, fetchedAt: 1 }])
      .mockResolvedValueOnce([{ url: 'https://a.com/2', title: 'B', snippet: 'b', score: -1, fetchedAt: 2 }]);
    const port = new WebIndexPort();

    port.search('first');
    await new Promise((r) => setTimeout(r, 0));
    expect(port.search('first')).toHaveLength(1);

    const resultForSecond = port.search('second'); // query changed — cache resets immediately
    expect(resultForSecond).toEqual([]);
    await new Promise((r) => setTimeout(r, 0));
    expect(port.search('second')[0]!.url).toBe('https://a.com/2');
  });

  it('does not throw and leaves the cache empty when the IPC call rejects', async () => {
    vi.mocked(searchWebIndex).mockRejectedValue(new Error('bridge unavailable'));
    const port = new WebIndexPort();
    port.search('quantum');
    await new Promise((r) => setTimeout(r, 0));
    expect(port.search('quantum')).toEqual([]);
  });

  it('stats() returns the last-known value and refreshes in the background', async () => {
    vi.mocked(getStats).mockResolvedValue({
      pagesFetched: 3, frontierSize: 10, documentCount: 3, allowedDomains: ['a.com'], running: true,
    });
    const port = new WebIndexPort();
    expect(port.stats().documentCount).toBe(0); // nothing cached yet
    await new Promise((r) => setTimeout(r, 0));
    expect(port.stats().documentCount).toBe(3);
  });

  it('onChange returns an unsubscribe function that stops further notifications', async () => {
    vi.mocked(searchWebIndex).mockResolvedValue([{ url: 'u', title: 't', snippet: 's', score: 0, fetchedAt: 0 }]);
    const port = new WebIndexPort();
    const onChange = vi.fn();
    const unsubscribe = port.onChange(onChange);
    unsubscribe();

    port.search('x');
    await new Promise((r) => setTimeout(r, 0));
    expect(onChange).not.toHaveBeenCalled();
  });
});
