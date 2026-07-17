#!/usr/bin/env node
/**
 * 批次 9 · 一键 Docker 发车
 * 1) npm run preflight（可 SKIP_PREFLIGHT=1 跳过）
 * 2) docker compose up -d --build
 * 3) 等待 backend 健康
 * 4) smoke-live-stack
 *
 * 用法（项目根目录）:
 *   node frontend/scripts/docker-go-live.js
 *   或在 frontend: npm run docker:go-live
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FRONTEND = path.join(ROOT, 'frontend');
const BASE = (process.env.HENGAI_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const WAIT_SEC = Number(process.env.HENGAI_DOCKER_WAIT_SEC || 120);

function run(label, cmd, args, opts = {}) {
  console.log('\n▶', label);
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd || ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...opts.env },
  });
  if (r.status !== 0) {
    console.error(`\n❌ ${label} 失败 (exit ${r.status})`);
    process.exit(r.status || 1);
  }
  console.log('✅', label);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

async function waitHealthy() {
  console.log(`\n▶ 等待后端健康（最长 ${WAIT_SEC}s）…`);
  const deadline = Date.now() + WAIT_SEC * 1000;
  while (Date.now() < deadline) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(`${BASE}/api/health`, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) {
        const j = await r.json();
        if (j && j.status === 'ok') {
          console.log('✅ 后端 /api/health 就绪');
          return;
        }
      }
    } catch (_) {}
    await sleep(2000);
  }
  console.error('❌ 等待后端超时 — 请检查: docker compose logs backend');
  process.exit(1);
}

async function main() {
  console.log('═'.repeat(50));
  console.log('HengAI 批次9 · Docker 一键发车');
  console.log('ROOT:', ROOT);
  console.log('═'.repeat(50));

  if (process.env.SKIP_PREFLIGHT !== '1') {
    run('本地 preflight', 'npm', ['run', 'preflight'], {
      cwd: FRONTEND,
      env: { CI: 'true', SKIP_BROWSER: '1' },
    });
  } else {
    console.log('\nℹ 跳过 preflight (SKIP_PREFLIGHT=1)');
  }

  run('docker compose up -d --build', 'docker', ['compose', 'up', '-d', '--build'], { cwd: ROOT });

  await waitHealthy();

  run('运行栈烟测', 'node', ['scripts/smoke-live-stack.js'], {
    cwd: FRONTEND,
    env: { HENGAI_BASE_URL: BASE },
  });

  console.log('\n' + '═'.repeat(50));
  console.log('✅ Docker 发车完成');
  console.log('   入口:', `${BASE}/static/index.html`);
  console.log('   全域中心:', `${BASE}/static/全域中心.html`);
  console.log('   人工验收: docs/全链路通车大考.md');
  console.log('═'.repeat(50));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
