import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mock } from 'vitest';
import { AddressBar } from '../src/ui/components/address-bar/address-bar';
import { AddressBarView } from '../src/ui/components/address-bar/address-bar.view';
import { SearchIntegration, HOST_ACTION_IDS, novaSearchUrl } from '../src/ui/pages/search-integration';
import type { SearchHost, HostEngine } from '../src/ui/pages/search-integration';
import { SearchPage } from '../src/ui/pages/search-page';
import { BrowserWindowPage } from '../src/ui/pages/browser-window';
import { FindInPage } from '../src/browser/navigation-controls/find-in-page';
import { NavigationController } from '../src/browser/navigation/navigation-controller';
import { RouteType } from '../src/browser/navigation/router';
import { UrlParser } from '../src/browser/navigation/url-parser';
import { HtmlParser } from '../src/browser/rendering/html-parser';
import { DomTree } from '../src/browser/rendering/dom-tree';
import { SettingsService } from '../src/browser/storage/settings-service';
import { SettingsStore } from '../src/browser/storage/settings-store';
import type { HistoryEntry } from '../src/browser/omnibox/history-suggestions';

const TABS = [
  { id: 'tab-1', title: 'Docs home', url: 'https://example.com/docs', active: true },
  { id: 'tab-2', title: 'Inbox – Mail', url: 'https://mail.example.com/inbox', active: false },
];

/** A rendered page, as far as find-in-page can tell: a bitmap canvas in the content area. */
function addPageCanvas(area: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  area.appendChild(canvas);
  return canvas;
}

function pressFind(init: KeyboardEventInit = { ctrlKey: true }): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(event);
  return event;
}

const NOVA: HostEngine = { name: 'Nova', url: 'nova://search?q=%s', keyword: 'nova' };
const GOOGLE: HostEngine = { name: 'Google', url: 'https://www.google.com/search?q=%s', keyword: 'g' };
const DDG: HostEngine = { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', keyword: 'ddg' };

/** A page whose <head> advertises OpenSearch descriptors (`links` are `[href, title?]`). */
const pageAdvertising = (...links: Array<[string, string?]>) => new DomTree().buildFromHtml(new HtmlParser().parse(
  `<html><head>${links.map(([href, title]) =>
    `<link rel="search" type="application/opensearchdescription+xml" href="${href}"${title ? ` title="${title}"` : ''}>`).join('')}</head><body><p>hi</p></body></html>`,
).document);

const openSearchXml = (inner: string) =>
  `<?xml version="1.0"?><OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">${inner}</OpenSearchDescription>`;

const COOKING_PAGE = 'https://cooking.example.org/recipes';
const COOKING_DESCRIPTOR = 'https://cooking.example.org/opensearch.xml';
/** Uses a required (`{count}`) and an optional (`{startPage?}`) extra placeholder next to `{searchTerms}`. */
const COOKING_XML = openSearchXml(
  '<ShortName>Example Cooking</ShortName>'
  + '<Url type="text/html" method="get" template="https://cooking.example.org/find?q={searchTerms}&amp;page={startPage?}&amp;n={count}"/>',
);
/** The engine the cooking descriptor becomes: `{searchTerms}` → `%s`, the extras at their OpenSearch defaults. */
const COOKING_TEMPLATE = 'https://cooking.example.org/find?q=%s&page=&n=10';

describe('novaSearchUrl / HOST_ACTION_IDS', () => {
  it('builds the Nova search page URL, encoding the query', () => {
    expect(novaSearchUrl('a b&c')).toBe('nova://search?q=a%20b%26c');
    expect(novaSearchUrl('')).toBe('nova://search?q=');
  });

  it('offers only commands the window can run', () => {
    expect([...HOST_ACTION_IDS].sort()).toEqual([
      'clear-browsing-data', 'close-tab', 'new-tab', 'open-bookmarks', 'open-downloads', 'open-history',
      'open-settings', 'reload-page',
    ]);
  });
});

describe('SearchIntegration (fake host)', () => {
  let bar: HTMLElement;
  let area: HTMLElement;
  let model: AddressBar;
  let view: AddressBarView;
  let input: HTMLInputElement;
  let dropdown: HTMLElement;
  let flags: Record<string, boolean | string>;
  let engines: HostEngine[];
  let defaultEngine: HostEngine;
  let historyEntries: HistoryEntry[];
  let incognito: boolean;
  /** What the fake network serves for a descriptor URL; anything else fails like a 404. */
  let descriptors: Record<string, string>;
  let host: SearchHost & {
    open: Mock<(url: string, newTab: boolean) => void>;
    switchTab: Mock<(id: string) => void>;
    reload: Mock<() => void>;
    closeActiveTab: Mock<() => void>;
    deleteHistoryEntry: Mock<(id: string) => Promise<void>>;
    addEngine: Mock<(engine: HostEngine) => boolean>;
    fetchText: Mock<(url: string, signal: AbortSignal) => Promise<string>>;
  };
  let search: SearchIntegration;

  const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };
  const type = async (value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  const key = (k: string, init: KeyboardEventInit = {}) =>
    input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  const rowTypes = () => [...dropdown.querySelectorAll<HTMLElement>('.nova-dropdown-item')].map((r) => r.dataset.type);
  const submit = async (text: string) => { await type(text); key('Enter'); await settle(); };

  beforeEach(() => {
    vi.useFakeTimers();
    flags = { enableSearchSuggestions: false }; // no network in tests
    engines = [NOVA, GOOGLE, DDG];
    defaultEngine = NOVA;
    historyEntries = [];
    incognito = false;
    descriptors = {};
    bar = document.createElement('div');
    area = document.createElement('div');
    document.body.append(bar, area);
    model = new AddressBar();
    view = new AddressBarView(model);
    view.attach(bar);
    input = bar.querySelector('input')!;
    dropdown = bar.querySelector('.nova-dropdown')!;
    input.focus();

    host = {
      addressBar: () => model,
      addressBarView: () => view,
      contentArea: () => area,
      settings: () => ({
        getBoolean: (k, f = false) => (typeof flags[k] === 'boolean' ? (flags[k] as boolean) : f),
        getString: (k, f = '') => (typeof flags[k] === 'string' ? (flags[k] as string) : f),
        setValue: (k, v) => { flags[k] = v as boolean | string; },
      }),
      history: () => ({
        query: async ({ query = '' }) => ({
          entries: historyEntries.filter((e) => `${e.title} ${e.url}`.toLowerCase().includes(query.toLowerCase())),
        }),
      }),
      bookmarks: () => null,
      listTabs: () => TABS,
      isIncognito: () => incognito,
      defaultEngine: () => defaultEngine,
      engines: () => engines,
      normalizeUrl: (raw) => (/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`),
      open: vi.fn<(url: string, newTab: boolean) => void>(),
      switchTab: vi.fn<(id: string) => void>(),
      reload: vi.fn<() => void>(),
      closeActiveTab: vi.fn<() => void>(),
      deleteHistoryEntry: vi.fn(async (id: string) => { historyEntries = historyEntries.filter((e) => e.id !== id); }),
      // Like the window: refuses a name or keyword that is taken, otherwise appends and tells the integration.
      addEngine: vi.fn((engine: HostEngine) => {
        if (engines.some((e) => e.name.toLowerCase() === engine.name.toLowerCase() || e.keyword === engine.keyword)) return false;
        engines = [...engines, engine];
        search.onEnginesChanged();
        return true;
      }),
      fetchJson: async () => [],
      fetchText: vi.fn(async (url: string) => {
        const xml = descriptors[url];
        if (xml === undefined) throw new Error('descriptor HTTP 404');
        return xml;
      }),
    };
    search = new SearchIntegration(host);
    search.install();
  });

  afterEach(() => {
    search.dispose();
    view.dispose();
    bar.remove();
    area.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('address bar → window actions', () => {
    it('sends plain text to Nova search', async () => {
      await submit('hello world');
      expect(host.open).toHaveBeenCalledWith('nova://search?q=hello%20world', false);
    });

    it('sends plain text to whichever engine the window says is the default', async () => {
      defaultEngine = GOOGLE;
      await submit('hello world');
      expect(host.open).toHaveBeenCalledTimes(1);
      expect(host.open).toHaveBeenCalledWith('https://www.google.com/search?q=hello%20world', false);
    });

    describe('the keywords of the user\'s engines are !bangs', () => {
      it('works for engines present when the address bar was set up, even with another default', async () => {
        defaultEngine = GOOGLE;
        await submit('!ddg cats');
        expect(host.open).toHaveBeenLastCalledWith('https://duckduckgo.com/?q=cats', false);
        await submit('!nova cats'); // Nova's own search is reachable whatever the default is
        expect(host.open).toHaveBeenLastCalledWith('nova://search?q=cats', false);
      });

      it('picks up engines added later, and forgets removed ones', async () => {
        const example: HostEngine = { name: 'Example', url: 'https://example.com/s?q=%s', keyword: 'ex' };
        await submit('!ex cats');
        expect(host.open).toHaveBeenLastCalledWith('nova://search?q=!ex%20cats', false); // unknown: just a search

        engines = [...engines, example];
        search.onEnginesChanged();
        await submit('!ex cats');
        expect(host.open).toHaveBeenLastCalledWith('https://example.com/s?q=cats', false);

        engines = [NOVA];
        search.onEnginesChanged();
        await submit('!ex cats');
        expect(host.open).toHaveBeenLastCalledWith('nova://search?q=!ex%20cats', false);
      });

      it('lets a user engine override a built-in bang of the same keyword', async () => {
        engines = [NOVA, { name: 'My G', url: 'https://mine.example/?q=%s', keyword: 'g' }];
        search.onEnginesChanged();
        await submit('!g cats');
        expect(host.open).toHaveBeenLastCalledWith('https://mine.example/?q=cats', false);
      });
    });

    it('opens typed addresses after normalising them', async () => {
      await submit('example.com');
      expect(host.open).toHaveBeenCalledWith('https://example.com', false);
    });

    it('hands "@ai" questions to the research page', async () => {
      await submit('@ai quantum computing');
      expect(host.open).toHaveBeenCalledWith('nova://research?q=quantum%20computing', false);
    });

    it.each([
      ['open settings', 'nova://settings', false],
      ['open downloads', 'nova://downloads', false],
      ['open history', 'nova://history', false],
      ['open bookmarks', 'nova://bookmarks', false],
      ['clear browsing data', 'nova://settings', false],
      ['new tab', 'about:newtab', true],
    ])('runs the "%s" command by opening %s', async (command, url, newTab) => {
      await submit(command);
      expect(host.open).toHaveBeenCalledWith(url, newTab);
    });

    it('closes and reloads the current tab on command', async () => {
      await submit('close tab');
      expect(host.closeActiveTab).toHaveBeenCalledTimes(1);
      await submit('reload page');
      expect(host.reload).toHaveBeenCalledTimes(1);
    });

    it('does not offer commands the window cannot run', async () => {
      for (const text of ['print page', 'new incognito window', 'toggle full screen', 'inspect element']) {
        await type(text);
        expect(rowTypes()).not.toContain('action');
      }
    });

    it('switches to an already-open tab from the dropdown', async () => {
      await type('inbox');
      const row = dropdown.querySelector<HTMLElement>('.nova-dropdown-item[data-type="tab"]')!;
      expect(row).not.toBeNull();
      row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      expect(host.switchTab).toHaveBeenCalledWith('tab-2');
      expect(host.open).not.toHaveBeenCalled();
    });
  });

  describe('query-type badge', () => {
    const badge = () => bar.querySelector<HTMLElement>('.nova-addressbar-badge')!;

    it.each([
      ['hello world', 'search', '🔍', 'Search'],
      ['example.com', 'url', '🌐', 'Go to this address'],
      ['!g cats', 'bang', '!g', 'Search Google'],
      ['!ddg', 'bang', '!ddg', 'Search DuckDuckGo'],
      ['@tabs inbox', 'scope', '@tabs', 'Search tabs'],
      ['@ai how do tides work', 'ai', '✨', 'Ask Nova AI'],
      ['open settings', 'command', '⚡', 'Browser command'],
      ['2+2', 'calc', '🧮', 'Instant answer'],
    ])('shows what "%s" will do: %s %s', async (text, kind, glyph, title) => {
      await type(text);
      expect(badge().hidden).toBe(false);
      expect(badge().dataset.kind).toBe(kind);
      expect(badge().textContent).toBe(glyph);
      expect(badge().title).toBe(title);
      expect(bar.classList.contains('has-badge')).toBe(true); // the lock icon makes room for it
    });

    it('follows the text as it changes, and shows nothing for empty input or a half-typed @scope', async () => {
      await type('example.com');
      expect(badge().dataset.kind).toBe('url');
      await type('example cats');
      expect(badge().dataset.kind).toBe('search');
      await type('@ta');
      expect(badge().hidden).toBe(true);
      expect(bar.classList.contains('has-badge')).toBe(false);
      await type('!g cats');
      expect(badge().hidden).toBe(false);
      await type('');
      expect(badge().hidden).toBe(true);
    });

    it('is gone once the text is submitted, and when Escape or a blur ends the typing', async () => {
      await type('!g cats');
      key('Enter');
      await settle();
      expect(badge().hidden).toBe(true);
      expect(bar.classList.contains('has-badge')).toBe(false);

      input.focus();
      await type('hello');
      expect(badge().hidden).toBe(false);
      key('Escape');
      expect(badge().hidden).toBe(true);

      input.focus();
      await type('hello');
      input.blur();
      expect(badge().hidden).toBe(true);
    });

    it('picks up an engine added later, so its !bang is badged with the engine name', async () => {
      engines = [...engines, { name: 'Example', url: 'https://example.com/s?q=%s', keyword: 'ex' }];
      search.onEnginesChanged();
      await type('!ex cats');
      expect(badge().textContent).toBe('!ex');
      expect(badge().title).toBe('Search Example');
    });
  });

  describe('dropdown row actions', () => {
    const GITHUB: HistoryEntry = { id: 'h1', url: 'https://github.com/', title: 'GitHub', visitCount: 30, typedCount: 6, lastVisitTime: Date.now() };
    const GITLAB: HistoryEntry = { id: 'h2', url: 'https://gitlab.com/', title: 'GitLab', visitCount: 12, typedCount: 2, lastVisitTime: Date.now() };
    const rowOf = (type: string, text?: string) => [...dropdown.querySelectorAll<HTMLElement>(`.nova-dropdown-item[data-type="${type}"]`)]
      .find((r) => text === undefined || r.querySelector('.nova-dropdown-item__text')!.textContent === text)!;
    const button = (row: HTMLElement, action: string) => row.querySelector<HTMLButtonElement>(`.nova-dropdown-item__action[data-action="${action}"]`);
    const rowTexts = () => [...dropdown.querySelectorAll('.nova-dropdown-item')].map((r) => r.querySelector('.nova-dropdown-item__text')!.textContent);
    let writeText: Mock<(text: string) => Promise<void>>;

    beforeEach(() => {
      historyEntries = [GITHUB, GITLAB];
      writeText = vi.fn(async () => undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    });
    afterEach(() => { Reflect.deleteProperty(navigator, 'clipboard'); });

    it('offers copy on page rows and remove only on history rows', async () => {
      await type('git');
      const gh = rowOf('history', 'GitHub');
      expect(button(gh, 'copy')).not.toBeNull();
      expect(button(gh, 'delete')).not.toBeNull();
      const searchRow = rowOf('search');
      expect(button(searchRow, 'copy')).toBeNull(); // its URL is only a generated query
      expect(button(searchRow, 'delete')).toBeNull();
    });

    it('copies the row\'s link without activating the row or taking focus from the input', async () => {
      await type('git');
      button(rowOf('history', 'GitHub'), 'copy')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(writeText).toHaveBeenCalledWith('https://github.com/');
      expect(host.open).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(input);
      expect(dropdown.style.display).toBe('block');
    });

    it('a press on the button never reaches the row (rows activate on mousedown)', async () => {
      await type('git');
      const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      button(rowOf('history', 'GitHub'), 'delete')!.dispatchEvent(press);
      expect(press.defaultPrevented).toBe(true); // keeps the input from blurring
      expect(host.open).not.toHaveBeenCalled();
      expect(host.deleteHistoryEntry).not.toHaveBeenCalled(); // the click does the work, not the press
    });

    it('removes the history entry and the row disappears from the open dropdown', async () => {
      await type('git');
      expect(rowTexts()).toContain('GitHub');
      button(rowOf('history', 'GitHub'), 'delete')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await settle();
      expect(host.deleteHistoryEntry).toHaveBeenCalledWith('h1');
      expect(rowTexts()).not.toContain('GitHub');
      expect(rowTexts()).toContain('GitLab');
      expect(host.open).not.toHaveBeenCalled();
    });

    const highlight = (text: string) => { // arrows down from wherever the highlight is (none → -1)
      const current = [...dropdown.querySelectorAll('.nova-dropdown-item')].findIndex((r) => r.classList.contains('nova-dropdown-item--selected'));
      for (let i = current; i < rowTexts().indexOf(text); i++) key('ArrowDown');
    };
    const pressDelete = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true, ...init });
      input.dispatchEvent(event);
      return event;
    };

    it('Shift+Delete removes the highlighted history row', async () => {
      await type('git');
      highlight('GitHub');
      expect(input.value).toBe('https://github.com/'); // arrowing onto a row previews it in the input
      const event = pressDelete({ shiftKey: true });
      await settle();
      expect(event.defaultPrevented).toBe(true);
      expect(host.deleteHistoryEntry).toHaveBeenCalledWith('h1');
      expect(rowTexts()).not.toContain('GitHub');
      expect(input.value).toBe('git'); // …and once that row is gone the typed text is back
    });

    it('plain Delete still edits the text, and Shift+Delete on a row that is not history does nothing', async () => {
      await type('git');
      highlight('GitHub');
      expect(pressDelete({}).defaultPrevented).toBe(false);
      highlight('git'); // the typed-search row
      expect(pressDelete({ shiftKey: true }).defaultPrevented).toBe(false);
      await settle();
      expect(host.deleteHistoryEntry).not.toHaveBeenCalled();
    });

    it('does not bring the dropdown back when Enter was pressed while the removal was in flight', async () => {
      let finish!: () => void;
      host.deleteHistoryEntry.mockImplementationOnce(() => new Promise<void>((resolve) => {
        finish = () => { historyEntries = [GITLAB]; resolve(); };
      }));
      await type('git');
      button(rowOf('history', 'GitHub'), 'delete')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      key('Enter');
      await settle();
      finish();
      await settle();
      expect(dropdown.style.display).toBe('none');
    });
  });

  describe('"Add as search engine" offer', () => {
    const chip = () => bar.querySelector<HTMLButtonElement>('.nova-addressbar-offer');
    const advertise = (url = COOKING_PAGE, title: string | undefined = 'Example Cooking', href = '/opensearch.xml') =>
      search.onPageDocumentReady(url, pageAdvertising([href, title]));
    const accept = async () => { chip()!.click(); await settle(); };

    beforeEach(() => { descriptors = { [COOKING_DESCRIPTOR]: COOKING_XML }; });

    describe('offering', () => {
      it('appears for a page that advertises an engine, in the action area, without touching the network', () => {
        advertise();
        expect(chip()!.textContent).toBe('＋ Add Example Cooking');
        expect(chip()!.title).toBe('Add Example Cooking as a search engine');
        expect(chip()!.disabled).toBe(false);
        expect(bar.querySelector('.nova-addressbar-actions')!.firstElementChild).toBe(chip());
        expect(host.fetchText).not.toHaveBeenCalled();
      });

      it('names the site when the link has no title', () => {
        advertise('https://www.cooking.example.org/recipes', '');
        expect(chip()!.textContent).toBe('＋ Add cooking.example.org');
      });

      it('offers the first descriptor when a page advertises several', () => {
        search.onPageDocumentReady(COOKING_PAGE, pageAdvertising(['/a.xml', 'First'], ['/b.xml', 'Second']));
        expect(chip()!.textContent).toBe('＋ Add First');
      });

      it('shows nothing for a page that advertises nothing', () => {
        search.onPageDocumentReady(COOKING_PAGE, pageAdvertising());
        expect(chip()).toBeNull();
      });

      it('shows nothing in a private window', () => {
        incognito = true;
        advertise();
        expect(chip()).toBeNull();
      });

      it.each([['about:blank'], ['nova://settings'], ['file:///C:/pages/recipes.html'], ['data:text/html,x']])('shows nothing on %s', (url) => {
        advertise(url);
        expect(chip()).toBeNull();
      });

      it.each([
        ['https://duckduckgo.com/about'],
        ['https://www.google.com/'],
        ['https://google.com/'], // the engine is on www.; the www. prefix does not make the site different
      ])('shows nothing on %s, which the user already has an engine for', (url) => {
        advertise(url);
        expect(chip()).toBeNull();
      });

      it('offers each site once per session, however often it is visited', () => {
        advertise();
        expect(chip()).not.toBeNull();
        search.onPageLeaving();
        advertise();
        expect(chip()).toBeNull();
        advertise('https://cooking.example.org/other-page');
        expect(chip()).toBeNull();
        search.onPageDocumentReady('https://garden.example.org/', pageAdvertising(['/os.xml', 'Example Garden']));
        expect(chip()!.textContent).toBe('＋ Add Example Garden');
      });

      it('lets a newly loaded page replace the previous page\'s offer', () => {
        advertise();
        search.onPageDocumentReady('https://garden.example.org/', pageAdvertising(['/os.xml', 'Example Garden']));
        expect(bar.querySelectorAll('.nova-addressbar-offer')).toHaveLength(1);
        expect(chip()!.textContent).toBe('＋ Add Example Garden');
      });
    });

    describe('lifecycle', () => {
      it('goes away when the page is left (a navigation starts or another tab is activated)', () => {
        advertise();
        search.onPageLeaving();
        expect(chip()).toBeNull();
      });

      it('survives the content-replaced notice that follows the page\'s document-ready one', () => {
        advertise();
        search.onContentReplaced(); // the engine emits pageLoadReady right after onDocumentReady
        expect(chip()).not.toBeNull();
      });

      it('also ends find-in-page when the page is left', () => {
        addPageCanvas(area);
        pressFind();
        expect(area.querySelector('.nova-find-bar')).not.toBeNull();
        search.onPageLeaving();
        expect(area.querySelector('.nova-find-bar')).toBeNull();
      });

      it('is removed when the integration is disposed', () => {
        advertise();
        search.dispose();
        expect(chip()).toBeNull();
      });
    });

    describe('accepting', () => {
      it('downloads the descriptor, adds the engine with a %s template and a free keyword, then reports it', async () => {
        advertise();
        chip()!.click();
        expect(chip()!.textContent).toBe('Adding…');
        expect(chip()!.dataset.state).toBe('busy');
        expect(chip()!.disabled).toBe(true);
        await settle();

        expect(host.fetchText).toHaveBeenCalledWith(COOKING_DESCRIPTOR, expect.any(AbortSignal));
        expect(host.addEngine).toHaveBeenCalledWith({ name: 'Example Cooking', url: COOKING_TEMPLATE, keyword: 'cook' });
        expect(chip()!.textContent).toBe('Added · !cook');
        expect(chip()!.dataset.state).toBe('done');
        await settle(2500);
        expect(chip()).toBeNull();
      });

      it('makes the keyword a !bang straight away', async () => {
        advertise();
        await accept();
        await submit('!cook pasta');
        expect(host.open).toHaveBeenLastCalledWith('https://cooking.example.org/find?q=pasta&page=&n=10', false);
      });

      it('does not offer the site again once its engine exists', async () => {
        advertise();
        await accept();
        search.onPageLeaving();
        advertise('https://cooking.example.org/again');
        expect(chip()).toBeNull();
      });

      it('picks the next free keyword when the derived one is taken by an engine or by a built-in bang', async () => {
        engines = [...engines, { name: 'Cookbook', url: 'https://cookbook.test/?q=%s', keyword: 'cook' }];
        search.onEnginesChanged();
        advertise();
        await accept();
        expect(host.addEngine).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'cook2' }));

        descriptors['https://yt.example.org/os.xml'] = openSearchXml(
          '<ShortName>Why Tee</ShortName><Url type="text/html" template="https://yt.example.org/s?q={searchTerms}"/>',
        );
        search.onPageDocumentReady('https://yt.example.org/', pageAdvertising(['/os.xml', 'Why Tee']));
        await accept();
        expect(host.addEngine).toHaveBeenLastCalledWith(expect.objectContaining({ keyword: 'yt2' })); // `!yt` is YouTube's built-in bang
      });

      it('ignores the descriptor\'s icon and suggestion URL', async () => {
        descriptors[COOKING_DESCRIPTOR] = openSearchXml(
          '<ShortName>Example Cooking</ShortName><Image>https://cooking.example.org/favicon.ico</Image>'
          + '<Url type="text/html" template="https://cooking.example.org/find?q={searchTerms}"/>'
          + '<Url type="application/x-suggestions+json" template="https://cooking.example.org/suggest?q={searchTerms}"/>',
        );
        advertise();
        await accept();
        expect(host.addEngine).toHaveBeenCalledWith({ name: 'Example Cooking', url: 'https://cooking.example.org/find?q=%s', keyword: 'cook' });
      });
    });

    describe('when it cannot be added', () => {
      const failed = (label: string) => {
        expect(chip()!.textContent).toBe(label);
        expect(chip()!.dataset.state).toBe('failed');
        expect(chip()!.disabled).toBe(true);
        expect(host.addEngine).not.toHaveBeenCalled();
      };

      it("says so when the descriptor cannot be downloaded, and clears the message after a moment", async () => {
        descriptors = {};
        advertise();
        await accept();
        failed("Couldn't add");
        await settle(2500);
        expect(chip()).toBeNull();
      });

      it.each([
        ['is not an OpenSearch document', '<html><body>404 Not Found</body></html>'],
        ['has no GET text/html template', openSearchXml('<ShortName>Post only</ShortName><Url type="text/html" method="post" template="https://cooking.example.org/s?q={searchTerms}"/>')],
        ['has no name', openSearchXml('<Url type="text/html" template="https://cooking.example.org/s?q={searchTerms}"/>')],
      ])('says so when the descriptor %s', async (_why, xml) => {
        descriptors[COOKING_DESCRIPTOR] = xml;
        advertise();
        await accept();
        failed("Couldn't add");
      });

      it('gives up on a download that takes more than 8 seconds', async () => {
        host.fetchText.mockImplementationOnce((_url, signal) => new Promise<string>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }));
        advertise();
        chip()!.click();
        await settle(7999);
        expect(chip()!.textContent).toBe('Adding…');
        await settle(2);
        failed("Couldn't add");
      });

      it('says "Already added" when the engine list refuses it (the name is taken)', async () => {
        engines = [...engines, { name: 'example cooking', url: 'https://old.example/?q=%s', keyword: 'old' }];
        advertise();
        await accept();
        expect(chip()!.textContent).toBe('Already added');
        expect(chip()!.dataset.state).toBe('failed');
        expect(engines).toHaveLength(4); // nothing was added
      });
    });

    describe('while the download is running', () => {
      let release: (xml: string) => void;
      let signal: AbortSignal;
      beforeEach(() => {
        host.fetchText.mockImplementationOnce((_url, s) => new Promise<string>((resolve) => { signal = s; release = resolve; }));
      });

      it('still adds the engine if the user moves on, without bringing the chip back', async () => {
        advertise();
        chip()!.click();
        search.onPageLeaving();
        expect(chip()).toBeNull();
        release(COOKING_XML);
        await settle(); // the download finished; a revived chip would show "Added" for the next 2.5 s
        expect(host.addEngine).toHaveBeenCalledTimes(1);
        expect(engines.map((e) => e.keyword)).toContain('cook');
        expect(chip()).toBeNull();
        await settle(3000);
        expect(chip()).toBeNull();
      });

      it('does not let the finished download overwrite a newer page\'s offer', async () => {
        advertise();
        chip()!.click();
        search.onPageDocumentReady('https://garden.example.org/', pageAdvertising(['/os.xml', 'Example Garden']));
        release(COOKING_XML);
        await settle();
        expect(chip()!.textContent).toBe('＋ Add Example Garden');
      });

      it('is cancelled when the integration is disposed', async () => {
        advertise();
        chip()!.click();
        search.dispose();
        expect(signal.aborted).toBe(true);
      });
    });
  });

  describe('find in page', () => {
    it('Ctrl+F opens the find bar over a rendered page and keeps the browser default away', () => {
      addPageCanvas(area);
      const event = pressFind();
      expect(event.defaultPrevented).toBe(true);
      const findBar = area.querySelector<HTMLElement>('.nova-find-bar')!;
      expect(findBar.hidden).toBe(false);
      expect(getComputedStyle(area).position).not.toBe('static');
    });

    it('Cmd+F works too, and Ctrl+Shift+F / Ctrl+Alt+F are left alone', () => {
      addPageCanvas(area);
      expect(pressFind({ metaKey: true }).defaultPrevented).toBe(true);
      search.onContentReplaced();
      expect(pressFind({ ctrlKey: true, shiftKey: true }).defaultPrevented).toBe(false);
      expect(pressFind({ ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
      expect(area.querySelector('.nova-find-bar')).toBeNull();
    });

    it('does nothing when no web page is rendered (built-in pages, loading, errors)', () => {
      const event = pressFind();
      expect(event.defaultPrevented).toBe(false);
      expect(search.openFindBar()).toBe(false);
      expect(area.querySelector('.nova-find-bar')).toBeNull();
    });

    it('ignores the highlight overlay when deciding whether a page is rendered', () => {
      const overlay = document.createElement('canvas');
      overlay.className = 'nova-find-overlay';
      overlay.width = 100;
      overlay.height = 100;
      area.appendChild(overlay);
      expect(search.openFindBar()).toBe(false);
    });

    it('drops the find bar when the page is replaced, and builds a fresh one on the next Ctrl+F', () => {
      addPageCanvas(area);
      pressFind();
      const first = area.querySelector('.nova-find-bar');
      expect(first).not.toBeNull();
      search.onContentReplaced();
      expect(area.querySelector('.nova-find-bar')).toBeNull();
      pressFind();
      const second = area.querySelector('.nova-find-bar');
      expect(second).not.toBeNull();
      expect(second).not.toBe(first);
    });

    it('re-runs the query after a repaint, but at most once per interval', () => {
      addPageCanvas(area);
      pressFind();
      const box = area.querySelector<HTMLInputElement>('.nova-find-bar input')!;
      box.value = 'nova';
      box.dispatchEvent(new Event('input', { bubbles: true }));

      const refresh = vi.spyOn(FindInPage.prototype, 'refresh');
      for (let i = 0; i < 5; i++) search.onPageRepainted(); // an animated page repaints every frame
      expect(refresh).not.toHaveBeenCalled();
      vi.advanceTimersByTime(150);
      expect(refresh).toHaveBeenCalledTimes(1);
      search.onPageRepainted();
      vi.advanceTimersByTime(150);
      expect(refresh).toHaveBeenCalledTimes(2);
    });

    it('does not schedule work for repaints while the bar is closed', () => {
      addPageCanvas(area);
      const refresh = vi.spyOn(FindInPage.prototype, 'refresh');
      search.onPageRepainted();
      vi.advanceTimersByTime(500);
      expect(refresh).not.toHaveBeenCalled();
    });

    it('F3 steps through matches only while the bar is open', () => {
      addPageCanvas(area);
      const next = vi.spyOn(FindInPage.prototype, 'findNext');
      const previous = vi.spyOn(FindInPage.prototype, 'findPrevious');
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true }));
      expect(next).not.toHaveBeenCalled();

      pressFind();
      const f3 = new KeyboardEvent('keydown', { key: 'F3', bubbles: true, cancelable: true });
      document.body.dispatchEvent(f3);
      expect(f3.defaultPrevented).toBe(true);
      expect(next).toHaveBeenCalledTimes(1);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F3', shiftKey: true, bubbles: true, cancelable: true }));
      expect(previous).toHaveBeenCalledTimes(1);
    });
  });

  describe('nova://search page', () => {
    it('mounts the search page with the query from the URL', () => {
      const panel = document.createElement('div');
      area.appendChild(panel);
      search.renderSearchPage(panel, 'nova://search?q=quasar%20nucleus');
      expect(panel.querySelector('h1')!.textContent).toBe('Nova Search');
      expect(panel.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('quasar nucleus');
    });

    it('tolerates a missing or malformed query', () => {
      const panel = document.createElement('div');
      area.appendChild(panel);
      search.renderSearchPage(panel, 'nova://search');
      expect(panel.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('');
      search.renderSearchPage(panel, 'not a url');
      expect(panel.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('');
    });

    it('replaces the previous instance instead of stacking pages', () => {
      const panel = document.createElement('div');
      area.appendChild(panel);
      const dispose = vi.spyOn(SearchPage.prototype, 'dispose');
      search.renderSearchPage(panel, 'nova://search?q=one');
      search.renderSearchPage(panel, 'nova://search?q=two');
      expect(dispose).toHaveBeenCalledTimes(1);
      expect(panel.querySelectorAll('h1')).toHaveLength(1);
      expect(panel.querySelector<HTMLInputElement>('input[type="search"]')!.value).toBe('two');
    });

    it('searching from the page stays in Nova search, even when another engine is the default', () => {
      defaultEngine = GOOGLE;
      const panel = document.createElement('div');
      area.appendChild(panel);
      search.renderSearchPage(panel, 'nova://search?q=one');
      const box = panel.querySelector<HTMLInputElement>('input[type="search"]')!;
      box.value = 'second query';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(host.open).toHaveBeenCalledWith('nova://search?q=second%20query', false);
    });

    it('offers the user\'s other engines as web shortcuts (not Nova itself)', () => {
      const panel = document.createElement('div');
      area.appendChild(panel);
      search.renderSearchPage(panel, 'nova://search?q=rust%20lifetimes');
      const labels = () => [...panel.querySelectorAll('button')].map((b) => b.textContent);
      expect(labels()).toEqual(expect.arrayContaining(['Google', 'DuckDuckGo']));
      expect(labels()).not.toContain('Nova');

      [...panel.querySelectorAll('button')].find((b) => b.textContent === 'Google')!.click();
      expect(host.open).toHaveBeenLastCalledWith('https://www.google.com/search?q=rust%20lifetimes', false);

      engines = [NOVA, { name: 'Example', url: 'https://example.com/s?q=%s', keyword: 'ex' }];
      search.renderSearchPage(panel, 'nova://search?q=x'); // rendered again: reads the current list
      expect(labels()).toContain('Example');
      expect(labels()).not.toContain('Google');
    });
  });

  it('indexes loaded pages only once the user opted in', async () => {
    const doc = new DomTree().buildFromHtml(new HtmlParser().parse(
      `<html><body><h1>Quasar notes</h1><p>${'The quasar is a luminous galactic nucleus. '.repeat(12)}</p></body></html>`,
    ).document);
    search.onPageDocumentReady('https://astro.example.com/quasars', doc);
    await settle(10);
    expect(search.search!.archive.stats().documents).toBe(0);

    flags.archiveEnabled = true;
    search.onPageDocumentReady('https://astro.example.com/quasars', doc);
    await settle(10);
    expect(search.search!.archive.stats().documents).toBe(1);
  });

  it('stops handling keys once disposed', () => {
    addPageCanvas(area);
    search.dispose();
    expect(pressFind().defaultPrevented).toBe(false);
    expect(area.querySelector('.nova-find-bar')).toBeNull();
  });

  it('does nothing without an address bar to attach to', () => {
    const lonely = new SearchIntegration({ ...host, addressBarView: () => null });
    lonely.install();
    expect(lonely.search).toBeNull();
    lonely.dispose();
  });
});

describe('BrowserWindowPage — search wiring', () => {
  let container: HTMLElement;
  let page: BrowserWindowPage;
  let flags: Record<string, boolean | string>;
  let setValue: Mock<(key: string, value: unknown) => void>;

  const settingsService = () => ({
    getString: (k: string, f = '') => (typeof flags[k] === 'string' ? (flags[k] as string) : f),
    getBoolean: (k: string, f = false) => (typeof flags[k] === 'boolean' ? (flags[k] as boolean) : f),
    getNumber: (_k: string, f = 0) => f,
    getValue: () => undefined,
    setValue,
    init: () => undefined,
  }) as unknown as Parameters<BrowserWindowPage['setSettingsService']>[0];

  const area = () => container.querySelector<HTMLElement>('.content-area')!;
  const heading = () => area().querySelector('h1')?.textContent ?? null;
  const searchBox = () => area().querySelector<HTMLInputElement>('input[type="search"]');
  const settle = async (ms = 0) => { await vi.advanceTimersByTimeAsync(ms); };

  beforeEach(async () => {
    vi.useFakeTimers();
    flags = { enableSearchSuggestions: false }; // no network in tests
    setValue = vi.fn<(key: string, value: unknown) => void>();
    container = document.createElement('div');
    document.body.appendChild(container);
    page = new BrowserWindowPage();
    page.setSettingsService(settingsService());
    await page.mount(container);
  });

  afterEach(async () => {
    await page.unmount();
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('draws nova://search with the query in the URL', async () => {
    await page.navigate('nova://search?q=hello');
    expect(heading()).toBe('Nova Search');
    expect(searchBox()!.value).toBe('hello');
  });

  it('draws it once per navigation and replaces the previous search', async () => {
    await page.navigate('nova://search?q=first');
    await page.navigate('nova://search?q=second');
    expect(area().querySelectorAll('h1')).toHaveLength(1);
    expect(searchBox()!.value).toBe('second');
  });

  it('does not stack the built-in page on top of the previous page', async () => {
    addPageCanvas(area());
    await page.navigate('nova://search?q=hello');
    expect(area().querySelector('canvas')).toBeNull();
  });

  it('typing a question in the address bar lands on Nova search', async () => {
    const box = container.querySelector<HTMLInputElement>('.nova-addressbar-input')!;
    box.focus();
    box.value = 'hello world';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(heading()).toBe('Nova Search');
    expect(searchBox()!.value).toBe('hello world');
    expect(box.value).toContain('nova://search?q=hello');
  });

  it('typing a built-in address renders that page (the address bar used to bypass page rendering)', async () => {
    const box = container.querySelector<HTMLInputElement>('.nova-addressbar-input')!;
    box.focus();
    box.value = 'nova://settings';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle();
    expect(area().querySelector('.settings-page')).not.toBeNull();
  });

  it('draws built-in pages for navigations that do not go through navigate() (tabs, back/forward, reload)', async () => {
    const controller = new NavigationController(new UrlParser());
    page.setNavigationController(controller);
    await controller.navigate('nova://search?q=alpha');
    expect(searchBox()!.value).toBe('alpha');

    await controller.navigate('nova://settings');
    expect(area().querySelector('.settings-page')).not.toBeNull();
    expect(heading()).not.toBe('Nova Search');

    page.goBack();
    expect(searchBox()!.value).toBe('alpha');
    expect(area().querySelector('.settings-page')).toBeNull();

    page.goForward();
    expect(area().querySelector('.settings-page')).not.toBeNull();

    page.goBack();
    page.reload();
    await settle();
    expect(area().querySelectorAll('h1')).toHaveLength(1);
    expect(searchBox()!.value).toBe('alpha');
  });

  it('a tab opened on nova://search shows it', async () => {
    page.createTab('nova://search?q=newtab');
    await settle();
    expect(searchBox()!.value).toBe('newtab');
  });

  describe('start screen and the engine', () => {
    type Handler = (event: unknown) => void;
    /** An engine + paint engine pair: enough for the window to build its real NavigationFetcher. */
    const withEngine = () => {
      const handlers: Record<string, Handler[]> = {};
      const engine = {
        on: (type: string, h: Handler) => { (handlers[type] ??= []).push(h); },
        off: (type: string, h: Handler) => { handlers[type] = (handlers[type] ?? []).filter((x) => x !== h); },
      } as unknown as Parameters<BrowserWindowPage['setBrowserEngine']>[0];
      const paint = { rasterize: () => ({ width: 4, height: 4, data: new Uint8ClampedArray(64) }) } as unknown as Parameters<BrowserWindowPage['setPaintEngine']>[0];
      page.setBrowserEngine(engine);
      page.setPaintEngine(paint);
      const ready = (type: RouteType, url: string) => {
        for (const h of handlers.pageLoadReady ?? []) h({ kind: 'pageLoadReady', elapsedMs: 1, session: { entry: { url }, routeResult: { type, pageId: 'p', title: 't' } } });
      };
      return { ready };
    };

    it('keeps the start screen when a tab commits its initial about:blank', async () => {
      await settle();
      expect(area().children.length).toBeGreaterThan(0);
      expect(area().textContent).toContain('Search the web or enter a URL');
    });

    it('an explicit navigation to about:blank clears the page', async () => {
      await page.navigate('nova://search?q=hello');
      await page.navigate('about:blank');
      expect(area().children).toHaveLength(0);
    });

    it('a built-in page survives the engine reporting its (empty) load as ready', async () => {
      const { ready } = withEngine();
      await page.navigate('nova://search?q=hello');
      ready(RouteType.InternalPage, 'nova://search?q=hello');
      expect(heading()).toBe('Nova Search');
      expect(area().querySelector('canvas')).toBeNull();

      await page.navigate('nova://settings');
      ready(RouteType.InternalPage, 'nova://settings');
      expect(area().querySelector('.settings-page')).not.toBeNull();
    });

    it('a web page replaces the built-in page when the engine has rendered it', async () => {
      const { ready } = withEngine();
      await page.navigate('nova://search?q=hello');
      ready(RouteType.WebContent, 'https://example.com/');
      expect(area().querySelector('canvas')).not.toBeNull();
      expect(heading()).toBeNull();
    });
  });

  it('releases the built-in page when navigating to a web page', async () => {
    const dispose = vi.spyOn(SearchPage.prototype, 'dispose');
    await page.navigate('nova://search?q=hello');
    await page.navigate('https://example.com/');
    expect(dispose).toHaveBeenCalled();
    expect(area().querySelector('h1')?.textContent).not.toBe('Nova Search');
  });

  describe('nova://research', () => {
    it('starts researching the query carried by the URL', async () => {
      const research = vi.fn(async () => undefined);
      page.setResearchService({
        state: { status: 'idle' }, research, cancel: () => undefined, on: () => undefined,
      } as unknown as Parameters<BrowserWindowPage['setResearchService']>[0]);
      await page.navigate('nova://research?q=quantum%20computing');
      expect(research).toHaveBeenCalledWith('quantum computing', expect.anything());
    });

    it('opens the research page empty when no query is given', async () => {
      const research = vi.fn(async () => undefined);
      page.setResearchService({
        state: { status: 'idle' }, research, cancel: () => undefined, on: () => undefined,
      } as unknown as Parameters<BrowserWindowPage['setResearchService']>[0]);
      await page.navigate('nova://research');
      expect(area().querySelector('.research-page')).not.toBeNull();
      expect(research).not.toHaveBeenCalled();
    });
  });

  describe('default search engine', () => {
    it('is Nova', () => {
      expect(page.getChromeState().searchTemplate).toBe('nova://search?q=%s');
    });

    it('follows the Settings value, falling back to Nova for unknown engines', () => {
      flags.defaultSearchEngine = 'bing';
      expect(page.getChromeState().searchTemplate).toBe('https://www.bing.com/search?q=%s');
      flags.defaultSearchEngine = 'nova';
      expect(page.getChromeState().searchTemplate).toBe('nova://search?q=%s');
      flags.defaultSearchEngine = 'gone';
      expect(page.getChromeState().searchTemplate).toBe('nova://search?q=%s');
    });

    it('is what the new tab page searches with', async () => {
      await page.navigate('about:newtab');
      const box = area().querySelector<HTMLInputElement>('input[type="text"]')!;
      box.value = 'cats';
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await settle();
      expect(heading()).toBe('Nova Search');
      expect(searchBox()!.value).toBe('cats');
    });
  });

  describe('search engines from Settings drive the address bar', () => {
    const addressValue = () => page.getChromeState().addressValue;

    const submitInAddressBar = async (text: string) => {
      const box = container.querySelector<HTMLInputElement>('.nova-addressbar-input')!;
      box.focus();
      box.value = text;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await settle();
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      await settle();
    };

    /** A fresh window on a real settings store, in the app's order: mount first, settings service after. */
    const restart = async (store: SettingsStore) => {
      await page.unmount();
      page = new BrowserWindowPage();
      await page.mount(container);
      page.setSettingsService(new SettingsService(store));
    };

    const openEngineSettings = async () => {
      await page.navigate('nova://settings');
      const settings = page.getActiveSettingsPage()!;
      settings.setActiveSection('search-engines');
      settings.updateSections(settings.sections);
    };

    const addEngine = (name: string, url: string, keyword: string) => {
      container.querySelector<HTMLInputElement>('.search-engine-name-input')!.value = name;
      container.querySelector<HTMLInputElement>('.search-engine-url-input')!.value = url;
      container.querySelector<HTMLInputElement>('.search-engine-keyword-input')!.value = keyword;
      container.querySelector<HTMLElement>('.search-engine-add-btn')!.click();
    };

    it('an engine added in Settings works as a !bang straight away', async () => {
      await restart(new SettingsStore());
      await openEngineSettings();
      addEngine('Example', 'https://example.com/search?q=%s', 'ex');
      await submitInAddressBar('!ex cats');
      expect(addressValue()).toBe('https://example.com/search?q=cats');
    });

    it('built-in engine keywords are bangs too, with Nova still the default', async () => {
      await restart(new SettingsStore());
      await submitInAddressBar('!ddg cats');
      expect(addressValue()).toBe('https://duckduckgo.com/?q=cats');
      await submitInAddressBar('plain words');
      expect(addressValue()).toBe('nova://search?q=plain%20words');
    });

    it('"Set default" changes where plain searches go, and the choice is saved', async () => {
      const store = new SettingsStore();
      await restart(store);
      await openEngineSettings();
      const googleRow = [...container.querySelectorAll<HTMLElement>('.search-engine-row')].find((r) => r.textContent?.includes('Google'))!;
      googleRow.querySelector<HTMLElement>('.search-engine-default-btn')!.click();
      expect(store.get('defaultSearchEngine')).toBe('google');
      await submitInAddressBar('hello world');
      expect(addressValue()).toBe('https://www.google.com/search?q=hello%20world');
    });

    it('the chosen default survives leaving the Settings page (settings used to read as defaults afterwards)', async () => {
      await restart(new SettingsStore());
      await openEngineSettings();
      const googleRow = [...container.querySelectorAll<HTMLElement>('.search-engine-row')].find((r) => r.textContent?.includes('Google'))!;
      googleRow.querySelector<HTMLElement>('.search-engine-default-btn')!.click();

      await page.navigate('about:newtab'); // closes Settings; the new-tab page re-reads the setting
      expect(area().querySelector('.ntp-engine-btn')!.textContent).toBe('Google');
      await submitInAddressBar('hello world');
      expect(addressValue()).toBe('https://www.google.com/search?q=hello%20world');
    });

    it('a removed engine\'s keyword stops being a bang', async () => {
      const removeRow = (marker: string) => {
        const row = [...container.querySelectorAll<HTMLElement>('.search-engine-row')].find((r) => r.textContent?.includes(marker))!;
        row.querySelector<HTMLElement>('.search-engine-remove-btn')!.click();
      };
      await restart(new SettingsStore());
      await openEngineSettings();
      addEngine('Zed', 'https://zed.example/?q=%s', 'zz');
      await submitInAddressBar('!zz cats');
      expect(addressValue()).toBe('https://zed.example/?q=cats');

      await openEngineSettings();
      removeRow('!zz');
      await submitInAddressBar('!zz cats');
      expect(addressValue()).toBe('nova://search?q=!zz%20cats');

      // Removing a built-in engine only edits the user's list: `!ddg` stays one of the catalogue's bangs.
      await openEngineSettings();
      removeRow('!ddg');
      await submitInAddressBar('!ddg cats');
      expect(addressValue()).toBe('https://duckduckgo.com/?q=cats');
    });

    it('engines saved by an earlier run come back as bangs after a restart', async () => {
      const store = new SettingsStore();
      store.set('searchEngines', [
        { name: 'Nova', url: 'nova://search?q=%s', keyword: 'nova' },
        { name: 'Zed', url: 'https://zed.example/?q=%s', keyword: 'zz' },
      ]);
      await restart(store);
      await submitInAddressBar('!zz cats');
      expect(addressValue()).toBe('https://zed.example/?q=cats');
    });

    describe('an engine a page advertises', () => {
      const chip = () => container.querySelector<HTMLButtonElement>('.nova-addressbar-offer');
      const advertiseCooking = () => page.onPageDocumentReady(COOKING_PAGE, pageAdvertising(['/opensearch.xml', 'Example Cooking']));
      let fetchSpy: Mock<(url: string, init?: RequestInit) => Promise<{ ok: boolean; text: () => Promise<string> }>>;

      beforeEach(() => {
        fetchSpy = vi.fn(async () => ({ ok: true, text: async () => COOKING_XML }));
        vi.stubGlobal('fetch', fetchSpy);
      });
      afterEach(() => { vi.unstubAllGlobals(); });

      it('is added with one click: it shows up in Settings, is saved, and works as a !bang', async () => {
        const store = new SettingsStore();
        await restart(store);

        advertiseCooking();
        expect(chip()!.textContent).toBe('＋ Add Example Cooking');
        expect(fetchSpy).not.toHaveBeenCalled();
        chip()!.click();
        await settle();
        expect(fetchSpy).toHaveBeenCalledWith(COOKING_DESCRIPTOR, expect.objectContaining({ credentials: 'omit' }));
        expect(chip()!.textContent).toBe('Added · !cook');

        expect(store.get('searchEngines')).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'Example Cooking', url: COOKING_TEMPLATE, keyword: 'cook' }),
        ]));
        await openEngineSettings();
        const row = [...container.querySelectorAll<HTMLElement>('.search-engine-row')].find((r) => r.textContent?.includes('Example Cooking'));
        expect(row?.textContent).toContain('!cook');

        await submitInAddressBar('!cook pasta');
        expect(addressValue()).toBe('https://cooking.example.org/find?q=pasta&page=&n=10');
      });

      it('is not added twice: an engine of the same name makes the offer say so', async () => {
        await restart(new SettingsStore());
        await openEngineSettings();
        addEngine('Example Cooking', 'https://elsewhere.example/?q=%s', 'ec');
        advertiseCooking();
        chip()!.click();
        await settle();
        expect(chip()!.textContent).toBe('Already added');
        expect([...container.querySelectorAll('.search-engine-row')].filter((r) => r.textContent?.includes('Example Cooking'))).toHaveLength(1);
      });

      it('is dropped when the user navigates elsewhere or switches tabs, and nothing is fetched for it', async () => {
        await restart(new SettingsStore());
        advertiseCooking();
        expect(chip()).not.toBeNull();
        await page.navigate('nova://search?q=x');
        expect(chip()).toBeNull();

        page.onPageDocumentReady('https://garden.example.org/', pageAdvertising(['/os.xml', 'Example Garden']));
        expect(chip()).not.toBeNull();
        const first = page.getChromeState().activeTabId!;
        page.createTab('about:blank');
        expect(chip()).toBeNull();

        page.onPageDocumentReady('https://pets.example.org/', pageAdvertising(['/os.xml', 'Example Pets']));
        expect(chip()).not.toBeNull();
        page.activateTabExternal(first);
        expect(chip()).toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
      });

      it('is not offered in a private window', async () => {
        await restart(new SettingsStore());
        page.setIncognitoExternal(true);
        advertiseCooking();
        expect(chip()).toBeNull();
      });

      it('keeps a markup-laden name from the descriptor as plain text in the engine list', async () => {
        fetchSpy.mockResolvedValue({
          ok: true,
          text: async () => openSearchXml('<ShortName>&lt;img src=x onerror=alert(1)&gt;</ShortName><Url type="text/html" template="https://evil.example/?q={searchTerms}"/>'),
        });
        await restart(new SettingsStore());
        page.onPageDocumentReady('https://evil.example/', pageAdvertising(['/os.xml', 'Evil']));
        chip()!.click();
        await settle();
        await openEngineSettings();
        expect(container.querySelector('.search-engine-row img')).toBeNull();
        expect(container.querySelector('.search-engine-row')!.parentElement!.textContent).toContain('<img src=x onerror=alert(1)>');
      });
    });
  });

  describe('find in page', () => {
    type Handler = (event: unknown) => void;
    const fakeEngine = () => {
      const handlers: Record<string, Handler[]> = {};
      const engine = {
        on: (type: string, h: Handler) => { (handlers[type] ??= []).push(h); },
        off: (type: string, h: Handler) => { handlers[type] = (handlers[type] ?? []).filter((x) => x !== h); },
      } as unknown as Parameters<BrowserWindowPage['setBrowserEngine']>[0];
      const emit = (kind: string) => { for (const h of handlers[kind] ?? []) h({ kind, session: { entry: { url: 'https://example.com/' } } }); };
      return { engine, emit, handlers };
    };

    it('Ctrl+F opens the find bar over the page and a new page closes it', () => {
      const { engine, emit } = fakeEngine();
      page.setBrowserEngine(engine);
      addPageCanvas(area());
      expect(pressFind().defaultPrevented).toBe(true);
      expect(area().querySelector<HTMLElement>('.nova-find-bar')!.hidden).toBe(false);

      emit('pageRepainted'); // an in-place repaint keeps the bar
      expect(area().querySelector('.nova-find-bar')).not.toBeNull();

      emit('pageLoadReady');
      expect(area().querySelector('.nova-find-bar')).toBeNull();
    });

    it('closes the bar when a navigation starts or the page fails to load', async () => {
      const { engine, emit } = fakeEngine();
      page.setBrowserEngine(engine);
      addPageCanvas(area());
      pressFind();
      expect(area().querySelector('.nova-find-bar')).not.toBeNull();
      emit('pageLoadError');
      expect(area().querySelector('.nova-find-bar')).toBeNull();

      addPageCanvas(area());
      pressFind();
      expect(area().querySelector('.nova-find-bar')).not.toBeNull();
      await page.navigate('https://example.com/other');
      expect(area().querySelector('.nova-find-bar')).toBeNull();
    });

    it('stops listening to a replaced engine', () => {
      const first = fakeEngine();
      page.setBrowserEngine(first.engine);
      const second = fakeEngine();
      page.setBrowserEngine(second.engine);
      expect(first.handlers.pageLoadReady).toEqual([]);
      expect(first.handlers.pageRepainted).toEqual([]);
      expect(second.handlers.pageLoadReady).toHaveLength(1);
      expect(second.handlers.pageRepainted).toHaveLength(1);
    });

    it('does not open on built-in pages', async () => {
      await page.navigate('nova://settings');
      expect(pressFind().defaultPrevented).toBe(false);
    });
  });

  describe('personal archive', () => {
    const doc = () => new DomTree().buildFromHtml(new HtmlParser().parse(
      `<html><head><title>Quasar notes</title></head><body><h1>Quasar notes</h1><p>${'The quasar is a luminous galactic nucleus. '.repeat(12)}</p></body></html>`,
    ).document);

    it('feeds pages the engine finished loading into the archive when the user opted in', async () => {
      flags.archiveEnabled = true;
      page.onPageDocumentReady('https://astro.example.com/quasars', doc());
      await settle(10);
      await page.navigate('nova://search?q=quasar');
      expect(area().querySelector('article a')?.textContent).toBe('Quasar notes');
    });

    it('is off by default', async () => {
      page.onPageDocumentReady('https://astro.example.com/quasars', doc());
      await settle(10);
      await page.navigate('nova://search?q=quasar');
      expect(area().querySelector('article')).toBeNull();
    });

    it('accepts a page-document provider before or after mount without throwing', async () => {
      const early = new BrowserWindowPage();
      early.setPageDocumentProvider(() => null);
      expect(() => early.onPageDocumentReady('https://a.example/', doc())).not.toThrow();
      const host = document.createElement('div');
      document.body.appendChild(host);
      await early.mount(host);
      early.setPageDocumentProvider(() => null);
      await early.unmount();
      host.remove();
    });
  });

  it('tears the search wiring down on unmount', async () => {
    const removeListener = vi.spyOn(document, 'removeEventListener');
    await page.unmount();
    expect(removeListener).toHaveBeenCalledWith('keydown', expect.any(Function));
    // the afterEach hook unmounts again; that must be harmless
  });
});
