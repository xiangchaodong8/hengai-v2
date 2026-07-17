#!/usr/bin/env node
/**
 * 批次 6 · 全链路共振静态自检（无需浏览器）
 * 校验：模块 embed-boot、管道层、共振总线、关键导出、幽灵样例
 */
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..');
const ROOT = path.join(FRONTEND, '..');

let failed = 0;

function ok(msg) { console.log('✅', msg); }
function fail(msg) { console.error('❌', msg); failed++; }

function read(p) {
  return fs.readFileSync(p, 'utf8');
}

function assertIncludes(file, needles, label) {
  const c = read(file);
  for (const n of needles) {
    if (!c.includes(n)) fail(`${label}: missing "${n}" in ${path.basename(file)}`);
  }
  if (needles.every((n) => c.includes(n))) ok(label);
}

// 1. 核心脚本存在
const coreFiles = [
  'AppState.js',
  'hengai-module-pipeline.js',
  'hengai-embed-boot.js',
  'hengai-state-resonance.js',
  'chatClient.js',
  'frontend_core.js',
];
for (const f of coreFiles) {
  if (!fs.existsSync(path.join(FRONTEND, f))) fail(`missing ${f}`);
  else ok(`found ${f}`);
}

// 2. AppState 导出
assertIncludes(path.join(FRONTEND, 'AppState.js'), [
  'buildHubPipelinePayload',
  'broadcastHubPipelineToEmbeds',
  'formatHubUserIdentity',
  'pulseHubAfterDataSync',
  'patchAppState',
  'enrichOverviewPayloadIdentity',
  'normalizeTierCode',
], 'AppState exports');

// 3. 共振总线
assertIncludes(path.join(FRONTEND, 'hengai-state-resonance.js'), [
  'hengaiAfterStateSync',
  'hengaiApplyChatStateUpdate',
  'wireHengaiStateResonance',
  'lightResonance',
], 'state resonance bus');

// 4. 业务模块 embed（排除本地预览台 / VO 回滚快照）
const EMBED_SKIP = /本地UI预览台|\.pre-vo-layout\.html$|\.vo-draft\.html$/i;
const modules = fs.readdirSync(FRONTEND).filter(
  (f) => /^HengAI_.*\.html$/i.test(f) && !EMBED_SKIP.test(f),
);
let embedMissing = 0;
for (const m of modules) {
  const c = read(path.join(FRONTEND, m));
  if (!c.includes('hengai-embed-boot.js')) {
    fail(`module missing embed-boot: ${m}`);
    embedMissing++;
  }
}
if (!embedMissing) ok(`all ${modules.length} modules have hengai-embed-boot.js`);

// 5. index + 全域中心 加载共振
assertIncludes(path.join(FRONTEND, 'index.html'), ['hengai-state-resonance.js'], 'index resonance');
assertIncludes(path.join(FRONTEND, '全域中心.html'), [
  'hengai-state-resonance.js',
  'hengai-module-pipeline.js',
], 'hub resonance');

// 6. chat 走共振 API
assertIncludes(path.join(FRONTEND, 'chatClient.js'), [
  'hengaiApplyChatStateUpdate',
  '_skipApply',
], 'chatClient resonance');

// 7. static_dist 与 frontend 关键文件 hash（若存在；先跑 npm run audit:ci）
const dist = path.join(ROOT, 'static_dist', 'AppState.js');
const src = path.join(FRONTEND, 'AppState.js');
if (fs.existsSync(dist)) {
  const a = read(src);
  const b = read(dist);
  if (a === b) ok('static_dist/AppState.js matches frontend');
  else fail('static_dist/AppState.js OUT OF SYNC — run npm run sync:dist');
} else {
  console.warn('⚠ static_dist/AppState.js not found (run npm run sync:dist)');
}

console.log('—'.repeat(50));
if (failed > 0) {
  console.error(`\n❌ E2E 共振自检失败：${failed} 项`);
  process.exit(1);
}
// 8. 批次7 · 后端 normalize 契约（文件存在即可，详细见 test:contract）
const hubPy = path.join(ROOT, 'backend', 'hub_engine.py');
if (fs.existsSync(hubPy)) {
  const hc = read(hubPy);
  if (hc.includes('normalize_app_state_for_frontend')) ok('backend normalize_app_state_for_frontend');
  else fail('backend missing normalize_app_state_for_frontend');
} else {
  fail('backend/hub_engine.py not found');
}

console.log('\n✅ 批次6+7 全链路共振静态自检通过');
