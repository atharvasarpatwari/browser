import { describe, it, expect } from 'vitest';
import { BrowserActionsProvider, DEFAULT_BROWSER_ACTIONS } from '../src/browser/omnibox/browser-actions';
import type { BrowserAction } from '../src/browser/omnibox/browser-actions';

describe('BrowserActionsProvider', () => {
  const provider = new BrowserActionsProvider();
  const ids = (input: string, max?: number) => provider.getSuggestions(input, max).map((r) => r.id);

  it('ranks an exact title match first with the top score', () => {
    const [first] = provider.getSuggestions('open settings');
    expect(first).toMatchObject({
      type: 'action', id: 'open-settings', text: 'Open settings', hint: 'Run command',
      action: 'run-action', source: 'browser-actions', score: 95,
    });
  });

  it('matches aliases exactly', () => {
    expect(provider.getSuggestions('devtools')[0]).toMatchObject({ id: 'inspect-element', score: 95 });
    expect(ids('private window')[0]).toBe('new-incognito-window');
    expect(ids('print')[0]).toBe('print-page');
  });

  it('matches prefixes, case- and spacing-insensitively', () => {
    expect(provider.getSuggestions('clear hist')[0]).toMatchObject({ id: 'clear-browsing-data', score: 88 });
    expect(ids('  CLEAR   browsing ')[0]).toBe('clear-browsing-data');
  });

  it('matches when every typed word starts some word of the phrase', () => {
    expect(provider.getSuggestions('settings')[0]).toMatchObject({ id: 'open-settings', score: 68 });
    expect(ids('incognito win')[0]).toBe('new-incognito-window');
  });

  it('stays quiet for short or unrelated input', () => {
    expect(ids('op')).toEqual([]);
    expect(ids('')).toEqual([]);
    expect(ids('iphone settings')).toEqual([]);
    expect(ids('how to bake bread')).toEqual([]);
  });

  it('orders by score and caps the result count', () => {
    const all = provider.getSuggestions('new');
    expect(all.map((r) => r.id)).toEqual(['new-tab', 'new-window', 'new-incognito-window']);
    expect(all.map((r) => r.score)).toEqual([84, 83, 82]);
    expect(ids('new', 2)).toEqual(['new-tab', 'new-window']);
  });

  it('only offers the actions it was given', () => {
    const custom: BrowserAction[] = [{ id: 'only', title: 'Only action', description: 'd', icon: 'i' }];
    const p = new BrowserActionsProvider(custom);
    expect(p.getSuggestions('only action').map((r) => r.id)).toEqual(['only']);
    expect(p.getSuggestions('open settings')).toEqual([]);
  });

  it('exposes normalised phrases for the query classifier', () => {
    const phrases = provider.phrases;
    expect(phrases.has('open settings')).toBe(true);
    expect(phrases.has('private window')).toBe(true);
    expect(phrases.has('clear history')).toBe(true);
    expect([...phrases].every((p) => p === p.toLowerCase() && !/\s{2,}/.test(p))).toBe(true);
  });

  it('has a unique id per catalog entry', () => {
    const catalogIds = DEFAULT_BROWSER_ACTIONS.map((a) => a.id);
    expect(new Set(catalogIds).size).toBe(catalogIds.length);
  });
});
