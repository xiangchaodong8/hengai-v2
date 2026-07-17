#!/usr/bin/env node
/**
 * HengAI 幽灵占位符 CI 审计（批次 3）
 * 扫描 frontend 下 HTML/JS，阻断级样例：王磊、1.82（可见文案）、2,840、145,000 等
 * 合法 CBAM 因子仅允许出现在 data-factor / data-ghost-ignore 属性中
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname);
const GHOST_CHECKS = [
  { label: '王磊', re: /王磊/g },
  { label: '汽配制造厂', re: /汽配制造厂/g },
  { label: '王L', re: /王L/g },
  { label: '2,840', re: /2,840/g },
  { label: '145,000', re: /145,000/g },
  { label: '1.82', re: /(?<![.\d])1\.82(?![.\d])/g },
];

const MODULE_GLOB = /^HengAI_.*\.html$/i;
/** VO/布局回滚快照不参与幽灵阻断（真理源为无后缀主文件） */
const ARCHIVE_SUFFIX = /\.(pre-vo-layout|vo-draft)\.html$/i;
const EXTRA_SCAN = ['全域中心.html', 'index.html'];

const MODULE_FILES = fs.readdirSync(ROOT)
  .filter((f) => MODULE_GLOB.test(f) && !ARCHIVE_SUFFIX.test(f))
  .map((f) => path.join(ROOT, f));

EXTRA_SCAN.forEach((f) => {
  const p = path.join(ROOT, f);
  if (fs.existsSync(p) && !MODULE_FILES.includes(p)) MODULE_FILES.push(p);
});

function stripIgnoredLines(content) {
  return content
    .split('\n')
    .filter((line) => {
      if (/data-factor\s*=\s*["'][^"']*1\.82/i.test(line)) return false;
      if (/data-ghost-ignore/i.test(line)) return false;
      if (/rgba?\([^)]*128/i.test(line)) return false;
      if (/\b128\s*,\s*\d/.test(line)) return false;
      if (/ghostChecks|audit-placeholders/.test(line) && /label:|re:/.test(line)) return false;
      return true;
    })
    .join('\n');
}

function auditFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const text = stripIgnoredLines(raw);
  const hits = [];
  for (const chk of GHOST_CHECKS) {
    chk.re.lastIndex = 0;
    let m;
    while ((m = chk.re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      hits.push({ label: chk.label, line, snippet: text.slice(m.index, m.index + 40).replace(/\s+/g, ' ') });
    }
  }
  return hits;
}

function main() {
  const targets = MODULE_FILES.length ? MODULE_FILES : [];
  let blockCount = 0;
  console.log('HengAI 占位符审计 · 扫描文件数:', targets.length);
  console.log('—'.repeat(50));
  for (const fp of targets) {
    const hits = auditFile(fp);
    if (hits.length) {
      blockCount += hits.length;
      console.error('\n🚨', path.basename(fp));
      hits.forEach((h) => {
        console.error(`   [${h.label}] L${h.line}: …${h.snippet}…`);
      });
    } else {
      console.log('✅', path.basename(fp));
    }
  }
  console.log('—'.repeat(50));
  if (blockCount > 0) {
    console.error(`\n❌ 审计失败：${blockCount} 处阻断级幽灵样例（14 模块须全绿）`);
    process.exit(1);
  }
  console.log('\n✅ 体检全绿：模块 HTML 未发现阻断级幽灵样例（王磊 / 可见 1.82 等）。');
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { auditFile, GHOST_CHECKS, main };
