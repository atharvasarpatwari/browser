import { describe, it, expect } from 'vitest';
import { reverseImageSearchLinks } from '../src/browser/search/image-search';

describe('reverseImageSearchLinks', () => {
  it('offers Google Lens, Bing Visual Search and TinEye for a public image, with its address encoded', () => {
    const links = reverseImageSearchLinks('https://cdn.example.com/a b/pic.png?x=1&y=2');
    expect(links.map((l) => l.name)).toEqual(['Google Lens', 'Bing Visual Search', 'TinEye']);
    const encoded = encodeURIComponent('https://cdn.example.com/a%20b/pic.png?x=1&y=2'); // the normalised address
    expect(links.map((l) => l.url)).toEqual([
      `https://lens.google.com/uploadbyurl?url=${encoded}`,
      `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${encoded}`,
      `https://tineye.com/search?url=${encoded}`,
    ]);
  });

  it('accepts plain http images too, and sends every lookup to an https service', () => {
    const links = reverseImageSearchLinks('http://images.example.org/cat.jpg');
    expect(links).toHaveLength(3);
    expect(links.every((l) => l.url.startsWith('https://'))).toBe(true);
  });

  it.each([
    ['data:image/png;base64,AAAA'],
    ['blob:https://cdn.example.com/1234'],
    ['file:///C:/pictures/cat.png'],
    ['javascript:alert(1)'],
    ['ftp://cdn.example.com/cat.png'],
    ['not a url'],
    [''],
  ])('offers nothing for %s (the service must be able to fetch it)', (url) => {
    expect(reverseImageSearchLinks(url)).toEqual([]);
  });

  it.each([
    ['http://127.0.0.1/cat.png'],
    ['http://192.168.1.5/cat.png'],
    ['http://localhost/cat.png'],
    ['http://intranet/cat.png'],
    ['http://printer.local/cat.png'],
    ['https://nas.home/cat.png'],
    ['https://[::1]/cat.png'],
  ])('offers nothing for the non-public address %s (it would leak it, and could not work)', (url) => {
    expect(reverseImageSearchLinks(url)).toEqual([]);
  });

  it('offers nothing for an address that carries credentials', () => {
    expect(reverseImageSearchLinks('https://user:secret@cdn.example.com/cat.png')).toEqual([]);
    expect(reverseImageSearchLinks('https://user@cdn.example.com/cat.png')).toEqual([]);
  });
});
