import { chromium } from 'playwright';

const url = 'http://127.0.0.1:8000/static/%E5%85%A8%E5%9F%9F%E4%B8%AD%E5%BF%83.html#calc';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForFunction(() => typeof window.navTo === 'function');

await page.evaluate(() => {
  window.AppState = window.AppState || {};
  window.AppState.user = { isLoggedIn: true, name: '测试原厂', workspaceRole: 'ROLE_ORIGIN' };
  window.AppState.company = { type: 'ORIGIN', industryCode: 'steel', name: '测试钢铁有限公司' };
  window.AppState.flags = { hasOriginFactoryPerm: true, userRole: 'ROLE_ORIGIN', currentPhase: 'Phase2' };
  if (typeof window.applyIdentityAwareNav === 'function') window.applyIdentityAwareNav(window.AppState);
  window.navTo('calc', document.getElementById('nav-calc'));
});

await page.waitForTimeout(500);
const calcStay = await page.evaluate(() => ({
  calcActive: document.getElementById('page-calc')?.classList.contains('active'),
  originActive: document.getElementById('page-origin-audit')?.classList.contains('active'),
  calcNavText: document.getElementById('nav-calc')?.textContent?.trim(),
}));

console.log('ORIGIN CALC STAY', JSON.stringify(calcStay, null, 2));

await page.evaluate(() => {
  window.navTo('origin-audit', document.getElementById('n-origin-audit'));
});
await page.waitForTimeout(500);
const originNav = await page.evaluate(() => ({
  calcActive: document.getElementById('page-calc')?.classList.contains('active'),
  originActive: document.getElementById('page-origin-audit')?.classList.contains('active'),
  title: document.getElementById('tb-title')?.textContent,
  originOnclick: document.getElementById('n-origin-audit')?.getAttribute('onclick') || '',
}));
console.log('ORIGIN AUDIT NAV', JSON.stringify(originNav, null, 2));

await browser.close();

if (!calcStay.calcActive || calcStay.originActive) process.exit(2);
if (!calcStay.calcNavText?.includes('CBAM')) process.exit(3);
if (!originNav.originActive) process.exit(4);
console.log('PASS');
