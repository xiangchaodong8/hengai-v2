/**
 * 工业原厂精算 · 扩展指令第二步自测（5 新行业 + 8 Tab）
 */
import { chromium } from 'playwright';

const PAGE_URL = process.env.FACTOR_TEST_URL
  || 'http://127.0.0.1:8000/static/HengAI_%E5%B7%A5%E4%B8%9A%E5%8E%9F%E5%8E%82%E7%B2%BE%E7%AE%97.html?embed=1';

const results = [];
const pass = (name, detail) => results.push({ name, ok: true, detail });
const fail = (name, detail) => results.push({ name, ok: false, detail });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof INDS !== 'undefined' && typeof applyIndustryScopeUI === 'function', null, { timeout: 20000 });
    await page.waitForSelector('#ind-scope-banner', { timeout: 10000 });

    const keys = await page.evaluate(() => Object.keys(INDS).sort());
    const expected = ['aluminum', 'cement', 'ceramics', 'datacenter', 'paper', 'petrochem', 'port', 'steel'];
    if (keys.join(',') !== expected.join(',')) fail('INDS 行业键', keys.join(', '));
    else pass('INDS 行业键', '8 个行业齐全');

    const tabCount = await page.locator('.ind-tabs > .ind-tab').count();
    if (tabCount !== 8) fail('行业 Tab 数', String(tabCount));
    else pass('行业 Tab 数', '8 个');

    await page.click('#tab-petrochem');
    await page.waitForSelector('#lock-ph-petrochem', { timeout: 5000 });
    const petroLock = await page.evaluate(() => ({
      cards: document.querySelectorAll('#grid-petrochem .proc-card').length,
      locked: document.getElementById('panel-petrochem')?.classList.contains('foreign-locked'),
      factor: computeFactorFromInputs('petrochem'),
    }));
    if (petroLock.cards === 0 && petroLock.locked && petroLock.factor == null) {
      pass('石化预览锁', '无工序 DOM · 不可算');
    } else fail('石化预览锁', JSON.stringify(petroLock));

    await page.click('#tab-steel');
    await page.evaluate(() => {
      document.getElementById('inp-steel-1').value = '1.0';
      onInput();
    });
    const steelOk = await page.evaluate(() => computeFactorFromInputs('steel'));
    if (steelOk != null && steelOk > 0) pass('本行业可操作', 'steel factor=' + steelOk.toFixed(3));
    else fail('本行业可操作', String(steelOk));

    await page.click('#tab-datacenter');
    const dcLock = await page.evaluate(() => ({
      cards: document.querySelectorAll('#grid-datacenter .proc-card').length,
      factor: computeFactorFromInputs('datacenter'),
    }));
    if (dcLock.cards === 0 && dcLock.factor == null) pass('数据中心预览锁', '已屏蔽');
    else fail('数据中心预览锁', JSON.stringify(dcLock));

    const failed = results.filter((r) => !r.ok);
    console.log('\n=== 因子精算 Step2 自测 ===\n');
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
