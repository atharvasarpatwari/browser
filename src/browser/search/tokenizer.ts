import { stem } from './porter-stemmer';

/**
 * Curated union of English, French, German and Spanish stop words (diacritics stripped, to match
 * the normalised tokens). Entries that are also common English content words — "war", "hat", "die",
 * "car", "son", "mit", "uber", "sans", "sin", "era" — are deliberately left out.
 */
const STOP_WORDS: ReadonlySet<string> = new Set((
  // English
  'about above after again against all am an and any are as at be because been before being below between both ' +
  'but by can did do does doing down during each few for from further had has have having he her here hers ' +
  'herself him himself his how if in into is it its itself just me more most my myself no nor not now of off ' +
  'on once only or other our ours ourselves out over own same she should so some such than that the their ' +
  'theirs them themselves then there these they this those through to too under until up very was we were ' +
  'what when where which while who whom why will with you your yours yourself yourselves dont cant wont ' +
  // French
  'le la les un une des du de et en au aux ce ces cet cette dans pour sur avec sous sont etre avoir ont qui ' +
  'que quoi dont ou mais donc ni ne pas se sa ses leur leurs il elle ils elles nous vous je tu te lui ' +
  // German
  'der das den dem des ein eine einer eines einem einen und oder aber nicht ist sind waren sein ihr ihre ' +
  'zu zum zur von vom bei nach aus auf fur um im am es sie er wir ich du wie als auch noch nur wenn dann ' +
  'doch schon mehr sehr kann wird werden wurde haben hatte ' +
  // Spanish
  'el los las unos unas una pero del con por para sobre entre es ser estar esta este estos estas su sus lo le ' +
  'les mi nos al como muy ya si han hay fue'
).split(' '));

const CJK = String.raw`\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}`;
const TOKEN_RE = new RegExp(`[${CJK}]+|(?:(?![${CJK}])[\\p{L}\\p{N}])+`, 'gu');
const CJK_RUN_RE = new RegExp(`^[${CJK}]+$`, 'u');
const MAX_TOKEN_LENGTH = 40;

interface Token {
  /** Index term: normalised, optionally stemmed. */
  readonly term: string;
  /** Normalised, unstemmed form (what a typed prefix is compared against). */
  readonly norm: string;
  /** Offsets of the originating word in the source text. */
  readonly start: number;
  readonly end: number;
}

interface TokenizeOptions {
  readonly stopWords?: boolean;
  readonly stem?: boolean;
}

/** Strips diacritics and lower-cases. */
function normalizeWord(word: string): string {
  return word.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

// ponytail: CJK has no word spaces, so runs are indexed as character bigrams (single characters stay
// whole). A dictionary segmenter (Intl.Segmenter) would be more precise but isn't in this TS lib target.
function cjkTerms(run: string): string[] {
  const chars = Array.from(run.normalize('NFKC'));
  if (chars.length === 1) return chars;
  const out: string[] = [];
  for (let i = 0; i < chars.length - 1; i++) out.push(chars[i]! + chars[i + 1]!);
  return out;
}

/** Tokenises `text` into index terms with their source offsets. */
function scanTokens(text: string, options: TokenizeOptions = {}): Token[] {
  const useStop = options.stopWords ?? true;
  const useStem = options.stem ?? true;
  const out: Token[] = [];
  for (const m of text.matchAll(TOKEN_RE)) {
    const raw = m[0];
    const start = m.index ?? 0;
    const end = start + raw.length;
    if (CJK_RUN_RE.test(raw)) {
      for (const term of cjkTerms(raw)) out.push({ term, norm: term, start, end });
      continue;
    }
    const norm = normalizeWord(raw);
    if (norm.length === 0 || norm.length > MAX_TOKEN_LENGTH) continue;
    if (norm.length === 1 && !/\d/.test(norm)) continue;
    if (useStop && STOP_WORDS.has(norm)) continue;
    out.push({ term: useStem && /^[a-z]+$/.test(norm) ? stem(norm) : norm, norm, start, end });
  }
  return out;
}

/** Index terms for `text` (stop words removed, stemmed). */
function tokenize(text: string, options?: TokenizeOptions): string[] {
  return scanTokens(text, options).map((t) => t.term);
}

interface ParsedQuery {
  /** Distinct index terms, in typed order. */
  readonly terms: string[];
  /** Normalised, unstemmed last word — expanded by prefix when searching as-you-type. */
  readonly lastWord: string | null;
}

/**
 * Same pipeline as indexing. If everything was a stop word ("the who"), fall back to the
 * unfiltered words so the query still matches something.
 */
function parseQuery(text: string): ParsedQuery {
  let tokens = scanTokens(text);
  if (tokens.length === 0) tokens = scanTokens(text, { stopWords: false });
  const terms = [...new Set(tokens.map((t) => t.term))];
  const last = tokens[tokens.length - 1];
  return { terms, lastWord: last && !CJK_RUN_RE.test(last.norm) ? last.norm : null };
}

export { tokenize, scanTokens, parseQuery, normalizeWord, STOP_WORDS };
export type { Token, TokenizeOptions, ParsedQuery };
