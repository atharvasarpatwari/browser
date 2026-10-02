import { describe, it, expect } from 'vitest';
import { stripTrackingParams, isTrackingParam } from '../src/browser/search/tracking-params';

describe('stripTrackingParams', () => {
  it.each<[string, string]>([
    ['https://example.com/page?utm_source=news&utm_medium=email&id=5', 'https://example.com/page?id=5'],
    ['https://example.com/?gclid=abc', 'https://example.com/'],
    ['https://example.com/?fbclid=abc#section', 'https://example.com/#section'],
    ['https://example.com/a?x=1&fbclid=z&y=2', 'https://example.com/a?x=1&y=2'],
    ['https://example.com/a?UTM_Source=x&q=1', 'https://example.com/a?q=1'],
    ['https://example.com/?utm_%73ource=x', 'https://example.com/'],
    ['https://example.com/?q=hello%20world&gclid=1', 'https://example.com/?q=hello%20world'],
    ['https://example.com/?msclkid=1&mc_eid=2&mc_cid=3&_hsenc=4&igshid=5&yclid=6&_ga=7', 'https://example.com/'],
    ['http://example.com/?utm_campaign=x&keep=1', 'http://example.com/?keep=1'],
    ['https://user:pw@example.com/?gclid=1', 'https://user:pw@example.com/'],
    ['https://example.com/?utm_source=a&&b=2', 'https://example.com/?b=2'],
    ['https://www.youtube.com/watch?v=abc&si=xyz', 'https://www.youtube.com/watch?v=abc'],
    ['https://youtu.be/abc?si=xyz', 'https://youtu.be/abc'],
    ['https://music.youtube.com/watch?v=1&si=2', 'https://music.youtube.com/watch?v=1'],
    ['https://open.spotify.com/track/1?si=abc', 'https://open.spotify.com/track/1'],
  ])('%s', (input, expected) => {
    expect(stripTrackingParams(input)).toBe(expected);
  });

  it.each([
    'https://example.com/?si=1',
    'https://example.com/?ref=main&source=x&campaign=y&id=utm_source',
    'https://github.com/user/repo?ref=main',
    'https://example.com/?q=utm_source',
    'https://example.com/#utm_source=x',
    'https://example.com/',
    'https://example.com/?a=1&&b=2',
    'https://example.com/?',
    'nova://settings?utm_source=x',
    'javascript:alert(1)?gclid=1',
    'about:blank',
    'not a url',
    '',
  ])('leaves %j untouched', (input) => {
    expect(stripTrackingParams(input)).toBe(input);
  });

  it('tolerates malformed percent-encoding in names', () => {
    expect(stripTrackingParams('https://example.com/?%E0%A4%A=1&gclid=2')).toBe('https://example.com/?%E0%A4%A=1');
  });

  it('classifies parameters by name, case-insensitively, with host-specific exceptions', () => {
    expect(isTrackingParam('GCLID', 'x.com')).toBe(true);
    expect(isTrackingParam('utm_anything', 'x.com')).toBe(true);
    expect(isTrackingParam('si', 'youtube.com')).toBe(true);
    expect(isTrackingParam('si', 'notyoutube.com')).toBe(false);
    expect(isTrackingParam('page', 'x.com')).toBe(false);
  });
});
