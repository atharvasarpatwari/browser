/** 2.11: the engine blocks ad scripts by file name on any host (the ad-block test's two script checks). */
import { expect, it } from 'vitest';
import { AdBlocker } from '../src/browser/security/ad-blocker';

it('blocks /ads.js and /pagead.js on any host, not look-alikes', () => {
  const b = new AdBlocker();
  for (const u of ['https://example.org/js/widget/ads.js', 'https://example.org/js/pagead.js?v=2'])
    expect(b.shouldBlock(u).blocked, u).toBe(true);
  for (const u of ['https://example.org/js/uploads.js', 'https://example.org/roads.js', 'https://example.org/ads.json'])
    expect(b.shouldBlock(u).blocked, u).toBe(false);
  b.setEnabled(false);
  expect(b.shouldBlock('https://example.org/ads.js').blocked).toBe(false);
});
