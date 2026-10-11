/**
 * @file src/browser/crawler/robots.ts
 *
 * Minimal robots.txt parser + per-domain cache for the crawler. No
 * equivalent exists elsewhere in the codebase (confirmed by investigation).
 *
 * Supports the subset crawlers actually need: User-agent blocks, Disallow /
 * Allow (longest-match-wins per the de-facto standard), and Crawl-delay.
 * Sitemap directives and wildcard/`$` path matching are not implemented —
 * add if a curated seed domain needs them.
 */

export interface RobotsRules {
  readonly disallow: readonly string[];
  readonly allow: readonly string[];
  readonly crawlDelayMs: number | null;
}

const EMPTY_RULES: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };

interface RobotsGroup {
  agents: string[];
  disallow: string[];
  allow: string[];
  crawlDelayMs: number | null;
}

/**
 * Parses a robots.txt body into records ("one or more User-agent lines
 * followed by directives"), then returns the single most specific record
 * for `userAgent`: an exact agent match if one exists, else the `*` record.
 * Per the de-facto standard, the chosen record's rules are used exclusively
 * — they are never merged with other records.
 */
export function parseRobotsTxt(body: string, userAgent: string): RobotsRules {
  const lines = body.split(/\r?\n/);
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastLineWasAgent = false;

  for (const raw of lines) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastLineWasAgent) {
        current = { agents: [], disallow: [], allow: [], crawlDelayMs: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }
    lastLineWasAgent = false;
    if (!current) continue; // directives before any User-agent line are ignored

    if (field === 'disallow') {
      if (value !== '') current.disallow.push(value);
    } else if (field === 'allow') {
      if (value !== '') current.allow.push(value);
    } else if (field === 'crawl-delay') {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelayMs = seconds * 1000;
    }
  }

  const ua = userAgent.toLowerCase();
  const exact = groups.find((g) => g.agents.includes(ua));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  const chosen = exact ?? wildcard;
  if (!chosen) return EMPTY_RULES;
  return { disallow: chosen.disallow, allow: chosen.allow, crawlDelayMs: chosen.crawlDelayMs };
}

/** True if `path` is disallowed under `rules` (longest matching prefix wins). */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  let bestLen = -1;
  let bestAllowed = true;

  for (const p of rules.disallow) {
    if (path.startsWith(p) && p.length > bestLen) {
      bestLen = p.length;
      bestAllowed = false;
    }
  }
  for (const p of rules.allow) {
    if (path.startsWith(p) && p.length > bestLen) {
      bestLen = p.length;
      bestAllowed = true;
    }
  }
  return bestAllowed;
}

export function serializeRules(rules: RobotsRules): string {
  return JSON.stringify(rules);
}

export function deserializeRules(json: string): RobotsRules {
  try {
    const parsed = JSON.parse(json) as Partial<RobotsRules>;
    return {
      disallow: parsed.disallow ?? [],
      allow: parsed.allow ?? [],
      crawlDelayMs: parsed.crawlDelayMs ?? null,
    };
  } catch {
    return EMPTY_RULES;
  }
}

export { EMPTY_RULES };
