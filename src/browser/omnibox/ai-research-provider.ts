import type { OmniboxProvider, OmniboxResult } from './omnibox';

const RESEARCH_PAGE_URL = 'nova://research';
const MAX_QUERY_LENGTH = 500;

/** `nova://research?q=<query>` — the research page reads `q` and starts the research. */
function buildResearchUrl(query: string): string {
  return `${RESEARCH_PAGE_URL}?q=${encodeURIComponent(query.trim().slice(0, MAX_QUERY_LENGTH))}`;
}

/** Returns the research query carried by a `nova://research` URL, or null. */
function parseResearchUrl(url: string): string | null {
  const m = /^nova:\/\/research\/?\?(?:[^#]*&)?q=([^&#]*)/i.exec(url);
  if (!m) return null;
  try {
    const q = decodeURIComponent(m[1]!.replace(/\+/g, ' ')).trim();
    return q ? q.slice(0, MAX_QUERY_LENGTH) : null;
  } catch {
    return null;
  }
}

/**
 * The `@ai` / `@research` row. It only ever sees the text after the scope (the omnibox controller
 * routes scoped queries to it), so it offers one "research this" action and nothing else.
 */
class AiResearchProvider implements OmniboxProvider {
  readonly name = 'ai-research';

  getSuggestions(input: string): OmniboxResult[] {
    const query = input.trim().slice(0, MAX_QUERY_LENGTH);
    if (!query) return [];
    return [{
      type: 'ai',
      id: 'ai:research',
      text: `Research “${query}” with Nova AI`,
      description: 'Searches the web and writes a cited summary',
      url: buildResearchUrl(query),
      hint: 'Deep search',
      icon: '✨',
      score: 100,
      source: this.name,
      action: 'research',
      meta: { query },
    }];
  }
}

export { AiResearchProvider, buildResearchUrl, parseResearchUrl, RESEARCH_PAGE_URL };
