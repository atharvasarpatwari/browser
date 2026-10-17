import type { OmniboxProvider, OmniboxResult } from './omnibox';

interface BrowserAction {
  readonly id: string;
  readonly title: string;
  /** Extra trigger phrases besides the title. */
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly icon: string;
}

/** Catalog of commands the omnibox can offer; callers pass only the ones they can actually run. */
const DEFAULT_BROWSER_ACTIONS: readonly BrowserAction[] = [
  { id: 'open-settings', title: 'Open settings', aliases: ['preferences', 'options'], description: 'Browser settings', icon: '⚙️' },
  { id: 'open-downloads', title: 'Open downloads', aliases: ['downloads'], description: 'Downloaded files', icon: '⬇️' },
  { id: 'open-history', title: 'Open history', aliases: ['browsing history'], description: 'Pages you have visited', icon: '🕘' },
  { id: 'open-bookmarks', title: 'Open bookmarks', aliases: ['bookmark manager'], description: 'Saved pages', icon: '⭐' },
  { id: 'new-tab', title: 'New tab', description: 'Open a blank tab', icon: '➕' },
  { id: 'new-window', title: 'New window', description: 'Open another browser window', icon: '🪟' },
  { id: 'new-incognito-window', title: 'New incognito window', aliases: ['private window', 'private browsing'], description: 'Browse without saving history', icon: '🕶️' },
  { id: 'close-tab', title: 'Close tab', description: 'Close the current tab', icon: '✖️' },
  { id: 'clear-browsing-data', title: 'Clear browsing data', aliases: ['clear history', 'clear cache', 'clear cookies'], description: 'Open privacy settings to clear data', icon: '🧹' },
  { id: 'inspect-element', title: 'Inspect element', aliases: ['developer tools', 'devtools'], description: 'Open developer tools', icon: '🛠️' },
  { id: 'reload-page', title: 'Reload page', aliases: ['refresh'], description: 'Reload the current page', icon: '🔄' },
  { id: 'print-page', title: 'Print page', aliases: ['print'], description: 'Print the current page', icon: '🖨️' },
  { id: 'toggle-fullscreen', title: 'Toggle full screen', aliases: ['fullscreen'], description: 'Enter or leave full screen', icon: '⛶' },
];

const normalize = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** 0 = no match. Exact beats prefix beats "every typed word starts a phrase word". */
function scorePhrase(input: string, phrase: string): number {
  if (input === phrase) return 95;
  if (input.length >= 3 && phrase.startsWith(input)) return 80 + Math.round((input.length / phrase.length) * 10);
  const words = phrase.split(' ');
  const parts = input.split(' ');
  if (parts.every((p) => p.length >= 2 && words.some((w) => w.startsWith(p)))) {
    return 60 + Math.round((parts.length / words.length) * 15);
  }
  return 0;
}

class BrowserActionsProvider implements OmniboxProvider {
  readonly name = 'browser-actions';

  constructor(private readonly actions: readonly BrowserAction[] = DEFAULT_BROWSER_ACTIONS) {}

  /** Every normalised trigger phrase — hand this to the query classifier as `actionPhrases`. */
  get phrases(): ReadonlySet<string> {
    const out = new Set<string>();
    for (const a of this.actions) {
      out.add(normalize(a.title));
      for (const alias of a.aliases ?? []) out.add(normalize(alias));
    }
    return out;
  }

  getSuggestions(input: string, maxResults = 3): OmniboxResult[] {
    const q = normalize(input);
    if (q.length < 3) return [];

    const scored: OmniboxResult[] = [];
    for (const a of this.actions) {
      const score = Math.max(0, ...[a.title, ...(a.aliases ?? [])].map((p) => scorePhrase(q, normalize(p))));
      if (score === 0) continue;
      scored.push({
        type: 'action', id: a.id, text: a.title, description: a.description, hint: 'Run command',
        icon: a.icon, score, source: this.name, action: 'run-action',
      });
    }
    return scored.sort((x, y) => y.score - x.score).slice(0, maxResults);
  }
}

export { BrowserActionsProvider, DEFAULT_BROWSER_ACTIONS };
export type { BrowserAction };
