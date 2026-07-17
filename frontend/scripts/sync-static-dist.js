#!/usr/bin/env node
/**
 * 批次 6 · 将 frontend/ 真理源同步到 static_dist 与 backend/static_dist
 * Docker 生产挂载 ./frontend 时以 live 为准；本脚本用于离线包 / CI 一致性校验
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'frontend');
const TARGETS = [
  path.join(ROOT, 'static_dist'),
  path.join(ROOT, 'backend', 'static_dist'),
];

const SKIP_DIRS = new Set(['node_modules', '.git', 'scripts']);
const SKIP_FILES = new Set(['package-lock.json']);
const ALLOW_EXT = /\.(html|js|css|json|conf|png|jpg|jpeg|gif|svg|ico|webp|woff2?)$/i;

function shouldCopy(rel) {
  const parts = rel.split(path.sep);
  if (parts.some((p) => SKIP_DIRS.has(p))) return false;
  if (SKIP_FILES.has(path.basename(rel))) return false;
  if (rel === 'package.json') return true;
  return ALLOW_EXT.test(rel);
}

function walk(dir, base, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = path.relative(base, full);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(full, base, out);
    } else if (shouldCopy(rel)) {
      out.push({ rel, full });
    }
  }
}

function syncOneTarget(destRoot, files) {
  let n = 0;
  for (const { rel, full } of files) {
    const dest = path.join(destRoot, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(full, dest);
    n++;
  }
  return n;
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error('Missing frontend:', SRC);
    process.exit(1);
  }
  const files = [];
  walk(SRC, SRC, files);
  console.log('Source files:', files.length);
  for (const dest of TARGETS) {
    fs.mkdirSync(dest, { recursive: true });
    const n = syncOneTarget(dest, files);
    console.log('Synced', n, 'files →', dest);
  }
  console.log('\n✅ static_dist 同步完成（真理源: frontend/）');
}

main();
