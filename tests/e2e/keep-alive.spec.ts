import { test, expect, _electron as electron } from '@playwright/test';

test('Nova Browser stays open and responsive via the health probe', async () => {
  test.setTimeout(120_000);

  const app = await electron.launch({ args: ['.'] });
  const page = await app.firstWindow();

  try {
    // Bootstrap mounts the browser chrome into #browser-app
    await expect(page.locator('#browser-app')).toBeVisible({ timeout: 30_000 });

    // Renderer exposes the health probe wired by the Electron watchdog
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const probe = (globalThis as any).__novaHealthProbe;
            return probe ? probe() : null;
          }),
        { timeout: 30_000 },
      )
      .toEqual(
        expect.objectContaining({
          ok: true,
          running: true,
          mounted: true,
        }),
      );

    const firstProbe = await page.evaluate(() => {
      const probe = (globalThis as any).__novaHealthProbe;
      return probe();
    });

    // Window stays open across watchdog ticks (5s interval) and remains alive
    await page.waitForTimeout(8000);

    await expect(page.locator('#browser-app')).toBeVisible();
    const secondProbe = await page.evaluate(() => {
      const probe = (globalThis as any).__novaHealthProbe;
      return probe();
    });

    expect(secondProbe.ok).toBe(true);
    expect(secondProbe.running).toBe(true);
    expect(secondProbe.mounted).toBe(true);
    // uptime must have grown across the 8s idle window
    expect(secondProbe.uptimeMs).toBeGreaterThan(firstProbe.uptimeMs);

    // The app window is still alive in the main process
    const windowCount = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    expect(windowCount).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
});
