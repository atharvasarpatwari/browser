import type { OmniboxProvider, OmniboxResult } from './omnibox';

/**
 * The original providers score on unrelated scales (history is frecency × 10 — up to ~780 — while
 * bookmarks are 95–115 and guessed URLs 85–95). The orchestrator sorts and truncates across
 * providers, so every row must be on one 0–100 scale *before* it merges; otherwise one provider
 * can push the search row and instant answers out of the list.
 */
function tierScore(r: OmniboxResult): number {
  switch (r.type) {
    case 'answer': return 100;
    case 'search': return r.source === 'bangs' ? 100 : 98;
    case 'tab': return Math.min(r.score, 92);
    case 'bookmark': return Math.min(r.score - 10, 90);
    case 'url': return Math.min(r.score, 84);
    case 'history': return 50 + Math.min(30, r.score / 10);
    default: return r.score;
  }
}

/**
 * Wraps a provider so it returns at most `cap` rows on the unified scale. The provider's own score is
 * kept in `meta.rawScore` (history uses it to tell a genuinely frecent page from a weak match).
 */
function tiered(provider: OmniboxProvider, cap: number): OmniboxProvider {
  const rescale = (rows: OmniboxResult[]): OmniboxResult[] =>
    rows.slice(0, cap).map((r) => ({ ...r, score: tierScore(r), meta: { ...r.meta, rawScore: r.score } }));
  return {
    name: provider.name,
    slow: provider.slow,
    getSuggestions(input, maxResults) {
      const rows = provider.getSuggestions(input, Math.min(maxResults ?? cap, cap));
      return rows instanceof Promise ? rows.then(rescale) : rescale(rows);
    },
  };
}

export { tierScore, tiered };
