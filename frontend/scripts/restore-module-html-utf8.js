#!/usr/bin/env node
/**
 * 若模块 HTML 正文含乱码（ / U+FFFD），从 backend/frontend 整页恢复并保留 pipeline 尾部脚本。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REF = path.join(ROOT, '..', 'backend', 'frontend');
const PIPE_TAIL =
  '<script src="hengai-module-pipeline.js"></script>\n<script src="hengai-embed-boot.js"></script>';

function isCorrupted(html, refHtml) {
  if (/\uFFFD/.test(html)) return true;
  if (!refHtml) return false;
  const markers = ['全域中心', '企业数字档案', '供应链', '生态共治', '荣誉体系', '算力资源', '法规知识库', '绿印钱包'];
  let refHit = 0;
  let feHit = 0;
  markers.forEach((m) => {
    if (refHtml.includes(m)) refHit++;
    if (html.includes(m)) feHit++;
  });
  return refHit >= 2 && feHit < refHit - 1;
}

function ensurePipelineTail(html) {
  let out = html.replace(/\r\n/g, '\n');
  out = out.replace(/<script src="hengai-timeline-bind\.js"><\/script>\s*/g, '');
  out = out.replace(/<script src="hengai-module-pipeline\.js"><\/script>\s*/g, '');
  out = out.replace(/<script src="hengai-embed-boot\.js"><\/script>\s*/g, '');
  out = out.replace(/\s*<\/body>/i, `\n${PIPE_TAIL}\n</body>`);
  return out;
}

const files = fs.readdirSync(ROOT).filter((f) => /^HengAI_.*\.html$/i.test(f));
let restored = 0;

for (const f of files) {
  const fePath = path.join(ROOT, f);
  const refPath = path.join(REF, f);
  if (!fs.existsSync(refPath)) continue;
  const fe = fs.readFileSync(fePath, 'utf8');
  const ref = fs.readFileSync(refPath, 'utf8');
  if (!isCorrupted(fe, ref)) continue;
  if (isCorrupted(ref, null)) {
    console.warn('⚠ 参考文件也含乱码，跳过:', f);
    continue;
  }
  fs.writeFileSync(fePath, ensurePipelineTail(ref), 'utf8');
  console.log('✅ UTF-8 整页恢复:', f);
  restored++;
}

console.log(`\n完成：${restored} 个模块 HTML 正文已从 backend/frontend 恢复`);
