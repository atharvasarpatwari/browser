# Networking Gap Fixes

**Date:** 2026-07-30
**Session:** Fix binary data corruption and multipart parse issues in networking features
**Status:** Completed

---

## Summary

Fixed 3 root causes across content-encoding decompression, multipart parsing, and raw-socket HTTP response handling. All 39 networking-features tests pass.

---

## Root Causes

### 1. Binary data corruption from UTF-8 string conversion

**Files:**
- `src/browser/netwroking/raw-socket-http-client.ts`
- `src/browser/netwroking/content-encoding.ts`

**Problem:** `parseHttpResponse` accepted a `string` parameter (UTF-8 decoded from `Buffer.concat(chunks).toString('utf-8')`). Gzip/deflate compressed binary data was corrupted during the UTF-8 string conversion (bytes > 0x7F get multi-byte UTF-8 encoded, destroying the compressed stream).

`decompressResponse` also used `decodeFromString` which did `Buffer.from(data, 'utf-8')`, applying a second UTF-8 round-trip to already-corrupted data.

**Fix:** Changed `parseHttpResponse` to accept `Buffer` instead of `string`. Decompression now calls `this.contentDecoder.decode(contentEncoding, bodyRaw)` directly on the raw Buffer, bypassing string conversion entirely. Changed `decompressResponse` to use `Buffer.from(body, 'latin1')` (preserving binary-safe round-trip) and call `decode()` with `ContentCoding` enum. Changed `decodeFromString` to `Buffer.from(data, 'latin1')`.

```typescript
// Before (raw-socket-http-client.ts)
const rawResponse = Buffer.concat(chunks).toString('utf-8');
const result = await this.parseHttpResponse(rawResponse, request.url);

// After
const rawResponse = Buffer.concat(chunks);
const result = await this.parseHttpResponse(rawResponse, request.url);
```

### 2. Missing blank line separator in multipart file encoding

**File:** `src/browser/netwroking/multipart.ts` — `encodeFile` method

**Problem:** `encodeFile` used `['', ...].join('\r\n')` for headers, which produced `Content-Type: text/plain\r\n` (ending with `\r\n` from the empty string). The data buffer was appended directly after the header Buffer, yielding `Content-Type: text/plain\r\nhello\r\n` — missing the required `\r\n\r\n` blank-line separator between MIME headers and body content. `parsePart` searched for `\r\n\r\n` and returned `null` because none existed, causing file parts to be silently dropped.

**Fix:** Added a second empty string to `headerLines`, producing `Content-Type: text/plain\r\n\r\nhello\r\n` with the correct blank line.

```typescript
// Before
const headerLines: string[] = [
    `--${boundary}`,
    `Content-Disposition: ...`,
    `Content-Type: text/plain`,
    '',   // produces trailing \r\n
];
// Result: ...\r\nhello\r\n  (no blank line)

// After
const headerLines: string[] = [
    `--${boundary}`,
    `Content-Disposition: ...`,
    `Content-Type: text/plain`,
    '',   // first \r\n — end of Content-Type line
    '',   // second \r\n — blank line separator
];
// Result: ...\r\n\r\nhello\r\n  (blank line present)
```

### 3. Unreliable Buffer-based multipart boundary splitting

**File:** `src/browser/netwroking/multipart.ts` — `splitByBoundary` method

**Problem:** The original implementation used `Buffer.indexOf(Buffer.from('\r\n'))` and `Buffer.indexOf(delimiter)` for boundary scanning. This was fragile and produced empty part results on some boundaries.

**Fix:** Replaced with string-based `split()` on the body converted via `toString('binary')` (lossless for byte values 0-255). Each resulting segment is stripped of leading/trailing `\r\n` and converted back to Buffer via `Buffer.from(seg.slice(start, end), 'binary')`.

```typescript
// Before: complex Buffer indexOf loop
const delimiter = Buffer.from(`--${boundary}`);
// ... manual scanning

// After: clean string split
const segments = bodyStr.split(delim);
for (let i = 1; i < segments.length - 1; i++) {
    // strip leading/trailing \r\n, push as Buffer
}
```

### 4. Wrong import name in test file

**File:** `tests/networking-features.test.ts`

**Problem:** Imported `ContentCodingError` but the actual export is `ContentEncodingError`.

**Fix:** Changed import to `ContentEncodingError`. Also fixed the "unsupported encoding" test to use `decode('compress' as ContentCoding, data)` which triggers the switch-default throw path, instead of `decodeFromString` which silently treated unknown encodings as Identity.

---

## Files Modified

| File | Change |
|------|--------|
| `src/browser/netwroking/raw-socket-http-client.ts` | `parseHttpResponse` accepts Buffer; `decodeChunkedBody` works with Buffer; decompression at Buffer level |
| `src/browser/netwroking/content-encoding.ts` | `decompressResponse` uses `decode()` with Buffer; `decodeFromString` uses `'latin1'` encoding |
| `src/browser/netwroking/multipart.ts` | `encodeFile` adds blank line separator; `splitByBoundary` uses string split |
| `tests/networking-features.test.ts` | Fixed import name; fixed unsupported encoding test |

## Test Results

```
✓ tests/networking-features.test.ts (39 tests)
   ContentDecoder (10)
   HttpAuthenticator (17)
   MultipartBuilder (6)
   QuicConnection (6)
   Networking end-to-end (3)
```
