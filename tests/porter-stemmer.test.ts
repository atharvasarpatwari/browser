import { describe, it, expect } from 'vitest';
import { stem } from '../src/browser/search/porter-stemmer';

// Canonical examples from Porter (1980), "An algorithm for suffix stripping", run through the whole stemmer.
const VECTORS: Array<[string, string]> = [
  // step 1a
  ['caresses', 'caress'], ['ponies', 'poni'], ['ties', 'ti'], ['caress', 'caress'], ['cats', 'cat'],
  // step 1b
  ['feed', 'feed'], ['agreed', 'agre'], ['plastered', 'plaster'], ['bled', 'bled'], ['motoring', 'motor'],
  ['sing', 'sing'], ['conflated', 'conflat'], ['troubled', 'troubl'], ['sized', 'size'], ['hopping', 'hop'],
  ['tanned', 'tan'], ['falling', 'fall'], ['hissing', 'hiss'], ['fizzed', 'fizz'], ['failing', 'fail'],
  ['filing', 'file'],
  // step 1c
  ['happy', 'happi'], ['sky', 'sky'],
  // steps 2–3
  ['relational', 'relat'], ['conditional', 'condit'], ['rational', 'ration'], ['valenci', 'valenc'],
  ['hesitanci', 'hesit'], ['digitizer', 'digit'], ['conformabli', 'conform'], ['radicalli', 'radic'],
  ['differentli', 'differ'], ['vileli', 'vile'], ['analogousli', 'analog'], ['vietnamization', 'vietnam'],
  ['predication', 'predic'], ['operator', 'oper'], ['feudalism', 'feudal'], ['decisiveness', 'decis'],
  ['hopefulness', 'hope'], ['callousness', 'callous'], ['formaliti', 'formal'], ['sensitiviti', 'sensit'],
  ['sensibiliti', 'sensibl'], ['triplicate', 'triplic'], ['formative', 'form'], ['formalize', 'formal'],
  ['electriciti', 'electr'], ['electrical', 'electr'], ['hopeful', 'hope'], ['goodness', 'good'],
  // step 4
  ['revival', 'reviv'], ['allowance', 'allow'], ['inference', 'infer'], ['airliner', 'airlin'],
  ['gyroscopic', 'gyroscop'], ['adjustable', 'adjust'], ['defensible', 'defens'], ['irritant', 'irrit'],
  ['replacement', 'replac'], ['adjustment', 'adjust'], ['dependent', 'depend'], ['adoption', 'adopt'],
  ['homologou', 'homolog'], ['communism', 'commun'], ['activate', 'activ'], ['angulariti', 'angular'],
  ['homologous', 'homolog'], ['effective', 'effect'], ['bowdlerize', 'bowdler'],
  // step 5
  ['probate', 'probat'], ['rate', 'rate'], ['cease', 'ceas'], ['controll', 'control'], ['roll', 'roll'],
];

describe('Porter stemmer', () => {
  it.each(VECTORS)('%s → %s', (word, expected) => {
    expect(stem(word)).toBe(expected);
  });

  it('leaves words shorter than three letters alone', () => {
    expect(stem('is')).toBe('is');
    expect(stem('a')).toBe('a');
    expect(stem('')).toBe('');
  });

  it('treats a leading y as a consonant', () => {
    expect(stem('yes')).toBe('ye');
    expect(stem('youngest')).toBe('youngest');
  });

  it('conflates inflections of the same word', () => {
    const forms = ['connect', 'connected', 'connecting', 'connection', 'connections'];
    expect(new Set(forms.map(stem)).size).toBe(1);
    expect(stem('run')).toBe(stem('running'));
    expect(stem('search')).toBe(stem('searches'));
    expect(stem('search')).toBe(stem('searching'));
  });

  it('is idempotent on typical stems', () => {
    for (const w of ['connect', 'relat', 'adjust', 'comput', 'program']) expect(stem(stem(w))).toBe(stem(w));
  });
});
