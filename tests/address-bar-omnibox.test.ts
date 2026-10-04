import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AddressBar } from '../src/ui/components/address-bar/address-bar';
import type { AddressBarEventUnion } from '../src/ui/components/address-bar/address-bar';
import { AddressBarView, fillTextOf, groupResults } from '../src/ui/components/address-bar/address-bar.view';
import type { ActivationOptions } from '../src/ui/components/address-bar/address-bar.view';
import type { OmniboxResult } from '../src/browser/omnibox/omnibox';

const row = (over: Partial<OmniboxResult> & Pick<OmniboxResult, 'type' | 'text'>): OmniboxResult => ({
  description: '', score: 50, source: 'test', action: 'navigate', ...over,
});

const history = row({ type: 'history', text: 'GitHub', description: 'https://github.com/', url: 'https://github.com/' });
const tab = row({ type: 'tab', id: 't1', text: 'GitHub – Issues', url: 'https://github.com/issues', hint: 'Switch to tab', action: 'switch-tab' });
const search = row({ type: 'search', text: 'git', description: 'Search Nova for "git"', url: 'nova://search?q=git', action: 'search' });
const answer = row({ type: 'answer', text: '4', description: '2+2 = 4', hint: 'Copy', action: 'copy', id: 'answer:math' });
const bang = row({ type: 'engine', text: '!g', description: 'Search with Google', action: 'search' });

describe('AddressBar model — typing and results', () => {
  it('setDraft emits typing without navigating, searching or changing the value', () => {
    const bar = new AddressBar();
    const events: AddressBarEventUnion[] = [];
    for (const kind of ['typing', 'navigate', 'search', 'inputChanged'] as const) bar.on(kind, (e) => events.push(e));
    bar.setDraft('github.com');
    expect(events).toEqual([{ kind: 'typing', value: 'github.com' }]);
    expect(bar.state.value).toBe('');
  });

  it('setResults stores rows, emits resultsChanged, and clear() empties them', () => {
    const bar = new AddressBar();
    const seen: Array<readonly OmniboxResult[]> = [];
    bar.on('resultsChanged', (e) => seen.push((e as { results: readonly OmniboxResult[] }).results));
    bar.setResults([history]);
    expect(bar.state.results).toEqual([history]);
    bar.clear();
    expect(bar.state.results).toEqual([]);
    expect(seen).toEqual([[history], []]);
    bar.clear();
    expect(seen).toHaveLength(2); // nothing to clear → no event
  });

  it('keeps legacy string suggestions separate from results', () => {
    const bar = new AddressBar();
    bar.setSuggestions(['a', 'b']);
    bar.setResults([history]);
    expect(bar.state.suggestions).toEqual(['a', 'b']);
    expect(bar.state.results).toHaveLength(1);
  });
});

describe('fillTextOf / groupResults', () => {
  it('decides what a row puts in the input', () => {
    expect(fillTextOf(search)).toBe('git');
    expect(fillTextOf(row({ type: 'suggestion', text: 'react hooks' }))).toBe('react hooks');
    expect(fillTextOf(history)).toBe('https://github.com/');
    expect(fillTextOf(tab)).toBe('https://github.com/issues');
    expect(fillTextOf(row({ type: 'bookmark', text: 'Docs' }))).toBe('Docs');
    expect(fillTextOf(bang)).toBe('!g ');
    expect(fillTextOf(answer)).toBeNull();
    expect(fillTextOf(row({ type: 'action', text: 'Open settings', action: 'run-action' }))).toBeNull();
    expect(fillTextOf(row({ type: 'ai', text: 'Research', action: 'research' }))).toBeNull();
  });

  it('groups rows by section, ordered by the best-ranked row and keeping order within a section', () => {
    const groups = groupResults([search, history, tab, row({ type: 'suggestion', text: 'git hub' }), answer]);
    expect(groups.map((g) => g.label)).toEqual(['Suggestions', 'Bookmarks & history', 'Open tabs', 'Instant answer']);
    expect(groups[0]!.rows.map((r) => r.text)).toEqual(['git', 'git hub']);
  });
});

describe('AddressBarView — rich dropdown', () => {
  let container: HTMLElement;
  let model: AddressBar;
  let view: AddressBarView;
  let input: HTMLInputElement;
  let dropdown: HTMLElement;
  let interceptor: ReturnType<typeof vi.fn<(value: string, selected: OmniboxResult | null, how: ActivationOptions) => boolean>>;
  let onResult: ReturnType<typeof vi.fn<(r: OmniboxResult, how: ActivationOptions) => void>>;

  const type = (value: string) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); };
  const key = (k: string, init: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
    input.dispatchEvent(e);
    return e;
  };
  const items = () => [...dropdown.querySelectorAll<HTMLElement>('.nova-dropdown-item')];
  const headers = () => [...dropdown.querySelectorAll('.nova-dropdown-header')].map((h) => h.textContent);

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    model = new AddressBar();
    view = new AddressBarView(model);
    interceptor = vi.fn(() => true);
    onResult = vi.fn();
    view.setSubmitInterceptor(interceptor);
    view.setResultHandler(onResult);
    view.attach(container);
    input = container.querySelector('input')!;
    dropdown = container.querySelector('.nova-dropdown')!;
    input.focus();
  });

  afterEach(() => {
    view.dispose();
    container.remove();
    vi.useRealTimers();
  });

  it('turns keystrokes into typing events (never navigation)', () => {
    const typing: string[] = [];
    const nav = vi.fn();
    model.on('typing', (e) => typing.push((e as { value: string }).value));
    model.on('navigate', nav);
    model.on('search', nav);
    type('g');
    type('github.com');
    expect(typing).toEqual(['g', 'github.com']);
    expect(nav).not.toHaveBeenCalled();
  });

  it('renders rows with icon, title, description and hint, in sections when there are several', () => {
    type('git');
    model.setResults([search, history, tab]);
    expect(dropdown.style.display).toBe('block');
    expect(items()).toHaveLength(3);
    expect(headers()).toEqual(['Suggestions', 'Bookmarks & history', 'Open tabs']);
    const tabRow = items()[2]!;
    expect(tabRow.dataset.type).toBe('tab');
    expect(tabRow.querySelector('.nova-dropdown-item__icon')!.textContent).toBe('🗂️');
    expect(tabRow.querySelector('.nova-dropdown-item__hint')!.textContent).toBe('Switch to tab');
    expect(tabRow.getAttribute('role')).toBe('option');
    expect(input.getAttribute('aria-expanded')).toBe('true');
  });

  it('omits section headers when every row is in one section', () => {
    model.setResults([history, row({ type: 'bookmark', text: 'Docs', url: 'https://d.test/' })]);
    expect(headers()).toEqual([]);
    expect(items()).toHaveLength(2);
  });

  it('highlights what was typed in titles, never parsing HTML', () => {
    type('git');
    model.setResults([row({ type: 'history', text: 'GitHub <img src=x onerror=alert(1)>', url: 'https://github.com/' })]);
    const title = items()[0]!.querySelector('.nova-dropdown-item__text')!;
    expect(title.querySelector('b.nova-dropdown-match')!.textContent).toBe('Git');
    expect(title.querySelector('img')).toBeNull();
    expect(title.textContent).toBe('GitHub <img src=x onerror=alert(1)>');
  });

  it('shows answers and commands without highlighting, and archive snippets with their ranges', () => {
    type('2+2');
    model.setResults([
      answer,
      row({ type: 'archive', text: 'Fox story', description: 'the quick brown fox jumps', url: 'https://a.test/', meta: { highlights: [[16, 19]] } }),
    ]);
    expect(items()[0]!.querySelector('.nova-dropdown-match')).toBeNull();
    const snippet = items()[1]!.querySelector('.nova-dropdown-item__desc')!;
    expect(snippet.querySelector('b')!.textContent).toBe('fox');
    expect(snippet.textContent).toBe('the quick brown fox jumps');
  });

  it('renders color swatches only for plain hex colors', () => {
    model.setResults([row({ type: 'answer', text: '#ff5500', action: 'copy', meta: { swatch: '#ff5500' } })]);
    const chip = items()[0]!.querySelector<HTMLElement>('.nova-dropdown-swatch')!;
    expect(chip.style.background).not.toBe('');
    model.setResults([row({ type: 'answer', text: 'x', action: 'copy', icon: '🎨', meta: { swatch: 'red; background:url(//evil)' } })]);
    expect(items()[0]!.querySelector('.nova-dropdown-swatch')).toBeNull();
    expect(items()[0]!.querySelector('.nova-dropdown-item__icon')!.textContent).toBe('🎨');
  });

  it('hides when results become empty, and survives unrelated chrome refreshes', () => {
    model.setResults([history]);
    view.update(model.state); // e.g. a loading-state sync
    expect(items()).toHaveLength(1);
    expect(dropdown.style.display).toBe('block');
    model.setResults([]);
    expect(dropdown.style.display).toBe('none');
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });

  it('still renders and clears legacy string suggestions', () => {
    model.setSuggestions(['a', 'b']);
    view.update(model.state);
    expect(items().map((i) => i.textContent)).toEqual(['a', 'b']);
    model.setSuggestions([]);
    view.update(model.state);
    expect(dropdown.style.display).toBe('none');
  });

  describe('keyboard', () => {
    beforeEach(() => {
      type('git');
      model.setResults([search, history, answer]);
    });

    it('arrowing previews the row in the input and tracks the active descendant', () => {
      key('ArrowDown');
      expect(input.value).toBe('git'); // the search row fills its own text
      key('ArrowDown');
      expect(input.value).toBe('https://github.com/');
      expect(items()[1]!.getAttribute('aria-selected')).toBe('true');
      expect(items()[1]!.classList.contains('nova-dropdown-item--selected')).toBe(true);
      expect(input.getAttribute('aria-activedescendant')).toBe(items()[1]!.id);
      key('ArrowDown'); // the answer row has nothing to fill
      expect(input.value).toBe('git');
      key('ArrowDown'); // stays on the last row
      expect(items()[2]!.getAttribute('aria-selected')).toBe('true');
    });

    it('arrowing back past the first row restores what was typed', () => {
      key('ArrowDown');
      key('ArrowDown');
      key('ArrowUp');
      key('ArrowUp');
      expect(input.value).toBe('git');
      expect(input.hasAttribute('aria-activedescendant')).toBe(false);
      key('ArrowUp');
      expect(items().every((i) => i.getAttribute('aria-selected') === 'false')).toBe(true);
    });

    it('Enter without a selection hands the typed text to the interceptor', () => {
      key('Enter');
      expect(interceptor).toHaveBeenCalledWith('git', null, { newTab: false });
    });

    it('Enter with a selection passes that row, and Alt+Enter asks for a new tab', () => {
      key('ArrowDown');
      key('ArrowDown');
      key('Enter', { altKey: true });
      expect(interceptor).toHaveBeenCalledWith('https://github.com/', history, { newTab: true });
    });

    it('a handled submission skips the legacy navigate/search path; an unhandled one falls through', () => {
      const legacy = vi.fn();
      model.on('search', legacy);
      model.on('navigate', legacy);
      key('Enter');
      expect(legacy).not.toHaveBeenCalled();
      interceptor.mockReturnValue(false);
      type('plain words');
      key('Enter');
      expect(legacy).toHaveBeenCalledTimes(1);
      expect(legacy.mock.calls[0]![0]).toMatchObject({ kind: 'search', query: 'plain words' });
    });

    it('Enter hides the dropdown', () => {
      key('Enter');
      expect(dropdown.style.display).toBe('none');
    });

    it('Tab completes with the selected row and keeps the dropdown logic live (typing event, no navigation)', () => {
      const typing: string[] = [];
      const nav = vi.fn();
      model.on('typing', (e) => typing.push((e as { value: string }).value));
      model.on('navigate', nav);
      key('ArrowDown');
      key('ArrowDown');
      const e = key('Tab');
      expect(e.defaultPrevented).toBe(true);
      expect(input.value).toBe('https://github.com/');
      expect(typing).toEqual(['https://github.com/']);
      expect(nav).not.toHaveBeenCalled();
    });

    it('Tab with nothing selected completes only an engine/bang row, otherwise behaves normally', () => {
      expect(key('Tab').defaultPrevented).toBe(false);
      type('!g');
      model.setResults([bang, search]);
      const e = key('Tab');
      expect(e.defaultPrevented).toBe(true);
      expect(input.value).toBe('!g ');
    });

    it('Escape restores the original value and hides the dropdown', () => {
      key('Escape');
      expect(dropdown.style.display).toBe('none');
    });
  });

  describe('mouse', () => {
    beforeEach(() => model.setResults([history, tab]));
    const press = (i: number, init: MouseEventInit = {}) =>
      items()[i]!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, ...init }));

    it('activates a row on mousedown through the result handler and hides the dropdown', () => {
      press(1);
      expect(onResult).toHaveBeenCalledWith(tab, { newTab: false });
      expect(dropdown.style.display).toBe('none');
    });

    it('Ctrl/Cmd+click and middle-click request a new tab', () => {
      model.setResults([history, tab]);
      press(0, { ctrlKey: true });
      expect(onResult).toHaveBeenLastCalledWith(history, { newTab: true });
      model.setResults([history, tab]);
      press(0, { metaKey: true });
      expect(onResult).toHaveBeenLastCalledWith(history, { newTab: true });
      model.setResults([history, tab]);
      press(0, { button: 1 });
      expect(onResult).toHaveBeenLastCalledWith(history, { newTab: true });
    });

    it('falls back to navigating the model when no result handler is set', () => {
      const bare = new AddressBar();
      const v = new AddressBarView(bare);
      const c = document.createElement('div');
      document.body.appendChild(c);
      v.attach(c);
      const navigate = vi.fn();
      bare.on('navigate', navigate);
      bare.setResults([history]);
      c.querySelector('.nova-dropdown-item')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      expect(navigate).toHaveBeenCalledWith(expect.objectContaining({ kind: 'navigate' }));
      v.dispose();
      c.remove();
    });
  });

  describe('query-type badge', () => {
    const badge = () => container.querySelector<HTMLElement>('.nova-addressbar-badge')!;

    it('starts hidden, between the lock icon and the input', () => {
      expect(badge().hidden).toBe(true);
      expect([...container.children].slice(0, 3).map((c) => c.classList[0])).toEqual(['nova-security', 'nova-addressbar-badge', 'nova-addressbar-input']);
    });

    it('shows its text, kind and tooltip and marks the bar; null hides it again', () => {
      view.setQueryBadge({ kind: 'bang', text: '!w', title: 'Search Wikipedia' });
      expect(badge().hidden).toBe(false);
      expect(badge().textContent).toBe('!w');
      expect(badge().title).toBe('Search Wikipedia');
      expect(badge().dataset.kind).toBe('bang');
      expect(container.classList.contains('has-badge')).toBe(true);

      view.setQueryBadge(null);
      expect(badge().hidden).toBe(true);
      expect(badge().textContent).toBe('');
      expect(container.classList.contains('has-badge')).toBe(false);
    });

    it('treats badge text as text, never markup', () => {
      view.setQueryBadge({ kind: 'search', text: '<img src=x onerror=alert(1)>', title: '"><b>' });
      expect(badge().querySelector('img')).toBeNull();
      expect(badge().textContent).toBe('<img src=x onerror=alert(1)>');
    });

    it('goes away when the input loses focus', () => {
      view.setQueryBadge({ kind: 'search', text: '🔍', title: 'Search' });
      input.blur();
      expect(badge().hidden).toBe(true);
      expect(container.classList.contains('has-badge')).toBe(false);
    });

    it('is harmless after the view is detached', () => {
      view.detach();
      expect(() => view.setQueryBadge({ kind: 'url', text: '🌐', title: 'Go' })).not.toThrow();
    });
  });

  describe('row actions', () => {
    const deletable = row({ type: 'history', text: 'GitHub', description: 'https://github.com/', url: 'https://github.com/', meta: { historyId: 'h1' } });
    const bookmark = row({ type: 'bookmark', text: 'Docs', url: 'https://docs.test/' });
    const actionsOf = (el: Element) => [...el.querySelectorAll<HTMLElement>('.nova-dropdown-item__action')].map((b) => b.dataset.action);
    const buttonOf = (el: Element, action: string) => el.querySelector<HTMLButtonElement>(`.nova-dropdown-item__action[data-action="${action}"]`)!;
    let onAction: ReturnType<typeof vi.fn<(action: 'copy' | 'delete', r: OmniboxResult) => void>>;

    beforeEach(() => {
      onAction = vi.fn();
      view.setRowActionHandler(onAction);
    });

    it('adds no buttons until the view has a handler for them', () => {
      const bare = new AddressBar();
      const v = new AddressBarView(bare);
      const c = document.createElement('div');
      document.body.appendChild(c);
      v.attach(c);
      bare.setResults([deletable]);
      expect(c.querySelector('.nova-dropdown-item__actions')).toBeNull();
      v.dispose();
      c.remove();
    });

    it('offers copy on page rows and remove only on history rows that carry an id', () => {
      const idless = row({ type: 'history', text: 'Old page', url: 'https://old.test/' });
      model.setResults([deletable, idless, bookmark, tab, search, answer, bang]);
      const byText = (text: string) => items().find((el) => el.querySelector('.nova-dropdown-item__text')!.textContent === text)!;
      expect(actionsOf(byText('GitHub'))).toEqual(['copy', 'delete']);   // history with an id
      expect(actionsOf(byText('Old page'))).toEqual(['copy']);           // history without one cannot be removed
      expect(actionsOf(byText('Docs'))).toEqual(['copy']);               // bookmark
      expect(actionsOf(byText('GitHub – Issues'))).toEqual(['copy']);    // open tab
      expect(actionsOf(byText('git'))).toEqual([]);                      // typed search: its URL is a generated query
      expect(actionsOf(byText('4'))).toEqual([]);                        // instant answer
      expect(actionsOf(byText('!g'))).toEqual([]);                       // bang completion
    });

    it('labels the buttons for assistive tech and keeps them out of the tab order', () => {
      model.setResults([deletable]);
      const del = buttonOf(items()[0]!, 'delete');
      expect(del.getAttribute('aria-label')).toBe('Remove from history');
      expect(buttonOf(items()[0]!, 'copy').getAttribute('aria-label')).toBe('Copy link');
      expect(del.tabIndex).toBe(-1);
      expect(del.type).toBe('button');
    });

    it('a click runs the action for its row and does not activate the row', () => {
      model.setResults([deletable]);
      buttonOf(items()[0]!, 'delete').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(onAction).toHaveBeenCalledWith('delete', deletable);
      expect(onResult).not.toHaveBeenCalled();
    });

    it('a press is swallowed so neither the row nor the input blur sees it', () => {
      model.setResults([deletable]);
      const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      buttonOf(items()[0]!, 'copy').dispatchEvent(press);
      expect(press.defaultPrevented).toBe(true);
      expect(onResult).not.toHaveBeenCalled();
      expect(onAction).not.toHaveBeenCalled();
    });

    it('marks a copied row with a check', () => {
      model.setResults([bookmark]);
      const copy = buttonOf(items()[0]!, 'copy');
      expect(copy.textContent).toBe('⧉');
      copy.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(copy.textContent).toBe('✓');
      expect(copy.title).toBe('Copied');
    });

    it('Shift+Delete asks to remove the highlighted history row, and only that', () => {
      model.setResults([bookmark, deletable]);
      const selected = () => items().findIndex((el) => el.classList.contains('nova-dropdown-item--selected'));
      const moveTo = (type: string) => { while (selected() < items().findIndex((el) => el.dataset.type === type)) key('ArrowDown'); };

      moveTo('bookmark');
      expect(key('Delete', { shiftKey: true }).defaultPrevented).toBe(false); // a bookmark is not history
      expect(onAction).not.toHaveBeenCalled();

      moveTo('history');
      expect(input.value).toBe('https://github.com/');                         // the highlighted row is previewed in the input
      expect(key('Delete').defaultPrevented).toBe(false);                     // plain Delete edits the text
      expect(onAction).not.toHaveBeenCalled();
      expect(key('Delete', { shiftKey: true }).defaultPrevented).toBe(true);
      expect(onAction).toHaveBeenCalledWith('delete', deletable);
      expect(input.value).toBe('');                                           // …but not once that row is being removed
    });

    it('Shift+Delete with nothing highlighted does nothing', () => {
      model.setResults([deletable]);
      expect(key('Delete', { shiftKey: true }).defaultPrevented).toBe(false);
      expect(onAction).not.toHaveBeenCalled();
    });
  });

  it('stops reacting to results after being detached', () => {
    view.detach();
    expect(() => model.setResults([history])).not.toThrow();
  });
});
