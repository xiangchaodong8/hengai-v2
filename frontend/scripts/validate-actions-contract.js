#!/usr/bin/env node
/**
 * 批次 7 · actions_taken / overview 契约静态校验
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const BACKEND = path.join(ROOT, 'backend');
const DOC = path.join(ROOT, 'docs', 'ACTIONS_TAKEN_CONTRACT.md');

let failed = 0;
function ok(m) { console.log('✅', m); }
function fail(m) { console.error('❌', m); failed++; }

const hub = fs.readFileSync(path.join(BACKEND, 'hub_engine.py'), 'utf8');
const chat = fs.readFileSync(path.join(BACKEND, 'chat.py'), 'utf8');
const resonance = fs.readFileSync(path.join(path.join(__dirname, '..'), 'hengai-state-resonance.js'), 'utf8');

const required = [
  'normalize_app_state_for_frontend',
  'tier_code',
  'tierLabel',
  'regLabel',
  'DB_TIER_TO_ACCOUNT_CODE',
];
for (const k of required) {
  if (!hub.includes(k)) fail(`hub_engine missing ${k}`);
}
if (required.every((k) => hub.includes(k))) ok('hub_engine normalize + identity fields');

if (!chat.includes('updatedState')) fail('chat.py SSE must use updatedState');
else ok('chat.py SSE camelCase updatedState');

if (!chat.includes('event: actions_taken')) fail('chat.py missing actions_taken event');
else ok('chat.py emits actions_taken');

if (!resonance.includes('hengaiApplyChatStateUpdate')) fail('resonance bus missing apply');
else ok('hengai-state-resonance consumes updatedState path');

if (!fs.existsSync(DOC)) fail('docs/ACTIONS_TAKEN_CONTRACT.md missing');
else ok('contract doc present');

const goLive = path.join(ROOT, 'docs', '全链路通车大考.md');
if (!fs.existsSync(goLive)) fail('docs/全链路通车大考.md missing');
else ok('go-live checklist doc present');

const dockerDoc = path.join(ROOT, 'docs', 'Docker发车指南.md');
if (!fs.existsSync(dockerDoc)) fail('docs/Docker发车指南.md missing');
else ok('Docker go-live doc present');

const smokeScript = path.join(path.join(__dirname, '..'), 'scripts', 'smoke-live-stack.js');
if (!fs.existsSync(smokeScript)) fail('smoke-live-stack.js missing');
else ok('smoke-live-stack.js present');

const appState = fs.readFileSync(path.join(path.join(__dirname, '..'), 'AppState.js'), 'utf8');
if (!appState.includes('enrichOverviewPayloadIdentity')) fail('AppState missing enrichOverviewPayloadIdentity');
else ok('AppState enrichOverviewPayloadIdentity');

if (failed > 0) {
  console.error(`\n❌ 契约校验失败：${failed} 项`);
  process.exit(1);
}
console.log('\n✅ actions_taken 契约静态校验通过');
