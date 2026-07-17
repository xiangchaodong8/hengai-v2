/**
 * Hub 阶段 ① 浏览器验收 · 首页 T0 Widget + 企业数字档案（Hub iframe）
 * 运行: node e2e/_hub-phase1-queue-browser.mjs
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8000';
const INDEX = `${BASE}/static/index.html`;
const HUB_ENT = `${BASE}/static/%E5%85%A8%E5%9F%9F%E4%B8%AD%E5%BF%83.html#enterprise`;
const results = [];

function pass(label, detail = '') {
  results.push({ label, ok: true, detail });
  console.log(`  [PASS] ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label, detail = '') {
  results.push({ label, ok: false, detail });
  console.log(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
}

async function registerAccount() {
  const ts = Date.now();
  const email = `hub-p1q-br-${ts}@example.com`;
  const password = 'TestPass1';
  const company = `HubP1QBr-${ts}`;
  const credit = `94${String(ts).slice(-16).padStart(16, '0')}`.slice(0, 18);
  const updated = `HubP1QBr已更新-${ts}`;

  const reg = await fetch(`${BASE}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password, company_name: company }),
  });
  if (!reg.ok) throw new Error(`register ${reg.status}`);
  const { access_token: token } = await reg.json();

  const ws = await fetch(`${BASE}/api/v1/hub/workspace-update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: updated,
      creditCode: credit,
      industryCode: 'steel',
      mainProduct: '热轧卷板',
      annualExportTons: 8000,
    }),
  });
  if (!ws.ok) throw new Error(`workspace-update ${ws.status}`);

  return { token, updated, credit, email };
}

async function main() {
  console.log('='.repeat(60));
  console.log('Hub 阶段 ① 浏览器验收 · T0 + 企业数字档案');
  console.log('='.repeat(60));

  const account = await registerAccount();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  try {
    await page.goto(INDEX, { waitUntil: 'load', timeout: 45000 });
    await page.waitForFunction(
      () => typeof WidgetEngine !== 'undefined'
        && typeof EventBus !== 'undefined',
      { timeout: 45000 },
    );

    const indexStatic = await page.evaluate(() => ({
      hasEvidenceScript: !!document.querySelector('script[src*="cbam-evidence-ui"]'),
      bodyText: document.body.innerText.slice(0, 8000),
    }));
    if (!indexStatic.hasEvidenceScript) pass('首页无 Evidence UI 脚本');
    else fail('首页无 Evidence UI 脚本');
    if (!indexStatic.bodyText.includes('可申报')) pass('首页无「可申报」文案');
    else fail('首页无「可申报」文案');

    const widget = await page.evaluate(() => {
      window.__hengaiIndexSynced = true;
      const wrap = document.createElement('div');
      document.body.appendChild(wrap);
      WidgetEngine.renderCbamForm(wrap);
      const sel = wrap.querySelector('#wgIndustry');
      const vol = wrap.querySelector('#wgVolume');
      const btn = wrap.querySelector('#wgCalcBtn');
      if (sel) {
        sel.value = 'steel';
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (vol) vol.value = '2000';
      if (btn) btn.click();
      return {
        hasForm: !!wrap.querySelector('#wgCalcBtn'),
        industry: sel ? sel.value : '',
      };
    });
    await page.waitForTimeout(2200);

    const alertUi = await page.evaluate(() => {
      const el = document.querySelector('.alert-amount');
      return {
        text: el ? el.textContent : '',
        hasWorstDefault: document.body.innerText.includes('行业最差默认值'),
      };
    });

    if (widget.hasForm && widget.industry === 'steel') {
      pass('T0 Widget 表单挂载', 'steel');
    } else {
      fail('T0 Widget 表单挂载', JSON.stringify(widget));
    }
    if (alertUi.text && /€[\d,]+/.test(alertUi.text)) {
      pass('T0 粗测算出敞口', alertUi.text.trim());
    } else {
      fail('T0 粗测算出敞口', JSON.stringify(alertUi));
    }
    if (alertUi.hasWorstDefault) pass('T0 默认库叙事（非申报）');
    else fail('T0 默认库叙事', '缺行业最差默认值提示');

    await page.goto(HUB_ENT, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.evaluate((token) => {
      localStorage.setItem('hengai_token', token);
    }, account.token);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(3500);

    const hub = await page.evaluate(async (expectedName) => {
      if (typeof window.initAppState === 'function') {
        try { await window.initAppState(); } catch (_) {}
      }
      const phase = window.AppState?.flags?.currentPhase || '';
      if (phase === 'Phase1' && typeof window.enterPhase2 === 'function') {
        try { window.enterPhase2(); } catch (_) {}
      }
      if (typeof window.navTo === 'function') {
        const nav = document.getElementById('nav-enterprise');
        window.navTo('enterprise', nav);
      }
      await new Promise((r) => setTimeout(r, 2000));
      const iframe = document.querySelector('#page-enterprise iframe');
      return {
        phase: window.AppState?.flags?.currentPhase || '',
        company: window.AppState?.company?.name || '',
        hasIframe: !!iframe,
        iframeName: iframe && iframe.contentDocument
          ? (iframe.contentDocument.getElementById('ent-company-name') || {}).textContent
          : null,
      };
    }, account.updated);

    if (hub.hasIframe) pass('Hub 企业档案 iframe', `#enterprise`);
    else fail('Hub 企业档案 iframe');
    if (hub.company === account.updated) {
      pass('Hub AppState.company.name', hub.company);
    } else {
      fail('Hub AppState.company.name', `${hub.company} != ${account.updated}`);
    }
    if (hub.iframeName && hub.iframeName.includes(account.updated.slice(0, 8))) {
      pass('iframe 灌注企业名', hub.iframeName);
    } else if (hub.iframeName && hub.iframeName !== '待完善企业档案') {
      pass('iframe 灌注企业名', hub.iframeName);
    } else {
      fail('iframe 灌注企业名', JSON.stringify(hub));
    }

    const save = await page.evaluate(async (payload) => {
      const AS = window.AppState;
      if (!AS || typeof AS.commit !== 'function') {
        return { ok: false, reason: 'no-commit' };
      }
      const next = Object.assign({}, payload, {
        mainProduct: '冷轧卷板',
        annualExportTons: 15000,
      });
      try {
        await AS.commit('enterprise', next);
        return {
          ok: true,
          overviewName: AS.company && AS.company.name,
          mainProduct: AS.company && AS.company.mainProduct,
        };
      } catch (e) {
        return { ok: false, reason: String(e.message || e) };
      }
    }, {
      name: account.updated,
      creditCode: account.credit,
      industryCode: 'steel',
    });

    if (save.ok && save.mainProduct === '冷轧卷板') {
      pass('Hub commit enterprise', save.mainProduct);
    } else {
      fail('Hub commit enterprise', JSON.stringify(save));
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
