/**
 * Porter stemmer (M.F. Porter, 1980), with the two later amendments from his reference
 * implementation (`bli`→`ble`, `logi`→`log`). Input must be lower-case ASCII letters.
 */

const STEP2: Readonly<Record<string, string>> = {
  ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize', bli: 'ble', alli: 'al',
  entli: 'ent', eli: 'e', ousli: 'ous', ization: 'ize', ation: 'ate', ator: 'ate', alism: 'al',
  iveness: 'ive', fulness: 'ful', ousness: 'ous', aliti: 'al', iviti: 'ive', biliti: 'ble', logi: 'log',
};
const STEP3: Readonly<Record<string, string>> = {
  icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic', ful: '', ness: '',
};

// Consonant/vowel patterns; a leading "y" is upper-cased first so it counts as a consonant.
const CONS = '[^aeiou]';
const VOW = '[aeiouy]';
const C = `${CONS}[^aeiouy]*`;
const V = `${VOW}[aeiou]*`;
const M_GT_0 = new RegExp(`^(${C})?${V}${C}`);
const M_EQ_1 = new RegExp(`^(${C})?${V}${C}(${V})?$`);
const M_GT_1 = new RegExp(`^(${C})?${V}${C}${V}${C}`);
const HAS_VOWEL = new RegExp(`^(${C})?${VOW}`);
const CVC = new RegExp(`^${C}${VOW}[^aeiouwxy]$`);

const STEP1A_ES = /^(.+?)(ss|i)es$/;
const STEP1A_S = /^(.+?)([^s])s$/;
const STEP1B_EED = /^(.+?)eed$/;
const STEP1B_ED = /^(.+?)(ed|ing)$/;
const STEP1B_FIX = /(at|bl|iz)$/;
const STEP1B_DOUBLE = /([^aeiouylsz])\1$/;
const STEP1C = /^(.+?)y$/;
const STEP2_RE = new RegExp(`^(.+?)(${Object.keys(STEP2).join('|')})$`);
const STEP3_RE = new RegExp(`^(.+?)(${Object.keys(STEP3).join('|')})$`);
const STEP4_RE = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;
const STEP4_ION = /^(.+?)(s|t)(ion)$/;
const STEP5_E = /^(.+?)e$/;

function stem(word: string): string {
  if (word.length < 3) return word;
  let w = word;
  const startsWithY = w[0] === 'y';
  if (startsWithY) w = 'Y' + w.slice(1);

  // Step 1a — plurals
  if (STEP1A_ES.test(w)) w = w.replace(STEP1A_ES, '$1$2');
  else if (STEP1A_S.test(w)) w = w.replace(STEP1A_S, '$1$2');

  // Step 1b — -eed / -ed / -ing
  const eed = STEP1B_EED.exec(w);
  if (eed) {
    if (M_GT_0.test(eed[1]!)) w = w.slice(0, -1);
  } else {
    const ed = STEP1B_ED.exec(w);
    if (ed && HAS_VOWEL.test(ed[1]!)) {
      w = ed[1]!;
      if (STEP1B_FIX.test(w)) w += 'e';
      else if (STEP1B_DOUBLE.test(w)) w = w.slice(0, -1);
      else if (CVC.test(w)) w += 'e';
    }
  }

  // Step 1c — terminal y
  const y = STEP1C.exec(w);
  if (y && HAS_VOWEL.test(y[1]!)) w = `${y[1]!}i`;

  // Step 2
  const s2 = STEP2_RE.exec(w);
  if (s2 && M_GT_0.test(s2[1]!)) w = s2[1]! + STEP2[s2[2]!]!;

  // Step 3
  const s3 = STEP3_RE.exec(w);
  if (s3 && M_GT_0.test(s3[1]!)) w = s3[1]! + STEP3[s3[2]!]!;

  // Step 4
  const s4 = STEP4_RE.exec(w);
  if (s4) {
    if (M_GT_1.test(s4[1]!)) w = s4[1]!;
  } else {
    const ion = STEP4_ION.exec(w);
    if (ion && M_GT_1.test(ion[1]! + ion[2]!)) w = ion[1]! + ion[2]!;
  }

  // Step 5a — terminal e
  const e = STEP5_E.exec(w);
  if (e && (M_GT_1.test(e[1]!) || (M_EQ_1.test(e[1]!) && !CVC.test(e[1]!)))) w = e[1]!;

  // Step 5b — -ll
  if (/ll$/.test(w) && M_GT_1.test(w)) w = w.slice(0, -1);

  return startsWithY ? 'y' + w.slice(1) : w;
}

export { stem };
