import { chromium } from 'playwright';

const url = 'http://127.0.0.1:8000/static/%E5%85%A8%E5%9F%9F%E4%B8%AD%E5%BF%83.html#calc';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => typeof window.navTo === 'function', null, { timeout: 20000 });

await page.evaluate(() => {
  window.AppState = window.AppState || {};
  window.AppState.user = { isLoggedIn: true, name: 'ziteng' };
  window.AppState.flags = { hasOriginFactoryPerm: false, userRole: 'ROLE_SME' };
  window.navTo('origin-audit', document.getElementById('n-origin-audit'));
});

await page.waitForTimeout(2000);
const frameEl = await page.locator('#page-origin-audit iframe.embed-frame').elementHandle();
const frame = await frameEl.contentFrame();
if (!frame) throw new Error('iframe missing');

await frame.waitForSelector('#hi-suite', { state: 'attached', timeout: 15000 });
await frame.evaluate(() => {
  window.AppState = window.AppState || {};
  window.AppState.user = { isLoggedIn: true, name: 'ziteng' };
  window.AppState.flags = { hasOriginFactoryPerm: false, userRole: 'ROLE_SME' };
  if (typeof window.guardOriginFactoryPage === 'function') window.guardOriginFactoryPage();
});

await frame.waitForSelector('#hi-sme-goto-calc', { timeout: 10000 });

const fnCheck = await frame.evaluate(() => ({
  gotoCbam: typeof window.gotoCbamFromOriginBlocker,
  hengaiSwitch: typeof window.hengaiSwitchHubPage,
  switchHubPageHead: String(window.switchHubPage || '').slice(0, 80),
}));
console.log('FN', fnCheck);

await frame.click('#hi-sme-goto-calc');
await page.waitForTimeout(500);

const result = await page.evaluate(() => ({
  calcActive: document.getElementById('page-calc')?.classList.contains('active'),
  originActive: document.getElementById('page-origin-audit')?.classList.contains('active'),
  title: document.getElementById('tb-title')?.textContent,
}));

console.log('RESULT', JSON.stringify(result, null, 2));
await browser.close();

if (!result.calcActive) {
  console.error('FAIL');
  process.exit(2);
}
console.log('PASS');
