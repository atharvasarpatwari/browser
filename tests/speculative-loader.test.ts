import { describe, it, expect, vi, afterEach } from 'vitest';
import { SpeculativeLoader, isWarmableHost, dnsPrefetchHint } from '../src/browser/search/speculative-loader';
import type { SpeculativeDeps, WarmCandidate } from '../src/browser/search/speculative-loader';

const top = (url: string, score = 95, action = 'navigate'): WarmCandidate => ({ url, score, action });

function make(extra: Partial<SpeculativeDeps> = {}) {
  const state = { enabled: true, incognito: false, time: 1_000_000 };
  const warm = vi.fn<(host: string) => void | Promise<void>>();
  const loader = new SpeculativeLoader({
    warm, isEnabled: () => state.enabled, isIncognito: () => state.incognito, now: () => state.time, ...extra,
  });
  return { loader, warm, state };
}

describe('SpeculativeLoader', () => {
  it('warms the host of a confident navigable top result', () => {
    const { loader, warm } = make();
    expect(loader.consider(top('https://www.youtube.com/'))).toBe(true);
    expect(warm).toHaveBeenCalledWith('www.youtube.com');
  });

  it('respects the confidence threshold (default 90, configurable)', () => {
    const { loader, warm } = make();
    expect(loader.consider(top('https://a.example.com/', 89))).toBe(false);
    expect(loader.consider(top('https://a.example.com/', 90))).toBe(true);
    expect(warm).toHaveBeenCalledTimes(1);
    const strict = make({ threshold: 99 });
    expect(strict.loader.consider(top('https://b.example.com/', 95))).toBe(false);
  });

  it.each(['search', 'switch-tab', 'copy', 'run-action', 'research'])('only navigation targets are warmed, not %s', (action) => {
    const { loader, warm } = make();
    expect(loader.consider(top('https://example.com/', 99, action))).toBe(false);
    expect(warm).not.toHaveBeenCalled();
  });

  it('does nothing without a candidate or URL', () => {
    const { loader, warm } = make();
    expect(loader.consider(undefined)).toBe(false);
    expect(loader.consider({ score: 99, action: 'navigate' })).toBe(false);
    expect(loader.consider(top('not a url'))).toBe(false);
    expect(warm).not.toHaveBeenCalled();
  });

  it('is disabled by the setting and in incognito, re-checked on every call', () => {
    const { loader, warm, state } = make();
    state.enabled = false;
    expect(loader.consider(top('https://one.example.com/'))).toBe(false);
    state.enabled = true;
    state.incognito = true;
    expect(loader.consider(top('https://one.example.com/'))).toBe(false);
    state.incognito = false;
    expect(loader.consider(top('https://one.example.com/'))).toBe(true);
    expect(warm).toHaveBeenCalledTimes(1);
  });

  it.each([
    'http://example.com/', 'https://example.com:8443/', 'https://user:pw@example.com/', 'ftp://example.com/',
    'https://localhost/', 'https://127.0.0.1/', 'https://10.0.0.5/', 'https://[::1]/', 'https://intranet/',
    'https://printer.local/', 'https://app.internal/', 'https://x.test/', 'https://host.lan/', 'https://example./',
  ])('never warms %s', (url) => {
    const { loader, warm } = make();
    expect(loader.consider(top(url))).toBe(false);
    expect(warm).not.toHaveBeenCalled();
  });

  it('warms a host at most once per TTL window', () => {
    const { loader, warm, state } = make({ ttlMs: 1000 });
    expect(loader.consider(top('https://example.com/a'))).toBe(true);
    expect(loader.consider(top('https://example.com/b'))).toBe(false); // same host
    expect(loader.consider(top('https://other.com/'))).toBe(true);
    state.time += 1000;
    expect(loader.consider(top('https://example.com/c'))).toBe(true);
    expect(warm).toHaveBeenCalledTimes(3);
  });

  it('treats host case-insensitively', () => {
    const { loader } = make();
    expect(loader.consider(top('https://Example.COM/'))).toBe(true);
    expect(loader.consider(top('https://example.com/'))).toBe(false);
  });

  it('survives a throwing or rejecting warm function without surfacing errors', async () => {
    const sync = make();
    sync.warm.mockImplementation(() => { throw new Error('sync boom'); });
    expect(sync.loader.consider(top('https://sync.example.com/'))).toBe(true);

    const rejecting = make();
    rejecting.warm.mockImplementation(() => Promise.reject(new Error('async boom')));
    expect(rejecting.loader.consider(top('https://async.example.com/'))).toBe(true);
    await new Promise((r) => setTimeout(r, 0)); // an unhandled rejection would fail the run here
  });

  it('bounds its memory: the oldest host becomes warmable again after eviction', () => {
    const { loader, warm } = make();
    for (let i = 0; i <= 200; i++) loader.consider(top(`https://host${i}.example.com/`));
    expect(warm).toHaveBeenCalledTimes(201);
    expect(loader.consider(top('https://host0.example.com/'))).toBe(true); // evicted
    expect(loader.consider(top('https://host200.example.com/'))).toBe(false); // still remembered
  });

  it('reset() forgets warmed hosts', () => {
    const { loader } = make();
    loader.consider(top('https://example.com/'));
    loader.reset();
    expect(loader.consider(top('https://example.com/'))).toBe(true);
  });
});

describe('isWarmableHost', () => {
  it.each(['example.com', 'sub.example.co.uk', 'xn--bcher-kva.example'])('%s', (h) => {
    expect(isWarmableHost(h)).toBe(true);
  });
  it.each(['localhost', 'intranet', '1.2.3.4', '::1', 'a.local', 'a.internal', 'x.', '', 'host.corp', 'a.home'])('rejects %j', (h) => {
    expect(isWarmableHost(h)).toBe(false);
  });
});

describe('dnsPrefetchHint', () => {
  const hints = () => [...document.head.querySelectorAll('link[rel="dns-prefetch"]')];
  afterEach(() => { vi.useRealTimers(); hints().forEach((l) => l.remove()); });

  it('adds a dns-prefetch hint to the document head for the host', () => {
    dnsPrefetchHint('www.youtube.com');
    expect(hints().map((l) => l.getAttribute('href'))).toEqual(['https://www.youtube.com']);
  });

  it('is an absolute https URL, never protocol-relative — the app page is file:, which would key the lookup under the wrong scheme', () => {
    dnsPrefetchHint('example.com');
    expect(hints()[0]!.getAttribute('href')).toMatch(/^https:\/\/example\.com$/);
    expect(hints()[0]!.getAttribute('href')).not.toMatch(/^\/\//);
  });

  it('removes the hint once the browser has had time to act on it', () => {
    vi.useFakeTimers();
    dnsPrefetchHint('example.com');
    vi.advanceTimersByTime(9_000);
    expect(hints()).toHaveLength(1);
    vi.advanceTimersByTime(2_000);
    expect(hints()).toHaveLength(0);
  });

  it('hints in the document it is given', () => {
    const other = document.implementation.createHTMLDocument('other');
    dnsPrefetchHint('example.com', other);
    expect(other.head.querySelectorAll('link[rel="dns-prefetch"]')).toHaveLength(1);
    expect(hints()).toHaveLength(0);
  });
});
