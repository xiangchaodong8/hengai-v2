/**
 * Phase 1 · 双模状态机浏览器验收（shadow/drift + Evidence Bar）
 * 运行: node e2e/_evidence-phase1-browser.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8000';
const CBAM = `${BASE}/static/HengAI_CBAM%E6%B5%8B%E7%AE%97%E5%B7%A5%E5%85%B7.html`;
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
  console.log('Phase 1 · evidence browser acceptance');
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  try {
    await page.goto(CBAM, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(
      () => typeof window.syncEvidenceFromSimulation === 'function'
        && typeof window.renderCbamEvidenceBar === 'function',
      { timeout: 20000 },
    );

    const shadow = await page.evaluate(() => {
      window.AppState = window.AppState || {};
      window.AppState.company = Object.assign({}, window.AppState.company || {}, {
        cityState: 'certified',
        name: 'Evidence P1 E2E',
      });
      window.AppState.cbam = window.AppState.cbam || {};
      window.AppState.cbam.evidence = {
        mode: 'SOVEREIGN_VERIFIED',
        value: 1.87,
        unit: 'tCO2e/t',
        dictVersion: 'IND_DICT_2026.06',
        calcVersion: 'CORE_V1',
        verified: { certId: 'CL-GTCID-P1-E2E' },
        shadow: {},
      };
      window.syncEvidenceFromSimulation({ ci: 2.5, mainProduct: 'steel' }, window.AppState);
      const ev = window.AppState.cbam.evidence;
      return {
        value: ev.value,
        sim: ev.shadow && ev.shadow.simulatedValue,
        drift: ev.shadow && ev.shadow.driftPct,
      };
    });

    if (Math.abs(shadow.value - 1.87) < 1e-6) {
      pass('已确权主值不被模拟覆盖', String(shadow.value));
    } else {
      fail('已确权主值不被模拟覆盖', JSON.stringify(shadow));
    }
    if (Math.abs(shadow.sim - 2.5) < 1e-6 && shadow.drift > 30) {
      pass('shadow 漂移写入', `sim=${shadow.sim} drift=${shadow.drift.toFixed(1)}%`);
    } else {
      fail('shadow 漂移写入', JSON.stringify(shadow));
    }

    await page.evaluate(() => {
      if (typeof window.goStep === 'function') window.goStep(4);
      window.renderCbamEvidenceBar({ syncCiDisplay: false });
    });
    await page.waitForTimeout(400);

    const bar = await page.evaluate(() => {
      const el = document.getElementById('cbam-evidence-bar');
      const drift = document.getElementById('cbam-evidence-drift');
      const badge = document.getElementById('cbam-evidence-badge');
      return {
        hasBar: !!el,
        verifiedCss: el && el.classList.contains('evidence-mode-verified'),
        driftVisible: drift && !drift.hidden,
        driftText: drift ? drift.textContent : '',
        badge: badge ? badge.textContent : '',
      };
    });

    if (bar.hasBar && bar.verifiedCss) {
      pass('Evidence Bar 已确权样式', bar.badge);
    } else {
      fail('Evidence Bar 已确权样式', JSON.stringify(bar));
    }
    if (bar.driftVisible && bar.driftText.includes('偏离')) {
      pass('漂移气泡可见', bar.driftText.slice(0, 48));
    } else {
      fail('漂移气泡可见', JSON.stringify(bar));
    }

    const elevate = await page.evaluate(() => {
      window.AppState.cbam.evidence.mode = 'SIMULATED';
      window.AppState.company.cityState = null;
      window.AppState.cbam.evidence.value = 2.1;
      if (typeof window.initiateEvidenceElevation !== 'function') {
        return { ok: false, reason: 'no-fn' };
      }
      const token = 'fake-token-for-ui';
      try {
        localStorage.setItem('hengai_token', token);
      } catch (_) {}
      window.AppState.auth = { user: { email: 'e2e@test.com' }, token };
      const ret = window.initiateEvidenceElevation({ openCore: false });
      const mode = window.AppState.cbam.evidence.mode;
      const city = window.AppState.company && window.AppState.company.cityState;
      return { ok: ret !== false, mode, city };
    });

    if (elevate.mode === 'PENDING_VERIFICATION' && elevate.city === 'evidence_building') {
      pass('升格 → PENDING_VERIFICATION', elevate.city);
    } else {
      fail('升格 → PENDING_VERIFICATION', JSON.stringify(elevate));
    }

    if (errors.length === 0) pass('无 pageerror');
    else fail('无 pageerror', errors.slice(0, 2).join(' | '));
  } catch (e) {
    fail('浏览器执行', String(e.message || e));
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + '='.repeat(60));
  console.log(`合计: ${results.length - failed.length} PASS / ${failed.length} FAIL`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
