/**
 * 2.07: the engine's blockers missed 85 of the 126 hosts a public ad-block test tries
 * (ad and telemetry servers of platforms and phone makers, error reporting).
 */
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { AdBlocker } from '../src/browser/security/ad-blocker';
import { TrackerBlocker } from '../src/browser/security/tracker-blocker';

const ads = new AdBlocker();
const trackers = new TrackerBlocker();
const blocked = (url: string) => ads.shouldBlock(url).blocked || trackers.shouldBlock(url).blocked;

it('blocks every host of the ad-block test', () => {
  const hosts = readFileSync('tests/fixtures/ad-block-test-hosts.txt', 'utf8').split(/\s+/).filter(Boolean);
  expect(hosts.length).toBe(126);
  expect(hosts.filter((h) => !blocked(`https://${h}/fakepage.html`))).toEqual([]);
});

it('leaves the sites themselves alone', () => {
  for (const url of [
    'https://www.yahoo.com/', 'https://www.apple.com/', 'https://www.samsung.com/in/', 'https://yandex.ru/',
    'https://www.pinterest.com/', 'https://www.tiktok.com/', 'https://www.mi.com/', 'https://www.reddit.com/r/all',
    'https://www.linkedin.com/feed', 'https://bucket.s3.amazonaws.com/file.png',
    'https://www.realme.com/', 'https://www.oneplus.in/', 'https://wordpress.com/',
  ]) expect(blocked(url), url).toBe(false);
});
