/**
 * 原厂侧 · 供应链待确认绑定 UI（迁出因子页后）
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8000';
const SUPPLY_URL = BASE + '/static/HengAI_%E4%BE%9B%E5%BA%94%E9%93%BE%E5%8D%8F%E5%90%8C.html?embed=1';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(BASE + '/static/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
    const token = await page.evaluate(async () => {
      const r = await fetch('/api/v1/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'ziteng@co2lion.com', password: 'xd23587052' }),
      });
      const d = await r.json();
      localStorage.setItem('hengai_token', d.access_token);
      localStorage.setItem('authToken', d.access_token);
      return d.access_token;
    });
    if (!token) throw new Error('登录失败');

    await page.goto(SUPPLY_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(
      () => typeof window.hengaiRefreshOriginGovernance === 'function',
      null,
      { timeout: 30000 }
    );
    await page.evaluate(() => hengaiRefreshOriginGovernance());

    const ui = await page.evaluate(() => ({
      panel: !!document.getElementById('sup-origin-governance'),
      pendingBox: !!document.getElementById('sup-origin-pending-bindings'),
      pendingPill: !!document.getElementById('sup-pending-binding-pill'),
      factorBindingList: !!document.getElementById('binding-pending-list'),
    }));

    console.log('\n=== 供应链 · 待确认绑定 UI ===\n');
    const checks = [
      ['治理面板 DOM', ui.panel, 'sup-origin-governance'],
      ['待确认申报区块', ui.pendingBox && ui.pendingPill, 'sup-origin-pending-bindings'],
      ['因子页无 binding-pending-list', !ui.factorBindingList, '已迁出'],
    ];
    let ok = true;
    checks.forEach(([n, p, d]) => { console.log((p ? '✓' : '✗') + ' ' + n + ' — ' + d); if (!p) ok = false; });
    console.log('\n' + checks.filter((c) => c[1]).length + '/' + checks.length + ' 通过\n');
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error('UI 闭环异常:', e.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}
main();
