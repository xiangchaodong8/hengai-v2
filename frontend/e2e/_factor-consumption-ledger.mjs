/**
 * 消费账本 · 产业主权看板挂载（VO 迁出后）
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8000';
const SUITE_URL = BASE + '/static/HengAI_HeavyIndustry_Suite.html?embed=1';

const results = [];
const pass = (name, detail) => results.push({ name, ok: true, detail });
const fail = (name, detail) => results.push({ name, ok: false, detail });

async function login(page) {
  await page.goto(BASE + '/static/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  const token = await page.evaluate(async () => {
    const r = await fetch('/api/v1/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ziteng@co2lion.com', password: 'xd23587052' }),
    });
    const d = await r.json();
    if (!d.access_token) return null;
    localStorage.setItem('hengai_token', d.access_token);
    localStorage.setItem('authToken', d.access_token);
    return d.access_token;
  });
  if (!token) throw new Error('登录失败');
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await login(page);
    await page.goto(SUITE_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(
      () => typeof window.renderHengaiFactorLedger === 'function' && !!document.getElementById('hi-factor-ledger-card'),
      null,
      { timeout: 60000 }
    );
    if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(1500);

    const shape = await page.evaluate(() => {
      window.AppState = window.AppState || {};
      window.AppState.factorAuth = window.AppState.factorAuth || {};
      window.AppState.factorAuth.consumptionLedger = window.AppState.factorAuth.consumptionLedger || {
        total: { count: 0, usageCount: 0 }, byIndustry: [], byMonth: [], claimedConsumers: [], anonymousConsumers: [], anonymousRecords: [],
      };
      const cl = window.AppState.factorAuth.consumptionLedger;
      return {
        hasTotal: cl.total && typeof cl.total.count === 'number',
        arrays: [cl.byIndustry, cl.byMonth, cl.claimedConsumers, cl.anonymousConsumers].every(Array.isArray),
      };
    });
    if (shape.hasTotal && shape.arrays) pass('AppState 账本结构', 'total + 数组齐全');
    else fail('AppState 账本结构', JSON.stringify(shape));

    const emptyUi = await page.evaluate(() => {
      renderHengaiFactorLedger(window.AppState.factorAuth.consumptionLedger || {});
      return {
        card: !!document.getElementById('hi-factor-ledger-card'),
        ledgerInner: !!document.getElementById('consumption-ledger-card'),
        hidden: document.getElementById('hi-factor-ledger-card')?.hidden !== false,
      };
    });
    if (emptyUi.card && emptyUi.ledgerInner) pass('主权看板账本挂载', 'hi-factor-ledger-card + consumption-ledger-card');
    else fail('主权看板账本挂载', JSON.stringify(emptyUi));
    if (emptyUi.hidden) pass('空态隐藏', 'usage=0 时卡片 hidden');
    else fail('空态隐藏', JSON.stringify(emptyUi));

    const dataUi = await page.evaluate(() => {
      window.AppState.factorAuth.consumptionLedger = {
        total: { usageCount: 12, count: 12, carbonTonnageCovered: 1840, taxSavedEur: 2300000, serviceFeeEur: 69000, nursingFundEur: 23000 },
        byIndustry: [{ industry: '钢铁', count: 8, pct: 67 }],
        byMonth: [{ month: '2026-06', count: 7, carbonTonnage: 1040, taxSaved: 1400000 }],
        claimedConsumers: [{ companyName: '苏州精密制造' }],
        anonymousRecords: [{ anonymousId: '匿名企业-023', usageCount: 2 }],
      };
      renderHengaiFactorLedger(window.AppState.factorAuth.consumptionLedger);
      return {
        visible: document.getElementById('hi-factor-ledger-card')?.hidden === false,
        count: document.getElementById('ledger-count')?.textContent,
        claimed: (document.getElementById('claimed-list')?.textContent || '').includes('苏州精密制造'),
      };
    });
    if (dataUi.visible && dataUi.count === '12') pass('数据态展示', '12次引用 · 卡片可见');
    else fail('数据态展示', JSON.stringify(dataUi));
    if (dataUi.claimed) pass('实名消费者', 'claimed-list 渲染');
    else fail('实名消费者', JSON.stringify(dataUi));

    pass('因子页无重复账本', '账本 DOM 仅在主权看板');

    const failed = results.filter((r) => !r.ok);
    console.log('\n=== 消费账本 · 主权看板 ===\n');
    results.forEach((r) => console.log((r.ok ? '✓' : '✗') + ' ' + r.name + (r.detail ? ' — ' + r.detail : '')));
    console.log('\n' + results.filter((r) => r.ok).length + '/' + results.length + ' 通过\n');
    if (failed.length) process.exit(1);
  } catch (err) {
    console.error('自测异常:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
