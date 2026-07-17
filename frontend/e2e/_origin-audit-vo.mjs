/**
 * 产业主权看板 · VO 收尾 E2E（embed/standalone 壳对齐 + CTA 去重 + 账本）
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8000';
const SUITE = BASE + '/static/HengAI_HeavyIndustry_Suite.html';
const HUB = BASE + '/static/全域中心.html';

const results = [];
const pass = (name, detail) => results.push({ name, ok: true, detail });
const fail = (name, detail) => results.push({ name, ok: false, detail });

async function login(page) {
  await page.goto(BASE + '/static/index.html', { waitUntil: 'domcontentloaded', timeout: 120000 });
  const token = await page.evaluate(async () => {
    const r = await fetch('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ziteng@co2lion.com', password: 'xd23587052' }),
    });
    const d = await r.json();
    if (!d.access_token) return null;
    localStorage.setItem('hengai_token', d.access_token);
    localStorage.setItem('authToken', d.access_token);
    return d.access_token;
  });
  if (!token) throw new Error('登录失败');
}

async function probeSuite(page, embed) {
  const url = embed ? SUITE + '?embed=1' : SUITE;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(
    () => typeof window.bindAppState === 'function' || !!document.getElementById('hi-exec-brief'),
    null,
    { timeout: 60000 }
  );
  if (typeof page.waitForTimeout === 'function') await page.waitForTimeout(800);
  return page.evaluate((isEmbed) => {
    const bodyWrap = document.getElementById('hi-body-wrap');
    const bodyStyle = bodyWrap ? getComputedStyle(bodyWrap).display : 'missing';
    const bottom = document.getElementById('hi-bottom-panel');
    const bottomStyle = bottom ? getComputedStyle(bottom).display : 'missing';
    const briefCalc = document.getElementById('hi-btn-brief-calc');
    const briefVerify = document.getElementById('hi-btn-brief-verify');
    const gotoFactor = document.getElementById('hi-btn-goto-factor');
    const attest = document.getElementById('hi-btn-attest');
    const budget = document.getElementById('hi-btn-budget-report');
    const briefFact = document.getElementById('hi-btn-brief-fact');
    const briefDecision = document.getElementById('hi-btn-brief-decision');
    const policyBudgetBtn = document.getElementById('hi-policy-modal-budget');
    const policyAck = document.getElementById('hi-policy-modal-ack');
    const infLead = document.getElementById('hi-inf-lead');
    const infBoardLabel = document.querySelector('.hi-inf-board-label');
    const infMeHead = document.querySelector('.hi-inf-me-head-title');
    const infDataMode = document.getElementById('hi-inf-data-mode');
    const ledgerCard = document.getElementById('hi-factor-ledger-card');
    const topbar = document.querySelector('.hi-topbar');
    const embedStrip = document.getElementById('hi-embed-strip');
    const warMain = document.getElementById('hi-warroom-main');
    const shCount = document.querySelectorAll('#hi-warroom-main .sh-t').length;
    return {
      isEmbed,
      bodyHidden: bodyStyle === 'none',
      bottomHidden: isEmbed ? (bottom ? getComputedStyle(bottom).display === 'none' : true) : (bottom ? getComputedStyle(bottom).display !== 'none' : false),
      bottomHubCard: bottom ? bottom.classList.contains('hi-hub-section') : false,
      pledgeBar: !!document.querySelector('.hi-pledge-bar'),
      topbarHidden: isEmbed ? (topbar ? getComputedStyle(topbar).display === 'none' : true) : (topbar ? getComputedStyle(topbar).display !== 'none' : false),
      embedStripVisible: isEmbed ? (embedStrip ? getComputedStyle(embedStrip).display !== 'none' : false) : true,
      mainPad: warMain ? parseInt(getComputedStyle(warMain).paddingLeft, 10) : 0,
      shSections: shCount,
      briefIsActBtn: briefCalc ? briefCalc.classList.contains('act-btn') : false,
      briefCalcVisible: briefCalc && getComputedStyle(briefCalc).display !== 'none',
      briefVerifyVisible: briefVerify && getComputedStyle(briefVerify).display !== 'none',
      gotoFactorHidden: !gotoFactor || gotoFactor.hidden || getComputedStyle(gotoFactor).display === 'none',
      attestHidden: !attest || attest.hidden || getComputedStyle(attest).display === 'none',
      budgetVisible: budget && getComputedStyle(budget).display !== 'none',
      briefFactVisible: briefFact && getComputedStyle(briefFact).display !== 'none',
      briefDecisionVisible: briefDecision && getComputedStyle(briefDecision).display !== 'none',
      policyReadOnly: !policyBudgetBtn && !!policyAck,
      infLeadVisible: infLead && getComputedStyle(infLead).display !== 'none',
      infBoardLabel: infBoardLabel ? infBoardLabel.textContent : '',
      infMeHead: infMeHead ? infMeHead.textContent : '',
      infDataMode: infDataMode ? infDataMode.textContent : '',
      ledgerMount: !!ledgerCard && typeof window.renderHengaiFactorLedger === 'function',
      loadOriginLedger: typeof window.loadOriginLedger === 'function',
      title: document.title,
    };
  }, embed);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await login(page);

    const embedProbe = await probeSuite(page, true);
    if (embedProbe.bodyHidden) pass('embed · 隐藏工序矩阵', 'hi-body-wrap display:none');
    else fail('embed · 隐藏工序矩阵', JSON.stringify(embedProbe));
    if (embedProbe.bottomHidden) pass('embed · 隐藏底部区', 'hi-bottom-panel display:none');
    else fail('embed · 隐藏底部区', JSON.stringify(embedProbe));
    if (embedProbe.topbarHidden) pass('embed · 隐藏子页顶栏', '与 factor/supply 一致');
    else fail('embed · 隐藏子页顶栏', JSON.stringify(embedProbe));
    if (embedProbe.embedStripVisible) pass('embed · 状态条', 'hi-embed-strip 可见');
    else fail('embed · 状态条', JSON.stringify(embedProbe));
    if (embedProbe.mainPad >= 24) pass('embed · main-pad', 'padding-left ≥ 24px');
    else fail('embed · main-pad', JSON.stringify(embedProbe));
    if (embedProbe.shSections >= 4) pass('embed · Hub 区块标题', embedProbe.shSections + ' 处 .sh-t');
    else fail('embed · Hub 区块标题', JSON.stringify(embedProbe));
    if (embedProbe.briefIsActBtn) pass('embed · act-btn CTA', '执行简报按钮已对齐');
    else fail('embed · act-btn CTA', JSON.stringify(embedProbe));
    if (embedProbe.briefCalcVisible && embedProbe.briefVerifyVisible) {
      pass('embed · 执行简报 CTA', '精算/核验按钮可见');
    } else fail('embed · 执行简报 CTA', JSON.stringify(embedProbe));
    if (embedProbe.briefFactVisible && embedProbe.briefDecisionVisible) {
      pass('embed · 事实材料/呈送包', '执行总览次级 CTA 可见');
    } else fail('embed · 事实材料/呈送包', JSON.stringify(embedProbe));
    if (embedProbe.policyReadOnly) pass('embed · 政策只读', '无预算 CTA · 有我知道了');
    else fail('embed · 政策只读', JSON.stringify(embedProbe));
    if (embedProbe.infLeadVisible && (embedProbe.infBoardLabel || '').includes('其他原厂')) {
      pass('embed · 影响力榜单说明', '榜单/本企业边界文案可见');
    } else fail('embed · 影响力榜单说明', JSON.stringify(embedProbe));
    if ((embedProbe.infMeHead || '').includes('本企业')) {
      pass('embed · 本企业区块标题', embedProbe.infMeHead);
    } else fail('embed · 本企业区块标题', JSON.stringify(embedProbe));

    const standaloneProbe = await probeSuite(page, false);
    if (standaloneProbe.bodyHidden) pass('standalone · 隐藏工序矩阵', '与 embed 一致');
    else fail('standalone · 隐藏工序矩阵', JSON.stringify(standaloneProbe));
    if (standaloneProbe.gotoFactorHidden && standaloneProbe.attestHidden) {
      pass('standalone · 底部 CTA 去重', '精算/核验 hero 已隐藏');
    } else fail('standalone · 底部 CTA 去重', JSON.stringify(standaloneProbe));
    if (standaloneProbe.briefCalcVisible && standaloneProbe.budgetVisible) {
      pass('standalone · 保留简报+事实材料', '导航不丢');
    } else fail('standalone · 保留简报+事实材料', JSON.stringify(standaloneProbe));
    if (standaloneProbe.bottomHubCard && standaloneProbe.pledgeBar) {
      pass('standalone · 底部 Hub 风格', 'hi-bottom-panel + ins-gold 承诺书条');
    } else fail('standalone · 底部 Hub 风格', JSON.stringify(standaloneProbe));
    if (standaloneProbe.ledgerMount) pass('账本挂载', 'hi-factor-ledger-card + renderHengaiFactorLedger');
    else fail('账本挂载', JSON.stringify(standaloneProbe));
    if (standaloneProbe.loadOriginLedger) pass('loadOriginLedger', '本页可拉取 origin-factor-ledger');
    else fail('loadOriginLedger', JSON.stringify(standaloneProbe));
    if ((standaloneProbe.title || '').includes('产业主权看板')) pass('页面标题', standaloneProbe.title);
    else fail('页面标题', standaloneProbe.title);

    await page.goto(`${HUB}#origin-audit`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(1000);
    const hubActive = await page.locator('#page-origin-audit.active').count();
    if (hubActive > 0) pass('Hub iframe 路由', 'origin-audit 面板激活');
    else fail('Hub iframe 路由', '面板未激活');

    const frame = page.frameLocator('#page-origin-audit iframe.embed-frame');
    const frameBodyHidden = await frame.locator('#hi-body-wrap').evaluate((el) => {
      return el ? getComputedStyle(el).display === 'none' : false;
    }).catch(() => false);
    if (frameBodyHidden) pass('Hub iframe · 矩阵隐藏', 'embed 壳生效');
    else fail('Hub iframe · 矩阵隐藏', String(frameBodyHidden));

    const failed = results.filter((r) => !r.ok);
    console.log('\n=== 产业主权看板 VO E2E ===\n');
    results.forEach((r) => console.log((r.ok ? '✓' : '✗') + ' ' + r.name + (r.detail ? ' — ' + r.detail : '')));
    console.log('\n' + results.filter((r) => r.ok).length + '/' + results.length + ' 通过\n');
    if (failed.length) process.exit(1);
  } catch (err) {
    console.error('自测异常:', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
