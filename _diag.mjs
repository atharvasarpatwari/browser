import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('#browser-app', { timeout: 30000 });
await page.waitForTimeout(3000);
await page.fill('.address-input', 'https://example.com');
await page.press('.address-input', 'Enter');
await page.waitForTimeout(8000);
const info = await page.evaluate(() => {
  const ca = document.querySelector('.content-area');
  const canvas = ca?.querySelector('canvas');
  const status = document.querySelector('.status-bar, .status-text, [class*="status"]');
  const shield = document.querySelector('[class*="shield"], [class*="security"]');
  return {
    address: document.querySelector('.address-input')?.value,
    contentAreaText: ca ? ca.innerText.slice(0, 300) : null,
    canvas: canvas ? `${canvas.width}x${canvas.height}` : null,
    statusText: status ? status.innerText.slice(0, 120) : null,
    shieldText: shield ? shield.innerText.slice(0, 120) : null,
    bodyHasError: /unable to load|failed to load|couldn't|cannot reach|network error|blocked by cors/i.test(document.body.innerText),
  };
});
console.log(JSON.stringify(info, null, 2));
console.log('--- console errors ---');
errors.forEach((e) => console.log(e.slice(0, 200)));
await browser.close();
