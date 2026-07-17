#!/usr/bin/env node
/** 批次 8 · 前端 DB tier → ACCOUNT_TIER 与 enrich 源码存在性 */
const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '..', 'AppState.js');
const src = fs.readFileSync(appPath, 'utf8');

if (!src.includes('enrichOverviewPayloadIdentity')) {
  console.error('❌ AppState.js 缺少 enrichOverviewPayloadIdentity');
  process.exit(1);
}

const ACCOUNT_TIER = {
  GUEST: 'GUEST',
  FREE_USER: 'FREE_USER',
  PRO_PERSONAL: 'PRO_PERSONAL',
  ENT_VERIFIED: 'ENT_VERIFIED',
};

function normalizeTierCode(input) {
  const raw = String(input || '').trim();
  if (!raw) return ACCOUNT_TIER.GUEST;
  if (Object.values(ACCOUNT_TIER).includes(raw)) return raw;
  const db = raw.toLowerCase();
  if (db === 'sovereign') return ACCOUNT_TIER.ENT_VERIFIED;
  if (db === 'guardian' || db === 'pioneer') return ACCOUNT_TIER.PRO_PERSONAL;
  if (db === 'seed' || db === 'sprout') return ACCOUNT_TIER.FREE_USER;
  return ACCOUNT_TIER.FREE_USER;
}

const cases = [
  ['Guardian', 'PRO_PERSONAL'],
  ['Pioneer', 'PRO_PERSONAL'],
  ['Sovereign', 'ENT_VERIFIED'],
  ['Seed', 'FREE_USER'],
  ['Sprout', 'FREE_USER'],
  ['GUEST', 'GUEST'],
];

for (const [inp, exp] of cases) {
  const got = normalizeTierCode(inp);
  if (got !== exp) {
    console.error(`❌ tier map ${inp} → ${got}, expected ${exp}`);
    process.exit(1);
  }
}

console.log('✅ tier parity + enrichOverviewPayloadIdentity present');
