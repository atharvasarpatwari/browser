import { describe, it, expect } from 'vitest';
import { classifyQuery, isDirectUrl } from '../src/browser/omnibox/query-classifier';
import type { ClassifyOptions } from '../src/browser/omnibox/query-classifier';

const BANGS = new Set(['g', 'yt', 'w', 'gh']);
const options: ClassifyOptions = {
  isBang: (kw) => BANGS.has(kw),
  actionPhrases: new Set(['clear browsing data', 'open settings']),
};

describe('classifyQuery — DIRECT_URL', () => {
  it.each([
    'https://github.com/pulls', 'http://localhost:3000', 'file:///C:/x.txt', 'nova://settings', 'about:blank',
    'localhost', 'localhost:3000/app', '127.0.0.1', '10.0.0.1:8080/api', '[::1]', '[::1]:8080/x',
    'github.com/pulls', 'news.ycombinator.com', 'sub.example.co.uk', 'EXAMPLE.COM', 'myserver:8080',
  ])('%s', (input) => {
    expect(classifyQuery(input, options).intent).toBe('DIRECT_URL');
    expect(isDirectUrl(input)).toBe(true);
  });

  it.each([
    'hello world', 'weather', 'node.js tutorial', 'github.com is down', 'main.py', 'readme.md', 'script.sh',
    'file.txt', 'a.b', 'http://', '999.1.1.1', 'user@example.com', 'e.g.', 'what is the capital of france',
  ])('treats %j as a search, not a URL', (input) => {
    expect(isDirectUrl(input)).toBe(false);
    expect(classifyQuery(input, options).intent).toBe('GENERAL_SEARCH');
  });
});

describe('classifyQuery — BANG_SEARCH', () => {
  it('detects a prefix bang', () => {
    expect(classifyQuery('!g quantum computing', options)).toMatchObject({
      intent: 'BANG_SEARCH', bang: 'g', query: 'quantum computing',
    });
    expect(classifyQuery('!W Albert Einstein', options)).toMatchObject({ bang: 'w', query: 'Albert Einstein' });
  });

  it('detects a suffix bang', () => {
    expect(classifyQuery('react docs !gh', options)).toMatchObject({
      intent: 'BANG_SEARCH', bang: 'gh', query: 'react docs',
    });
  });

  it('detects a bare bang (engine picked, no query yet)', () => {
    expect(classifyQuery('!g', options)).toMatchObject({ intent: 'BANG_SEARCH', bang: 'g', query: '' });
  });

  it('ignores unknown bangs, and every bang when no resolver is given', () => {
    expect(classifyQuery('!zz foo', options).intent).toBe('GENERAL_SEARCH');
    expect(classifyQuery('!g foo').intent).toBe('GENERAL_SEARCH');
  });
});

describe('classifyQuery — SCOPED_SEARCH', () => {
  it('detects a complete scope', () => {
    expect(classifyQuery('@tabs settings')).toMatchObject({ intent: 'SCOPED_SEARCH', scope: 'tabs', query: 'settings' });
    expect(classifyQuery('@ai synthesize WebRTC')).toMatchObject({ scope: 'ai', query: 'synthesize WebRTC' });
    expect(classifyQuery('@history')).toMatchObject({ scope: 'history', query: '' });
    expect(classifyQuery('@Tabs foo')).toMatchObject({ scope: 'tabs', query: 'foo' });
  });

  it('detects a scope still being typed', () => {
    expect(classifyQuery('@ta')).toMatchObject({ intent: 'SCOPED_SEARCH', scopeIncomplete: true, query: '' });
    expect(classifyQuery('@')).toMatchObject({ intent: 'SCOPED_SEARCH', scopeIncomplete: true });
  });

  it('treats unknown @handles as ordinary searches', () => {
    expect(classifyQuery('@elonmusk').intent).toBe('GENERAL_SEARCH');
    expect(classifyQuery('@nobody hello').intent).toBe('GENERAL_SEARCH');
  });

  it('honours a custom scope list', () => {
    expect(classifyQuery('@notes todo', { scopes: ['notes'] })).toMatchObject({ scope: 'notes', query: 'todo' });
    expect(classifyQuery('@tabs todo', { scopes: ['notes'] }).intent).toBe('GENERAL_SEARCH');
  });
});

describe('classifyQuery — CALCULATION_OR_CONVERSION', () => {
  it.each(['2+2', 'sqrt(144) + 12 * 4', '72 F to C', '5 km in mi', '#ff5500', 'rgb(255, 0, 0)'])('%s', (input) => {
    expect(classifyQuery(input, options).intent).toBe('CALCULATION_OR_CONVERSION');
  });

  it.each(['42', '2024-01-15', '100 usd in eur', 'iphone 15 pro max'])('%j is not a calculation', (input) => {
    expect(classifyQuery(input, options).intent).toBe('GENERAL_SEARCH');
  });
});

describe('classifyQuery — BROWSER_ACTION', () => {
  it('matches exact phrases, ignoring case and spacing', () => {
    expect(classifyQuery('Clear  Browsing Data', options).intent).toBe('BROWSER_ACTION');
    expect(classifyQuery('open settings', options).intent).toBe('BROWSER_ACTION');
  });

  it('does not match partial phrases or when no phrases are configured', () => {
    expect(classifyQuery('open settings now', options).intent).toBe('GENERAL_SEARCH');
    expect(classifyQuery('open settings').intent).toBe('GENERAL_SEARCH');
  });
});

describe('classifyQuery — precedence and edges', () => {
  it('scope beats bang beats URL beats calculation', () => {
    expect(classifyQuery('@tabs 2+2', options).intent).toBe('SCOPED_SEARCH');
    expect(classifyQuery('!g 2+2', options).intent).toBe('BANG_SEARCH');
    expect(classifyQuery('example.com', options).intent).toBe('DIRECT_URL');
  });

  it('returns an empty general query for blank input', () => {
    expect(classifyQuery('')).toMatchObject({ intent: 'GENERAL_SEARCH', query: '' });
    expect(classifyQuery('   ')).toMatchObject({ intent: 'GENERAL_SEARCH', query: '' });
  });

  it('keeps the raw input and a whitespace-normalised query', () => {
    const c = classifyQuery('  best   pizza  ');
    expect(c.raw).toBe('  best   pizza  ');
    expect(c.query).toBe('best pizza');
  });

  it('stays well inside the per-keystroke budget', () => {
    const inputs = ['react hooks', 'github.com/x', '!g foo', '@tabs a', '2+2', '72 f to c', 'how to bake bread at home'];
    const start = performance.now();
    for (let i = 0; i < 2000; i++) classifyQuery(inputs[i % inputs.length]!, options);
    // plan budget is 2 ms per call; assert a very loose 0.5 ms average so CI load can't flake it
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
