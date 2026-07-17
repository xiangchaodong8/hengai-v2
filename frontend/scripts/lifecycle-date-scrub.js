#!/usr/bin/env node
/**
 * 清除 14 模块 HTML 中的硬编码日期，改为 data-state-bind / 空节点（由 AppState + timeline 灌注）
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = [
  '全域中心.html',
  'index.html',
  'HengAI_荣誉体系.html',
  'HengAI_星火成就档案.html',
  'HengAI_算力资源.html',
  'HengAI_法规知识库.html',
  'HengAI_企业数字档案.html',
  'HengAI_供应链协同.html',
  'HengAI_决策层呈送包生成器.html',
  'HengAI_Governance.html',
  'HengAI_GM_Wallet.html',
  'HengAI_EU_Customs.html',
  'HengAI_DLD_Credit.html',
  'HengAI_ACF_Cert.html',
  'HengAI_全域诊断报告.html',
  'HengAI_CBAM测算工具.html',
];

const DATE_RE = /202\d-\d{2}-\d{2}/;
const SHORT_MD_RE = />\s*(\d{2}-\d{2})\s*</g;

function scrub(content, file) {
  let n = 0;
  const bump = () => { n += 1; };

  /* 宏观牌价更新日 */
  content = content.replace(
    /(<span id="wgLastUpdate">)\s*202\d-\d{2}-\d{2}\s*(<\/span>)/g,
    '$1<span data-state-bind="macro.last_updated" data-state-fmt="dt" data-empty="待记录">---</span>$2'
  );
  content = content.replace(
    /\uFF08\u66F4\u65B0\u4E8E\s*\uFF09202\d-\d{2}-\d{2}/g,
    '\uFF08\u66F4\u65B0\u4E8E <span data-state-bind="macro.last_updated" data-state-fmt="dt" data-empty="\u5F85\u8BB0\u5F55">---</span>'
  );

  /* 诊断 / 报告日期 */
  const diagSpan = '<span data-state-bind="diagnostic.generatedAt" data-state-fmt="dt" data-empty="待记录">---</span>';
  content = content.replace(/(<strong>)202\d-\d{2}-\d{2}(<\/strong>)/g, (m, a, b) => {
    if (/报告日期|生成时间|报告人/.test(content.slice(Math.max(0, content.indexOf(m) - 80), content.indexOf(m) + 80))) {
      bump();
      return a + diagSpan + b;
    }
    return m;
  });
  content = content.replace(/合规负责人 ·\s*202\d-\d{2}-\d{2}/g, () => {
    bump();
    return '合规负责人 · ' + diagSpan;
  });
  content = content.replace(/上次生成：\s*202\d-\d{2}-\d{2}/g, () => {
    bump();
    return '上次生成：<span data-state-bind="diagnostic.generatedAt" data-state-fmt="dt" data-empty="待记录">---</span>';
  });

  /* 时间轴 / 徽章 / 流水 —— 清空硬编码，保留 class 供 JS 绑定 */
  const clearClasses = [
    'badge-date', 'medal-date', 'log-time', 'gm-ev-time', 'gt-date',
    'rc-date', 'lt-date', 'ab-date', 'cert-date', 'plan-meta',
  ];
  clearClasses.forEach((cls) => {
    const re = new RegExp(
      '(<[^>]*class="[^"]*\\b' + cls + '\\b[^"]*"[^>]*>)\\s*[^<]*202\\d-\\d{2}-\\d{2}[^<]*(<)',
      'g'
    );
    content = content.replace(re, '$1<span data-empty="待记录">---</span>$2');
  });

  /* gm-ev-time 含时分 */
  content = content.replace(
    /(<div class="gm-ev-time"[^>]*>)\s*202\d-\d{2}-\d{2}[^<]*(<\/div>)/g,
    '$1<span data-empty="待记录">---</span>$2'
  );

  /* 算力 log */
  content = content.replace(
    /(<div class="log-time">)\s*202\d-\d{2}-\d{2}[^<]*(<\/div>)/g,
    '$1<span class="dyn-log-time" data-empty="待记录">---</span>$2'
  );

  /* 法规条目日期行 */
  content = content.replace(
    /(<div class="rc-date">)\s*更新\s*202\d-\d{2}-\d{2}\s*(<\/div>)/g,
    '$1<span class="dyn-law-updated" data-empty="待记录">---</span>$2'
  );
  content = content.replace(
    /(<div class="lt-date">)\s*202\d-\d{2}-\d{2}[^<]*(<\/div>)/g,
    '$1<span class="dyn-activity-time" data-state-bind="activityTimeline.0.at" data-state-fmt="md" data-empty="待记录">---</span>$2'
  );

  /* 治理提案日期 */
  content = content.replace(
    /(<div class="gt-date">)\s*202\d-\d{2}-\d{2}[^<]*(<\/div>)/g,
    '$1<span class="dyn-gov-event-time" data-empty="待记录">---</span>$2'
  );

  /* DLD 确权副标题 */
  content = content.replace(
    /(<div style="font-size:10\.5px;color:var\(--ink3\)">)\s*202\d-\d{2}-\d{2}\s*确权(<\/div>)/g,
    '$1<span data-state-bind="recentReports.0.submittedAt" data-state-fmt="dt" data-empty="待记录">---</span> 确权$2'
  );

  /* 计划扣费 / 重置（算力） */
  content = content.replace(/下次扣费：<strong>\s*202\d-\d{2}-\d{2}\s*<\/strong>/g, () => {
    bump();
    return '下次扣费：<strong><span data-state-bind="compute.nextBillingAt" data-state-fmt="dt" data-empty="待记录">---</span></strong>';
  });
  content = content.replace(/重置\s*202\d-\d{2}-\d{2}/g, () => {
    bump();
    return '重置 <span data-state-bind="compute.quotaResetAt" data-state-fmt="dt" data-empty="待记录">---</span>';
  });
  content = content.replace(/预计用完<\/span><span>\s*202\d-\d{2}-\d{2}\s*<\/span>/g, () => {
    bump();
    return '预计用完</span><span data-state-bind="compute.quotaExhaustAt" data-state-fmt="dt" data-empty="待记录">---</span>';
  });

  /* 欧盟海关 / 表格内日期（保留报告期文字，仅清日期副行） */
  content = content.replace(
    /(<div style="font-size:10px;color:var\(--text-3\)">)\s*202\d-\d{2}-\d{2}\s*(<\/div>)/g,
    '$1<span data-state-bind="recentReports.0.submittedAt" data-state-fmt="dt" data-empty="待记录">---</span>$2'
  );

  /* 到期日（认证有效期）— 业务字段非“当前时钟” */
  content = content.replace(
    /(<td[^>]*>)\s*202[7-9]-\d{2}-\d{2}\s*(<\/td>)/g,
    '$1<span data-state-bind="company.certValidUntil" data-state-fmt="dt" data-empty="待记录">---</span>$2'
  );

  /* 实施/生效 pill 中的政策日期 → 待记录占位 */
  content = content.replace(
    /(<span class="pill[^"]*">)\s*202\d-\d{2}-\d{2}\s+实施\s*(<\/span>)/g,
    '$1<span data-state-bind="macro.policyEffectiveAt" data-state-fmt="dt" data-empty="待记录">---</span> 实施$2'
  );

  /* JS 默认值中的 last_updated */
  content = content.replace(
    /last_updated:\s*['"]202\d-\d{2}-\d{2}['"]/g,
    () => { bump(); return "last_updated: null"; }
  );

  /* 注册条 id-meta */
  if (file.includes('全域中心')) {
    content = content.replace(
      /(<div class="id-meta" id="id-meta">)注册于\s*<span class="dyn-user-reg-date">[^<]*<\/span>/,
      '$1注册于 <span id="id-user-reg-date" class="dyn-reg-date dyn-user-reg-date" data-state-bind="user.regDate" data-state-fmt="dt" data-empty="待记录">---</span>'
    );
  }

  return { content, n };
}

let total = 0;
FILES.forEach((rel) => {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) {
    console.warn('skip missing', rel);
    return;
  }
  const raw = fs.readFileSync(fp, 'utf8');
  const { content, n } = scrub(raw, rel);
  if (content !== raw) {
    fs.writeFileSync(fp, content, 'utf8');
    console.log('scrubbed', rel, '(~' + n + ' blocks)');
    total += 1;
  }
});
console.log('Done. Files updated:', total);
