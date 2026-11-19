import { describe, it, expect } from 'vitest';
import { ScopeHintsProvider, SCOPE_DESCRIPTIONS } from '../src/browser/omnibox/scope-hints';

describe('ScopeHintsProvider', () => {
  const provider = new ScopeHintsProvider();

  it('offers every scope for a lone "@", in order, as completion rows', () => {
    const rows = provider.getSuggestions('@');
    expect(rows.map((r) => r.text)).toEqual(['@tabs', '@history', '@bookmarks', '@archive', '@ai', '@research']);
    expect(rows[0]).toEqual({
      type: 'engine', id: 'scope:tabs', text: '@tabs', description: 'Search open tabs', hint: 'Tab to select',
      icon: '@', score: 90, source: 'scope-hints', action: 'fill',
    });
    expect(rows.map((r) => r.score)).toEqual([90, 89, 88, 87, 86, 85]);
  });

  it('narrows by prefix, case-insensitively', () => {
    expect(provider.getSuggestions('@ta').map((r) => r.text)).toEqual(['@tabs']);
    expect(provider.getSuggestions(' @AI ').map((r) => r.text)).toEqual(['@ai']);
    expect(provider.getSuggestions('@b').map((r) => r.text)).toEqual(['@bookmarks']);
  });

  it('is quiet once the scope is complete and followed by text, or for non-scope input', () => {
    expect(provider.getSuggestions('@tabs foo')).toEqual([]);
    expect(provider.getSuggestions('@zzz')).toEqual([]);
    expect(provider.getSuggestions('tabs')).toEqual([]);
    expect(provider.getSuggestions('')).toEqual([]);
  });

  it('describes every default scope and supports custom scope lists', () => {
    for (const scope of ['tabs', 'history', 'bookmarks', 'archive', 'ai', 'research']) expect(SCOPE_DESCRIPTIONS[scope]).toBeTruthy();
    const custom = new ScopeHintsProvider(['notes']);
    expect(custom.getSuggestions('@n')[0]).toMatchObject({ text: '@notes', description: 'Search notes' });
  });
});
