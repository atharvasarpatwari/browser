import type { OmniboxProvider, OmniboxResult } from './omnibox';
import { classifyQuery } from './query-classifier';
import type { ClassifyOptions } from './query-classifier';
import { expandSearchTemplate } from './search-template';

// ── LRU cache with TTL ──────────────────────────────────────────────────────

class LruCache<V> {
  private readonly map = new Map<string, { value: V; at: number }>();

  constructor(
    private readonly capacity: number,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  get size(): number { return this.map.size; }

  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key); // re-insert → most recently used
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, { value, at: this.now() });
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next();
      if (!oldest.done) this.map.delete(oldest.value);
    }
  }

  clear(): void { this.map.clear(); }
}

// ── Response parsing ────────────────────────────────────────────────────────

/**
 * Understands the two shapes in the wild: OpenSearch suggestions
 * (`[query, [s1, s2, …], …]` — Google, Bing, Brave, Wikipedia) and DuckDuckGo's
 * `[{phrase: s1}, …]`. Anything else yields no suggestions.
 */
function parseSuggestions(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  if (json.length >= 2 && typeof json[0] === 'string' && Array.isArray(json[1])) {
    return json[1].filter((s): s is string => typeof s === 'string');
  }
  const out: string[] = [];
  for (const item of json) {
    const phrase = item !== null && typeof item === 'object' ? (item as { phrase?: unknown }).phrase : undefined;
    if (typeof phrase === 'string') out.push(phrase);
  }
  return out;
}

const MAX_SUGGESTION_LENGTH = 120;

function cleanSuggestions(list: readonly string[], query: string): string[] {
  const seen = new Set<string>([query.toLowerCase()]);
  const out: string[] = [];
  for (const raw of list) {
    const s = raw.trim().replace(/\s+/g, ' ');
    const key = s.toLowerCase();
    if (!s || s.length > MAX_SUGGESTION_LENGTH || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ── Privacy guard ───────────────────────────────────────────────────────────

const MAX_QUERY_LENGTH = 100;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Text that must never leave the machine as a keystroke-level suggestion request. */
function isSensitiveQuery(query: string): boolean {
  if (query.length > MAX_QUERY_LENGTH) return true;
  const card = /(?:\d[ -]?){13,19}/.exec(query);
  if (card && passesLuhn(card[0].replace(/\D/g, ''))) return true;
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(query)) return true; // US SSN
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(query)) return true; // email address
  if (/\beyJ[\w-]{10,}\./.test(query)) return true; // JWT
  if (/\b(?:password|passwd|pwd|secret|token|api[_-]?key|bearer)\b\s*[:=]/i.test(query)) return true;
  // Opaque credential-looking words: long, letters+digits, no spaces.
  return query.split(' ').some((w) => w.length >= 24 && /^[\w+/=-]+$/.test(w) && /\d/.test(w) && /[a-z]/i.test(w));
}

// ── Built-in suggestion endpoints ───────────────────────────────────────────

/** Keyed by engine slug. Templates use OpenSearch `{searchTerms}`. */
const SUGGEST_ENDPOINTS: Readonly<Record<string, string>> = {
  duckduckgo: 'https://duckduckgo.com/ac/?q={searchTerms}',
  google: 'https://suggestqueries.google.com/complete/search?client=firefox&q={searchTerms}',
  bing: 'https://api.bing.com/osjson.aspx?query={searchTerms}',
  brave: 'https://search.brave.com/api/suggest?q={searchTerms}',
  wikipedia: 'https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=5&search={searchTerms}',
};

function getSuggestEndpoint(engineSlug: string): string | null {
  return Object.prototype.hasOwnProperty.call(SUGGEST_ENDPOINTS, engineSlug) ? SUGGEST_ENDPOINTS[engineSlug]! : null;
}

/** Credential-less, referrer-less request for use when no app HTTP client is injected. */
async function fetchJsonWithGlobalFetch(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
  if (!res.ok) throw new Error(`suggestions HTTP ${res.status}`);
  return res.json();
}

// ── Provider ────────────────────────────────────────────────────────────────

interface RemoteSuggestionsDeps {
  /** Suggestion URL template (`{searchTerms}`); null means there is no endpoint. */
  getEndpoint(): string | null;
  /** Destination URL when the user picks a suggestion. */
  buildSearchUrl(query: string): string;
  engineName(): string;
  /** The `enableSearchSuggestions` setting. */
  isEnabled(): boolean;
  isIncognito(): boolean;
  fetchJson(url: string, signal: AbortSignal): Promise<unknown>;
  /** Lets the shared classifier recognise bangs/scopes so they are never sent out. */
  readonly classifyOptions?: ClassifyOptions;
  readonly debounceMs?: number;
  readonly minChars?: number;
  readonly maxSuggestions?: number;
  readonly cacheSize?: number;
  readonly cacheTtlMs?: number;
  readonly now?: () => number;
}

/**
 * Live search suggestions from the user's chosen provider. Every guard that decides whether a
 * keystroke may leave the machine lives in `getSuggestions`: disabled setting, incognito, intent
 * (only plain searches), minimum length, and sensitive-looking text.
 */
class RemoteSearchSuggestionsProvider implements OmniboxProvider {
  readonly name = 'remote-suggestions';
  readonly slow = true;

  private readonly cache: LruCache<string[]>;
  private readonly debounceMs: number;
  private readonly minChars: number;
  private readonly maxSuggestions: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inflight: AbortController | null = null;
  private supersede: (() => void) | null = null;

  constructor(private readonly deps: RemoteSuggestionsDeps) {
    this.debounceMs = deps.debounceMs ?? 120;
    this.minChars = deps.minChars ?? 2;
    this.maxSuggestions = deps.maxSuggestions ?? 5;
    this.cache = new LruCache(deps.cacheSize ?? 256, deps.cacheTtlMs ?? 5 * 60_000, deps.now);
  }

  getSuggestions(input: string, maxResults = this.maxSuggestions): Promise<OmniboxResult[]> {
    this.cancelPending();

    const query = input.trim();
    const endpoint = this.deps.getEndpoint();
    if (!endpoint || !this.deps.isEnabled() || this.deps.isIncognito()) return Promise.resolve([]);
    if (query.length < this.minChars || isSensitiveQuery(query)) return Promise.resolve([]);
    if (classifyQuery(query, this.deps.classifyOptions).intent !== 'GENERAL_SEARCH') return Promise.resolve([]);

    const limit = Math.min(maxResults, this.maxSuggestions);
    const key = `${endpoint}|${query.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached) return Promise.resolve(this.toResults(cached, limit));

    return new Promise<OmniboxResult[]>((resolve) => {
      this.supersede = () => resolve([]);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.supersede = null;
        void this.fetchSuggestions(endpoint, query, key, limit).then(resolve);
      }, this.debounceMs);
    });
  }

  dispose(): void {
    this.cancelPending();
    this.cache.clear();
  }

  private cancelPending(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.supersede?.();
    this.supersede = null;
    this.inflight?.abort();
    this.inflight = null;
  }

  private async fetchSuggestions(endpoint: string, query: string, key: string, limit: number): Promise<OmniboxResult[]> {
    const controller = new AbortController();
    this.inflight = controller;
    try {
      const url = expandSearchTemplate(endpoint, { searchTerms: query, count: this.maxSuggestions });
      const json = await this.deps.fetchJson(url, controller.signal);
      const list = cleanSuggestions(parseSuggestions(json), query);
      this.cache.set(key, list);
      return controller.signal.aborted ? [] : this.toResults(list, limit);
    } catch {
      return []; // offline / blocked / aborted: no suggestions, never an error
    } finally {
      if (this.inflight === controller) this.inflight = null;
    }
  }

  private toResults(list: readonly string[], limit: number): OmniboxResult[] {
    const engine = this.deps.engineName();
    return list.slice(0, limit).map((text, i) => ({
      type: 'suggestion' as const,
      text,
      description: `Search ${engine} for "${text}"`,
      url: this.deps.buildSearchUrl(text),
      icon: '🔍',
      score: Math.max(1, 70 - i * 5),
      source: this.name,
      action: 'search' as const,
    }));
  }
}

export {
  RemoteSearchSuggestionsProvider, LruCache, parseSuggestions, cleanSuggestions, isSensitiveQuery,
  getSuggestEndpoint, fetchJsonWithGlobalFetch, SUGGEST_ENDPOINTS,
};
export type { RemoteSuggestionsDeps };
