import { test, expect, _electron as electron } from '@playwright/test';

test('Nova Browser launches in Electron and renders content', async () => {
  test.setTimeout(120_000);

  const app = await electron.launch({ args: ['.'] });
  const page = await app.firstWindow();

  try {
    // Bootstrap mounts the browser chrome into #browser-app
    await expect(page.locator('#browser-app')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.address-bar')).toBeVisible();

    // Navigate to a real site through the engine pipeline
    const addressInput = page.locator('.address-input');
    await addressInput.fill('https://example.com');
    await addressInput.press('Enter');

    // Content area shows either a painted canvas or a rendered iframe
    await expect(
      page.locator('.content-area canvas, .content-area iframe'),
    ).toBeVisible({ timeout: 45_000 });
  } finally {
    await app.close();
  }
});
