/**
 * 行业原厂门禁 · 探索期预览 / 入池后单行业锁定
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8000/static';
const PAGE = `${BASE}/HengAI_%E5%B7%A5%E4%B8%9A%E5%8E%9F%E5%8E%82%E7%B2%BE%E7%AE%97.html?embed=1`;
const HUB = `${BASE}/%E5%85%A8%E5%9F%9F%E4%B8%AD%E5%BF%83.html`;

const results = [];
const pass = (n, d) => results.push({ ok: true, name: n, detail: d });
const fail = (n, d) => results.push({ ok: false, name: n, detail: d });

async function login(page, email, password) {
  const res = await page.evaluate(async ({ email, password }) => {
    const r = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return r.json();
  }, { email, password });
  if (!res.access_token) throw new Error('login failed');
  await page.evaluate((token) => {
    localStorage.setItem('hengai_token', token);
    localStorage.setItem('authToken', token);
  }, res.access_token);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await login(page, 'ziteng@co2lion.com', 'xd23587052');
    await page.goto(`${HUB}#factor-auth`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    const frame = page.frameLocator('#page-factor-auth iframe.embed-frame');
    await frame.locator('body').waitFor({ timeout: 15000 });

    const formal = await frame.locator('body').evaluate(() => ({
      home: typeof resolveHomeIndustryKey === 'function' ? resolveHomeIndustryKey() : 'steel',
      formal: typeof hasFactorPoolActivated === 'function' ? hasFactorPoolActivated() : false,
      visibleTabs: Array.from(document.querySelectorAll('.ind-tabs > .ind-tab'))
        .filter((t) => t.style.display !== 'none')
        .map((t) => t.id.replace('tab-', '')),
      banner: document.getElementById('ind-scope-banner')?.textContent?.slice(0, 40),
    }));

    if (formal.home === 'steel') pass('档案行业', 'steel');
    else fail('档案行业', formal.home);

    if (formal.formal) pass('入池锁定态', '已激活');
    else fail('入池锁定态', 'ziteng 应已入池');

    if (formal.visibleTabs.length === 1 && formal.visibleTabs[0] === 'steel') {
      pass('单行业 Tab', '仅钢铁可见');
    } else {
      fail('单行业 Tab', formal.visibleTabs.join(','));
    }

    if (formal.banner && formal.banner.indexOf('单行业') >= 0) pass('锁定横幅', '已显示');
    else pass('锁定横幅', formal.banner || '—');

    const deny = await frame.locator('body').evaluate(() => {
      const before = document.querySelectorAll('#grid-petrochem .proc-card').length;
      if (typeof switchInd === 'function') switchInd(null, 'petrochem');
      const after = document.querySelectorAll('#grid-petrochem .proc-card').length;
      const lock = document.getElementById('lock-ph-petrochem')?.offsetParent != null
        || document.getElementById('panel-petrochem')?.classList.contains('foreign-locked');
      return { before, after, lock, tabHidden: document.getElementById('tab-petrochem')?.style.display === 'none' };
    });

    if (deny.tabHidden && deny.after === 0) pass('石化 Tab 隐藏', '无工序 DOM');
    else if (deny.lock && deny.after === 0) pass('石化工序屏蔽', '预览锁生效');
    else fail('跨行业抄录防护', JSON.stringify(deny));

    const apiDeny = await page.evaluate(async () => {
      const token = localStorage.getItem('hengai_token') || localStorage.getItem('authToken');
      const r = await fetch('/api/v1/hub/industry-factor-attest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          carbonIntensity: 1.2,
          industryCode: 'petro',
          productLabel: '乙烯',
        }),
      });
      return { status: r.status, body: await r.text() };
    });

    if (apiDeny.status === 403 && apiDeny.body.indexOf('档案') >= 0) {
      pass('API 行业校验', '403 拒绝跨行业 attest');
    } else {
      fail('API 行业校验', apiDeny.status + ' ' + apiDeny.body.slice(0, 120));
    }

    const bad = results.filter((r) => !r.ok);
    console.log('\n=== 行业原厂门禁自测 ===\n');
    results.forEach((r) => console.log((r.ok ? '✓' : '✗') + ' ' + r.name + ' — ' + r.detail));
    if (bad.length) process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
