import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { SearchPage, formatAgo, displayUrl } from '../src/ui/pages/search-page';
import type { ArchivePort, SearchPageDeps, SettingsWritePort } from '../src/ui/pages/search-page';
import type { SearchHit } from '../src/browser/search/bm25-index';
import type { ArchiveStats } from '../src/browser/search/search-archive';
import { SEARCH_SETTINGS } from '../src/ui/components/search-subsystem';

const NOW = 1_700_000_000_000;
const hit = (over: Partial<SearchHit> = {}): SearchHit => ({
  url: 'https://astro.example.com/quasars/intro', title: 'Quasars 101', snippet: 'A quasar is a bright galactic nucleus',
  highlights: [[2, 8]], score: 3, visitedAt: NOW - 3 * 86_400_000, matchedTerms: 1, totalTerms: 1, ...over,
});

describe('formatAgo / displayUrl', () => {
  it.each<[number, string]>([
    [0, 'just now'], [30_000, 'just now'], [60_000, '1 min ago'], [20 * 60_000, '20 min ago'],
    [3 * 3_600_000, '3 h ago'], [2 * 86_400_000, '2 d ago'], [40 * 86_400_000, '2023-10-05'],
  ])('%d ms ago → %s', (age, expected) => {
    expect(formatAgo(NOW - age, NOW)).toBe(expected);
  });

  it('shortens URLs for display', () => {
    expect(displayUrl('https://www.example.com/')).toBe('example.com');
    expect(displayUrl('https://www.example.com/a/b')).toBe('example.com/a/b');
    expect(displayUrl('not a url')).toBe('not a url');
  });
});

describe('SearchPage', () => {
  let container: HTMLElement;
  let page: SearchPage;
  let hits: SearchHit[];
  let stats: ArchiveStats;
  let values: Record<string, unknown>;
  let listeners: Array<() => void>;
  let archiveSearch: Mock<ArchivePort['search']>;
  let archiveClear: Mock<() => Promise<void>>;
  let archive: ArchivePort;
  let navigate: Mock<(url: string, how: { readonly newTab: boolean }) => void>;
  let search: Mock<(query: string) => void>;
  let research: Mock<(query: string) => void>;
  let setValue: Mock<(key: string, value: unknown) => void>;

  const baseStats = (over: Partial<ArchiveStats> = {}): ArchiveStats => ({
    documents: 5, terms: 100, pending: 0, loaded: true, lastSavedAt: null, lastError: null, ...over,
  });

  const mount = (query?: string, extra: Partial<SearchPageDeps> = {}): SearchPage => {
    const settings: SettingsWritePort = {
      getBoolean: (k, f = false) => (typeof values[k] === 'boolean' ? (values[k] as boolean) : f),
      getString: (k, f = '') => (typeof values[k] === 'string' ? (values[k] as string) : f),
      setValue: (k, v) => { values[k] = v; setValue(k, v); },
    };
    const deps: SearchPageDeps = {
      archive,
      settings: () => settings,
      webEngines: () => [
        { name: 'DuckDuckGo', searchUrl: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
        { name: 'Google', searchUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
      ],
      navigate,
      search,
      research,
      now: () => NOW,
      ...extra,
    };
    page = new SearchPage(deps);
    page.mount(container);
    if (query !== undefined) page.setQuery(query);
    return page;
  };

  const texts = (selector: string) => [...container.querySelectorAll(selector)].map((e) => e.textContent);
  const buttons = () => [...container.querySelectorAll('button')];
  const buttonNamed = (label: string) => buttons().find((b) => b.textContent === label || b.getAttribute('aria-label') === label)!;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    hits = [hit()];
    stats = baseStats();
    values = {};
    listeners = [];
    navigate = vi.fn<(url: string, how: { readonly newTab: boolean }) => void>();
    search = vi.fn<(query: string) => void>();
    research = vi.fn<(query: string) => void>();
    setValue = vi.fn<(key: string, value: unknown) => void>();
    archiveSearch = vi.fn<ArchivePort['search']>(() => hits);
    archiveClear = vi.fn<() => Promise<void>>(async () => { stats = baseStats({ documents: 0 }); hits = []; });
    archive = {
      search: archiveSearch,
      stats: () => stats,
      clear: archiveClear,
      onChange: (h) => { listeners.push(h); return () => { listeners.splice(listeners.indexOf(h), 1); }; },
    };
  });

  afterEach(() => {
    page?.dispose();
    container.remove();
  });

  it('shows the logo, a search box, an intro and the settings when there is no query', () => {
    mount();
    expect(container.querySelector('h1')!.getAttribute('aria-label')).toBe('Nova Search');
    expect(container.querySelector('h1 svg')).not.toBeNull();
    expect(container.querySelector('input[type="search"]')).not.toBeNull();
    expect(texts('h2')).toEqual(['Search anything']);
    expect(texts('summary')).toEqual(['Search settings']);
    expect((container.querySelector('.ns-tabs') as HTMLElement).hidden).toBe(true);
    expect(container.textContent).toContain('@archive');
    expect(archiveSearch).not.toHaveBeenCalled();
  });

  it('puts the query in the box and shows tabs, a result count and the search-elsewhere row', () => {
    mount('quasar');
    expect((container.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('quasar');
    expect(texts('.ns-tab')).toEqual(['All', 'Bookmarks & history']);
    expect(container.querySelector('.ns-stats')!.textContent).toMatch(/^About 1 result \(\d+\.\d\d seconds\) · 5 pages in your Nova index$/);
    expect(container.querySelector('.ns-elsewhere')!.textContent).toContain('Search elsewhere:');
    expect(archiveSearch).toHaveBeenCalledWith('quasar', { limit: 100, prefix: false, fuzzy: true });
  });

  describe('results like a search engine', () => {
    const manyHits = (n: number) => Array.from({ length: n }, (_, i) => hit({ url: `https://site${i}.example/p`, title: `Result ${i + 1}` }));

    it('shows 10 results per page with Previous / numbered / Next pages', () => {
      hits = manyHits(25);
      mount('quasar');
      expect(container.querySelectorAll('article')).toHaveLength(10);
      expect(texts('.ns-pager button')).toEqual(['Previous', '1', '2', '3', 'Next']);
      expect(buttonNamed('Previous').disabled).toBe(true);
      buttonNamed('Next').click();
      expect(container.querySelector('article a')!.textContent).toBe('Result 11');
      expect(container.querySelector('[aria-current="page"]')!.textContent).toBe('2');
      buttonNamed('3').click();
      expect(container.querySelectorAll('article')).toHaveLength(5);
      expect(buttonNamed('Next').disabled).toBe(true);
    });

    it('merges bookmarks (first) and history when they arrive, and the second tab shows only them', async () => {
      const saved = vi.fn(async () => ({
        bookmarks: [{ url: 'https://saved.example/quasars', title: 'My quasar notes' }],
        history: [{ url: 'https://seen.example/q', title: 'Seen quasar page', visitedAt: NOW - 60_000 }],
      }));
      mount('quasar', { saved });
      expect(saved).toHaveBeenCalledWith('quasar');
      await Promise.resolve();
      await Promise.resolve();
      expect(texts('article a')).toEqual(['My quasar notes', 'Quasars 101', 'Seen quasar page']);
      expect(container.querySelector('article .ns-badge')!.textContent).toBe('Bookmark');
      buttonNamed('Bookmarks & history').click();
      expect(texts('article a')).toEqual(['My quasar notes', 'Seen quasar page']);
      expect(container.querySelector('.ns-tab.ns-active')!.textContent).toBe('Bookmarks & history');
    });

    it('ignores a late bookmark/history answer for an older query', async () => {
      let resolveOld: (v: { bookmarks: never[]; history: { url: string; title: string }[] }) => void = () => {};
      const saved = vi.fn()
        .mockReturnValueOnce(new Promise((r) => { resolveOld = r; }))
        .mockResolvedValue({ bookmarks: [], history: [] });
      mount('old', { saved });
      page.setQuery('new');
      resolveOld({ bookmarks: [], history: [{ url: 'https://stale.example/', title: 'Stale' }] });
      await Promise.resolve();
      await Promise.resolve();
      expect(texts('article a')).not.toContain('Stale');
    });

    it('offers suggestions under its own box and searches the picked row', async () => {
      vi.useFakeTimers();
      try {
        const suggest = vi.fn(async () => [{ type: 'search', text: 'quasar jets', description: 'Search', score: 1, source: 'x', action: 'search' }] as never);
        mount('', { suggest });
        const box = container.querySelector('input[type="search"]') as HTMLInputElement;
        box.value = 'quas';
        box.dispatchEvent(new Event('input'));
        await vi.advanceTimersByTimeAsync(100);
        const row = container.querySelector('.ns-suggest-row')!;
        expect(row.textContent).toContain('quasar jets');
        row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        expect(search).toHaveBeenLastCalledWith('quasar jets');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('archive results', () => {
    it('renders each hit with title, short URL, highlighted snippet and age', () => {
      mount('quasar');
      const article = container.querySelector('article')!;
      expect(article.querySelector('a')!.textContent).toBe('Quasars 101');
      expect(article.querySelector('a')!.getAttribute('href')).toBe('https://astro.example.com/quasars/intro');
      expect(article.textContent).toContain('astro.example.com/quasars/intro');
      expect(article.querySelector('p b')!.textContent).toBe('quasar');
      expect(article.querySelector('p')!.textContent).toBe('A quasar is a bright galactic nucleus');
      expect(article.textContent).toContain('Visited 3 d ago');
    });

    it('never renders page-supplied text as HTML', () => {
      hits = [hit({ title: '<img src=x onerror=alert(1)>', snippet: '<script>alert(1)</script> text', highlights: [] })];
      mount('x');
      expect(container.querySelector('article img')).toBeNull();
      expect(container.querySelector('article script')).toBeNull();
      expect(container.querySelector('article a')!.textContent).toBe('<img src=x onerror=alert(1)>');
    });

    it('opens a hit in the current tab, or a new one with Ctrl/Cmd-click or middle-click', () => {
      mount('quasar');
      const link = container.querySelector('article a')!;
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(navigate).toHaveBeenLastCalledWith('https://astro.example.com/quasars/intro', { newTab: false });
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
      expect(navigate).toHaveBeenLastCalledWith('https://astro.example.com/quasars/intro', { newTab: true });
      link.dispatchEvent(new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
      expect(navigate).toHaveBeenCalledTimes(3);
    });

    it('explains an empty or disabled archive, and offers to turn it on', () => {
      stats = baseStats({ documents: 0 });
      mount('quasar');
      expect(container.textContent).toContain('Your personal archive is off');
      expect(archiveSearch).not.toHaveBeenCalled();
      buttonNamed('Turn on personal archive').click();
      expect(setValue).toHaveBeenCalledWith(SEARCH_SETTINGS.archive, true);
      expect(container.textContent).toContain('Nothing is indexed yet');
    });

    it('says so when nothing matches', () => {
      hits = [];
      mount('zzz');
      expect(container.textContent).toContain('No pages in your archive match.');
    });
  });

  it('shows an instant answer card with a copy button', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount('2+2');
    expect(texts('h2')[0]).toBe('Instant answer');
    expect(container.textContent).toContain('2+2 = 4');
    buttonNamed('Copy').click();
    expect(writeText).toHaveBeenCalledWith('4');
    await Promise.resolve();
    await Promise.resolve();
    expect(buttonNamed('Copied')).toBeTruthy();
  });

  describe('web search shortcuts', () => {
    it('opens the query on the chosen engine, in a new tab with Ctrl-click', () => {
      mount('rust lifetimes');
      buttonNamed('Google').click();
      expect(navigate).toHaveBeenLastCalledWith('https://www.google.com/search?q=rust%20lifetimes', { newTab: false });
      buttonNamed('DuckDuckGo').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      expect(navigate).toHaveBeenLastCalledWith('https://duckduckgo.com/?q=rust%20lifetimes', { newTab: true });
    });

    it('hands the query to Nova AI research', () => {
      mount('why is the sky blue');
      buttonNamed('✨ Ask Nova AI').click();
      expect(research).toHaveBeenCalledWith('why is the sky blue');
    });
  });

  it('searches again from its own box (Enter or the button)', () => {
    mount('first');
    const box = container.querySelector('input[type="search"]') as HTMLInputElement;
    box.value = '  second ';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(search).toHaveBeenLastCalledWith('second');
    box.value = 'third';
    buttonNamed('Search').click();
    expect(search).toHaveBeenLastCalledWith('third');
    box.value = '   ';
    buttonNamed('Search').click();
    expect(search).toHaveBeenCalledTimes(2);
  });

  describe('settings', () => {
    const checkbox = (label: string) => {
      const l = [...container.querySelectorAll('label')].find((x) => x.textContent!.includes(label))!;
      return l.querySelector('input[type="checkbox"]') as HTMLInputElement;
    };

    it('reflects the current values, with privacy-first defaults', () => {
      mount('x');
      expect(checkbox('Index pages I visit').checked).toBe(false);
      expect(checkbox('Show search suggestions').checked).toBe(true);
      expect(checkbox('Remove tracking parameters').checked).toBe(true);
      expect(checkbox('Prepare likely destinations').checked).toBe(true);
      expect((container.querySelector('select') as HTMLSelectElement).value).toBe('duckduckgo');
    });

    it('writes changes straight to the settings store', () => {
      mount('x');
      const box = checkbox('Show search suggestions');
      box.checked = false;
      box.dispatchEvent(new Event('change'));
      expect(setValue).toHaveBeenLastCalledWith(SEARCH_SETTINGS.suggestions, false);
      const strip = checkbox('Remove tracking parameters');
      strip.checked = false;
      strip.dispatchEvent(new Event('change'));
      expect(setValue).toHaveBeenLastCalledWith(SEARCH_SETTINGS.stripTracking, false);
      const select = container.querySelector('select') as HTMLSelectElement;
      select.value = 'brave';
      select.dispatchEvent(new Event('change'));
      expect(setValue).toHaveBeenLastCalledWith(SEARCH_SETTINGS.suggestionsEngine, 'brave');
    });

    it('re-renders when the archive is switched on', () => {
      stats = baseStats({ documents: 0 });
      mount('x');
      expect(container.textContent).toContain('Your personal archive is off');
      const box = checkbox('Index pages I visit');
      box.checked = true;
      box.dispatchEvent(new Event('change'));
      expect(setValue).toHaveBeenLastCalledWith(SEARCH_SETTINGS.archive, true);
      expect(container.textContent).toContain('Nothing is indexed yet');
    });

    it('needs two clicks to clear the archive', async () => {
      mount('x');
      buttonNamed('Clear archive').click();
      expect(archiveClear).not.toHaveBeenCalled();
      expect(buttonNamed('Click again to erase everything')).toBeTruthy();
      buttonNamed('Click again to erase everything').click();
      expect(archiveClear).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      await Promise.resolve();
      expect(container.textContent).toContain('0 pages indexed');
    });

    it('keeps the status line live through archive change events', () => {
      mount('x');
      expect(container.textContent).toContain('5 pages indexed');
      stats = baseStats({ documents: 1, pending: 2, lastError: 'disk full' });
      listeners.forEach((l) => l());
      expect(container.textContent).toContain('1 page indexed · 2 waiting · storage problem: disk full');
    });
  });

  it('stops listening and cleans up on dispose', () => {
    mount('x');
    expect(listeners).toHaveLength(1);
    page.dispose();
    expect(listeners).toHaveLength(0);
    expect(container.innerHTML).toBe('');
    expect(page.isMounted).toBe(false);
    expect(() => page.setQuery('again')).not.toThrow();
  });
});
