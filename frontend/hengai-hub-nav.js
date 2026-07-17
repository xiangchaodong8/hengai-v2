/**
 * HengAI · 全域中心唯一入口（禁止 index 内嵌 overlay 套娃）
 * 真理页：全域中心.html + 子模块 iframe ?embed=1
 */
(function (W) {
  'use strict';
  if (W.__hengaiHubNav) return;
  W.__hengaiHubNav = true;

  var HUB_FILE = '全域中心.html';

  function hubBaseUrl() {
    try {
      return typeof W.hengaiPage === 'function'
        ? W.hengaiPage(HUB_FILE).split('#')[0]
        : new URL(HUB_FILE, W.location.href).href.split('#')[0];
    } catch (_) {
      return HUB_FILE;
    }
  }

  /** 跳转到唯一全域中心（可选 hash：supply / enterprise / calc / achieve …） */
  W.navigateToHub = function navigateToHub(pageId) {
    var url = hubBaseUrl();
    if (pageId) {
      var alias = { 'supply-chain': 'supply', 'enterprise-archive': 'enterprise' };
      var id = alias[pageId] || pageId;
      url += '#' + encodeURIComponent(id);
    }
    W.location.href = url;
  };

  /** 废弃 overlay：一律整页跳转，杜绝双壳套娃 */
  W.openHubOverlay = function openHubOverlay(pageId) {
    W.navigateToHub(pageId || null);
  };

  function hubParent() {
    try {
      if (W.parent && W.parent !== W) return W.parent;
    } catch (_) {}
    return null;
  }

  /**
   * 在全域中心内切换左栏模块（嵌入 iframe 内禁止 location.href 直跳子 HTML，否则会 hijack 当前卡槽）。
   * 例：供应链协同里点「从 CBAM 测算同步」→ 应切换父页 page-calc，而不是在 iframe 里打开测算工具。
   */
  function hubNavEl(doc, pageId) {
    if (!doc || !pageId) return null;
    return doc.getElementById('nav-' + pageId) || doc.getElementById('n-' + pageId);
  }

  /** CBAM 原厂引导 CTA → 工业原厂 · 因子核验（优先父页 navTo，禁止 iframe 内整页跳转） */
  W.gotoOriginAuditFromCbam = function gotoOriginAuditFromCbam() {
    if (navViaHubShell('origin-audit')) return;
    W.hengaiSwitchHubPage('origin-audit');
  };

  /** SME 拦截页 → CBAM 下游认领（原厂用户不应看到此页；若误入则去企业工作台） */
  W.gotoCbamFromOriginBlocker = function gotoCbamFromOriginBlocker() {
    if (typeof W.resolveUserRoleFromState === 'function'
        && W.resolveUserRoleFromState() === 'ROLE_ORIGIN') {
      if (typeof W.gotoOriginAuditFromCbam === 'function') {
        W.gotoOriginAuditFromCbam();
        return;
      }
      if (navViaHubShell('origin-audit')) return;
      W.hengaiSwitchHubPage('origin-audit');
      return;
    }
    if (navViaHubShell('calc')) return;
    W.hengaiSwitchHubPage('calc');
  };

  /** 解析承载全域中心壳的 window（iframe 内取 parent/top） */
  function hubShellWindow() {
    var candidates = [];
    try {
      if (W.parent && W.parent !== W) candidates.push(W.parent);
    } catch (_) {}
    try {
      if (W.top && W.top !== W) candidates.push(W.top);
    } catch (_) {}
    candidates.push(W);
    for (var i = 0; i < candidates.length; i++) {
      var win = candidates[i];
      try {
        var doc = win.document;
        if (doc && doc.getElementById('sidebar') && doc.getElementById('page-calc')) return win;
      } catch (_) {}
    }
    return null;
  }

  function navViaHubShell(pageId) {
    var shell = hubShellWindow();
    if (shell && shell !== W && typeof shell.navTo === 'function') {
      try {
        var nav = hubNavEl(shell.document, pageId);
        shell.navTo(pageId, nav);
        return true;
      } catch (_) {}
      try {
        shell.postMessage({ type: 'HENGAI_HUB_NAV', pageId: pageId }, '*');
        return true;
      } catch (_) {}
    }
    return false;
  }

  W.hengaiSwitchHubPage = function hengaiSwitchHubPage(pageId) {
    if (!pageId) return;
    var alias = { 'supply-chain': 'supply', 'enterprise-archive': 'enterprise' };
    var id = alias[pageId] || pageId;
    if (navViaHubShell(id)) return;
    // 已在全域中心壳内：就地切换卡槽，避免 location.href 同页 hash 无反应
    if (typeof W.navTo === 'function' && W.document.getElementById('page-' + id)) {
      try {
        var localNav = hubNavEl(W.document, id);
        W.navTo(id, localNav);
        return;
      } catch (_) {}
    }
    // 最后一道：整页跳转必须用 top，禁止污染 iframe 卡槽
    try {
      var topWin = W.top || W;
      if (topWin !== W && typeof W.navigateToHub === 'function') {
        topWin.location.href = hubBaseUrl() + (id ? '#' + encodeURIComponent(id) : '');
        return;
      }
    } catch (_) {}
    W.navigateToHub(id);
  };

  /** @deprecated index 旧壳别名；全域中心请用 hengaiSwitchHubPage */
  W.switchHubPage = W.hengaiSwitchHubPage;

  /** 从供应链协同进入「产业链主权共振 / 因子精算」，保留回程上下文 */
  W.openSupplyResonance = function openSupplyResonance() {
    if (typeof W.openResonancePanel === 'function') {
      W.openResonancePanel();
      return;
    }
    try { sessionStorage.setItem('hengai_resonance_from', 'supply'); } catch (_) {}
    var parent = hubParent();
    if (parent && typeof parent.navTo === 'function') {
      try {
        var nav = hubNavEl(parent.document, 'origin-audit');
        parent.navTo('origin-audit', nav);
        try {
          var panel = parent.document.getElementById('page-origin-audit');
          var frame = panel && panel.querySelector('iframe');
          if (frame && frame.contentWindow) {
            frame.contentWindow.postMessage({ type: 'HENGAI_RESONANCE_FROM_SUPPLY' }, '*');
          }
        } catch (_) {}
        return;
      } catch (_) {}
    }
    W.navigateToHub('origin-audit');
  };

  /** 因子精算战情室 · 返回供应链协同 */
  W.returnToSupplyFromResonance = function returnToSupplyFromResonance() {
    try { sessionStorage.removeItem('hengai_resonance_from'); } catch (_) {}
    var parent = hubParent();
    if (parent && typeof parent.navTo === 'function') {
      try {
        var nav = parent.document.getElementById('nav-supply');
        parent.navTo('supply', nav);
        return;
      } catch (_) {}
    }
    W.navigateToHub('supply');
  };

  W.closeHubOverlay = function closeHubOverlay() {
    var hub = document.getElementById('co2lion-hub-overlay');
    if (hub) {
      hub.style.display = 'none';
      hub.style.opacity = '0';
    }
    document.body.style.overflow = '';
    if (W.location.hash === '#hub') {
      try {
        history.replaceState(null, '', W.location.pathname + W.location.search);
      } catch (_) {}
    }
  };
})(window);
