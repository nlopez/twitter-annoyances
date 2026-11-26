// Playwright MCP helper: inject the userscript at document-start and load x.com.
// Run via browser_run_code_unsafe with filename "dev/load.js" on a fresh
// browser (browser_close first), since init scripts can't be removed.
async (page) => {
  await page.addInitScript({ path: 'twitter-annoyances.user.js' });
  await page.goto('https://x.com/home');
  await page.waitForSelector('[data-testid="primaryColumn"]');
  return page.url();
}
