import type { OmniboxProvider, OmniboxResult } from './omnibox';

interface SearchEngineConfig {
  readonly name: string;
  readonly url: string;
  readonly keyword: string;
  readonly icon?: string;
}

interface ISearchSuggestionsProvider extends OmniboxProvider {
  setSearchEngine(engine: SearchEngineConfig): void;
  getSearchEngine(): SearchEngineConfig;
}

function isLikelyUrl(input: string): boolean {
  if (input.startsWith('http://') || input.startsWith('https://') || input.startsWith('ftp://')) return true;
  if (input.startsWith('localhost') || /^\d+\.\d+\.\d+\.\d+/.test(input)) return true;
  if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}(\/|$)/.test(input)) return true;
  return false;
}

const DEFAULT_ENGINE: SearchEngineConfig = {
  name: 'DuckDuckGo',
  url: 'https://duckduckgo.com/?q=%s',
  keyword: 'ddg',
  icon: '🔍',
};

class SearchSuggestionsProvider implements ISearchSuggestionsProvider {
  readonly name = 'search-suggestions';
  private engine: SearchEngineConfig;

  constructor(engine?: Partial<SearchEngineConfig>) {
    this.engine = { ...DEFAULT_ENGINE, ...engine };
  }

  setSearchEngine(engine: SearchEngineConfig): void {
    this.engine = engine;
  }

  getSearchEngine(): SearchEngineConfig {
    return { ...this.engine };
  }

  getSuggestions(input: string, maxResults = 4): OmniboxResult[] {
    if (!input.trim() || isLikelyUrl(input)) return [];

    const results: OmniboxResult[] = [];
    const query = input.trim();

    const score = Math.max(1, 100 - query.length * 2);

    results.push({
      type: 'search',
      text: query,
      description: `Search ${this.engine.name} for "${query}"`,
      url: this.engine.url.replace('%s', encodeURIComponent(query)),
      icon: this.engine.icon,
      score,
      source: this.name,
      action: 'search',
    });

    if (query.length >= 3) {
      const suggestions = this.generateLocalSuggestions(query);
      for (let i = 0; i < Math.min(suggestions.length, maxResults - 1); i++) {
        results.push({
          type: 'suggestion',
          text: suggestions[i],
          description: `Search ${this.engine.name} for "${suggestions[i]}"`,
          url: this.engine.url.replace('%s', encodeURIComponent(suggestions[i])),
          icon: this.engine.icon,
          score: Math.max(1, score - (i + 1) * 5),
          source: this.name,
          action: 'search',
        });
      }
    }

    return results;
  }

  private generateLocalSuggestions(query: string): string[] {
    const suggestions: string[] = [];
    const words = query.split(/\s+/);
    const lastWord = words[words.length - 1];
    const prefix = words.slice(0, -1).join(' ');

    const common = [
      'how to', 'what is', 'best', 'top', 'define',
      'example', 'vs', 'near me', 'online', 'free',
    ];

    for (const term of common) {
      if (term.startsWith(lastWord.toLowerCase()) && term !== lastWord) {
        suggestions.push(prefix ? `${prefix} ${term}` : term);
      }
    }

    if (lastWord.length >= 2) {
      for (let i = 0; i < 3; i++) {
        const completion = lastWord + String.fromCharCode(97 + Math.floor(Math.random() * 26));
        suggestions.push(prefix ? `${prefix} ${completion}` : completion);
      }
    }

    return suggestions.slice(0, 5);
  }
}

export { SearchSuggestionsProvider, isLikelyUrl, DEFAULT_ENGINE };
export type { ISearchSuggestionsProvider, SearchEngineConfig };
