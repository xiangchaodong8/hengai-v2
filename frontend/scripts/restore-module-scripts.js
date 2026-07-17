#!/usr/bin/env node
/**
 * 从 backend/frontend 恢复损坏的内联 <script> 块，保留 hengai-module-pipeline / embed-boot 引用。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const REF = path.join(ROOT, '..', 'backend', 'frontend');

const SCRIPT_RE = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
const PIPE_TAIL =
  '<script src="hengai-module-pipeline.js"></script>\n<script src="hengai-embed-boot.js"></script>';

function extractScripts(html) {
  const blocks = [];
  let m;
  const re = new RegExp(SCRIPT_RE.source, SCRIPT_RE.flags);
  while ((m = re.exec(html)) !== null) {
    blocks.push({ full: m[0], attrs: m[1], code: m[2], index: m.index });
  }
  return blocks;
}

function validJs(code) {
  const c = code.trim();
  if (!c) return true;
  try {
    new vm.Script(c);
    return true;
  } catch (_) {
    return false;
  }
}

function ensurePipelineTail(html) {
  let out = html.replace(/\r\n/g, '\n');
  out = out.replace(/<script src="hengai-timeline-bind\.js"><\/script>\s*/g, '');
  out = out.replace(/<script src="hengai-module-pipeline\.js"><\/script>\s*/g, '');
  out = out.replace(/<script src="hengai-embed-boot\.js"><\/script>\s*/g, '');
  out = out.replace(/\s*<\/body>/i, `\n${PIPE_TAIL}\n</body>`);
  return out;
}

function restoreFile(name) {
  const fePath = path.join(ROOT, name);
  const refPath = path.join(REF, name);
  if (!fs.existsSync(fePath) || !fs.existsSync(refPath)) {
    console.warn('skip (missing):', name);
    return { name, restored: 0, skipped: true };
  }

  let html = fs.readFileSync(fePath, 'utf8');
  const refHtml = fs.readFileSync(refPath, 'utf8');
  const feBlocks = extractScripts(html);
  const refBlocks = extractScripts(refHtml);
  let restored = 0;

  const replacements = [];
  feBlocks.forEach((block, i) => {
    if (validJs(block.code)) return;
    const ref = refBlocks[i];
    if (!ref || !validJs(ref.code)) {
      console.warn(`  ⚠ ${name} block #${i + 1}: no valid reference`);
      return;
    }
    let newCode = ref.code;
    const exportMatch = block.code.match(
      /window\.(apply\w+Pipeline)\s*=\s*\1\s*;/
    );
    if (exportMatch && !newCode.includes(exportMatch[0])) {
      const fn = exportMatch[1];
      if (newCode.includes(`function ${fn}`)) {
        newCode = newCode.replace(
          /\n\}\)\(\);\s*$/,
          `\n  window.${fn} = ${fn};\n})();`
        );
      }
    }
    replacements.push({
      start: block.index,
      end: block.index + block.full.length,
      text: `<script${block.attrs}>${newCode}</script>`,
    });
    restored++;
  });

  replacements.sort((a, b) => b.start - a.start);
  for (const rep of replacements) {
    html = html.slice(0, rep.start) + rep.text + html.slice(rep.end);
  }

  html = ensurePipelineTail(html);
  fs.writeFileSync(fePath, html, 'utf8');
  return { name, restored, skipped: false };
}

const files = fs
  .readdirSync(ROOT)
  .filter((f) => /^HengAI_.*\.html$/i.test(f));

let total = 0;
for (const f of files) {
  const r = restoreFile(f);
  if (!r.skipped && r.restored) {
    console.log(`✅ ${f}: restored ${r.restored} script block(s)`);
    total += r.restored;
  }
}

// 复检
let stillBad = 0;
for (const f of files) {
  const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
  extractScripts(html).forEach((b, i) => {
    if (!validJs(b.code)) {
      stillBad++;
      console.error(`❌ still bad: ${f} #${i + 1}`);
    }
  });
}

if (stillBad) {
  console.error(`\n❌ ${stillBad} blocks still invalid`);
  process.exit(1);
}
console.log(`\n✅ 完成：恢复 ${total} 个脚本块，${files.length} 个模块全绿`);
