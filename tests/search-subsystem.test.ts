import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AddressBar } from '../src/ui/components/address-bar/address-bar';
import { AddressBarView } from '../src/ui/components/address-bar/address-bar.view';
import { SearchSubsystem, TypedSearchProvider, SEARCH_SETTINGS } from '../src/ui/components/search-subsystem';
import type { SearchSubsystemDeps } from '../src/ui/components/search-subsystem';
import type { OmniboxActions } from '../src/ui/components/omnibox-controller';
import { MemoryIndexStorage } from '../src/browser/search/archive-storage';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import type { SwitchableTab } from '../src/browser/omnibox/tab-switch-provider';

const NOW = Date.now();
const HISTORY = [
  { id: 'h1', url: 'https://github.com/', title: 'GitHub', visitTime: NOW, visitCount: 90, typedCount: 40, lastVisitTime: NOW },
  { id: 'h2', url: 'https://news.ycombinator.com/', title: 'Hacker News', visitTime: NOW, visitCount: 3, typedCount: 0, lastVisitTime: NOW - 20 * 86_400_000 },
];
const BOOKMARKS = [
  { id: 'b1', title: 'Rust Book', url: 'https://doc.rust-lang.org/book/', iconUrl: null, folder: false },
  { id: 'f1', title: 'Rust folder', url: null, iconUrl: null, folder: true },
];
const TABS: SwitchableTab[] = [
  { id: 'tab-1', title: 'Docs home', url: 'https://example.com/docs', active: true },
  { id: 'tab-2', title: 'Inbox – Mail', url: 'https://mail.example.com/inbox', active: false },
];
const LOREM = 'The quasar is a luminous active galactic nucleus powered by a supermassive black hole and this sentence pads the text. '.repeat(3);

describe('SearchSubsystem — end to end through the real address bar', () => {
  let container: HTMLElement;
  let model: AddressBar;
  let view: AddressBarView;
  let input: HTMLInputElement;
  let dropdown: HTMLElement;
  let subsystem: SearchSubsystem;
  type Spy = Mock<(...args: unknown[]) => void>;
  let actions: { [K in keyof OmniboxActions]: Spy };
  let flags: Record<string, boolean | string>;
  let incognito: boolean;
  let fetchJson: Mock<(url: string, signal: AbortSignal) => Promise<unknown>>;
  let warm: Mock<(host: string) => void>;
  let storage: MemoryIndexStorage;

  const deps = (): SearchSubsystemDeps => ({
    settings: () => ({
      getBoolean: (k, f = false) => (typeof flags[k] === 'boolean' ? (flags[k] as boolean) : f),
      getString: (k, f = '') => (typeof flags[k] === 'string' ? (flags[k] as string) : f),
    }),
    history: () => ({
      query: async ({ query = '', maxResults = 10 }) => ({
        entries: HISTORY.filter((e) => `${e.title} ${e.url}`.toLowerCase().includes(query.toLowerCase())).slice(0, maxResults),
      }),
    }),
    bookmarks: () => ({ search: async (q) => BOOKMARKS.filter((b) => b.title.toLowerCase().includes(q.toLowerCase())) }),
    listTabs: () => TABS,
    isIncognito: () => incognito,
    defaultEngine: () => ({ name: 'Nova', searchUrl: (q) => `nova://search?q=${encodeURIComponent(q)}` }),
    normalizeUrl: (raw) => (/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`),
    fetchJson,
    archiveStorage: storage,
    warmHost: warm,
  });

  const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };
  const type = async (value: string, wait = 0) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle(wait);
  };
  const key = (k: string, init: KeyboardEventInit = {}) =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  const rowTexts = () => [...dropdown.querySelectorAll('.nova-dropdown-item')].map((r) => r.querySelector('.nova-dropdown-item__text')!.textContent);
  const rowTypes = () => [...dropdown.querySelectorAll<HTMLElement>('.nova-dropdown-item')].map((r) => r.dataset.type);
  const headers = () => [...dropdown.querySelectorAll('.nova-dropdown-header')].map((h) => h.textContent);

  beforeEach(() => {
    vi.useFakeTimers();
    flags = {};
    incognito = false;
    storage = new MemoryIndexStorage();
    fetchJson = vi.fn<(url: string, signal: AbortSignal) => Promise<unknown>>(
      async () => ['react', ['react hooks', 'react router', 'React']],
    );
    warm = vi.fn<(host: string) => void>();
    container = document.createElement('div');
    document.body.appendChild(container);
    model = new AddressBar();
    view = new AddressBarView(model);
    view.attach(container);
    input = container.querySelector('input')!;
    dropdown = container.querySelector('.nova-dropdown')!;
    input.focus();
    const spy = (): Spy => vi.fn<(...args: unknown[]) => void>();
    actions = { open: spy(), search: spy(), switchTab: spy(), runAction: spy(), research: spy(), copy: spy(), fill: spy() };
    subsystem = new SearchSubsystem(deps());
    subsystem.attach(model, view, {
      ...actions,
      fill: (text: string) => { actions.fill(text); view.fill(text); },
    } as unknown as OmniboxActions);
  });

  afterEach(() => {
    subsystem.dispose();
    view.dispose();
    container.remove();
    vi.useRealTimers();
  });

  describe('as-you-type results', () => {
    it('ranks a frecent page first for a prefix, then the search row, in sections', async () => {
      await type('git');
      expect(rowTexts().slice(0, 2)).toEqual(['GitHub', 'git']);
      expect(headers()).toContain('Suggestions');
      expect(headers()[0]).toBe('Bookmarks & history');
    });

    it('shows an instant answer first for a calculation, and an instant color swatch', async () => {
      await type('2+2');
      expect(rowTypes()[0]).toBe('answer');
      expect(rowTexts()[0]).toBe('4');
      await type('#ff5500');
      expect(dropdown.querySelector('.nova-dropdown-swatch')).not.toBeNull();
    });

    it('keeps the search row and answers even when history is plentiful (one shared score scale)', async () => {
      await type('h'); // matches both history entries and more
      expect(rowTypes()).toContain('search');
    });

    it('adds remote suggestions after the debounce without delaying the local rows', async () => {
      await type('react');
      expect(rowTexts()).toEqual(['react']); // local rows are already there
      expect(fetchJson).not.toHaveBeenCalled();
      await settle(130);
      expect(fetchJson).toHaveBeenCalledTimes(1);
      expect(fetchJson.mock.calls[0]![0]).toContain('duckduckgo.com/ac/?q=react');
      expect(rowTexts()).toEqual(expect.arrayContaining(['react', 'react hooks', 'react router']));
    });

    it('never asks the network in incognito, with suggestions switched off, or for URLs/bangs/scopes', async () => {
      incognito = true;
      await type('react', 500);
      incognito = false;
      flags[SEARCH_SETTINGS.suggestions] = false;
      await type('reactor', 500);
      flags[SEARCH_SETTINGS.suggestions] = true;
      for (const q of ['github.com/pulls', '!g cats', '@tabs inbox', '2+2']) await type(q, 500);
      expect(fetchJson).not.toHaveBeenCalled();
    });

    it('uses the configured suggestions provider', async () => {
      flags[SEARCH_SETTINGS.suggestionsEngine] = 'brave';
      await type('react', 130);
      expect(fetchJson.mock.calls[0]![0]).toContain('search.brave.com/api/suggest?q=react');
    });

    it('completes bangs and scopes while they are typed', async () => {
      await type('!yt');
      expect(rowTexts()[0]).toBe('!yt');
      await type('@');
      expect(rowTexts()).toEqual(['@tabs', '@history', '@bookmarks', '@archive', '@ai', '@research']);
    });

    it('lists open tabs (including the current one) for a bare @tabs and filters them as you type', async () => {
      await type('@tabs');
      expect(rowTexts()).toEqual(['Docs home', 'Inbox – Mail']);
      await type('@tabs inbox');
      expect(rowTexts()).toEqual(['Inbox – Mail']);
    });

    it('searches history and bookmarks by scope', async () => {
      await type('@history hacker');
      expect(rowTexts()).toEqual(['Hacker News']);
      await type('@bookmarks rust');
      expect(rowTexts()).toEqual(['Rust Book']); // folders are never offered
    });

    it('offers a "switch to tab" row for a matching open tab', async () => {
      await type('inbox');
      expect(rowTypes()).toContain('tab');
    });

    it('offers browser commands', async () => {
      await type('open sett');
      expect(rowTexts()).toContain('Open settings');
    });

    it('hides the dropdown when the box is emptied', async () => {
      await type('git');
      expect(dropdown.style.display).toBe('block');
      await type('');
      expect(dropdown.style.display).toBe('none');
    });
  });

  describe('Enter', () => {
    it('opens a frecent page when its title starts with what was typed', async () => {
      await type('git');
      key('Enter');
      expect(actions.open).toHaveBeenCalledWith('https://github.com/', { newTab: false });
      expect(actions.search).not.toHaveBeenCalled();
    });

    it('searches the default engine for ordinary text', async () => {
      await type('how to bake bread');
      key('Enter');
      expect(actions.search).toHaveBeenCalledWith('how to bake bread', { newTab: false });
    });

    it('goes to typed URLs, stripped of trackers', async () => {
      await type('example.com/a?utm_source=x&id=2');
      key('Enter');
      expect(actions.open).toHaveBeenCalledWith('https://example.com/a?id=2', { newTab: false });
    });

    it('resolves bangs', async () => {
      await type('!g quantum computing');
      key('Enter');
      expect(actions.open).toHaveBeenCalledWith('https://www.google.com/search?q=quantum%20computing', { newTab: false });
    });

    it('Alt+Enter asks for a new tab', async () => {
      await type('how to bake bread');
      key('Enter', { altKey: true });
      expect(actions.search).toHaveBeenCalledWith('how to bake bread', { newTab: true });
    });

    it('arrowing to a tab row and pressing Enter switches to that tab', async () => {
      await type('inbox');
      const tabRowIndex = rowTypes().indexOf('tab');
      for (let i = 0; i <= tabRowIndex; i++) key('ArrowDown');
      key('Enter');
      expect(actions.switchTab).toHaveBeenCalledWith('tab-2');
    });

    it('selecting an instant answer copies it', async () => {
      await type('2+2');
      key('ArrowDown');
      key('Enter');
      expect(actions.copy).toHaveBeenCalledWith('4');
    });

    it('runs an exact browser command', async () => {
      await type('open settings');
      key('Enter');
      expect(actions.runAction).toHaveBeenCalledWith('open-settings');
    });

    it('starts research for @ai', async () => {
      await type('@ai how do tides work');
      key('Enter');
      expect(actions.research).toHaveBeenCalledWith('how do tides work');
    });

    it('Tab completes a bang and the scope hints without submitting', async () => {
      await type('!yt');
      key('Tab');
      expect(input.value).toBe('!yt ');
      expect(actions.open).not.toHaveBeenCalled();
    });

    it('does not reopen the dropdown after a submission', async () => {
      await type('git');
      key('Enter');
      await settle(500);
      expect(dropdown.style.display).toBe('none');
    });
  });

  describe('speculative warm-up', () => {
    it('warms the host of the row Enter would take, once', async () => {
      await type('git');
      await type('gith');
      expect(warm).toHaveBeenCalledTimes(1);
      expect(warm).toHaveBeenCalledWith('github.com');
    });

    it('does nothing in incognito', async () => {
      incognito = true;
      await type('git');
      expect(warm).not.toHaveBeenCalled();
    });
  });

  describe('personal archive', () => {
    const page = () => new DomTree().buildFromHtml(new HtmlParser().parse(`<html><body><h1>Quasar notes</h1><p>${LOREM}</p></body></html>`).document);

    it('indexes only when the user opted in, then surfaces pages in the omnibox', async () => {
      expect(subsystem.indexPage('https://astro.example.com/quasars', page())).toBe(false); // off by default
      flags[SEARCH_SETTINGS.archive] = true;
      expect(subsystem.indexPage('https://astro.example.com/quasars', page())).toBe(true);
      await settle(5);
      expect(subsystem.archive.stats().documents).toBe(1);
      await type('quasar nucleus');
      expect(rowTypes()).toContain('archive');
      expect(dropdown.querySelector('.nova-dropdown-item[data-type="archive"] .nova-dropdown-item__desc b')).not.toBeNull();
      await type('@archive quasar');
      expect(rowTypes()).toEqual(['archive']);
    });

    it('never indexes or shows archive rows in incognito, or for non-web pages', async () => {
      flags[SEARCH_SETTINGS.archive] = true;
      incognito = true;
      expect(subsystem.indexPage('https://astro.example.com/quasars', page())).toBe(false);
      incognito = false;
      expect(subsystem.indexPage('nova://settings', page())).toBe(false);
      subsystem.archive.indexNow({
        url: 'https://astro.example.com/q', title: 'Quasar', headings: [], description: '', body: LOREM, visitedAt: NOW,
      });
      incognito = true;
      await type('quasar nucleus');
      expect(rowTypes()).not.toContain('archive');
    });

    it('skips pages with password fields', () => {
      flags[SEARCH_SETTINGS.archive] = true;
      const login = new DomTree().buildFromHtml(new HtmlParser().parse(`<html><body><form><input type="password"></form><p>${LOREM}</p></body></html>`).document);
      expect(subsystem.indexPage('https://bank.example.com/login', login)).toBe(false);
    });
  });

  it('TypedSearchProvider offers a search row only for non-URL text', () => {
    const p = new TypedSearchProvider(() => ({ name: 'Nova', searchUrl: (q) => `nova://search?q=${q}` }));
    expect(p.getSuggestions('hello world')[0]).toMatchObject({
      type: 'search', text: 'hello world', description: 'Search Nova for "hello world"', url: 'nova://search?q=hello world', score: 98, action: 'search',
    });
    expect(p.getSuggestions('github.com')).toEqual([]);
    expect(p.getSuggestions('https://example.com/x')).toEqual([]);
    expect(p.getSuggestions('  ')).toEqual([]);
  });

  it('disposes without leaving timers or listeners behind', async () => {
    await type('react');
    subsystem.dispose();
    await settle(1000);
    expect(fetchJson).not.toHaveBeenCalled();
  });
});
