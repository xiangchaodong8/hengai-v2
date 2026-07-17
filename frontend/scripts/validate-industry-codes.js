/**
 * 行业 code 映射自测（无需浏览器）
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, '..', 'hengai-industry-codes.js'), 'utf8');
const ctx = { window: {} };
vm.runInNewContext(src, ctx);
const W = ctx.window;

const cases = [
  ['petrochem', 'petro', 'petrochem'],
  ['ceramics', 'ceramic', 'ceramics'],
  ['datacenter', 'idc', 'datacenter'],
  ['steel', 'steel', 'steel'],
  ['aluminium', 'aluminum', 'aluminum'],
];

let ok = 0;
let fail = 0;
for (const [raw, canon, ui] of cases) {
  const c = W.toCanonicalIndustryCode(raw);
  const u = W.toFactorUiIndustryKey(raw);
  const origin = W.hengaiIsOriginIndustryCode(raw);
  if (c === canon && u === ui && origin) {
    console.log('✓', raw, '→', c, '/', u);
    ok += 1;
  } else {
    console.log('✗', raw, 'expected', canon, ui, 'got', c, u, origin);
    fail += 1;
  }
}

if (!W.hengaiIsOriginIndustryCode('automotive')) {
  console.log('✓ SME 行业非 ORIGIN');
  ok += 1;
} else {
  console.log('✗ automotive 不应为 ORIGIN');
  fail += 1;
}

console.log(`\n${ok}/${ok + fail} 通过`);
process.exit(fail ? 1 : 0);
