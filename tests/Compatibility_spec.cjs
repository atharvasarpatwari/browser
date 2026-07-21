const { test, expect } = require('@playwright/test');

test.describe('Layout & CSS compatibility', () => {
  test('grid layout renders with expected columns', async ({ page }) => {
    await page.goto('/');
    const grid = page.locator('.grid');
    await expect(grid).toBeVisible();

    const display = await grid.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe('grid');
  });

  test('CSS custom properties resolve correctly', async ({ page }) => {
    await page.goto('/');
    const gapValue = await page.locator('.grid').evaluate(
      (el) => getComputedStyle(el).gap
    );
    // Should resolve the --gap variable, not stay literal "var(--gap)"
    expect(gapValue).not.toContain('var(');
    expect(gapValue).toBe('16px');
  });

  test(':has() selector styling applies when supported', async ({ page, browserName }) => {
    await page.goto('/');
    await page.check('#check1');
    const card = page.locator('.card').first();
    const borderColor = await card.evaluate((el) => getComputedStyle(el).borderColor);

    // WebKit/older Firefox versions may not support :has() -
    // assert conditionally rather than failing hard everywhere.
    const supportsHas = await page.evaluate(() => CSS.supports('selector(:has(a))'));
    if (supportsHas) {
      expect(borderColor).not.toBe('rgb(221, 221, 221)'); // not default border
    } else {
      test.info().annotations.push({
        type: 'note',
        description: `:has() not supported in ${browserName}, skipping strict assertion`,
      });
    }
  });

  test('100dvh does not collapse the body on mobile viewports', async ({ page }) => {
    await page.goto('/');
    const minHeight = await page.evaluate(() => {
      const val = getComputedStyle(document.body).minHeight;
      return parseFloat(val);
    });
    expect(minHeight).toBeGreaterThan(0);
  });
});

test.describe('Form control compatibility', () => {
  test('date input accepts a value across browsers', async ({ page }) => {
    await page.goto('/');
    const dateInput = page.locator('#datepick');
    await dateInput.fill('2026-07-21');
    await expect(dateInput).toHaveValue('2026-07-21');
  });

  test('checkboxes toggle correctly', async ({ page }) => {
    await page.goto('/');
    const checkbox = page.locator('#check2');
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
  });
});

test.describe('JavaScript API compatibility', () => {
  test('IntersectionObserver detects scroll target', async ({ page }) => {
    await page.goto('/');
    await page.locator('#observerBtn').click();
    await expect(page.locator('#status')).toHaveText('Status: target is visible', {
      timeout: 5000,
    });
  });

  test('Clipboard API works or fails gracefully', async ({ page, context, browserName }) => {
    // Grant permission where the browser supports it (Chromium only)
    if (browserName === 'chromium') {
      await context.grantPermissions(['clipboard-write', 'clipboard-read']);
    }
    await page.goto('/');
    await page.locator('#clipboardBtn').click();

    const status = await page.locator('#status').textContent();
    // Accept either success or a graceful failure message - the point
    // is the app doesn't throw an unhandled error in any engine.
    expect(status).toMatch(/copied to clipboard|clipboard failed/);
  });

  test('optional chaining syntax does not throw', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.goto('/');
    await page.locator('#clipboardBtn').click();
    expect(errors).toEqual([]);
  });
});

test.describe('Visual regression (screenshot diff)', () => {
  test('homepage matches baseline screenshot', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page).toHaveScreenshot(`homepage-${testInfo.project.name}.png`, {
      maxDiffPixelRatio: 0.02,
    });
  });
});
