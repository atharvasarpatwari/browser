/**
 * Indexing existing history and bookmarks for Nova Search (Windows phase 1): one page at a time, never re-fetching what
 * is indexed or ruled out, never fetching addresses that act when opened, stopping when indexing is not allowed.
 */
import { describe, expect, it, vi } from 'vitest';
import { ArchiveBackfill, isBackfillable } from '../src/browser/search/archive-backfill';
import type { ArchiveBackfillDeps, BackfillCandidate, FetchedDocument } from '../src/browser/search/archive-backfill';
import type { IndexableDocument } from '../src/browser/search/bm25-index';

const article = (title: string): string =>
  `<html><head><title>${title}</title></head><body><h1>${title}</h1><p>${'Quasars are luminous galactic nuclei powered by black holes. '.repeat(6)}</p></body></html>`;
const ok = (body: string, contentType = 'text/html; charset=utf-8'): FetchedDocument => ({ statusCode: 200, contentType, body });

function setup(candidates: BackfillCandidate[], fetch: (url: string) => Promise<FetchedDocument>, over: Partial<ArchiveBackfillDeps> = {}) {
  const indexed = new Map<string, IndexableDocument>();
  let enabled = true;
  const skipped = new Set<string>();
  const fetchDocument = vi.fn((url: string) => fetch(url));
  const sleep = vi.fn(async () => {});
  const backfill = new ArchiveBackfill({
    candidates: async () => candidates,
    fetchDocument,
    archive: {
      canIndex: (url) => enabled && /^https?:/.test(url),
      has: (url) => indexed.has(url),
      indexNow: (doc) => { indexed.set(doc.url, doc); return true; },
    },
    skipped: { has: (u) => skipped.has(u), add: (u) => { skipped.add(u); } },
    sleep,
    ...over,
  });
  return { backfill, indexed, skipped, fetchDocument, sleep, disable: () => { enabled = false; } };
}

const page = (url: string, visitedAt = 1000, title = ''): BackfillCandidate => ({ url, title, visitedAt });

describe('isBackfillable', () => {
  it('fetches ordinary pages again, never addresses that act when opened or carry a secret', () => {
    expect(isBackfillable('https://en.wikipedia.org/wiki/Quasar')).toBe(true);
    expect(isBackfillable('http://blog.example.com/2026/11/notes?page=2')).toBe(true);
    for (const url of [
      'https://mail.example.com/logout', 'https://example.com/account/sign-out', 'https://news.example.com/unsubscribe?id=9',
      'https://shop.example.com/cart', 'https://shop.example.com/checkout/step1', 'https://example.com/confirm?email=a',
      'https://example.com/reset-password?token=abc', 'https://example.com/oauth/callback?code=1', 'https://example.com/items/4/delete',
      'https://example.com/verify/123', 'https://files.example.com/download/report.pdf',
    ]) expect(isBackfillable(url)).toBe(false);
    expect(isBackfillable('https://user:pw@example.com/')).toBe(false);
    expect(isBackfillable('nova://settings')).toBe(false);
    expect(isBackfillable('not a url')).toBe(false);
  });
});

describe('ArchiveBackfill', () => {
  it('indexes history pages with their visit time, newest first, pausing between pages', async () => {
    const t = setup([page('https://a.example/', 500, 'A'), page('https://b.example/', 400)], async (url) => ok(article(url.includes('a.') ? 'Alpha' : 'Beta')));
    await t.backfill.start();
    expect([...t.indexed.keys()]).toEqual(['https://a.example/', 'https://b.example/']);
    expect(t.indexed.get('https://a.example/')!.visitedAt).toBe(500);
    expect(t.indexed.get('https://b.example/')!.title).toBe('Beta');
    expect(t.sleep).toHaveBeenCalledTimes(2);
    expect(t.backfill.stats()).toMatchObject({ state: 'done', done: 2, total: 2, indexed: 2 });
  });

  it('never fetches what is indexed, ruled out, risky or listed twice', async () => {
    const t = setup([
      page('https://a.example/'), page('https://a.example/'), page('https://done.example/'),
      page('https://bad.example/'), page('https://mail.example.com/logout'), page('nova://history'),
    ], async () => ok(article('Fresh')));
    t.indexed.set('https://done.example/', {} as IndexableDocument);
    t.skipped.add('https://bad.example/');
    await t.backfill.start();
    expect(t.fetchDocument.mock.calls.map((c) => c[0])).toEqual(['https://a.example/']);
    expect(t.backfill.stats()).toMatchObject({ state: 'done', total: 5, done: 5, indexed: 1 });
  });

  it('remembers pages that cannot be indexed (error status, not HTML, login page) so they are not fetched again', async () => {
    const bodies: Record<string, FetchedDocument> = {
      'https://404.example/': { statusCode: 404, contentType: 'text/html', body: 'gone' },
      'https://pdf.example/': ok('%PDF', 'application/pdf'),
      'https://login.example/': ok(`<html><body><form><input type="password"></form>${'x '.repeat(80)}</body></html>`),
    };
    const t = setup(Object.keys(bodies).map((u) => page(u)), async (url) => bodies[url]!);
    await t.backfill.start();
    expect(t.indexed.size).toBe(0);
    expect([...t.skipped].sort()).toEqual(Object.keys(bodies).sort());
  });

  it('uses the history title when the page has neither a title nor a heading', async () => {
    const t = setup([page('https://plain.example/', 1, 'Saved title')], async () => ok(`<html><body><p>${'plain text content here '.repeat(10)}</p></body></html>`));
    await t.backfill.start();
    expect(t.indexed.get('https://plain.example/')!.title).toBe('Saved title');
  });

  it('stops after the per-session fetch limit, and a later start in the same session does not fetch more', async () => {
    const t = setup([1, 2, 3, 4].map((n) => page(`https://p${n}.example/`)), async () => ok(article('Page')), { maxFetchesPerSession: 2 });
    await t.backfill.start();
    expect(t.fetchDocument).toHaveBeenCalledTimes(2);
    expect(t.backfill.stats()).toMatchObject({ state: 'stopped', reason: 'limit', indexed: 2 });
    await t.backfill.start();
    expect(t.fetchDocument).toHaveBeenCalledTimes(2);
  });

  it('stops after repeated network failures without marking those pages as unindexable', async () => {
    const t = setup([1, 2, 3, 4].map((n) => page(`https://p${n}.example/`)), async () => { throw new Error('ENOTFOUND'); }, { maxFailures: 3 });
    await t.backfill.start();
    expect(t.fetchDocument).toHaveBeenCalledTimes(3);
    expect(t.skipped.size).toBe(0);
    expect(t.backfill.stats()).toMatchObject({ state: 'stopped', reason: 'offline' });
  });

  it('stops when indexing is not allowed (setting off, private window)', async () => {
    const t = setup([page('https://a.example/'), page('https://b.example/')], async () => ok(article('A')));
    t.sleep.mockImplementationOnce(async () => { t.disable(); });
    await t.backfill.start();
    expect(t.fetchDocument).toHaveBeenCalledTimes(1);
    expect(t.backfill.stats()).toMatchObject({ state: 'stopped', reason: 'disabled' });
  });

  it('pauses and resumes where it was', async () => {
    let release: () => void = () => {};
    const t = setup([page('https://a.example/'), page('https://b.example/')], async () => ok(article('A')));
    t.sleep.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    const run = t.backfill.start();
    await vi.waitFor(() => expect(t.fetchDocument).toHaveBeenCalledTimes(1));
    t.backfill.pause();
    release();
    await run;
    expect(t.backfill.stats().state).toBe('paused');
    expect(t.fetchDocument).toHaveBeenCalledTimes(1);
    t.backfill.resume();
    await vi.waitFor(() => expect(t.backfill.stats().state).toBe('done'));
    expect(t.fetchDocument).toHaveBeenCalledTimes(2);
  });

  it('reports progress to listeners and stops on dispose', async () => {
    const t = setup([page('https://a.example/')], async () => ok(article('A')));
    const seen: string[] = [];
    t.backfill.onChange(() => seen.push(t.backfill.stats().state));
    await t.backfill.start();
    expect(seen[0]).toBe('running');
    expect(seen[seen.length - 1]).toBe('done');
    t.backfill.dispose();
    expect(t.backfill.stats().state).toBe('idle');
  });
});
