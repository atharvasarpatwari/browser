import type { IDisposable } from '../../app/dependency-container';

export const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
export const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
export const DEFAULT_MAX_SEARCHES = 10;
export const MAX_TOKENS = 8000;
export const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type ResearchStatus = 'idle' | 'searching' | 'synthesizing' | 'complete' | 'error' | 'cancelled';

export type ResearchEventType = 'statusChanged' | 'progress' | 'complete' | 'error';

export interface ResearchCitation {
  readonly title: string;
  readonly url: string;
}

export interface ResearchSearchLogEntry {
  readonly query: string;
  readonly resultCount: number | null;
}

export interface ResearchUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly maxSearches: number;
  readonly searchesUsed: number;
}

export interface ResearchResult {
  readonly report: string;
  readonly citations: readonly ResearchCitation[];
  readonly searchLog: readonly ResearchSearchLogEntry[];
  readonly usage: ResearchUsage;
  readonly timestamp: Date;
  readonly query: string;
}

export interface ResearchOptions {
  readonly maxSearches?: number;
  readonly model?: string;
  readonly useCache?: boolean;
  readonly cacheTtlMs?: number;
}

export interface ResearchState {
  readonly status: ResearchStatus;
  readonly query: string;
  readonly progress: string;
  readonly result: ResearchResult | null;
  readonly error: string | null;
}

export interface ResearchEvent {
  readonly kind: ResearchEventType;
  readonly state: ResearchState;
}

export interface IResearchService extends IDisposable {
  readonly state: ResearchState;
  research(query: string, options?: ResearchOptions): Promise<ResearchResult>;
  cancel(): void;
  clearCache(): void;
  on(type: ResearchEventType, handler: (event: ResearchEvent) => void): void;
  off(type: ResearchEventType, handler: (event: ResearchEvent) => void): void;
}

export type ResearchEventHandler = (event: ResearchEvent) => void;

export const RESEARCH_SYSTEM_PROMPT = `You are an advanced AI Web Research Agent. Your job is to understand a \
user's query, search the web extensively using the web_search tool, open \
and weigh multiple sources, cross-check claims, and produce a clear, \
accurate, well-structured, evidence-based summary. You are not a raw \
search-results page — synthesize.

METHODOLOGY

1. Understand the query
   - Identify what the user is actually asking, the main topic and intent,
     key terms, whether it needs current/latest information, and whether
     they want facts, comparison, explanation, research, recommendations,
     news, or a technical solution.
   - If the query is ambiguous, state your best-reasonable interpretation
     up front, then proceed.

2. Search broadly
   - Issue multiple distinct searches covering: the main topic, technical
     details, recent developments, different viewpoints, supporting
     evidence, and important limitations/risks.
   - Do not stop at the first result. Prefer official/primary sources,
     government or institutional sources, academic/research sources,
     reputable news organizations, established technical publications,
     expert blogs, and then forums/community discussions, roughly in that
     priority order. Ignore spam, SEO content farms, and pages with
     unsupported claims.

3. Cross-check
   - For important claims, note whether they are confirmed by multiple
     sources, supported by one authoritative source, disputed, unverified,
     or outdated. If sources disagree, say so explicitly and explain which
     source seems more authoritative and why. Never invent information.

4. Handle time-sensitive information
   - For anything that changes over time (news, prices, specs, versions,
     regulations, availability, releases), prioritize the most recent
     sources and clearly separate current vs. historical information.

5. Produce the final answer using EXACTLY this structure:

## Answer
A direct answer to the user's question, up front.

## Key Findings
The most important findings as brief bullet points.

## Detailed Summary
A fuller explanation synthesized across sources. Use sub-headings, bullets,
or tables where they aid readability.

## Important Details
Relevant statistics, dates, technical specifications, examples,
advantages/disadvantages, risks, and limitations.

## Source Comparison
Where sources agree or disagree, and why (skip this section if all sources
were consistent and say so isn't needed).

## Conclusion
A short conclusion based on the strongest available evidence.

## Sources
A list of the key pages actually used, each as: Title — Site — URL.

RULES
- Never fabricate sources, quotes, statistics, or links.
- Never claim to have checked a page you did not actually retrieve.
- If reliable information cannot be found on some sub-point, say so
  explicitly: "Reliable information could not be verified from the
  available sources."
- Keep the report tight and scannable — no unnecessary repetition.`;
