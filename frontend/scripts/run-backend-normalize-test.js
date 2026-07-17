#!/usr/bin/env node
/**
 * 后端 normalize 单测：优先 Docker 容器（与发车环境一致），
 * 本机无 sqlalchemy 时不误报阻断。
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PY_ARGS = ['-m', 'unittest', 'tests.test_normalize_app_state', '-q'];

function run(cmd, args, opts) {
  return spawnSync(cmd, args, {
    cwd: opts.cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
}

function dockerBackendUp() {
  const r = spawnSync('docker', ['inspect', '-f', '{{.State.Running}}', 'hengai_backend'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return r.status === 0 && String(r.stdout || '').trim() === 'true';
}

if (dockerBackendUp()) {
  console.log('ℹ 使用 docker exec hengai_backend 跑 normalize 单测');
  const r = run('docker', ['exec', '-w', '/app', 'hengai_backend', 'python', ...PY_ARGS], {
    cwd: ROOT,
  });
  process.exit(r.status || 0);
}

console.log('ℹ Docker 未就绪，尝试本机 python');
const local = run('python', PY_ARGS, { cwd: path.join(ROOT, 'backend') });
if (local.status === 0) process.exit(0);

const err = String(local.stderr || local.stdout || '');
if (/No module named 'sqlalchemy'|ModuleNotFoundError/i.test(err) || local.status === 1) {
  // spawn 失败时 stderr 可能在 inherit 里已打印；再探测一次 import
  const probe = spawnSync('python', ['-c', 'import sqlalchemy'], {
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  if (probe.status !== 0) {
    console.warn('⚠ 本机无 sqlalchemy 且 hengai_backend 未运行 — 跳过后端 normalize 单测');
    console.warn('  发车前请: docker compose up -d 后重跑 npm run preflight');
    process.exit(0);
  }
}

process.exit(local.status || 1);
