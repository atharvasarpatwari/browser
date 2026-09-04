import { hashSync } from '../security/crypto-utils';
import { FetchHttpClient } from '../networking/request-manager';
import type { HttpRequestSpec, IHttpClient } from '../networking/request-manager';
import {
  ANTHROPIC_API_URL,
  DEFAULT_CACHE_TTL_MS,
  DEFAULT_MODEL,
  DEFAULT_MAX_SEARCHES,
  MAX_TOKENS,
  RESEARCH_SYSTEM_PROMPT,
} from './research-types';
import type {
  IResearchService,
  ResearchCitation,
  ResearchEvent,
  ResearchEventHandler,
  ResearchEventType,
  ResearchOptions,
  ResearchResult,
  ResearchSearchLogEntry,
  ResearchState,
  ResearchUsage,
} from './research-types';

interface AnthropicMessageBlock {
  readonly type?: string;
  readonly text?: string;
  readonly name?: string;
  readonly input?: Readonly<Record<string, unknown>>;
  readonly content?: unknown;
  readonly citations?: ReadonlyArray<{ title?: string; url?: string }>;
}

interface AnthropicResponse {
  readonly content?: ReadonlyArray<AnthropicMessageBlock>;
  readonly stop_reason?: string;
  readonly usage?: { input_tokens?: number; output_tokens?: number };
}

interface ResearchServiceConfig {
  readonly client?: IHttpClient;
  readonly apiKeyProvider?: () => string | null;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 1500;

interface CacheEntry {
  readonly result: ResearchResult;
  readonly expiresAt: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

class ResearchService implements IResearchService {
  private readonly client: IHttpClient;
  private readonly apiKeyProvider: () => string | null;
  private readonly handlers = new Map<ResearchEventType, ResearchEventHandler[]>();
  private readonly cache = new Map<string, CacheEntry>();
  private _state: ResearchState;
  private abortController: AbortController | null = null;
  private disposed = false;

  constructor(config: ResearchServiceConfig = {}) {
    this.client = config.client ?? new FetchHttpClient();
    this.apiKeyProvider = config.apiKeyProvider ?? (() => null);
    this._state = {
      status: 'idle',
      query: '',
      progress: '',
      result: null,
      error: null,
    };
  }

  get state(): ResearchState {
    return { ...this._state };
  }

  async research(query: string, options: ResearchOptions = {}): Promise<ResearchResult> {
    if (this.disposed) {
      throw new Error('ResearchService has been disposed.');
    }

    const trimmed = query.trim();
    if (!trimmed) {
      throw new Error('Query must not be empty.');
    }

    this.cancel();

    const apiKey = this.apiKeyProvider();
    if (!apiKey) {
      this.setState({
        status: 'error',
        query: trimmed,
        progress: '',
        result: null,
        error: 'Anthropic API key is not configured. Set it in Settings → AI Research.',
      });
      throw new Error('Anthropic API key is not configured.');
    }

    const maxSearches = options.maxSearches ?? DEFAULT_MAX_SEARCHES;
    const model = options.model ?? DEFAULT_MODEL;

    const cacheKey = this.cacheKey(trimmed, model, maxSearches);

    if (options.useCache ?? true) {
      const cached = this.lookupCache(cacheKey, options.cacheTtlMs);
      if (cached) {
        this.setState({
          status: 'complete',
          query: trimmed,
          progress: '',
          result: cached,
          error: null,
        });
        this.emit('complete', this._state);
        return cached;
      }
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    this.setState({
      status: 'searching',
      query: trimmed,
      progress: 'Starting research...',
      result: null,
      error: null,
    });

    try {
      const messages: Array<{ role: string; content: string }> = [
        { role: 'user', content: trimmed },
      ];

      let finalText = '';
      let lastUsage: ResearchUsage = {
        inputTokens: 0,
        outputTokens: 0,
        maxSearches,
        searchesUsed: 0,
      };
      const allCitations: ResearchCitation[] = [];
      const seenUrls = new Set<string>();
      const allSearchLog: ResearchSearchLogEntry[] = [];

      for (let iteration = 0; iteration < 6; iteration++) {
        if (signal.aborted) {
          this.setState({
            status: 'cancelled',
            query: trimmed,
            progress: '',
            result: null,
            error: null,
          });
          throw new Error('Research cancelled.');
        }

        const body = {
          model,
          max_tokens: MAX_TOKENS,
          system: RESEARCH_SYSTEM_PROMPT,
          messages,
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search',
              max_uses: maxSearches,
            },
          ],
        };

        this.emitProgress(trimmed, iteration === 0 ? 'Searching the web...' : 'Continuing research...');

        const headers = new Map<string, string>();
        headers.set('x-api-key', apiKey);
        headers.set('anthropic-version', '2023-06-01');
        headers.set('content-type', 'application/json');

        const spec: HttpRequestSpec = {
          url: ANTHROPIC_API_URL,
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          timeoutMs: 300000,
        };

        const parsed = await this.sendWithRetry(spec, signal, trimmed);

        lastUsage = {
          inputTokens: (lastUsage.inputTokens ?? 0) + (parsed.usage?.input_tokens ?? 0),
          outputTokens: (lastUsage.outputTokens ?? 0) + (parsed.usage?.output_tokens ?? 0),
          maxSearches,
          searchesUsed: lastUsage.searchesUsed,
        };

        const textParts: string[] = [];
        for (const block of parsed.content ?? []) {
          if (block.type === 'text' && block.text) {
            textParts.push(block.text);
          }
          for (const c of block.citations ?? []) {
            const url = c.url ?? '';
            const title = c.title ?? url;
            if (url && !seenUrls.has(url)) {
              seenUrls.add(url);
              allCitations.push({ title, url });
            }
          }
        }

        this.extractSearchLog(parsed.content ?? [], allSearchLog);

        if (parsed.stop_reason !== 'pause_turn') {
          finalText = textParts[textParts.length - 1] ?? '';
          break;
        }

        messages.push({ role: 'assistant', content: JSON.stringify(parsed.content ?? []) });
        messages.push({ role: 'user', content: 'Please continue.' });
      }

      const result: ResearchResult = {
        report: finalText,
        citations: allCitations,
        searchLog: allSearchLog,
        usage: {
          ...lastUsage,
          searchesUsed: allSearchLog.length,
        },
        timestamp: new Date(),
        query: trimmed,
      };

      if (options.useCache ?? true) {
        this.saveCache(cacheKey, result, options.cacheTtlMs);
      }

      this.setState({
        status: 'complete',
        query: trimmed,
        progress: '',
        result,
        error: null,
      });
      this.emit('complete', this._state);

      return result;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (this._state.status !== 'cancelled') {
        this.setState({
          status: 'error',
          query: trimmed,
          progress: '',
          result: null,
          error: errorMessage,
        });
        this.emit('error', this._state);
      }
      throw err;
    } finally {
      this.abortController = null;
    }
  }

  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  on(type: ResearchEventType, handler: ResearchEventHandler): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  off(type: ResearchEventType, handler: ResearchEventHandler): void {
    const list = this.handlers.get(type) ?? [];
    const idx = list.indexOf(handler);
    if (idx !== -1) list.splice(idx, 1);
    this.handlers.set(type, list);
  }

  clearCache(): void {
    this.cache.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.handlers.clear();
  }

  private setState(state: ResearchState): void {
    this._state = { ...state };
    this.emit('statusChanged', this._state);
  }

  private emitProgress(query: string, progress: string): void {
    this._state = { ...this._state, query, progress };
    this.emit('progress', this._state);
  }

  private emit(type: ResearchEventType, state: ResearchState): void {
    const event: ResearchEvent = { kind: type, state: { ...state } };
    const list = this.handlers.get(type) ?? [];
    for (const handler of [...list]) {
      try {
        handler(event);
      } catch (err) {
        console.error(`[ResearchService] Handler threw on "${type}":`, err);
      }
    }
  }

  private cacheKey(query: string, model: string, maxSearches: number): string {
    const raw = `${model}|${maxSearches}|${query.trim().toLowerCase()}`;
    return hashSync('sha256', raw);
  }

  private lookupCache(key: string, ttlMs?: number): ResearchResult | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  private saveCache(key: string, result: ResearchResult, _ttlMs?: number): void {
    const ttl = _ttlMs ?? DEFAULT_CACHE_TTL_MS;
    this.cache.set(key, { result, expiresAt: Date.now() + ttl });
  }

  private async sendWithRetry(
    spec: HttpRequestSpec,
    signal: AbortSignal,
    query: string,
  ): Promise<AnthropicResponse> {
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await this.client.send(spec, signal);
      } catch (err) {
        if (signal.aborted) {
          this.setState({
            status: 'cancelled',
            query,
            progress: '',
            result: null,
            error: null,
          });
          throw new Error('Research cancelled.');
        }
        if (attempt >= MAX_ATTEMPTS - 1) throw err;
        await this.backoff(attempt, query, signal);
        continue;
      }

      if (response.statusCode === 200) {
        try {
          return JSON.parse(response.body) as AnthropicResponse;
        } catch {
          this.setState({
            status: 'error',
            query,
            progress: '',
            result: null,
            error: 'Could not parse API response.',
          });
          throw new Error('Could not parse API response.');
        }
      }

      if (!RETRYABLE_STATUS_CODES.has(response.statusCode) || attempt >= MAX_ATTEMPTS - 1) {
        this.setState({
          status: 'error',
          query,
          progress: '',
          result: null,
          error: `API error (${response.statusCode}): ${response.body.slice(0, 500)}`,
        });
        throw new Error(`Anthropic API returned status ${response.statusCode}`);
      }

      await this.backoff(attempt, query, signal);
    }
  }

  private async backoff(attempt: number, query: string, signal: AbortSignal): Promise<void> {
    const delay = BASE_BACKOFF_MS * 2 ** attempt + Math.random() * 500;
    this.emitProgress(query, `Retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`);
    await sleep(delay);
    if (signal.aborted) {
      this.setState({
        status: 'cancelled',
        query,
        progress: '',
        result: null,
        error: null,
      });
      throw new Error('Research cancelled.');
    }
  }

  private extractSearchLog(content: ReadonlyArray<AnthropicMessageBlock>, out: ResearchSearchLogEntry[]): void {
    let pendingQuery: string | null = null;
    for (const block of content) {
      if (block.type === 'server_tool_use' && block.name === 'web_search') {
        pendingQuery = typeof block.input?.query === 'string' ? block.input.query : null;
        out.push({ query: pendingQuery ?? '', resultCount: null });
      } else if (block.type === 'web_search_tool_result') {
        const resultContent = block.content;
        const count = Array.isArray(resultContent) ? resultContent.length : 0;
        const last = out[out.length - 1];
        if (last && last.resultCount === null) {
          out[out.length - 1] = { query: last.query, resultCount: count };
        } else {
          out.push({ query: pendingQuery ?? '', resultCount: count });
        }
      }
    }
  }
}

export { ResearchService };
