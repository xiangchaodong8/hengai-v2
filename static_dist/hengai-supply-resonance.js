/**
 * 供应链协同 · 主权共振波谱仪（SME 群体共振视角）
 */
(function (W) {
  'use strict';
  if (W.__hengaiSupplyResonance) return;
  W.__hengaiSupplyResonance = true;

  var RANK_KEY = 'hengai_user_resonance_rank';
  var REQ_KEY = 'hengai_user_resonance_requested';

  function apiBase() {
    try {
      return (W.API_BASE || W.location.origin || '').replace(/\/+$/, '');
    } catch (_) {
      return '';
    }
  }

  function authHeaders() {
    var t = null;
    try {
      t = localStorage.getItem('hengai_token') || localStorage.getItem('authToken');
    } catch (_) {}
    return t ? { Authorization: 'Bearer ' + t } : {};
  }

  function state() {
    return W.AppState || {};
  }

  function resonanceCount(s) {
    var st = s || state();
    if (st.metrics && st.metrics.resonanceCount != null) return Number(st.metrics.resonanceCount) || 0;
    if (st.resonance && st.resonance.pendingRequestsForIndustry != null) {
      return Number(st.resonance.pendingRequestsForIndustry) || 0;
    }
    return Number(st.metrics && st.metrics.crusadeCount) || 0;
  }

  function industryAmount(s) {
    var st = s || state();
    var v = st.metrics && st.metrics.totalTaxPenalty;
    if (v == null || v === '') return 0;
    return Number(v) || 0;
  }

  function userRank(s) {
    var st = s || state();
    if (st.resonance && st.resonance.userRank != null) return Number(st.resonance.userRank);
    try {
      var raw = sessionStorage.getItem(RANK_KEY);
      if (raw) return Number(raw);
    } catch (_) {}
    return null;
  }

  function hasRequested(s) {
    var st = s || state();
    if (st.resonance && st.resonance.userRequested) return true;
    try {
      return sessionStorage.getItem(REQ_KEY) === '1';
    } catch (_) {
      return false;
    }
  }

  function fmtEur(n) {
    var v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '—';
    if (v >= 1e9) return (v / 1e9).toFixed(2) + ' B';
    if (v >= 1e6) return (v / 1e6).toFixed(2) + ' M';
    return Math.round(v).toLocaleString();
  }

  function fmtPct(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return '—';
    if (n <= 1) n *= 100;
    return Math.round(n) + '%';
  }

  function mySovereigntyPct(s) {
    var st = s || state();
    var f = st.fortress || {};
    var raw = f.dimSovereignty || f.dim_sovereignty;
    if (typeof raw === 'string' && raw.indexOf('%') !== -1) return raw;
    var cov = st.metrics && st.metrics.supplyChainCoverage;
    return fmtPct(cov != null ? cov : 0);
  }

  function chainAvgPct(s) {
    var st = s || state();
    var scope = st.metrics && st.metrics.scope3Coverage;
    if (scope != null && Number(scope) > 0) {
      var n = Number(scope);
      return fmtPct(n <= 1 ? Math.min(0.85, n + 0.18) : Math.min(85, n + 18));
    }
    return '62%';
  }

  function patchResonanceLocal(extra) {
    if (!W.AppState) W.AppState = {};
    if (!W.AppState.resonance) W.AppState.resonance = {};
    if (!W.AppState.metrics) W.AppState.metrics = {};
    Object.assign(W.AppState.resonance, extra || {});
    if (extra && extra.pendingRequestsForIndustry != null) {
      W.AppState.metrics.resonanceCount = extra.pendingRequestsForIndustry;
    }
    if (typeof W.AppState.patchState === 'function') {
      W.AppState.patchState({ resonance: W.AppState.resonance, metrics: W.AppState.metrics });
    }
    if (typeof W.syncAppState === 'function') {
      try { W.syncAppState(W.AppState); } catch (_) {}
    }
    W.dispatchEvent(new CustomEvent('hengai:resonance-updated', { detail: W.AppState.resonance }));
  }

  function premiumPartnerCount(s) {
    var st = s || state();
    var nodes = [];
    if (Array.isArray(st.suppliers) && st.suppliers.length) nodes = st.suppliers;
    else if (Array.isArray(st.supplierNodes) && st.supplierNodes.length) nodes = st.supplierNodes;
    var cnt = 0;
    nodes.forEach(function (n) {
      var status = String((n && (n.status || n.supplierStatus)) || '').toLowerCase();
      if (status !== 'submitted' && status !== 'confirmed') return;
      var collab = Number(n.collaborationScore != null ? n.collaborationScore : n.collaboration_score);
      if (!Number.isFinite(collab) && typeof W.computeSupplierCollaborationScore === 'function') {
        collab = W.computeSupplierCollaborationScore(n);
      }
      var premium = n.isPremiumPartner === true || n.is_premium_partner === true || collab >= 80;
      if (premium) cnt += 1;
    });
    return cnt;
  }

  function paintResonancePanel(s) {
    var st = s || state();
    var count = resonanceCount(st);
    var rank = userRank(st);
    var rankEl = document.querySelector('.dyn-resonance-rank');
    var countEls = document.querySelectorAll('.dyn-resonance-count');
    var amountEls = document.querySelectorAll('.dyn-resonance-amount');
    var countInline = document.getElementById('sup-res-count-inline');
    var rankInline = document.getElementById('sup-res-rank-inline');
    var amountInline = document.getElementById('sup-res-amount-inline');
    var myEl = document.getElementById('sup-res-my-pos');
    var avgEl = document.getElementById('sup-res-chain-avg');
    var statusEl = document.getElementById('sup-res-status');
    var copyCount = document.getElementById('sup-res-copy-count');
    var submitBtn = document.getElementById('btn-resonance-submit');

    var rankDisplay = rank != null && Number.isFinite(rank) ? String(Math.round(rank)) : String(count + 1);
    if (rankEl) rankEl.textContent = rankDisplay;
    if (rankInline) rankInline.textContent = rankDisplay;
    countEls.forEach(function (el) { el.textContent = String(count); });
    if (countInline) countInline.textContent = String(count);
    var amt = fmtEur(industryAmount(st));
    amountEls.forEach(function (el) { el.textContent = amt; });
    if (amountInline) amountInline.textContent = amt;
    if (myEl) myEl.textContent = mySovereigntyPct(st);
    if (avgEl) avgEl.textContent = chainAvgPct(st);
    if (copyCount) copyCount.textContent = String(count);
    if (statusEl) {
      var prem = premiumPartnerCount(st);
      var premHint = prem > 0 ? (' · 优质碳伙伴 ' + prem + ' 家已纳入共振权重') : '';
      statusEl.textContent = hasRequested(st)
        ? ('📡 信号已发送至 CL-GCPO 调度中心，等待原厂合闸。' + premHint)
        : ('就绪 · 发起后将汇入行业共振波谱' + premHint);
    }
    if (submitBtn) {
      submitBtn.disabled = hasRequested(st);
      submitBtn.textContent = hasRequested(st)
        ? '✓ 技术请求已提交 · 共振中'
        : '发起技术请求 · 主权申明';
    }
  }

  function bumpHeroCounter() {
    var cta = document.getElementById('btn-supply-resonance');
    if (cta) {
      cta.classList.remove('sup-res-lit-btn');
      void cta.offsetWidth;
      cta.classList.add('sup-res-lit-btn');
      setTimeout(function () { cta.classList.remove('sup-res-lit-btn'); }, 1200);
    }
    if (typeof W.syncUpstreamFactorStrip === 'function') W.syncUpstreamFactorStrip(state());
  }

  function applyOptimisticBump(prevCount) {
    var prev = prevCount != null ? Number(prevCount) : resonanceCount(state());
    if (hasRequested(state())) return prev;
    var next = prev + 1;
    try {
      sessionStorage.setItem(RANK_KEY, String(next));
      sessionStorage.setItem(REQ_KEY, '1');
    } catch (_) {}
    patchResonanceLocal({
      userRequested: true,
      userRank: next,
      pendingRequestsForIndustry: next,
    });
    if (!W.AppState.metrics) W.AppState.metrics = {};
    W.AppState.metrics.resonanceCount = next;
    triggerLightUp();
    bumpHeroCounter();
    paintResonancePanel(state());
    if (typeof W.syncResonanceMaterialUi === 'function') W.syncResonanceMaterialUi();
    return next;
  }

  W.bumpResonanceOptimistic = applyOptimisticBump;

  function triggerLightUp() {
    var echo = document.getElementById('sup-res-echo');
    var panel = document.getElementById('sup-resonance-panel');
    if (echo) {
      echo.classList.remove('sup-res-lit');
      void echo.offsetWidth;
      echo.classList.add('sup-res-lit');
    }
    if (panel) panel.classList.add('sup-res-flash');
    setTimeout(function () {
      if (panel) panel.classList.remove('sup-res-flash');
    }, 1200);
  }

  W.openResonancePanel = function openResonancePanel() {
    var panel = document.getElementById('sup-resonance-panel');
    if (!panel) return;
    panel.hidden = false;
    panel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('sup-res-panel-open');
    paintResonancePanel(state());
  };

  W.closeResonancePanel = function closeResonancePanel() {
    var panel = document.getElementById('sup-resonance-panel');
    if (!panel) return;
    panel.hidden = true;
    panel.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('sup-res-panel-open');
  };

  W.submitSupplyResonanceRequest = async function submitSupplyResonanceRequest() {
    if (hasRequested(state())) return;
    var btn = document.getElementById('btn-resonance-submit');
    var prev = resonanceCount(state());
    if (btn) { btn.disabled = true; btn.textContent = '信号发送中…'; }
    applyOptimisticBump(prev);
    try {
      var st = state();
      var industryRaw = (st.company && (st.company.industryCode || st.company.industry_code)) || 'steel';
      var industry = (typeof window.toCanonicalIndustryCode === 'function')
        ? window.toCanonicalIndustryCode(industryRaw)
        : industryRaw;
      var body = {
        industryCode: industry,
        productCategory: 'scope3_upstream_material',
        originQuery: (st.company && st.company.name) || undefined,
      };
      var res = await fetch(apiBase() + '/api/v1/eco/resonance-request', {
        method: 'POST',
        credentials: 'include',
        headers: Object.assign({}, authHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.detail || data.message || res.statusText);

      var pending = data.pending_count_for_industry != null
        ? Number(data.pending_count_for_industry)
        : prev + 1;
      var rank = pending;

      try {
        sessionStorage.setItem(RANK_KEY, String(rank));
        sessionStorage.setItem(REQ_KEY, '1');
      } catch (_) {}

      if (data.appState && typeof W.syncAppState === 'function') {
        W.syncAppState(data.appState);
      } else if (data.appState && W.AppState && typeof W.AppState.patchState === 'function') {
        W.AppState.patchState(data.appState);
      }

      patchResonanceLocal({
        userRequested: true,
        userRank: rank,
        pendingRequestsForIndustry: pending,
      });

      if (!data.appState) {
        if (!W.AppState.metrics) W.AppState.metrics = {};
        W.AppState.metrics.resonanceCount = pending;
      }

      triggerLightUp();
      paintResonancePanel(state());
      if (typeof W.syncUpstreamFactorStrip === 'function') W.syncUpstreamFactorStrip(state());
      if (typeof W.showToast === 'function') {
        W.showToast('技术请求已记录 · 您已点亮行业共振信号');
      }
      if (typeof W.syncResonanceMaterialUi === 'function') {
        W.syncResonanceMaterialUi();
      }
    } catch (e) {
      try {
        sessionStorage.removeItem(RANK_KEY);
        sessionStorage.removeItem(REQ_KEY);
      } catch (_) {}
      patchResonanceLocal({
        userRequested: false,
        userRank: null,
        pendingRequestsForIndustry: prev,
      });
      if (W.AppState && W.AppState.metrics) W.AppState.metrics.resonanceCount = prev;
      if (typeof W.syncResonanceMaterialUi === 'function') W.syncResonanceMaterialUi();
      if (typeof W.showToast === 'function') {
        W.showToast('技术请求失败：' + ((e && e.message) || e), 'error');
      }
      if (btn) btn.disabled = false;
    } finally {
      paintResonancePanel(state());
    }
  };

  W.paintSupplyResonancePanel = paintResonancePanel;

  W.openSupplyResonance = function openSupplyResonance() {
    W.openResonancePanel();
  };

  function onStateSynced() {
    paintResonancePanel(state());
    if (typeof W.syncUpstreamFactorStrip === 'function') W.syncUpstreamFactorStrip(state());
    if (typeof W.syncResonanceMaterialUi === 'function') W.syncResonanceMaterialUi();
  }

  if (W.EventBus && typeof W.EventBus.on === 'function') {
    W.EventBus.on('STATE_SYNCED', onStateSynced);
    W.EventBus.on('STATE_COMMIT', onStateSynced);
  }
  W.addEventListener('hengai:resonance-updated', onStateSynced);

  document.addEventListener('DOMContentLoaded', function () {
    paintResonancePanel(state());
  });
})(window);
