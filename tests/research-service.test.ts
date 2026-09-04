import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ResearchService } from '../src/browser/research/research-service';
import type { IHttpClient, HttpRequestSpec, HttpResponseSpec } from '../src/browser/networking/request-manager';

function createMockClient(assertions: (request: HttpRequestSpec) => void): IHttpClient {
  return {
    send: vi.fn((request: HttpRequestSpec): Promise<HttpResponseSpec> => {
      assertions(request);
      return Promise.resolve({
        url: request.url,
        statusCode: 200,
        statusText: 'OK',
        headers: new Map(),
        body: JSON.stringify({
          content: [
            {
              type: 'text',
              text: '## Answer\nThis is the report.',
              citations: [
                { title: 'Source One', url: 'https://example.com/one' },
                { title: 'Source One', url: 'https://example.com/one' },
                { title: 'Source Two', url: 'https://example.com/two' },
              ],
            },
          ],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 200 },
        }),
        bodyBinary: null,
        redirected: false,
        redirectChain: [],
      });
    }),
  };
}

describe('ResearchService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('should be constructable', () => {
    const service = new ResearchService({ apiKeyProvider: () => 'test-key' });
    expect(service).toBeDefined();
    expect(service.state.status).toBe('idle');
    service.dispose();
  });

  it('should throw when no API key is configured', async () => {
    const client = createMockClient(() => {});
    const service = new ResearchService({ client, apiKeyProvider: () => null });
    await expect(service.research('test query')).rejects.toThrow('API key');
    expect(service.state.status).toBe('error');
    expect(service.state.error).toContain('API key');
    service.dispose();
  });

  it('should throw on empty query', async () => {
    const client = createMockClient(() => {});
    const service = new ResearchService({ client, apiKeyProvider: () => 'key' });
    await expect(service.research('   ')).rejects.toThrow('empty');
    service.dispose();
  });

  it('should make API request and return result', async () => {
    let requestBody: string | null = null;
    const client: IHttpClient = {
      send: vi.fn((request: HttpRequestSpec): Promise<HttpResponseSpec> => {
        requestBody = request.body ?? null;
        return Promise.resolve({
          url: request.url,
          statusCode: 200,
          statusText: 'OK',
          headers: new Map(),
          body: JSON.stringify({
            content: [
              {
                type: 'text',
                text: '## Answer\nThis is the report.',
                citations: [
                  { title: 'Source One', url: 'https://example.com/one' },
                  { title: 'Source One', url: 'https://example.com/one' },
                  { title: 'Source Two', url: 'https://example.com/two' },
                ],
              },
            ],
            stop_reason: 'end_turn',
            usage: { input_tokens: 100, output_tokens: 200 },
          }),
          bodyBinary: null,
          redirected: false,
          redirectChain: [],
        });
      }),
    };
    const service = new ResearchService({ client, apiKeyProvider: () => 'test-key' });

    const result = await service.research('What is the latest?', { maxSearches: 5 });

    expect(result.report).toContain('This is the report');
    expect(result.citations).toHaveLength(2);
    expect(result.citations[0].title).toBe('Source One');
    expect(result.citations[0].url).toBe('https://example.com/one');
    expect(result.citations[1].title).toBe('Source Two');
    expect(result.usage.inputTokens).toBe(100);
    expect(result.usage.outputTokens).toBe(200);
    expect(result.usage.maxSearches).toBe(5);
    expect(result.usage.searchesUsed).toBe(0);
    expect(service.state.status).toBe('complete');
    expect(service.state.result?.report).toContain('This is the report');

    expect(requestBody).not.toBeNull();
    const parsedBody = JSON.parse(requestBody ?? '{}');
    expect(parsedBody.model).toBe('claude-sonnet-4-5-20250929');
    expect(parsedBody.tools[0].max_uses).toBe(5);
    expect(parsedBody.messages[0].content).toBe('What is the latest?');
    expect(parsedBody.system).toContain('advanced AI Web Research Agent');

    service.dispose();
  });

  it('should use custom model and max searches', async () => {
    let requestBody: string | null = null;
    const client: IHttpClient = {
      send: vi.fn((request: HttpRequestSpec): Promise<HttpResponseSpec> => {
        requestBody = request.body ?? null;
        return Promise.resolve({
          url: request.url,
          statusCode: 200,
          statusText: 'OK',
          headers: new Map(),
          body: JSON.stringify({
            content: [{ type: 'text', text: 'Report' }],
            stop_reason: 'end_turn',
          }),
          bodyBinary: null,
          redirected: false,
          redirectChain: [],
        });
      }),
    };
    const service = new ResearchService({ client, apiKeyProvider: () => 'key' });

    await service.research('query', { model: 'claude-opus-4-20250514', maxSearches: 3 });

    const parsed = JSON.parse(requestBody ?? '{}');
    expect(parsed.model).toBe('claude-opus-4-20250514');
    expect(parsed.tools[0].max_uses).toBe(3);

    service.dispose();
  });

  it('should emit events on completion', async () => {
    const client = createMockClient(() => {});
    const service = new ResearchService({ client, apiKeyProvider: () => 'key' });

    const events: string[] = [];
    service.on('statusChanged', (e) => events.push(e.kind));
    service.on('complete', (e) => events.push(`complete:${e.state.status}`));

    await service.research('test');

    expect(events).toContain('statusChanged');
    expect(events).toContain('complete:complete');

    service.dispose();
  });

  it('should handle pause_turn for continuation', async () => {
    let callCount = 0;
    const client: IHttpClient = {
      send: vi.fn((request: HttpRequestSpec): Promise<HttpResponseSpec> => {
        callCount++;
        const stopReason = callCount === 1 ? 'pause_turn' : 'end_turn';
        return Promise.resolve({
          url: request.url,
          statusCode: 200,
          statusText: 'OK',
          headers: new Map(),
          body: JSON.stringify({
            content: [{ type: 'text', text: `Part ${callCount}` }],
            stop_reason: stopReason,
          }),
          bodyBinary: null,
          redirected: false,
          redirectChain: [],
        });
      }),
    };
    const service = new ResearchService({ client, apiKeyProvider: () => 'key' });

    const result = await service.research('long query');

    expect(callCount).toBe(2);
    expect(result.report).toBe('Part 2');

    service.dispose();
  });

  it('should throw on API error response', async () => {
    const client: IHttpClient = {
      send: vi.fn((): Promise<HttpResponseSpec> => {
        return Promise.resolve({
          url: 'https://api.anthropic.com/v1/messages',
          statusCode: 401,
          statusText: 'Unauthorized',
          headers: new Map(),
          body: '{"error":{"message":"Invalid API key"}}',
          bodyBinary: null,
          redirected: false,
          redirectChain: [],
        });
      }),
    };
    const service = new ResearchService({ client, apiKeyProvider: () => 'bad-key' });

    await expect(service.research('test')).rejects.toThrow('401');
    expect(service.state.status).toBe('error');

    service.dispose();
  });

  it('should handle cancellation', async () => {
    const client: IHttpClient = {
      send: vi.fn((): Promise<HttpResponseSpec> => {
        return new Promise((_resolve, reject) => {
          // Never resolve — cancelled via abort
          setTimeout(() => reject(new Error('Aborted')), 1000);
        });
      }),
    };
    const service = new ResearchService({ client, apiKeyProvider: () => 'key' });

    const promise = service.research('long-running');
    service.cancel();

    await expect(promise).rejects.toThrow('cancelled');
    expect(service.state.status).toBe('cancelled');

    service.dispose();
  });

  it('should be disposed and not accept new research', async () => {
    const client = createMockClient(() => {});
    const service = new ResearchService({ client, apiKeyProvider: () => 'key' });
    service.dispose();
    await expect(service.research('test')).rejects.toThrow('disposed');
  });

  it('should retry on 429 and succeed', async () => {
    let callCount = 0;
    const client: IHttpClient = {
      send: vi.fn((): Promise<HttpResponseSpec> => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            url: 'https://api.anthropic.com/v1/messages',
            statusCode: 429,
            statusText: 'Too Many Requests',
            headers: new Map(),
            body: '{"error":{"message":"rate limited"}}',
            bodyBinary: null,
            redirected: false,
            redirectChain: [],
          });
        }
        return Promise.resolve({
          url: 'https://api.anthropic.com/v1/messages',
          statusCode: 200,
          statusText: 'OK',
          headers: new Map(),
          body: JSON.stringify({
            content: [{ type: 'text', text: '## Answer\nAfter retry.' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 50, output_tokens: 80 },
          }),
          bodyBinary: null,
          redirected: false,
          redirectChain: [],
        });
      }),
    };
    const service = new ResearchService({ client, apiKeyProvider: () => 'key' });

    const result = await service.research('rate limited query', { useCache: false });

    expect(callCount).toBe(2);
    expect(result.report).toContain('After retry');
    expect(result.usage.inputTokens).toBe(50);
    expect(service.state.status).toBe('complete');

    service.dispose();
  });

  it('should extract search log from response blocks', async () => {
    const client: IHttpClient = {
      send: vi.fn((): Promise<HttpResponseSpec> => {
        return Promise.resolve({
          url: 'https://api.anthropic.com/v1/messages',
          statusCode: 200,
          statusText: 'OK',
          headers: new Map(),
          body: JSON.stringify({
            content: [
              { type: 'text', text: 'Searching...' },
              { type: 'server_tool_use', name: 'web_search', input: { query: 'solid state batteries 2026' } },
              { type: 'web_search_tool_result', content: [{ url: 'a' }, { url: 'b' }, { url: 'c' }] },
              { type: 'server_tool_use', name: 'web_search', input: { query: 'solid state battery risks' } },
              { type: 'web_search_tool_result', content: [{ url: 'd' }, { url: 'e' }] },
              { type: 'text', text: '## Answer\nDone.' },
            ],
            stop_reason: 'end_turn',
            usage: { input_tokens: 300, output_tokens: 400 },
          }),
          bodyBinary: null,
          redirected: false,
          redirectChain: [],
        });
      }),
    };
    const service = new ResearchService({ client, apiKeyProvider: () => 'key' });

    const result = await service.research('solid state batteries', { useCache: false });

    expect(result.searchLog).toHaveLength(2);
    expect(result.searchLog[0].query).toBe('solid state batteries 2026');
    expect(result.searchLog[0].resultCount).toBe(3);
    expect(result.searchLog[1].query).toBe('solid state battery risks');
    expect(result.searchLog[1].resultCount).toBe(2);
    expect(result.usage.searchesUsed).toBe(2);

    service.dispose();
  });

  it('should clear cache', async () => {
    const client = createMockClient(() => {});
    const service = new ResearchService({ client, apiKeyProvider: () => 'key' });

    await service.research('cached query', { useCache: true });
    service.clearCache();
    service.dispose();
  });

  it('should return cached result without API call', async () => {
    let callCount = 0;
    const client: IHttpClient = {
      send: vi.fn((): Promise<HttpResponseSpec> => {
        callCount++;
        return Promise.resolve({
          url: 'https://api.anthropic.com/v1/messages',
          statusCode: 200,
          statusText: 'OK',
          headers: new Map(),
          body: JSON.stringify({
            content: [{ type: 'text', text: '## Answer\nFresh.' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
          bodyBinary: null,
          redirected: false,
          redirectChain: [],
        });
      }),
    };
    const service = new ResearchService({ client, apiKeyProvider: () => 'key' });

    await service.research('repeat query', { useCache: true });
    await service.research('repeat query', { useCache: true });

    expect(callCount).toBe(1);

    service.dispose();
  });

  it('should accumulate token usage across pause_turn iterations', async () => {
    let callCount = 0;
    const client: IHttpClient = {
      send: vi.fn((): Promise<HttpResponseSpec> => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            url: 'https://api.anthropic.com/v1/messages',
            statusCode: 200,
            statusText: 'OK',
            headers: new Map(),
            body: JSON.stringify({
              content: [{ type: 'text', text: 'Part 1' }],
              stop_reason: 'pause_turn',
              usage: { input_tokens: 100, output_tokens: 50 },
            }),
            bodyBinary: null,
            redirected: false,
            redirectChain: [],
          });
        }
        return Promise.resolve({
          url: 'https://api.anthropic.com/v1/messages',
          statusCode: 200,
          statusText: 'OK',
          headers: new Map(),
          body: JSON.stringify({
            content: [{ type: 'text', text: '## Answer\nFinal.' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 200, output_tokens: 300 },
          }),
          bodyBinary: null,
          redirected: false,
          redirectChain: [],
        });
      }),
    };
    const service = new ResearchService({ client, apiKeyProvider: () => 'key' });

    const result = await service.research('long query', { useCache: false });

    expect(callCount).toBe(2);
    expect(result.usage.inputTokens).toBe(300);
    expect(result.usage.outputTokens).toBe(350);

    service.dispose();
  });
});
