/**
 * @file html5/encoding.ts
 *
 * Encoding detection (charset sniffing) for the HTML5 parser.
 * Implements a simplified version of the WHATWG encoding sniffing algorithm
 * (§13.2.3.1): BOM → Content-Type header → <meta charset> prescan → UTF-8 fallback.
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface SniffResult {
  /** Detected or fallback charset label (normalized, lower-cased). */
  charset: string;
  /** Number of bytes consumed by BOM (0 if no BOM). */
  bomSize: number;
  /** Which step determined the charset. */
  source: 'bom' | 'content-type' | 'meta' | 'default';
}

export interface DecodeResult {
  /** Decoded text string. */
  text: string;
  /** Charset used for decoding. */
  charset: string;
  /** Which step determined the charset. */
  source: SniffResult['source'];
}

export interface SniffOptions {
  /** Content-Type header value, e.g. "text/html; charset=windows-1252". */
  contentType?: string;
  /** Page URL (reserved for future use with base URL resolution). */
  url?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHARSET NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps common charset labels to TextDecoder-compatible names.
 * Browsers treat ISO-8859-1 and US-ASCII as windows-1252 for legacy compat.
 */
const CHARSET_ALIASES: ReadonlyMap<string, string> = new Map([
  // UTF family
  ['utf-8',         'utf-8'],
  ['utf8',          'utf-8'],
  ['unicode-1-1-utf-8', 'utf-8'],

  // Windows code pages
  ['windows-1252',  'windows-1252'],
  ['cp1252',        'windows-1252'],
  ['x-cp1252',      'windows-1252'],
  ['iso-8859-1',    'windows-1252'],
  ['latin1',        'windows-1252'],
  ['latin',         'windows-1252'],
  ['us-ascii',      'windows-1252'],
  ['ascii',         'windows-1252'],
  ['iso646-us',     'windows-1252'],
  ['iso-ir-6',      'windows-1252'],
  ['ansi_x3.4-1968','windows-1252'],
  ['cp367',         'windows-1252'],
  ['csascii',       'windows-1252'],

  ['windows-1250',  'windows-1250'],
  ['cp1250',        'windows-1250'],
  ['x-cp1250',      'windows-1250'],
  ['iso-8859-2',    'windows-1250'],

  ['windows-1251',  'windows-1251'],
  ['cp1251',        'windows-1251'],
  ['x-cp1251',      'windows-1251'],
  ['iso-8859-5',    'windows-1251'],
  ['koi8-r',        'koi8-r'],
  ['koi8-ru',       'koi8-r'],

  ['windows-1253',  'windows-1253'],
  ['cp1253',        'windows-1253'],
  ['iso-8859-7',    'windows-1253'],

  ['windows-1254',  'windows-1254'],
  ['cp1254',        'windows-1254'],
  ['iso-8859-9',    'windows-1254'],

  ['windows-1255',  'windows-1255'],
  ['cp1255',        'windows-1255'],
  ['iso-8859-8',    'windows-1255'],

  ['windows-1256',  'windows-1256'],
  ['cp1256',        'windows-1256'],
  ['iso-8859-6',    'windows-1256'],

  ['windows-1257',  'windows-1257'],
  ['cp1257',        'windows-1257'],
  ['iso-8859-13',   'windows-1257'],

  ['windows-1258',  'windows-1258'],
  ['cp1258',        'windows-1258'],
  ['iso-8859-10',   'windows-1258'],

  // Other ISO 8859
  ['iso-8859-3',    'iso-8859-3'],
  ['iso-8859-4',    'iso-8859-4'],
  ['iso-8859-14',   'iso-8859-14'],
  ['iso-8859-15',   'iso-8859-15'],
  ['iso-8859-16',   'iso-8859-16'],

  // Mac
  ['macintosh',     'macintosh'],
  ['mac',           'macintosh'],
  ['x-mac-roman',   'macintosh'],

  // EBCDIC
  ['ibm866',        'ibm866'],
  ['cp866',         'ibm866'],

  // Cyrillic
  ['koi8-u',        'koi8-u'],

  // CJK (common labels)
  ['shift_jis',     'shift_jis'],
  ['shift-jis',     'shift_jis'],
  ['ms932',         'shift_jis'],
  ['ms-kanji',      'shift_jis'],
  ['sjis',          'shift_jis'],
  ['x-sjis',        'shift_jis'],

  ['euc-jp',        'euc-jp'],
  ['x-euc-jp',      'euc-jp'],

  ['iso-2022-jp',   'iso-2022-jp'],
  ['csiso2022jp',   'iso-2022-jp'],

  ['euc-kr',        'euc-kr'],
  ['euckr',         'euc-kr'],
  ['iso-2022-kr',   'euc-kr'],

  ['gb2312',        'gb2312'],
  ['gbk',           'gbk'],
  ['gb18030',       'gb18030'],
  ['chinese',       'gb2312'],

  ['big5',          'big5'],
  ['big5-hkscs',    'big5'],
  ['zh-big5',       'big5'],

  ['iso-2022-cn',   'gb2312'],

  // Vietnamese
  ['vietnamese',    'windows-1258'],
]);

/**
 * Normalize a charset label to a TextDecoder-compatible name.
 * Returns 'utf-8' for unrecognized labels.
 */
export function normalizeCharset(label: string): string {
  const normalized = label.trim().toLowerCase().replace(/[\s_-]/g, '');
  // Direct lookup first (after stripping separators)
  for (const [alias, canonical] of CHARSET_ALIASES) {
    if (alias.replace(/[\s_-]/g, '') === normalized) {
      return canonical;
    }
  }
  return 'utf-8';
}

// ─────────────────────────────────────────────────────────────────────────────
// BOM DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect a Byte Order Mark at the start of the byte stream.
 * UTF-32 is checked before UTF-16 because UTF-32 LE starts with FF FE.
 */
export function detectBOM(data: Uint8Array): { charset: string; size: number } | null {
  if (data.length === 0) return null;

  // UTF-32 LE: FF FE 00 00
  if (data.length >= 4 && data[0] === 0xFF && data[1] === 0xFE && data[2] === 0x00 && data[3] === 0x00) {
    return { charset: 'utf-32le', size: 4 };
  }

  // UTF-32 BE: 00 00 FE FF
  if (data.length >= 4 && data[0] === 0x00 && data[1] === 0x00 && data[2] === 0xFE && data[3] === 0xFF) {
    return { charset: 'utf-32be', size: 4 };
  }

  // UTF-8: EF BB BF
  if (data.length >= 3 && data[0] === 0xEF && data[1] === 0xBB && data[2] === 0xBF) {
    return { charset: 'utf-8', size: 3 };
  }

  // UTF-16 LE: FF FE
  if (data.length >= 2 && data[0] === 0xFF && data[1] === 0xFE) {
    return { charset: 'utf-16le', size: 2 };
  }

  // UTF-16 BE: FE FF
  if (data.length >= 2 && data[0] === 0xFE && data[1] === 0xFF) {
    return { charset: 'utf-16be', size: 2 };
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT-TYPE PARSING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the charset parameter from a Content-Type header value.
 * Returns null if no charset is specified.
 *
 * Examples:
 *   "text/html; charset=windows-1252" → "windows-1252"
 *   "text/html; charset=UTF-8"        → "utf-8"
 *   "text/html"                       → null
 *   "text/html;charset=iso-8859-1"    → "iso-8859-1"
 */
export function charsetFromContentType(contentType: string): string | null {
  if (!contentType) return null;
  const match = /charset=([^\s;]+)/i.exec(contentType);
  if (!match) return null;
  return match[1]!.trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMPLIFIED META CHARSET PRESCAN
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scan the first 1024 bytes of raw input for a <meta charset> declaration.
 *
 * This is a simplified version of the WHATWG §13.2.3.1 prescan algorithm.
 * It works for ASCII-compatible encodings by only examining bytes in the
 * 0x00–0x7F range (which are the same in all such encodings).
 *
 * Handles:
 *   - <meta charset="utf-8">
 *   - <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
 *   - Various quoting styles (single, double, unquoted)
 *   - Whitespace variations
 *
 * Does NOT handle:
 *   - Non-ASCII-compatible encodings
 *   - Double-encoded charset declarations
 *   - Character references in attribute values
 */
export function prescanMetaCharset(data: Uint8Array): string | null {
  const limit = Math.min(data.length, 1024);

  let i = 0;

  while (i < limit) {
    const byte = data[i]!;

    // Skip non-ASCII bytes (they don't appear in tag syntax for ASCII-compatible encodings)
    if (byte > 0x7F) {
      i++;
      continue;
    }

    // Look for '<'
    if (byte !== 0x3C) { // '<'
      i++;
      continue;
    }

    // Check if followed by 'm' or 'M' (start of "meta")
    if (i + 4 >= limit) break;
    const c1 = String.fromCharCode(data[i + 1]!);
    const c2 = String.fromCharCode(data[i + 2]!);
    if (c1.toLowerCase() !== 'm' || c2.toLowerCase() !== 'e') {
      i++;
      continue;
    }
    const c3 = String.fromCharCode(data[i + 3]!);
    const c4 = String.fromCharCode(data[i + 4]!);
    if (c3.toLowerCase() !== 't' || c4.toLowerCase() !== 'a') {
      i++;
      continue;
    }

    // Found "<meta" — must be followed by whitespace or '/' or '>'
    const afterMeta = i + 5;
    if (afterMeta >= limit) break;
    const next = String.fromCharCode(data[afterMeta]!);
    if (next !== ' ' && next !== '\t' && next !== '\n' && next !== '\r' && next !== '/' && next !== '>') {
      i++;
      continue;
    }

    // Scan attributes within this <meta ... > tag
    i = afterMeta;
    let foundCharset = false;
    let foundHttpEquiv = false;

    // Advance to end of tag
    while (i < limit) {
      const b = data[i]!;
      if (b > 0x7F) { i++; continue; }

      const ch = String.fromCharCode(b);

      // End of tag
      if (ch === '>') break;

      // Self-closing
      if (ch === '/' && i + 1 < limit && String.fromCharCode(data[i + 1]!) === '>') break;

      // Skip whitespace
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
        i++;
        continue;
      }

      // Read attribute name
      const attrStart = i;
      while (i < limit) {
        const ab = data[i]!;
        if (ab > 0x7F || ab === 0x3D || ab === 0x20 || ab === 0x09 || ab === 0x0A || ab === 0x0D || ab === 0x2F || ab === 0x3E) break;
        i++;
      }
      const attrName = bytesToAsciiLowerCase(data, attrStart, i).replace(/[\s_-]/g, '');

      if (attrName.length === 0) { i++; continue; }

      // Skip whitespace before '='
      while (i < limit) {
        const wb = data[i]!;
        if (wb !== 0x20 && wb !== 0x09 && wb !== 0x0A && wb !== 0x0D) break;
        i++;
      }

      // Check for '='
      if (i >= limit || String.fromCharCode(data[i]!) !== '=') {
        continue;
      }
      i++; // skip '='

      // Skip whitespace after '='
      while (i < limit) {
        const wb = data[i]!;
        if (wb !== 0x20 && wb !== 0x09 && wb !== 0x0A && wb !== 0x0D) break;
        i++;
      }

      if (i >= limit) break;

      // Read attribute value
      const quoteChar = data[i]!;
      let valueStart: number;
      let valueEnd: number;

      if (quoteChar === 0x22 || quoteChar === 0x27) {
        // Quoted value
        i++; // skip opening quote
        valueStart = i;
        while (i < limit && data[i] !== quoteChar) i++;
        valueEnd = i;
        if (i < limit) i++; // skip closing quote
      } else {
        // Unquoted value
        valueStart = i;
        while (i < limit) {
          const vb = data[i]!;
          if (vb === 0x20 || vb === 0x09 || vb === 0x0A || vb === 0x0D || vb === 0x3E || vb === 0x2F) break;
          i++;
        }
        valueEnd = i;
      }

      const value = bytesToAsciiLowerCase(data, valueStart, valueEnd);

      if (attrName === 'charset') {
        const charset = normalizeCharset(value);
        return charset;
      }

      if (attrName === 'httpequiv') {
        foundHttpEquiv = value === 'content-type';
      }

      if (attrName === 'content' && foundHttpEquiv) {
        // Extract charset from content attribute: "text/html; charset=utf-8"
        const charsetMatch = /charset=([^\s;]+)/i.exec(value);
        if (charsetMatch) {
          return normalizeCharset(charsetMatch[1]!);
        }
      }
    }

    i++;
  }

  return null;
}

/** Convert a byte range to a lowercased ASCII string. */
function bytesToAsciiLowerCase(data: Uint8Array, start: number, end: number): string {
  let result = '';
  for (let j = start; j < end; j++) {
    const b = data[j]!;
    if (b >= 0x41 && b <= 0x5A) {
      result += String.fromCharCode(b + 32); // toLowerCase for A-Z
    } else {
      result += String.fromCharCode(b);
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENCODING SNIFFING ALGORITHM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect the encoding of a byte stream using the simplified WHATWG algorithm.
 *
 * Priority:
 *   1. BOM (highest)
 *   2. Content-Type header charset parameter
 *   3. <meta charset> / <meta http-equiv="Content-Type"> in first 1024 bytes
 *   4. UTF-8 (default fallback)
 */
export function sniffEncoding(data: Uint8Array, options?: SniffOptions): SniffResult {
  // Step 1: BOM
  const bom = detectBOM(data);
  if (bom) {
    return { charset: bom.charset, bomSize: bom.size, source: 'bom' };
  }

  // Step 2: Content-Type header
  if (options?.contentType) {
    const ctCharset = charsetFromContentType(options.contentType);
    if (ctCharset) {
      return { charset: normalizeCharset(ctCharset), bomSize: 0, source: 'content-type' };
    }
  }

  // Step 3: Meta prescan
  const metaCharset = prescanMetaCharset(data);
  if (metaCharset) {
    return { charset: metaCharset, bomSize: 0, source: 'meta' };
  }

  // Step 4: Default
  return { charset: 'utf-8', bomSize: 0, source: 'default' };
}

// ─────────────────────────────────────────────────────────────────────────────
// BYTE DECODING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Decode a Uint8Array to a string, detecting encoding automatically.
 *
 * BOM bytes are stripped from the output. If the requested encoding is not
 * supported by the runtime's TextDecoder, falls back to UTF-8.
 */
export function decodeBytes(data: Uint8Array, options?: SniffOptions): DecodeResult {
  const sniff = sniffEncoding(data, options);

  try {
    const decoder = new TextDecoder(sniff.charset, { fatal: false });
    const decoded = decoder.decode(
      sniff.bomSize > 0 ? data.subarray(sniff.bomSize) : data,
    );
    return { text: decoded, charset: sniff.charset, source: sniff.source };
  } catch {
    // Encoding not supported by this runtime — fall back to UTF-8
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const decoded = decoder.decode(
      sniff.bomSize > 0 ? data.subarray(sniff.bomSize) : data,
    );
    return { text: decoded, charset: 'utf-8', source: sniff.source };
  }
}
