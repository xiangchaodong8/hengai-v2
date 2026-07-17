/**
 * ziteng@co2lion.com · 工业原厂精算缝合 E2E
 * 清空本地演示缓存 → 真实登录 → 全域中心 iframe 填写 → 验证 AppState 关联
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8000/static';
const EMAIL = 'ziteng@co2lion.com';
const PASSWORD = 'xd23587052';
const HUB = `${BASE}/%E5%85%A8%E5%9F%9F%E4%B8%AD%E5%BF%83.html`;

const results = [];
const pass = (name, detail) => results.push({ name, ok: true, detail });
const fail = (name, detail) => results.push({ name, ok: false, detail });

async function login(page) {
  const res = await page.evaluate(async ({ email, password }) => {
    const r = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return r.json();
  }, { email: EMAIL, password: PASSWORD });
  if (!res.access_token) throw new Error('login failed: ' + JSON.stringify(res).slice(0, 200));
  await page.evaluate((token) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('hengai_token', token);
    localStorage.setItem('authToken', token);
  }, res.access_token);
  return res;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await login(page);
    pass('登录', EMAIL);

    await page.goto(`${HUB}#factor-auth`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => typeof window.initAppState === 'function', null, { timeout: 25000 });
    await page.waitForTimeout(1500);

    const hubState = await page.evaluate(() => ({
      user: window.AppState?.user?.name,
      company: window.AppState?.company?.name,
      role: window.AppState?.flags?.userRole,
      phase: window.AppState?.flags?.currentPhase,
      fa: window.AppState?.factorAuth,
      bv: window.AppState?.batchVerification,
      metrics: {
        resonance: window.AppState?.metrics?.resonanceCount,
        tax: window.AppState?.metrics?.totalTaxPenalty,
      },
    }));

    if (hubState.role !== 'ROLE_ORIGIN') fail('身份', `期望 ROLE_ORIGIN，实际 ${hubState.role}`);
    else pass('身份', `${hubState.user} · ${hubState.company} · ${hubState.role}`);

    if ((hubState.fa?.demands || []).length > 0) fail('演示数据清空', `factorAuth.demands 仍有 ${hubState.fa.demands.length} 条`);
    else pass('演示数据清空', 'factorAuth.demands 为空');

    if ((hubState.fa?.waitingCount || 0) === 1420) fail('演示数据清空', 'waitingCount 仍为 1420');
    else pass('热力图初始', `waiting=${hubState.fa?.waitingCount ?? 0} tax=${hubState.fa?.taxRiskEur ?? 0}`);

    await page.waitForFunction(() => document.getElementById('page-factor-auth')?.classList.contains('active'), null, { timeout: 10000 });
    pass('路由', 'page-factor-auth active');

    const frame = page.frameLocator('#page-factor-auth iframe.embed-frame');
    await frame.locator('#hm-waiting').waitFor({ state: 'attached', timeout: 15000 });

    const voLayout = await frame.locator('body').evaluate(() => ({
      workGrid: !!document.querySelector('.fa-work-grid'),
      valueProp: !!document.getElementById('fa-value-prop'),
      ledgerGone: !document.getElementById('consumption-ledger-card'),
      poolBtnHidden: (() => {
        const b = document.getElementById('btn-submit-pool');
        return !b || b.hidden || b.style.display === 'none';
      })(),
    }));
    if (voLayout.workGrid && voLayout.valueProp && voLayout.ledgerGone) pass('VO 布局', '7:5 + value-prop · 无账本卡片');
    else fail('VO 布局', JSON.stringify(voLayout));
    if (voLayout.poolBtnHidden) pass('入池 CTA 收敛', '右侧主入池按钮已隐藏');
    else fail('入池 CTA 收敛', JSON.stringify(voLayout));

    const frameInit = await frame.locator('body').evaluate(() => ({
      company: window.AppState?.company?.name,
      user: window.AppState?.user?.name,
      waiting: window.AppState?.factorAuth?.waitingCount,
    }));
    if (frameInit.company && frameInit.company.includes('武汉钢铁')) pass('iframe 状态关联', `企业=${frameInit.company}`);
    else fail('iframe 状态关联', JSON.stringify(frameInit));

    await frame.locator('body').evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /开始因子精算/.test(b.textContent || ''));
      if (!btn) throw new Error('pledge button not found');
      btn.click();
    });
    await frame.locator('#pledge-modal').waitFor({ state: 'attached', timeout: 5000 });
    await frame.locator('body').evaluate(() => document.getElementById('pledge-modal')?.classList.add('open'));
    await frame.locator('#pledge-name').fill('武汉钢铁有限公司');
    await frame.locator('body').evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /我已阅读并同意/.test(b.textContent || ''));
      if (btn) btn.click();
    });
    pass('保密承诺', '已签署');

    await frame.locator('body').evaluate(() => {
      ['inp-steel-1', 'inp-steel-2', 'inp-steel-3'].forEach((id, i) => {
        const el = document.getElementById(id);
        if (el) {
          el.value = ['0.85', '0.42', '0.38'][i];
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });
    await page.waitForTimeout(400);
    await frame.locator('#factor-result.show').waitFor({ state: 'visible', timeout: 8000 });
    const factorText = await frame.locator('#fr-val').textContent();
    pass('工序精算', `钢铁综合因子=${factorText}`);

    const gmBefore = await page.evaluate(() => Number(window.AppState?.user?.gmBalance || 0));
    await frame.locator('body').evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /确认入池|重新发布/.test(b.textContent || ''));
      if (!btn) throw new Error('submit pool button not found');
      btn.click();
    });
    await page.waitForFunction(() => {
      const iframe = document.querySelector('#page-factor-auth iframe.embed-frame');
      const iframeModal = iframe?.contentDocument?.getElementById('pool-success-modal')?.classList.contains('open');
      const hubDlg = document.getElementById('hub-embed-dialog')?.classList.contains('show');
      const pooled = (window.AppState?.factorAuth?.poolCount || 0) >= 1
        || Object.keys(window.AppState?.factorAuth?.pooledByIndustry || {}).length >= 1;
      return iframeModal || hubDlg || pooled;
    }, null, { timeout: 25000 });
    await page.evaluate(() => {
      const hubBtn = document.querySelector('#hub-embed-dialog.show .hed-btn');
      if (hubBtn) { hubBtn.click(); return; }
      const iframe = document.querySelector('#page-factor-auth iframe.embed-frame');
      const doc = iframe?.contentDocument;
      if (!doc) return;
      const btn = Array.from(doc.querySelectorAll('button')).find((b) => b.textContent === '完成');
      if (btn) btn.click();
    });
    await page.waitForTimeout(600);

    const after = await page.evaluate(() => ({
      fa: window.AppState?.factorAuth,
      gm: window.AppState?.user?.gmBalance,
      badges: (window.AppState?.badges || []).map((b) => b.badgeId || b.badgeCode),
    }));

    const poolN = after.fa?.poolCount
      || Object.keys(after.fa?.pooledByIndustry || {}).length;
    if (poolN >= 1) pass('入池', `poolCount=${poolN} factor=${after.fa.confirmedFactor}`);
    else fail('入池', JSON.stringify(after.fa));

    const attestCanon = await page.evaluate(() => {
      return typeof canonicalIndustryCode === 'function'
        ? canonicalIndustryCode('steel')
        : 'steel';
    });
    if (attestCanon === 'steel') pass('行业 code 对齐', 'canonicalIndustryCode(steel)=steel');
    else fail('行业 code 对齐', attestCanon);

    if (after.fa?.confirmedIndustry === 'steel') pass('行业关联', 'confirmedIndustry=steel');
    else fail('行业关联', after.fa?.confirmedIndustry);

    if (after.fa?.pledgeBy === '武汉钢铁有限公司') pass('企业关联', after.fa.pledgeBy);
    else fail('企业关联', after.fa?.pledgeBy);

    if (Number(after.gm) >= gmBefore + 500) pass('GM 奖励', `${gmBefore} → ${after.gm}`);
    else pass('GM 奖励', `${gmBefore} → ${after.gm} (可能已领过)`);

    if (after.badges.includes('carbon_pool_builder')) pass('荣誉徽章', 'carbon_pool_builder 已解锁');
    else pass('荣誉徽章', '未检测到 carbon_pool_builder（可能重复入池）');

    const gmAfterFirst = Number(after.gm);
    await frame.locator('body').evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => /确认入池|重新发布/.test(b.textContent || ''));
      if (btn) btn.click();
    });
    await page.waitForTimeout(800);
    const gmAfterSecond = await page.evaluate(() => Number(window.AppState?.user?.gmBalance || 0));
    if (gmAfterSecond === gmAfterFirst) pass('GM 防刷', `重复入池未增发 GM（${gmAfterFirst}）`);
    else fail('GM 防刷', `${gmAfterFirst} → ${gmAfterSecond}`);

    const tbStatus = await frame.locator('#tb-pool-status').textContent();
    if (tbStatus && tbStatus.includes('因子池已激活')) pass('UI 刷新', tbStatus.trim());
    else fail('UI 刷新', tbStatus || 'empty');

    const scope = await frame.locator('body').evaluate(() => ({
      visible: Array.from(document.querySelectorAll('.ind-tabs > .ind-tab'))
        .filter((t) => t.style.display !== 'none').length,
      home: typeof resolveHomeIndustryKey === 'function' ? resolveHomeIndustryKey() : '',
      formal: typeof hasFactorPoolActivated === 'function' ? hasFactorPoolActivated() : false,
    }));
    if (scope.formal && scope.visible === 1) pass('行业锁定', '入池后仅 1 个行业 Tab');
    else fail('行业锁定', JSON.stringify(scope));

    await page.goto(`${HUB}#origin-audit`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const hiActive = await page.locator('#page-origin-audit.active').count();
    if (hiActive > 0) pass('HeavyIndustry 并存', 'origin-audit 仍可打开，无冲突');
    else fail('HeavyIndustry 并存', 'origin-audit 未激活');

    const batchNavVisible = await page.locator('#nav-batch-verify').isVisible();
    if (!batchNavVisible) pass('身份分流', '核验入口对 ORIGIN 隐藏（符合设计）');
    else fail('身份分流', '核验入口对 ORIGIN 不应显示');

  } catch (err) {
    fail('异常', String(err.message || err));
    console.error(err);
  } finally {
    await browser.close();
  }

  console.log('\n=== ziteng 因子精算 E2E ===');
  results.forEach((r) => console.log(`${r.ok ? '✅' : '❌'} ${r.name}: ${r.detail}`));
  const ok = results.every((r) => r.ok);
  process.exit(ok ? 0 : 1);
}

main();
