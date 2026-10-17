import { isWarmableHost } from './speculative-loader';

interface ImageSearchLink {
  readonly name: string;
  readonly url: string;
}

/**
 * Reverse-image lookups for an image URL. The lookup service has to fetch the image itself, so only http(s)
 * images on public, named hosts qualify — handing it a LAN address, an IP literal or a URL with credentials
 * would leak that address to a third party and could never work anyway. Returns nothing for those.
 */
function reverseImageSearchLinks(imageUrl: string): ImageSearchLink[] {
  let url: URL;
  try { url = new URL(imageUrl); } catch { return []; }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password) return [];
  if (!isWarmableHost(url.hostname.toLowerCase())) return [];
  const encoded = encodeURIComponent(url.href);
  return [
    { name: 'Google Lens', url: `https://lens.google.com/uploadbyurl?url=${encoded}` },
    { name: 'Bing Visual Search', url: `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${encoded}` },
    { name: 'TinEye', url: `https://tineye.com/search?url=${encoded}` },
  ];
}

export { reverseImageSearchLinks };
export type { ImageSearchLink };
