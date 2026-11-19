import type { OmniboxProvider, OmniboxResult } from './omnibox';

interface SwitchableTab {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly active: boolean;
}

interface TabSwitchOptions {
  readonly limit?: number;
  /** Include the tab the user is already on (scoped `@tabs` listing). */
  readonly includeActive?: boolean;
  /** Return every tab for an empty query (scoped `@tabs` with nothing typed yet). */
  readonly listAll?: boolean;
}

const BLANK_URL = /^(?:nova:\/\/newtab\/?|about:blank)$/i;

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

/** "Switch to tab" rows for open tabs whose title or URL contain every typed word. */
class TabSwitchSuggestionsProvider implements OmniboxProvider {
  readonly name = 'tab-switch';

  constructor(private readonly listTabs: () => readonly SwitchableTab[]) {}

  getSuggestions(input: string, maxResults = 3): OmniboxResult[] {
    return input.trim().length >= 2 ? this.search(input, { limit: maxResults }) : [];
  }

  search(query: string, options: TabSwitchOptions = {}): OmniboxResult[] {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length === 0 && !options.listAll) return [];

    const out: OmniboxResult[] = [];
    for (const tab of this.listTabs()) {
      if (tab.active && !options.includeActive) continue;
      if (BLANK_URL.test(tab.url)) continue;

      const title = tab.title.toLowerCase();
      const url = tab.url.toLowerCase();
      if (!words.every((w) => title.includes(w) || url.includes(w))) continue;

      const host = hostOf(tab.url);
      let score = 70;
      if (words.length > 0) {
        if (words.every((w) => host.startsWith(w) || host.includes(`.${w}`) || title.startsWith(w))) score = 85;
        else if (words.every((w) => host.includes(w) || title.includes(w))) score = 78;
      }
      out.push({
        type: 'tab', id: tab.id, text: tab.title || tab.url, description: tab.url, url: tab.url,
        hint: 'Switch to tab', icon: '🗂️', score, source: this.name, action: 'switch-tab',
      });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, options.limit ?? 8);
  }
}

export { TabSwitchSuggestionsProvider };
export type { SwitchableTab, TabSwitchOptions };
