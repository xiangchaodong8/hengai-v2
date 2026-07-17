/**
 * 全域 pipeline · factorAuth GCA 字段 embed 回传自测
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8000/static';
const PAGE = `${BASE}/HengAI_%E5%B7%A5%E4%B8%9A%E5%8E%9F%E5%8E%82%E7%B2%BE%E7%AE%97.html?embed=1`;

const results = [];
const pass = (n, d) => results.push({ ok: true, name: n, detail: d });
const fail = (n, d) => results.push({ ok: false, name: n, detail: d });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => typeof buildHubPipelinePayload === 'function', null, { timeout: 20000 });

    const piped = await page.evaluate(() => {
      window.AppState = window.AppState || {};
      window.AppState.factorAuth = {
        pledgeBy: '测试数据中心',
        pooledByIndustry: { datacenter: { factor: 0.513, certNo: 'CL-TEST' } },
        gcaCertGenerated: true,
        gcaCertId: 'GCA-TEST-001',
        pueValue: 1.35,
        confirmedFactor: 0.513,
        confirmedIndustry: 'datacenter',
      };
      const p = buildHubPipelinePayload(window.AppState);
      return p.factorAuth;
    });

    if (piped?.gcaCertId === 'GCA-TEST-001') pass('pipeline gcaCertId', piped.gcaCertId);
    else fail('pipeline gcaCertId', JSON.stringify(piped));
    if (piped?.pueValue === 1.35) pass('pipeline pueValue', String(piped.pueValue));
    else fail('pipeline pueValue', String(piped?.pueValue));
    if (piped?.gcaCertGenerated === true) pass('pipeline gcaCertGenerated', 'true');
    else fail('pipeline gcaCertGenerated', String(piped?.gcaCertGenerated));

    const mapped = await page.evaluate(() => ({
      petro: canonicalIndustryCode('petrochem'),
      ui: factorUiIndustryKey('petro'),
    }));
    if (mapped.petro === 'petro' && mapped.ui === 'petrochem') pass('AppState 映射', 'petrochem↔petro');
    else fail('AppState 映射', JSON.stringify(mapped));

    const bad = results.filter((r) => !r.ok);
    console.log('\n=== Pipeline/GCA 自测 ===\n');
    results.forEach((r) => console.log((r.ok ? '✓' : '✗') + ' ' + r.name + ' — ' + r.detail));
    if (bad.length) process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
