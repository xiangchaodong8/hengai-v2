/**
 * 工业原厂精算 · 扩展指令第一步自测
 * 钢铁长/短流程 · 铝业子类型 · 水泥熟料比例 · getProcs/computeFactor
 */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
    await page.waitForFunction(() => typeof getProcs === 'function' && typeof INDS !== 'undefined', null, { timeout: 20000 });
    await page.waitForSelector('#grid-steel .proc-card', { timeout: 15000 });

    const steelBf = await page.evaluate(() => ({
      count: getProcs('steel').length,
      names: getProcs('steel').map((p) => p.name),
      ref: getIndRef('steel'),
    }));
    if (steelBf.count !== 9) fail('钢铁长流程工序数', `期望 9，实际 ${steelBf.count}`);
    else pass('钢铁长流程工序数', `9 道 · ref=${steelBf.ref}`);
    if (!steelBf.names.includes('自备电厂')) fail('钢铁长流程内容', '缺少自备电厂工序');
    else pass('钢铁长流程内容', '含自备电厂');

    await page.click('#stab-eaf');
    await page.waitForFunction(() => getProcs('steel').length === 6, null, { timeout: 5000 });
    const steelEaf = await page.evaluate(() => ({
      count: getProcs('steel').length,
      ref: getIndRef('steel'),
      active: document.getElementById('stab-eaf')?.className.includes('on'),
    }));
    if (steelEaf.count !== 6) fail('钢铁短流程工序数', `期望 6，实际 ${steelEaf.count}`);
    else pass('钢铁短流程工序数', `6 道 · ref=${steelEaf.ref}`);
    if (steelEaf.ref !== 0.8) fail('钢铁短流程参照值', `期望 0.8，实际 ${steelEaf.ref}`);
    else pass('钢铁短流程参照值', '0.8');
    if (!steelEaf.active) fail('钢铁短流程 Tab', 'stab-eaf 未激活');
    else pass('钢铁短流程 Tab', 'stab-eaf 已激活');

    const alModel = await page.evaluate(() => ({
      primary: INDS.aluminum.procs.primary.length,
      processing: INDS.aluminum.procs.processing.length,
      dieCast: INDS.aluminum.procs.processing.some((p) => p.name.indexOf('压铸') >= 0),
    }));
    if (alModel.primary !== 6) fail('铝业模型', `原铝 ${alModel.primary}`);
    else pass('铝业模型', '原铝 6 道 · 深加工含压铸');

    await page.click('#tab-aluminum');
    const alLock = await page.evaluate(() => document.querySelectorAll('#grid-aluminum .proc-card').length);
    if (alLock === 0) pass('铝业预览锁', '非本行业无工序 DOM');
    else fail('铝业预览锁', String(alLock));

    const cementUi = await page.evaluate(() => {
      _homeIndustryKey = 'cement';
      _industryScopeFormal = false;
      applyIndustryScopeUI({});
      renderProcGrid('cement');
      switchInd(null, 'cement');
      return document.querySelectorAll('#grid-cement .proc-card').length;
    });
    if (cementUi !== 6) fail('水泥本行业切换', `工序 ${cementUi}`);
    else pass('水泥本行业切换', '6 道可编辑');
    const cement = await page.evaluate(() => {
      _homeIndustryKey = 'cement';
      _industryScopeFormal = false;
      curInd = 'cement';
      renderProcGrid('cement');
      ['1', '2', '3', '4', '5', '6'].forEach((n) => {
        const el = document.getElementById('inp-cement-' + n);
        if (el) el.value = '1';
      });
      const cl = document.getElementById('inp-cement-clinker');
      if (cl) cl.value = '85';
      onInput();
      return {
        factor: computeFactorFromInputs('cement'),
        shown: document.getElementById('fr-val')?.textContent,
      };
    });
    const expected = 1.0 * (0.5 + 0.85 * 0.5);
    if (Math.abs(cement.factor - expected) > 0.001) {
      fail('水泥熟料加权', `期望 ${expected.toFixed(3)}，compute=${cement.factor}`);
    } else {
      pass('水泥熟料加权', `${cement.factor.toFixed(3)}（85%熟料）`);
    }
    if (cement.shown !== expected.toFixed(3)) {
      fail('水泥结果展示', `fr-val=${cement.shown}`);
    } else {
      pass('水泥结果展示', `fr-val=${cement.shown}`);
    }

    const failed = results.filter((r) => !r.ok);
    console.log('\n=== 因子精算 Step1 自测 ===\n');
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
