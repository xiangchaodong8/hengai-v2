/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║   HengAI Co2Lion · AppState 唯一真理引擎 · V3.2                      ║
 * ║   全域 14 模块共用 · 严禁在各模块页面 Hardcode 任何业务数据            ║
 * ║                                                                      ║
 * ║   加载顺序：<script src="AppState.js"></script>（Linux 须此大小写，<head> 首位）║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 *  暴露到 window：
 *    window.AppState        — 唯一真理对象
 *    window.EventBus        — 跨模块事件总线
 *    window.ACCOUNT_TIER    — 账户等级枚举
 *    window.F               — 格式化工具集
 *    window.FM              — dyn-* CSS class → AppState 路径映射表
 *    window.syncAppState()  — 全量 DOM 灌注
 *    window.initAppState()  — 异步初始化入口（每页调用一次）
 *    window.getMacroOracle()— 宏观价源读取
 *    window.publishMacroSync()— 跨标签碳价同步
 */

/*
  ⚠️ 故意不写 "use strict"：本文件是 classic <script>，多个 classic 脚本共享
     同一份 Script Records 词法环境。一旦某脚本顶层用 `const X = ...`，其它
     脚本若再 `const/let X` 立即抛 SyntaxError 并把整段 <script> 抹掉，导致
     首页变「空壳」。所以本文件的所有跨页全局，全部改用「前置检查 + window.X」
     幂等模式，配合 `var` —— `var` 允许重复声明，不会再撞名。
*/

/* ═══════════════════════════════════════════════════════════════════════
   0 · 常量（全部走 window.X = window.X || ... 防呆模式）
   ═══════════════════════════════════════════════════════════════════════ */
window.API_BASE = window.API_BASE
  || (window.APP_CONFIG && (window.APP_CONFIG.API_BASE || window.APP_CONFIG.api_base))
  || 'http://localhost:8000';

/** 统一去掉尾部斜杠与误拼的 /api/v1，避免 `${API_BASE}/api/v1/...` 双重前缀 → 404 */
function hengaiApiOrigin() {
  var b = String(window.API_BASE || 'http://localhost:8000').replace(/\/+$/, '');
  return b.replace(/\/api\/v1$/i, '');
}
window.hengaiApiOrigin = hengaiApiOrigin;
window.API_BASE = hengaiApiOrigin();
var API_BASE = window.API_BASE;

window.API_AUTH_ME_URL = window.API_AUTH_ME_URL || (hengaiApiOrigin() + '/api/v1/auth/me');
window.API_CHAT_URL = window.API_CHAT_URL || (hengaiApiOrigin() + '/api/chat');
var API_AUTH_ME_URL = window.API_AUTH_ME_URL;

window.API_HUB_OVERVIEW = window.API_HUB_OVERVIEW || (window.API_BASE + '/api/v1/hub/overview');
var API_HUB_OVERVIEW = window.API_HUB_OVERVIEW;

window.API_TIMEOUT_MS = window.API_TIMEOUT_MS || 3000;
var API_TIMEOUT_MS = window.API_TIMEOUT_MS;

var LS_TOKEN_KEY      = 'hengai_token';
var LS_TOKEN_ALT      = 'authToken';
var LS_CACHE_KEY      = 'hengai_hub_cache_v1';
var LS_MACRO_KEY      = 'hengai_macro_sync_v1';
var BC_MACRO_CHANNEL  = 'hengai_macro_sync_channel';
var BC_STATE_CHANNEL  = 'hengai_appstate_sync_v1';

/* ═══════════════════════════════════════════════════════════════════════
   1 · 账户等级枚举（防呆）
   ═══════════════════════════════════════════════════════════════════════ */
window.ACCOUNT_TIER = window.ACCOUNT_TIER || Object.freeze({
  GUEST:        'GUEST',
  FREE_USER:    'FREE_USER',
  PRO_PERSONAL: 'PRO_PERSONAL',
  ENT_VERIFIED: 'ENT_VERIFIED',
});
var ACCOUNT_TIER = window.ACCOUNT_TIER;

/* ═══════════════════════════════════════════════════════════════════════
   2 · EventBus —— 跨模块事件总线（防呆）
   ═══════════════════════════════════════════════════════════════════════ */
window.EventBus = window.EventBus || {
  _ev: {},
  on(event, fn)   { (this._ev[event] = this._ev[event] || []).push(fn); return this; },
  off(event, fn)  { this._ev[event] = (this._ev[event] || []).filter(f => f !== fn); },
  emit(event, d)  { (this._ev[event] || []).forEach(fn => { try { fn(d); } catch(e) { console.warn('[EventBus]', event, e); } }); },
};
var EventBus = window.EventBus;

/* ═══════════════════════════════════════════════════════════════════════
   3 · Token 工具
   ═══════════════════════════════════════════════════════════════════════ */
function getToken() {
  const t = localStorage.getItem(LS_TOKEN_KEY);
  if (t) return t;
  const alt = localStorage.getItem(LS_TOKEN_ALT);
  if (alt) {
    try {
      localStorage.setItem(LS_TOKEN_KEY, alt);
      localStorage.removeItem(LS_TOKEN_ALT);
    } catch {}
    return alt;
  }
  return null;
}
function setToken(t) {
  if (!t) {
    clearToken();
    return;
  }
  localStorage.setItem(LS_TOKEN_KEY, t);
  try { localStorage.removeItem(LS_TOKEN_ALT); } catch {}
}
function clearToken() {
  localStorage.removeItem(LS_TOKEN_KEY);
  localStorage.removeItem(LS_TOKEN_ALT);
}
window.getToken = getToken;
window.setToken = setToken;
window.clearToken = clearToken;

/* ═══════════════════════════════════════════════════════════════════════
   4 · 认证辅助
   ═══════════════════════════════════════════════════════════════════════ */
function normalizeTierCode(input) {
  const raw = String(input || '').trim();
  if (!raw) return ACCOUNT_TIER.GUEST;
  if (Object.values(ACCOUNT_TIER).includes(raw)) return raw;
  if (/企业|共治|认证|旗舰|sovereign|ent/i.test(raw)) return ACCOUNT_TIER.ENT_VERIFIED;
  if (/专业|pro|年付|月付/i.test(raw))                  return ACCOUNT_TIER.PRO_PERSONAL;
  if (/免费|free|体验/i.test(raw))                      return ACCOUNT_TIER.FREE_USER;
  return ACCOUNT_TIER.FREE_USER;
}
function oracleIsLoggedIn()  { return !!(AppState.auth?.user); }
function currentTierCode()   {
  if (!oracleIsLoggedIn()) return ACCOUNT_TIER.GUEST;
  return normalizeTierCode((AppState.user && AppState.user.tier_code) || (AppState.user && AppState.user.tier));
}
window.oracleIsLoggedIn = oracleIsLoggedIn;
window.currentTierCode  = currentTierCode;

/* ═══════════════════════════════════════════════════════════════════════
   5 · DEFAULT_STATE —— AppState 的初始结构骨架（仅包含 schema，不放业务数字）
       字段值默认为空，等 /api/v1/hub/overview 拉到真实数据后覆盖。
       严禁在此放任何"演示数据"，所有数字以后端为准。
   ═══════════════════════════════════════════════════════════════════════ */
var MOCK_STATE = {
  user: {
    name:           '',
    email:          '',
    tier:           '',
    tier_code:      ACCOUNT_TIER.GUEST,
    tierLevel:      0,
    currentLevel:   1,
    complianceScore:0,
    gmBalance:      0,
    tokensLeft:     0,
    tokensUsed:     0,
    totalCo2eSaved: 0,
    badgeCount:     0,
    regDate:        null,
    regLabel:       '',
    lastLoginAt:    null,
    /** GM 流水占位（由 Action_Ledger / 概览接口填充；无数据时 UI 显示空态） */
    gmLedgerRegister:  null,
    gmLedgerSubscribe: null,
    gmLedgerCbam:      null,
    levels:         { 1:'Lv.1 观察员', 2:'Lv.3 架构师', 3:'Lv.5 智库顾问', 4:'Lv.4 物理认证', 5:'Lv.5 全域顾问' },
  },
  company: {
    name:                   '',
    creditCode:             '',
    industryLabel:          '',
    industryCode:           '',
    stage:                  'Incomplete',
    stageLabel:             '待激活',
    employeeCount:          null,
    complianceLevel:        0,
    annualRevenue:          null,
    declaredSupplierCount:  0,
    // —— V3.2 企业档案完整字段 ——
    mainProduct:            '',
    hsCode:                 '',
    annualCapacityTons:     null,
    annualExportTons:       null,
    exportCountries:        '',
    annualPowerKwh:         null,
    powerGrid:              '',
    contactEmail:           '',
    // —— 计算结果（待用户产生数据后填充） ——
    productLine:            '',
    factorMethod:           '',
    customsLevel:           '',
    creditLimit:            '',
    netSavings:             '',
    roiRatio:               '',
    interestSave:           '',
    declareCount:           0,
    cbamRisk:               '待测算',
    cbamRiskRaw:            null,
  },
  metrics: {
    tCO2eTotal:             null,
    globalRank:             null,
    roiRatio:               null,
    supplyChainCoverage:    0,
    scope3Coverage:         0,
    riskExposureEur:        null,
    cbamTaxEstimate:        null,
    reductionTarget:        null,
    reductionAchieved:      null,
    reductionProgress:      0,
    energyTco2eSum:         0,
    supplierCount:          0,
    supplierSubmitted:      0,
    supplierSubmittedCount: 0,
    supplierPendingCount:   0,
    scope1:                 0,
    scope2:                 0,
    scope3:                 0,
    taxSavingsWan:          0,
    carbonIntensity:        null,
    roiMultiple:            null,
    industryBetterPct:      0,
    barWidthPct:            0,
    supplierPush:           0,
    cbamDrills:             0,
    paidPartners:           0,
    coverageDeltaPct:       0,
    emissionReductionT:     0,
    gmMonthlyDelta:         0,
    scope3Rate:             0,
    shieldEn:               '',
  },
  impact: {
    riskExposureEur: null,
    scope1: 0,
    scope2: 0,
    scope3: 0,
  },
  macro: {
    cbam_current_price: 75.36,
    eur_cny_rate:       7.85,
    last_updated:       '',
  },
  wallet: {
    address: '',
    balance: 0,
  },
  flags: {
    currentPhase:       'Phase1',
    phaseLabel:         'Phase 1 · 个体启蒙期',
    nextAction:         '建立企业数字档案 → 进入阶段二',
    /** 仅当 /api/v1/hub/overview 返回 HTTP 200 并成功合并后为 true；全域中心浮层在此之前保持锁定 */
    hubOverviewReady:   false,
    unlockedMenusList:  [
      'dashboard','achievement','cbam','compute','regulation','wallet'
    ],
  },
  recentReports: [],
  badges: [],
  suppliers: [],
  gmTransactions: [],
  compute: {
    tokenQuota:      0,
    tokenUsed:       0,
    deepCalcQuota:   0,
    deepCalcUsed:    0,
    storageGB:       0,
    storageUsedGB:   0,
    ledger:          [],
  },
  euCustoms: {
    level:        '',
    declareCount: 0,
    declarations: [],
  },
  dld: {
    certifiedCO2e: 0,
    creditLimit:   '',
    creditStatus:  '未授信',
    interestSave:  '',
    banks:         [],
    assets:        [],
  },
  acf: {
    certStatus:     '未认证',
    productLine:    '',
    factorMethod:   '',
    carbonFactor:   null,
    certExpiry:     null,
    progressSteps:  [],
  },
  governance: {
    seatTitle:        '',
    seatId:           '',
    seatRegion:       '',
    votesAvailable:   0,
    passedProposals:  0,
    totalMembers:     0,
    activeProposals:  0,
    proposals:        [],
    members:          [],
    timeline:         [],
  },
  diagnostic: {
    overallScore: null,
    riskLevel:    '',
    /** 诊断报告生成时间（ISO）；由 overview 或独立接口写入 */
    generatedAt:  null,
    dimensions:   [],
  },
  cbam: {
    step:               1,
    productType:        '',
    exportVolume:       null,
    carbonIntensity:    null,
    paidCarbonPrice:    null,
    calcResult:         null,
    sensitivityPrices:  [40, 75.36, 80, 100],
  },
  supplierNodes:    [],
  decisionPacks:    [],
  dldApplications: [],
  serverTime:       new Date().toISOString(),
};

/* ═══════════════════════════════════════════════════════════════════════
   6 · AppState 对象 —— 唯一真理（前置检查 · 全 window 唯一入口）
   ═══════════════════════════════════════════════════════════════════════ */
window.AppState = window.AppState || Object.assign(JSON.parse(JSON.stringify(MOCK_STATE)), {
  auth:         { user: null, token: null },
  chat:         { messages: [], turnCount: 0, isStreaming: false, guestLimit: 5, lastUserText: '' },
  contextTags:  [],
  justSawROI:   false,
  _mode:        'pending',
});
var AppState = window.AppState;
Object.assign(AppState, {

  /* ── 方法 ── */
  updateAuth(user, token) {
    this.auth.user  = user;
    this.auth.token = token;
    if (token) setToken(token); else clearToken();
    if (user) {
      if (!this.user || typeof this.user !== 'object') this.user = {};
      const u = this.user;
      if (user?.name)       u.name       = user.name;
      if (user?.email)      u.email      = user.email;
      if (user?.gmBalance != null) {
        u.gmBalance = Number(user.gmBalance);
        if (this.wallet && typeof this.wallet === 'object') this.wallet.balance = u.gmBalance;
      }
      if (user?.tier)       u.tier       = user.tier;
      if (user?.tier_code)  u.tier_code  = normalizeTierCode(user.tier_code);
      const reg = user.created_at || user.createdAt || user.reg_date || user.regDate;
      if (reg) u.regDate = reg;
    }
    EventBus.emit('AUTH_CHANGED', this.auth.user);
    syncAppState();
    broadcastStatePatch({ user: this.user, auth: { ...this.auth } });
  },

  updateGM(delta) {
    this.user.gmBalance    = Math.max(0, (this.user.gmBalance || 0) + delta);
    this.wallet.balance    = this.user.gmBalance;
    EventBus.emit('GM_UPDATED', this.user.gmBalance);
    syncAppState();
    broadcastStatePatch({ user: { gmBalance: this.user.gmBalance }, wallet: { balance: this.wallet.balance } });
  },

  setGM(val) {
    this.user.gmBalance    = Number(val) || 0;
    this.wallet.balance    = this.user.gmBalance;
    EventBus.emit('GM_UPDATED', this.user.gmBalance);
    syncAppState();
    broadcastStatePatch({ user: { gmBalance: this.user.gmBalance }, wallet: { balance: this.wallet.balance } });
  },

  addContext(tag) {
    if (!this.contextTags.includes(tag)) {
      this.contextTags.push(tag);
      EventBus.emit('CONTEXT_UPDATED', this.contextTags);
    }
  },

  incrementTurn() {
    this.chat.turnCount++;
    const el = document.getElementById('turnCounter');
    if (el) el.textContent = `第${this.chat.turnCount}轮`;
  },

  /** 点路径写状态并同步全站（如 company.isComplete） */
  updateField(dotPath, value) {
    const segs = String(dotPath || '').split('.').filter(Boolean);
    if (!segs.length) return;
    const delta = {};
    let o = delta;
    for (let i = 0; i < segs.length - 1; i++) {
      o[segs[i]] = {};
      o = o[segs[i]];
    }
    o[segs[segs.length - 1]] = value;
    Object.assign(window.AppState, deepMerge(window.AppState, delta));
    try { saveCachedState(window.AppState); } catch {}
    syncAppState();
    broadcastStatePatch(delta);
  },

  /**
   * 创始人指令任务 5：sync() 别名 —— 任意脚本可通过 AppState.sync() 直接刷新所有 dyn-* 节点。
   * 内置对 .dyn-gm-balance-num 的强制刷新，确保首页顶部 GM 数字一定活的。
   */
  sync() {
    try {
      const gmVal = Number((this.user && this.user.gmBalance) || 0);
      document.querySelectorAll('.dyn-gm-balance-num').forEach((el) => {
        el.innerText = gmVal.toLocaleString('zh-CN');
      });
    } catch (_) {}
    syncAppState(this);
  },

  /**
   * 与 commit 等价：测算/档案保存统一入口（先乐观内存，再 POST，200 后 syncAppState → STATE_SYNCED）
   */
  saveData(domain, payload, options) {
    return this.commit(domain, payload, options);
  },

  /**
   * 🚨 创始人指令任务 1 · AppState.commit —— 全域表单提交的【唯一劫持点】
   *
   * 用法：
   *   await AppState.commit('enterprise', { name, creditCode, ... })
   *   await AppState.commit('cbam', { exportVolume, carbonIntensity, ... })
   *   await AppState.commit('supply', { supplierName, supplierEmail, hsCode, ... })
   *   await AppState.commit('decision', { recipient, subject, body, ... })
   *   await AppState.commit('dld', { amount, purpose, durationMonths, ... })
   *
   * 保证：
   *   1. 同步 patch 本地 AppState（局部更新）
   *   2. 调后端 API 持久化
   *   3. 成功后 emit 事件让 14 模块的 dyn-* / 订阅者自动刷新（全局同步）
   *   4. 失败时回滚本地 patch，抛错给调用方处理
   *   5. 全程不刷新页面（严守 SPA 体验）
   */
  async commit(domain, payload, options) {
    options = options || {};
    const ROUTES = {
      enterprise: {
        path: '/api/v1/hub/workspace-update',
        merge: (d, st) => {
          const c = Object.assign({}, st.company || {});
          if (d.name != null) c.name = d.name;
          if (d.industryCode != null) c.industryCode = d.industryCode;
          if (d.creditCode != null) c.creditCode = d.creditCode;
          if (d.mainProduct != null) c.mainProduct = d.mainProduct;
          if (d.hsCode != null) c.hsCode = d.hsCode;
          if (d.annualCapacityTons != null) c.annualCapacityTons = d.annualCapacityTons;
          if (d.annualExportTons != null) c.annualExportTons = d.annualExportTons;
          if (d.exportCountries != null) c.exportCountries = d.exportCountries;
          if (d.annualPowerKwh != null) c.annualPowerKwh = d.annualPowerKwh;
          if (d.powerGrid != null) c.powerGrid = d.powerGrid;
          if (d.contactEmail != null) c.contactEmail = d.contactEmail;
          return { company: c };
        },
      },
      cbam: {
        path: '/api/v1/hub/cbam-report-save',
        merge: (d, st) => ({
          cbam: Object.assign({}, st.cbam || {}, {
            reportingPeriod: d.reportingPeriod,
            riskExposureEur: d.riskExposureEur,
            tco2eTotal: d.tco2eTotal,
            lastPayloadAt: new Date().toISOString(),
          }),
        }),
      },
      supply:     { path: '/api/v1/hub/supplier-invite', merge: (d, st) => ({ supplierNodes: ((st.supplierNodes || []).concat([d])) }) },
      decision:   { path: '/api/v1/hub/decision-package', merge: (d, st) => ({ decisionPacks: ((st.decisionPacks || []).concat([d])) }) },
      dld:        { path: '/api/v1/hub/dld-apply', merge: (d, st) => ({ dldApplications: ((st.dldApplications || []).concat([d])) }) },
    };
    const route = ROUTES[domain];
    if (!route) {
      throw new Error(`[AppState.commit] 未知 domain: ${domain}（合法值: ${Object.keys(ROUTES).join('/')}）`);
    }

    const token = (typeof getToken === 'function' && getToken()) || '';
    const apiBase = String(window.API_BASE || 'http://localhost:8000').replace(/\/+$/, '');
    const url = apiBase + route.path;

    // 1. 乐观本地 patch（提前让 UI 响应）
    const prevSnapshot = JSON.parse(JSON.stringify({ user: this.user, company: this.company || null, cbam: this.cbam || null, supplierNodes: this.supplierNodes || [] }));
    if (options.optimistic !== false) {
      try {
        const localDelta = route.merge(payload, this);
        Object.assign(window.AppState, deepMerge(window.AppState, localDelta));
        syncAppState();
      } catch (_) {}
    }

    // 2. 调后端 API
    let response;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(token ? { Authorization: 'Bearer ' + token } : {})
        },
        body: JSON.stringify(payload)
      });
      response = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 回滚乐观 patch
        Object.assign(window.AppState, prevSnapshot);
        syncAppState();
        const errMsg = (response?.detail || response?.message) || `${res.status} ${res.statusText}`;
        throw new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
      }
    } catch (err) {
      EventBus.emit(`${domain}:save-failed`, { error: err, payload });
      throw err;
    }

    // 3. 服务器权威：优先合并响应中的全量 appState（与 GET /hub/overview 同构）
    const appState = response?.appState || response?.app_state;
    if (appState && typeof appState === 'object' && Object.keys(appState).length) {
      Object.assign(window.AppState, deepMerge(window.AppState, sanitizeOverviewPayload(appState)));
      if (window.AppState.user && window.AppState.user.gmBalance != null) {
        window.AppState.user.gmBalance = Number(window.AppState.user.gmBalance);
      }
      if (window.AppState.wallet && typeof window.AppState.wallet === 'object') {
        window.AppState.wallet.balance = window.AppState.user.gmBalance;
      }
      if (!window.AppState.flags) window.AppState.flags = {};
      window.AppState.flags.hubOverviewReady = true;
      try { saveCachedState(window.AppState); } catch (_) {}
      try { if (typeof window.updateHubSyncGate === 'function') window.updateHubSyncGate(window.AppState); } catch (_) {}
      syncAppState(window.AppState, { fromRemote: true });
    } else {
      const gmEarned = Number(response?.gmEarned || response?.gm_earned || 0);
      const newPhase = response?.stage || response?.phase || response?.currentPhase;
      if (gmEarned > 0) {
        this.user.gmBalance = Number(this.user?.gmBalance || 0) + gmEarned;
        if (this.wallet && typeof this.wallet === 'object') this.wallet.balance = this.user.gmBalance;
        EventBus.emit('GM_UPDATED', this.user.gmBalance);
      }
      if (newPhase && newPhase !== (this.company?.stage || this.company?.phase)) {
        if (this.company) this.company.stage = newPhase;
        EventBus.emit('PHASE_CHANGED', { newPhase, response });
      }
      this.sync();
    }

    // 4. 无全量 DNA 时异步重拉概览（有 appState 则跳过）
    if (!(response?.appState || response?.app_state)) {
      try {
        if (typeof window.HengAI === 'object' && typeof window.HengAI.initHengAI === 'function') {
          window.HengAI.initHengAI();
        } else if (typeof window.initGlobalHub === 'function') {
          window.initGlobalHub();
        }
      } catch (_) {}
    }

    // 5. emit domain 特定事件（让各模块知道"自己被提交了一次"）
    EventBus.emit(`${domain}:saved`, { payload, response });
    EventBus.emit('STATE_COMMIT', { domain, payload, response });

    // 6. 若上一步未走 appState 分支，sync 已执行；此处补一次广播
    if (!(response?.appState || response?.app_state)) {
      broadcastStatePatch({ _commitDomain: domain, _commitAt: new Date().toISOString() });
    } else {
      broadcastStatePatch({ _commitDomain: domain, _commitAt: new Date().toISOString(), appState: true });
    }

    return response;
  },
});
window.AppState = AppState;

(function wireGlobalStateSyncedUi() {
  if (typeof EventBus === 'undefined' || window.__hengaiStateSyncedUi) return;
  window.__hengaiStateSyncedUi = true;
  EventBus.on('STATE_SYNCED', function () {
    try {
      if (window.AppState && window.AppState.user && window.AppState.user.gmBalance != null) {
        window.AppState.user.gmBalance = Number(window.AppState.user.gmBalance);
      }
      if (typeof window.syncUserGmFromState === 'function') window.syncUserGmFromState();
      if (typeof window.renderGMBalance === 'function') window.renderGMBalance();
      const nm = String((window.AppState && window.AppState.user && window.AppState.user.name) || '---');
      document.querySelectorAll('.dyn-user-name').forEach((el) => { el.textContent = nm; });
    } catch (e) {
      console.warn('[AppState] STATE_SYNCED ui hook', e);
    }
  });
})();

/* ═══════════════════════════════════════════════════════════════════════
   6b · window.HengAI —— 神经入口（须先于 frontend_core 定义 login；core 会 merge 扩展）
   ═══════════════════════════════════════════════════════════════════════ */
window.HengAI = window.HengAI || {};

/**
 * 登录：写 hengai_token → 拉 /me → AppState.updateAuth（自动 AUTH_CHANGED + sync）
 * 不阻塞页面其他脚本；仅 async 调用时发网络请求。
 */
window.HengAI.login = async function hengAiLogin(account, password) {
  const acc = String(account || '').trim();
  const pwd = String(password || '').trim();
  if (!acc || !pwd) throw new Error('账号和密码不能为空');
  const body = acc.indexOf('@') !== -1
    ? { email: acc, password: pwd }
    : { phone: acc, password: pwd };
  const r = await fetch(`${API_BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    credentials: 'include',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    let msg = '账号或密码错误';
    const d = data.detail;
    if (Array.isArray(d) && d[0]) msg = String(d[0].msg || d[0].message || msg);
    else if (typeof d === 'string') msg = d;
    throw new Error(msg);
  }
  const token = data.access_token;
  if (!token) throw new Error('登录响应缺少 access_token');
  setToken(token);
  let userObj = null;
  try {
    const mr = await fetch(API_AUTH_ME_URL, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      credentials: 'include',
    });
    if (mr.ok) {
      const me = await mr.json().catch(() => ({}));
      userObj = me?.user || me?.data || me;
    }
  } catch (_) {}
  if (userObj && typeof userObj === 'object') {
    AppState.updateAuth(userObj, token);
  } else {
    AppState.updateAuth(
      acc.indexOf('@') !== -1 ? { email: acc } : { phone: acc },
      token,
    );
  }
  // V3.2 契约：返回值形状对外稳定为 { ok, token, user }，让调用侧可以
  // 直接 `const { ok } = await HengAI.login(...); if (ok) { ... }`，避免
  // 对返回值结构的二次推断。
  return { ok: true, token, user: userObj };
};

/* ═══════════════════════════════════════════════════════════════════════
   7 · 格式化工具集 F（防呆）
   ═══════════════════════════════════════════════════════════════════════ */
window.F = window.F || {
  n:    (v, d=0) => v == null ? '—' : Number(v).toLocaleString('zh-CN', { minimumFractionDigits:d, maximumFractionDigits:d }),
  t:    (v)      => v == null ? '—' : `${F.n(v,1)} tCO₂e`,
  eur:  (v)      => {
    if (v == null) return '—';
    if (v >= 1e6)  return `€${(v/1e6).toFixed(2)}M`;
    if (v >= 1e4)  return `€${F.n(v,0)}`;
    return `€${F.n(v,2)}`;
  },
  cny:  (v)      => v == null ? '—' : `¥${F.n(v,0)}`,
  pct:  (v, d=1) => v == null ? '—' : `${(Number(v)*100).toFixed(d)}%`,
  gm:   (v)      => v == null ? '—' : `${F.n(v,0)} GM`,
  dt:   (v)      => {
    if (!v) return '—';
    try { return new Date(v).toLocaleDateString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit' }); }
    catch { return String(v); }
  },
  /** 月-日（时间轴短格式） */
  md:   (v)      => {
    if (!v) return '—';
    try {
      const d = new Date(v);
      if (isNaN(d.getTime())) return '—';
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } catch { return '—'; }
  },
  tier: (v)      => {
    const map = {
      [ACCOUNT_TIER.GUEST]:        '访客',
      [ACCOUNT_TIER.FREE_USER]:    '免费体验版',
      [ACCOUNT_TIER.PRO_PERSONAL]: '个人专业版',
      [ACCOUNT_TIER.ENT_VERIFIED]: '企业共治版',
      Sovereign: '全域主权版',
    };
    return map[String(v)] || String(v || '未知');
  },
  esc:  (v)      => String(v || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),
};
var F = window.F;

/* ═══════════════════════════════════════════════════════════════════════
   8 · FM —— dyn-* CSS class → AppState 路径映射表（防呆）
       { c: CSS-class, p: dot-path | null, compute: fn, f: formatter, a: attr }
   ═══════════════════════════════════════════════════════════════════════ */
window.FM = window.FM || [
  /* ── user ── */
  { c:'dyn-user-name',           p:'user.name' },
  { c:'dyn-user-email',          p:'user.email' },
  { c:'dyn-user-tier',           p:'user.tier',              f:F.tier },
  { c:'dyn-user-level',          p:'user.currentLevel' },
  { c:'dyn-user-reg-date',       p:'user.regDate',           f:F.dt },
  { c:'dyn-user-last-login',     p:'user.lastLoginAt',       f:F.dt },
  { c:'dyn-user-compliance',     p:'user.complianceScore' },
  { c:'dyn-gm-balance',          p:'user.gmBalance',         f:F.gm },
  { c:'dyn-gm-balance-num',      p:'user.gmBalance',         f:(v)=>F.n(v,0) },
  { c:'dyn-tokens-left',         p:'user.tokensLeft',        f:F.n },
  { c:'dyn-tokens-used',         p:'user.tokensUsed',        f:F.n },
  { c:'dyn-tokens-total',        p:null, compute:(s)=>(s.user?.tokensLeft||0)+(s.user?.tokensUsed||0), f:F.n },
  { c:'dyn-tokens-rounds',       p:null, compute:(s)=>Math.floor((s.user?.tokensLeft||0)/500), f:F.n },
  { c:'dyn-tokens-pct',          p:null, compute:(s)=>{const t=(s.user?.tokensLeft||0)+(s.user?.tokensUsed||0);return t?s.user.tokensUsed/t:0}, f:F.pct },
  { c:'dyn-co2e-saved',          p:'user.totalCo2eSaved',    f:F.t },
  { c:'dyn-badge-count',         p:'user.badgeCount' },
  { c:'dyn-user-name-initial',   p:'user.name',              f:(v)=>String(v||'?')[0].toUpperCase() },

  /* ── company ── */
  { c:'dyn-company-name',        p:'company.name' },
  { c:'dyn-ent-name',            p:'company.name' },
  { c:'dyn-company-credit',      p:'company.creditCode' },
  { c:'dyn-company-industry',    p:'company.industryLabel' },
  { c:'dyn-company-stage',       p:'company.stageLabel' },
  { c:'dyn-ent-stage-label',     p:'company.stageLabel' },
  { c:'dyn-company-employees',   p:'company.employeeCount',  f:F.n },
  { c:'dyn-company-compliance',  p:'company.complianceLevel' },
  { c:'dyn-company-revenue',     p:'company.annualRevenue',  f:(v)=>v?`¥${F.n(v/10000,0)}万`:'—' },
  { c:'dyn-ent-code',            p:'company.creditCode' },
  { c:'dyn-ent-export-tons',     p:'company.exportTons',     f:(v)=>v!=null?F.n(v,0)+' t':'—' },
  { c:'dyn-acf-product',         p:'company.productLine' },
  { c:'dyn-acf-method',          p:'company.factorMethod' },
  { c:'dyn-customs-level',       p:'company.customsLevel' },
  { c:'dyn-customs-declare-count',p:'company.declareCount',  f:F.n },
  { c:'dyn-rep-roi',             p:'company.roiRatio' },
  { c:'dyn-rep-save',            p:'company.netSavings' },
  { c:'dyn-credit-limit',        p:'company.creditLimit' },
  { c:'dyn-interest-save',       p:'company.interestSave' },

  /* ── company form inputs ── */
  { c:'dyn-company-name-inp',    p:'company.name',           a:'value' },
  { c:'dyn-company-credit-inp',  p:'company.creditCode',     a:'value' },

  /* ── metrics ── */
  { c:'dyn-tco2e-total',         p:'metrics.tCO2eTotal',         f:F.t },
  { c:'dyn-tco2e-topbar',        p:'metrics.tCO2eTotal',         f:F.t },
  { c:'dyn-total-co2',           p:'metrics.tCO2eTotal',         f:(v)=>v!=null?F.n(v,1):'—' },
  { c:'dyn-global-rank',         p:'metrics.globalRank',         f:(v)=>v?`#${F.n(v,0)}`:'—' },
  { c:'dyn-roi-ratio',           p:'metrics.roiRatio',           f:(v)=>v!=null?F.pct(v):'—' },
  { c:'dyn-supply-pct',          p:'metrics.supplyChainCoverage',f:F.pct },
  { c:'dyn-sup-pct',             p:'metrics.supplyChainCoverage',f:F.pct },
  { c:'dyn-supply-coverage',     p:'metrics.supplyChainCoverage',f:F.pct },
  { c:'dyn-scope3-pct',          p:'metrics.scope3Coverage',     f:F.pct },
  { c:'dyn-risk-eur',            p:'metrics.riskExposureEur',    f:F.eur },
  { c:'dyn-cbam-tax',            p:'metrics.cbamTaxEstimate',    f:F.eur },
  { c:'dyn-reduction-target',    p:'metrics.reductionTarget',    f:F.t },
  { c:'dyn-reduction-achieved',  p:'metrics.reductionAchieved',  f:F.t },
  { c:'dyn-reduction-pct',       p:'metrics.reductionProgress',  f:F.pct },
  { c:'dyn-energy-tco2e',        p:'metrics.energyTco2eSum',     f:F.t },
  { c:'dyn-supplier-count',      p:'metrics.supplierCount',      f:F.n },
  { c:'dyn-supplier-submitted',  p:'metrics.supplierSubmitted',  f:F.n },
  { c:'dyn-sup-total',           p:'metrics.supplierCount',      f:F.n },
  { c:'dyn-sup-count',           p:'metrics.supplierSubmitted',  f:F.n },
  { c:'dyn-sup-pending',         p:'metrics.supplierPendingCount',f:F.n },
  { c:'dyn-supplier-gap',        p:null, compute:(s)=>Math.max(0,(s.company?.declaredSupplierCount||0)-(s.metrics?.supplierSubmitted||0)), f:F.n },
  { c:'dyn-tax-savings',         p:'metrics.taxSavingsWan',      f:(v)=>v!=null?`${v} 万`:'—' },
  { c:'dyn-carbon-intensity',    p:'metrics.carbonIntensity',    f:(v)=>v!=null?`碳强度 ${v} t/t`:'—' },
  { c:'dyn-tax-intensity',       p:'metrics.carbonIntensity',    f:(v)=>v!=null?Number(v).toFixed(2):'0.00' },
  { c:'dyn-roi-multiple',        p:'metrics.roiMultiple',        f:(v)=>v!=null?`${v}x`:'—' },
  { c:'dyn-scope1-tco2',         p:'metrics.scope1',             f:(v)=>v!=null?F.n(v,1):'—' },
  { c:'dyn-scope2-tco2',         p:'metrics.scope2',             f:(v)=>v!=null?F.n(v,1):'—' },
  { c:'dyn-scope3-tco2',         p:'metrics.scope3',             f:(v)=>v!=null?F.n(v,1):'—' },
  { c:'dyn-rep-tax',             p:'metrics.riskExposureEur',    f:F.eur },

  /* ── radar (derived) ── */
  { c:'dyn-radar-carbon',        p:null, compute:(s)=>Math.min(100,(s.metrics?.tCO2eTotal||0)>0?65:10), f:(v)=>v+'%' },
  { c:'dyn-radar-supply',        p:'metrics.supplyChainCoverage', f:(v)=>F.pct(v,0) },
  { c:'dyn-radar-compliance',    p:'user.complianceScore',         f:(v)=>v+'%' },
  { c:'dyn-radar-reduction',     p:'metrics.reductionProgress',    f:(v)=>v!=null?F.pct(v,0):'0%' },
  { c:'dyn-radar-roi',           p:'metrics.roiRatio',             f:(v)=>v!=null?F.pct(v,0):'0%' },
  { c:'dyn-radar-quality',       p:'company.complianceLevel',      f:(v)=>v!=null?v*20+'%':'0%' },

  /* ── progress bars (style.width) ── */
  { c:'dyn-scope3-bar',          p:'metrics.scope3Coverage',     a:'style.width', f:(v)=>`${Math.min(100,(v||0)*100).toFixed(1)}%` },
  { c:'dyn-supply-bar',          p:'metrics.supplyChainCoverage',a:'style.width', f:(v)=>`${Math.min(100,(v||0)*100).toFixed(1)}%` },
  { c:'dyn-reduction-bar',       p:'metrics.reductionProgress',  a:'style.width', f:(v)=>`${Math.min(100,(v||0)*100).toFixed(1)}%` },
  { c:'dyn-tier-bar',            p:'user.tierLevel',             a:'style.width', f:(v)=>`${((v-1)/4*100).toFixed(0)}%` },
  { c:'dyn-tokens-bar',          p:null, compute:(s)=>{const t=(s.user?.tokensLeft||0)+(s.user?.tokensUsed||0);return t?s.user.tokensUsed/t:0}, a:'style.width', f:(v)=>`${Math.min(100,(v||0)*100).toFixed(1)}%` },
  { c:'dyn-token-ring-pct',      p:null, compute:(s)=>{const t=(s.user?.tokensLeft||0)+(s.user?.tokensUsed||0);return t?s.user.tokensUsed/t:0}, f:(v)=>`${Math.min(100,(v||0)*100).toFixed(0)}%` },

  /* ── flags ── */
  { c:'dyn-phase-code',          p:'flags.currentPhase' },
  { c:'dyn-phase-label',         p:'flags.phaseLabel' },
  { c:'dyn-next-action',         p:'flags.nextAction' },

  /* ── wallet ── */
  { c:'dyn-wallet-balance',      p:'user.gmBalance',         f:(v)=>F.n(v,0) },
  { c:'dyn-wallet-hash',         p:'wallet.address' },
  { c:'dyn-gm-total-earned',     p:'user.gmBalance',         f:(v)=>F.n(v,0) },
  { c:'dyn-gm-spent',            p:null, compute:()=>0,      f:F.n },

  /* ── latest report ── */
  { c:'dyn-rep-period',          p:'recentReports.0.reportingPeriod' },
  { c:'dyn-rep-status',          p:'recentReports.0.status' },
  { c:'dyn-rep-tco2e',           p:'recentReports.0.tCO2eTotal',      f:F.t },
  { c:'dyn-rep-risk',            p:'recentReports.0.riskExposureEur', f:F.eur },

  /* ── diagnostic ── */
  { c:'dyn-diag-risk-level',     p:'metrics.riskExposureEur', f:(v)=>!v?'低风险':v>100000?'高风险':v>30000?'中等风险':'低风险' },
  { c:'dyn-diag-risk-eur',       p:'metrics.riskExposureEur', f:F.eur },
  { c:'dyn-diag-tco2e',          p:'metrics.tCO2eTotal',      f:F.t },
  { c:'dyn-diag-score',          p:'diagnostic.overallScore' },

  /* ── compute ── */
  { c:'dyn-token-quota',         p:'compute.tokenQuota',     f:F.n },
  { c:'dyn-token-used',          p:'compute.tokenUsed',      f:F.n },
  { c:'dyn-deep-quota',          p:'compute.deepCalcQuota',  f:F.n },
  { c:'dyn-deep-used',           p:'compute.deepCalcUsed',   f:F.n },

  /* ── DLD / ACF / governance ── */
  { c:'dyn-dld-co2',             p:'dld.certifiedCO2e',      f:(v)=>v?`${v} tCO₂e`:'—' },
  { c:'dyn-dld-credit',          p:'dld.creditLimit' },
  { c:'dyn-dld-status',          p:'dld.creditStatus' },
  { c:'dyn-acf-status',          p:'acf.certStatus' },
  { c:'dyn-gov-seat',            p:'governance.seatTitle' },
  { c:'dyn-gov-votes',           p:'governance.votesAvailable', f:F.n },
  { c:'dyn-gov-members',         p:'governance.totalMembers',   f:F.n },

  /* ── decision package ── */
  { c:'dyn-decision-tax-k',      p:'metrics.riskExposureEur', f:(v)=>v?`€ ${(v/1000).toFixed(0)}k`:'—' },

  /* ── server time ── */
  { c:'dyn-server-time',         p:'serverTime', f:(v)=>v?new Date(v).toLocaleTimeString('zh-CN'):'' },
  { c:'dyn-diag-date',           p:'diagnostic.generatedAt', f:F.dt },
];
var FM = window.FM;

/* ═══════════════════════════════════════════════════════════════════════
   9 · 路径解析 gp()
   ═══════════════════════════════════════════════════════════════════════ */
function gp(obj, path) {
  if (!path) return undefined;
  return path.split('.').reduce((cur, k) => {
    if (cur == null) return null;
    const i = parseInt(k, 10);
    return isNaN(i) ? cur[k] : cur[i];
  }, obj);
}

/* ═══════════════════════════════════════════════════════════════════════
   10 · countUp 律动动画
   ═══════════════════════════════════════════════════════════════════════ */
function countUp(el, toStr, dur=700) {
  const from = parseFloat(String(el.textContent||'').replace(/[^\d.-]/g,''));
  const to   = parseFloat(String(toStr).replace(/[^\d.-]/g,''));
  if (isNaN(from)||isNaN(to)||from===to) { el.textContent=toStr; return; }
  const pre = String(toStr).match(/^[^\d-]*/)?.[0]||'';
  const suf = String(toStr).match(/[^\d.,]+$/)?.[0]||'';
  const dec = (String(toStr).split('.')?.[1]?.replace(/[^\d]/g,'')||'').length;
  const t0  = performance.now();
  el.classList.add('counting');
  function fr(now) {
    const p = Math.min((now-t0)/dur,1);
    const e = 1 - Math.pow(1-p, 3);
    const c = from+(to-from)*e;
    el.textContent = pre+c.toLocaleString('zh-CN',{minimumFractionDigits:dec,maximumFractionDigits:dec})+(p<1?'':suf);
    if (p<1) requestAnimationFrame(fr);
    else { el.textContent=toStr; el.classList.remove('counting'); }
  }
  requestAnimationFrame(fr);
}

function syncDataStateBinds(s) {
  if (!s) return;
  document.querySelectorAll('[data-state-bind]').forEach((el) => {
    const path = el.getAttribute('data-state-bind');
    if (!path) return;
    const raw = gp(s, path);
    const empty = el.getAttribute('data-empty');
    const fmtKey = el.getAttribute('data-state-fmt') || '';
    let d;
    if (raw == null || raw === '') {
      d = empty != null ? empty : '---';
    } else if (fmtKey === 'dt' || fmtKey === 'date') {
      try { d = F.dt(raw); } catch { d = String(raw); }
    } else if (fmtKey === 'md') {
      try { d = F.md(raw); } catch { d = '---'; }
    } else if (fmtKey === 'n') {
      const dec = Number(el.getAttribute('data-decimals') || 0);
      d = F.n(raw, dec);
    } else if (fmtKey === 'eur') {
      d = F.eur(raw);
    } else if (fmtKey === 'pct') {
      d = F.pct(raw);
    } else {
      d = String(raw);
    }
    const attr = el.getAttribute('data-state-attr');
    if (attr === 'value' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
      el.value = d;
    } else {
      setEl(el, d, null);
    }
  });
}

function updateHubSyncGate(s) {
  const hub = document.getElementById('co2lion-hub-overlay');
  if (!hub) return;
  const ready = !!(s && s.flags && s.flags.hubOverviewReady);
  hub.classList.toggle('hub-sync-locked', !ready);
  const guest = !getToken();
  const sub = hub.querySelector('.hub-sync-sub--guest');
  const msg = hub.querySelector('.hub-sync-msg');
  if (sub) sub.style.display = guest ? 'block' : 'none';
  if (msg) msg.textContent = guest ? '请先登录以同步全域数据' : (!ready ? '正在同步全域数据…' : '同步完成');
}
window.updateHubSyncGate = updateHubSyncGate;

function setEl(el, val, attr) {
  const d = (val==null||val==='')?'—':String(val);
  if (attr) {
    if (attr.startsWith('style.')) el.style[attr.slice(6)] = d;
    else el.setAttribute(attr, d==='—'?'':d);
    return;
  }
  if (el.textContent===d) return;
  const ov = parseFloat(String(el.textContent||'').replace(/[^\d.-]/g,''));
  const nv = parseFloat(d.replace(/[^\d.-]/g,''));
  if (!isNaN(ov)&&!isNaN(nv)&&el.textContent!=='—'&&el.textContent!=='--') {
    countUp(el, d);
  } else {
    el.classList.add('hash-jump');
    el.textContent = d;
    setTimeout(()=>el.classList.remove('hash-jump'), 400);
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   11 · syncAppState() —— 全量 DOM 灌注
   ═══════════════════════════════════════════════════════════════════════ */
function syncAppState(state, opts) {
  const s = state || window.AppState;
  if (!s) return;
  const emitSynced = !(opts && opts.emitStateSynced === false);

  /* FM 绑定 */
  FM.forEach(({ c, p, compute, f, a }) => {
    const els = document.querySelectorAll('.' + c);
    if (!els.length) return;
    let raw = compute ? compute(s) : gp(s, p);
    let d;
    if (raw==null||raw==='') d='—';
    else if (f) { try { d=f(raw); } catch { d=String(raw); } }
    else d = String(raw);
    els.forEach(el => setEl(el, d, a));
  });

  /* GM 强制刷新（任务 5） */
  const gmRaw = Number(s.user?.gmBalance || 0);
  const gmVal = gmRaw.toLocaleString('zh-CN');
  document.querySelectorAll('.dyn-gm-balance-num').forEach((el) => { el.innerText = gmVal; });
  document.querySelectorAll('.gm-chip-val, .topbar-gm-val').forEach((el) => {
    if (el.textContent !== gmVal) el.textContent = gmVal;
  });

  /* 用户名 / 头像首字 */
  const name    = s.user?.name || '访客';
  document.querySelectorAll('.topbar-user-name, #headerIdentityName').forEach(el => el.textContent = name);
  document.querySelectorAll('.topbar-user-avatar, #headerIdentityAvatar').forEach(el => el.textContent = name[0].toUpperCase());

  /* Phase badge */
  const ph    = gp(s,'flags.currentPhase') || 'Phase1';
  const badge = document.getElementById('t-phase-badge');
  if (badge) {
    badge.className = 't-phase';
    badge.classList.add(ph==='Phase3'?'ph3':ph==='Phase2'?'ph2':'ph1');
    const sp = badge.querySelector('.dyn-phase-code');
    if (sp) sp.textContent = ph;
  }

  /* Menu locks (Phase 2/3 gates) */
  const ul = new Set(gp(s,'flags.unlockedMenusList')||[]);
  document.querySelectorAll('[data-slug]').forEach(el => {
    el.classList.toggle('locked', !ul.has(el.dataset.slug));
  });

  /* Sidebar active item */
  const fn  = decodeURIComponent((location.pathname.split('/').pop()||'').split('?')[0]);
  const PAGE_MAP = {
    '全域中心.html':'overview','index.html':'overview',
    'HengAI_星火成就档案.html':'achieve',
    'HengAI_CBAM测算工具.html':'cbam',
    'HengAI_算力资源.html':'compute',
    'HengAI_法规知识库.html':'regulation',
    'HengAI_企业数字档案.html':'company',
    'HengAI_供应链协同.html':'supplychain',
    'HengAI_全域诊断报告.html':'diagnosis',
    'HengAI_决策层呈送包生成器.html':'package',
    'HengAI_荣誉体系.html':'honor',
    'HengAI_Governance.html':'governance',
    'HengAI_GM_Wallet.html':'wallet',
    'HengAI_EU_Customs.html':'customs',
    'HengAI_DLD_Credit.html':'dld',
    'HengAI_ACF_Cert.html':'acf',
  };
  const currentPage = PAGE_MAP[fn];
  if (currentPage) {
    document.querySelectorAll('.sidebar .sb-item[data-page]').forEach(el => {
      el.classList.toggle('active', el.dataset.page === currentPage);
    });
    document.querySelectorAll('.nav[data-slug]').forEach(el => {
      el.classList.toggle('active', el.dataset.slug === currentPage);
    });
  }

  /* 侧边栏 Phase Strip */
  const phaseStrip = document.getElementById('sb-phase-text');
  if (phaseStrip) phaseStrip.textContent = gp(s,'flags.phaseLabel') || '';
  const phaseRole = document.getElementById('sb-urole');
  if (phaseRole) phaseRole.textContent = s.user?.tier || '';

  if (opts?.fromRemote) {
    FM.forEach(({ c }) => {
      document.querySelectorAll('.' + c).forEach(el => {
        el.classList.add('dyn-sync-pulse');
        setTimeout(() => el.classList.remove('dyn-sync-pulse'), 560);
      });
    });
  }

  try { syncDataStateBinds(s); } catch (e) { console.warn('[AppState] syncDataStateBinds', e); }
  try { updateHubSyncGate(s); } catch (_) {}

  if (emitSynced) {
    EventBus.emit('STATE_SYNCED', s);
  }
  EventBus.emit('STATE_UPDATED', s);
}
window.syncAppState = syncAppState;

/* ═══════════════════════════════════════════════════════════════════════
   12 · deepMerge —— 深合并 API 响应到 AppState
   ═══════════════════════════════════════════════════════════════════════ */
function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return target;
  const result = Object.assign({}, target);
  for (const k of Object.keys(source)) {
    if (source[k] !== null && typeof source[k] === 'object' && !Array.isArray(source[k]) && target[k] && typeof target[k] === 'object') {
      result[k] = deepMerge(target[k], source[k]);
    } else if (source[k] !== null && source[k] !== undefined) {
      result[k] = source[k];
    }
  }
  return result;
}
window.deepMerge = deepMerge;

/** 将 hub/overview 等松散 JSON 规范为可 deepMerge 的对象，避免 null/数组 导致下游抛错 */
function sanitizeOverviewPayload(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return {};
  var pickObj = function (v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  };
  try {
    var out = Object.assign({}, src);
    if ('user' in out) out.user = pickObj(out.user);
    if ('company' in out) out.company = pickObj(out.company);
    if ('metrics' in out) out.metrics = pickObj(out.metrics);
    if ('flags' in out) out.flags = pickObj(out.flags);
    if ('impact' in out) out.impact = pickObj(out.impact);
    if ('wallet' in out) out.wallet = pickObj(out.wallet);
    if ('macro' in out) out.macro = pickObj(out.macro);
    if ('cbam' in out && out.cbam != null && typeof out.cbam === 'object' && !Array.isArray(out.cbam)) {
      out.cbam = pickObj(out.cbam);
    }
    return out;
  } catch (_) {
    return {};
  }
}
window.sanitizeOverviewPayload = sanitizeOverviewPayload;

/* ═══════════════════════════════════════════════════════════════════════
   13 · API 层 —— 在线优先，3s 超时自动降级 MOCK
   ═══════════════════════════════════════════════════════════════════════ */
async function fetchWithTimeout(url, opts={}, ms=API_TIMEOUT_MS) {
  const ctrl  = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal:ctrl.signal });
    clearTimeout(timer);
    return r;
  } catch(e) {
    clearTimeout(timer);
    throw e;
  }
}

async function apiFetch(endpoint, options={}) {
  const token = getToken();
  const headers = { 'Content-Type':'application/json', ...(options.headers||{}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const r = await fetchWithTimeout(`${API_BASE}${endpoint}`, { ...options, headers });
  if (r.status === 401) { clearToken(); return null; }
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const d = await r.json(); msg = d.detail||d.error||msg; } catch{}
    throw new Error(msg);
  }
  if (r.status === 204) return null;
  return r.json();
}
window.apiFetch = apiFetch;

/* ═══════════════════════════════════════════════════════════════════════
   14 · LocalStorage 缓存持久化
   ═══════════════════════════════════════════════════════════════════════ */
function loadCachedState() {
  try {
    const raw = localStorage.getItem(LS_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function saveCachedState(state) {
  try {
    const st = state || {};
    const slim = {
      user: st?.user, company: st?.company, metrics: st?.metrics,
      flags: st?.flags, wallet: st?.wallet, macro: st?.macro,
      _ts: Date.now(),
    };
    localStorage.setItem(LS_CACHE_KEY, JSON.stringify(slim));
  } catch {}
}

/* ═══════════════════════════════════════════════════════════════════════
   14b · AppState 跨页神经同步（BroadcastChannel）— 用 var 防呆
   ═══════════════════════════════════════════════════════════════════════ */
var STATE_SRC_ID = (window.__HENGAI_STATE_SRC_ID = window.__HENGAI_STATE_SRC_ID
  || ('hengai_state_' + Math.random().toString(36).slice(2, 10)));
var _stateChannel = null;
var _stateSyncLastTs = 0;
var _appStateBcInited = false;

function broadcastStatePatch(delta) {
  if (!delta || typeof delta !== 'object') return;
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    _stateChannel = _stateChannel || new BroadcastChannel(BC_STATE_CHANNEL);
    _stateChannel.postMessage({ type: 'STATE_PATCH', delta, _ts: Date.now(), _src: STATE_SRC_ID });
  } catch (e) {
    console.warn('[AppState] broadcastStatePatch', e);
  }
}
window.broadcastStatePatch = broadcastStatePatch;

function applyIncomingStatePatch(msg) {
  if (!msg || msg.type !== 'STATE_PATCH' || !msg.delta) return;
  if (msg._src === STATE_SRC_ID) return;
  const ts = Number(msg._ts || 0);
  if (ts && ts <= _stateSyncLastTs) return;
  _stateSyncLastTs = ts || Date.now();
  Object.assign(window.AppState, deepMerge(window.AppState, msg.delta));
  try { saveCachedState(window.AppState); } catch {}
  syncAppState(undefined, { fromRemote: true });
  try {
    if (window.HengAI && typeof window.HengAI.syncAllInternalData === 'function') {
      window.HengAI.syncAllInternalData(window.AppState);
    }
  } catch {}
}

function initAppStateBroadcastListener() {
  if (_appStateBcInited) return;
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    _stateChannel = _stateChannel || new BroadcastChannel(BC_STATE_CHANNEL);
    _stateChannel.onmessage = (e) => applyIncomingStatePatch(e?.data);
    _appStateBcInited = true;
  } catch {}
}
window.initAppStateBroadcastListener = initAppStateBroadcastListener;

function patchAppState(delta, opts) {
  if (!delta || typeof delta !== 'object') return window.AppState;
  if (opts?.fromRemote) return window.AppState;
  Object.assign(window.AppState, deepMerge(window.AppState, delta));
  try { saveCachedState(window.AppState); } catch {}
  const syncOpts = { emitStateSynced: opts && opts.emitStateSynced === false ? false : true };
  syncAppState(undefined, syncOpts);
  try {
    if (window.HengAI && typeof window.HengAI.syncAllInternalData === 'function') {
      window.HengAI.syncAllInternalData(window.AppState);
    }
  } catch {}
  if (!opts?.skipBroadcast) broadcastStatePatch(delta);
  return window.AppState;
}
window.patchAppState = patchAppState;

/* ═══════════════════════════════════════════════════════════════════════
   15 · 宏观价源 —— BroadcastChannel + localStorage 跨标签同步（防呆）
   ═══════════════════════════════════════════════════════════════════════ */
var MACRO_SRC_ID = (window.__HENGAI_MACRO_SRC_ID = window.__HENGAI_MACRO_SRC_ID
  || ('appstate_' + Math.random().toString(36).slice(2, 8)));
var _macroSyncLastTs   = 0;
var _macroChannel      = null;
var _macroDebounce     = null;
var _macroPillTimer    = null;

function getMacroOracle() {
  const fb = { cbam_current_price:75.36, eur_cny_rate:7.85, last_updated:'' };
  if (!window.AppState) return fb;
  if (!window.AppState.macro) window.AppState.macro = { ...fb };
  return window.AppState.macro;
}
window.getMacroOracle = getMacroOracle;

function pulseMacroSyncPill(text) {
  let el = document.getElementById('macroSyncPill');
  if (!el) {
    el = document.createElement('div');
    el.id = 'macroSyncPill';
    el.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:10002;padding:6px 10px;border-radius:999px;background:rgba(16,185,129,0.14);border:1px solid rgba(16,185,129,0.45);color:#8ff2cc;font-size:11px;font-weight:600;pointer-events:none;opacity:0;transform:translateY(6px);transition:opacity .2s,transform .2s;';
    document.body?.appendChild(el);
  }
  el.textContent = text||'宏观价源已同步';
  el.style.opacity='1'; el.style.transform='translateY(0)';
  clearTimeout(_macroPillTimer);
  _macroPillTimer = setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(6px)'; }, 1400);
}

function publishMacroSync(patch) {
  const macro   = getMacroOracle();
  const payload = {
    cbam_current_price: Number(patch?.cbam_current_price ?? macro.cbam_current_price) || 75.36,
    eur_cny_rate:       Number(patch?.eur_cny_rate       ?? macro.eur_cny_rate)        || 7.85,
    last_updated:       patch?.last_updated || macro.last_updated || new Date().toISOString().slice(0, 10),
    _ts: Date.now(),
    _src: MACRO_SRC_ID,
  };
  macro.cbam_current_price = payload.cbam_current_price;
  macro.eur_cny_rate       = payload.eur_cny_rate;
  macro.last_updated       = payload.last_updated;
  syncMacroUi();
  pulseMacroSyncPill('已同步');
  try { localStorage.setItem(LS_MACRO_KEY, JSON.stringify(payload)); } catch {}
  try { _macroChannel?.postMessage(payload); } catch {}
}
window.publishMacroSync = publishMacroSync;

function applyIncomingMacroSync(payload) {
  if (!payload || payload._src === MACRO_SRC_ID) return;
  const ts = Number(payload._ts||0);
  if (ts && ts <= _macroSyncLastTs) return;
  _macroSyncLastTs = ts || Date.now();
  const macro = getMacroOracle();
  const p     = Number(payload.cbam_current_price);
  const fx    = Number(payload.eur_cny_rate);
  if (!isNaN(p)  && p  > 0) macro.cbam_current_price = p;
  if (!isNaN(fx) && fx > 0) macro.eur_cny_rate = fx;
  if (payload.last_updated) macro.last_updated = payload.last_updated;
  syncMacroUi();
  pulseMacroSyncPill('跨标签同步成功');
}

function syncMacroUi() {
  const macro = getMacroOracle();
  const price = Number(macro.cbam_current_price)||75.36;
  const fx    = Number(macro.eur_cny_rate)||7.85;
  const updated = macro.last_updated || '';
  const ids = {
    'f-price':        String(price.toFixed(2)),
    'f-fx':           String(fx.toFixed(2)),
    'wgCbamPrice':    String(price.toFixed(2)),
    'wgFxRate':       String(fx.toFixed(2)),
    'rb-price':       `€${price.toFixed(2)}`,
    'slider-display': `€${price.toFixed(2)}（当前）`,
  };
  Object.entries(ids).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName==='INPUT') { if (el.value!==val) el.value=val; }
    else { if (el.textContent!==val) el.textContent=val; }
  });
  const sliders = ['slider-price','result-slider'];
  sliders.forEach(id => { const el=document.getElementById(id); if(el) el.value=String(Math.round(price)); });
  const wgP = document.getElementById('wgCbamPrice');
  const wgU = document.getElementById('wgLastUpdate');
  if (wgP) wgP.textContent = price.toFixed(2);
  if (wgU) wgU.textContent = updated || '—';
  const hPrice = document.getElementById('h-price');
  if (hPrice && !wgP) hPrice.textContent = `⚡ 实时挂钩 EU ETS 官方牌价：€${price.toFixed(2)}（更新于 ${updated}）`;
}
window.syncMacroUi = syncMacroUi;

function initMacroRealtimeSync() {
  if (typeof BroadcastChannel !== 'undefined') {
    try {
      _macroChannel = new BroadcastChannel(BC_MACRO_CHANNEL);
      _macroChannel.onmessage = e => applyIncomingMacroSync(e?.data);
    } catch {}
  }
  window.addEventListener('storage', e => {
    if (e.key!==LS_MACRO_KEY||!e.newValue) return;
    try { applyIncomingMacroSync(JSON.parse(e.newValue)); } catch {}
  });
  /* 监听 CBAM 价格输入框 */
  document.addEventListener('input', e => {
    const id = e?.target?.id;
    if (!['f-price','f-fx','wgCbamPrice','wgFxRate'].includes(id)) return;
    clearTimeout(_macroDebounce);
    _macroDebounce = setTimeout(() => {
      const macro = getMacroOracle();
      const priceEl = document.getElementById('f-price') || document.getElementById('wgCbamPrice');
      const fxEl    = document.getElementById('f-fx')    || document.getElementById('wgFxRate');
      publishMacroSync({
        cbam_current_price: Number(priceEl?.value || macro.cbam_current_price),
        eur_cny_rate:       Number(fxEl?.value    || macro.eur_cny_rate),
      });
    }, 120);
  });
  /* 恢复上次缓存的宏观值 */
  try {
    const cached = JSON.parse(localStorage.getItem(LS_MACRO_KEY)||'{}');
    if (cached.cbam_current_price) applyIncomingMacroSync(cached);
  } catch {}
}

/* ═══════════════════════════════════════════════════════════════════════
   16 · Toast 通知（全局复用）
   ═══════════════════════════════════════════════════════════════════════ */
var _toastTimer;
function showToast(msg, type='ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(20px);z-index:9999;padding:9px 18px;border-radius:12px;font-size:13px;font-weight:500;white-space:nowrap;pointer-events:none;opacity:0;transition:opacity .2s,transform .2s;';
    document.body?.appendChild(el);
  }
  const colors = {
    ok:   { bg:'rgba(29,158,117,0.18)', border:'rgba(29,158,117,0.45)', color:'#6dd5b0' },
    err:  { bg:'rgba(226,75,74,0.16)',  border:'rgba(226,75,74,0.4)',   color:'#fca5a5' },
    warn: { bg:'rgba(201,168,76,0.16)', border:'rgba(201,168,76,0.4)',  color:'#f0d080' },
  };
  const c = colors[type] || colors.ok;
  el.style.background = c.bg;
  el.style.border     = `1px solid ${c.border}`;
  el.style.color      = c.color;
  el.textContent      = msg;
  el.style.opacity    = '1';
  el.style.transform  = 'translateX(-50%) translateY(0)';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(20px)';
  }, 2800);
}
window.showToast = showToast;

/* ═══════════════════════════════════════════════════════════════════════
   17 · initAppState() —— 每页异步初始化入口
       调用方式：在 DOMContentLoaded 后执行
       window.addEventListener('DOMContentLoaded', () => initAppState(onReady));
   ═══════════════════════════════════════════════════════════════════════ */
async function initAppState(onReady) {
  if (!window.AppState.flags || typeof window.AppState.flags !== 'object') window.AppState.flags = {};
  window.AppState.flags.hubOverviewReady = false;
  try { updateHubSyncGate(window.AppState); } catch (_) {}

  /* Step 1: 先从缓存恢复骨架（不视为 hub 已就绪） */
  const cached = loadCachedState();
  if (cached) {
    try {
      Object.assign(window.AppState, deepMerge(window.AppState, sanitizeOverviewPayload(cached)));
    } catch (e) {
      console.warn('[HengAI] 本地缓存合并失败，使用默认骨架', e);
    }
    syncAppState();
  }

  /* Step 2: 尝试在线 API（3s 超时） */
  const token = getToken();
  let liveState = null;
  let overviewHttpOk = false;
  if (token) {
    try {
      const r = await fetchWithTimeout(
        API_HUB_OVERVIEW,
        { credentials:'include', headers:{ Accept:'application/json', Authorization:`Bearer ${token}` } },
        API_TIMEOUT_MS
      );
      if (r.ok) {
        overviewHttpOk = true;
        var rawLive = await r.json().catch(function () { return null; });
        liveState = sanitizeOverviewPayload(rawLive || {});
      } else {
        console.warn(`[HengAI] /api/v1/hub/overview 返回 HTTP ${r.status}，维持缓存/骨架`);
        try { EventBus.emit('HUB_FETCH_FAILED', { status: r.status }); } catch (_) {}
      }
    } catch (e) {
      console.warn('[HengAI] /api/v1/hub/overview 拉取失败：', e.message);
      EventBus.emit('HUB_FETCH_FAILED', { error: e });
    }
  }

  /* Step 3: 合并并灌注（在线 → live；缺数据 → 维持上次 cache 或空骨架） */
  if (liveState && Object.keys(liveState).length) {
    try {
      Object.assign(window.AppState, deepMerge(window.AppState, liveState));
      try {
        const lu = liveState.user;
        if (lu && (lu.created_at || lu.createdAt)) {
          window.AppState.user = window.AppState.user || {};
          window.AppState.user.regDate = lu.created_at || lu.createdAt;
        }
        if (liveState.diagnostic && liveState.diagnostic.generatedAt) {
          window.AppState.diagnostic = window.AppState.diagnostic || {};
          window.AppState.diagnostic.generatedAt = liveState.diagnostic.generatedAt;
        }
      } catch (_) {}
      saveCachedState(window.AppState);
      window.AppState._mode = 'live';
    } catch (mergeErr) {
      console.warn('[HengAI] overview 合并失败，保持缓存/骨架', mergeErr);
      try { EventBus.emit('HUB_MERGE_FAILED', { error: mergeErr }); } catch (_) {}
    }
  } else if (!cached) {
    window.AppState._mode = 'pending';
  }

  if (!window.AppState.flags) window.AppState.flags = {};
  window.AppState.flags.hubOverviewReady = !!(token && overviewHttpOk);
  try { updateHubSyncGate(window.AppState); } catch (_) {}

  /* Step 4: 同步 auth 状态 */
  if (token && liveState?.user && Object.keys(liveState.user).length) {
    window.AppState.auth.user  = liveState.user;
    window.AppState.auth.token = token;
  }

  /* Step 5: 初始化宏观价源跨标签同步 */
  initMacroRealtimeSync();
  initAppStateBroadcastListener();

  /* Step 6: 全量 DOM 灌注 */
  syncAppState();

  /* Step 7: 回调 */
  if (typeof onReady === 'function') {
    try { onReady(window.AppState); } catch(e) { console.warn('[AppState] onReady error', e); }
  }

  EventBus.emit('APP_READY', window.AppState);
  return window.AppState;
}
window.initAppState = initAppState;

/* ═══════════════════════════════════════════════════════════════════════
   18 · 便捷工具
   ═══════════════════════════════════════════════════════════════════════ */
/* 防抖 */
function debounce(fn, ms=200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(()=>fn(...args), ms); };
}
window.debounce = debounce;

/**
 * 架构自检（控制台）：AppState、/hub/overview、幽灵硬编码扫描。
 * 用法：在已打开前端的页面控制台执行 `await HengAIAudit()`。
 */
window.HengAIAudit = async function HengAIAudit() {
  console.log('%c🔍 正在执行 HengAI 全域架构大体检...', 'color: #10B981; font-weight: bold; font-size: 16px;');

  if (!window.AppState) {
    console.error('❌ 致命：AppState 根本没加载，整个系统是死的！');
  }

  const overviewUrl = window.API_HUB_OVERVIEW || (String(window.API_BASE || 'http://localhost:8000').replace(/\/+$/, '') + '/api/v1/hub/overview');
  const token = typeof getToken === 'function' ? getToken() : (localStorage.getItem('hengai_token') || localStorage.getItem('authToken'));

  try {
    const res = await fetch(overviewUrl, {
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
    });
    if (res.status === 404) console.error('❌ 接口断裂：/hub/overview 路径错误或后端未挂载！');
    if (res.status === 401) console.error('❌ 权限阻断：Token 已过期或无效（或未登录）！');
    if (res.ok) console.info('%c✔ /hub/overview HTTP 200', 'color:#6dd5b0');
  } catch (e) {
    console.error('❌ 网络断开：后端服务可能未启动或跨域被拦 —', e && e.message);
  }

  function collectVisibleText(root) {
    const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
    const buf = [];
    const tw = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let p = node.parentElement;
        while (p) {
          if (skip.has(p.tagName)) return NodeFilter.FILTER_REJECT;
          p = p.parentElement;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = tw.nextNode())) {
      const t = n.nodeValue;
      if (t && String(t).trim()) buf.push(String(t));
    }
    return buf.join('\n');
  }

  const visibleText = collectVisibleText(document.body);
  const ghostChecks = [
    { label: '王磊', ok: !visibleText.includes('王磊') },
    { label: '王L', ok: !visibleText.includes('王L') },
    { label: '2,840', ok: !visibleText.includes('2,840') },
    { label: '145,000', ok: !visibleText.includes('145,000') },
    { label: '1.82', ok: !/(^|[^\d.])1\.82([^\d]|$)/.test(visibleText) },
    { label: '128', ok: !/(^|[^\d])128([^\d]|$)/.test(visibleText.replace(/,/g, '')) },
  ];
  ghostChecks.forEach(({ label, ok }) => {
    if (!ok) console.error(`🚨【幽灵数据·展示区】InnerText 仍含写死样例「${label}」——立即清除！`);
  });

  console.log('%c✅ 体检结束。红字为阻断级；合法因子仅允许出现在 data-* 等属性中（本扫描不读属性）。', 'color: #3b82f6; font-weight: bold;');
};

/* 简写 $ */
window.$ = id => document.getElementById(id);

/* 模式标识（console 提示） */
function bindAppStateInstanceMethods() {
  const a = window.AppState;
  if (!a || !AppState) return;
  a.patchState = patchAppState;
  /** CBAM 等模块：合并 delta + 全量 dyn-* 刷新（patchAppState 已 sync，此处再补 sync() 的 GM 特护） */
  /** 生命周期「存入」：仅内存 + dyn 灌注，不广播 STATE_SYNCED / 不跨标签 patch（落库见 commit） */
  a.update = function (delta) {
    patchAppState(delta || {}, { emitStateSynced: false, skipBroadcast: true });
    return a;
  };
  const names = ['updateAuth', 'updateGM', 'setGM', 'addContext', 'incrementTurn', 'updateField'];
  names.forEach((k) => {
    if (typeof AppState[k] === 'function') a[k] = AppState[k];
  });
}
window.bindAppStateInstanceMethods = bindAppStateInstanceMethods;

bindAppStateInstanceMethods();

initAppStateBroadcastListener();

console.info(
  '%c[HengAI AppState V3.2]%c 引擎已装载 · 等待 initAppState() 调用',
  'color:#6dd5b0;font-weight:700', 'color:#8a95a8'
);
