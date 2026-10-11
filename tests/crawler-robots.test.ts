import { describe, it, expect } from 'vitest';
import { parseRobotsTxt, isAllowed, serializeRules, deserializeRules } from '../src/browser/crawler/robots';

describe('parseRobotsTxt', () => {
  it('parses Disallow/Allow/Crawl-delay for the wildcard agent', () => {
    const rules = parseRobotsTxt(
      `User-agent: *\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 2\n`,
      'NovaCrawler',
    );
    expect(rules.disallow).toEqual(['/private']);
    expect(rules.allow).toEqual(['/private/public']);
    expect(rules.crawlDelayMs).toBe(2000);
  });

  it('prefers a block matching our user-agent over the wildcard block', () => {
    const rules = parseRobotsTxt(
      `User-agent: *\nDisallow: /everything\n\nUser-agent: NovaCrawler\nDisallow: /only-this\n`,
      'NovaCrawler',
    );
    expect(rules.disallow).toEqual(['/only-this']);
  });

  it('ignores directives before any User-agent line', () => {
    const rules = parseRobotsTxt(`Disallow: /orphan\nUser-agent: *\nDisallow: /real\n`, 'NovaCrawler');
    expect(rules.disallow).toEqual(['/real']);
  });

  it('ignores comments and blank lines', () => {
    const rules = parseRobotsTxt(`# comment\nUser-agent: *\n\n# another\nDisallow: /x # trailing comment\n`, 'NovaCrawler');
    expect(rules.disallow).toEqual(['/x']);
  });

  it('returns empty rules for an empty body', () => {
    expect(parseRobotsTxt('', 'NovaCrawler')).toEqual({ disallow: [], allow: [], crawlDelayMs: null });
  });
});

describe('isAllowed', () => {
  it('allows everything when there are no rules', () => {
    expect(isAllowed({ disallow: [], allow: [], crawlDelayMs: null }, '/anything')).toBe(true);
  });

  it('disallows a path under a Disallow prefix', () => {
    const rules = { disallow: ['/private'], allow: [], crawlDelayMs: null };
    expect(isAllowed(rules, '/private/doc')).toBe(false);
    expect(isAllowed(rules, '/public/doc')).toBe(true);
  });

  it('lets the longest matching rule win regardless of order', () => {
    const rules = { disallow: ['/a'], allow: ['/a/b'], crawlDelayMs: null };
    expect(isAllowed(rules, '/a/b/c')).toBe(true);
    expect(isAllowed(rules, '/a/other')).toBe(false);
  });
});

describe('serialize/deserialize round-trip', () => {
  it('round-trips rules through JSON', () => {
    const rules = { disallow: ['/x'], allow: ['/x/y'], crawlDelayMs: 1500 };
    expect(deserializeRules(serializeRules(rules))).toEqual(rules);
  });

  it('falls back to empty rules on malformed JSON', () => {
    expect(deserializeRules('not json')).toEqual({ disallow: [], allow: [], crawlDelayMs: null });
  });
});
