/**
 * 工业原厂精算 · 扩展指令第四步自测
 * showResult 行业参照 · 石化分配法 · 数据中心 GCA 预览 · 行业单位
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
    await page.waitForFunction(() => typeof showResult === 'function', null, { timeout: 20000 });

    await page.evaluate(() => {
      document.getElementById('inp-steel-5').value = '1.5';
      onInput();
    });
    const steel = await page.evaluate(() => ({
      ref: document.getElementById('fr-ref-val')?.textContent,
      adv: document.getElementById('fr-ref-adv')?.textContent,
      unit: document.getElementById('fr-unit-label')?.textContent,
      shown: document.getElementById('factor-result')?.classList.contains('show'),
    }));
    if (!steel.shown) fail('showResult 展示', 'factor-result 未显示');
    else pass('showResult 展示', 'factor-result 已显示');
    if (!steel.ref || !steel.ref.includes('2.100')) fail('钢铁行业参照', steel.ref);
    else pass('钢铁行业参照', steel.ref);
    if (!steel.adv || steel.adv.indexOf('低') < 0) fail('钢铁优于参照', steel.adv);
    else pass('钢铁优于参照', steel.adv.trim().slice(0, 40));
    if (!steel.unit || steel.unit.indexOf('吨产品') < 0) fail('钢铁单位', steel.unit);
    else pass('钢铁单位', steel.unit);

    await page.click('#tab-petrochem');
    await page.evaluate(() => {
      ['1', '2', '3', '4', '5', '6'].forEach((n) => {
        const el = document.getElementById('inp-petrochem-' + n);
        if (el) el.value = '2';
      });
      onInput();
    });
    const petroEnergy = await page.evaluate(() => computeFactorFromInputs('petrochem'));
    await page.click('#alloc-economic');
    await page.evaluate(() => {
      document.getElementById('cp-ethylene').value = '55';
      document.getElementById('cp-propylene').value = '10';
      document.getElementById('cp-benzene').value = '5';
      document.getElementById('cp-other').value = '30';
      onInput();
    });
    const petroEcon = await page.evaluate(() => ({
      method: INDS.petrochem.allocationMethod,
      factor: computeFactorFromInputs('petrochem'),
      title: document.getElementById('cp-alloc-title')?.textContent,
    }));
    if (petroEcon.method !== 'economic') fail('石化分配法', petroEcon.method);
    else pass('石化分配法', 'economic');
    if (Math.abs(petroEcon.factor - petroEnergy) < 0.0001) {
      fail('石化经济分配加权', `energy=${petroEnergy} economic=${petroEcon.factor}`);
    } else {
      pass('石化经济分配加权', `${petroEnergy.toFixed(3)} → ${petroEcon.factor.toFixed(3)}`);
    }

    await page.click('#tab-datacenter');
    await page.evaluate(() => {
      document.getElementById('inp-datacenter-1').value = '100';
      document.getElementById('inp-datacenter-2').value = '20';
      document.getElementById('inp-datacenter-3').value = '5';
      document.getElementById('inp-datacenter-4').value = '5';
      onInput();
    });
    const dc = await page.evaluate(() => ({
      unit: document.getElementById('fr-unit-label')?.textContent,
      gca: document.getElementById('fr-gca-badge')?.style.display,
      pue: document.getElementById('fr-gca-pue')?.textContent,
      ref: document.getElementById('fr-ref-val')?.textContent,
    }));
    if (!dc.unit || dc.unit.indexOf('MWh') < 0) fail('数据中心单位', dc.unit);
    else pass('数据中心单位', dc.unit);
    if (dc.gca === 'none') fail('GCA 预览条', '未显示');
    else pass('GCA 预览条', 'PUE ' + dc.pue);
    if (!dc.ref || !dc.ref.includes('0.380')) fail('数据中心参照', dc.ref);
    else pass('数据中心参照', dc.ref);

    await page.click('#tab-port');
    await page.evaluate(() => {
      document.getElementById('inp-port-1').value = '0.008';
      onInput();
    });
    const port = await page.evaluate(() => document.getElementById('fr-unit-label')?.textContent);
    if (!port || port.indexOf('TEU') < 0) fail('港口单位', port);
    else pass('港口单位', port);

    const failed = results.filter((r) => !r.ok);
    console.log('\n=== 因子精算 Step4 自测 ===\n');
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
