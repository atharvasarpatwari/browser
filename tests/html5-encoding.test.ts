/**
 * @file tests/html5-encoding.test.ts
 *
 * Comprehensive tests for the HTML5 encoding detection (charset sniffing) module.
 * Covers BOM detection, Content-Type parsing, <meta charset> prescan,
 * charset normalization, encoding sniffing priority, byte decoding,
 * and parseBytes() integration.
 */

import { describe, it, expect } from 'vitest';
import {
  detectBOM,
  charsetFromContentType,
  prescanMetaCharset,
  normalizeCharset,
  sniffEncoding,
  decodeBytes,
} from '../src/browser/rendering/html5/encoding';
import { HtmlParser } from '../src/browser/rendering/html-parser';

function strToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

// ─────────────────────────────────────────────────────────────────────────────
// BOM DETECTION
// ─────────────────────────────────────────────────────────────────────────────

describe('detectBOM', () => {
  it('should detect UTF-8 BOM', () => {
    const data = new Uint8Array([0xEF, 0xBB, 0xBF, 0x48, 0x54, 0x4D]);
    const result = detectBOM(data);
    expect(result).toEqual({ charset: 'utf-8', size: 3 });
  });

  it('should detect UTF-16 LE BOM', () => {
    const data = new Uint8Array([0xFF, 0xFE, 0x48, 0x00]);
    const result = detectBOM(data);
    expect(result).toEqual({ charset: 'utf-16le', size: 2 });
  });

  it('should detect UTF-16 BE BOM', () => {
    const data = new Uint8Array([0xFE, 0xFF, 0x00, 0x48]);
    const result = detectBOM(data);
    expect(result).toEqual({ charset: 'utf-16be', size: 2 });
  });

  it('should detect UTF-32 LE BOM (FF FE 00 00)', () => {
    const data = new Uint8Array([0xFF, 0xFE, 0x00, 0x00, 0x48]);
    const result = detectBOM(data);
    expect(result).toEqual({ charset: 'utf-32le', size: 4 });
  });

  it('should detect UTF-32 BE BOM (00 00 FE FF)', () => {
    const data = new Uint8Array([0x00, 0x00, 0xFE, 0xFF, 0x00]);
    const result = detectBOM(data);
    expect(result).toEqual({ charset: 'utf-32be', size: 4 });
  });

  it('should return null when no BOM is present', () => {
    const data = strToBytes('<!DOCTYPE html>');
    expect(detectBOM(data)).toBeNull();
  });

  it('should return null for empty data', () => {
    expect(detectBOM(new Uint8Array(0))).toBeNull();
  });

  it('should return null for single byte', () => {
    expect(detectBOM(new Uint8Array([0xEF]))).toBeNull();
  });

  it('should prioritize UTF-32 LE over UTF-16 LE (both start with FF FE)', () => {
    const data = new Uint8Array([0xFF, 0xFE, 0x00, 0x00]);
    const result = detectBOM(data);
    expect(result?.charset).toBe('utf-32le');
  });

  it('should handle partial BOM (only first 2 bytes of UTF-8 BOM)', () => {
    const data = new Uint8Array([0xEF, 0xBB]);
    expect(detectBOM(data)).toBeNull();
  });

  it('should handle partial UTF-32 BOM (3 bytes)', () => {
    const data = new Uint8Array([0xFF, 0xFE, 0x00]);
    // Only 3 bytes — not enough for UTF-32 (needs 4), but enough for UTF-16
    const result = detectBOM(data);
    expect(result).toEqual({ charset: 'utf-16le', size: 2 });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTENT-TYPE CHARSET EXTRACTION
// ─────────────────────────────────────────────────────────────────────────────

describe('charsetFromContentType', () => {
  it('should extract charset from Content-Type with charset parameter', () => {
    expect(charsetFromContentType('text/html; charset=windows-1252')).toBe('windows-1252');
  });

  it('should handle uppercase charset', () => {
    expect(charsetFromContentType('text/html; charset=UTF-8')).toBe('utf-8');
  });

  it('should handle charset without spaces around semicolon', () => {
    expect(charsetFromContentType('text/html;charset=iso-8859-1')).toBe('iso-8859-1');
  });

  it('should return null when no charset is specified', () => {
    expect(charsetFromContentType('text/html')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(charsetFromContentType('')).toBeNull();
  });

  it('should handle charset with extra parameters', () => {
    expect(charsetFromContentType('text/html; charset=utf-8; boundary=something')).toBe('utf-8');
  });

  it('should handle charset with trailing whitespace', () => {
    expect(charsetFromContentType('text/html; charset=gbk ')).toBe('gbk');
  });

  it('should handle charset in mixed case', () => {
    expect(charsetFromContentType('text/html; Charset=Shift_JIS')).toBe('shift_jis');
  });

  it('should handle application/xhtml+xml', () => {
    expect(charsetFromContentType('application/xhtml+xml; charset=utf-8')).toBe('utf-8');
  });

  it('should handle charset as first parameter', () => {
    expect(charsetFromContentType('text/html; charset=big5; q=0.9')).toBe('big5');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHARSET NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCharset', () => {
  it('should normalize "utf-8"', () => {
    expect(normalizeCharset('utf-8')).toBe('utf-8');
  });

  it('should normalize "UTF-8" (uppercase)', () => {
    expect(normalizeCharset('UTF-8')).toBe('utf-8');
  });

  it('should normalize "utf8" (no separator)', () => {
    expect(normalizeCharset('utf8')).toBe('utf-8');
  });

  it('should normalize "cp1252" to "windows-1252"', () => {
    expect(normalizeCharset('cp1252')).toBe('windows-1252');
  });

  it('should normalize "iso-8859-1" to "windows-1252" (browser compat)', () => {
    expect(normalizeCharset('iso-8859-1')).toBe('windows-1252');
  });

  it('should normalize "latin1" to "windows-1252"', () => {
    expect(normalizeCharset('latin1')).toBe('windows-1252');
  });

  it('should normalize "us-ascii" to "windows-1252"', () => {
    expect(normalizeCharset('us-ascii')).toBe('windows-1252');
  });

  it('should normalize "ascii" to "windows-1252"', () => {
    expect(normalizeCharset('ascii')).toBe('windows-1252');
  });

  it('should normalize "shift_jis"', () => {
    expect(normalizeCharset('shift_jis')).toBe('shift_jis');
  });

  it('should normalize "shift-jis" (hyphen)', () => {
    expect(normalizeCharset('shift-jis')).toBe('shift_jis');
  });

  it('should normalize "EUC-JP"', () => {
    expect(normalizeCharset('EUC-JP')).toBe('euc-jp');
  });

  it('should normalize "gb2312"', () => {
    expect(normalizeCharset('gb2312')).toBe('gb2312');
  });

  it('should normalize "gbk"', () => {
    expect(normalizeCharset('gbk')).toBe('gbk');
  });

  it('should normalize "big5"', () => {
    expect(normalizeCharset('big5')).toBe('big5');
  });

  it('should normalize "koi8-r"', () => {
    expect(normalizeCharset('koi8-r')).toBe('koi8-r');
  });

  it('should normalize "iso-8859-15"', () => {
    expect(normalizeCharset('iso-8859-15')).toBe('iso-8859-15');
  });

  it('should fallback to utf-8 for unknown charset', () => {
    expect(normalizeCharset('x-unknown-encoding')).toBe('utf-8');
  });

  it('should fallback to utf-8 for empty string', () => {
    expect(normalizeCharset('')).toBe('utf-8');
  });

  it('should handle whitespace in label', () => {
    expect(normalizeCharset('utf - 8')).toBe('utf-8');
  });

  it('should handle "windows-1250"', () => {
    expect(normalizeCharset('windows-1250')).toBe('windows-1250');
  });

  it('should handle "windows-1251"', () => {
    expect(normalizeCharset('windows-1251')).toBe('windows-1251');
  });

  it('should handle "ibm866"', () => {
    expect(normalizeCharset('ibm866')).toBe('ibm866');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// META CHARSET PRESCAN
// ─────────────────────────────────────────────────────────────────────────────

describe('prescanMetaCharset', () => {
  it('should detect <meta charset="utf-8">', () => {
    const data = strToBytes('<meta charset="utf-8">');
    expect(prescanMetaCharset(data)).toBe('utf-8');
  });

  it('should detect <meta charset="utf-8"/> (self-closing)', () => {
    const data = strToBytes('<meta charset="utf-8"/>');
    expect(prescanMetaCharset(data)).toBe('utf-8');
  });

  it('should detect <meta charset="windows-1252">', () => {
    const data = strToBytes('<meta charset="windows-1252">');
    expect(prescanMetaCharset(data)).toBe('windows-1252');
  });

  it('should detect <meta charset=\'utf-8\'> (single quotes)', () => {
    const data = strToBytes("<meta charset='utf-8'>");
    expect(prescanMetaCharset(data)).toBe('utf-8');
  });

  it('should detect <meta charset=utf-8> (unquoted)', () => {
    const data = strToBytes('<meta charset=utf-8>');
    expect(prescanMetaCharset(data)).toBe('utf-8');
  });

  it('should detect <META CHARSET="UTF-8"> (uppercase)', () => {
    const data = strToBytes('<META CHARSET="UTF-8">');
    expect(prescanMetaCharset(data)).toBe('utf-8');
  });

  it('should detect <meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">', () => {
    const data = strToBytes('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1">');
    expect(prescanMetaCharset(data)).toBe('windows-1252');
  });

  it('should detect http-equiv with mixed case', () => {
    const data = strToBytes('<meta HTTP-EQUIV="content-type" content="text/html; charset=gbk">');
    expect(prescanMetaCharset(data)).toBe('gbk');
  });

  it('should detect http-equiv with content charset before other params', () => {
    const data = strToBytes('<meta http-equiv="Content-Type" content="charset=utf-8; text/html">');
    expect(prescanMetaCharset(data)).toBe('utf-8');
  });

  it('should return null when no meta charset is present', () => {
    const data = strToBytes('<html><head><title>Hello</title></head></html>');
    expect(prescanMetaCharset(data)).toBeNull();
  });

  it('should return null for empty data', () => {
    expect(prescanMetaCharset(new Uint8Array(0))).toBeNull();
  });

  it('should ignore meta tags after 1024 bytes', () => {
    const padding = ' '.repeat(1100);
    const data = strToBytes(padding + '<meta charset="utf-8">');
    expect(prescanMetaCharset(data)).toBeNull();
  });

  it('should detect meta tag within first 1024 bytes', () => {
    const padding = ' '.repeat(900);
    const data = strToBytes(padding + '<meta charset="utf-8">');
    expect(prescanMetaCharset(data)).toBe('utf-8');
  });

  it('should handle whitespace between <meta and charset', () => {
    const data = strToBytes('<meta   charset="utf-8">');
    expect(prescanMetaCharset(data)).toBe('utf-8');
  });

  it('should handle tab and newline whitespace', () => {
    const data = strToBytes('<meta\t\ncharset="utf-8">');
    expect(prescanMetaCharset(data)).toBe('utf-8');
  });

  it('should handle charset after other attributes', () => {
    const data = strToBytes('<meta name="viewport" charset="utf-8" content="width=device-width">');
    expect(prescanMetaCharset(data)).toBe('utf-8');
  });

  it('should not match <metax charset="utf-8">', () => {
    const data = strToBytes('<metax charset="utf-8">');
    expect(prescanMetaCharset(data)).toBeNull();
  });

  it('should skip non-ASCII bytes before meta tag', () => {
    // 0xC3 0xA9 = "é" in UTF-8
    const prefix = new Uint8Array([0xC3, 0xA9, 0x20]);
    const meta = strToBytes('<meta charset="utf-8">');
    const data = new Uint8Array(prefix.length + meta.length);
    data.set(prefix);
    data.set(meta, prefix.length);
    expect(prescanMetaCharset(data)).toBe('utf-8');
  });

  it('should handle meta with extra whitespace in attribute value', () => {
    const data = strToBytes('<meta charset= "utf-8">');
    expect(prescanMetaCharset(data)).toBe('utf-8');
  });

  it('should handle http-equiv=content-type (lowercase)', () => {
    const data = strToBytes('<meta http-equiv="content-type" content="text/html; charset=euc-jp">');
    expect(prescanMetaCharset(data)).toBe('euc-jp');
  });

  it('should handle meta tag preceded by DOCTYPE and comments', () => {
    const data = strToBytes('<!DOCTYPE html><!-- comment --><html><head><meta charset="utf-8"></head></html>');
    expect(prescanMetaCharset(data)).toBe('utf-8');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SNIFF ENCODING — PRIORITY ORDER
// ─────────────────────────────────────────────────────────────────────────────

describe('sniffEncoding', () => {
  it('should default to UTF-8', () => {
    const data = strToBytes('<html>');
    const result = sniffEncoding(data);
    expect(result.charset).toBe('utf-8');
    expect(result.source).toBe('default');
    expect(result.bomSize).toBe(0);
  });

  it('should detect UTF-8 BOM (highest priority)', () => {
    const data = new Uint8Array([0xEF, 0xBB, 0xBF, ...strToBytes('<html>')]);
    const result = sniffEncoding(data, { contentType: 'text/html; charset=windows-1252' });
    expect(result.charset).toBe('utf-8');
    expect(result.source).toBe('bom');
    expect(result.bomSize).toBe(3);
  });

  it('should prefer Content-Type over meta prescan', () => {
    const data = strToBytes('<meta charset="utf-8">');
    const result = sniffEncoding(data, { contentType: 'text/html; charset=windows-1252' });
    expect(result.charset).toBe('windows-1252');
    expect(result.source).toBe('content-type');
  });

  it('should prefer meta prescan over default', () => {
    const data = strToBytes('<meta charset="windows-1252">');
    const result = sniffEncoding(data);
    expect(result.charset).toBe('windows-1252');
    expect(result.source).toBe('meta');
  });

  it('should use meta prescan when Content-Type has no charset', () => {
    const data = strToBytes('<meta charset="gbk">');
    const result = sniffEncoding(data, { contentType: 'text/html' });
    expect(result.charset).toBe('gbk');
    expect(result.source).toBe('meta');
  });

  it('should handle conflicting BOM and Content-Type (BOM wins)', () => {
    const data = new Uint8Array([0xFF, 0xFE, 0x00, 0x00, ...strToBytes('<html>')]);
    const result = sniffEncoding(data, { contentType: 'text/html; charset=utf-8' });
    expect(result.charset).toBe('utf-32le');
    expect(result.source).toBe('bom');
  });

  it('should handle conflicting BOM and meta (BOM wins)', () => {
    const data = new Uint8Array([0xEF, 0xBB, 0xBF, ...strToBytes('<meta charset="windows-1252">')]);
    const result = sniffEncoding(data);
    expect(result.charset).toBe('utf-8');
    expect(result.source).toBe('bom');
  });

  it('should handle conflicting Content-Type and meta (Content-Type wins)', () => {
    const data = strToBytes('<meta charset="gbk">');
    const result = sniffEncoding(data, { contentType: 'text/html; charset=euc-kr' });
    expect(result.charset).toBe('euc-kr');
    expect(result.source).toBe('content-type');
  });

  it('should handle empty data', () => {
    const result = sniffEncoding(new Uint8Array(0));
    expect(result.charset).toBe('utf-8');
    expect(result.source).toBe('default');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DECODE BYTES
// ─────────────────────────────────────────────────────────────────────────────

describe('decodeBytes', () => {
  it('should decode UTF-8 text', () => {
    const data = strToBytes('<p>Hello, world!</p>');
    const result = decodeBytes(data);
    expect(result.text).toBe('<p>Hello, world!</p>');
    expect(result.charset).toBe('utf-8');
  });

  it('should strip UTF-8 BOM from decoded text', () => {
    const data = new Uint8Array([0xEF, 0xBB, 0xBF, ...strToBytes('hello')]);
    const result = decodeBytes(data);
    expect(result.text).toBe('hello');
    expect(result.charset).toBe('utf-8');
    expect(result.source).toBe('bom');
  });

  it('should decode Windows-1252 text via Content-Type', () => {
    // 0xA3 = £ (pound sign), which maps correctly in both ISO-8859-1 and Windows-1252
    // 0xD7 = × (multiplication sign), also maps the same in both
    const data = new Uint8Array([0x3C, 0x70, 0x3E, 0xA3, 0x31, 0x30, 0x30, 0xD7, 0x32, 0x3C, 0x2F, 0x70, 0x3E]);
    const result = decodeBytes(data, { contentType: 'text/html; charset=windows-1252' });
    expect(result.text).toBe('<p>\u00A3100\u00D72</p>');
    expect(result.charset).toBe('windows-1252');
  });

  it('should decode Windows-1252 via Content-Type', () => {
    // 0x80 = Euro sign (€) in Windows-1252
    const data = new Uint8Array([0xA3, 0x31, 0x30, 0x30]); // £100
    const result = decodeBytes(data, { contentType: 'text/html; charset=windows-1252' });
    expect(result.text).toBe('\u00A3100'); // £100
  });

  it('should handle empty data', () => {
    const result = decodeBytes(new Uint8Array(0));
    expect(result.text).toBe('');
    expect(result.charset).toBe('utf-8');
  });

  it('should handle invalid UTF-8 gracefully (replacement chars)', () => {
    const data = new Uint8Array([0xC0, 0xAF]); // Invalid UTF-8 sequence
    const result = decodeBytes(data);
    expect(result.text).toContain('\uFFFD');
  });

  it('should fallback to UTF-8 for unsupported encoding', () => {
    const result = decodeBytes(strToBytes('hello'), { contentType: 'text/html; charset=x-nonexistent' });
    expect(result.text).toBe('hello');
    expect(result.charset).toBe('utf-8');
  });

  it('should detect UTF-16 LE BOM and decode', () => {
    // "Hi" in UTF-16 LE: 0x48 0x00 0x69 0x00
    const data = new Uint8Array([0xFF, 0xFE, 0x48, 0x00, 0x69, 0x00]);
    const result = decodeBytes(data);
    expect(result.text).toBe('Hi');
    expect(result.charset).toBe('utf-16le');
    expect(result.source).toBe('bom');
  });

  it('should detect UTF-16 BE BOM and decode', () => {
    // "Hi" in UTF-16 BE: 0x00 0x48 0x00 0x69
    const data = new Uint8Array([0xFE, 0xFF, 0x00, 0x48, 0x00, 0x69]);
    const result = decodeBytes(data);
    expect(result.text).toBe('Hi');
    expect(result.charset).toBe('utf-16be');
  });

  it('should detect meta charset via prescan', () => {
    const data = strToBytes('<!DOCTYPE html><html><head><meta charset="windows-1252"></head></html>');
    const result = decodeBytes(data);
    expect(result.charset).toBe('windows-1252');
    expect(result.source).toBe('meta');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARSEBYTES INTEGRATION
// ─────────────────────────────────────────────────────────────────────────────

describe('HtmlParser.parseBytes()', () => {
  const parser = new HtmlParser();

  it('should parse UTF-8 bytes', () => {
    const data = strToBytes('<!DOCTYPE html><html><head><title>Test</title></head><body><p>Hello</p></body></html>');
    const result = parser.parseBytes(data);
    expect(result.document.headElement).not.toBeNull();
    expect(result.document.bodyElement).not.toBeNull();
    expect(result.document.detectedCharset).toBe('utf-8');
  });

  it('should set detectedCharset from BOM', () => {
    const data = new Uint8Array([0xEF, 0xBB, 0xBF, ...strToBytes('<html><body>x</body></html>')]);
    const result = parser.parseBytes(data);
    expect(result.document.detectedCharset).toBe('utf-8');
  });

  it('should set detectedCharset from Content-Type', () => {
    const data = strToBytes('<html><body>x</body></html>');
    const result = parser.parseBytes(data, { contentType: 'text/html; charset=windows-1252' });
    expect(result.document.detectedCharset).toBe('windows-1252');
  });

  it('should set metaCharset to detectedCharset when no declared charset', () => {
    const data = strToBytes('<html><body>x</body></html>');
    const result = parser.parseBytes(data, { contentType: 'text/html; charset=gbk' });
    expect(result.document.metaCharset).toBe('gbk');
    expect(result.document.detectedCharset).toBe('gbk');
    expect(result.document.declaredCharset).toBeNull();
  });

  it('should preserve declaredCharset from <meta charset>', () => {
    const data = strToBytes('<html><head><meta charset="utf-8"></head><body>x</body></html>');
    const result = parser.parseBytes(data, { contentType: 'text/html; charset=windows-1252' });
    expect(result.document.declaredCharset).toBe('utf-8');
    // detectedCharset reflects BOM/header/prescan (Content-Type wins over meta prescan)
    expect(result.document.detectedCharset).toBe('windows-1252');
  });

  it('should not override declaredCharset with detectedCharset', () => {
    const data = strToBytes('<html><head><meta charset="euc-kr"></head><body>x</body></html>');
    const result = parser.parseBytes(data, { contentType: 'text/html; charset=utf-8' });
    expect(result.document.declaredCharset).toBe('euc-kr');
    // metaCharset should remain the declared value
    expect(result.document.metaCharset).toBe('euc-kr');
  });

  it('should use url option for baseUrl', () => {
    const data = strToBytes('<html><body><a href="/page">link</a></body></html>');
    const result = parser.parseBytes(data, { url: 'https://example.com/' });
    expect(result.document.bodyElement).not.toBeNull();
  });

  it('should parse with no options', () => {
    const data = strToBytes('<html><body>text</body></html>');
    const result = parser.parseBytes(data);
    expect(result.document.bodyElement).not.toBeNull();
    expect(result.document.detectedCharset).toBe('utf-8');
  });

  it('should handle empty Uint8Array', () => {
    const result = parser.parseBytes(new Uint8Array(0));
    expect(result.document.bodyElement).not.toBeNull();
    expect(result.document.detectedCharset).toBe('utf-8');
  });

  it('should include resources in parse result', () => {
    const data = strToBytes('<html><head><link rel="stylesheet" href="style.css"></head><body></body></html>');
    const result = parser.parseBytes(data);
    expect(result.resources).toBeDefined();
    expect(result.resources.length).toBeGreaterThan(0);
  });

  it('should include durationMs in parse result', () => {
    const data = strToBytes('<html><body>x</body></html>');
    const result = parser.parseBytes(data);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

describe('Edge cases', () => {
  const parser = new HtmlParser();

  it('should handle malformed charset declaration in meta', () => {
    const data = strToBytes('<meta charset="">');
    const result = prescanMetaCharset(data);
    // Empty charset gets normalized — normalizeCharset('') returns 'utf-8'
    expect(result).toBe('utf-8');
  });

  it('should handle double-quoted charset with spaces', () => {
    const data = strToBytes('<meta charset="  utf-8  ">');
    expect(prescanMetaCharset(data)).toBe('utf-8');
  });

  it('should handle meta charset with no value', () => {
    const data = strToBytes('<meta charset>');
    expect(prescanMetaCharset(data)).toBeNull();
  });

  it('should handle Content-Type with no value after charset=', () => {
    expect(charsetFromContentType('text/html; charset=')).toBeNull();
  });

  it('should handle all null bytes in data', () => {
    const data = new Uint8Array(100).fill(0);
    const result = sniffEncoding(data);
    expect(result.charset).toBe('utf-8');
  });

  it('should handle very large BOM-adjacent data', () => {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const content = strToBytes('x'.repeat(10000));
    const data = new Uint8Array(bom.length + content.length);
    data.set(bom);
    data.set(content, bom.length);
    const result = decodeBytes(data);
    expect(result.text.length).toBe(10000);
    expect(result.charset).toBe('utf-8');
  });

  it('should handle conflicting BOM and meta charset (BOM wins)', () => {
    const data = new Uint8Array([
      0xEF, 0xBB, 0xBF, // UTF-8 BOM
      ...strToBytes('<meta charset="windows-1252">'),
    ]);
    const result = parser.parseBytes(data);
    expect(result.document.detectedCharset).toBe('utf-8');
  });

  it('should handle duplicate <meta charset> tags (first one wins in prescan)', () => {
    const data = strToBytes('<meta charset="gbk"><meta charset="utf-8">');
    expect(prescanMetaCharset(data)).toBe('gbk');
  });

  it('should handle uppercase BOM bytes (partial match that is not a BOM)', () => {
    const data = new Uint8Array([0xEF, 0xAA, 0xBF]); // Not a valid BOM
    expect(detectBOM(data)).toBeNull();
  });

  it('should handle Content-Type with charset in quotes', () => {
    // Some servers put charset in quotes: charset="utf-8"
    expect(charsetFromContentType('text/html; charset="utf-8"')).toBe('"utf-8"');
  });

  it('should handle Content-Type with trailing semicolon', () => {
    expect(charsetFromContentType('text/html; charset=utf-8;')).toBe('utf-8');
  });

  it('should handle meta prescan with only head and closing tag', () => {
    const data = strToBytes('<head><meta charset="iso-8859-1"></head>');
    expect(prescanMetaCharset(data)).toBe('windows-1252');
  });
});
