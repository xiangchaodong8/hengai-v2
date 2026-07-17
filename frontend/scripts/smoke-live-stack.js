#!/usr/bin/env node
/**
 * 批次 9 · 运行中栈烟测（Docker 或本地 uvicorn 已启动后）
 * HENGAI_BASE_URL 默认 http://127.0.0.1:8000
 */
const BASE = (process.env.HENGAI_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.HENGAI_SMOKE_TIMEOUT_MS || 15000);

let failed = 0;

function ok(msg) { console.log('✅', msg); }
function fail(msg) { console.error('❌', msg); failed++; }

async function fetchWithTimeout(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function checkJson(path, validate) {
  const url = `${BASE}${path}`;
  try {
    const r = await fetchWithTimeout(url, {
      headers: { Accept: 'application/json' },
    });
    if (!r.ok) {
      fail(`${path} HTTP ${r.status}`);
      return;
    }
    const j = await r.json();
    if (validate && !validate(j)) {
      fail(`${path} JSON 契约不符`);
      return;
    }
    ok(`${path} → ${r.status}`);
  } catch (e) {
    fail(`${path} ${e.message || e}`);
  }
}

async function checkText(path, needle) {
  const url = `${BASE}${path}`;
  try {
    const r = await fetchWithTimeout(url);
    if (!r.ok) {
      fail(`${path} HTTP ${r.status}`);
      return;
    }
    const t = await r.text();
    if (needle && !t.includes(needle)) {
      fail(`${path} 缺少关键字 ${needle}`);
      return;
    }
    ok(`${path} → ${r.status} (${t.length} bytes)`);
  } catch (e) {
    fail(`${path} ${e.message || e}`);
  }
}

async function main() {
  console.log('═'.repeat(50));
  console.log('HengAI 批次9 · 运行栈烟测');
  console.log('BASE:', BASE);
  console.log('═'.repeat(50));

  await checkJson('/api/health', (j) => j && j.status === 'ok');
  await checkJson('/api/v1/hub/overview', (j) => {
    if (!j || typeof j !== 'object') return false;
    if (!j.user || typeof j.user !== 'object') return false;
    if (!('tier_code' in j.user)) return false;
    if (j.schemaVersion !== '3.1') return false;
    return true;
  });
  await checkText('/static/index.html', 'AppState.js');
  await checkText('/static/AppState.js', 'enrichOverviewPayloadIdentity');
  await checkText('/static/hengai-state-resonance.js', 'hengaiApplyChatStateUpdate');

  console.log('—'.repeat(50));
  if (failed > 0) {
    console.error(`\n❌ 运行栈烟测失败：${failed} 项`);
    console.error('提示: docker compose ps / docker compose logs backend');
    process.exit(1);
  }
  console.log('\n✅ 运行栈烟测全绿 — 可打开', `${BASE}/static/index.html`);
}

main();
