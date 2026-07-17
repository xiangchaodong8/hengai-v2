#!/usr/bin/env node
/**
 * 批次 8 · 发车前一键校验（静态 + 后端契约 + 可选 Playwright）
 * 用法：
 *   node scripts/preflight-go-live.js           # 默认跳过浏览器
 *   node scripts/preflight-go-live.js --browser # 含 Playwright
 *   SKIP_BROWSER=1 node scripts/preflight-go-live.js
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..');
const ROOT = path.join(FRONTEND, '..');

const wantBrowser =
  process.argv.includes('--browser') ||
  process.argv.includes('--full') ||
  (process.env.SKIP_BROWSER !== '1' && process.env.CI !== 'true' && process.argv.includes('--with-browser'));

function run(label, cmd, args, opts = {}) {
  console.log('\n▶', label);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || FRONTEND,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...opts.env },
  });
  if (r.status !== 0) {
    console.error(`\n❌ 失败: ${label} (exit ${r.status})`);
    process.exit(r.status || 1);
  }
  console.log('✅', label);
}

console.log('═'.repeat(50));
console.log('HengAI preflight 发车校验（批次 8+9）');
console.log('═'.repeat(50));

run('占位符 + 语法审计', 'npm', ['run', 'audit:ci']);
run('actions_taken 契约', 'npm', ['run', 'test:contract']);
run('共振静态 E2E', 'npm', ['run', 'test:e2e']);
run('后端 normalize 单测', 'npm', ['run', 'test:backend:contract']);

run('前端 tier/enrich parity', 'node', ['scripts/check-tier-parity.js']);

const distPath = path.join(ROOT, 'static_dist', 'AppState.js');
const srcPath = path.join(FRONTEND, 'AppState.js');
if (fs.existsSync(distPath)) {
  const a = fs.readFileSync(srcPath, 'utf8');
  const b = fs.readFileSync(distPath, 'utf8');
  if (a !== b) {
    console.warn('\n⚠ static_dist/AppState.js 与 frontend 不一致，正在 sync:dist …');
    run('同步 static_dist', 'npm', ['run', 'sync:dist']);
    const b2 = fs.readFileSync(distPath, 'utf8');
    if (a !== b2) {
      console.error('❌ sync 后仍不一致');
      process.exit(1);
    }
  }
  console.log('✅ static_dist/AppState.js 已同步');
} else {
  console.warn('⚠ 无 static_dist，跳过一致性检查（可 npm run sync:dist）');
}

const pw = path.join(FRONTEND, 'node_modules', 'playwright');
if (fs.existsSync(pw) && process.env.SKIP_CONSOLE_AUDIT !== '1') {
  run('控制台零红字审计 (:8000)', 'node', ['scripts/console-zero-audit.js'], {
    env: { HENGAI_BASE_URL: process.env.HENGAI_BASE_URL || 'http://127.0.0.1:8000' },
  });
} else if (process.env.SKIP_CONSOLE_AUDIT !== '1') {
  console.warn('⚠ 未安装 playwright，跳过控制台零红字（cd frontend && npm install）');
}

if (wantBrowser) {
  const pwt = path.join(FRONTEND, 'node_modules', '@playwright', 'test');
  if (!fs.existsSync(pwt)) {
    console.warn('⚠ 未安装 @playwright/test，跳过浏览器烟测（npm install）');
  } else {
    run('Playwright 浏览器烟测', 'npx', ['playwright', 'test'], { env: { CI: 'true' } });
  }
} else {
  console.log('\nℹ 跳过 Playwright 套件（npm run preflight:full 可启用）');
}

console.log('\n' + '═'.repeat(50));
console.log('✅ preflight 全绿');
console.log('   Docker 发车: cd frontend && npm run docker:go-live');
console.log('   人工验收: docs/全链路通车大考.md');
console.log('═'.repeat(50));
