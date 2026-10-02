import { test, expect, _electron as electron } from '@playwright/test';

// YouTube is one of the heaviest JS bundles on the open web and a hand-built
// engine won't run all of it (video/DRM/reactive-UI parity is out of scope) —
// this only guards the bar every other e2e smoke test guards: a real, hostile
// site must not crash or hang the browser, even when its scripts don't fully
// execute. Root-cause script-engine gaps this test surfaces belong in
// tests/e2e/js-dom-api-sweep.spec.ts once isolated, not fixed against the
// live site here.
test('navigating to YouTube renders content without crashing or hanging', async () => {
  test.setTimeout(120_000);

  const app = await electron.launch({ args: ['.'] });
  const page = await app.firstWindow();

  try {
    await expect(page.locator('#browser-app')).toBeVisible({ timeout: 30_000 });

    const addressInput = page.locator('.address-input');
    await addressInput.fill('https://www.youtube.com');
    await addressInput.press('Enter');

    await expect(
      page.locator('.content-area canvas, .content-area iframe'),
    ).toBeVisible({ timeout: 45_000 });

    await expect(page.locator('.status-text')).not.toContainText('Failed', { timeout: 5_000 });
  } finally {
    await app.close();
  }
});
