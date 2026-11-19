import type { OmniboxProvider, OmniboxResult } from './omnibox';

const COMMON_TLDS = ['.com', '.org', '.net', '.edu', '.gov', '.io', '.dev', '.app', '.co', '.me'];

interface IUrlSuggestionsProvider extends OmniboxProvider {
  addKnownUrl(url: string, title?: string): void;
  clearKnownUrls(): void;
}

function isDomainName(input: string): boolean {
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(input) && input.length >= 2;
}

function hasProtocol(input: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input);
}

function looksLikeUrl(input: string): boolean {
  if (hasProtocol(input)) return true;
  if (input.startsWith('localhost') || /^\d+\.\d+\.\d+\.\d+/.test(input)) return true;
  if (/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}(\/|$)/.test(input)) return true;
  if (isDomainName(input)) return true;
  return false;
}

class UrlSuggestionsProvider implements IUrlSuggestionsProvider {
  readonly name = 'url-suggestions';
  private knownUrls: Array<{ url: string; title: string }> = [];

  addKnownUrl(url: string, title?: string): void {
    const existing = this.knownUrls.find(u => u.url === url);
    if (!existing) {
      this.knownUrls.push({ url, title: title ?? url });
    }
  }

  clearKnownUrls(): void {
    this.knownUrls = [];
  }

  getSuggestions(input: string, maxResults = 4): OmniboxResult[] {
    if (!input.trim()) return [];
    const query = input.trim();
    const results: OmniboxResult[] = [];
    let score = 90;

    if (isDomainName(query) && !hasProtocol(query) && !query.includes('.')) {
      for (const tld of COMMON_TLDS) {
        if (results.length >= maxResults) break;
        const host = `${query}${tld}`;
        const url = `https://www.${host}`;
        results.push({
          type: 'url',
          text: host,
          description: url,
          url,
          icon: '🌐',
          score: score--,
          source: this.name,
          action: 'navigate',
        });
      }
    }

    if (isDomainName(query) && query.includes('.') && !hasProtocol(query)) {
      const url = `https://${query}`;
      if (!results.some(r => r.url === url)) {
        results.push({
          type: 'url',
          text: query,
          description: url,
          url,
          icon: '🌐',
          score: 95,
          source: this.name,
          action: 'navigate',
        });
      }
    }

    if (hasProtocol(query) || query.includes('.')) {
      const url = hasProtocol(query) ? query : `https://${query}`;
      if (!results.some(r => r.url === url)) {
        results.push({
          type: 'url',
          text: query,
          description: url,
          url,
          icon: '🌐',
          score: 85,
          source: this.name,
          action: 'navigate',
        });
      }
    }

    const queryLower = query.toLowerCase();
    for (const known of this.knownUrls) {
      if (results.length >= maxResults * 2) break;
      if (known.url.toLowerCase().includes(queryLower) || known.title.toLowerCase().includes(queryLower)) {
        if (!results.some(r => r.url === known.url)) {
          results.push({
            type: 'url',
            text: known.title,
            description: known.url,
            url: known.url,
            icon: '🔗',
            score: Math.max(1, 70 - known.url.length),
            source: this.name,
            action: 'navigate',
          });
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }
}

export { UrlSuggestionsProvider, isDomainName, looksLikeUrl, COMMON_TLDS };
export type { IUrlSuggestionsProvider };
