import { describe, it, expect } from 'vitest';
import { TabSwitchSuggestionsProvider } from '../src/browser/omnibox/tab-switch-provider';
import type { SwitchableTab } from '../src/browser/omnibox/tab-switch-provider';

const tabs: SwitchableTab[] = [
  { id: 't1', title: 'GitHub – Pull requests', url: 'https://github.com/pulls', active: false },
  { id: 't2', title: 'Hacker News', url: 'https://news.ycombinator.com/', active: false },
  { id: 't3', title: 'Docs', url: 'https://example.com/docs', active: true },
  { id: 't4', title: 'New Tab', url: 'nova://newtab', active: false },
  { id: 't5', title: 'GitHub – Issues', url: 'https://github.com/issues', active: false },
];

describe('TabSwitchSuggestionsProvider', () => {
  const provider = new TabSwitchSuggestionsProvider(() => tabs);
  const ids = (input: string) => provider.getSuggestions(input).map((r) => r.id);

  it('finds open tabs by title or URL', () => {
    expect(ids('git').sort()).toEqual(['t1', 't5']);
    expect(ids('ycombinator')).toEqual(['t2']);
    expect(ids('pull')).toEqual(['t1']);
  });

  it('requires every typed word to match', () => {
    expect(ids('github issues')).toEqual(['t5']);
    expect(ids('github zebra')).toEqual([]);
  });

  it('shapes results as switch-to-tab rows', () => {
    expect(provider.getSuggestions('hacker news')[0]).toEqual({
      type: 'tab', id: 't2', text: 'Hacker News', description: 'https://news.ycombinator.com/',
      url: 'https://news.ycombinator.com/', hint: 'Switch to tab', icon: '🗂️',
      score: 85, source: 'tab-switch', action: 'switch-tab',
    });
  });

  it('skips the active tab and blank new-tab pages', () => {
    expect(ids('docs')).toEqual([]);
    expect(ids('new')).toEqual(['t2']); // matches "news.ycombinator.com", not the blank "New Tab"
    expect(ids('tab')).toEqual([]);
  });

  it('needs at least two characters in the general omnibox', () => {
    expect(ids('g')).toEqual([]);
    expect(ids('')).toEqual([]);
  });

  it('honours the result limit', () => {
    expect(provider.getSuggestions('git', 1)).toHaveLength(1);
  });

  describe('scoped @tabs search', () => {
    it('can include the active tab', () => {
      expect(provider.search('docs', { includeActive: true }).map((r) => r.id)).toEqual(['t3']);
    });

    it('allows one-character queries', () => {
      expect(provider.search('g').map((r) => r.id).sort()).toEqual(['t1', 't5']);
    });

    it('lists every switchable tab for an empty query when asked', () => {
      expect(provider.search('', { listAll: true }).map((r) => r.id)).toEqual(['t1', 't2', 't5']);
      expect(provider.search('', { listAll: true, includeActive: true }).map((r) => r.id)).toEqual(['t1', 't2', 't3', 't5']);
      expect(provider.search('')).toEqual([]);
    });

    it('ranks host/title-prefix matches above substring matches', () => {
      const p = new TabSwitchSuggestionsProvider(() => [
        { id: 'a', title: 'Notes on rust', url: 'https://blog.test/post', active: false },
        { id: 'b', title: 'Welcome', url: 'https://rust-lang.org/', active: false },
      ]);
      expect(p.search('rust').map((r) => r.id)).toEqual(['b', 'a']);
    });
  });

  it('reads the live tab list on every call', () => {
    let current: SwitchableTab[] = [];
    const p = new TabSwitchSuggestionsProvider(() => current);
    expect(p.getSuggestions('git')).toEqual([]);
    current = tabs;
    expect(p.getSuggestions('git')).toHaveLength(2);
  });
});
