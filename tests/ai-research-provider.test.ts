import { describe, it, expect } from 'vitest';
import {
  AiResearchProvider, buildResearchUrl, parseResearchUrl, RESEARCH_PAGE_URL,
} from '../src/browser/omnibox/ai-research-provider';

describe('AiResearchProvider', () => {
  const provider = new AiResearchProvider();

  it('offers one research row for the scoped query', () => {
    expect(provider.getSuggestions('  how does webrtc work  ')).toEqual([{
      type: 'ai',
      id: 'ai:research',
      text: 'Research “how does webrtc work” with Nova AI',
      description: 'Searches the web and writes a cited summary',
      url: 'nova://research?q=how%20does%20webrtc%20work',
      hint: 'Deep search',
      icon: '✨',
      score: 100,
      source: 'ai-research',
      action: 'research',
      meta: { query: 'how does webrtc work' },
    }]);
  });

  it('offers nothing until there is a question', () => {
    expect(provider.getSuggestions('')).toEqual([]);
    expect(provider.getSuggestions('   ')).toEqual([]);
  });

  it('bounds very long queries', () => {
    const [row] = provider.getSuggestions('x'.repeat(2000));
    expect((row!.meta as { query: string }).query).toHaveLength(500);
  });
});

describe('research URLs', () => {
  it('round-trips awkward text', () => {
    for (const q of ['simple', 'a & b = c', 'what is 100% of 5?', '日本語 と emoji 🚀', 'hash # and ? mark', 'a+b']) {
      expect(parseResearchUrl(buildResearchUrl(q))).toBe(q);
    }
  });

  it('builds URLs on the research page', () => {
    expect(buildResearchUrl('x')).toBe(`${RESEARCH_PAGE_URL}?q=x`);
    expect(buildResearchUrl('  padded  ')).toBe('nova://research?q=padded');
  });

  it('parses q regardless of its position and treats + as a space', () => {
    expect(parseResearchUrl('nova://research?q=hello+world')).toBe('hello world');
    expect(parseResearchUrl('nova://research/?x=1&q=a%20b')).toBe('a b');
    expect(parseResearchUrl('NOVA://RESEARCH?q=ok')).toBe('ok');
  });

  it.each([
    'nova://research', 'nova://research?q=', 'nova://research?q=%20%20', 'nova://research?x=1',
    'nova://settings?q=hi', 'https://example.com/?q=hi', 'nova://research?q=%E0%A4%A', 'nova://research?foo=q=1',
  ])('returns null for %j', (url) => {
    expect(parseResearchUrl(url)).toBeNull();
  });
});
