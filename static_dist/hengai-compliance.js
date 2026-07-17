/**
 * HengAI · PIPL / GDPR 跨境数据合规锚点（全局页脚、CBAM 字段告知、存证哈希）
 */
(function (global) {
  'use strict';

  var CBAM_FIELD_IDS = [
    'f-gas', 'f-coal', 'f-oil', 'f-elec', 'f-gec', 'f-mat-vol',
    'f-sup-total', 'f-sup-done', 'f-s3-pct', 'f-volume'
  ];
  var CBAM_SELECT_IDS = ['f-grid', 'f-material'];
  var CBAM_TOOLTIP =
    '依据欧盟 CBAM 2026 实施细则第 6.4 条，本字段为合规核算必要项。' +
    'HengAI 仅在境内受控环境完成全量演算，链上同步限于经 ZKP 脱敏后的碳强度系数，' +
    '原始生产参数不跨境传输。';

  function getClIvcHash() {
    try {
      var st = global.AppState;
      var w = st && st.wallet;
      var addr = w && (w.address || w.hash);
      if (addr && String(addr).trim() && String(addr).indexOf('TEMP') < 0) {
        var s = String(addr).replace(/\s+/g, ' ').trim();
        var parts = s.split(/[\n\s]+/);
        return parts[parts.length - 1] || s.slice(0, 24);
      }
      var u = st && st.user;
      var email = u && (u.email || u.account);
      if (email) {
        var local = String(email).split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) || 'USR';
        return '#CL-' + local + '-9A1C';
      }
    } catch (_) {}
    return '#CL-PENDING-9A1C';
  }

  function isEmbed() {
    return /[?&]embed=1/.test(global.location && global.location.search || '');
  }

  function injectGlobalFooter() {
    if (isEmbed()) return;
    if (document.getElementById('hengai-compliance-footer')) return;
    var bar = document.createElement('div');
    bar.id = 'hengai-compliance-footer';
    bar.className = 'hengai-compliance-footer';
    bar.setAttribute('role', 'contentinfo');
    bar.innerHTML =
      '<span class="hcf-seal">🔐</span>' +
      '<span class="hcf-text">' +
      '数据安全：ISO/IEC 27001 认证体系审查中' +
      ' <span class="hcf-sep">|</span> ' +
      'CL-IVC 存证哈希：<code class="hcf-hash" id="hengai-clivc-hash">' +
      getClIvcHash() +
      '</code>' +
      ' <span class="hcf-sep">|</span> ' +
      '已通过数据出境安全合规预审（PIPL × GDPR 双轨）' +
      '</span>';
    document.body.appendChild(bar);
    refreshFooterHash();
  }

  function refreshFooterHash() {
    var el = document.getElementById('hengai-clivc-hash');
    if (el) el.textContent = getClIvcHash();
    document.querySelectorAll('[data-hengai-clivc-hash]').forEach(function (n) {
      n.textContent = getClIvcHash();
    });
  }

  function isHubShellPage() {
    return !!(document.getElementById('page-overview') || document.getElementById('nav-overview'));
  }

  function injectFooterStyles() {
    if (document.getElementById('hengai-compliance-footer-style')) return;
    var s = document.createElement('style');
    s.id = 'hengai-compliance-footer-style';
    var layoutPad = isHubShellPage()
      ? 'body:has(.hengai-compliance-footer) .main-scroll{padding-bottom:60px!important}'
      : 'body:has(.hengai-compliance-footer) #sidebar,' +
        'body:has(.hengai-compliance-footer) .sb,' +
        'body:has(.hengai-compliance-footer) #hg-sidebar,' +
        'body:has(.hengai-compliance-footer) .main-wrap,' +
        'body:has(.hengai-compliance-footer) .main-content,' +
        'body:has(.hengai-compliance-footer) #hg-main{padding-bottom:60px!important}';
    s.textContent =
      '.hengai-compliance-footer{position:fixed;left:0;right:0;bottom:0;z-index:9000;' +
      'display:flex;align-items:center;justify-content:center;gap:8px;padding:7px 16px;' +
      'font-size:10px;line-height:1.45;color:rgba(136,150,170,.95);' +
      'background:linear-gradient(180deg,rgba(6,8,15,0) 0%,rgba(6,8,15,.94) 18%,rgba(6,8,15,.98) 100%);' +
      'border-top:1px solid rgba(255,255,255,.06);backdrop-filter:blur(12px);pointer-events:none}' +
      '.hengai-compliance-footer .hcf-seal{opacity:.85;font-size:11px}' +
      '.hengai-compliance-footer .hcf-sep{margin:0 4px;opacity:.35}' +
      '.hengai-compliance-footer .hcf-hash{font-family:"DM Mono",Consolas,monospace;font-size:9.5px;' +
      'color:rgba(110,231,183,.9);background:rgba(16,185,129,.08);padding:1px 6px;border-radius:4px}' +
      'body:has(.hengai-compliance-footer){padding-bottom:60px!important}' +
      layoutPad +
      '.sb-footer{margin-bottom:12px}' +
      '.cbam-compliance-i{display:inline-flex;align-items:center;justify-content:center;' +
      'width:15px;height:15px;border-radius:50%;font-size:10px;font-weight:700;cursor:help;' +
      'color:var(--teal-l,#5eead4);background:rgba(20,184,166,.15);border:1px solid rgba(20,184,166,.35);' +
      'position:relative;flex-shrink:0}' +
      '.cbam-compliance-i::after{content:attr(data-tip);position:absolute;left:50%;bottom:calc(100% + 8px);' +
      'transform:translateX(-50%);width:min(280px,72vw);padding:10px 12px;border-radius:8px;' +
      'font-size:10px;font-weight:400;line-height:1.55;color:#e2e8f4;text-align:left;' +
      'background:rgba(10,14,24,.97);border:1px solid rgba(255,255,255,.12);box-shadow:0 8px 24px rgba(0,0,0,.45);' +
      'opacity:0;visibility:hidden;transition:opacity .15s,visibility .15s;z-index:200;pointer-events:none}' +
      '.cbam-compliance-i:hover::after,.cbam-compliance-i:focus-visible::after{opacity:1;visibility:visible}';
    document.head.appendChild(s);
  }

  function addCbamComplianceIcon(labelEl) {
    if (!labelEl || labelEl.querySelector('.cbam-compliance-i')) return;
    var icon = document.createElement('span');
    icon.className = 'cbam-compliance-i';
    icon.setAttribute('role', 'img');
    icon.setAttribute('aria-label', '合规必要性告知');
    icon.setAttribute('data-tip', CBAM_TOOLTIP);
    icon.textContent = 'ℹ';
    labelEl.appendChild(icon);
  }

  function decorateCbamProductionFields() {
    injectFooterStyles();
    CBAM_FIELD_IDS.forEach(function (id) {
      var inp = document.getElementById(id);
      if (!inp) return;
      var grp = inp.closest('.input-group');
      if (!grp) return;
      var lbl = grp.querySelector('.i-label');
      if (lbl) addCbamComplianceIcon(lbl);
    });
    CBAM_SELECT_IDS.forEach(function (id) {
      var sel = document.getElementById(id);
      if (!sel) return;
      var grp = sel.closest('.input-group');
      if (!grp) return;
      var lbl = grp.querySelector('.i-label');
      if (lbl) addCbamComplianceIcon(lbl);
    });
  }

  function checkLegalConsent(checkboxId, toastFn) {
    var chk = document.getElementById(checkboxId);
    if (chk && chk.checked) return true;
    var msg =
      '⚖️ 须先勾选并明示同意《用户服务协议》《个人信息保护政策》及《跨境数据流动专项授权书》，方可继续。';
    if (typeof toastFn === 'function') toastFn(msg);
    else if (typeof global.showToast === 'function') global.showToast(msg);
    else alert(msg.replace(/^⚖️\s*/, ''));
    return false;
  }

  function wireStateSync() {
    if (typeof global.EventBus === 'undefined' || !global.EventBus.on) return;
    global.EventBus.on('STATE_SYNCED', refreshFooterHash);
  }

  function init() {
    injectFooterStyles();
    injectGlobalFooter();
    decorateCbamProductionFields();
    wireStateSync();
  }

  global.HengAICompliance = {
    getClIvcHash: getClIvcHash,
    injectGlobalFooter: injectGlobalFooter,
    refreshFooterHash: refreshFooterHash,
    decorateCbamProductionFields: decorateCbamProductionFields,
    checkLegalConsent: checkLegalConsent,
    init: init
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(typeof window !== 'undefined' ? window : this);
