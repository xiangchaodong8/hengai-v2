/**
 * CBAM 双模状态机 · Phase 1 证据态 UI（全域中心 + CBAM 测算工具共用）
 * 契约：docs/双模状态机_开发契约_v1.md §3–§4
 */
(function (global) {
  'use strict';

  var MODES = {
    SIMULATED: 'SIMULATED',
    PENDING: 'PENDING_VERIFICATION',
    VERIFIED: 'SOVEREIGN_VERIFIED',
  };

  var CURRENT_DICT_VERSION = 'IND_DICT_2026.06';

  var PERSONA_META = {
    SIMULATED: { label: '参谋长', hint: '推演 · 假如/建议' },
    PENDING_VERIFICATION: { label: '实证推进官', hint: '进度 · 下一步' },
    SOVEREIGN_VERIFIED: { label: '首席合规官', hint: '已确权 · 可执行' },
  };

  var MODE_META = {
    SIMULATED: {
      label: '模拟态',
      hint: '经营推演可用 · 不可申报 · 不可 Pull 官方因子',
      css: 'evidence-mode-simulated',
    },
    PENDING_VERIFICATION: {
      label: '实证中',
      hint: '精算芯确权流程进行中 · 暂不可 Pull · 不可对外申报',
      css: 'evidence-mode-pending',
    },
    SOVEREIGN_VERIFIED: {
      label: '已确权',
      hint: '主权凭证已回灌 · 可 Pull 官方因子 · 可用于申报/融资',
      css: 'evidence-mode-verified',
    },
  };

  function resolveState(state) {
    if (state && typeof state === 'object') return state;
    if (typeof global.resolveWritableAppState === 'function') {
      return global.resolveWritableAppState() || global.AppState || {};
    }
    return global.AppState || {};
  }

  function deriveModeFromCity(cityState) {
    var city = String(cityState || '').toLowerCase();
    if (city === 'certified') return MODES.VERIFIED;
    if (city === 'evidence_building' || city === 'mat_pending') return MODES.PENDING;
    return MODES.SIMULATED;
  }

  function normalizeMode(raw) {
    var m = String(raw || '').trim().toUpperCase();
    if (m === MODES.VERIFIED || m === MODES.PENDING || m === MODES.SIMULATED) return m;
    return MODES.SIMULATED;
  }

  function getCbamEvidenceSnapshot(state) {
    var st = resolveState(state);
    if (typeof global.ensureEvidenceContractShape === 'function') {
      try { global.ensureEvidenceContractShape(st); } catch (_) {}
    }
    var ev = (st.cbam && st.cbam.evidence) || {};
    var co = st.company || {};
    var city = co.cityState || co.city_state || null;
    var mode = normalizeMode(ev.mode);
    if (city) {
      var derived = deriveModeFromCity(city);
      if (derived !== MODES.SIMULATED || mode === MODES.SIMULATED) mode = derived;
    }
    return {
      mode: mode,
      stage: ev.stage || null,
      value: ev.value != null && Number.isFinite(Number(ev.value)) ? Number(ev.value) : null,
      unit: ev.unit || 'tCO2e/t',
      industryCode: ev.industryCode || co.industryCode || co.industry_code || null,
      dictVersion: ev.dictVersion || null,
      calcVersion: ev.calcVersion || null,
      updatedAt: ev.updatedAt || null,
      source: ev.source || null,
      verified: ev.verified && typeof ev.verified === 'object' ? ev.verified : {},
      shadow: ev.shadow && typeof ev.shadow === 'object' ? ev.shadow : {},
      pullEligible: co.pullEligible === true || mode === MODES.VERIFIED,
      cityState: city,
    };
  }

  function canPullFromEvidence(state) {
    var snap = getCbamEvidenceSnapshot(state);
    if (snap.mode !== MODES.VERIFIED) return false;
    if (typeof global.canPullVerifiedFactor === 'function') {
      return global.canPullVerifiedFactor({ cityState: snap.cityState, pullEligible: snap.pullEligible });
    }
    return snap.pullEligible;
  }

  function inferIndustryCode(calcResult, state) {
    if (calcResult && calcResult.mainProduct) return calcResult.mainProduct;
    var st = resolveState(state);
    var co = st.company || {};
    return co.industryCode || co.industry_code || co.mainProduct || null;
  }

  function computeDriftPct(verifiedVal, simulatedVal) {
    if (!Number.isFinite(verifiedVal) || verifiedVal <= 0) return 0;
    if (!Number.isFinite(simulatedVal)) return 0;
    return Math.abs(simulatedVal - verifiedVal) / verifiedVal * 100;
  }

  /**
   * 测算落库时同步 cbam.evidence（禁止 SIMULATED 覆盖 SOVEREIGN_VERIFIED 主值）
   */
  function syncEvidenceFromSimulation(calcResult, state) {
    if (!calcResult || !Number.isFinite(calcResult.ci)) return null;
    var st = resolveState(state);
    if (!st.cbam || typeof st.cbam !== 'object') st.cbam = {};
    if (typeof global.ensureEvidenceContractShape === 'function') {
      try { global.ensureEvidenceContractShape(st); } catch (_) {}
    }
    var ev = st.cbam.evidence;
    var co = st.company || {};
    var city = co.cityState || co.city_state || null;
    if (city) ev.mode = deriveModeFromCity(city);
    else if (!ev.mode) ev.mode = MODES.SIMULATED;

    var simCi = Number(calcResult.ci);
    var now = new Date().toISOString();
    ev.unit = ev.unit || 'tCO2e/t';
    ev.industryCode = inferIndustryCode(calcResult, st);
    ev.dictVersion = ev.dictVersion || 'IND_DICT_2026.06';
    ev.calcVersion = ev.calcVersion || 'CORE_V1';

    if (ev.mode === MODES.VERIFIED) {
      if (ev.value == null || !Number.isFinite(Number(ev.value))) {
        ev.value = simCi;
      }
      if (!ev.shadow || typeof ev.shadow !== 'object') ev.shadow = {};
      ev.shadow.simulatedValue = simCi;
      ev.shadow.driftPct = computeDriftPct(Number(ev.value), simCi);
      ev.shadow.updatedAt = now;
      ev.source = ev.source || 'sovereign_sync';
    } else {
      ev.value = simCi;
      ev.updatedAt = now;
      ev.source = ev.mode === MODES.SIMULATED ? 'hub_simulation' : (ev.source || 'hub_simulation');
      if (ev.mode === MODES.PENDING) {
        if (!ev.shadow || typeof ev.shadow !== 'object') ev.shadow = {};
        ev.shadow.simulatedValue = simCi;
        ev.shadow.updatedAt = now;
      }
    }
    return getCbamEvidenceSnapshot(st);
  }

  function resolveCbamEvidenceHost(options) {
    options = options || {};
    if (options.mountHost) return options.mountHost;
    var hubSec = global.document.querySelector('#H-pg-cbam #sec4');
    if (hubSec) return hubSec;
    var pageCalc = global.document.getElementById('page-calc');
    if (pageCalc) {
      var calcSec = pageCalc.querySelector('#sec4');
      if (calcSec) return calcSec;
    }
    var sec4 = global.document.getElementById('sec4');
    if (sec4 && global.document.getElementById('f-product')) return sec4;
    return null;
  }

  function removeOrphanEvidenceBar() {
    var bar = global.document.getElementById('cbam-evidence-bar');
    if (!bar) return;
    var host = resolveCbamEvidenceHost({});
    if (host && host.contains(bar)) return;
    bar.parentNode && bar.parentNode.removeChild(bar);
  }

  function ensureEvidenceBarMount(host) {
    if (!host) return null;
    var bar = global.document.getElementById('cbam-evidence-bar');
    if (bar) return bar;
    bar = global.document.createElement('div');
    bar.id = 'cbam-evidence-bar';
    bar.className = 'cbam-evidence-bar evidence-mode-simulated';
    bar.setAttribute('role', 'status');
    bar.setAttribute('aria-live', 'polite');
    bar.innerHTML =
      '<div class="cbam-evidence-bar-head">' +
      '<span class="cbam-evidence-badge" id="cbam-evidence-badge">模拟态</span>' +
      '<span class="cbam-evidence-value" id="cbam-evidence-value"></span>' +
      '</div>' +
      '<div class="cbam-evidence-hint" id="cbam-evidence-hint"></div>' +
      '<div class="cbam-evidence-dict-warn" id="cbam-evidence-dict-warn" hidden></div>' +
      '<div class="cbam-evidence-drift" id="cbam-evidence-drift" hidden></div>' +
      '<div class="cbam-evidence-actions" id="cbam-evidence-actions"></div>' +
      '<div class="cbam-evidence-next" id="cbam-evidence-next" hidden></div>';
    var anchor = host.querySelector ? host.querySelector('.result-hero') : null;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(bar, anchor);
    else if (host.firstChild) host.insertBefore(bar, host.firstChild);
    else host.appendChild(bar);
    return bar;
  }

  function toast(msg) {
    if (typeof global.showToast === 'function') global.showToast(msg);
  }

  function nextHistoryEventId(history) {
    var maxN = 0;
    (history || []).forEach(function (row) {
      var id = String((row && row.eventId) || '');
      var m = id.match(/(\d+)$/);
      if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
    });
    return 'evt-' + String(maxN + 1).padStart(3, '0');
  }

  /**
   * SIMULATED → PENDING_VERIFICATION（契约：全域中心发起「升格确权」）
   * 不依赖精算芯 POST sync；精算芯回灌后由 overview/sync 推进至 SOVEREIGN_VERIFIED
   */
  function initiateEvidenceElevation(options) {
    options = options || {};
    var st = resolveState(options.state);
    var snap = getCbamEvidenceSnapshot(st);

    if (snap.mode === MODES.VERIFIED) {
      toast('已完成主权确权，无需重复升格。');
      return false;
    }
    if (snap.mode === MODES.PENDING) {
      toast('升格流程已在进行中 · 请前往精算芯完成工序实证');
      renderCbamEvidenceBar({ state: st, syncCiDisplay: true });
      if (options.openCore !== false && typeof global.goSovereigntyCenter === 'function') {
        global.goSovereigntyCenter();
      }
      return true;
    }

    var token =
      (typeof global.getToken === 'function' && global.getToken()) ||
      global.localStorage && (global.localStorage.getItem('hengai_token') || global.localStorage.getItem('authToken'));
    if (!token) {
      toast('登录后可发起升格确权，将模拟结果推进至实证流程');
      if (typeof global.showAuth === 'function') global.showAuth('login');
      return false;
    }

    var calcResult = (st.cbam && st.cbam.calcResult) || global.calcResult || null;
    var ci =
      (st.cbam && st.cbam.evidence && st.cbam.evidence.value != null ? Number(st.cbam.evidence.value) : null) ||
      (calcResult && Number.isFinite(calcResult.ci) ? calcResult.ci : null);
    if (!Number.isFinite(ci)) {
      toast('请先完成 CBAM 测算，再发起升格为可核验结果');
      return false;
    }

    var now = new Date().toISOString();
    if (!st.cbam || typeof st.cbam !== 'object') st.cbam = {};
    if (typeof global.ensureEvidenceContractShape === 'function') {
      try { global.ensureEvidenceContractShape(st); } catch (_) {}
    }
    var ev = st.cbam.evidence;
    if (!st.company || typeof st.company !== 'object') st.company = {};
    if (!st.factorAuth || typeof st.factorAuth !== 'object') st.factorAuth = {};

    st.company.cityState = 'evidence_building';
    st.company.pullEligible = false;
    st.factorAuth.cityState = 'evidence_building';

    ev.mode = MODES.PENDING;
    ev.stage = 'software_evidenced';
    ev.value = ci;
    ev.updatedAt = now;
    ev.source = 'hub_elevation';
    if (typeof global.applyMonotonicTrustCommitment === 'function') {
      ev.trustCommitmentLevel = global.applyMonotonicTrustCommitment(ev.trustCommitmentLevel, 'COMMITTED');
    } else {
      ev.trustCommitmentLevel = 'COMMITTED';
    }
    if (!Array.isArray(ev.history)) ev.history = [];
    ev.history.push({
      eventId: nextHistoryEventId(ev.history),
      mode: MODES.PENDING,
      enteredAt: now,
      value: ci,
      trigger: 'hub_elevation_initiated',
    });

    if (typeof global.ensureEvidenceContractShape === 'function') {
      try { global.ensureEvidenceContractShape(st); } catch (_) {}
    }

    var payload = {
      holder: st.company.name || null,
      cityState: 'evidence_building',
      pullEligible: false,
      certificateId: null,
    };
    if (typeof global.emitAppStateEvent === 'function') {
      global.emitAppStateEvent('SOVEREIGNTY_EVIDENCE_SYNCED', payload);
    }
    if (st.update && typeof st.update === 'function') {
      st.update({
        company: { cityState: 'evidence_building', pullEligible: false },
        factorAuth: { cityState: 'evidence_building' },
        cbam: { evidence: ev },
      });
      if (typeof st.save === 'function') {
        try { st.save(); } catch (_) {}
      }
    } else if (typeof global.syncAppState === 'function') {
      global.syncAppState(st, { emitStateSynced: true });
    }
    if (typeof global.saveCachedState === 'function') {
      try { global.saveCachedState(st); } catch (_) {}
    }

    renderCbamEvidenceBar({ state: st, calcResult: calcResult, syncCiDisplay: true });
    toast('已升格为「实证中」· 下一步请前往精算芯完成工序实证');

    if (options.openCore && typeof global.goSovereigntyCenter === 'function') {
      global.goSovereigntyCenter();
    }
    return true;
  }

  function bindEvidenceAction(btn, handler) {
    if (!btn || btn.__cbamEvidenceBound) return;
    btn.__cbamEvidenceBound = true;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      handler();
    });
  }

  function renderEvidenceActions(mode, st) {
    var actions = global.document.getElementById('cbam-evidence-actions');
    var next = global.document.getElementById('cbam-evidence-next');
    if (!actions) return;

    actions.innerHTML = '';
    if (next) {
      next.hidden = true;
      next.textContent = '';
    }

    if (mode === MODES.SIMULATED) {
      var btnElevate = global.document.createElement('button');
      btnElevate.type = 'button';
      btnElevate.className = 'cbam-evidence-btn cbam-evidence-btn-primary';
      btnElevate.textContent = '升格为可核验结果 →';
      bindEvidenceAction(btnElevate, function () {
        initiateEvidenceElevation({ openCore: false });
      });

      var btnSim = global.document.createElement('button');
      btnSim.type = 'button';
      btnSim.className = 'cbam-evidence-btn cbam-evidence-btn-ghost';
      btnSim.textContent = '继续模拟推演';
      bindEvidenceAction(btnSim, function () {
        if (typeof global.goStep === 'function') global.goStep(3);
        else toast('可调整参数后重新测算');
      });

      actions.appendChild(btnElevate);
      actions.appendChild(btnSim);
      return;
    }

    if (mode === MODES.PENDING) {
      var btnCore = global.document.createElement('button');
      btnCore.type = 'button';
      btnCore.className = 'cbam-evidence-btn cbam-evidence-btn-primary';
      btnCore.textContent = '前往精算芯完成实证 →';
      bindEvidenceAction(btnCore, function () {
        toast('精算芯本地服务尚未接入 · 您已处于「实证中」；回灌并网后将自动升级为「已确权」');
      });

      var btnContinue = global.document.createElement('button');
      btnContinue.type = 'button';
      btnContinue.className = 'cbam-evidence-btn cbam-evidence-btn-ghost';
      btnContinue.textContent = '继续模拟推演';
      bindEvidenceAction(btnContinue, function () {
        if (typeof global.goStep === 'function') global.goStep(3);
      });

      actions.appendChild(btnCore);
      actions.appendChild(btnContinue);

      if (next) {
        next.hidden = false;
        next.innerHTML =
          '💡 精算芯将把当前模拟值升格为<strong>可核验凭证</strong>（工序数据在本地/物理边界处理，仅回灌脱敏结论）。' +
          ' 完成回灌后，本页将自动切换为「已确权」。';
      }
      return;
    }

    if (mode === MODES.VERIFIED && next) {
      next.hidden = false;
      next.textContent = '主权凭证已生效。重新模拟仅更新漂移参考，不会改写官方主值。';
    }
  }

  function injectEvidenceUiStyles() {
    if (global.__cbamEvidenceUiStyles) return;
    global.__cbamEvidenceUiStyles = true;
    var css =
      '.cbam-evidence-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}' +
      '.cbam-evidence-btn{padding:8px 14px;border-radius:9px;font-size:12px;font-weight:700;cursor:pointer;font-family:"Noto Sans SC",sans-serif;transition:opacity .15s,border-color .15s}' +
      '.cbam-evidence-btn-primary{border:none;background:linear-gradient(135deg,var(--gold,#c9a84c),#a8862e);color:#1a1408}' +
      '.cbam-evidence-btn-primary:hover{opacity:.9}' +
      '.cbam-evidence-btn-ghost{border:1px solid var(--border2,rgba(255,255,255,.13));background:transparent;color:var(--ink2,#8a95a8)}' +
      '.cbam-evidence-btn-ghost:hover{border-color:var(--gold-b,rgba(201,168,76,.45));color:var(--gold-l,#f0d080)}' +
      '.cbam-evidence-next{margin-top:8px;padding:8px 10px;border-radius:8px;font-size:11px;line-height:1.65;color:var(--ink3,#8a95a8);background:rgba(0,0,0,.18);border-left:2px solid var(--gold,#c9a84c)}' +
      '.cbam-evidence-dict-warn{margin-top:8px;padding:8px 10px;border-radius:8px;font-size:11px;line-height:1.6;color:#fcd34d;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35)}';
    var style = global.document.createElement('style');
    style.id = 'cbam-evidence-ui-styles';
    style.textContent = css;
    (global.document.head || global.document.documentElement).appendChild(style);
  }

  function updateDictVersionWarning(snap) {
    var warn = global.document.getElementById('cbam-evidence-dict-warn');
    if (!warn) return;
    var dv = snap && snap.dictVersion;
    if (dv && dv !== CURRENT_DICT_VERSION) {
      warn.hidden = false;
      warn.innerHTML =
        '⚠️ 口径版本差异：当前结果基于 <strong>' +
        dv +
        '</strong>，Hub 线上字典为 <strong>' +
        CURRENT_DICT_VERSION +
        '</strong>。对比时请留意因子/缺省值可能已更新。';
    } else {
      warn.hidden = true;
      warn.textContent = '';
    }
  }

  function updateChatPersonaChip(state) {
    var chip = global.document.getElementById('chat-evidence-persona');
    if (!chip) return;
    var snap = getCbamEvidenceSnapshot(state);
    var persona = PERSONA_META[snap.mode] || PERSONA_META.SIMULATED;
    chip.textContent = persona.label + ' · ' + persona.hint;
    chip.setAttribute('data-evidence-mode', snap.mode);
    chip.hidden = false;
  }

  function formatCi(val, unit) {
    if (val == null || !Number.isFinite(Number(val))) return '—';
    return Number(val).toFixed(3) + ' ' + (unit || 'tCO2e/t');
  }

  function updateScopeNote(mode) {
    var note = global.document.getElementById('cbam-result-scope-note');
    if (!note) return;
    if (mode === MODES.VERIFIED) {
      note.innerHTML =
        '本页<strong>主权已确权</strong>数值来自精算芯回灌凭证；下方漂移提示为最新线上推演，不影响官方凭证效力。';
      note.hidden = false;
      return;
    }
    if (mode === MODES.PENDING) {
      note.innerHTML =
        '本页处于<strong>实证推进中</strong>：结果供内部决策参考，尚未完成硬件封签，<strong>不可 Pull / 不可申报</strong>。';
      note.hidden = false;
      return;
    }
    note.innerHTML =
      '本页结果为<strong>模拟态粗测</strong>，供内部决策与敞口预判；<strong>不可申报、不可 Pull</strong>官方因子。';
    note.hidden = false;
  }

  function applyVisualProtocol(mode) {
    var bar = global.document.getElementById('cbam-evidence-bar');
    var hero = global.document.querySelector('#H-pg-cbam .result-hero, #page-calc .result-hero, #sec4 .result-hero');
    if (hero && !resolveCbamEvidenceHost({})) hero = null;
    var meta = MODE_META[mode] || MODE_META.SIMULATED;
    var css = meta.css;
    [bar, hero].forEach(function (node) {
      if (!node || !node.classList) return;
      node.classList.remove('evidence-mode-simulated', 'evidence-mode-pending', 'evidence-mode-verified');
      node.classList.add(css);
    });
    if (mode === MODES.VERIFIED && hero && hero.classList) {
      hero.classList.add('evidence-verified-flash');
      global.setTimeout(function () {
        if (hero && hero.classList) hero.classList.remove('evidence-verified-flash');
      }, 1200);
    }
  }

  function renderCbamEvidenceBar(options) {
    options = options || {};
    var st = resolveState(options.state);
    var calcResult = options.calcResult || (st.cbam && st.cbam.calcResult) || global.calcResult || null;
    var snap = getCbamEvidenceSnapshot(st);
    var mode = snap.mode;
    var meta = MODE_META[mode] || MODE_META.SIMULATED;

    var host = resolveCbamEvidenceHost(options);
    if (!host) {
      removeOrphanEvidenceBar();
      return snap;
    }
    ensureEvidenceBarMount(host);

    var badge = global.document.getElementById('cbam-evidence-badge');
    var valEl = global.document.getElementById('cbam-evidence-value');
    var hintEl = global.document.getElementById('cbam-evidence-hint');
    var driftEl = global.document.getElementById('cbam-evidence-drift');

    if (badge) badge.textContent = meta.label;
    if (hintEl) {
      var pullNote = canPullFromEvidence(st) ? '' : ' · Pull 未解锁';
      hintEl.textContent = meta.hint + pullNote;
    }

    var displayVal = snap.value;
    if (mode === MODES.VERIFIED && displayVal != null) {
      if (valEl) valEl.textContent = '主权碳强度 ' + formatCi(displayVal, snap.unit);
    } else if (calcResult && Number.isFinite(calcResult.ci)) {
      if (valEl) valEl.textContent = '当前推演 ' + formatCi(calcResult.ci, snap.unit);
    } else if (displayVal != null) {
      if (valEl) valEl.textContent = '当前口径 ' + formatCi(displayVal, snap.unit);
    } else if (valEl) {
      valEl.textContent = '';
    }

    var simVal =
      (snap.shadow && snap.shadow.simulatedValue != null ? Number(snap.shadow.simulatedValue) : null) ||
      (calcResult && Number.isFinite(calcResult.ci) ? calcResult.ci : null);
    var drift =
      snap.shadow && snap.shadow.driftPct != null
        ? Number(snap.shadow.driftPct)
        : computeDriftPct(Number(snap.value), simVal);

    if (driftEl) {
      if (mode === MODES.VERIFIED && simVal != null && snap.value != null && drift > 0.05) {
        driftEl.hidden = false;
        driftEl.innerHTML =
          '当前推演：<strong>' +
          formatCi(simVal, snap.unit) +
          '</strong> · 偏离已确权主权资产 <strong>' +
          drift.toFixed(1) +
          '%</strong>。建议以此推演作为技改参考，不影响官方凭证效力。';
      } else {
        driftEl.hidden = true;
        driftEl.textContent = '';
      }
    }

    applyVisualProtocol(mode);
    updateScopeNote(mode);
    updateDictVersionWarning(snap);
    renderEvidenceActions(mode, st);

    if (options.syncCiDisplay && calcResult) {
      var ciNodes = ['rb-ci'];
      var verifiedPrimary = mode === MODES.VERIFIED && snap.value != null;
      var ciText = verifiedPrimary
        ? Number(snap.value).toFixed(3) + ' t'
        : calcResult.ci.toFixed(3) + ' t';
      ciNodes.forEach(function (id) {
        var node = global.document.getElementById(id);
        if (node) node.textContent = ciText;
      });
      var ciSub = global.document.getElementById('rb-ci-sub');
      if (ciSub) {
        ciSub.textContent = verifiedPrimary
          ? 'tCO₂e / 吨产品 · 主权已确权'
          : 'tCO₂e / 吨产品 · 模拟推演';
      }
    }

    return snap;
  }

  function wireEvidenceEventBus() {
    if (global.__hengaiCbamEvidenceUiWired) return;
    global.__hengaiCbamEvidenceUiWired = true;
    if (typeof global.EventBus === 'undefined' || !global.EventBus.on) return;
    var refresh = function (state) {
      if (!resolveCbamEvidenceHost({})) {
        removeOrphanEvidenceBar();
        return;
      }
      try {
        renderCbamEvidenceBar({ state: state, syncCiDisplay: true });
      } catch (e) {
        console.warn('[cbam-evidence-ui] refresh', e);
      }
    };
    global.EventBus.on('STATE_SYNCED', refresh);
    global.EventBus.on('SOVEREIGNTY_EVIDENCE_SYNCED', refresh);
  }

  var api = {
    MODES: MODES,
    getCbamEvidenceSnapshot: getCbamEvidenceSnapshot,
    syncEvidenceFromSimulation: syncEvidenceFromSimulation,
    initiateEvidenceElevation: initiateEvidenceElevation,
    renderCbamEvidenceBar: renderCbamEvidenceBar,
    updateChatPersonaChip: updateChatPersonaChip,
    canPullFromEvidence: canPullFromEvidence,
    computeDriftPct: computeDriftPct,
  };

  global.HengAICbamEvidence = api;
  global.getCbamEvidenceSnapshot = getCbamEvidenceSnapshot;
  global.syncEvidenceFromSimulation = syncEvidenceFromSimulation;
  global.initiateEvidenceElevation = initiateEvidenceElevation;
  global.renderCbamEvidenceBar = renderCbamEvidenceBar;
  global.updateChatPersonaChip = updateChatPersonaChip;
  global.canPullFromEvidence = canPullFromEvidence;

  injectEvidenceUiStyles();
  removeOrphanEvidenceBar();
  wireEvidenceEventBus();

  if (global.document && global.document.readyState === 'loading') {
    global.document.addEventListener('DOMContentLoaded', function () {
      removeOrphanEvidenceBar();
      if (resolveCbamEvidenceHost({})) {
        try { renderCbamEvidenceBar(); } catch (_) {}
      }
    });
  } else if (resolveCbamEvidenceHost({})) {
    try { renderCbamEvidenceBar(); } catch (_) {}
  }
})(typeof window !== 'undefined' ? window : this);
