// ─────────────────────────────────────────────────────────────────────────────
// UNICODE LINE BREAK OPPORTUNITY DETECTION
// Simplified UAX #14 (Unicode Line Breaking Algorithm)
// https://unicode.org/reports/tr14/
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Line break classes for Unicode characters.
 * Only includes the classes needed for common Latin/CJK text.
 * Full spec has ~100 classes; this covers the 90% case.
 */
enum LB {
  BK, // Mandatory break (newline, paragraph separator)
  CR, // Carriage return
  LF, // Line feed
  SP, // Space
  ZW, // Zero-width space
  GL, // Glue (non-breaking)
  CB, // Contingent break
  BA, // Break after (hyphen, soft hyphen)
  BB, // Break before
  B2, // Break both (em dash)
  HL, // Hyphen (after hard hyphen)
  OP, // Open punctuation
  CP, // Close punctuation
  QU, // Quotation
  NS, // Non-starter
  AL, // Alphabetic
  NU, // Numeric
  ID, // Ideographic
  IN, // Inseparable
  CM, // Combining mark
  WJ, // Word joiner
  H2, // Hangul LVT syllable
  HT, // Hangul syllable tail
  SA, // South/East Asian
  AI, // Ambiguous (ambiguous width)
  XX, // Unknown
  SY, // Symbols allowing break after
  IS, // Infix numeric separator
  PR, // Prefix numeric
  PO, // Postfix numeric
  EX, // Exclamation
  BB_CLASS, // Break before (conflict with B2 name — use BB_CLASS)
}

/**
 * Classify a Unicode code point into a line break class.
 * Simplified mapping covering Latin, CJK, Hangul, common punctuation, and spaces.
 */
function classify(code: number): LB {
  // ASCII fast path
  if (code < 128) {
    if (code === 0x0A) return LB.LF;      // \n
    if (code === 0x0D) return LB.CR;      // \r
    if (code === 0x20) return LB.SP;      // space
    if (code === 0x21) return LB.EX;      // !
    if (code === 0x22 || code === 0x27) return LB.QU;  // " '
    if (code === 0x28 || code === 0x5B || code === 0x7B) return LB.OP; // ( [ {
    if (code === 0x29 || code === 0x5D || code === 0x7D) return LB.CP; // ) ] }
    if (code === 0x2C) return LB.IS;      // ,
    if (code === 0x2D) return LB.BA;      // - (hyphen)
    if (code === 0x2E) return LB.IS;      // .
    if (code >= 0x30 && code <= 0x39) return LB.NU; // 0-9
    if (code === 0x3A) return LB.IS;      // :
    if (code === 0x3B) return LB.IS;      // ;
    if (code === 0x3F) return LB.EX;      // ?
    if (code === 0x5C) return LB.AL;      // backslash
    return LB.AL; // other ASCII letters and symbols
  }

  // Latin Extended / common punctuation
  if (code >= 0x00A0 && code <= 0x00BF) return LB.AI; // Latin-1 supplement (mostly ambiguous)
  if (code === 0x00A0) return LB.GL;     // NBSP
  if (code === 0x00AD) return LB.BA;     // soft hyphen

  // General punctuation
  if (code >= 0x2000 && code <= 0x200A) return LB.SP; // en/em space, thin space, etc.
  if (code === 0x200B) return LB.ZW;     // zero-width space
  if (code === 0x200D) return LB.GL;     // ZWJ
  if (code === 0x2010 || code === 0x2012 || code === 0x2013) return LB.BA; // hyphen, figure dash, en dash
  if (code === 0x2014) return LB.B2;     // em dash
  if (code === 0x2018 || code === 0x201A || code === 0x201C || code === 0x201E) return LB.OP; // opening quotes
  if (code === 0x2019 || code === 0x201B || code === 0x201D || code === 0x201F) return LB.CP; // closing quotes
  if (code >= 0x2020 && code <= 0x2027) return LB.AI;
  if (code === 0x2028) return LB.BK;     // line separator
  if (code === 0x2029) return LB.BK;     // paragraph separator
  if (code >= 0x2030 && code <= 0x2034) return LB.PO; // permille, etc.
  if (code === 0x2035) return LB.PO;     // prime
  if (code >= 0x2038 && code <= 0x203B) return LB.AI;
  if (code >= 0x203C || code <= 0x203D) return LB.AI;

  // CJK Unified Ideographs (U+4E00–U+9FFF)
  if (code >= 0x4E00 && code <= 0x9FFF) return LB.ID;

  // CJK Extension A
  if (code >= 0x3400 && code <= 0x4DBF) return LB.ID;

  // CJK Compatibility Ideographs
  if (code >= 0xF900 && code <= 0xFAFF) return LB.ID;

  // Hangul Jamo (U+1100–U+115F)
  if (code >= 0x1100 && code <= 0x115F) return LB.ID; // treat as ideographic for break purposes

  // Hangul Syllables (U+AC00–U+D7A3)
  if (code >= 0xAC00 && code <= 0xD7A3) return LB.ID;

  // CJK Symbols and Punctuation
  if (code >= 0x3000 && code <= 0x303F) {
    if (code === 0x3005) return LB.ID; // ideographic iteration mark — allows break
    if (code === 0x300A || code === 0x300C || code === 0x300E || code === 0x3010) return LB.OP;
    if (code === 0x300B || code === 0x300D || code === 0x300F || code === 0x3011) return LB.CP;
    return LB.ID;
  }

  // Fullwidth forms (fullwidth brackets)
  if (code >= 0xFF08 && code <= 0xFF0B) return LB.OP;
  if (code === 0xFF0D) return LB.BA; // fullwidth hyphen
  if (code === 0xFF0C || code === 0xFF0E) return LB.IS;
  if (code >= 0xFF10 && code <= 0xFF19) return LB.NU;
  if (code >= 0xFF1A || code <= 0xFF1B) return LB.IS;
  if (code === 0xFF1F || code === 0xFF01) return LB.EX;
  if (code >= 0xFF3B && code <= 0xFF3D) return LB.OP;
  if (code >= 0xFF5B && code <= 0xFF5D) return LB.OP;

  // Cyrillic — treat as alphabetic
  if (code >= 0x0400 && code <= 0x04FF) return LB.AL;
  if (code >= 0x0500 && code <= 0x052F) return LB.AL;

  // Arabic
  if (code >= 0x0600 && code <= 0x06FF) return LB.AL;

  // Thai
  if (code >= 0x0E00 && code <= 0x0E7F) return LB.SA;

  // Common: soft hyphen, ZWJ, ZWSP
  if (code === 0x200B) return LB.ZW;
  if (code === 0x00AD) return LB.BA;

  // Default
  return LB.XX;
}

// ─────────────────────────────────────────────────────────────────────────────
// LINE BREAK OPPORTUNITIES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents a break opportunity in a text run.
 */
export interface BreakOpportunity {
  /** Character index where the break can occur (before this character). */
  index: number;
  /** Is this a mandatory break (newline, paragraph separator)? */
  mandatory: boolean;
}

/**
 * Finds all line break opportunities in a text string.
 *
 * Returns an array of BreakOpportunity objects. Each represents a position
 * where a line break MAY or MUST occur.
 *
 * This is a simplified UAX #14 implementation covering:
 * - Mandatory breaks (newline, CR/LF)
 * - Spaces (break after space)
 * - Hyphens and dashes
 * - CJK ideographic boundaries
 * - Open/close punctuation
 * - Word boundaries (Latin letters)
 */
export function findBreakOpportunities(text: string): BreakOpportunity[] {
  const breaks: BreakOpportunity[] = [];
  if (!text || text.length === 0) return breaks;

  // Always allow a break at position 0 (empty line start)
  breaks.push({ index: 0, mandatory: false });

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const cls = classify(code);

    switch (cls) {
      // Mandatory breaks
      case LB.BK:
      case LB.LF:
      case LB.CR:
        breaks.push({ index: i + 1, mandatory: true });
        break;

      // Spaces — break opportunity AFTER the space
      case LB.SP:
        breaks.push({ index: i + 1, mandatory: false });
        break;

      // Zero-width space — break opportunity at this exact position
      case LB.ZW:
        breaks.push({ index: i, mandatory: false });
        break;

      // Break after: hyphens, soft hyphens
      case LB.BA:
        breaks.push({ index: i + 1, mandatory: false });
        break;

      // Break both: em dash
      case LB.B2:
        breaks.push({ index: i + 1, mandatory: false });
        break;

      // Ideographic — break BEFORE ideographic characters (opportunity at i)
      case LB.ID:
        if (i > 0) {
          breaks.push({ index: i, mandatory: false });
        }
        break;

      // Close punctuation — break opportunity AFTER
      case LB.CP:
      case LB.EX:
        breaks.push({ index: i + 1, mandatory: false });
        break;

      // Open punctuation — break opportunity BEFORE
      case LB.OP:
        if (i > 0) {
          breaks.push({ index: i, mandatory: false });
        }
        break;

      // Numeric sequences — break at word boundaries
      case LB.NU:
        // Check if next char is different class (word boundary)
        if (i + 1 < text.length) {
          const nextCls = classify(text.charCodeAt(i + 1));
          if (nextCls !== LB.NU && nextCls !== LB.IS && nextCls !== LB.PR && nextCls !== LB.PO) {
            breaks.push({ index: i + 1, mandatory: false });
          }
        }
        break;

      case LB.AL:
        // Alphabetic — break at word boundary
        if (i + 1 < text.length) {
          const nextCls = classify(text.charCodeAt(i + 1));
          if (nextCls !== LB.AL && nextCls !== LB.CM && nextCls !== LB.NU) {
            breaks.push({ index: i + 1, mandatory: false });
          }
        }
        break;

      // Glue (non-breaking) — no break opportunity
      case LB.GL:
      case LB.WJ:
        break;

      default:
        break;
    }
  }

  // Sort by index and deduplicate
  breaks.sort((a, b) => a.index - b.index);
  const deduped: BreakOpportunity[] = [];
  let last = -1;
  for (const b of breaks) {
    if (b.index !== last) {
      deduped.push(b);
      last = b.index;
    }
  }

  // Always allow a break at the end
  const endIdx = text.length;
  if (deduped.length === 0 || deduped[deduped.length - 1]!.index !== endIdx) {
    deduped.push({ index: endIdx, mandatory: false });
  }

  return deduped;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEGMENTATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A segment of text between break opportunities.
 */
export interface TextSegment {
  /** The text content of this segment. */
  text: string;
  /** Start index in the original string. */
  start: number;
  /** End index in the original string (exclusive). */
  end: number;
  /** Is there a mandatory break opportunity after this segment? */
  mandatoryBreak: boolean;
  /** Is there a line break opportunity after this segment? */
  breakOpportunity: boolean;
}

/**
 * Segments text into chunks separated by break opportunities.
 * Each segment is a contiguous run of characters that should NOT be
 * broken across lines (unless no other opportunity exists).
 */
export function segmentText(text: string): TextSegment[] {
  if (!text || text.length === 0) return [];

  const opportunities = findBreakOpportunities(text);
  const segments: TextSegment[] = [];

  for (let i = 0; i < opportunities.length - 1; i++) {
    const start = opportunities[i]!.index;
    const end = opportunities[i + 1]!.index;
    if (start === end) continue; // skip empty

    segments.push({
      text: text.slice(start, end),
      start,
      end,
      mandatoryBreak: opportunities[i + 1]!.mandatory,
      breakOpportunity: true,
    });
  }

  return segments;
}
