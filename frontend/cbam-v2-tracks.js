/**
 * CBAM P1 · 双轨 UI（SME 测算 + 原厂指挥台）· 城池态 / Pull 门禁 / 精算芯占位深链
 * 全域中心 #H-pg-cbam 与 HengAI_CBAM测算工具.html 共用
 */
(function (global) {
  'use strict';

  function el(id) {
    return document.getElementById(id);
  }

  function appState() {
    return global.AppState || {};
  }

  function toast(msg) {
    if (typeof global.showToast === 'function') global.showToast(msg);
  }

  function cbamFunnelUiEnabled() {
    return global.HENGAI_CBAM_FUNNEL_UI_ENABLED === true;
  }

  function getCbamCurrentStep() {
    if (typeof global.currentStep === 'number' && global.currentStep >= 1) return global.currentStep;
    var cb = appState().cbam;
    if (cb && cb.step) return Number(cb.step) || 1;
    return 1;
  }

  function cbamCalcHasResult() {
    return !!(global.calcResult || global.cbamCalcResult ||
      (appState().cbam && appState().cbam.calcResult));
  }

  /** ③ 阶段广告牌：仅开关 ON 且 Step4/有结果后才可展示 */
  function shouldShowCbamFunnelChrome() {
    if (!cbamFunnelUiEnabled()) return false;
    return getCbamCurrentStep() >= 4 || cbamCalcHasResult();
  }

  var CBAM_STEP1_INSIGHT_OK =
    '这是一份 <strong style="color:var(--teal-l)">粗测工具</strong>——约 5 分钟，用出口量与账单即可估算欧盟碳税敞口，无需碳核算专业知识。先看清数字，再决定是否建档、补强供应链数据。';

  function captureStep1InsightDefault() {
    if (!global.__cbamStep1InsightDefault) {
      global.__cbamStep1InsightDefault = CBAM_STEP1_INSIGHT_OK;
    }
  }

  function hideCbamFunnelChrome() {
    var banner = el('origin-penalty-banner');
    if (banner) {
      banner.hidden = true;
      banner.innerHTML = '';
    }
    var bench = el('cbam-identity-benchmark');
    if (bench) bench.hidden = true;
    var prod = el('cbam-origin-production-banner');
    if (prod) prod.hidden = true;
    var originPanel = el('cbam-role-origin-panel');
    if (originPanel) originPanel.hidden = true;
    var deck = el('cbam-origin-city-deck');
    if (deck) deck.innerHTML = '';
    hideUpstreamEvidenceCard();
    captureStep1InsightDefault();
    var ins = document.querySelector('#sec1 .insight.ins-teal div, #sec1 .insight div');
    if (ins) ins.innerHTML = global.__cbamStep1InsightDefault || CBAM_STEP1_INSIGHT_OK;
  }

  function syncCbamFunnelChrome(state) {
    captureStep1InsightDefault();
    if (!shouldShowCbamFunnelChrome()) {
      hideCbamFunnelChrome();
      var cr =
        global.calcResult ||
        global.cbamCalcResult ||
        (state && state.cbam && state.cbam.calcResult);
      if (cr && typeof global.updateCbamDefaultFactorWarning === 'function') {
        global.updateCbamDefaultFactorWarning(cr);
      }
      return;
    }
    var role = typeof global.resolveUserRoleFromState === 'function'
      ? global.resolveUserRoleFromState(state || appState())
      : 'ROLE_GUEST';
    if (role === 'ROLE_ORIGIN') renderOriginCommandDeck(state);
  }

  function handleGateUpsell(id) {
    if (!id) return;
    if (id === 'login') {
      if (typeof global.showAuth === 'function') {
        global.showAuth('login');
        return;
      }
      toast('请先登录；可在首页或右上角完成注册。');
      return;
    }
    if (id === 'pro') {
      toast('个人专业版 ¥99：解锁保存报告、深度测算步骤与 GM 激励（支付流程接入中）。');
      return;
    }
    if (id === 'enterprise-profile') {
      if (typeof global.hengaiSwitchHubPage === 'function') {
        global.hengaiSwitchHubPage('enterprise');
        return;
      }
      if (typeof global.navigateToHub === 'function') {
        global.navigateToHub('enterprise');
        return;
      }
      try {
        if (global.parent !== global && typeof global.parent.navTo === 'function') {
          global.parent.navTo('enterprise', global.parent.document.getElementById('nav-enterprise'));
          return;
        }
      } catch (_) {}
      global.location.href = '/static/全域中心.html#enterprise';
      return;
    }
    if (id === 'enterprise') {
      toast('企业官方金库 ¥29800：MAT 物理网关 + 申报级协同（商务接入中，请联系合规顾问）。');
    }
  }

  function renderTierRoleStrip() {
    var strip = el('cbam-tier-role-strip');
    if (strip) {
      strip.hidden = true;
      strip.innerHTML = '';
      strip.className = 'cbam-tier-role-strip';
    }
  }

  function goSovereigntyCenter() {
    toast('精算芯模块筹备中 · 并网回灌接口 Phase 2 接入（暂无需本地 :8001）');
  }

  function goOriginAudit() {
    if (typeof global.goToOriginAuditPage === 'function') {
      global.goToOriginAuditPage();
      return;
    }
    if (typeof global.hengaiSwitchHubPage === 'function') {
      global.hengaiSwitchHubPage('origin-audit');
      return;
    }
    if (typeof global.navigateToHub === 'function') {
      global.navigateToHub('origin-audit');
      return;
    }
    try {
      if (global.parent !== global && typeof global.parent.navTo === 'function') {
        var nav = global.parent.document.getElementById('nav-origin-audit') ||
          global.parent.document.getElementById('n-origin-audit');
        global.parent.navTo('origin-audit', nav);
        return;
      }
    } catch (_) {}
    global.location.href = '/static/全域中心.html#origin-audit';
  }

  function goSupplyChain() {
    if (typeof global.hengaiSwitchHubPage === 'function') {
      global.hengaiSwitchHubPage('supply');
      return;
    }
    if (typeof global.navigateToHub === 'function') {
      global.navigateToHub('supply');
      return;
    }
    try {
      if (global.parent !== global && typeof global.parent.navTo === 'function') {
        global.parent.navTo('supply', global.parent.document.getElementById('nav-supply'));
        return;
      }
    } catch (_) {}
    global.location.href = '/static/全域中心.html#supply';
  }

  function renderOriginCommandDeck(state) {
    var deck = el('cbam-origin-city-deck');
    var originPanel = el('cbam-role-origin-panel');
    if (!shouldShowCbamFunnelChrome()) {
      if (originPanel) originPanel.hidden = true;
      if (deck) deck.innerHTML = '';
      return;
    }
    if (!deck) return;
    var s = state || appState();
    var co = s.company || {};
    var fa = s.factorAuth || {};
    var cs = (typeof global.getCompanyCityState === 'function'
      ? global.getCompanyCityState(s)
      : fa.cityState || co.cityState) || 'none';
    var label = typeof global.cityStateLabel === 'function'
      ? global.cityStateLabel(cs)
      : cs;
    var holder = co.name || fa.holder || '贵司';
    var cert = fa.certificateId || co.verifiedFactorCertId || '—';
    var ci = fa.confirmedFactor != null ? fa.confirmedFactor
      : (co.displayCarbonIntensity != null ? co.displayCarbonIntensity : null);
    var ciTxt = ci != null && Number.isFinite(Number(ci)) ? Number(ci).toFixed(2) + ' tCO₂e/t' : '待精算芯产出';

    var statusHtml;
    if (cs === 'certified') {
      statusHtml =
        '<div class="cbam-city-badge cbam-city-certified">🛡️ 正式碳城池 · 下游可 Pull</div>' +
        '<p>权证 <code>' + cert + '</code> · 强度 ' + ciTxt + '</p>';
    } else if (cs === 'mat_pending') {
      statusHtml =
        '<div class="cbam-city-badge cbam-city-mat">✅ CL-MAT 网关在线 · 城池筹建中</div>' +
        '<p>数据已捕获，封签完成后下游可 Pull 官方因子。</p>';
    } else if (cs === 'evidence_building') {
      statusHtml =
        '<div class="cbam-city-badge cbam-city-evidence">🟡 软件实证中 · 未 hardware 封签</div>' +
        '<p>权证 <code>' + cert + '</code> · 强度 ' + ciTxt +
        '<br><em>请勿急，我们已在实证中。</em> 待魔盒封签后开放 Pull。</p>';
    } else {
      statusHtml =
        '<div class="cbam-city-badge cbam-city-none">尚未启动 CL-GTCID 实证</div>' +
        '<p>CL-GTCID 权证是下游「请勿急，我们已开始」的唯一可信信号。Hub 粗测不能替代生产实证。</p>';
    }

    deck.innerHTML =
      '<div style="font-size:13px;font-weight:700;color:var(--gold-l);margin-bottom:8px">🏭 ' + holder + ' · 城池指挥台</div>' +
      statusHtml +
      '<p class="cbam-origin-rough-note">下方表单仍为<strong>欧盟默认库粗测</strong>，仅供产业链税损压力叙事，非工序实证。</p>' +
      '<div class="cbam-origin-cta-row">' +
      '<button type="button" class="calc-btn cbam-cta-primary" id="btn-cbam-goto-sovereignty">前往产业链主权实证中心 →</button>' +
      '<button type="button" class="calc-btn cbam-cta-secondary" id="btn-cbam-goto-origin-audit-deck">产业主权看板 · 共振大盘</button>' +
      '</div>';

    var sov = el('btn-cbam-goto-sovereignty');
    var audit = el('btn-cbam-goto-origin-audit-deck');
    if (sov) sov.addEventListener('click', goSovereigntyCenter);
    if (audit) audit.addEventListener('click', goOriginAudit);
    if (originPanel) originPanel.hidden = false;
  }

  function updateSmeDeficitBanner(hasVerified) {
    var banner = el('origin-penalty-banner');
    if (!banner) return;
    var role = typeof global.resolveUserRoleFromState === 'function'
      ? global.resolveUserRoleFromState(appState())
      : 'ROLE_GUEST';
    if (!shouldShowCbamFunnelChrome() || role === 'ROLE_ORIGIN') {
      banner.hidden = true;
      banner.innerHTML = '';
      return;
    }
    if (hasVerified) {
      banner.hidden = true;
      return;
    }
    banner.hidden = false;
    banner.innerHTML =
      '⚠️ 当前使用<strong>欧盟默认因子库</strong>，CBAM 申报存在最高 <strong>35%</strong> 不确定性溢价。' +
      '可向已绑定上游发起<strong>共振</strong>；达阈后，<strong>您作为供应商</strong>可在 <strong>供应链协同</strong> 单独、自愿为原厂<strong>添置 CL-MAT 终端</strong>（标准 B2B 购销，非资金归集）。' +
      ' <em>缺省粗测不可用于正式申报。</em>';
  }

  function hideUpstreamEvidenceCard() {
    var card = el('cbam-upstream-evidence-card');
    if (card) {
      card.hidden = true;
      card.innerHTML = '';
    }
  }

  function showUpstreamEvidenceCard(entry) {
    if (!entry || entry.cityState === 'certified') return false;
    var card = el('cbam-upstream-evidence-card');
    if (!card) {
      card = document.createElement('div');
      card.id = 'cbam-upstream-evidence-card';
      card.className = 'cbam-upstream-evidence-card';
      var anchor = el('origin-verified-badge') || el('cbam-role-sme-panel');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor.nextSibling);
    }
    var holder = entry.holder || '上游原厂';
    var cert = entry.certificateId || '—';
    var ci = entry.carbonIntensity != null ? Number(entry.carbonIntensity).toFixed(2) : '—';
    var stLabel = typeof global.cityStateLabel === 'function'
      ? global.cityStateLabel(entry.cityState)
      : (entry.cityState || '实证中');
    card.hidden = false;
    card.innerHTML =
      '<div class="cbam-evidence-head">🟡 上游实名 · ' + stLabel + '</div>' +
      '<div><strong>' + holder + '</strong></div>' +
      '<div>权证 <code>' + cert + '</code> · 强度 ' + ci + ' tCO₂e/t（软件实证 · 未 hardware 封签）</div>' +
      '<p class="cbam-evidence-msg">请勿急，我们已在实证中。待魔盒 hardware 封签后，您可在此 Pull 官方因子。</p>' +
      '<button type="button" class="calc-btn cbam-cta-secondary" id="btn-cbam-evidence-goto-supply" style="width:auto;padding:8px 14px;font-size:12px;margin-top:8px">供应链协同 · 共振 / CL-MAT →</button>';
    var btn = el('btn-cbam-evidence-goto-supply');
    if (btn) btn.addEventListener('click', goSupplyChain);
    toast('上游处于软件实证中，暂不可 Pull；已展示实名进度卡片');
    return true;
  }

  function tryShowIndustryBoardMatch(query) {
    if (typeof global.findIndustryBoardEntry !== 'function') return false;
    var row = global.findIndustryBoardEntry(query, appState());
    if (!row || row.cityState === 'certified') return false;
    if (row.pullEligible) return false;
    return showUpstreamEvidenceCard(row);
  }

  function cbamApiBase() {
    if (typeof global.hengaiApiOrigin === 'function') return global.hengaiApiOrigin();
    return (global.API_BASE || '').replace(/\/+$/, '');
  }

  function cbamAuthHeaders() {
    var t = typeof global.getToken === 'function'
      ? global.getToken()
      : localStorage.getItem('hengai_token') || localStorage.getItem('authToken') || '';
    return t ? { Authorization: 'Bearer ' + t, Accept: 'application/json' } : { Accept: 'application/json' };
  }

  function inferMaterialIndustryCode() {
    var matSel = el('f-material');
    var matOpt = matSel && matSel.options[matSel.selectedIndex] ? matSel.options[matSel.selectedIndex] : null;
    var optIndustry = matOpt && matOpt.getAttribute('data-industry');
    if (optIndustry) return String(optIndustry).toLowerCase();
    var product = (el('f-product') || {}).value || '';
    var productMap = {
      steel: 'steel',
      aluminum: 'aluminum',
      cement: 'cement',
      fertilizer: 'fertilizer',
      automotive: 'steel',
      machinery: 'steel',
      electronics: 'aluminum',
    };
    if (productMap[product]) return productMap[product];
    var co = appState().company || {};
    if (co.industryCode) return String(co.industryCode).toLowerCase();
    return 'steel';
  }

  async function submitResonanceRequest() {
    if (typeof global.notifyCbamCommercialBlock === 'function' &&
        global.notifyCbamCommercialBlock('resonance')) {
      return;
    }
    var btn = el('btn-resonance-request');
    var resonanceState = appState().resonance;
    var already = !!(resonanceState && resonanceState.userRequested);
    try {
      if (!already && sessionStorage.getItem('hengai_user_resonance_requested') === '1') already = true;
    } catch (_) {}
    if (already) return;
    if (btn) { btn.disabled = true; btn.textContent = '信号发送中…'; }
    var prev = (appState().metrics && appState().metrics.resonanceCount) || 0;
    if (typeof global.bumpResonanceOptimistic === 'function') global.bumpResonanceOptimistic(prev);
    try {
      var body = {
        industryCode: inferMaterialIndustryCode(),
        originQuery: ((el('f-origin-search') || {}).value || '').trim() || undefined,
        productCategory: 'scope3_upstream_material',
        materialFactor: typeof global.getMaterialFactor === 'function' ? global.getMaterialFactor() : undefined,
      };
      var resp = await fetch(cbamApiBase() + '/api/v1/eco/resonance-request', {
        method: 'POST',
        credentials: 'include',
        headers: Object.assign({}, cbamAuthHeaders(), { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
      var data = await resp.json().catch(function () { return {}; });
      if (!resp.ok) throw new Error(data.detail || data.message || resp.statusText);
      if (data.appState && typeof global.syncAppState === 'function') global.syncAppState(data.appState);
      if (typeof global.emitAppStateEvent === 'function') {
        global.emitAppStateEvent('FACTOR_REQUEST_SENT', {
          industry: body.industryCode,
          companyName: (appState().company && appState().company.name) || '未知企业',
          taxRisk: Number(appState().metrics && appState().metrics.riskExposureEur) || 0,
          region: (appState().company && (appState().company.region || appState().company.regionTag)) || '未知',
        });
      } else if (global.EventBus && typeof global.EventBus.emit === 'function') {
        global.EventBus.emit('FACTOR_REQUEST_SENT', {
          industry: body.industryCode,
          companyName: (appState().company && appState().company.name) || '未知企业',
          taxRisk: Number(appState().metrics && appState().metrics.riskExposureEur) || 0,
          region: (appState().company && (appState().company.region || appState().company.regionTag)) || '未知',
        });
      }
      try { sessionStorage.setItem('hengai_user_resonance_requested', '1'); } catch (_) {}
      toast('已向产业链发送共振信号。达阈后，您可单独自愿在供应链协同中为上游添置 CL-MAT 终端。');
      if (typeof global.syncResonanceMaterialUi === 'function') global.syncResonanceMaterialUi();
    } catch (e) {
      toast('共振请求失败：' + ((e && e.message) || e));
      if (typeof global.syncResonanceMaterialUi === 'function') global.syncResonanceMaterialUi();
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '🛰️ 向工业原厂发起因子请求 →';
      }
    }
  }

  function patchResonanceMaterialUi() {
    var orig = global.syncResonanceMaterialUi;
    global.syncResonanceMaterialUi = function () {
      if (typeof orig === 'function') orig();
      var vm = typeof global.getCbamVerifiedPoolMatch === 'function'
        ? global.getCbamVerifiedPoolMatch()
        : null;
      var hasVerified = !!(vm && vm.certId);
      updateSmeDeficitBanner(hasVerified);
      var hOrigin = el('h-origin');
      if (hOrigin) {
        hOrigin.textContent =
          '仅当上游达到「正式碳城池（certified）」时，Pull 才可替代欧盟默认因子。' +
          '软件实证中仅展示实名进度，不可 Pull。';
      }
    };
  }

  function syncCbamV2Tracks(state) {
    renderTierRoleStrip();
    syncCbamFunnelChrome(state);
    if (typeof global.syncResonanceMaterialUi === 'function') global.syncResonanceMaterialUi();
  }

  function wireStaticControls() {
    var reqBtn = el('btn-resonance-request');
    if (reqBtn && !reqBtn.__v2Bound) {
      reqBtn.__v2Bound = true;
      reqBtn.addEventListener('click', submitResonanceRequest);
    }
    var legacyAudit = el('btn-cbam-goto-origin-audit');
    if (legacyAudit && !legacyAudit.__v2Bound) {
      legacyAudit.__v2Bound = true;
      legacyAudit.addEventListener('click', goOriginAudit);
    }
  }

  function boot() {
    captureStep1InsightDefault();
    patchResonanceMaterialUi();
    wireStaticControls();
    hideCbamFunnelChrome();
    syncCbamV2Tracks();
    if (global.EventBus && typeof global.EventBus.on === 'function') {
      global.EventBus.on('STATE_SYNCED', syncCbamV2Tracks);
      global.EventBus.on('STATE_UPDATED', syncCbamV2Tracks);
    }
  }

  global.renderOriginCommandDeck = renderOriginCommandDeck;
  global.showUpstreamEvidenceCard = showUpstreamEvidenceCard;
  global.hideUpstreamEvidenceCard = hideUpstreamEvidenceCard;
  global.tryShowIndustryBoardMatch = tryShowIndustryBoardMatch;
  global.goSovereigntyCenter = goSovereigntyCenter;
  global.syncCbamV2Tracks = syncCbamV2Tracks;
  global.syncCbamFunnelChrome = syncCbamFunnelChrome;
  global.shouldShowCbamFunnelChrome = shouldShowCbamFunnelChrome;
  global.cbamFunnelUiEnabled = cbamFunnelUiEnabled;
  global.handleCbamGateUpsell = handleGateUpsell;
  if (!global.submitResonanceRequest) global.submitResonanceRequest = submitResonanceRequest;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
