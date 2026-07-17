#!/usr/bin/env node
/**
 * 控制台零红字审计（必须本地 Docker :8000 已启动）
 */
const { chromium } = require('playwright');

const BASE = (process.env.HENGAI_BASE_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const STATIC = `${BASE}/static`;

const PAGES = [
  { name: 'index', url: `${STATIC}/index.html` },
  { name: 'hub', url: `${STATIC}/全域中心.html` },
  { name: 'knowledge-embed', url: `${STATIC}/HengAI_法规知识库.html?embed=1` },
  { name: 'compute-embed', url: `${STATIC}/HengAI_算力资源.html?embed=1` },
  { name: 'supply-embed', url: `${STATIC}/HengAI_供应链协同.html?embed=1` },
];

function ignoreNoise(text) {
  const t = String(text || '');
  if (t.includes('favicon.ico')) return true;
  if (t.includes('Extension context')) return true;
  if (t.includes('message channel closed')) return true;
  return false;
}

async function auditPage(browser, pg) {
  const page = await browser.newPage();
  const issues = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (ignoreNoise(text)) return;
    issues.push(`[console.error] ${text}`);
  });
  page.on('pageerror', (err) => {
    if (ignoreNoise(err.message)) return;
    issues.push(`[pageerror] ${err.message}`);
  });
  page.on('response', (res) => {
    const u = res.url();
    if (!u.includes('/api/v1/')) return;
    if (res.status() >= 500) issues.push(`[api ${res.status()}] ${u}`);
  });

  try {
    await page.goto(pg.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    if (pg.name === 'hub') {
      await page.evaluate(() => {
        if (typeof window.navTo === 'function') {
          window.navTo('knowledge', document.getElementById('nav-knowledge'));
        }
      });
      await page.waitForTimeout(2500);
    }
  } catch (e) {
    issues.push(`[navigation] ${e.message}`);
  }
  await page.close();
  return issues;
}

async function launchBrowser() {
  const channels = ['msedge', 'chrome', 'chromium'];
  for (const channel of channels) {
    try {
      const opts = { headless: true };
      if (channel !== 'chromium') opts.channel = channel;
      const browser = await chromium.launch(opts);
      console.log(`ℹ 使用浏览器: ${channel}`);
      return browser;
    } catch (_) {}
  }
  throw new Error('无可用浏览器。请安装 Edge/Chrome，或执行: npx playwright install chromium');
}

async function main() {
  const browser = await launchBrowser();
  const all = [];
  for (const pg of PAGES) {
    const issues = await auditPage(browser, pg);
    if (issues.length) {
      all.push({ pg, issues });
      console.error(`\n❌ ${pg.name}`);
      issues.forEach((i) => console.error('   ', i));
    } else {
      console.log(`✅ ${pg.name}`);
    }
  }
  await browser.close();
  if (all.length) {
    console.error(`\n❌ 失败 ${all.length}/${PAGES.length}`);
    process.exit(1);
  }
  console.log(`\n✅ 控制台零红字审计通过（${PAGES.length} 页）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
