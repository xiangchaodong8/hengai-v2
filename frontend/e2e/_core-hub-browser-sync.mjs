/**
 * 浏览器真联调 · 精算芯(:8001) → Hub(:8000) overview/sync
 *
 * 前置：Hub docker 健康；本脚本会尝试拉起 Core uvicorn（若 8001 未监听）。
 * 用法：cd frontend && node e2e/_core-hub-browser-sync.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB = process.env.HENGAI_HUB_BASE || 'http://127.0.0.1:8000';
const CORE = process.env.HENGAI_CORE_BASE || 'http://127.0.0.1:8001';
const CORE_ROOT = process.env.HENGAI_CORE_ROOT
  || path.resolve(__dirname, '..', '..', '..', 'HengAI_Core_Test');
const TS = Date.now();
const EMAIL = `browser-sync-${TS}@example.com`;
const PASS = 'TestPass1';
const COMPANY = `浏览器联调原厂-${TS}`;
/** 每次唯一；evaluate 注入的 bundle.productionEntity 与此对齐 */
const CREDIT = `91${String(TS).slice(-16).padStart(16, '0')}`.slice(0, 18);

let coreProc = null;

async function hubJson(method, p, body, token) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${HUB}${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

async function waitUrl(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url, { method: 'GET' });
      if (r.ok || r.status < 500) return true;
    } catch { /* retry */ }
    await sleep(1000);
  }
  return false;
}

async function ensureCore() {
  if (await waitUrl(`${CORE}/HengAI_Universal_Core.html`, 3000)) {
    console.log('✅ Core 已在线', CORE);
    return;
  }
  console.log('ℹ 启动 Core uvicorn @', CORE_ROOT);
  coreProc = spawn(
    'python',
    ['-m', 'uvicorn', 'universal_audit_engine:app', '--port', '8001', '--host', '127.0.0.1'],
    { cwd: CORE_ROOT, stdio: 'ignore', shell: true, detached: process.platform !== 'win32' },
  );
  const ok = await waitUrl(`${CORE}/HengAI_Universal_Core.html`, 90000);
  if (!ok) throw new Error('Core :8001 启动超时');
  console.log('✅ Core 已拉起');
}

function stopCore() {
  if (!coreProc) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(coreProc.pid), '/T', '/F'], { shell: true });
    } else {
      process.kill(-coreProc.pid, 'SIGTERM');
    }
  } catch { /* ignore */ }
  coreProc = null;
}

async function main() {
  const health = await hubJson('GET', '/api/health');
  if (health.status !== 200) throw new Error('Hub 未就绪: ' + JSON.stringify(health.data));
  console.log('✅ Hub', health.data?.message || 'ok');

  const reg = await hubJson('POST', '/api/v1/auth/register', {
    email: EMAIL,
    password: PASS,
    company_name: COMPANY,
  });
  if (![200, 201].includes(reg.status) || !reg.data?.access_token) {
    throw new Error('register failed: ' + JSON.stringify(reg.data));
  }
  const token = reg.data.access_token;
  console.log('✅ Hub 注册', EMAIL);

  const ws = await hubJson('POST', '/api/v1/hub/workspace-update', {
    name: CREDIT,
    creditCode: CREDIT,
    industryCode: 'steel',
    mainProduct: '热轧卷板',
  }, token);
  if (ws.status !== 200) throw new Error('workspace-update failed: ' + JSON.stringify(ws.data));
  console.log('✅ workspace credit =', CREDIT);

  await ensureCore();

  const coreUrl = `${CORE}/HengAI_Universal_Core.html?hubSync=1&hubToken=${encodeURIComponent(token)}`;
  async function launchBrowser() {
    for (const channel of ['msedge', 'chrome', 'chromium']) {
      try {
        const opts = { headless: true };
        if (channel !== 'chromium') opts.channel = channel;
        const browser = await chromium.launch(opts);
        console.log('ℹ 使用浏览器:', channel);
        return browser;
      } catch (e) {
        console.warn('  skip', channel, (e.message || '').slice(0, 80));
      }
    }
    throw new Error('无可用浏览器。请安装 Edge/Chrome，或: npx playwright install chromium');
  }
  const browser = await launchBrowser();
  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || /syncToGlobalHub|并网/.test(msg.text())) {
      console.log('  [console]', msg.type(), msg.text().slice(0, 200));
    }
  });

  await page.goto(coreUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.syncToGlobalHub === 'function', null, { timeout: 30000 });

  const standalone = await page.evaluate(() => !!window.LOCAL_CONFIG?.standalone);
  const hasTok = await page.evaluate(() => !!(window.LOCAL_CONFIG?.hubAccessToken || window.resolveHubAccessToken?.()));
  if (standalone) throw new Error('hubSync=1 未关闭 standalone');
  if (!hasTok) throw new Error('hubToken 未注入');
  console.log('✅ Core 联调模式 standalone=false · token 已注入');

  const syncResult = await page.evaluate(async ({ company, credit, ts }) => {
    const bundle = {
      source: 'hengai_universal_core',
      industryId: 'steel',
      batchId: `BROWSER-SYNC-${ts}`,
      dataFingerprint: `fp:browser:${ts}`,
      encHash: `enc:browser:${ts}`,
      carbonIntensity: 1.87,
      gmReward: 150,
      holder: company,
      productionEntity: credit,
      productionEntitySource: 'enterprise_legal',
      enterpriseRegistryId: null,
      certificateId: `CL-GTCID-2026-BR-${ts}`,
      issuedAt: new Date().toISOString(),
      cnCode: '7208',
      totalEmission: 18700,
      productOutputT: 10000,
      calibration: 'cited',
      matBoxLocked: false,
      provenanceGrade: 'cited',
      dataFitReport: {
        fitDegreePct: 90,
        credibilityScore: 70,
        suspicionLevel: 'LOW',
        gmReward: 150,
        euAuditRisk: 'LOW',
      },
      deviationSummary: { count: 0, hasCritical: false, hasWarning: false },
    };
    // maturity via qualityTag inside buildHubSyncPayload
    const hub = await window.syncToGlobalHub(bundle);
    return {
      hub,
      lastCityState: window.AppState?.hub?.lastCityState || null,
      lastPullEligible: window.AppState?.hub?.lastPullEligible,
    };
  }, { company: COMPANY, credit: CREDIT, ts: TS });

  if (!syncResult.hub) {
    throw new Error('syncToGlobalHub 返回 null（见 console · 多为 token/主体不匹配）');
  }
  console.log('✅ Core→Hub sync', {
    cityState: syncResult.hub.cityState,
    pullEligible: syncResult.hub.pullEligible,
    message: (syncResult.hub.message || '').slice(0, 80),
  });

  if (syncResult.hub.cityState !== 'evidence_building') {
    throw new Error('期望 cityState=evidence_building，实际 ' + syncResult.hub.cityState);
  }
  if (syncResult.hub.pullEligible !== false) {
    throw new Error('软件实证应 pullEligible=false');
  }

  const ov = await hubJson('GET', '/api/v1/hub/overview', null, token);
  const fa = ov.data?.factorAuth || {};
  const board = ov.data?.resonance?.industryBoard || [];
  if (fa.cityState !== 'evidence_building') {
    throw new Error('overview.factorAuth.cityState 不符: ' + JSON.stringify(fa));
  }
  console.log('✅ Hub overview.factorAuth.cityState =', fa.cityState);
  console.log('✅ industryBoard entries =', board.length);

  await browser.close();
  stopCore();

  console.log(JSON.stringify({
    ok: true,
    path: 'browser Core→Hub sync',
    email: EMAIL,
    coreUrlHint: `${CORE}/HengAI_Universal_Core.html?hubSync=1&hubToken=<token>`,
    cityState: fa.cityState,
    certificateId: syncResult.hub.certificateId,
  }, null, 2));
}

main().catch((e) => {
  console.error('❌', e.message || e);
  stopCore();
  process.exit(1);
});
