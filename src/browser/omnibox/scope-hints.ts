import type { OmniboxProvider, OmniboxResult } from './omnibox';
import { DEFAULT_SCOPES } from './query-classifier';

const SCOPE_DESCRIPTIONS: Readonly<Record<string, string>> = {
  tabs: 'Search open tabs',
  history: 'Search your browsing history',
  bookmarks: 'Search your bookmarks',
  archive: 'Search the full text of pages you have visited',
  ai: 'Ask Nova AI to research a question',
  research: 'Ask Nova AI to research a question',
};

/** While the user is still typing `@sc…`, offers the matching `@scope` keywords to Tab-complete. */
class ScopeHintsProvider implements OmniboxProvider {
  readonly name = 'scope-hints';

  constructor(private readonly scopes: readonly string[] = DEFAULT_SCOPES) {}

  getSuggestions(input: string): OmniboxResult[] {
    const m = /^@([a-z]*)$/i.exec(input.trim());
    if (!m) return [];
    const prefix = m[1]!.toLowerCase();
    return this.scopes
      .filter((s) => s.startsWith(prefix))
      .map((scope, i) => ({
        type: 'engine' as const,
        id: `scope:${scope}`,
        text: `@${scope}`,
        description: SCOPE_DESCRIPTIONS[scope] ?? `Search ${scope}`,
        hint: 'Tab to select',
        icon: '@',
        score: 90 - i,
        source: this.name,
        action: 'fill' as const,
      }));
  }
}

export { ScopeHintsProvider, SCOPE_DESCRIPTIONS };
