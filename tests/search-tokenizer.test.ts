import { describe, it, expect } from 'vitest';
import { tokenize, scanTokens, parseQuery, normalizeWord, STOP_WORDS } from '../src/browser/search/tokenizer';

describe('tokenize', () => {
  it('lower-cases, drops stop words and stems', () => {
    expect(tokenize('The quick brown foxes are running')).toEqual(['quick', 'brown', 'fox', 'run']);
  });

  it('strips diacritics', () => {
    expect(tokenize('Café Zürich naïve')).toEqual(['cafe', 'zurich', 'naiv']);
    expect(normalizeWord('Crème Brûlée')).toBe('creme brulee');
  });

  it('keeps numbers but drops single letters', () => {
    expect(tokenize('3 apples and 42')).toEqual(['3', 'appl', '42']);
    expect(tokenize('a b c x1')).toEqual(['x1']);
  });

  it('splits on punctuation and apostrophes', () => {
    expect(tokenize("don't stop-me.later")).toEqual(['don', 'stop', 'later']);
  });

  it('drops absurdly long tokens (hashes, blobs)', () => {
    expect(tokenize(`ok ${'x'.repeat(41)} fine`)).toEqual(['ok', 'fine']);
  });

  it('indexes CJK as bigrams and keeps single characters', () => {
    expect(tokenize('東京大学')).toEqual(['東京', '京大', '大学']);
    expect(tokenize('한국어')).toEqual(['한국', '국어']);
    expect(tokenize('猫')).toEqual(['猫']);
    expect(tokenize('iPhone 15 日本語')).toEqual(['iphon', '15', '日本', '本語']);
  });

  it('honours the stop-word and stemming switches', () => {
    expect(tokenize('the running and', { stopWords: false })).toEqual(['the', 'run', 'and']);
    expect(tokenize('the running', { stem: false })).toEqual(['running']);
  });

  it('removes stop words from several languages but not common English content words', () => {
    expect(tokenize('der Hund und das Pferd ist gross')).toEqual(['hund', 'pferd', 'gross']);
    expect(tokenize('le chat et la souris')).toEqual(['chat', 'souri']);
    expect(tokenize('el perro y los gatos')).toEqual(['perro', 'gato']);
    for (const keep of ['war', 'hat', 'die', 'car', 'son', 'mit', 'uber', 'sans', 'sin', 'era']) {
      expect(STOP_WORDS.has(keep)).toBe(false);
    }
  });
});

describe('scanTokens', () => {
  it('reports source offsets and the unstemmed form', () => {
    const [a, b] = scanTokens('Hello, Running!');
    expect(a).toMatchObject({ term: 'hello', norm: 'hello', start: 0, end: 5 });
    expect(b).toMatchObject({ term: 'run', norm: 'running', start: 7, end: 14 });
  });
});

describe('parseQuery', () => {
  it('uses the indexing pipeline and reports the last word for prefix matching', () => {
    expect(parseQuery('running shoes')).toEqual({ terms: ['run', 'shoe'], lastWord: 'shoes' });
  });

  it('de-duplicates terms that stem together', () => {
    expect(parseQuery('run running runs').terms).toEqual(['run']);
  });

  it('falls back to unfiltered words when everything is a stop word', () => {
    expect(parseQuery('The Who')).toEqual({ terms: ['the', 'who'], lastWord: 'who' });
  });

  it('returns nothing for empty or punctuation-only input', () => {
    expect(parseQuery('')).toEqual({ terms: [], lastWord: null });
    expect(parseQuery('?!…')).toEqual({ terms: [], lastWord: null });
  });

  it('does not offer CJK text for prefix expansion', () => {
    expect(parseQuery('東京').lastWord).toBeNull();
  });
});
