/**
 * 信任历程与荣誉分层 · UI 辅助（契约 v1.1）
 * TrustCommitmentLevel / HonorEligibilityTier / evidence.history[]
 */
(function (W) {
  'use strict';
  if (W.__hengaiTrustJourney) return;
  W.__hengaiTrustJourney = true;

  var HONOR_TIER_META = {
    INELIGIBLE: { label: '未登记', pill: 'p-gray', hint: '尚未进入实证承诺路径' },
    PIONEER: { label: '主权先行者', pill: 'p-y', hint: '产业链主权先行登记 · 已迈出第一步' },
    CERTIFIED_BUILDER: { label: '确权建设者', pill: 'p-g', hint: 'CL-GCOPO 绿色出海先行者名录候选' },
  };

  var MODE_LABEL = {
    SIMULATED: '模拟态',
    PENDING_VERIFICATION: '实证中',
    SOVEREIGN_VERIFIED: '已确权',
  };

  function state() {
    var st = W.AppState || {};
    if (typeof W.ensureEvidenceContractShape === 'function') {
      try { W.ensureEvidenceContractShape(st); } catch (_) {}
    }
    return st;
  }

  function ensureStyles() {
    if (!W.document || W.document.getElementById('hengai-trust-journey-css')) return;
    var s = W.document.createElement('style');
    s.id = 'hengai-trust-journey-css';
    s.textContent = '.hj-step{display:flex;gap:10px;padding:0 0 12px;position:relative}'
      + '.hj-step:not(.hj-step-last)::before{content:"";position:absolute;left:5px;top:14px;bottom:0;width:1px;background:rgba(16,185,129,.25)}'
      + '.hj-dot{width:11px;height:11px;border-radius:50%;background:#14b8a6;flex-shrink:0;margin-top:3px}'
      + '.hj-date{font-size:10px;color:#8a95a8;font-family:DM Mono,monospace}'
      + '.hj-text{font-size:12px;color:#c5cdd8;line-height:1.55}'
      + '.hj-empty{font-size:12px;color:#8a95a8;text-align:center;padding:8px 0}';
    W.document.head.appendChild(s);
  }

  function honorTier(st) {
    var s = st || state();
    var co = s.company || {};
    var ev = (s.cbam && s.cbam.evidence) || {};
    return String(co.honorEligibilityTier || ev.honorEligibilityTier || 'INELIGIBLE').toUpperCase();
  }

  function trustLevel(st) {
    var s = st || state();
    var co = s.company || {};
    var ev = (s.cbam && s.cbam.evidence) || {};
    return String(co.trustCommitmentLevel || ev.trustCommitmentLevel || 'NOT_STARTED').toUpperCase();
  }

  function confidenceLabel(st) {
    var s = st || state();
    var mode = String(((s.cbam && s.cbam.evidence && s.cbam.evidence.mode) || '')).toUpperCase();
    if (mode === 'SOVEREIGN_VERIFIED') return 'Lv.4 · CL-IVC 认证';
    if (mode === 'PENDING_VERIFICATION') return 'Lv.2 · 实证推进中';
    return 'Lv.2 · 行业缺省';
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    } catch (_) {
      return String(iso).slice(0, 10);
    }
  }

  function formatHistoryEvent(evt) {
    if (!evt || typeof evt !== 'object') return '—';
    var mode = String(evt.mode || '').toUpperCase();
    var modeLbl = MODE_LABEL[mode] || mode || '—';
    var val = evt.value != null && Number.isFinite(Number(evt.value)) ? Number(evt.value).toFixed(2) + ' tCO₂e/t' : '';
    var trigger = String(evt.trigger || '');
    var extra = '';
    if (trigger === 'resonance_triggered' || evt.fundingMode === 'resonance_triggered') {
      var pc = evt.participantCount != null ? evt.participantCount : null;
      var rc = evt.resonanceCountAtTrigger;
      extra = ' · 共振触发';
      if (pc != null) extra += '（' + pc + ' 家参与';
      if (rc != null) extra += '，集结 ' + rc + ' 次';
      if (pc != null || rc != null) extra += '）';
      extra += ' · 单供应商可自愿添置 CL-MAT';
    } else if (trigger === 'hub_elevation_initiated' || trigger === 'self_paid') {
      extra = ' · 发起升格确权';
    } else if (trigger === 'verified_sync' || mode === 'SOVEREIGN_VERIFIED') {
      if (evt.certId) extra = ' · ' + evt.certId;
      if (evt.daysFromFirstSimToVerified != null) {
        extra += ' · 历时 ' + evt.daysFromFirstSimToVerified + ' 天';
      }
    } else if (trigger === 'rollback_funding_declined') {
      extra = ' · 流程暂缓（历史保留）';
    } else if (trigger === 'user_initial_calc') {
      extra = ' · 首次测算';
    }
    return modeLbl + (val ? ' · ' + val : '') + extra;
  }

  function renderTrustHonorBadges(host, st) {
    if (!host) return;
    var tier = honorTier(st);
    var meta = HONOR_TIER_META[tier] || HONOR_TIER_META.INELIGIBLE;
    var conf = confidenceLabel(st);
    host.innerHTML =
      '<span class="pill ' + meta.pill + '" title="信任承诺度 · ' + meta.hint + '">信任 · ' + meta.label + '</span>' +
      '<span class="pill p-b" title="数据置信度（与信任承诺度正交）">置信 · ' + conf + '</span>';
  }

  function renderEvidenceJourneyTimeline(container, st) {
    if (!container) return;
    var s = st || state();
    var history = ((s.cbam && s.cbam.evidence && s.cbam.evidence.history) || []).slice();
    if (!history.length) {
      container.innerHTML = '<div class="hj-empty">暂无历程记录 · 完成 CBAM 测算或发起升格后将自动留痕</div>';
      return;
    }
    container.innerHTML = history.map(function (evt, idx) {
      var isLast = idx === history.length - 1;
      return '<div class="hj-step' + (isLast ? ' hj-step-last' : '') + '">' +
        '<div class="hj-dot" aria-hidden="true"></div>' +
        '<div class="hj-body">' +
        '<div class="hj-date">' + fmtDate(evt.enteredAt) + '</div>' +
        '<div class="hj-text">' + formatHistoryEvent(evt) + '</div>' +
        '</div></div>';
    }).join('');
  }

  function honorTierPillHtml(tierRaw) {
    var tier = String(tierRaw || 'INELIGIBLE').toUpperCase();
    if (tier === 'INELIGIBLE') return '';
    var meta = HONOR_TIER_META[tier] || HONOR_TIER_META.INELIGIBLE;
    return '<span class="pill ' + meta.pill + '" style="font-size:9.5px;margin-left:6px" title="' + meta.hint + '">' + meta.label + '</span>';
  }

  function syncTrustJourneyUi(opts) {
    opts = opts || {};
    ensureStyles();
    var st = opts.state || state();
    var badgeHost = opts.badgeHost || W.document.getElementById('hi-trust-badge-row')
      || W.document.getElementById('fa-trust-badge-row');
    var timelineHost = opts.timelineHost || W.document.getElementById('hi-gf-timeline')
      || W.document.getElementById('fa-gf-timeline');
    var journeyWrap = opts.journeyWrap || W.document.getElementById('hi-trust-journey')
      || W.document.getElementById('fa-trust-journey');
    if (badgeHost) renderTrustHonorBadges(badgeHost, st);
    if (timelineHost) renderEvidenceJourneyTimeline(timelineHost, st);
    if (journeyWrap) {
      var hist = ((st.cbam && st.cbam.evidence && st.cbam.evidence.history) || []);
      journeyWrap.hidden = !hist.length && honorTier(st) === 'INELIGIBLE';
    }
    if (typeof opts.onHonorTier === 'function') opts.onHonorTier(honorTier(st), trustLevel(st), st);
  }

  W.formatEvidenceHistoryEvent = formatHistoryEvent;
  W.renderTrustHonorBadges = renderTrustHonorBadges;
  W.renderEvidenceJourneyTimeline = renderEvidenceJourneyTimeline;
  W.honorTierPillHtml = honorTierPillHtml;
  W.syncTrustJourneyUi = syncTrustJourneyUi;
  W.getHonorEligibilityTier = honorTier;
})(window);
