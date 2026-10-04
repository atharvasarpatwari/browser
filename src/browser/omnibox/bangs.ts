import { expandSearchTemplate } from './search-template';
import type { OmniboxProvider, OmniboxResult } from './omnibox';

interface Bang {
  /** Lower-case, 1–12 letters/digits; typed as `!keyword`. */
  readonly keyword: string;
  readonly name: string;
  /** Search URL with `{searchTerms}` (or `%s`). */
  readonly url: string;
}

const b = (keyword: string, name: string, url: string): Bang => ({ keyword, name, url });

/** Built-in `!bang` shortcuts, resolved locally with no network round trip. */
const BUILT_IN_BANGS: readonly Bang[] = [
  // web search
  b('g', 'Google', 'https://www.google.com/search?q={searchTerms}'),
  b('ddg', 'DuckDuckGo', 'https://duckduckgo.com/?q={searchTerms}'),
  b('b', 'Bing', 'https://www.bing.com/search?q={searchTerms}'),
  b('br', 'Brave Search', 'https://search.brave.com/search?q={searchTerms}'),
  b('eco', 'Ecosia', 'https://www.ecosia.org/search?q={searchTerms}'),
  b('k', 'Kagi', 'https://kagi.com/search?q={searchTerms}'),
  b('sp', 'StartPage', 'https://www.startpage.com/do/search?q={searchTerms}'),
  // Google verticals
  b('gi', 'Google Images', 'https://www.google.com/search?tbm=isch&q={searchTerms}'),
  b('gm', 'Google Maps', 'https://www.google.com/maps/search/{searchTerms}'),
  b('gn', 'Google News', 'https://news.google.com/search?q={searchTerms}'),
  b('gs', 'Google Scholar', 'https://scholar.google.com/scholar?q={searchTerms}'),
  b('tr', 'Google Translate', 'https://translate.google.com/?sl=auto&tl=en&text={searchTerms}&op=translate'),
  // reference
  b('w', 'Wikipedia', 'https://en.wikipedia.org/w/index.php?search={searchTerms}'),
  b('wt', 'Wiktionary', 'https://en.wiktionary.org/w/index.php?search={searchTerms}'),
  b('wa', 'Wolfram Alpha', 'https://www.wolframalpha.com/input?i={searchTerms}'),
  b('ud', 'Urban Dictionary', 'https://www.urbandictionary.com/define.php?term={searchTerms}'),
  b('dict', 'Dictionary.com', 'https://www.dictionary.com/browse/{searchTerms}'),
  b('thes', 'Thesaurus.com', 'https://www.thesaurus.com/browse/{searchTerms}'),
  b('wb', 'Wayback Machine', 'https://web.archive.org/web/*/{searchTerms}'),
  b('arx', 'arXiv', 'https://arxiv.org/search/?query={searchTerms}&searchtype=all'),
  b('pm', 'PubMed', 'https://pubmed.ncbi.nlm.nih.gov/?term={searchTerms}'),
  b('osm', 'OpenStreetMap', 'https://www.openstreetmap.org/search?query={searchTerms}'),
  // developer
  b('gh', 'GitHub', 'https://github.com/search?q={searchTerms}'),
  b('so', 'Stack Overflow', 'https://stackoverflow.com/search?q={searchTerms}'),
  b('mdn', 'MDN Web Docs', 'https://developer.mozilla.org/en-US/search?q={searchTerms}'),
  b('npm', 'npm', 'https://www.npmjs.com/search?q={searchTerms}'),
  b('pypi', 'PyPI', 'https://pypi.org/search/?q={searchTerms}'),
  b('crates', 'crates.io', 'https://crates.io/search?q={searchTerms}'),
  b('docsrs', 'docs.rs', 'https://docs.rs/releases/search?query={searchTerms}'),
  b('go', 'pkg.go.dev', 'https://pkg.go.dev/search?q={searchTerms}'),
  b('mvn', 'Maven Central', 'https://central.sonatype.com/search?q={searchTerms}'),
  b('dh', 'Docker Hub', 'https://hub.docker.com/search?q={searchTerms}'),
  b('can', 'Can I use', 'https://caniuse.com/?search={searchTerms}'),
  b('cpp', 'cppreference', 'https://en.cppreference.com/mwiki/index.php?search={searchTerms}'),
  b('py', 'Python docs', 'https://docs.python.org/3/search.html?q={searchTerms}'),
  b('arch', 'Arch Wiki', 'https://wiki.archlinux.org/index.php?search={searchTerms}'),
  b('aur', 'Arch User Repository', 'https://aur.archlinux.org/packages?K={searchTerms}'),
  b('hn', 'Hacker News', 'https://hn.algolia.com/?q={searchTerms}'),
  b('dev', 'DEV Community', 'https://dev.to/search?q={searchTerms}'),
  b('cws', 'Chrome Web Store', 'https://chromewebstore.google.com/search/{searchTerms}'),
  // media & social
  b('yt', 'YouTube', 'https://www.youtube.com/results?search_query={searchTerms}'),
  b('ytm', 'YouTube Music', 'https://music.youtube.com/search?q={searchTerms}'),
  b('spot', 'Spotify', 'https://open.spotify.com/search/{searchTerms}'),
  b('sc', 'SoundCloud', 'https://soundcloud.com/search?q={searchTerms}'),
  b('imdb', 'IMDb', 'https://www.imdb.com/find/?q={searchTerms}'),
  b('r', 'Reddit', 'https://www.reddit.com/search/?q={searchTerms}'),
  b('tw', 'X (Twitter)', 'https://x.com/search?q={searchTerms}'),
  b('li', 'LinkedIn', 'https://www.linkedin.com/search/results/all/?keywords={searchTerms}'),
  b('pin', 'Pinterest', 'https://www.pinterest.com/search/pins/?q={searchTerms}'),
  b('med', 'Medium', 'https://medium.com/search?q={searchTerms}'),
  b('ph', 'Product Hunt', 'https://www.producthunt.com/search?q={searchTerms}'),
  // shopping
  b('a', 'Amazon', 'https://www.amazon.com/s?k={searchTerms}'),
  b('eb', 'eBay', 'https://www.ebay.com/sch/i.html?_nkw={searchTerms}'),
];

const KEYWORD_RE = /^[a-z0-9]{1,12}$/;
/** Web search templates, plus Nova's own search page (so `!nova cats` works whatever the default engine is). */
const SAFE_URL_RE = /^(?:https?:\/\/|nova:\/\/search[/?])/i;

/**
 * Looks bangs up by keyword. Caller-supplied bangs (e.g. the user's own search engines) take
 * precedence over the built-ins, so a custom `!g` overrides Google.
 */
class BangRegistry {
  private readonly bangs = new Map<string, Bang>();

  constructor(extra: readonly Bang[] = []) {
    this.replaceExtra(extra);
  }

  /** Resets the registry to the built-ins plus `extra` (the user's own engines, which win on a clash). */
  replaceExtra(extra: readonly Bang[]): void {
    this.bangs.clear();
    for (const bang of BUILT_IN_BANGS) this.bangs.set(bang.keyword, bang);
    for (const bang of extra) this.add(bang);
  }

  /** Adds or replaces a bang. Returns false (and ignores it) when the keyword or template is unusable. */
  add(bang: Bang): boolean {
    const keyword = bang.keyword.toLowerCase();
    if (!KEYWORD_RE.test(keyword) || !SAFE_URL_RE.test(bang.url)) return false;
    this.bangs.set(keyword, { ...bang, keyword });
    return true;
  }

  has(keyword: string): boolean { return this.bangs.has(keyword.toLowerCase()); }
  get(keyword: string): Bang | undefined { return this.bangs.get(keyword.toLowerCase()); }
  list(): Bang[] { return [...this.bangs.values()]; }

  /** Destination URL for `!keyword query`, or null for an unknown bang. */
  resolve(keyword: string, query: string): string | null {
    const bang = this.get(keyword);
    return bang ? expandSearchTemplate(bang.url, { searchTerms: query }) : null;
  }

  /** Bangs whose keyword or name starts with `prefix` — for completing `!g…` while typing. */
  complete(prefix: string, limit = 5): Bang[] {
    const p = prefix.toLowerCase();
    return this.list()
      .filter((x) => x.keyword.startsWith(p) || x.name.toLowerCase().startsWith(p))
      .sort((x, y) => Number(y.keyword.startsWith(p)) - Number(x.keyword.startsWith(p)) || x.keyword.length - y.keyword.length)
      .slice(0, limit);
  }
}

const BANG_PREFIX_RE = /^!([a-z0-9]{0,12})(?:\s+(.*))?$/i;
const BANG_SUFFIX_RE = /^(.+?)\s+!([a-z0-9]{1,12})$/i;

/**
 * Rows for `!bang` input: completions while the keyword is still being typed, and a one-click
 * "Search <engine> for …" row once a known bang has a query (prefix `!g cats` or suffix `cats !g`).
 */
class BangSuggestionsProvider implements OmniboxProvider {
  readonly name = 'bangs';

  constructor(private readonly registry: BangRegistry) {}

  getSuggestions(input: string, maxResults = 5): OmniboxResult[] {
    const text = input.trim();

    const suffix = BANG_SUFFIX_RE.exec(text);
    if (suffix && this.registry.has(suffix[2]!)) return [this.searchRow(text, suffix[2]!, suffix[1]!.trim())];

    const prefix = BANG_PREFIX_RE.exec(text);
    if (!prefix) return [];
    const [, keyword = '', rest] = prefix;
    if (rest !== undefined) {
      return this.registry.has(keyword) && rest.trim() ? [this.searchRow(text, keyword, rest.trim())] : [];
    }
    return this.registry.complete(keyword, maxResults).map((bang, i) => ({
      type: 'engine' as const,
      id: `bang:${bang.keyword}`,
      text: `!${bang.keyword}`,
      description: `Search ${bang.name}`,
      hint: 'Tab to select',
      icon: '🔎',
      score: 90 - i,
      source: this.name,
      action: 'fill' as const,
    }));
  }

  private searchRow(typed: string, keyword: string, query: string): OmniboxResult {
    const bang = this.registry.get(keyword)!;
    return {
      type: 'search',
      id: `bang:${bang.keyword}:search`,
      text: typed,
      description: `Search ${bang.name} for "${query}"`,
      url: expandSearchTemplate(bang.url, { searchTerms: query }),
      hint: bang.name,
      icon: '🔎',
      score: 100,
      source: this.name,
      action: 'navigate',
    };
  }
}

export { BangRegistry, BangSuggestionsProvider, BUILT_IN_BANGS };
export type { Bang };
