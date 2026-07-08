import { describe, it, expect } from 'vitest';
import {
  UrlParser,
  EmptyInputError,
  BlockedProtocolError,
  MalformedUrlError,
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

    it('should throw BlockedProtocolError for data:', () => {
      expect(() => parser.parse('data:text/html,<script>alert(1)</script>')).toThrow(BlockedProtocolError);
    });

    it('should throw MalformedUrlError for nonsense input', () => {
      expect(() => parser.parse('not even close to a url')).toThrow(MalformedUrlError);
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

    it('should not modify already valid URLs', () => {
      expect(parser.normalize('https://example.com')).toBe('https://example.com/');
    });

    it('should resolve special page aliases', () => {
      expect(parser.normalize('about:settings')).toBe('nova://settings');
    });

    it('should return empty string for whitespace-only input', () => {
      expect(parser.normalize('   ')).toBe('');
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

    it('should return true for data:', () => {
      expect(parser.isBlockedProtocol('data:text/plain,hello')).toBe(true);
    });

    it('should return false for https:', () => {
      expect(parser.isBlockedProtocol('https://example.com')).toBe(false);
    });

    it('should return false for no scheme', () => {
      expect(parser.isBlockedProtocol('example.com')).toBe(false);
    });
  });
});
