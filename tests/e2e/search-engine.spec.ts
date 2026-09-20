import { test, expect, _electron as electron } from '@playwright/test';

test('typing a plain query into the address bar performs a real search', async () => {
  test.setTimeout(120_000);

  const app = await electron.launch({ args: ['.'] });
  const page = await app.firstWindow();

  try {
    await expect(page.locator('#browser-app')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.address-bar')).toBeVisible();

    const addressInput = page.locator('.address-input');
    await addressInput.fill('what is the speed of light');
    await addressInput.press('Enter');

    // Search routes through the real engine pipeline just like a URL does.
    await expect(
      page.locator('.content-area canvas, .content-area iframe'),
    ).toBeVisible({ timeout: 45_000 });

    // Must not have surfaced as a navigation failure.
    await expect(page.locator('.status-text')).not.toContainText('Failed', { timeout: 5_000 });
  } finally {
    await app.close();
  }
});
