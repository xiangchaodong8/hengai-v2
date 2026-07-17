/**
 * HengAI 本地 UI 预览 · 仅用于开发调试
 * 用法：任意页面 URL 加 ?dev=1 或 ?preview=1
 * 可选：&scenario=origin-pending | origin-preview | origin-approved | sme
 */
(function (global) {
  'use strict';

  var SCENARIOS = {
    'origin-preview': {
      label: '原厂 · 驾驶舱预览（未认领）',
      user: { isLoggedIn: true, name: '张工', tier: 'PRO', tier_code: 'PRO', currentLevel: 3, gmBalance: 1280 },
      company: {
        name: '武汉钢铁有限公司',
        creditCode: '91420100177777777X',
        type: 'ORIGIN',
        industryCode: 'steel',
        industryLabel: '钢铁',
        sovereigntyClaimStatus: 'none',
        isIndustrialFactory: true,
      },
      flags: {
        userRole: 'ROLE_ORIGIN',
        hasOriginFactoryPerm: true,
        currentPhase: 'Phase2',
        phaseLabel: 'Phase 2 · 工业原厂期',
        hubOverviewReady: true,
        unlockedMenusList: ['dashboard', 'achievement', 'wallet', 'compute', 'enterprise', 'supply', 'batch-verify', 'origin-audit', 'factor-auth', 'report', 'decision'],
      },
      metrics: { crusadeCount: 12, totalTaxPenalty: 2840000 },
    },
    'origin-pending': {
      label: '原厂 · 主权认领审核中',
      extends: 'origin-preview',
      company: {
        sovereigntyClaimStatus: 'pending',
        sovereigntyClaimSubmittedAt: '2026-06-06T00:50:23.833Z',
        sovereigntyAuthLetterFilename: 'sovereignty-auth.pdf',
        sovereigntyAiPrescreen: { note: '需人工审核' },
      },
    },
    'origin-approved': {
      label: '原厂 · 认领已通过',
      extends: 'origin-preview',
      company: {
        sovereigntyClaimStatus: 'approved',
        sovereigntyClaimSubmittedAt: '2026-06-01T10:00:00.000Z',
        sovereigntyClaimReviewedAt: '2026-06-03T14:30:00.000Z',
        isComplete: true,
        verifiedFactor: 1.82,
      },
      industryAudit: { localCarbonIntensity: 1.82 },
    },
    'origin-rejected': {
      label: '原厂 · 认领被驳回',
      extends: 'origin-preview',
      company: {
        sovereigntyClaimStatus: 'rejected',
        sovereigntyClaimReviewerNote: '授权书公章不清晰，请重新上传。',
      },
    },
    'sme': {
      label: '下游 SME（测拦截/双轨）',
      user: { isLoggedIn: true, name: '李经理', tier: 'PRO', tier_code: 'PRO', currentLevel: 2, gmBalance: 420 },
      company: {
        name: '苏州精密部件有限公司',
        type: 'SME',
        industryCode: 'manufacturing',
        industryLabel: '装备制造',
      },
      flags: {
        userRole: 'ROLE_SME',
        hasOriginFactoryPerm: false,
        currentPhase: 'Phase2',
        phaseLabel: 'Phase 2 · 企业合规期',
        hubOverviewReady: true,
      },
    },
  };

  function queryFlag(name) {
    try {
      return new URLSearchParams(global.location.search || '').get(name);
    } catch (_) {
      return null;
    }
  }

  function isDevQuery() {
    var d = queryFlag('dev');
    var p = queryFlag('preview');
    return d === '1' || d === 'true' || p === '1' || p === 'true';
  }

  function resolveScenarioId() {
    var raw = queryFlag('scenario') || 'origin-preview';
    return SCENARIOS[raw] ? raw : 'origin-preview';
  }

  function deepMerge(target, source) {
    if (!source || typeof source !== 'object') return target;
    Object.keys(source).forEach(function (key) {
      var sv = source[key];
      if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
        target[key] = deepMerge(target[key] && typeof target[key] === 'object' ? Object.assign({}, target[key]) : {}, sv);
      } else {
        target[key] = sv;
      }
    });
    return target;
  }

  function buildScenario(id) {
    var def = SCENARIOS[id];
    if (!def) return null;
    var base = def.extends ? buildScenario(def.extends) : { user: {}, company: {}, flags: {}, metrics: {}, industryAudit: {} };
    if (!base) return null;
    var out = {
      label: def.label || id,
      user: deepMerge({}, base.user || {}),
      company: deepMerge({}, base.company || {}),
      flags: deepMerge({}, base.flags || {}),
      metrics: deepMerge({}, base.metrics || {}),
      industryAudit: deepMerge({}, base.industryAudit || {}),
    };
    if (def.user) deepMerge(out.user, def.user);
    if (def.company) deepMerge(out.company, def.company);
    if (def.flags) deepMerge(out.flags, def.flags);
    if (def.metrics) deepMerge(out.metrics, def.metrics);
    if (def.industryAudit) deepMerge(out.industryAudit, def.industryAudit);
    return out;
  }

  function hengaiIsDevPreview() {
    if (global.HENGAI_DEV_PREVIEW === true) return true;
    try {
      if (global.localStorage && global.localStorage.getItem('hengai_dev_preview') === '1') return true;
    } catch (_) {}
    return isDevQuery();
  }

  function applyHengaiDevPreviewIfNeeded(forceScenario) {
    if (!hengaiIsDevPreview()) return false;
    global.HENGAI_DEV_PREVIEW = true;
    try {
      global.document.documentElement.setAttribute('data-dev-preview', '1');
    } catch (_) {}

    var sid = forceScenario || resolveScenarioId();
    var scenario = buildScenario(sid);
    if (!scenario) return false;

    global.HENGAI_DEV_PREVIEW_SCENARIO = sid;

    if (!global.AppState || typeof global.AppState !== 'object') {
      global.AppState = {};
    }
    var s = global.AppState;
    s.user = deepMerge(s.user || {}, scenario.user);
    s.company = deepMerge(s.company || {}, scenario.company);
    s.flags = deepMerge(s.flags || {}, scenario.flags);
    s.metrics = deepMerge(s.metrics || {}, scenario.metrics);
    if (scenario.industryAudit && Object.keys(scenario.industryAudit).length) {
      s.industryAudit = deepMerge(s.industryAudit || {}, scenario.industryAudit);
    }

    if (typeof global.patchUserLoginFlag === 'function') global.patchUserLoginFlag(s);

    if (typeof global.patchState === 'function') {
      global.patchState({
        user: s.user,
        company: s.company,
        flags: s.flags,
        metrics: s.metrics,
        industryAudit: s.industryAudit,
      }, { emitStateSynced: false });
    } else if (typeof global.syncAppState === 'function') {
      try { global.syncAppState(s, { emitStateSynced: false }); } catch (_) {}
    }

    showDevPreviewBanner(sid, scenario.label);
    return true;
  }

  function showDevPreviewBanner(sid, label) {
    if (!global.document || global.document.getElementById('hengai-dev-preview-banner')) return;
    var bar = global.document.createElement('div');
    bar.id = 'hengai-dev-preview-banner';
    bar.setAttribute('role', 'status');
    bar.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
      'padding:6px 14px', 'font-size:11px', 'font-family:"Noto Sans SC",sans-serif',
      'background:linear-gradient(90deg,#7c2d12,#b45309)', 'color:#fff',
      'display:flex', 'align-items:center', 'gap:10px', 'flex-wrap:wrap',
      'box-shadow:0 2px 12px rgba(0,0,0,.35)',
    ].join(';');
    bar.innerHTML = '<strong>DEV 预览</strong>'
      + '<span>' + (label || sid) + '</span>'
      + '<span style="opacity:.85">· 角色门禁已放宽 · 勿用于生产</span>'
      + '<a href="HengAI_本地UI预览台.html" style="margin-left:auto;color:#fde68a;text-decoration:underline">返回预览台</a>';
    global.document.body.appendChild(bar);
    try {
      global.document.body.style.paddingTop = '32px';
    } catch (_) {}
  }

  function devPreviewUrl(path, scenario) {
    var base = String(path || '').split('?')[0];
    var q = ['dev=1'];
    if (scenario) q.push('scenario=' + encodeURIComponent(scenario));
    return base + '?' + q.join('&');
  }

  if (isDevQuery()) {
    global.HENGAI_DEV_PREVIEW = true;
    try {
      global.document.documentElement.setAttribute('data-dev-preview', '1');
    } catch (_) {}
  }

  global.HENGAI_DEV_SCENARIOS = SCENARIOS;
  global.hengaiIsDevPreview = hengaiIsDevPreview;
  global.applyHengaiDevPreviewIfNeeded = applyHengaiDevPreviewIfNeeded;
  global.hengaiDevPreviewUrl = devPreviewUrl;
})(typeof window !== 'undefined' ? window : globalThis);
