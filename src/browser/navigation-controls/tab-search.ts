import type { IDisposable } from '../../app/dependency-container';

interface TabSearchResult {
  readonly tabId: string;
  readonly title: string;
  readonly url: string;
  readonly score: number;
  readonly matchType: 'title' | 'url' | 'both';
}

interface ITabSearch extends IDisposable {
  search(query: string): TabSearchResult[];
  setTabsSource(source: () => Array<{ id: string; title: string; url: string }>): void;
}

class TabSearch implements ITabSearch {
  private getTabs: () => Array<{ id: string; title: string; url: string }> = () => [];

  setTabsSource(source: () => Array<{ id: string; title: string; url: string }>): void {
    this.getTabs = source;
  }

  search(query: string): TabSearchResult[] {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return [];

    const tabs = this.getTabs();
    const results: TabSearchResult[] = [];

    for (const tab of tabs) {
      const titleLower = tab.title.toLowerCase();
      const urlLower = tab.url.toLowerCase();
      const titleMatch = titleLower.includes(trimmed);
      const urlMatch = urlLower.includes(trimmed);
      if (!titleMatch && !urlMatch) continue;

      let score = 0;
      let matchType: 'title' | 'url' | 'both' = 'title';

      if (titleMatch && urlMatch) {
        score = 100;
        matchType = 'both';
        if (titleLower === trimmed) score += 20;
        if (urlLower === trimmed) score += 20;
      } else if (titleMatch) {
        score = 80;
        matchType = 'title';
        if (titleLower.startsWith(trimmed)) score += 15;
        if (titleLower === trimmed) score += 20;
      } else {
        score = 60;
        matchType = 'url';
        if (urlLower.startsWith(trimmed)) score += 15;
      }

      results.push({ tabId: tab.id, title: tab.title, url: tab.url, score, matchType });
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  dispose(): void {
    this.getTabs = () => [];
  }
}

export { TabSearch };
export type { ITabSearch, TabSearchResult };
