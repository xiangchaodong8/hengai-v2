#!/usr/bin/env node
/** 批次 4 · 关键 JS 语法自检 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.join(__dirname, '..');
const files = [
  'AppState.js',
  'hengai-embed-boot.js',
  'hengai-embed-parent-bridge.js',
  'hengai-load-appstate.js',
  'hengai-module-pipeline.js',
  'hengai-state-resonance.js',
  'hengai-hub-nav.js',
  'audit-placeholders.js',
  'app.js',
  'frontend_core.js',
];

let failed = 0;
for (const f of files) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) {
    console.warn('skip (missing):', f);
    continue;
  }
  try {
    execSync(`node --check "${p}"`, { stdio: 'pipe' });
    console.log('✅ syntax', f);
  } catch (e) {
    failed++;
    console.error('❌ syntax', f, e.message || e);
  }
}

if (failed > 0) {
  console.error(`\n❌ ${failed} 个文件语法检查失败`);
  process.exit(1);
}
console.log('\n✅ 关键 JS 语法全绿');
