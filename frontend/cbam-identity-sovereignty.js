/**
 * CBAM · 身份主权归位（访客预分流 / 原厂路由 / 下游认领拦截）
 * 全域中心 #H-pg-cbam 与 HengAI_CBAM测算工具.html 共用
 */
(function (global) {
  'use strict';

  var LS_GUEST_IDENTITY = 'hengai_cbam_guest_identity_v1';
  var ORIGIN_INDUSTRIES = {
    steel: 1, aluminum: 1, aluminium: 1, cement: 1,
    petro: 1, petrochem: 1, paper: 1, ceramic: 1, ceramics: 1,
    port: 1, idc: 1, datacenter: 1,
  };
  /** 避免每次 STATE 同步都 innerHTML 重建 f-product 导致用户选择被清空 */
  var _appliedCbamIdentityMode = null;
  var _appliedCbamUserRole = null;

  var BENCHMARK = {
    origin: {
      title: '工业原厂 · 出口敞口粗测 + 城池指挥',
      insight:
        '您选择的是<strong style="color:var(--gold-l)">上游原厂路径</strong>：本页仅做<strong>欧盟默认库粗测</strong>（产业链税损压力叙事）。' +
        '<strong>真实工序复盘、CL-GTCID 权证</strong>请前往<strong>产业链主权实证中心（精算芯）</strong>；' +
        '城池进度与共振大盘请见<strong>产业主权看板</strong>。Hub <strong>不算</strong>工序、<strong>不可</strong>在此 Pull。',
      productHint: '粗测基准：欧盟 CBAM 缺省因子 · 钢铁 ≈1.85 · 铝 ≈1.82 · 水泥 ≈0.93 tCO₂e/t（<strong>非生产实证</strong>，不可申报）',
    },
    sme: {
      title: '碳税风险核算 · 下游清算视角',
      insight:
        '您选择的是<strong style="color:var(--teal-l)">中下游配套商路径</strong>：测算「<strong>出口欧盟要交多少碳税</strong>」。' +
        '缺上游因子时使用默认库（含 1.35× 惩罚溢价）；仅当上游<strong>正式碳城池（certified）</strong>时可 Pull 官方因子。' +
        '上游软件实证中可见实名进度，<strong>不可 Pull</strong>。',
      productHint: 'Scope 3 上游常占出口敞口 60–75% · 正式 Pull 仅 certified · 达阈后可单独添置 CL-MAT',
    },
  };

  function el(id) {
    return document.getElementById(id);
  }

  function appState() {
    return global.AppState || {};
  }

  function isLoggedIn() {
    var s = appState();
    if (s.user && s.user.isLoggedIn === true) return true;
    if (typeof global.oracleIsLoggedIn === 'function') return global.oracleIsLoggedIn();
    return !!(typeof global.getToken === 'function' ? global.getToken() : null);
  }

  function userRole() {
    if (typeof global.resolveUserRoleFromState === 'function') {
      return global.resolveUserRoleFromState(appState());
    }
    return 'ROLE_GUEST';
  }

  function toast(msg) {
    if (typeof global.showToast === 'function') global.showToast(msg);
  }

  function calcRoot() {
    return el('H-pg-cbam') || document.querySelector('.cbam-inner');
  }

  function getGuestIdentity() {
    try {
      var v = localStorage.getItem(LS_GUEST_IDENTITY);
      return v === 'origin' || v === 'sme' ? v : null;
    } catch (_) {
      return null;
    }
  }

  function setGuestIdentity(mode) {
    try {
      localStorage.setItem(LS_GUEST_IDENTITY, mode);
    } catch (_) {}
    applyGuestIdentityMode(mode);
  }

  function showOriginDownstreamIntercept() {
    toast(
      '⚠️ 您当前身份为因子签发方（Origin）。如需核算采购碳足迹，请先切换至「非原厂模式」或注销后以访客身份选择「中下游配套商」。'
    );
  }

  function rebuildProductSelect(mode) {
    var sel = el('f-product');
    if (!sel) return;
    var prev = sel.value || '';
    var originOpts =
      '<option value="">请选择产品类别</option>' +
      '<option value="steel" data-factor="1.85">钢铁及钢铁制品（原厂）</option>' +
      '<option value="aluminum" data-factor="1.82">铝及铝制品（原厂）</option>' +
      '<option value="cement" data-factor="0.93">水泥及熟料（原厂）</option>' +
      '<option value="electricity" data-factor="0.45">电力（直供）</option>' +
      '<option value="hydrogen" data-factor="9.0">氢（绿氢/灰氢）</option>';
    var smeOpts =
      '<option value="">请选择出口产品类别</option>' +
      '<option value="automotive" data-factor="1.65">汽车及零部件</option>' +
      '<option value="machinery" data-factor="1.55">机械装备</option>' +
      '<option value="electronics" data-factor="1.42">电子电器</option>' +
      '<option value="steel" data-factor="1.85">钢铁及钢铁制品</option>' +
      '<option value="aluminum" data-factor="1.82">铝及铝制品</option>' +
      '<option value="fertilizer" data-factor="2.1">化肥</option>';
    sel.innerHTML = mode === 'origin' ? originOpts : smeOpts;
    if (prev) {
      var hasOpt = Array.prototype.some.call(sel.options, function (o) {
        return o.value === prev;
      });
      if (hasOpt) sel.value = prev;
    }
    var rough = global.HengAICbamRough;
    if (rough && typeof rough.rebuildMaterialOptionsForProduct === 'function') {
      try {
        rough.rebuildMaterialOptionsForProduct();
      } catch (_) {}
    }
  }

  function updateBenchmarkCopy(mode) {
    if (typeof global.shouldShowCbamFunnelChrome === 'function' &&
        !global.shouldShowCbamFunnelChrome()) {
      var hideCard = el('cbam-identity-benchmark');
      if (hideCard) hideCard.hidden = true;
      var hideProd = el('cbam-origin-production-banner');
      if (hideProd) hideProd.hidden = true;
      return;
    }
    var cfg = BENCHMARK[mode] || BENCHMARK.sme;
    var card = el('cbam-identity-benchmark');
    if (card) {
      card.hidden = false;
      var t = card.querySelector('[data-bench-title]');
      var p = card.querySelector('[data-bench-body]');
      if (t) t.textContent = cfg.title;
      if (p) p.innerHTML = cfg.productHint;
    }
    var ins = document.querySelector('#sec1 .insight.ins-teal div, #sec1 .insight div');
    if (ins) ins.innerHTML = cfg.insight;
    var tb = document.querySelector('.tb-title, #hg-page-title');
    if (tb && !isLoggedIn()) {
      tb.textContent = mode === 'origin' ? '工业原厂 · 敞口粗测与城池指挥' : 'CBAM 碳税测算工具';
    }
  }

  function setGateVisible(show) {
    var gate = el('cbam-guest-identity-gate');
    var root = calcRoot();
    if (gate) gate.hidden = !show;
    if (root) root.classList.toggle('cbam-gate-active', !!show);
  }

  function applyGuestIdentityMode(mode, opts) {
    opts = opts || {};
    if (!mode) mode = 'sme';
    var modeChanged = _appliedCbamIdentityMode !== mode;
    if (!modeChanged && !opts.force) {
      updateBenchmarkCopy(mode);
      return;
    }
    _appliedCbamIdentityMode = mode;
    setGateVisible(false);
    var smePanel = el('cbam-role-sme-panel');
    var originPanel = el('cbam-role-origin-panel');
    var scope3 = el('scope3-material-controls');
    var isOriginMode = mode === 'origin';

    if (smePanel) smePanel.hidden = isOriginMode;
    if (originPanel) originPanel.hidden = true;
    if (scope3) scope3.hidden = isOriginMode && !isLoggedIn();
    rebuildProductSelect(mode);
    updateBenchmarkCopy(mode);

    var prodBanner = el('cbam-origin-production-banner');
    if (prodBanner) {
      prodBanner.hidden = !(isOriginMode &&
        typeof global.shouldShowCbamFunnelChrome === 'function' &&
        global.shouldShowCbamFunnelChrome());
    }

    try {
      document.body.dataset.cbamGuestIdentity = mode;
    } catch (_) {}
  }

  function renderGuestIdentityGate() {
    if (isLoggedIn()) {
      setGateVisible(false);
      return;
    }
    if (getGuestIdentity()) {
      var gid = getGuestIdentity();
      if (_appliedCbamIdentityMode !== gid) {
        applyGuestIdentityMode(gid, { force: true });
      } else {
        setGateVisible(false);
        updateBenchmarkCopy(gid);
      }
      return;
    }
    setGateVisible(true);
    var gate = el('cbam-guest-identity-gate');
    if (!gate || gate.__bound) return;
    gate.__bound = true;
    gate.querySelectorAll('[data-cbam-identity]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var mode = btn.getAttribute('data-cbam-identity');
        if (mode !== 'origin' && mode !== 'sme') return;
        setGuestIdentity(mode);
      });
    });
  }

  function wireOriginDownstreamIntercept() {
    var ids = [
      'btn-origin-pull',
      'btn-verify-code',
      'btn-detect-origin-doc',
      'f-origin-search',
      'f-verification-code',
    ];
    ids.forEach(function (id) {
      var node = el(id);
      if (!node || node.__originInterceptBound) return;
      node.__originInterceptBound = true;
      var handler = function (ev) {
        if (userRole() !== 'ROLE_ORIGIN') return;
        ev.preventDefault();
        ev.stopPropagation();
        showOriginDownstreamIntercept();
      };
      node.addEventListener('click', handler, true);
      node.addEventListener('keydown', function (ev) {
        if (userRole() !== 'ROLE_ORIGIN') return;
        if (ev.key === 'Enter') handler(ev);
      }, true);
    });
  }

  function syncCbamSovereigntyUi(state) {
    var role = userRole();
    if (role === 'ROLE_ORIGIN') {
      setGateVisible(false);
      var smePanel = el('cbam-role-sme-panel');
      var originPanel = el('cbam-role-origin-panel');
      if (smePanel) smePanel.hidden = true;
      if (typeof global.syncCbamFunnelChrome === 'function') {
        global.syncCbamFunnelChrome(state || appState());
      } else if (originPanel) {
        originPanel.hidden = true;
      }
      _appliedCbamUserRole = role;
      if (_appliedCbamIdentityMode !== 'origin') {
        applyGuestIdentityMode('origin', { force: true });
      } else if (typeof global.shouldShowCbamFunnelChrome === 'function' &&
          global.shouldShowCbamFunnelChrome()) {
        updateBenchmarkCopy('origin');
      }
      return;
    }
    _appliedCbamUserRole = role;
    if (!isLoggedIn()) {
      renderGuestIdentityGate();
      return;
    }
    setGateVisible(false);
    var smePanelLogged = el('cbam-role-sme-panel');
    var originPanelLogged = el('cbam-role-origin-panel');
    if (smePanelLogged) smePanelLogged.hidden = false;
    if (originPanelLogged) originPanelLogged.hidden = true;
    if (typeof global.syncCbamFunnelChrome === 'function') {
      global.syncCbamFunnelChrome(state || appState());
    }
    if (_appliedCbamIdentityMode !== 'sme') {
      applyGuestIdentityMode('sme', { force: true });
    }
  }

  function boot() {
    wireOriginDownstreamIntercept();
    syncCbamSovereigntyUi();
    if (global.EventBus && typeof global.EventBus.on === 'function') {
      global.EventBus.on('STATE_SYNCED', syncCbamSovereigntyUi);
      global.EventBus.on('STATE_UPDATED', syncCbamSovereigntyUi);
    }
  }

  global.syncCbamSovereigntyUi = syncCbamSovereigntyUi;
  global.showOriginDownstreamIntercept = showOriginDownstreamIntercept;
  global.applyGuestIdentityMode = applyGuestIdentityMode;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
