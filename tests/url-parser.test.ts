import { describe, it, expect } from 'vitest';
import {
  UrlParser,
  EmptyInputError,
  BlockedProtocolError,
  MalformedUrlError,
  ALLOWED_PROTOCOLS,
  BLOCKED_PROTOCOLS,
} from '../src/browser/navigation/url-parser';

describe('UrlParser', () => {
  const parser = new UrlParser();

  describe('parse', () => {
    it('should parse a full HTTPS URL', () => {
      const result = parser.parse('https://example.com/path?q=hello#section');
      expect(result.protocol).toBe('https:');
      expect(result.hostname).toBe('example.com');
      expect(result.pathname).toBe('/path');
      expect(result.href).toBe('https://example.com/path?q=hello#section');
      expect(result.isSecure).toBe(true);
    });

    it('should infer https:// for bare hostnames', () => {
      const result = parser.parse('google.com');
      expect(result.protocol).toBe('https:');
      expect(result.hostname).toBe('google.com');
      expect(result.normalized).toBe('https://google.com');
    });

    it('should parse localhost with port', () => {
      const result = parser.parse('localhost:3000');
      expect(result.hostname).toBe('localhost');
      expect(result.port).toBe('3000');
    });

    it('should parse special pages', () => {
      const result = parser.parse('about:blank');
      expect(result.isSpecialPage).toBe(true);
      expect(result.isSecure).toBe(true);
    });

    it('should parse nova:// settings page', () => {
      const result = parser.parse('nova://settings');
      expect(result.isSpecialPage).toBe(true);
      expect(result.href).toBe('nova://settings');
    });

    it('should resolve about:settings to nova://settings', () => {
      const result = parser.parse('about:settings');
      expect(result.href).toBe('nova://settings');
    });

    it('should throw EmptyInputError for empty string', () => {
      expect(() => parser.parse('')).toThrow(EmptyInputError);
    });

    it('should throw EmptyInputError for whitespace-only string', () => {
      expect(() => parser.parse('   ')).toThrow(EmptyInputError);
    });

    it('should throw BlockedProtocolError for javascript:', () => {
      expect(() => parser.parse('javascript:alert(1)')).toThrow(BlockedProtocolError);
    });

    it('should throw BlockedProtocolError for vbscript:', () => {
      expect(() => parser.parse('vbscript:MsgBox(1)')).toThrow(BlockedProtocolError);
    });

    it('should throw MalformedUrlError for nonsense input', () => {
      expect(() => parser.parse('not even close to a url')).toThrow(MalformedUrlError);
    });

    it('should parse bare "www" as a single-label hostname', () => {
      const result = parser.parse('www');
      expect(result.protocol).toBe('https:');
      expect(result.hostname).toBe('www');
      expect(result.normalized).toBe('https://www');
    });

    it('should parse "www" with port and path', () => {
      const result = parser.parse('www:3000/api');
      expect(result.protocol).toBe('https:');
      expect(result.hostname).toBe('www');
      expect(result.port).toBe('3000');
      expect(result.pathname).toBe('/api');
    });

    it('should parse file:// URLs', () => {
      const result = parser.parse('file:///C:/path/to/file.html');
      expect(result.protocol).toBe('file:');
      expect(result.isSecure).toBe(true);
    });

    it('should parse IP address URLs', () => {
      const result = parser.parse('192.168.1.1:8080');
      expect(result.hostname).toBe('192.168.1.1');
      expect(result.port).toBe('8080');
      expect(result.protocol).toBe('https:');
    });

    it('should extract query params', () => {
      const result = parser.parse('https://example.com?foo=bar&baz=qux');
      expect(result.params.get('foo')).toBe('bar');
      expect(result.params.get('baz')).toBe('qux');
    });

    // ── New protocol tests ──────────────────────────────────────────────────

    it('should parse HTTP URLs', () => {
      const result = parser.parse('http://example.com');
      expect(result.protocol).toBe('http:');
      expect(result.isSecure).toBe(false);
    });

    it('should parse WebSocket URLs (ws:)', () => {
      const result = parser.parse('ws://example.com/socket');
      expect(result.protocol).toBe('ws:');
      expect(result.isSecure).toBe(false);
    });

    it('should parse WebSocket Secure URLs (wss:)', () => {
      const result = parser.parse('wss://example.com/socket');
      expect(result.protocol).toBe('wss:');
      expect(result.isSecure).toBe(true);
    });

    it('should parse FTP URLs', () => {
      const result = parser.parse('ftp://files.example.com/pub/');
      expect(result.protocol).toBe('ftp:');
      expect(result.isSecure).toBe(false);
    });

    it('should parse FTPS URLs', () => {
      const result = parser.parse('ftps://secure-files.example.com/pub/');
      expect(result.protocol).toBe('ftps:');
      expect(result.isSecure).toBe(true);
    });

    it('should parse SFTP URLs', () => {
      const result = parser.parse('sftp://server.example.com/home/user');
      expect(result.protocol).toBe('sftp:');
      expect(result.isSecure).toBe(true);
    });

    it('should parse mailto: URLs', () => {
      const result = parser.parse('mailto:user@example.com');
      expect(result.protocol).toBe('mailto:');
      expect(result.isSecure).toBe(true);
    });

    it('should parse tel: URLs', () => {
      const result = parser.parse('tel:+1234567890');
      expect(result.protocol).toBe('tel:');
      expect(result.isSecure).toBe(true);
    });

    it('should parse sms: URLs', () => {
      const result = parser.parse('sms:+1234567890');
      expect(result.protocol).toBe('sms:');
      expect(result.isSecure).toBe(true);
    });

    it('should parse smsto: URLs', () => {
      const result = parser.parse('smsto:+1234567890');
      expect(result.protocol).toBe('smsto:');
      expect(result.isSecure).toBe(true);
    });

    it('should parse ssh: URLs', () => {
      const result = parser.parse('ssh://user@server.example.com');
      expect(result.protocol).toBe('ssh:');
      expect(result.isSecure).toBe(true);
    });

    it('should parse magnet: URLs', () => {
      const result = parser.parse('magnet:?xt=urn:btih:abc123');
      expect(result.protocol).toBe('magnet:');
      expect(result.isSecure).toBe(true);
    });

    it('should parse news: URLs', () => {
      const result = parser.parse('news:newsgroup.example.com');
      expect(result.protocol).toBe('news:');
      expect(result.isSecure).toBe(false);
    });

    it('should parse nntp: URLs', () => {
      const result = parser.parse('nntp://news.example.com/group');
      expect(result.protocol).toBe('nntp:');
      expect(result.isSecure).toBe(false);
    });

    it('should parse gopher: URLs', () => {
      const result = parser.parse('gopher://gopher.example.com/');
      expect(result.protocol).toBe('gopher:');
      expect(result.isSecure).toBe(false);
    });

    it('should parse wais: URLs', () => {
      const result = parser.parse('wais://wais.example.com/database');
      expect(result.protocol).toBe('wais:');
      expect(result.isSecure).toBe(false);
    });

    it('should throw for data: URIs (now blocked)', () => {
      expect(() => parser.parse('data:text/html,<h1>Hello</h1>')).toThrow();
    });

    it('should parse blob: URLs', () => {
      const result = parser.parse('blob:http://example.com/abc-123');
      expect(result.protocol).toBe('blob:');
      expect(result.isSecure).toBe(true);
      expect(result.isSpecialPage).toBe(true);
    });
  });

  describe('normalize', () => {
    it('should trim whitespace', () => {
      expect(parser.normalize('  https://example.com  ')).toBe('https://example.com/');
    });

    it('should lowercase scheme and hostname for HTTP URLs', () => {
      expect(parser.normalize('HTTP://EXAMPLE.COM')).toBe('http://example.com/');
    });

    it('should lowercase scheme', () => {
      expect(parser.normalize('HTTP://EXAMPLE.COM')).toBe('http://example.com/');
    });

    it('should add https:// for bare domain', () => {
      expect(parser.normalize('example.com')).toBe('https://example.com');
    });

    it('should add https:// for bare "www"', () => {
      expect(parser.normalize('www')).toBe('https://www');
    });

    it('should add https:// for bare "www" with port', () => {
      expect(parser.normalize('www:3000')).toBe('https://www:3000');
    });

    it('should not modify already valid URLs', () => {
      expect(parser.normalize('https://example.com')).toBe('https://example.com/');
    });

    it('should resolve special page aliases', () => {
      expect(parser.normalize('about:settings')).toBe('nova://settings');
    });

    it('should return empty string for whitespace-only input', () => {
      expect(parser.normalize('   ')).toBe('');
    });

    it('should lowercase ws: scheme', () => {
      expect(parser.normalize('WS://EXAMPLE.COM')).toBe('ws://example.com/');
    });

    it('should lowercase wss: scheme', () => {
      expect(parser.normalize('WSS://EXAMPLE.COM')).toBe('wss://example.com/');
    });

    it('should lowercase ftp: scheme', () => {
      expect(parser.normalize('FTP://EXAMPLE.COM')).toBe('ftp://example.com/');
    });

    it('should lowercase ftps: scheme', () => {
      // ftps: is not a WHATWG standard scheme, so URL constructor preserves case
      expect(parser.normalize('FTPS://EXAMPLE.COM')).toBe('ftps://EXAMPLE.COM');
    });

    it('should lowercase sftp: scheme', () => {
      // sftp: is not a WHATWG standard scheme, so URL constructor preserves case
      expect(parser.normalize('SFTP://EXAMPLE.COM')).toBe('sftp://EXAMPLE.COM');
    });

    it('should lowercase mailto: scheme', () => {
      expect(parser.normalize('MAILTO:user@example.com')).toBe('mailto:user@example.com');
    });

    it('should lowercase tel: scheme', () => {
      expect(parser.normalize('TEL:+1234567890')).toBe('tel:+1234567890');
    });

    it('should lowercase magnet: scheme', () => {
      expect(parser.normalize('MAGNET:?xt=urn:btih:abc')).toBe('magnet:?xt=urn:btih:abc');
    });
  });

  describe('validate', () => {
    it('should return valid for a good URL', () => {
      const result = parser.validate('https://example.com');
      expect(result.valid).toBe(true);
    });

    it('should return invalid with errorKind for empty input', () => {
      const result = parser.validate('');
      expect(result.valid).toBe(false);
      expect(result.errorKind).toBe('empty');
    });

    it('should return invalid with errorKind for blocked protocol', () => {
      const result = parser.validate('javascript:alert(1)');
      expect(result.valid).toBe(false);
      expect(result.errorKind).toBe('blocked-protocol');
    });

    it('should return invalid with errorKind for malformed input', () => {
      const result = parser.validate('not a url !!!');
      expect(result.valid).toBe(false);
      expect(result.errorKind).toBe('malformed');
    });

    it('should return valid for ws: URLs', () => {
      const result = parser.validate('ws://example.com');
      expect(result.valid).toBe(true);
    });

    it('should return valid for mailto: URLs', () => {
      const result = parser.validate('mailto:user@example.com');
      expect(result.valid).toBe(true);
    });

    it('should return valid for magnet: URLs', () => {
      const result = parser.validate('magnet:?xt=urn:btih:abc');
      expect(result.valid).toBe(true);
    });
  });

  describe('isSpecialPage', () => {
    it('should return true for about:blank', () => {
      expect(parser.isSpecialPage('about:blank')).toBe(true);
    });

    it('should return true for about:settings', () => {
      expect(parser.isSpecialPage('about:settings')).toBe(true);
    });

    it('should return true for nova://downloads', () => {
      expect(parser.isSpecialPage('nova://downloads')).toBe(true);
    });

    it('should return false for a normal URL', () => {
      expect(parser.isSpecialPage('https://example.com')).toBe(false);
    });
  });

  describe('isBlockedProtocol', () => {
    it('should return true for javascript:', () => {
      expect(parser.isBlockedProtocol('javascript:void(0)')).toBe(true);
    });

    it('should return true for vbscript:', () => {
      expect(parser.isBlockedProtocol('vbscript:MsgBox(1)')).toBe(true);
    });

    it('should return false for https:', () => {
      expect(parser.isBlockedProtocol('https://example.com')).toBe(false);
    });

    it('should return false for no scheme', () => {
      expect(parser.isBlockedProtocol('example.com')).toBe(false);
    });

    it('should return false for ws: (no longer blocked)', () => {
      expect(parser.isBlockedProtocol('ws://example.com')).toBe(false);
    });

    it('should return false for wss: (no longer blocked)', () => {
      expect(parser.isBlockedProtocol('wss://example.com')).toBe(false);
    });

    it('should return true for data: (now blocked)', () => {
      expect(parser.isBlockedProtocol('data:text/html,test')).toBe(true);
    });

    it('should return false for blob: (no longer blocked)', () => {
      expect(parser.isBlockedProtocol('blob:http://example.com/abc')).toBe(false);
    });
  });

  describe('ALLOWED_PROTOCOLS', () => {
    it('should contain all web protocols', () => {
      expect(ALLOWED_PROTOCOLS.has('http:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('https:')).toBe(true);
    });

    it('should contain WebSocket protocols', () => {
      expect(ALLOWED_PROTOCOLS.has('ws:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('wss:')).toBe(true);
    });

    it('should contain file transfer protocols', () => {
      expect(ALLOWED_PROTOCOLS.has('ftp:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('ftps:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('sftp:')).toBe(true);
    });

    it('should contain internal protocols', () => {
      expect(ALLOWED_PROTOCOLS.has('file:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('data:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('blob:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('about:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('nova:')).toBe(true);
    });

    it('should contain external protocols', () => {
      expect(ALLOWED_PROTOCOLS.has('mailto:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('tel:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('sms:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('smsto:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('ssh:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('magnet:')).toBe(true);
    });

    it('should contain usenet protocols', () => {
      expect(ALLOWED_PROTOCOLS.has('news:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('nntp:')).toBe(true);
    });

    it('should contain legacy protocols', () => {
      expect(ALLOWED_PROTOCOLS.has('gopher:')).toBe(true);
      expect(ALLOWED_PROTOCOLS.has('wais:')).toBe(true);
    });
  });

  describe('BLOCKED_PROTOCOLS', () => {
    it('should contain javascript:', () => {
      expect(BLOCKED_PROTOCOLS.has('javascript:')).toBe(true);
    });

    it('should contain vbscript:', () => {
      expect(BLOCKED_PROTOCOLS.has('vbscript:')).toBe(true);
    });

    it('should not contain ws:', () => {
      expect(BLOCKED_PROTOCOLS.has('ws:')).toBe(false);
    });

    it('should not contain wss:', () => {
      expect(BLOCKED_PROTOCOLS.has('wss:')).toBe(false);
    });

    it('should contain data:', () => {
      expect(BLOCKED_PROTOCOLS.has('data:')).toBe(true);
    });

    it('should not contain blob:', () => {
      expect(BLOCKED_PROTOCOLS.has('blob:')).toBe(false);
    });
  });

  describe('isSearchQuery', () => {
    it('should return true for plain text', () => {
      expect(parser.isSearchQuery('hello world')).toBe(true);
    });

    it('should return true for multi-word queries', () => {
      expect(parser.isSearchQuery('how to bake a cake')).toBe(true);
    });

    it('should return false for empty string', () => {
      expect(parser.isSearchQuery('')).toBe(false);
    });

    it('should return false for valid URLs', () => {
      expect(parser.isSearchQuery('https://example.com')).toBe(false);
    });

    it('should return false for bare hostnames', () => {
      expect(parser.isSearchQuery('google.com')).toBe(false);
    });

    it('should return false for localhost', () => {
      expect(parser.isSearchQuery('localhost')).toBe(false);
    });

    it('should return false for localhost with port', () => {
      expect(parser.isSearchQuery('localhost:3000')).toBe(false);
    });

    it('should return false for IPv4 addresses', () => {
      expect(parser.isSearchQuery('192.168.1.1')).toBe(false);
    });

    it('should return false for schemes even if malformed', () => {
      expect(parser.isSearchQuery('ftp://broken')).toBe(false);
    });

    it('should return false for about:blank', () => {
      expect(parser.isSearchQuery('about:blank')).toBe(false);
    });

    it('should return true for text with special characters', () => {
      expect(parser.isSearchQuery('what is 2+2?')).toBe(true);
    });

    it('should return true for non-English text', () => {
      expect(parser.isSearchQuery('hola mundo')).toBe(true);
    });
  });

  describe('buildSearchUrl', () => {
    it('should build a DuckDuckGo URL by default', () => {
      const url = parser.buildSearchUrl('hello world');
      expect(url).toBe('https://duckduckgo.com/?q=hello%20world');
    });

    it('should encode special characters', () => {
      const url = parser.buildSearchUrl('a & b < c');
      expect(url).toContain(encodeURIComponent('a & b < c'));
    });

    it('should use custom engine URL when provided', () => {
      const url = parser.buildSearchUrl('test', 'https://google.com/search?q=%s');
      expect(url).toBe('https://google.com/search?q=test');
    });

    it('should handle empty query', () => {
      const url = parser.buildSearchUrl('');
      expect(url).toBe('https://duckduckgo.com/?q=');
    });

    it('should replace %s placeholder in engine URL', () => {
      const url = parser.buildSearchUrl('my query', 'https://example.com/search?q=%s&page=1');
      expect(url).toBe('https://example.com/search?q=my%20query&page=1');
    });
  });
});
