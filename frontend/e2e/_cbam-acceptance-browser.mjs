/**
 * CBAM ① 浏览器验收 · 商业开关 OFF + Step UI 挂载
 * 运行: node e2e/_cbam-acceptance-browser.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8000';
const HUB = `${BASE}/static/%E5%85%A8%E5%9F%9F%E4%B8%AD%E5%BF%83.html#calc`;
const results = [];

function pass(label, detail = '') {
  results.push({ label, ok: true, detail });
  console.log(`  [PASS] ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label, detail = '') {
  results.push({ label, ok: false, detail });
  console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function main() {
  console.log('='.repeat(60));
  console.log('CBAM ① 浏览器验收');
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  try {
    await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);

    const gate = await page.evaluate(() => ({
      enabled: typeof window.commercialGatesEnabled === 'function'
        ? window.commercialGatesEnabled()
        : null,
      switchVal: window.HENGAI_COMMERCIAL_GATES_ENABLED,
      hasRegistry: !!window.COMMERCIAL_GATE_REGISTRY,
      commitBlock: typeof window.checkCommercialGate === 'function'
        ? window.checkCommercialGate('commit_cbam')
        : 'no-fn',
    }));
    if (gate.switchVal === false && gate.enabled === false) {
      pass('商业开关 OFF', `switch=${gate.switchVal}`);
    } else {
      fail('商业开关 OFF', JSON.stringify(gate));
    }
    if (gate.hasRegistry) pass('COMMERCIAL_GATE_REGISTRY 已加载');
    else fail('COMMERCIAL_GATE_REGISTRY 已加载');
    if (gate.commitBlock === null) pass('commit_cbam 不拦截（开关 OFF）');
    else fail('commit_cbam 不拦截', String(gate.commitBlock));

    const ui = await page.evaluate(() => {
      const cbamPg = document.getElementById('H-pg-cbam');
      const iframe = cbamPg && cbamPg.querySelector('iframe');
      const hasCalc = !!document.querySelector('[data-cbam-step], .cbam-step, #cbam-root, #cbam-app');
      const paywallCard = document.body.innerText.includes('CBAM 身份与商业卡口');
      return {
        hubCbam: !!cbamPg,
        iframe: !!iframe,
        hasCalc,
        paywallCard,
        title: document.title,
      };
    });
    if (ui.hubCbam) pass('Hub #H-pg-cbam 存在');
    else fail('Hub #H-pg-cbam 存在');
    if (!ui.paywallCard) pass('无持久商业卡片');
    else fail('无持久商业卡片', '仍显示 CBAM 身份与商业卡口');

    const cbamUrl = `${BASE}/static/HengAI_CBAM%E6%B5%8B%E7%AE%97%E5%B7%A5%E5%85%B7.html`;
    await page.goto(cbamUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    const calc = await page.evaluate(() => ({
      hasAppState: typeof window.AppState !== 'undefined',
      hasGoStep: typeof window.goStep === 'function',
      stepHead: !!document.getElementById('step-head'),
      sec1: !!document.getElementById('sec1'),
      hasCalcCore: typeof window.CbamCalcCore !== 'undefined',
    }));
    if (calc.hasAppState) pass('CBAM 页 AppState 加载');
    else fail('CBAM 页 AppState 加载');
    if (calc.stepHead && calc.sec1 && calc.hasGoStep) {
      pass('CBAM Step UI 挂载', 'step-head + sec1 + goStep');
    } else {
      fail('CBAM Step UI 挂载', JSON.stringify(calc));
    }

    if (errors.length === 0) pass('无 pageerror');
    else fail('无 pageerror', errors.slice(0, 3).join(' | '));
  } catch (e) {
    fail('浏览器导航', String(e.message || e));
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(60));
  console.log(`合计: ${results.length - failed.length} PASS / ${failed.length} FAIL`);
  if (failed.length) {
    process.exit(1);
  }
  console.log('CBAM ① 浏览器验收通过');
  console.log('='.repeat(60));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
