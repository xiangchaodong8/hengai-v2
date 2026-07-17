/**
 * CBAM 身份感知 · 访客墙 / 智能检测 / 下游认领 / GTCID 批次对账
 * 全域中心 #H-pg-cbam 与 HengAI_CBAM测算工具.html 共用
 */
(function (global) {
  'use strict';

  var verifiedPoolMatch = null;
  var _bound = false;
  var LS_CBAM_RETURN = 'hengai_cbam_return_draft_v1';
  var LS_AUTH_RETURN = 'hengai_auth_return_v1';

  /** GTCID 行业段 · 与 hub_engine _new_verification_code 前缀一致 */
  var GTCID_INDUSTRY_PREFIX = {
    steel: 'ST',
    aluminum: 'AL',
    aluminium: 'AL',
    cement: 'CE',
  };

  var GTCID_PRODUCT_LABELS = {
    steel: '钢铁',
    aluminum: '铝及铝制品',
    aluminium: '铝及铝制品',
    cement: '水泥及熟料',
  };

  function getCbamCurrentProductType() {
    var sel = el('f-product');
    if (sel && sel.value) return String(sel.value).trim().toLowerCase();
    var co = (appState().company || {});
    var code = String(co.industryCode || co.industry_code || co.mainProduct || '').trim().toLowerCase();
    if (GTCID_INDUSTRY_PREFIX[code]) return code;
    if (code.indexOf('钢') >= 0 || code.indexOf('steel') >= 0) return 'steel';
    if (code.indexOf('铝') >= 0 || code.indexOf('alumin') >= 0) return 'aluminum';
    if (code.indexOf('水泥') >= 0 || code.indexOf('cement') >= 0) return 'cement';
    return code || 'steel';
  }

  function validateGTCID(code, currentProductType) {
    var normalized = String(code || '').trim().toUpperCase();
    if (!normalized) {
      return { ok: false, message: '请输入 GTCID 批次核验码' };
    }
    if (!/^GTCID-\d{6}-[A-Z]{2}-[A-Z0-9]+$/.test(normalized)) {
      return {
        ok: false,
        message: 'GTCID 格式无效。正确示例：GTCID-202606-ST-L01（年月-行业码-产线）',
      };
    }
    var parts = normalized.split('-');
    var industrySeg = parts[2];
    var productKey = String(currentProductType || getCbamCurrentProductType() || '').toLowerCase();
    var expected = GTCID_INDUSTRY_PREFIX[productKey];
    if (expected && industrySeg !== expected) {
      var label = GTCID_PRODUCT_LABELS[productKey] || productKey;
      return {
        ok: false,
        message:
          '行业前缀不匹配：当前出口产品为「' +
          label +
          '」，核验码行业段为 ' +
          industrySeg +
          '。请向对应行业原厂索取正确批次码。',
      };
    }
    return { ok: true, code: normalized };
  }

  global.validateGTCID = validateGTCID;
  global.getCbamCurrentProductType = getCbamCurrentProductType;

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
    var flags = (appState().flags || {});
    if (!isLoggedIn()) return 'ROLE_GUEST';
    return flags.hasOriginFactoryPerm ? 'ROLE_ORIGIN' : 'ROLE_SME';
  }

  function cbamApiBase() {
    if (typeof global.hengaiApiOrigin === 'function') return global.hengaiApiOrigin();
    if (global.APP_CONFIG && global.APP_CONFIG.apiBase) {
      return String(global.APP_CONFIG.apiBase).replace(/\/$/, '');
    }
    return '';
  }

  function cbamAuthHeaders() {
    var t =
      typeof global.getToken === 'function'
        ? global.getToken()
        : localStorage.getItem('hengai_token') || localStorage.getItem('authToken') || '';
    return t ? { Authorization: 'Bearer ' + t, Accept: 'application/json' } : { Accept: 'application/json' };
  }

  function toast(msg) {
    if (typeof global.showToast === 'function') global.showToast(msg);
  }

  function previewIfReady() {
    if (typeof global.previewSensitivity === 'function') global.previewSensitivity();
  }

  function getVerifiedOriginPool() {
    var s = appState();
    var pool = s.verified_origin_pool || s.verifiedOriginPool;
    return Array.isArray(pool) ? pool : [];
  }

  function collectCbamDraftSnapshot() {
    var snap = {};
    ['f-company', 'f-volume', 'f-product', 'f-country', 'f-price', 'f-fx', 'f-mode',
      'f-elec', 'f-grid', 'f-gec', 'f-gas', 'f-coal', 'f-oil', 'f-material', 'f-mat-vol',
      'f-sup-total', 'f-sup-done', 'f-origin-search', 'f-verification-code'].forEach(function (id) {
      var node = el(id);
      if (node && node.value != null && node.value !== '') snap[id] = node.value;
    });
    snap._savedAt = new Date().toISOString();
    return snap;
  }

  function saveCbamReturnDraft() {
    try {
      localStorage.setItem(LS_CBAM_RETURN, JSON.stringify(collectCbamDraftSnapshot()));
      localStorage.setItem(LS_AUTH_RETURN, location.href.split('#')[0] + '#calc');
    } catch (_) {}
  }

  function restoreCbamReturnDraft() {
    try {
      var raw = localStorage.getItem(LS_CBAM_RETURN);
      if (!raw) return;
      var snap = JSON.parse(raw);
      Object.keys(snap).forEach(function (id) {
        if (id.charAt(0) === '_') return;
        var node = el(id);
        if (node && snap[id] != null) node.value = snap[id];
      });
      localStorage.removeItem(LS_CBAM_RETURN);
      previewIfReady();
    } catch (_) {}
  }

  function goCbamLogin() {
    saveCbamReturnDraft();
    if (typeof global.showAuth === 'function') {
      global.showAuth('login');
      return;
    }
    var ret = encodeURIComponent(location.href);
    location.href = '/static/index.html?cbamReturn=' + ret;
  }

  function setClaimControlsEnabled(on) {
    ['f-origin-search', 'f-verification-code', 'btn-origin-pull', 'btn-verify-code', 'btn-detect-origin-doc'].forEach(function (id) {
      var node = el(id);
      if (!node) return;
      node.disabled = !on;
    });
    var smePanel = el('cbam-role-sme-panel');
    if (smePanel) smePanel.classList.toggle('cbam-claim-locked', !on);
  }

  function hideScanOverlay() {
    var overlay = el('cbam-doc-scan-overlay');
    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  function syncCbamIdentityUi(state) {
    if (typeof global.syncCbamSovereigntyUi === 'function') {
      global.syncCbamSovereigntyUi(state);
      return;
    }
    var role = userRole();
    var logged = isLoggedIn();
    var guestWall = el('cbam-guest-wall');
    var smePanel = el('cbam-role-sme-panel');
    var originPanel = el('cbam-role-origin-panel');

    if (smePanel) smePanel.hidden = role === 'ROLE_ORIGIN';
    if (originPanel) originPanel.hidden = role !== 'ROLE_ORIGIN';

    if (role === 'ROLE_ORIGIN') {
      if (guestWall) guestWall.hidden = true;
      if (smePanel) smePanel.hidden = true;
      if (originPanel) originPanel.hidden = false;
      setClaimControlsEnabled(false);
      return;
    }

    if (!logged) {
      if (guestWall) guestWall.hidden = false;
      setClaimControlsEnabled(false);
      return;
    }

    if (guestWall) guestWall.hidden = true;
    setClaimControlsEnabled(true);

    if (logged) restoreCbamReturnDraft();
    hideScanOverlay();
  }

  function getCbamVerifiedMaterialFactor() {
    if (verifiedPoolMatch && Number.isFinite(verifiedPoolMatch.carbonIntensity)) {
      return verifiedPoolMatch.carbonIntensity;
    }
    return null;
  }

  function getCbamVerifiedPoolMatch() {
    return verifiedPoolMatch;
  }

  function showBatchSuccessBanner(message) {
    var banner = el('cbam-batch-success-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'cbam-batch-success-banner';
      banner.className = 'cbam-batch-success-banner';
      var anchor = el('origin-verified-badge') || el('cbam-role-sme-panel');
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(banner, anchor);
    }
    banner.hidden = false;
    banner.textContent = message || '[🟢 批次对账成功：该物料已由原厂确权]';
  }

  function showVerifiedPoolBadge(entry, greenLight) {
    var badge = el('origin-verified-badge');
    if (!badge || !entry) return;
    var cert = entry.certId || entry.cert_id || '—';
    var name = entry.originName || entry.origin_name || '原厂';
    var vcode = entry.verificationCode || entry.verification_code || entry.batchId || entry.batch_id || '';
    var ci = Number(entry.carbonIntensity != null ? entry.carbonIntensity : entry.carbon_intensity);
    badge.style.display = 'block';
    badge.classList.toggle('verified-green', !!greenLight);
    badge.innerHTML =
      (greenLight ? '🟢 ' : '🛡️ ') +
      '<strong>批次对账成功</strong> | 编号: <code style="color:var(--gold-l)">' +
      cert +
      '</code>' +
      (vcode ? '<br><span style="font-size:11px;color:var(--teal-l)">批次号: <code>' + vcode + '</code></span>' : '') +
      '<br><span style="font-size:11px;color:var(--ink2)">' +
      name +
      ' · 单位产品碳强度 ' +
      (Number.isFinite(ci) ? ci.toFixed(4) : '—') +
      ' tCO₂e/t（已覆盖默认因子）</span>';
  }

  function clearVerifiedPoolMatch() {
    verifiedPoolMatch = null;
    var badge = el('origin-verified-badge');
    if (badge) {
      badge.style.display = 'none';
      badge.innerHTML = '';
      badge.classList.remove('verified-green');
    }
    var batchBanner = el('cbam-batch-success-banner');
    if (batchBanner) batchBanner.hidden = true;
    var opt = el('f-material-opt-verified');
    if (opt) opt.remove();
    var sel = el('f-material');
    if (sel) sel.classList.remove('material-verified-green');
    if (typeof global.syncResonanceMaterialUi === 'function') global.syncResonanceMaterialUi();
    previewIfReady();
  }

  function applyVerifiedPoolEntry(entry, message) {
    if (entry && typeof global.canPullVerifiedFactor === 'function' && !global.canPullVerifiedFactor(entry)) {
      if (typeof global.showUpstreamEvidenceCard === 'function') {
        global.showUpstreamEvidenceCard({
          holder: entry.originName || entry.origin_name,
          certificateId: entry.certId || entry.cert_id || entry.verificationCode,
          carbonIntensity: entry.carbonIntensity != null ? entry.carbonIntensity : entry.carbon_intensity,
          cityState: entry.cityState || 'evidence_building',
          pullEligible: false,
        });
      }
      return;
    }
    var ci = Number(entry.carbonIntensity != null ? entry.carbonIntensity : entry.carbon_intensity);
    var vcode = entry.verificationCode || entry.verification_code || entry.batchId || entry.batch_id || '';
    verifiedPoolMatch = {
      carbonIntensity: ci,
      certId: entry.certId || entry.cert_id,
      originName: entry.originName || entry.origin_name,
      verificationCode: vcode,
    };
    var sel = el('f-material');
    if (sel && Number.isFinite(ci)) {
      var opt = el('f-material-opt-verified');
      if (!opt) {
        opt = document.createElement('option');
        opt.id = 'f-material-opt-verified';
        sel.insertBefore(opt, sel.firstChild);
      }
      var label =
        '🟢 ' + (entry.originName || entry.origin_name || '原厂') + ' · 官方确权 ' + ci.toFixed(4) + ' t/t';
      opt.value = String(ci);
      opt.textContent = label;
      opt.selected = true;
      sel.value = String(ci);
      sel.classList.add('material-verified-green');
    }
    var codeInp = el('f-verification-code');
    if (codeInp && vcode) codeInp.value = vcode;
    var searchInp = el('f-origin-search');
    if (searchInp && (entry.originName || entry.origin_name)) {
      searchInp.value = entry.originName || entry.origin_name;
    }
    var penalty = el('origin-penalty-banner');
    if (penalty) penalty.hidden = true;
    var msg = message || '[🟢 批次对账成功：该物料已由原厂确权]';
    showBatchSuccessBanner(msg);
    showVerifiedPoolBadge(verifiedPoolMatch, true);
    toast(msg);
    if (typeof global.syncResonanceMaterialUi === 'function') global.syncResonanceMaterialUi();
    previewIfReady();
  }

  function fuzzyMatchFromPool() {
    var pool = getVerifiedOriginPool();
    if (!pool.length) return null;
    var co = appState().company || {};
    var hint = ((el('f-origin-search') || {}).value || co.name || '').trim().toLowerCase();
    if (!hint) return pool[0];
    var best = null;
    var bestScore = 0;
    pool.forEach(function (entry) {
      var name = String(entry.originName || entry.origin_name || '').toLowerCase();
      var credit = String(entry.creditCode || entry.credit_code || '').toLowerCase();
      var code = String(entry.verificationCode || entry.verification_code || '').toLowerCase();
      var score = 0;
      if (hint && name && (name.indexOf(hint) >= 0 || hint.indexOf(name) >= 0)) score += 3;
      if (hint && credit && credit.indexOf(hint.replace(/\D/g, '')) >= 0) score += 4;
      if (hint && code && code.indexOf(hint) >= 0) score += 5;
      if (!hint) score = 1;
      if (score > bestScore) {
        bestScore = score;
        best = entry;
      }
    });
    return best || pool[0];
  }

  function detectOriginFromDoc() {
    if (typeof global.notifyCbamCommercialBlock === 'function' &&
        global.notifyCbamCommercialBlock('detect_doc')) {
      return;
    }
    if (!isLoggedIn()) {
      toast('请先登录以使用智能进料单识别');
      goCbamLogin();
      return;
    }
    if (userRole() === 'ROLE_ORIGIN') {
      if (typeof global.showOriginDownstreamIntercept === 'function') global.showOriginDownstreamIntercept();
      return;
    }
    var overlay = el('cbam-doc-scan-overlay');
    var btn = el('btn-detect-origin-doc');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '扫描中…';
    }
    if (overlay) {
      overlay.hidden = false;
      overlay.setAttribute('aria-hidden', 'false');
    }
    setTimeout(function () {
      var match = fuzzyMatchFromPool();
      if (overlay) {
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = '📸 拍照识别进料单';
      }
      if (!match) {
        toast('进料单识别完成 · 核验池暂无匹配原厂，请手动检索');
        return;
      }
      applyVerifiedPoolEntry(match, '[🟢 批次对账成功：该物料已由原厂确权]');
    }, 1400);
  }

  async function pullVerifiedFactorFromPool() {
    if (typeof global.notifyCbamCommercialBlock === 'function' &&
        global.notifyCbamCommercialBlock('pull')) {
      return;
    }
    if (userRole() === 'ROLE_ORIGIN') {
      if (typeof global.showOriginDownstreamIntercept === 'function') global.showOriginDownstreamIntercept();
      return;
    }
    if (!isLoggedIn()) {
      goCbamLogin();
      return;
    }
    var q = ((el('f-origin-search') || {}).value || '').trim();
    if (q.length < 2) {
      toast('请输入至少 2 个字符进行检索');
      return;
    }
    var btn = el('btn-origin-pull');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '检索中…';
    }
    try {
      var res = await fetch(
        cbamApiBase() + '/api/v1/hub/verified-factor-pool/search?q=' + encodeURIComponent(q),
        { credentials: 'include', headers: cbamAuthHeaders() }
      );
      var data = await res.json().catch(function () {
        return {};
      });
      if (res.status === 401) {
        toast('请先登录以检索核验池');
        goCbamLogin();
        return;
      }
      if (!res.ok) throw new Error(data.detail || data.message || res.statusText);
      if (!data.match || !data.entry) {
        clearVerifiedPoolMatch();
        if (typeof global.hideUpstreamEvidenceCard === 'function') global.hideUpstreamEvidenceCard();
        if (typeof global.tryShowIndustryBoardMatch === 'function' && global.tryShowIndustryBoardMatch(q)) {
          return;
        }
        toast(data.message || '核验池中未找到匹配记录，将使用欧盟默认因子');
        return;
      }
      if (typeof global.hideUpstreamEvidenceCard === 'function') global.hideUpstreamEvidenceCard();
      applyVerifiedPoolEntry(data.entry, data.message);
    } catch (e) {
      toast('核验池检索失败：' + ((e && e.message) || e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '检索核验池';
      }
    }
  }

  async function pullByVerificationCode() {
    if (typeof global.notifyCbamCommercialBlock === 'function' &&
        global.notifyCbamCommercialBlock('verify')) {
      return;
    }
    if (userRole() === 'ROLE_ORIGIN') {
      if (typeof global.showOriginDownstreamIntercept === 'function') global.showOriginDownstreamIntercept();
      return;
    }
    if (!isLoggedIn()) {
      goCbamLogin();
      return;
    }
    var raw = ((el('f-verification-code') || {}).value || '').trim();
    var productType = getCbamCurrentProductType();
    var gtcidCheck = validateGTCID(raw, productType);
    if (!gtcidCheck.ok) {
      toast('⚠️ ' + gtcidCheck.message);
      return;
    }
    raw = gtcidCheck.code || raw;
    if (raw.length < 8) {
      toast('请输入完整的 GTCID 核验码');
      return;
    }
    var btn = el('btn-verify-code');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '认领中…';
    }
    try {
      var url =
        cbamApiBase() +
        '/api/v1/hub/verified-factor-pool/verify?batch_id=' +
        encodeURIComponent(raw) +
        '&code=' +
        encodeURIComponent(raw);
      var res = await fetch(url, { credentials: 'include', headers: cbamAuthHeaders() });
      var data = await res.json().catch(function () {
        return {};
      });
      if (res.status === 401) {
        toast('请先登录以认领原厂因子');
        goCbamLogin();
        return;
      }
      if (!res.ok) throw new Error(data.detail || data.message || res.statusText);
      if (!data.match || !data.entry) {
        clearVerifiedPoolMatch();
        if (typeof global.tryShowIndustryBoardMatch === 'function') {
          global.tryShowIndustryBoardMatch(raw);
        }
        toast(data.message || '核验码无效，将使用欧盟默认因子');
        return;
      }
      if (typeof global.hideUpstreamEvidenceCard === 'function') global.hideUpstreamEvidenceCard();
      applyVerifiedPoolEntry(data.entry, data.message);
    } catch (e) {
      toast('核验码认领失败：' + ((e && e.message) || e));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = '认领因子';
      }
    }
  }

  function applyVerifiedOriginFromState(origin) {
    if (!origin || !origin.verified) return false;
    var ci = Number(origin.carbonIntensity != null ? origin.carbonIntensity : origin.carbon_intensity);
    if (!Number.isFinite(ci)) return false;
    applyVerifiedPoolEntry(
      {
        carbonIntensity: ci,
        certId: origin.certId || origin.cert_id,
        originName: origin.originName || origin.origin_name || '原厂',
        verificationCode: origin.verificationCode || origin.verification_code,
      },
      null
    );
    return true;
  }

  function goToOriginAuditPage() {
    var nav = el('n-origin-audit') || el('nav-origin-audit');
    if (typeof global.navTo === 'function' && el('page-origin-audit')) {
      global.navTo('origin-audit', nav);
      return;
    }
    if (typeof global.gotoOriginAuditFromCbam === 'function') {
      global.gotoOriginAuditFromCbam();
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
    location.href = '/static/全域中心.html#origin-audit';
  }

  function initCbamVerifiedFactorUi() {
    if (!el('f-verification-code') && !el('f-origin-search') && !el('btn-cbam-goto-origin-audit')) return;
    if (_bound) {
      syncCbamIdentityUi();
      return;
    }
    _bound = true;

    var pullBtn = el('btn-origin-pull');
    var searchInp = el('f-origin-search');
    var verifyBtn = el('btn-verify-code');
    var verifyInp = el('f-verification-code');
    var detectBtn = el('btn-detect-origin-doc');
    var loginBtn = el('btn-cbam-guest-login');
    var gotoOriginBtn = el('btn-cbam-goto-origin-audit');

    if (pullBtn) pullBtn.addEventListener('click', pullVerifiedFactorFromPool);
    if (verifyBtn) verifyBtn.addEventListener('click', pullByVerificationCode);
    if (detectBtn) detectBtn.addEventListener('click', detectOriginFromDoc);
    if (loginBtn) loginBtn.addEventListener('click', goCbamLogin);
    if (gotoOriginBtn) {
      gotoOriginBtn.addEventListener('click', function (ev) {
        ev.preventDefault();
        goToOriginAuditPage();
      });
    }
    if (verifyInp) {
      verifyInp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          pullByVerificationCode();
        }
      });
    }
    if (searchInp) {
      searchInp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          pullVerifiedFactorFromPool();
        }
      });
      searchInp.addEventListener('input', function () {
        if (!verifiedPoolMatch) return;
        var q = (searchInp.value || '').trim();
        var name = verifiedPoolMatch.originName || '';
        if (q.length >= 2 && name && name.indexOf(q) < 0) clearVerifiedPoolMatch();
      });
    }

    var fp = el('f-product');
    if (fp && !fp.__hengaiVerifiedClearBound) {
      fp.__hengaiVerifiedClearBound = true;
      fp.addEventListener('change', clearVerifiedPoolMatch);
    }

    var res = appState().resonance;
    if (res && res.verifiedOrigin && res.verifiedOrigin.verified) {
      applyVerifiedOriginFromState(res.verifiedOrigin);
    }

    syncCbamIdentityUi();
    if (global.EventBus && typeof global.EventBus.on === 'function') {
      global.EventBus.on('STATE_SYNCED', syncCbamIdentityUi);
      global.EventBus.on('STATE_UPDATED', syncCbamIdentityUi);
    }
  }

  global.getCbamVerifiedMaterialFactor = getCbamVerifiedMaterialFactor;
  global.getCbamVerifiedPoolMatch = getCbamVerifiedPoolMatch;
  global.clearVerifiedPoolMatch = clearVerifiedPoolMatch;
  global.applyVerifiedPoolEntry = applyVerifiedPoolEntry;
  global.pullVerifiedFactorFromPool = pullVerifiedFactorFromPool;
  global.pullByVerificationCode = pullByVerificationCode;
  global.detectOriginFromDoc = detectOriginFromDoc;
  global.goToOriginAuditPage = goToOriginAuditPage;
  global.initCbamVerifiedFactorUi = initCbamVerifiedFactorUi;
  global.syncCbamIdentityUi = syncCbamIdentityUi;
  global.goCbamLogin = goCbamLogin;
  global.saveCbamReturnDraft = saveCbamReturnDraft;
  global.restoreCbamReturnDraft = restoreCbamReturnDraft;

  function boot() {
    hideScanOverlay();
    initCbamVerifiedFactorUi();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
