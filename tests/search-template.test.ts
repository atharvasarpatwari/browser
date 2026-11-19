import { describe, it, expect } from 'vitest';
import { expandSearchTemplate, hasSearchPlaceholder } from '../src/browser/omnibox/search-template';

describe('expandSearchTemplate', () => {
  it('expands {searchTerms} and the Chrome-style %s with percent-encoding', () => {
    expect(expandSearchTemplate('https://x.test/?q={searchTerms}', { searchTerms: 'a b&c' })).toBe('https://x.test/?q=a%20b%26c');
    expect(expandSearchTemplate('https://x.test/?q=%s', { searchTerms: 'ü/ñ' })).toBe('https://x.test/?q=%C3%BC%2F%C3%B1');
    expect(expandSearchTemplate('https://x.test/{searchTerms?}', { searchTerms: 'x' })).toBe('https://x.test/x');
  });

  it('replaces every occurrence', () => {
    expect(expandSearchTemplate('{searchTerms}/{searchTerms}', { searchTerms: 'a' })).toBe('a/a');
  });

  it('never re-expands placeholders that appear inside the query', () => {
    expect(expandSearchTemplate('?q={searchTerms}', { searchTerms: '{count}%s' })).toBe('?q=%7Bcount%7D%25s');
  });

  it('uses OpenSearch defaults for required params and empties optional ones', () => {
    const t = 'https://x.test/?q={searchTerms}&n={count}&s={startIndex}&p={startPage}&l={language}&e={inputEncoding}';
    expect(expandSearchTemplate(t, { searchTerms: 'q' })).toBe('https://x.test/?q=q&n=10&s=1&p=1&l=*&e=UTF-8');
    expect(expandSearchTemplate('?n={count?}&l={language?}', { searchTerms: 'q' })).toBe('?n=&l=');
  });

  it('prefers supplied values over defaults', () => {
    expect(expandSearchTemplate('?n={count}&n2={count?}&s={startIndex}', { searchTerms: 'q', count: 5, startIndex: 0 })).toBe('?n=5&n2=5&s=0');
    expect(expandSearchTemplate('?l={language}', { searchTerms: 'q', language: 'en-US' })).toBe('?l=en-US');
  });

  it('blanks extension and unknown placeholders', () => {
    expect(expandSearchTemplate('?q={searchTerms}&loc={moz:locale}&x={unknown?}', { searchTerms: 'q' })).toBe('?q=q&loc=&x=');
  });

  it('leaves templates without placeholders untouched', () => {
    expect(expandSearchTemplate('https://x.test/static', { searchTerms: 'q' })).toBe('https://x.test/static');
  });
});

describe('hasSearchPlaceholder', () => {
  it.each(['https://x/?q={searchTerms}', 'https://x/?q={searchTerms?}', 'https://x/?q=%s'])('%s', (t) => {
    expect(hasSearchPlaceholder(t)).toBe(true);
  });
  it.each(['https://x/', 'https://x/?q={count}', ''])('%j', (t) => {
    expect(hasSearchPlaceholder(t)).toBe(false);
  });
});
