/**
 * 因子精算后续四阶段串联自测
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const backend = path.join(root, '..', 'backend');

function run(cmd, args, cwd, label) {
  console.log('\n>>> ' + label);
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error('FAILED:', label);
    process.exit(r.status || 1);
  }
}

run('node', ['scripts/validate-industry-codes.js'], root, '1/4 行业 code 映射');
run('python', ['-m', 'unittest', 'tests.test_industry_codes', '-q'], backend, '2/4 后端 ORIGIN 白名单');
run('node', ['e2e/_factor-pipeline-gca.mjs'], root, '3/5 全域 pipeline GCA');
run('node', ['e2e/_factor-industry-scope.mjs'], root, '4/5 行业原厂门禁');
run('node', ['e2e/_factor-integration-ziteng.mjs'], root, '5/5 ziteng 账号 E2E');
console.log('\n=== 后续阶段 + 行业门禁全部通过 ===\n');
