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

/** 开发环境统一 host：127.0.0.1 与 localhost 的 localStorage 互不共享，混用会导致反复登录 */
(function hengaiCanonicalDevHost() {
  try {
    var loc = window.location;
    if (loc.protocol === 'http:' && loc.hostname === '127.0.0.1' && String(loc.port || '80') === '8000') {
      window.location.replace(String(loc.href).replace('//127.0.0.1:8000', '//localhost:8000'));
    }
  } catch (_) {}
})();

/* ═══════════════════════════════════════════════════════════════════════
   0 · 常量（全部走 window.X = window.X || ... 防呆模式）
   ═══════════════════════════════════════════════════════════════════════ */
if (window.API_BASE == null || window.API_BASE === undefined) {
  window.API_BASE = (window.APP_CONFIG && (window.APP_CONFIG.API_BASE || window.APP_CONFIG.api_base)) ?? '';
}

/** 同源优先：页面从 :8000/static 打开时用 location.origin，避免 127.0.0.1 ↔ localhost 跨域导致 POST /chat 失败 */
function hengaiApiOrigin() {
  var b = String(window.API_BASE ?? '').replace(/\/+$/, '');
  if (b) return b.replace(/\/api\/v1$/i, '');
  try {
    if (typeof window !== 'undefined' && window.location && /^https?:/.test(window.location.protocol || '')) {
      return String(window.location.origin || '').replace(/\/+$/, '');
    }
  } catch (_) {}
  return 'http://localhost:8000';
}
window.hengaiApiOrigin = hengaiApiOrigin;
window.API_BASE = hengaiApiOrigin();
var API_BASE = window.API_BASE;

window.API_AUTH_ME_URL = window.API_AUTH_ME_URL || (hengaiApiOrigin() + '/api/v1/auth/me');
window.API_CHAT_URL = window.API_CHAT_URL || (hengaiApiOrigin() + '/api/v1/chat');
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
window.FACTOR_STATUS = window.FACTOR_STATUS || Object.freeze({
  LV4_CERTIFIED: 'lv4_certified',
  INDUSTRY_AVG: 'industry_avg',
  RESONATING: 'resonating',
  MISSING: 'missing',
});
var FACTOR_STATUS = window.FACTOR_STATUS;
window.DATA_QUALITY_LEVEL = window.DATA_QUALITY_LEVEL || Object.freeze({
  LV4: 'lv4',
  INDUSTRY_AVG: FACTOR_STATUS.INDUSTRY_AVG,
  RESONATING: FACTOR_STATUS.RESONATING,
  MISSING: FACTOR_STATUS.MISSING,
});
var DATA_QUALITY_LEVEL = window.DATA_QUALITY_LEVEL;

/** 身份感知路由 · SME 下游认领 vs 工业原厂签发 */
window.USER_ROLE = window.USER_ROLE || Object.freeze({
  GUEST:  'ROLE_GUEST',
  SME:    'ROLE_SME',
  ORIGIN: 'ROLE_ORIGIN',
});
var USER_ROLE = window.USER_ROLE;

/** 全域中心三阶段 Tab 预览配置（仅此一处定义，禁止在 HTML / app.js 重复声明） */
window.PHASE_CFG = window.PHASE_CFG || {
  1: {
    gm: 0, badgeText: '阶段一 · 个体启蒙',
    badgeStyle: 'background:var(--green-d);color:var(--green-l);border:1px solid var(--green-b)',
    phaseClass: 'ph1', phaseDot: 'var(--green)', phaseText: '个体启蒙期',
    shFill: 'rgba(16,185,129,.12)', shStroke: '#10b981', shNum: '1', shLbl: 'Lv.1', shColor: 'var(--green)',
    idMeta: '注册于 — · HengAI 个人月度会员',
    idTags: '<span class="pill p-green">Lv.1 观察员</span><span class="pill p-gray">CBAM 合规学习者</span>',
    role: '个人会员 · 月付',
    btnA: '升级年付', btnP: '建立企业档案 →',
    tabCls: 'on-ph1',
    ptabs: ['on-ph1', '', '']
  },
  2: {
    gm: 0, badgeText: '阶段二 · 业务映射',
    badgeStyle: 'background:var(--gold-d);color:var(--gold-l);border:1px solid var(--gold-b)',
    phaseClass: 'ph2', phaseDot: 'var(--gold)', phaseText: '业务映射期',
    shFill: 'rgba(201,168,76,.12)', shStroke: '#c9a84c', shNum: '3', shLbl: 'Lv.3', shColor: 'var(--gold)',
    idMeta: '注册于 — · HengAI 个人年付会员',
    idTags: '<span class="pill p-gold">Lv.3 架构师</span><span class="pill p-green">CBAM 专家</span><span class="pill p-blue">Scope 3 穿透中</span>',
    role: '个人会员 · 年付',
    btnA: '申请企业升级', btnP: '生成升级报告 →',
    ptabs: ['', 'on-ph2', '']
  },
  3: {
    gm: 0, badgeText: '阶段三 · 全域共治',
    badgeStyle: 'background:var(--purple-d);color:var(--purple-l);border:1px solid var(--purple-b)',
    phaseClass: 'ph3', phaseDot: 'var(--purple)', phaseText: '全域共治期',
    shFill: 'rgba(139,92,246,.12)', shStroke: '#8b5cf6', shNum: '5', shLbl: 'Lv.5', shColor: 'var(--purple-l)',
    idMeta: '注册于 — · HengAI 企业旗舰版',
    idTags: '<span class="pill p-purple">Lv.5 生态领袖</span><span class="pill p-gold">地球公民勋章</span><span class="pill p-teal">Global Eco-Advisor</span>',
    role: '企业账户 · 旗舰版',
    btnA: '全域枢纽已激活', btnP: '进入生态枢纽 →',
    ptabs: ['', '', 'on-ph3']
  }
};
var PHASE_CFG = window.PHASE_CFG;

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
/*
  新增 EventBus 事件说明：

  CONSUMPTION_LEDGER_UPDATED
  - 发射方：核验模块（HengAI_核验.html）每次证书签发后
  - 监听方：工业原厂精算（HengAI_工业原厂精算.html）
  - payload: {
      factoryAnonymousId, usageCount, carbonTonnage,
      taxSavedEur, serviceFeeEur, nursingFundEur,
      claimedCompanyName (如用户选择认领则有值，否则为null)
    }
  - 用途：更新因子消费账本

  SUPPLY_CHAIN_BINDING_CHECK
  - 发射方：核验模块在引用因子前
  - 监听方：不监听，直接同步调用 checkSupplyChainBinding()
  - 用途：校验下游企业是否有申报该原厂为上游供应商
  - 校验通过：允许引用认证因子
  - 校验失败：降级为行业均值，提示"请管理员申报供应链关系"

  FACTORY_PARTNER_INVITE_SENT
  - 发射方：工业原厂精算（点击"发起合作邀请"按钮）
  - 监听方：全域中心（更新通知角标）
  - payload: { targetConsumerId, factoryName, inviteType }
*/

/**
 * 统一角色守卫 helper（避免各模块重复写 admin-only/compliance-visible）
 * @param {Document|Element} root 根节点（默认 document）
 * @param {Object} state AppState 或模块 state
 * @returns {{roleLevel:string,isAdmin:boolean}}
 */
function applyRoleVisibility(root, state) {
  var host = root && typeof root.querySelectorAll === 'function' ? root : document;
  var s = state || window.AppState || {};
  var roleLevel = (
    (s.company && s.company.roleLevel) ||
    ((window.AppState || {}).company || {}).roleLevel ||
    'compliance'
  );
  var isAdmin = roleLevel === 'admin';
  var adminOnlyBlocks = host.querySelectorAll('.admin-only');
  adminOnlyBlocks.forEach(function (el) { el.style.display = isAdmin ? '' : 'none'; });
  var complianceBlocks = host.querySelectorAll('.compliance-visible');
  complianceBlocks.forEach(function (el) { el.style.display = ''; });
  return { roleLevel: roleLevel, isAdmin: isAdmin };
}
window.applyRoleVisibility = applyRoleVisibility;

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

/** 从 JWT 解析 user id（sub），仅用于本地缓存分桶，不做鉴权 */
function parseJwtSub(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64));
    return payload.sub ? String(payload.sub) : null;
  } catch (_) {
    return null;
  }
}

function hubCacheStorageKey(userId) {
  return userId ? (LS_CACHE_KEY + ':' + userId) : LS_CACHE_KEY;
}

/** 清除全域 hub 本地缓存（含历史未分桶的全局键） */
function clearAllHubUserCaches() {
  try {
    localStorage.removeItem(LS_CACHE_KEY);
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k === LS_CACHE_KEY || k.indexOf(LS_CACHE_KEY + ':') === 0)) drop.push(k);
    }
    drop.forEach(function (k) { localStorage.removeItem(k); });
  } catch (_) {}
}

var ENT_EXTRA_LS_PREFIX = 'hengai_enterprise_profile_extra_v1';
var _authSwitchEpoch = Date.now();

/** 换号/登出时保留的 localStorage（宏观价源、记住密码偏好） */
var LS_KEEP_ON_AUTH_SWITCH = {
  hengai_login_remember_v1: true,
  hengai_macro_sync_v1: true,
};

/** 换号/登出时必须清掉的 localStorage 前缀（公用申报终端 · 会话隔离） */
var LS_PURGE_ON_AUTH_SWITCH_PREFIXES = [
  'hengai_hub_cache_v1',
  ENT_EXTRA_LS_PREFIX,
  'hengai_index_chat_v1',
  'hengai_supplier_submitted',
  'hengai_supply_invite_sent',
  'hengai_supply_table_expanded_v1',
  'hengai_cbam_return_draft_v1',
  'hengai_auth_return_v1',
  'hengai_cbam_guest_identity_v1',
  'hengai_hi_local_vault_v1',
  'hengai_hi_production_line',
];

function bumpAuthSwitchEpoch() {
  _authSwitchEpoch = Date.now();
}

function _localStorageKeyShouldPurgeOnAuthSwitch(key) {
  if (!key || key === LS_TOKEN_KEY || key === LS_TOKEN_ALT) return false;
  if (LS_KEEP_ON_AUTH_SWITCH[key]) return false;
  if (key === 'authToken') return true;
  for (let i = 0; i < LS_PURGE_ON_AUTH_SWITCH_PREFIXES.length; i++) {
    const prefix = LS_PURGE_ON_AUTH_SWITCH_PREFIXES[i];
    if (key === prefix || key.indexOf(prefix + ':') === 0) return true;
  }
  return false;
}

/** 清除企业档案 extra、overview 内存快照、共振 session 等跨账号污染源（无需用户手动操作） */
function purgeClientStateForAuthSwitch() {
  clearAllHubUserCaches();
  bumpAuthSwitchEpoch();
  try {
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && _localStorageKeyShouldPurgeOnAuthSwitch(k)) drop.push(k);
    }
    drop.forEach(function (k) { localStorage.removeItem(k); });
  } catch (_) {}
  try { window.__hubOverviewData = null; } catch (_) {}
  try { window.__hubPipelineLastPayload = null; } catch (_) {}
  try { window.__lastCompanyPayload = null; } catch (_) {}
  try {
    sessionStorage.removeItem('hengai_user_resonance_rank');
    sessionStorage.removeItem('hengai_user_resonance_requested');
    sessionStorage.removeItem('hengai_resonance_from');
    sessionStorage.removeItem('hengai_hub_page');
    sessionStorage.removeItem('hengai_hi_sovereignty_mode');
    sessionStorage.removeItem('hengai_last_supplier_invite');
    sessionStorage.removeItem('hengai_hi_local_vault_v1');
    sessionStorage.removeItem('hengai_hi_production_line');
  } catch (_) {}
  try { window.MANUAL_PREVIEW = false; } catch (_) {}
  try { window.__hubPhaseBootstrapped = false; } catch (_) {}
  try { window.__hubSidebarNavBooted = false; } catch (_) {}
  try { window.__hubActivePage = null; } catch (_) {}
  try { window.__hengaiGenIncomeLastGood = null; } catch (_) {}
  try { window.__hengaiSupplierRowCache = null; } catch (_) {}
  try { window.__claimWorkbenchTier = null; } catch (_) {}
  try { window.__hengaiEmbedGm = null; } catch (_) {}
  try { if (window.AppState) { delete window.AppState.currentPhase; delete window.AppState.champion_level; } } catch (_) {}
}

var AUTHORITATIVE_OVERVIEW_KEYS = [
  'user', 'company', 'metrics', 'impact', 'wallet', 'macro', 'cbam', 'flags',
  'recentReports', 'badges', 'suppliers', 'supplierNodes', 'gmTransactions',
  'compute', 'euCustoms', 'dld', 'acf', 'governance', 'diagnostic',
  'decisionPacks', 'dldApplications', 'resonance', 'activityTimeline', 'milestones',
  'fortress', 'gmLedger', 'industryAudit', 'verified_origin_pool', 'journey',
  'factorAuth', 'batchVerification',
];

function currentAuthUserId() {
  const fromJwt = parseJwtSub(getToken());
  if (fromJwt) return String(fromJwt);
  const u = window.AppState && window.AppState.user;
  if (u && (u.id || u.userId)) return String(u.id || u.userId);
  return null;
}

/** overview / 缓存快照是否属于当前 JWT 用户（已登录且无 owner → 拒绝，防公用机串号） */
function hubOverviewUserMatchesCurrent(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const uid = currentAuthUserId();
  if (!uid) return true;
  const owner = payload._ownerUserId || (payload.user && (payload.user.id || payload.user.userId));
  if (!owner) return false;
  return String(owner) === uid;
}

/** 用 overview 权威分支整枝替换 AppState（禁止 deepMerge 残留旧账号字段） */
function replaceAuthoritativeAppStateFromLive(live) {
  if (!live || typeof live !== 'object') return;
  const sanitized = typeof sanitizeOverviewPayload === 'function'
    ? sanitizeOverviewPayload(live) : live;
  const mock = JSON.parse(JSON.stringify(MOCK_STATE));
  AUTHORITATIVE_OVERVIEW_KEYS.forEach(function (k) {
    if (sanitized[k] !== undefined && sanitized[k] !== null) {
      window.AppState[k] = sanitized[k];
    } else if (mock[k] !== undefined) {
      /* overview 不下发 factorAuth / batchVerification 时保留已入池/核验缓存，禁止 MOCK 清零 */
      if ((k === 'factorAuth' || k === 'batchVerification') && window.AppState[k] && typeof window.AppState[k] === 'object') {
        return;
      }
      window.AppState[k] = JSON.parse(JSON.stringify(mock[k]));
    }
  });
  if (sanitized.serverTime) window.AppState.serverTime = sanitized.serverTime;
  window.AppState._mode = 'live';
}

/** 切换账号时重置内存 AppState 为 MOCK 骨架（不保留旧 auth / 旧业务数据） */
function resetAppStateShellOnAuthSwitch(opts) {
  const keepToken = !!(opts && opts.keepToken);
  const token = keepToken ? getToken() : null;
  const mock = JSON.parse(JSON.stringify(MOCK_STATE));
  Object.assign(window.AppState, mock, {
    auth: { user: null, token: token },
    chat: { messages: [], turnCount: 0, isStreaming: false, guestLimit: 5, lastUserText: '' },
    contextTags: [],
    justSawROI: false,
    _mode: 'pending',
  });
  if (!window.AppState.flags) window.AppState.flags = {};
  window.AppState.flags.hubOverviewReady = false;
  bumpAuthSwitchEpoch();
}

/** 服务端 appState 整枝替换（带 JWT 归属校验，禁止 deepMerge 窝蛋） */
function mergeAuthoritativeAppStateFromServer(appStateRaw) {
  if (!appStateRaw || typeof appStateRaw !== 'object' || !Object.keys(appStateRaw).length) return false;
  const prevCompany = (window.AppState && window.AppState.company) || {};
  const prevCityState = prevCompany.cityState;
  const prevCert = prevCompany.verifiedFactorCertId || prevCompany.verified_factor_cert_id;
  const sanitized = typeof sanitizeOverviewPayload === 'function'
    ? sanitizeOverviewPayload(appStateRaw) : appStateRaw;
  if (!hubOverviewUserMatchesCurrent(sanitized)) {
    console.warn('[AppState] 丢弃非当前用户的 server appState');
    return false;
  }
  replaceAuthoritativeAppStateFromLive(sanitized);
  try { overlayClientModulesFromCache(); } catch (_) {}
  try { hydrateFactorAuthPoolFromIndustryAudit(window.AppState); } catch (_) {}
  try { syncFactorAuthResonanceFromMetrics(window.AppState); } catch (_) {}
  try { ensureEvidenceContractShape(window.AppState); } catch (_) {}
  try {
    const co = (window.AppState && window.AppState.company) || {};
    const nextCityState = co.cityState;
    const nextCert = co.verifiedFactorCertId || co.verified_factor_cert_id;
    if (nextCityState && (nextCityState !== prevCityState || nextCert !== prevCert)) {
      emitAppStateEvent('SOVEREIGNTY_EVIDENCE_SYNCED', {
        holder: co.name,
        cityState: nextCityState,
        pullEligible: !!co.pullEligible,
        certificateId: nextCert || null,
      });
    }
  } catch (_) {}
  applyBackendJourneyFromState(window.AppState);
  try { saveCachedState(window.AppState); } catch (_) {}
  try { if (typeof mirrorAppStateShadowCopy === 'function') mirrorAppStateShadowCopy(window.AppState); } catch (_) {}
  try { syncAppState(window.AppState, { fromRemote: true }); } catch (_) {}
  return true;
}

/** 新用户 journey：阶段/菜单解锁只信后端 flags，不信本地预览或旧缓存 */
function resolveJourneyPhaseNumber(stateLike) {
  const s = stateLike || window.AppState || {};
  const cp = s && s.flags && s.flags.currentPhase;
  if (cp === 'Phase3') return 3;
  if (cp === 'Phase2') return 2;
  if (cp === 'Phase1') return 1;

  const tierCode = normalizeTierCode(
    (s.user && (s.user.tier_code || s.user.tier)) ||
    (s.auth && s.auth.user && (s.auth.user.tier_code || s.auth.user.tier))
  );
  const wsType = String(
    (s.workspace && s.workspace.workspace_type) ||
    (s.company && s.company.workspace_type) ||
    (s.company && s.company.stage) ||
    ''
  ).toUpperCase();

  if (tierCode === ACCOUNT_TIER.ENT_VERIFIED || wsType.indexOf('CERTIFIED') >= 0) return 3;
  if (tierCode !== ACCOUNT_TIER.GUEST || currentAuthUserId()) return 2;
  return 1;
}
window.resolveJourneyPhaseNumber = resolveJourneyPhaseNumber;

function applyBackendJourneyFromState(s) {
  s = s || window.AppState;
  if (!s || !s.flags) return;
  if (currentAuthUserId()) {
    try { window.MANUAL_PREVIEW = false; } catch (_) {}
    try { window.__hubPhaseBootstrapped = false; } catch (_) {}
  }
  const n = resolveJourneyPhaseNumber(s);
  if (typeof window.setPhase === 'function') {
    try { window.setPhase(n, { fromBackend: true }); } catch (_) {}
  }
  try { syncHubPhaseLocks(s); } catch (_) {}
}
window.parseJwtSub = parseJwtSub;
window.clearAllHubUserCaches = clearAllHubUserCaches;
window.purgeClientStateForAuthSwitch = purgeClientStateForAuthSwitch;
window.resetAppStateShellOnAuthSwitch = resetAppStateShellOnAuthSwitch;
window.hubOverviewUserMatchesCurrent = hubOverviewUserMatchesCurrent;
window.replaceAuthoritativeAppStateFromLive = replaceAuthoritativeAppStateFromLive;
window.mergeAuthoritativeAppStateFromServer = mergeAuthoritativeAppStateFromServer;
window.applyBackendJourneyFromState = applyBackendJourneyFromState;
window.currentAuthUserId = currentAuthUserId;

/** 从 token + /me 或 overview 用户恢复 auth.user，避免「顶栏已登录但对话要求再登」 */
async function hydrateAuthSession(options) {
  var opts = options || {};
  var token = getToken();
  if (!token) {
    AppState.auth.user = null;
    AppState.auth.token = null;
    return false;
  }
  AppState.auth.token = token;
  var au = AppState.auth && AppState.auth.user;
  if (au && typeof au === 'object' && (au.id || au.email || au.name)) {
    return true;
  }
  if (!opts.skipFetch) {
    try {
      var meUrl = window.API_AUTH_ME_URL || (hengaiApiOrigin() + '/api/v1/auth/me');
      var r = await fetch(meUrl, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
      });
      if (r.ok) {
        var data = await r.json();
        var u = (data && (data.user || data.data)) || data;
        if (u && typeof u === 'object' && (u.email || u.name || u.id)) {
          AppState.updateAuth(u, token);
          return true;
        }
      }
      if (r.status === 401 || r.status === 403) {
        clearToken();
        AppState.auth.user = null;
        AppState.auth.token = null;
        return false;
      }
    } catch (e) {
      console.warn('[HengAI] hydrateAuthSession /me 失败', e);
    }
  }
  var ou = AppState.user;
  if (ou && typeof ou === 'object' && (ou.email || ou.name || ou.id || ou.tier)) {
    AppState.updateAuth(Object.assign({}, ou), token);
    return true;
  }
  return false;
}
window.hydrateAuthSession = hydrateAuthSession;

function isSessionLoggedIn() {
  if (!getToken()) return false;
  if (AppState.auth && AppState.auth.user) return true;
  var u = AppState.user;
  return !!(u && (u.email || u.name || u.id));
}
window.isSessionLoggedIn = isSessionLoggedIn;

/* ═══════════════════════════════════════════════════════════════════════
   4 · 认证辅助
   ═══════════════════════════════════════════════════════════════════════ */
function normalizeTierCode(input) {
  const raw = String(input || '').trim();
  if (!raw) return ACCOUNT_TIER.GUEST;
  if (Object.values(ACCOUNT_TIER).includes(raw)) return raw;
  const db = raw.toLowerCase();
  if (db === 'sovereign') return ACCOUNT_TIER.ENT_VERIFIED;
  if (db === 'guardian' || db === 'pioneer') return ACCOUNT_TIER.PRO_PERSONAL;
  if (db === 'seed' || db === 'sprout') return ACCOUNT_TIER.FREE_USER;
  if (/企业|共治|认证|旗舰|sovereign|ent/i.test(raw)) return ACCOUNT_TIER.ENT_VERIFIED;
  if (/专业|pro|年付|月付|guardian|pioneer/i.test(raw)) return ACCOUNT_TIER.PRO_PERSONAL;
  if (/免费|free|体验|seed|sprout/i.test(raw)) return ACCOUNT_TIER.FREE_USER;
  return ACCOUNT_TIER.FREE_USER;
}
window.normalizeTierCode = normalizeTierCode;
function oracleIsLoggedIn()  { return !!(AppState.auth?.user) || !!(getToken() && AppState.user?.isLoggedIn); }

function patchUserLoginFlag(s) {
  const st = s || window.AppState;
  if (!st || !st.user) return st;
  if (st.user.isLoggedIn === true || st.user.isLoggedIn === false) return st;
  const authed = !!(st.auth && st.auth.user);
  st.user.isLoggedIn = authed && st.user.tier_code !== ACCOUNT_TIER.GUEST;
  return st;
}

var ORIGIN_FACTORY_INDUSTRY_CODES = (typeof window.HENGAI_CANONICAL_ORIGIN_INDUSTRIES !== 'undefined'
  && window.HENGAI_CANONICAL_ORIGIN_INDUSTRIES.length)
  ? window.HENGAI_CANONICAL_ORIGIN_INDUSTRIES.concat(['aluminium'])
  : ['steel', 'aluminum', 'aluminium', 'cement', 'petro', 'paper', 'ceramic', 'port', 'idc'];

function isOriginIndustryCode(code) {
  if (typeof window.hengaiIsOriginIndustryCode === 'function') {
    return window.hengaiIsOriginIndustryCode(code);
  }
  const ind = String(code || '').trim().toLowerCase();
  return ORIGIN_FACTORY_INDUSTRY_CODES.includes(ind);
}
window.isOriginIndustryCode = isOriginIndustryCode;

function canonicalIndustryCode(code) {
  if (typeof window.toCanonicalIndustryCode === 'function') {
    return window.toCanonicalIndustryCode(code);
  }
  const ind = String(code || '').trim().toLowerCase();
  if (ind === 'aluminium') return 'aluminum';
  if (ind === 'petrochem' || ind === 'petrochemical' || ind === 'petrochemicals') return 'petro';
  if (ind === 'ceramics') return 'ceramic';
  if (ind === 'datacenter' || ind === 'data_center') return 'idc';
  return ind || 'steel';
}
window.canonicalIndustryCode = canonicalIndustryCode;

function factorUiIndustryKey(code) {
  if (typeof window.toFactorUiIndustryKey === 'function') {
    return window.toFactorUiIndustryKey(code);
  }
  const canon = canonicalIndustryCode(code);
  const map = {
    petro: 'petrochem', ceramic: 'ceramics', idc: 'datacenter',
  };
  return map[canon] || canon;
}
window.factorUiIndustryKey = factorUiIndustryKey;

function resolveUserRoleFromState(state) {
  const s = state || window.AppState || {};
  const flags = s.flags || {};
  if (flags.userRole && flags.userRole !== USER_ROLE.GUEST) return flags.userRole;
  patchUserLoginFlag(s);
  if (!s.user || s.user.isLoggedIn !== true) return USER_ROLE.GUEST;
  const co = s.company || {};
  if (co.type === 'ORIGIN' || co.type === USER_ROLE.ORIGIN) return USER_ROLE.ORIGIN;
  if (isOriginIndustryCode(co.industryCode || co.industry_code)) return USER_ROLE.ORIGIN;
  if (flags.hasOriginFactoryPerm || s.user.workspaceRole === USER_ROLE.ORIGIN) return USER_ROLE.ORIGIN;
  return USER_ROLE.SME;
}
window.patchUserLoginFlag = patchUserLoginFlag;
window.resolveUserRoleFromState = resolveUserRoleFromState;

/** P1 · 精算芯深链占位（自启动 :8001，Hub Done 前不切生产链） */
function getSovereigntyCenterUrl() {
  const cfg = typeof window !== 'undefined' ? window.LOCAL_CONFIG : null;
  const links = cfg && cfg.officialLinks;
  if (links && links.sovereigntyCenter) return String(links.sovereigntyCenter);
  if (links && links.hengaiCore) return String(links.hengaiCore);
  return 'http://localhost:8001';
}

function getCompanyCityState(state) {
  const s = state || window.AppState || {};
  const fa = s.factorAuth || {};
  const co = s.company || {};
  return fa.cityState || co.cityState || null;
}

function cityStateLabel(cityState) {
  const map = {
    evidence_building: '软件实证中',
    mat_pending: '待建城池',
    certified: '正式碳城池',
  };
  return map[cityState] || '未启动实证';
}

function canPullVerifiedFactor(ctx) {
  if (ctx && typeof ctx === 'object') {
    if (ctx.pullEligible === true) return true;
    if (ctx.pullEligible === false) return false;
    if (ctx.cityState) return ctx.cityState === 'certified';
    if (ctx.entry) return canPullVerifiedFactor(ctx.entry);
  }
  const st = window.AppState || {};
  const evMode = st.cbam && st.cbam.evidence && st.cbam.evidence.mode;
  if (evMode && String(evMode).toUpperCase() !== 'SOVEREIGN_VERIFIED') return false;
  const cs = getCompanyCityState(ctx);
  if (cs) return cs === 'certified';
  return true;
}

function findIndustryBoardEntry(query, state) {
  const s = state || window.AppState || {};
  const q = String(query || '').trim().toLowerCase();
  if (!q || q.length < 2) return null;
  const board = (s.resonance && s.resonance.industryBoard) || [];
  if (!Array.isArray(board)) return null;
  let best = null;
  let bestScore = 0;
  board.forEach((row) => {
    const holder = String(row.holder || '').toLowerCase();
    const entity = String(row.productionEntity || '').toLowerCase();
    const cert = String(row.certificateId || '').toLowerCase();
    let score = 0;
    if (holder && (holder.includes(q) || q.includes(holder))) score += 3;
    if (entity && entity.includes(q.replace(/\D/g, ''))) score += 4;
    if (cert && cert.includes(q)) score += 5;
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  });
  return best;
}

window.getSovereigntyCenterUrl = getSovereigntyCenterUrl;
window.getCompanyCityState = getCompanyCityState;
window.cityStateLabel = cityStateLabel;
window.canPullVerifiedFactor = canPullVerifiedFactor;
window.findIndustryBoardEntry = findIndustryBoardEntry;

/* ═══════════════════════════════════════════════════════════════════════
   商业卡口 · 预留注册表（功能阶段 OFF，后期统一改规则 + 开开关）
   纪律：① 页面功能 ② 角色分轨 ③ 话术 ④ 商业卡口（本段）
   开关 false 时：checkCommercialGate / notifyCbamCommercialBlock 一律放行
   ═══════════════════════════════════════════════════════════════════════ */

/** 阶段 ③ 话术/广告牌 · 功能验收阶段 OFF；未与产品确认前禁止在测算中途弹出 */
window.HENGAI_CBAM_FUNNEL_UI_ENABLED = false;

/** 总开关 · 功能验收阶段保持 false；产品定稿后改 true 并只调 COMMERCIAL_GATE_REGISTRY */
window.HENGAI_COMMERCIAL_GATES_ENABLED = false;

/**
 * 卡口预留注册表 · actionId 与代码 hook 一一对应，便于后期统一策略
 * dimension: passport | supplyChainRole | workspaceVault | cityState | mat
 * requires: { login?, minTier?, minPhase?, roles?, cityState?, matRequired? }
 */
window.COMMERCIAL_GATE_REGISTRY = Object.freeze({
  cbam: Object.freeze({
    commit_cbam: Object.freeze({
      page: 'CBAM 测算',
      files: ['cbam-calc-core.js'],
      hook: 'persistCbamCommit → AppState.commit("cbam")',
      dimension: 'passport',
      requires: { login: true, minTier: ACCOUNT_TIER.PRO_PERSONAL },
      note: '保存/落库 CBAM 报告 · 对齐 .cursorrules Paywall 下载/深度',
    }),
    save_report: Object.freeze({
      page: 'CBAM 测算',
      files: ['HengAI_CBAM测算工具.html'],
      hook: 'AS.commit("cbam") 独立页保存',
      dimension: 'passport',
      requires: { login: true, minTier: ACCOUNT_TIER.PRO_PERSONAL },
    }),
    pull: Object.freeze({
      page: 'CBAM 测算',
      files: ['cbam-verified-factor.js'],
      hook: 'pullVerifiedFactorFromPool',
      dimension: 'passport',
      requires: { login: true, roles: [USER_ROLE.SME] },
      note: '登录卡口；Pull 数据资格另由 cityState=certified 控制（非商业）',
    }),
    verify: Object.freeze({
      page: 'CBAM 测算 / 核验',
      files: ['cbam-verified-factor.js', 'HengAI_核验.html'],
      hook: 'pullByVerificationCode',
      dimension: 'passport',
      requires: { login: true, roles: [USER_ROLE.SME] },
    }),
    detect_doc: Object.freeze({
      page: 'CBAM 测算',
      files: ['cbam-verified-factor.js'],
      hook: 'detectOriginFromDoc',
      dimension: 'passport',
      requires: { login: true, roles: [USER_ROLE.SME] },
    }),
    resonance: Object.freeze({
      page: 'CBAM 测算 / 供应链',
      files: ['cbam-v2-tracks.js', 'hengai-supply-resonance.js'],
      hook: 'submitResonanceRequest / eco/resonance-request',
      dimension: 'workspaceVault',
      requires: { login: true, minPhase: 'Phase2' },
    }),
    origin_downstream_action: Object.freeze({
      page: 'CBAM 测算',
      files: ['cbam-identity-sovereignty.js'],
      hook: 'showOriginDownstreamIntercept',
      dimension: 'supplyChainRole',
      requires: { roles: [USER_ROLE.SME] },
      note: '角色分轨（非付费）· 原厂误点 Pull · 由 sovereignty 模块处理，不走商业开关',
    }),
  }),
  enterprise: Object.freeze({
    profile_complete: Object.freeze({
      page: '企业数字档案',
      files: ['HengAI_企业数字档案.html'],
      hook: 'AS.commit("enterprise")',
      dimension: 'workspaceVault',
      requires: { login: true },
      note: '建档本身免费；完整档案解锁 Phase2 菜单',
    }),
  }),
  supply: Object.freeze({
    binding_declare: Object.freeze({
      page: '供应链协同',
      files: ['HengAI_供应链协同.html'],
      hook: 'supply-binding/declare',
      dimension: 'workspaceVault',
      requires: { login: true, minPhase: 'Phase2' },
    }),
    cl_mat_provision: Object.freeze({
      page: '供应链协同',
      files: ['HengAI_供应链协同.html', 'hub_engine.py'],
      hook: 'POST /resonance/cl-mat/provision',
      dimension: 'passport',
      requires: { login: true, minTier: ACCOUNT_TIER.PRO_PERSONAL },
      note: '共振达阈后 · 单供应商自愿 B2B 添置 CL-MAT · 非举力/资金归集 · API 预留',
      status: 'planned',
    }),
  }),
  factorAuth: Object.freeze({
    industry_factor_attest: Object.freeze({
      page: '工业原厂精算',
      files: ['HengAI_工业原厂精算.html', 'hub_engine.py'],
      hook: 'POST /industry-factor-attest',
      dimension: 'supplyChainRole',
      requires: { login: true, roles: [USER_ROLE.ORIGIN], minPhase: 'Phase2' },
    }),
    mat_path_edit: Object.freeze({
      page: '工业原厂精算 / 全域中心',
      files: ['.cursorrules Upsell 2B'],
      hook: '脱碳路径 / MAT 网关',
      dimension: 'mat',
      requires: { workspaceVault: 'CERTIFIED', matRequired: true },
      note: 'Pro 用户改 MAT 路径 · Upsell 企业金库',
      status: 'planned',
    }),
  }),
  batchVerify: Object.freeze({
    pool_pull: Object.freeze({
      page: '核验',
      files: ['HengAI_核验.html', 'cbam-verified-factor.js'],
      hook: 'verified-factor-pool',
      dimension: 'cityState',
      requires: { login: true, cityState: 'certified' },
      note: '城池态卡口（产品规则）非 account_tier · 与商业开关独立',
    }),
  }),
  index: Object.freeze({
    widget_round_6: Object.freeze({
      page: '首页对话',
      files: ['index.html'],
      hook: 'openGuestLimitPaywall',
      dimension: 'passport',
      requires: { maxTier: ACCOUNT_TIER.FREE_USER, guestRound: 6 },
      status: 'planned',
    }),
    widget_download: Object.freeze({
      page: '首页 Widget',
      files: ['index.html'],
      hook: 'Paywall_Trigger 下载报表',
      dimension: 'passport',
      requires: { minTier: ACCOUNT_TIER.PRO_PERSONAL },
      status: 'planned',
    }),
  }),
  hub: Object.freeze({
    origin_audit: Object.freeze({
      page: '产业主权看板',
      files: ['HengAI_HeavyIndustry_Suite.html'],
      hook: 'guardOriginFactoryPage',
      dimension: 'supplyChainRole',
      requires: { roles: [USER_ROLE.ORIGIN], minPhase: 'Phase2' },
      note: '角色+阶段分轨',
    }),
  }),
});

function commercialGatesEnabled() {
  return window.HENGAI_COMMERCIAL_GATES_ENABLED === true;
}
window.commercialGatesEnabled = commercialGatesEnabled;

/** 按注册表文档化 actionId · 仅当总开关 true 时拦截 */
function checkCommercialGate(actionId, state) {
  if (!commercialGatesEnabled()) return null;
  return explainCbamCommercialBlock(actionId, state);
}
window.checkCommercialGate = checkCommercialGate;

function _lookupCommercialGateEntry(actionId) {
  const reg = window.COMMERCIAL_GATE_REGISTRY || {};
  const domains = Object.keys(reg);
  for (let i = 0; i < domains.length; i += 1) {
    const bucket = reg[domains[i]];
    if (bucket && bucket[actionId]) return bucket[actionId];
  }
  return null;
}
window.lookupCommercialGateEntry = _lookupCommercialGateEntry;

/**
 * CBAM 商业卡口 · 三层身份标准（个人护照 / 供应链角色 / 企业金库）
 * 对齐 .cursorrules：account_tier × workspaceRole × workspace stage
 */
function buildCbamCommercialGate(state) {
  const s = state || window.AppState || {};
  const u = s.user || {};
  const co = s.company || {};
  const flags = s.flags || {};
  const authed = typeof oracleIsLoggedIn === 'function' ? oracleIsLoggedIn() : !!(u.isLoggedIn);
  const tierCode = authed
    ? (typeof currentTierCode === 'function' ? currentTierCode() : normalizeTierCode(u.tier_code || u.tier))
    : ACCOUNT_TIER.GUEST;
  const role = typeof resolveUserRoleFromState === 'function'
    ? resolveUserRoleFromState(s)
    : USER_ROLE.GUEST;
  const phase = flags.currentPhase || 'Phase1';
  const stageRaw = String(co.stage || co.stage_code || '').toLowerCase();
  const isCertifiedVault = stageRaw === 'certified' || tierCode === ACCOUNT_TIER.ENT_VERIFIED || phase === 'Phase3';

  const tierLabels = {
    [ACCOUNT_TIER.GUEST]: '访客',
    [ACCOUNT_TIER.FREE_USER]: '免费体验版',
    [ACCOUNT_TIER.PRO_PERSONAL]: '个人专业版',
    [ACCOUNT_TIER.ENT_VERIFIED]: '企业共治版',
  };

  let passportExplain;
  let passportUpsell = null;
  if (!authed) {
    passportExplain = '未登录。可进行访客粗测；保存结果、Pull、共振需登录。';
    passportUpsell = { id: 'login', label: '登录 / 注册 →' };
  } else if (tierCode === ACCOUNT_TIER.FREE_USER) {
    passportExplain = '已登录。未开通 ¥99 个人专业版——粗测与建档可用，保存报告、深度步骤等受 Pro 卡口。';
    passportUpsell = { id: 'pro', label: '升级个人专业版 ¥99 →' };
  } else if (tierCode === ACCOUNT_TIER.PRO_PERSONAL) {
    passportExplain = '已开通个人专业版。深度测算与报告保存已解封（仍受企业金库与城池态约束）。';
  } else if (tierCode === ACCOUNT_TIER.ENT_VERIFIED) {
    passportExplain = '企业共治版。个人与企业金库权限已对齐，按城池态开放 Pull/协同。';
  } else {
    passportExplain = '个人账户状态以服务端为准。';
  }

  let roleLabel;
  let roleExplain;
  if (role === USER_ROLE.ORIGIN) {
    roleLabel = '工业原厂（上游）';
    roleExplain = '企业档案行业为钢/铝/水泥等原厂。本页走「敞口粗测 + 城池指挥」，不在此做工序精算或下游 Pull。';
  } else if (role === USER_ROLE.SME) {
    roleLabel = '下游配套商（SME）';
    roleExplain = '出口/组装视角。可检索上游因子；仅上游「正式碳城池」可 Pull，实证中只见进度。';
  } else {
    roleLabel = '未建档 / 访客意图';
    roleExplain = '请先在访客门选择路径，或登录后在「企业数字档案」确定行业与角色。';
  }

  let vaultLabel;
  let vaultExplain;
  let vaultUpsell = null;
  if (isCertifiedVault) {
    vaultLabel = '企业官方金库 · Phase3';
    vaultExplain = '老板已认证企业金库。可开放申报级协同；Pull 仍须上游城池 certified。';
  } else if (phase === 'Phase2' || stageRaw === 'sandbox') {
    vaultLabel = '企业沙盒 · Phase2';
    vaultExplain = '档案已完整，运行在沙盒。可测 CBAM、共振、供应链；非申报级官方金库。';
    vaultUpsell = { id: 'enterprise', label: '了解企业官方金库 →' };
  } else if (phase === 'Phase1') {
    vaultLabel = '建档期 · Phase1';
    vaultExplain = '企业数字档案未完整。请先补全信用代码与行业，再解锁 Phase2 测算。';
    vaultUpsell = { id: 'enterprise-profile', label: '完善企业数字档案 →' };
  } else {
    vaultLabel = phase;
    vaultExplain = '企业空间阶段以 Hub overview 为准。';
  }

  let productState = 'A';
  if (isCertifiedVault) productState = 'C';
  else if (tierCode === ACCOUNT_TIER.PRO_PERSONAL || tierCode === ACCOUNT_TIER.ENT_VERIFIED) productState = 'B';

  return {
    productState,
    passport: {
      dimension: '个人护照',
      code: tierCode,
      label: tierLabels[tierCode] || u.tierLabel || '—',
      explain: passportExplain,
      upsell: passportUpsell,
    },
    supplyChainRole: {
      dimension: '供应链角色',
      code: role,
      label: roleLabel,
      explain: roleExplain,
    },
    workspaceVault: {
      dimension: '企业金库',
      code: isCertifiedVault ? 'CERTIFIED' : (stageRaw === 'sandbox' ? 'SANDBOX' : stageRaw || phase),
      label: vaultLabel,
      phase,
      explain: vaultExplain,
      upsell: vaultUpsell,
    },
    calcScope: {
      dimension: '本页测算口径',
      label: '欧盟默认库粗测',
      explain: '非企业实证、非正式申报数据。真实复盘 → 产业链主权实证中心；正式 Pull → 仅 certified 城池。',
    },
  };
}
window.buildCbamCommercialGate = buildCbamCommercialGate;

/** 仅在功能被拦截时调用 · 返回 { message, upsell? } 或 null（放行） */
function explainCbamCommercialBlock(action, state) {
  if (!commercialGatesEnabled()) return null;

  const s = state || window.AppState || {};
  const gate = buildCbamCommercialGate(s);
  const authed = typeof oracleIsLoggedIn === 'function' ? oracleIsLoggedIn() : false;
  const tier = gate.passport.code;
  const role = gate.supplyChainRole.code;
  const phase = gate.workspaceVault.phase;

  if (action === 'pull' || action === 'verify' || action === 'detect_doc') {
    if (role === USER_ROLE.ORIGIN) {
      return {
        message: '当前为工业原厂账号：下游 Pull/认领不适用。请使用上方城池指挥台或前往产业链主权实证中心。',
        upsell: null,
      };
    }
    if (!authed) {
      return {
        message: '登录后可检索核验池、认领上游因子。',
        upsell: { id: 'login', label: '登录并继续 →' },
      };
    }
    return null;
  }

  if (action === 'resonance') {
    if (!authed) {
      return { message: '登录后可向产业链发送共振信号。', upsell: { id: 'login', label: '登录 →' } };
    }
    if (phase === 'Phase1') {
      return {
        message: '请先完善企业数字档案（信用代码与行业），再发起共振。',
        upsell: { id: 'enterprise-profile', label: '去建档 →' },
      };
    }
    return null;
  }

  if (action === 'save_report' || action === 'commit_cbam') {
    if (!authed) {
      return { message: '登录后可将测算结果写入企业档案。', upsell: { id: 'login', label: '登录 →' } };
    }
    if (tier === ACCOUNT_TIER.FREE_USER) {
      return {
        message: '保存 CBAM 报告需个人专业版（¥99）。当前粗测结果可继续浏览。',
        upsell: { id: 'pro', label: '了解专业版 →' },
      };
    }
    return null;
  }

  return null;
}
window.explainCbamCommercialBlock = explainCbamCommercialBlock;

function notifyCbamCommercialBlock(action, state) {
  const block = checkCommercialGate(action, state);
  if (!block) return false;
  if (typeof showToast === 'function') showToast(block.message);
  return true;
}
window.notifyCbamCommercialBlock = notifyCbamCommercialBlock;

function guardOriginFactoryPage() {
  if (!document.getElementById('hi-suite')) return;
  const host = document.getElementById('hi-suite');
  const existingBlk = document.getElementById('hi-sme-blocker');
  if (typeof window.hengaiIsDevPreview === 'function' && window.hengaiIsDevPreview()) {
    if (typeof window.applyHengaiDevPreviewIfNeeded === 'function') {
      window.applyHengaiDevPreviewIfNeeded();
    }
    if (host) host.style.display = '';
    if (existingBlk) existingBlk.remove();
    return;
  }
  const role = resolveUserRoleFromState();
  if (role === USER_ROLE.ORIGIN) {
    if (host) host.style.display = '';
    if (existingBlk) existingBlk.remove();
    return;
  }
  if (!host || existingBlk) return;
  host.style.display = 'none';
  const blk = document.createElement('div');
  blk.id = 'hi-sme-blocker';
  blk.style.cssText = 'max-width:520px;margin:48px auto;padding:28px 24px;border-radius:16px;border:1px solid var(--border2,#334);background:rgba(8,12,22,.96);color:#eef1f8;line-height:1.75;font-family:"Noto Sans SC",sans-serif';
  blk.innerHTML = '<div style="font-size:18px;font-weight:700;color:#c9a84c;margin-bottom:10px">🔒 工业原厂专属界面</div>'
    + '<p style="font-size:13px;color:#8a92a8;margin:0 0 16px">工序录入与因子签发仅对<strong style="color:#6ee7b7">钢铁 / 铝 / 水泥原厂 Workspace</strong>开放。'
    + ' 作为下游企业，请使用 CBAM 测算工具中的「认领 / 请求因子」完成资产核验。</p>'
    + '<button type="button" id="hi-sme-goto-calc" style="padding:10px 18px;border-radius:10px;border:none;background:linear-gradient(135deg,#1d9e75,#378add);color:#fff;font-weight:700;cursor:pointer">前往 CBAM 测算 · 下游认领</button>';
  document.body.appendChild(blk);
  const btn = document.getElementById('hi-sme-goto-calc');
  if (btn) btn.addEventListener('click', function (ev) {
    ev.preventDefault();
    if (typeof window.gotoCbamFromOriginBlocker === 'function') {
      window.gotoCbamFromOriginBlocker();
      return;
    }
    if (typeof window.hengaiSwitchHubPage === 'function') {
      window.hengaiSwitchHubPage('calc');
      return;
    }
    try {
      if (window.parent !== window && typeof window.parent.navTo === 'function') {
        const nav = window.parent.document.getElementById('nav-calc');
        window.parent.navTo('calc', nav);
        return;
      }
    } catch (_) {}
    if (typeof window.navigateToHub === 'function') {
      window.navigateToHub('calc');
      return;
    }
    try {
      (window.top || window).location.href = '/static/全域中心.html#calc';
    } catch (_) {
      location.href = '/static/全域中心.html#calc';
    }
  });
}
window.guardOriginFactoryPage = guardOriginFactoryPage;
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
    generationalGm: 0,
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
    /** 企业内角色权限：'admin'（管理员·可申报供应链绑定）| 'compliance'（合规官·日常操作）| 'readonly' */
    roleLevel:              'compliance',
    /** 上游原料类型清单（合规人员视图，不含供应商企业名） */
    upstreamMaterials:      [],
    /** 是否为工业原厂：true=原厂视图，false=下游 SME 视图 */
    isIndustrialFactory:    false,
    /** 工厂类型（仅 isIndustrialFactory=true 时有效） */
    factoryType:            null,
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
    verifiedFactorCertId:   null,
    resonanceRequests:      0,
    trustCommitmentLevel:   'NOT_STARTED',
    honorEligibilityTier:   'INELIGIBLE',
    nhjcStatus: {
      diagnosed: false,
      deployed: null,
      vendorInput: null,
      matchedVendor: null,
      tier: null,
      estimatedWeeks: null,
      diagnosedAt: null,
      visibilityOptIn: false,
    },
  },
  industryAudit: {
    localCarbonIntensity:   null,
    hasVerifiedFactor:      false,
    lastIndustry:           'steel',
    budgetReportExportedAt: null,
    verificationCode:       null,
  },
  resonance: {
    penaltyMultiplier:      1.35,
    usingDefaultFactor:     true,
    verifiedOrigin:         null,
    pendingRequestsForIndustry: 0,
    industryCode:           'steel',
    resonanceRequestsOnWorkspace: 0,
    userRequested:          false,
    userRank:               null,
  },
  verified_origin_pool: [],
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
    crusadeCount:           0,
    resonanceCount:         0,
    totalTaxPenalty:        0,
  },
  fortress: {
    levelLabel:    '...',
    tier:          '...',
    dimTimeSpan:   '...',
    dimConfidence: '...',
    dimCompleteness:'...',
    dimReduction:  '...',
    dimCoverage:   '...',
    dimSovereignty:'...',
    dimNetwork:    '...',
    dimTrust:      '...',
    avgScore:      '...',
  },
  impact: {
    riskExposureEur: null,
    scope1: 0,
    scope2: 0,
    scope3: 0,
  },
  ui: {
    /** CBAM 敞口显示 · eur_primary | cny_primary | eur_only */
    moneyDisplay: 'eur_primary',
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
      'dashboard','achievement','wallet','compute'
    ],
    originAuditUnlocked:  false,
    hasOriginFactoryPerm: false,
    userRole:             'ROLE_GUEST',
    navLabels: {
      supply: '供应链协同',
      'batch-verify': '产业链核验',
      'origin-audit': '产业主权看板',
      'factor-auth': '原厂因子精算',
    },
  },
  recentReports: [],
  badges: [],
  suppliers: [],
  supplyChain: {
    qualityScore: 78,
    lv4CertifiedPct: 43,
    industryAvgPct: 35,
    missingPct: 22,
    currentView: 'downstream',
    upstreamSources: [],
    resonanceGroups: [],
  },
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
    pendingDeclaration: null,
    evidence: {
      mode: 'SIMULATED',
      stage: null,
      value: null,
      unit: 'tCO2e/t',
      industryCode: null,
      dictVersion: null,
      calcVersion: null,
      updatedAt: null,
      verified: {},
      shadow: {},
      trustCommitmentLevel: 'NOT_STARTED',
      honorEligibilityTier: 'INELIGIBLE',
      history: [],
    },
  },
  factorAuth: {
    industry:           null,
    pledgeBy:           null,
    pledgeTs:           null,
    confirmedFactor:    null,
    confirmedIndustry:  null,
    poolCount:          0,
    poolFactories:      0,
    poolDownstream:     0,
    poolTaxSaved:       0,
    waitingCount:       0,
    taxRiskEur:         0,
    demands:            [],
    honors:             [],
    gmPoolRewardClaimed: false,
    pooledByIndustry:   {},
    riskReportGeneratedAt: null,
    /** 因子消费账本：原厂侧「谁在用我的因子」的权威台账（替代纯计数） */
    consumptionLedger: {
      total:              {
        usageCount: 0,            // 因子被引用总次数
        carbonTonnageCovered: 0,  // 覆盖碳排放总量（tCO₂e）
        taxSavedEur: 0,           // 为产业链节省碳税总量（€）
        serviceFeePct: 0.03,      // 服务费率 3%
        nursingFundPct: 0.01,     // 其中护航基金 1%
        serviceFeeEur: 0,         // 累计服务费（€）
        nursingFundEur: 0,        // 累计护航基金（€）
        // 兼容旧字段命名
        count: 0,
        carbonTonnage: 0,
      },
      byIndustry:         [],   // [{ industryCode, industryLabel, count, carbonTonnage }]
      byRegion:           [],   // [{ region, count, pct }]
      byMonth:            [],   // [{ month: 'YYYY-MM', count, carbonTonnage, taxSavedEur }]
      claimedConsumers:   [],   // 已认领下游（实名可见）[{ workspaceId, companyName, industryCode, claimedAt, refCount }]
      anonymousRecords:   [],   // 匿名消费记录（不含企业名）[{ anonymousId, usageCount, carbonTonnage, taxSavedEur, industry }]
      // 兼容旧字段命名
      anonymousConsumers: [],
      serviceFeePct:      0.03,
      nursingFundPct:     0.01,
      serviceFeeEur:      0,
      nursingFundEur:     0,
    },
    /** 供应链绑定声明：原厂上游原料申报 + 下游认领关系（双向绑定的单一真理源） */
    supplyChainBinding: {
      declaredBy:        null,  // 申报人（管理员账号）
      declaredAt:        null,
      lastUpdatedAt:     null,
      upstreamMaterials: [],    // 原料类型申报（不含供应商名）[{ materialType, carbonFactor, matchedFromPool }]
      downstreamOptIns:  [],    // 已认领下游 [{ workspaceId, companyName, optInAt }]
      antiCompetitionRules: {
        crossChainMatchingBlocked: true,
        undeclaredFactoryBlocked:  true,
        fallbackToIndustryAverage: true,
      },
    },
  },
  batchVerification: {
    batches:            [],
    certificates:       [],
    pendingApprovals:   [],
    factorUsageLog:     [],
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
      const mockUser = JSON.parse(JSON.stringify(MOCK_STATE.user));
      const gm = user.gmBalance != null ? Number(user.gmBalance)
        : (user.gm_balance != null ? Number(user.gm_balance) : mockUser.gmBalance);
      this.user = Object.assign(mockUser, {
        id: user.id || user.userId || mockUser.id,
        name: user.name || user.username || mockUser.name,
        email: user.email || mockUser.email,
        phone: user.phone || mockUser.phone,
        gmBalance: gm,
        tier: user.tier || mockUser.tier,
        tier_code: user.tier_code ? normalizeTierCode(user.tier_code) : mockUser.tier_code,
        regDate: user.created_at || user.createdAt || user.reg_date || user.regDate || mockUser.regDate,
        tokensLeft: user.tokensLeft != null ? user.tokensLeft : (user.tokens_left != null ? user.tokens_left : mockUser.tokensLeft),
        tokensTotal: user.tokensTotal != null ? user.tokensTotal : (user.tokens_total != null ? user.tokens_total : mockUser.tokensTotal),
      });
      if (!this.wallet || typeof this.wallet !== 'object') this.wallet = JSON.parse(JSON.stringify(MOCK_STATE.wallet));
      this.wallet.balance = gm;
    } else {
      this.user = JSON.parse(JSON.stringify(MOCK_STATE.user));
      this.wallet = JSON.parse(JSON.stringify(MOCK_STATE.wallet));
    }
    EventBus.emit('AUTH_CHANGED', this.auth.user);
    syncAppState();
    broadcastStatePatch({ user: this.user, auth: { ...this.auth }, _authEpoch: _authSwitchEpoch });
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
    const target = (typeof resolveWritableAppState === 'function' ? resolveWritableAppState() : null) || window.AppState;
    Object.assign(target, deepMerge(target, delta));
    mirrorAppStateShadowCopy(target);
    try { saveCachedState(target); } catch {}
    syncAppState(target);
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
          if (d.regionTag != null) {
            c.regionTag = d.regionTag;
            c.region_tag = d.regionTag;
          }
          if (d.creditCode != null) c.creditCode = d.creditCode;
          if (d.mainProduct != null) c.mainProduct = d.mainProduct;
          if (d.hsCode != null) c.hsCode = d.hsCode;
          if (d.annualCapacityTons != null) c.annualCapacityTons = d.annualCapacityTons;
          if (d.annualExportTons != null) {
            c.annualExportTons = d.annualExportTons;
            c.exportTons = d.annualExportTons;
          }
          if (d.exportCountries != null) c.exportCountries = d.exportCountries;
          if (d.annualPowerKwh != null) c.annualPowerKwh = d.annualPowerKwh;
          if (d.powerGrid != null) c.powerGrid = d.powerGrid;
          if (d.contactEmail != null) c.contactEmail = d.contactEmail;
          const base = { company: c };
          const mergedState = Object.assign({}, st, base);
          const estPatch = patchEnterpriseMetricsFromProfile(mergedState);
          return estPatch ? Object.assign({}, base, estPatch) : base;
        },
      },
      industryAudit: {
        path: '/api/v1/hub/industry-factor-attest',
        merge: function (d, st) {
          var c = Object.assign({}, st.company || {});
          if (d.carbonIntensity != null) {
            c.verifiedFactor = Number(d.carbonIntensity);
            c.verified_factor = Number(d.carbonIntensity);
          }
          if (d.certId != null) c.verifiedFactorCertId = d.certId;
          if (d.cert_id != null) c.verifiedFactorCertId = d.cert_id;
          var ia = Object.assign({}, st.industryAudit || {});
          if (d.carbonIntensity != null) ia.verifiedFactor = Number(d.carbonIntensity);
          if (d.yoyChangePct != null) ia.verifiedFactorYoyPct = Number(d.yoyChangePct);
          if (d.yoy_change_pct != null) ia.verifiedFactorYoyPct = Number(d.yoy_change_pct);
          ia.hasVerifiedFactor = true;
          ia.lastIndustry = d.industryCode || d.industry_code || ia.lastIndustry;
          if (d.certId != null) ia.verifiedFactorCertId = d.certId;
          if (d.cert_id != null) ia.verifiedFactorCertId = d.cert_id;
          var patch = { company: c, industryAudit: ia };
          if (d.carbonIntensity != null && (d.industryCode || d.industry_code)) {
            var indKey = typeof factorUiIndustryKey === 'function'
              ? factorUiIndustryKey(d.industryCode || d.industry_code)
              : String(d.industryCode || d.industry_code).toLowerCase();
            var fa0 = Object.assign({}, st.factorAuth || {});
            var pooled0 = Object.assign({}, fa0.pooledByIndustry || {});
            pooled0[indKey] = {
              factor: Number(d.carbonIntensity),
              certNo: d.certId || d.cert_id || (pooled0[indKey] && pooled0[indKey].certNo) || '',
              pooledAt: new Date().toISOString(),
              source: 'attest-optimistic',
            };
            fa0.pooledByIndustry = pooled0;
            fa0.poolCount = Object.keys(pooled0).length;
            fa0.confirmedFactor = Number(d.carbonIntensity);
            fa0.confirmedIndustry = indKey;
            patch.factorAuth = fa0;
          }
          if (d.badgeAwarded || d.badge_awarded) {
            var badges = (st.badges || []).slice();
            var code = 'CL-ORIGIN-PIONEER';
            if (!badges.some(function (b) { return (b.badgeCode || b.badge_code) === code; })) {
              badges.push({ badgeCode: code, badgeName: 'CL-Origin 绿色出海先行者' });
            }
            patch.badges = badges;
          }
          return patch;
        },
        /** 仅允许脱敏系数字段上送，工序绝对值严禁出网 */
        sanitize: function (payload) {
          var p = payload || {};
          var codeRaw = p.industryCode || p.industry_code;
          var codeCanon = codeRaw ? canonicalIndustryCode(codeRaw) : undefined;
          return {
            carbonIntensity: p.carbonIntensity != null ? Number(p.carbonIntensity) : undefined,
            yoyChangePct: p.yoyChangePct != null ? Number(p.yoyChangePct) : undefined,
            yoy_change_pct: p.yoy_change_pct != null ? Number(p.yoy_change_pct) : undefined,
            industryCode: codeCanon,
            industry_code: codeCanon,
            productLabel: p.productLabel || p.product_label || undefined,
            productionLine: p.productionLine || p.production_line || undefined,
            intensityUnit: p.intensityUnit || p.intensity_unit || undefined,
            intensity_unit: p.intensity_unit || p.intensityUnit || undefined,
          };
        },
      },
      cbam: {
        path: '/api/v1/hub/cbam-report-save',
        merge: (d, st) => {
          var risk = d.riskExposureEur != null ? Number(d.riskExposureEur) : null;
          var tco = d.tco2eTotal != null ? Number(d.tco2eTotal) : null;
          var ci = null;
          try {
            var pj = typeof d.payloadJson === 'string' ? JSON.parse(d.payloadJson) : d.payloadJson;
            if (pj && pj.ci != null) ci = Number(pj.ci);
          } catch (_) {}
          var metrics = Object.assign({}, st.metrics || {});
          if (risk != null && Number.isFinite(risk)) {
            metrics.riskExposureEur = risk;
            metrics.cbamTaxEstimate = risk;
          }
          if (tco != null && Number.isFinite(tco)) metrics.tCO2eTotal = tco;
          if (ci != null && Number.isFinite(ci)) metrics.carbonIntensity = ci;
          var impact = Object.assign({}, st.impact || {});
          if (risk != null && Number.isFinite(risk)) impact.riskExposureEur = risk;
          if (ci != null && Number.isFinite(ci)) impact.carbonIntensity = ci;
          var calcResult = null;
          try {
            calcResult = typeof d.payloadJson === 'string' ? JSON.parse(d.payloadJson) : d.payloadJson;
          } catch (_) {}
          if (calcResult && typeof calcResult === 'object') {
            const supTotal = calcResult.supplierCount != null ? calcResult.supplierCount : calcResult.supTotal;
            const supDone = calcResult.supplierSubmitted != null ? calcResult.supplierSubmitted : calcResult.supDone;
            if (supTotal != null && Number.isFinite(Number(supTotal))) {
              metrics.supplierCount = Number(supTotal);
              metrics.supplierSubmittedCount = Number(supDone || 0);
              metrics.supplierSubmitted = Number(supDone || 0);
              metrics.supplierPendingCount = Math.max(0, Number(supTotal) - Number(supDone || 0));
            }
            if (calcResult.coverage != null && Number.isFinite(Number(calcResult.coverage))) {
              metrics.supplyChainCoverage = Number(calcResult.coverage);
              metrics.scope3Coverage = Number(calcResult.coverage);
            }
            const crNorm = normalizeCalcResult(calcResult, st);
            const tax = crNorm && crNorm.totalTax != null ? Number(crNorm.totalTax) : risk;
            const fx = Number(crNorm && crNorm.fx) || Number(st.macro && st.macro.eur_cny_rate) || 7.85;
            const investCny = 58000;
            const netSaveCny = tax > 0 ? Math.round(tax * fx) - investCny : 0;
            const roiMult = investCny > 0 && netSaveCny > 0 ? netSaveCny / investCny : 0;
            if (tax != null && Number.isFinite(tax) && tax > 0) {
              metrics.riskExposureEur = Math.round(tax);
              metrics.cbamTaxEstimate = Math.round(tax);
            }
            if (roiMult > 0) {
              metrics.roiMultiple = roiMult;
              metrics.taxSavingsWan = netSaveCny > 0 ? netSaveCny / 10000 : null;
            }
          }
          const coPatch = {
            isComplete: true,
            cbamRiskRaw: risk != null && Number.isFinite(risk) ? Math.round(risk) : (metrics.riskExposureEur || null),
            riskExposureEur: metrics.riskExposureEur,
          };
          if (risk != null && Number.isFinite(risk) && risk > 0) {
            coPatch.stageLabel = 'CBAM 已测算';
            coPatch.cbamRisk = F.eur(risk);
          }
          return {
            metrics: metrics,
            impact: impact,
            company: Object.assign({}, st.company || {}, coPatch),
            cbam: Object.assign({}, st.cbam || {}, {
              reportingPeriod: d.reportingPeriod,
              riskExposureEur: risk,
              tco2eTotal: tco,
              calcResult: calcResult,
              lastPayloadAt: new Date().toISOString(),
            }),
          };
        },
      },
      supply: {
        path: '/api/v1/hub/supplier-invite',
        merge: (d, st) => {
          const node = {
            id: d.supplierNodeId || d.supplier_node_id || d.id,
            supplierName: d.supplierName || d.supplier_name || d.name || '新供应商',
            supplierCreditCode: d.supplierCreditCode || d.supplier_credit_code || null,
            status: d.status || undefined,
            submissionToken: d.submissionToken || d.submission_token,
            inviteCode: d.inviteCode || d.invite_code,
            isInsured: d.isInsured != null ? d.isInsured : d.is_insured,
            isWhiteListed: d.isWhiteListed != null ? d.isWhiteListed : d.is_white_listed,
            insuranceSuggestion: d.insuranceSuggestion || d.insurance_suggestion,
          };
          const nodes = upsertSupplierNodeInList(st.supplierNodes || [], node);
          const metrics = recomputeSupplyMetricsFromNodes(nodes, st.metrics || {});
          return { supplierNodes: nodes, metrics };
        },
      },
      decision:   { path: '/api/v1/hub/decision-package', merge: (d, st) => ({ decisionPacks: ((st.decisionPacks || []).concat([d])) }) },
      dld:        { path: '/api/v1/hub/dld-apply', merge: (d, st) => ({ dldApplications: ((st.dldApplications || []).concat([d])) }) },
      regulation: {
        path: '/api/v1/hub/regulation-read',
        merge: (d, st) => {
          const reg = Object.assign({}, st.regulation || { reads: [], readCount: 0 });
          const reads = Array.isArray(reg.reads) ? reg.reads.slice() : [];
          const rid = d.regulationId || d.regulation_id;
          const readAt = d.readAt || d.read_at || new Date().toISOString();
          const item = {
            regulationId: rid,
            title: d.title || rid,
            readAt: readAt,
            progressPct: d.progressPct != null ? d.progressPct : (d.progress_pct != null ? d.progress_pct : 100),
            gmEarned: d.gmEarned != null ? d.gmEarned : d.gm_earned,
          };
          const idx = reads.findIndex((r) => r && (r.regulationId === rid || r.regulation_id === rid));
          if (idx >= 0) reads[idx] = Object.assign({}, reads[idx], item);
          else reads.unshift(item);
          reg.reads = reads;
          reg.readCount = reads.length;
          reg.lastReadAt = readAt;
          return { regulation: reg };
        },
      },
    };
    const route = ROUTES[domain];
    if (!route) {
      throw new Error(`[AppState.commit] 未知 domain: ${domain}（合法值: ${Object.keys(ROUTES).join('/')}）`);
    }

    let st = resolveWritableAppState(this);
    const hubWin = resolveHubHostWindow();
    const wirePayload =
      typeof route.sanitize === 'function' ? route.sanitize(payload) : payload;

    const token = (typeof getToken === 'function' && getToken()) || '';
    const apiBase = String(hengaiApiOrigin() || '').replace(/\/+$/, '');
    const url = apiBase + route.path;

    // 1. 乐观本地 patch（提前让 UI 响应）
    const prevSnapshot = JSON.parse(JSON.stringify({ user: st.user, company: st.company || null, cbam: st.cbam || null, supplierNodes: st.supplierNodes || [] }));
    if (options.optimistic !== false) {
      try {
        const localDelta = route.merge(wirePayload, st);
        Object.assign(st, deepMerge(st, localDelta));
        mirrorAppStateShadowCopy(st);
        syncAppState(st);
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
        body: JSON.stringify(wirePayload)
      });
      response = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 回滚乐观 patch
        Object.assign(st, prevSnapshot);
        mirrorAppStateShadowCopy(st);
        syncAppState(st);
        const errMsg = (response?.detail || response?.message) || `${res.status} ${res.statusText}`;
        throw new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
      }
    } catch (err) {
      emitAppStateEvent(`${domain}:save-failed`, { error: err, payload });
      throw err;
    }

    // 3. 服务器权威：优先合并响应中的全量 appState（与 GET /hub/overview 同构）
    const appState = response?.appState || response?.app_state;
    if (appState && typeof appState === 'object' && Object.keys(appState).length) {
      if (typeof mergeAuthoritativeAppStateFromServer === 'function') {
        mergeAuthoritativeAppStateFromServer(appState);
        st = window.AppState;
      } else {
        Object.assign(st, deepMerge(st, sanitizeOverviewPayload(appState)));
      }
      if (st.user && st.user.gmBalance != null) {
        st.user.gmBalance = Number(st.user.gmBalance);
      }
      if (st.wallet && typeof st.wallet === 'object') {
        st.wallet.balance = st.user.gmBalance;
      }
      if (!st.flags) st.flags = {};
      st.flags.hubOverviewReady = true;
      try { saveCachedState(st); } catch (_) {}
      try {
        if (hubWin !== window && typeof hubWin.updateHubSyncGate === 'function') hubWin.updateHubSyncGate(st);
        else if (typeof window.updateHubSyncGate === 'function') window.updateHubSyncGate(st);
      } catch (_) {}
      mirrorAppStateShadowCopy(st);
      syncAppState(st, { fromRemote: true });
    } else {
      const gmEarned = Number(response?.gmEarned || response?.gm_earned || 0);
      const newPhase = response?.stage || response?.phase || response?.currentPhase;
      if (gmEarned > 0) {
        st.user.gmBalance = Number(st.user?.gmBalance || 0) + gmEarned;
        if (st.wallet && typeof st.wallet === 'object') st.wallet.balance = st.user.gmBalance;
        emitAppStateEvent('GM_UPDATED', st.user.gmBalance);
      }
      if (newPhase && newPhase !== (st.company?.stage || st.company?.phase)) {
        if (st.company) st.company.stage = newPhase;
        emitAppStateEvent('PHASE_CHANGED', { newPhase, response });
      }
      st.sync();
      mirrorAppStateShadowCopy(st);
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
    emitAppStateEvent(`${domain}:saved`, { payload, response });
    emitAppStateEvent('STATE_COMMIT', { domain, payload, response });
    if (domain === 'supply') {
      try { window.hengaiRefreshSupplyConsole(st); } catch (_) {
        try { refreshSupplyChainUi(st); } catch (e2) {}
        try { renderHengaiSupplierTable(st); } catch (e3) {}
      }
    }

    try {
      var normFn = (hubWin !== window && typeof hubWin.normalizeHubOverviewPayload === 'function')
        ? hubWin.normalizeHubOverviewPayload
        : (typeof window.normalizeHubOverviewPayload === 'function' ? window.normalizeHubOverviewPayload : null);
      if (normFn) {
        var hubData = normFn(st);
        if (hubWin !== window) hubWin.__hubOverviewData = hubData;
        window.__hubOverviewData = hubData;
      }
      var pulse = (hubWin !== window && typeof hubWin.pulseHubAfterDataSync === 'function')
        ? hubWin.pulseHubAfterDataSync.bind(hubWin)
        : (typeof window.pulseHubAfterDataSync === 'function' ? window.pulseHubAfterDataSync : null);
      if (pulse) {
        pulse(st);
      } else {
        var applyRd = (hubWin !== window && typeof hubWin.applyRealData === 'function')
          ? hubWin.applyRealData.bind(hubWin)
          : (typeof window.applyRealData === 'function' ? window.applyRealData : null);
        var hubOverview = (hubWin !== window ? hubWin.__hubOverviewData : null) || window.__hubOverviewData;
        if (applyRd && hubOverview) applyRd(hubOverview);
      }
    } catch (_) {}
    try { emitHengaiDataChanged(domain); } catch (_) {}
    try {
      var broadcast = (hubWin !== window && typeof hubWin.broadcastHubPipelineToEmbeds === 'function')
        ? hubWin.broadcastHubPipelineToEmbeds.bind(hubWin)
        : broadcastHubPipelineToEmbeds;
      broadcast(st, { commitDomain: domain });
    } catch (_) {}

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
AppState.init = initAppState;

/** 子页/iframe 统一取状态（避免各页重复实现 resolveAppState） */
window.resolveAppState = function resolveAppState() {
  try {
    if (window.parent && window.parent !== window && window.parent.AppState) {
      return window.parent.AppState;
    }
  } catch (_) {}
  return window.AppState || null;
};

/** commit 写入目标：iframe 内调用 parent.AppState.commit 时必须写父页真理，不能写子页 window.AppState */
function resolveWritableAppState(self) {
  if (self && typeof self === 'object' && (self.user || self.company || self.supplierNodes)) return self;
  try {
    if (window.parent && window.parent !== window && window.parent.AppState) {
      var inEmbed = document.documentElement && document.documentElement.getAttribute('data-embed') === '1';
      var inHubFrame = false;
      try {
        var pd = window.parent.document;
        inHubFrame = !!(pd && (pd.querySelector('.page-panel.embed-panel') || pd.getElementById('page-factor-auth')));
      } catch (_) {}
      if (inEmbed || inHubFrame) return window.parent.AppState;
      return window.parent.AppState;
    }
  } catch (_) {}
  return window.AppState;
}
window.resolveWritableAppState = resolveWritableAppState;

/** 全域中心 embed 宿主窗口（子 iframe 内 commit 后需向父页 iframe 广播 pipeline） */
function resolveHubHostWindow() {
  try {
    if (window.parent && window.parent !== window && window.parent.document) {
      var pd = window.parent.document;
      if (pd.getElementById('page-supply') || pd.querySelector('.page-panel.embed-panel')) return window.parent;
    }
  } catch (_) {}
  return window;
}
window.resolveHubHostWindow = resolveHubHostWindow;

function emitAppStateEvent(event, payload) {
  try { EventBus.emit(event, payload); } catch (_) {}
  try {
    if (window.parent && window.parent !== window && window.parent.EventBus && window.parent.EventBus !== EventBus) {
      window.parent.EventBus.emit(event, payload);
    }
  } catch (_) {}
}

function mirrorAppStateShadowCopy(authoritative) {
  if (!authoritative || authoritative === window.AppState || !window.AppState) return;
  try {
    var patch = {
      user: authoritative.user,
      company: authoritative.company,
      metrics: authoritative.metrics,
      supplierNodes: authoritative.supplierNodes,
      gmLedger: authoritative.gmLedger,
      wallet: authoritative.wallet,
      flags: authoritative.flags,
      resonance: authoritative.resonance,
      industryAudit: authoritative.industryAudit,
      factorAuth: authoritative.factorAuth,
    };
    Object.assign(window.AppState, deepMerge(window.AppState, patch));
  } catch (_) {}
}

/** 从 industryAudit / company 已确权因子反灌入 factorAuth.pooledByIndustry（服务端真理） */
function hydrateFactorAuthPoolFromIndustryAudit(state) {
  const s = state || window.AppState;
  if (!s) return s;
  if (!s.factorAuth || typeof s.factorAuth !== 'object') s.factorAuth = {};
  const fa = s.factorAuth;
  const ia = s.industryAudit || {};
  const co = s.company || {};
  const hasBackend = !!(ia.hasVerifiedFactor || co.verifiedFactor != null || co.verified_factor != null);
  if (!hasBackend) return s;

  const rawInd = String(
    ia.lastIndustry || s.resonance?.industryCode || co.industryCode || co.industry_code || 'steel'
  ).trim().toLowerCase();
  const normInd = typeof factorUiIndustryKey === 'function'
    ? factorUiIndustryKey(rawInd)
    : rawInd;
  const factor = Number(
    ia.verifiedFactor != null ? ia.verifiedFactor
      : (co.verifiedFactor != null ? co.verifiedFactor : co.verified_factor)
  );
  if (!Number.isFinite(factor) || factor <= 0) return s;

  const certNo = ia.verifiedFactorCertId || co.verifiedFactorCertId || co.verified_factor_cert_id || '';
  if (!fa.pooledByIndustry || typeof fa.pooledByIndustry !== 'object') fa.pooledByIndustry = {};
  if (!fa.pooledByIndustry[normInd]) {
    fa.pooledByIndustry[normInd] = {
      factor,
      certNo,
      pooledAt: ia.budgetReportExportedAt || new Date().toISOString(),
      source: 'industryAudit',
    };
  }
  fa.poolCount = Object.keys(fa.pooledByIndustry).filter(function (k) {
    return fa.pooledByIndustry[k] && fa.pooledByIndustry[k].factor != null;
  }).length;
  if (fa.confirmedFactor == null) {
    fa.confirmedFactor = factor;
    fa.confirmedIndustry = normInd;
  }
  return s;
}
window.hydrateFactorAuthPoolFromIndustryAudit = hydrateFactorAuthPoolFromIndustryAudit;

function normalizeTrustCommitmentLevel(raw) {
  const k = String(raw || '').trim().toUpperCase();
  if (k === 'COMMITTED' || k === 'VERIFIED') return k;
  return 'NOT_STARTED';
}

const TRUST_COMMITMENT_RANK = Object.freeze({ NOT_STARTED: 0, COMMITTED: 1, VERIFIED: 2 });

function applyMonotonicTrustCommitment(prev, next) {
  const p = TRUST_COMMITMENT_RANK[normalizeTrustCommitmentLevel(prev)] ?? 0;
  const n = TRUST_COMMITMENT_RANK[normalizeTrustCommitmentLevel(next)] ?? 0;
  return n >= p ? normalizeTrustCommitmentLevel(next) : normalizeTrustCommitmentLevel(prev);
}

function resolveHonorEligibilityTier(rawTrust) {
  const tierRaw = String(rawTrust || '').trim().toUpperCase();
  if (tierRaw === 'PIONEER' || tierRaw === 'CERTIFIED_BUILDER' || tierRaw === 'INELIGIBLE') return tierRaw;
  const trust = normalizeTrustCommitmentLevel(rawTrust);
  if (trust === 'VERIFIED') return 'CERTIFIED_BUILDER';
  if (trust === 'COMMITTED') return 'PIONEER';
  return 'INELIGIBLE';
}

function ensureEvidenceContractShape(state) {
  const s = state || window.AppState;
  if (!s) return s;
  if (!s.cbam || typeof s.cbam !== 'object') s.cbam = {};
  if (!s.cbam.evidence || typeof s.cbam.evidence !== 'object') s.cbam.evidence = {};
  const ev = s.cbam.evidence;
  const co = s.company || {};
  if (!ev.mode) {
    const city = String(co.cityState || '').toLowerCase();
    ev.mode = city === 'certified' ? 'SOVEREIGN_VERIFIED'
      : (city === 'evidence_building' || city === 'mat_pending' ? 'PENDING_VERIFICATION' : 'SIMULATED');
  }
  if (ev.stage == null) {
    const city = String(co.cityState || '').toLowerCase();
    if (city === 'evidence_building') ev.stage = 'software_evidenced';
    else if (city === 'mat_pending') ev.stage = 'hardware_pending';
    else ev.stage = null;
  }
  if (!ev.unit) ev.unit = 'tCO2e/t';
  if (!ev.verified || typeof ev.verified !== 'object') ev.verified = {};
  if (!ev.shadow || typeof ev.shadow !== 'object') ev.shadow = {};
  if (!Array.isArray(ev.history)) ev.history = [];
  const prevTrust = normalizeTrustCommitmentLevel(
    ev.trustCommitmentLevel || co.trustCommitmentLevel || s.factorAuth?.trustCommitmentLevel
  );
  let trust = prevTrust;
  const mode = String(ev.mode || '').toUpperCase();
  if (mode === 'PENDING_VERIFICATION') trust = applyMonotonicTrustCommitment(trust, 'COMMITTED');
  else if (mode === 'SOVEREIGN_VERIFIED') trust = applyMonotonicTrustCommitment(trust, 'VERIFIED');
  const honor = resolveHonorEligibilityTier(trust);
  ev.trustCommitmentLevel = trust;
  ev.honorEligibilityTier = honor;
  if (!s.company || typeof s.company !== 'object') s.company = {};
  s.company.trustCommitmentLevel = trust;
  s.company.honorEligibilityTier = honor;
  if (!s.factorAuth || typeof s.factorAuth !== 'object') s.factorAuth = {};
  s.factorAuth.trustCommitmentLevel = trust;
  s.factorAuth.honorEligibilityTier = honor;
  return s;
}
window.ensureEvidenceContractShape = ensureEvidenceContractShape;
window.normalizeTrustCommitmentLevel = normalizeTrustCommitmentLevel;
window.applyMonotonicTrustCommitment = applyMonotonicTrustCommitment;
window.resolveHonorEligibilityTier = resolveHonorEligibilityTier;
window.isSummitHonorEligible = function isSummitHonorEligible(state) {
  const s = ensureEvidenceContractShape(state || window.AppState);
  const tier = (s.company && s.company.honorEligibilityTier)
    || (s.cbam && s.cbam.evidence && s.cbam.evidence.honorEligibilityTier)
    || 'INELIGIBLE';
  return tier === 'CERTIFIED_BUILDER';
};
window.isPioneerHonorEligible = function isPioneerHonorEligible(state) {
  const s = ensureEvidenceContractShape(state || window.AppState);
  const tier = (s.company && s.company.honorEligibilityTier)
    || (s.cbam && s.cbam.evidence && s.cbam.evidence.honorEligibilityTier)
    || 'INELIGIBLE';
  return tier === 'PIONEER' || tier === 'CERTIFIED_BUILDER';
};

/** 兜底补全 factorAuth.consumptionLedger / supplyChainBinding 结构（旧缓存升级用） */
function ensureFactorAuthLedgerShape(state) {
  const s = state || window.AppState;
  if (!s) return s;
  if (!s.factorAuth || typeof s.factorAuth !== 'object') s.factorAuth = {};
  const fa = s.factorAuth;
  if (!fa.consumptionLedger || typeof fa.consumptionLedger !== 'object') fa.consumptionLedger = {};
  const cl = fa.consumptionLedger;
  if (!cl.total || typeof cl.total !== 'object') cl.total = {};
  if (cl.total.usageCount == null) cl.total.usageCount = Number(cl.total.count) || 0;
  if (cl.total.carbonTonnageCovered == null) cl.total.carbonTonnageCovered = Number(cl.total.carbonTonnage) || 0;
  if (cl.total.taxSavedEur == null) cl.total.taxSavedEur = 0;
  if (cl.total.serviceFeePct == null) cl.total.serviceFeePct = 0.03;
  if (cl.total.nursingFundPct == null) cl.total.nursingFundPct = 0.01;
  if (cl.total.serviceFeeEur == null) cl.total.serviceFeeEur = 0;
  if (cl.total.nursingFundEur == null) cl.total.nursingFundEur = 0;
  // 兼容旧字段命名
  if (cl.total.count == null) cl.total.count = Number(cl.total.usageCount) || 0;
  if (cl.total.carbonTonnage == null) cl.total.carbonTonnage = Number(cl.total.carbonTonnageCovered) || 0;
  if (!Array.isArray(cl.byIndustry)) cl.byIndustry = [];
  if (!Array.isArray(cl.byRegion)) cl.byRegion = [];
  if (!Array.isArray(cl.byMonth)) cl.byMonth = [];
  if (!Array.isArray(cl.claimedConsumers)) cl.claimedConsumers = [];
  if (!Array.isArray(cl.anonymousRecords)) cl.anonymousRecords = [];
  if (!Array.isArray(cl.anonymousConsumers)) cl.anonymousConsumers = [];
  if (!cl.anonymousRecords.length && cl.anonymousConsumers.length) cl.anonymousRecords = cl.anonymousConsumers.slice();
  if (!cl.anonymousConsumers.length && cl.anonymousRecords.length) cl.anonymousConsumers = cl.anonymousRecords.slice();
  if (!cl.visibilityScope || typeof cl.visibilityScope !== 'object') {
    cl.visibilityScope = {
      identityDisclosure: 'auto_on_commitment',
      consumptionLedgerDisclosure: 'opt_in_required',
    };
  }
  if (cl.serviceFeePct == null) cl.serviceFeePct = 0.03;
  if (cl.nursingFundPct == null) cl.nursingFundPct = 0.01;
  if (cl.serviceFeeEur == null) cl.serviceFeeEur = 0;
  if (cl.nursingFundEur == null) cl.nursingFundEur = 0;
  // 顶层费率字段向 total 镜像，便于老逻辑继续读取
  cl.serviceFeePct = Number(cl.total.serviceFeePct);
  cl.nursingFundPct = Number(cl.total.nursingFundPct);
  cl.serviceFeeEur = Number(cl.total.serviceFeeEur);
  cl.nursingFundEur = Number(cl.total.nursingFundEur);
  if (!fa.supplyChainBinding || typeof fa.supplyChainBinding !== 'object') {
    fa.supplyChainBinding = {
      declaredBy: null,
      declaredAt: null,
      lastUpdatedAt: null,
      upstreamMaterials: [],
      downstreamOptIns: [],
      antiCompetitionRules: {
        crossChainMatchingBlocked: true,
        undeclaredFactoryBlocked: true,
        fallbackToIndustryAverage: true,
      },
    };
  }
  const sb = fa.supplyChainBinding;
  if (sb.declaredBy == null) sb.declaredBy = null;
  if (sb.declaredAt == null) sb.declaredAt = null;
  if (sb.lastUpdatedAt == null) sb.lastUpdatedAt = null;
  if (!Array.isArray(sb.upstreamMaterials)) sb.upstreamMaterials = [];
  if (!Array.isArray(sb.downstreamOptIns)) sb.downstreamOptIns = [];
  if (!sb.antiCompetitionRules || typeof sb.antiCompetitionRules !== 'object') sb.antiCompetitionRules = {};
  if (sb.antiCompetitionRules.crossChainMatchingBlocked == null) sb.antiCompetitionRules.crossChainMatchingBlocked = true;
  if (sb.antiCompetitionRules.undeclaredFactoryBlocked == null) sb.antiCompetitionRules.undeclaredFactoryBlocked = true;
  if (sb.antiCompetitionRules.fallbackToIndustryAverage == null) sb.antiCompetitionRules.fallbackToIndustryAverage = true;
  if (s.company && typeof s.company === 'object') {
    if (!s.company.roleLevel) s.company.roleLevel = 'compliance';
    if (!Array.isArray(s.company.upstreamMaterials)) s.company.upstreamMaterials = [];
    if (s.company.isIndustrialFactory == null) s.company.isIndustrialFactory = false;
    if (s.company.factoryType == null) s.company.factoryType = null;
  }
  if (!Array.isArray(s.suppliers)) s.suppliers = [];
  s.suppliers = s.suppliers.map(function (supplier) {
    var row = (supplier && typeof supplier === 'object') ? supplier : {};
    if (!row.upstreamDeclaration || typeof row.upstreamDeclaration !== 'object') {
      row.upstreamDeclaration = {};
    }
    if (row.upstreamDeclaration.materialType == null) row.upstreamDeclaration.materialType = null;
    if (row.upstreamDeclaration.sourceName == null) row.upstreamDeclaration.sourceName = null;
    if (row.upstreamDeclaration.sourceAnonymousId == null) row.upstreamDeclaration.sourceAnonymousId = null;
    if (row.upstreamDeclaration.factorStatus == null) row.upstreamDeclaration.factorStatus = FACTOR_STATUS.MISSING;
    if (row.upstreamDeclaration.matchedFactor == null) row.upstreamDeclaration.matchedFactor = null;
    if (row.upstreamDeclaration.declaredAt == null) row.upstreamDeclaration.declaredAt = null;
    if (row.upstreamDeclaration.resonanceJoined == null) row.upstreamDeclaration.resonanceJoined = false;
    if (row.dataQualityScore == null) row.dataQualityScore = 0;
    if (row.dataQualityLevel == null) row.dataQualityLevel = DATA_QUALITY_LEVEL.MISSING;
    return row;
  });
  if (!s.supplyChain || typeof s.supplyChain !== 'object') s.supplyChain = {};
  if (s.supplyChain.qualityScore == null) s.supplyChain.qualityScore = 78;
  if (s.supplyChain.lv4CertifiedPct == null) s.supplyChain.lv4CertifiedPct = 43;
  if (s.supplyChain.industryAvgPct == null) s.supplyChain.industryAvgPct = 35;
  if (s.supplyChain.missingPct == null) s.supplyChain.missingPct = 22;
  if (!s.supplyChain.currentView) s.supplyChain.currentView = 'downstream';
  if (!Array.isArray(s.supplyChain.upstreamSources)) s.supplyChain.upstreamSources = [];
  if (!Array.isArray(s.supplyChain.resonanceGroups)) s.supplyChain.resonanceGroups = [];
  if (!s.batchVerification || typeof s.batchVerification !== 'object') s.batchVerification = {};
  if (!Array.isArray(s.batchVerification.factorUsageLog)) s.batchVerification.factorUsageLog = [];
  if (!Array.isArray(s.batchVerification.batches)) s.batchVerification.batches = [];
  if (!Array.isArray(s.batchVerification.certificates)) s.batchVerification.certificates = [];
  if (!Array.isArray(s.batchVerification.pendingApprovals)) s.batchVerification.pendingApprovals = [];
  return s;
}
window.ensureFactorAuthLedgerShape = ensureFactorAuthLedgerShape;

/**
 * 供应链绑定校验
 * 在核验模块引用原厂因子前调用
 * @param {string} factoryAnonymousId - 原厂的匿名ID（不是真实名称）
 * @param {string} downstreamCompanyId - 下游企业ID
 * @returns {boolean} 是否通过绑定校验
 *
 * [CURSOR注意] 这是反竞争保护的核心函数，不可绕过
 * 规则：下游企业只能引用其管理员已申报的上游原厂的因子
 * 未申报的原厂因子一律不可引用，降级为行业均值
 */
function checkSupplyChainBinding(factoryAnonymousId, downstreamCompanyId) {
  const st = window.AppState || {};
  const binding = gp(st, 'factorAuth.supplyChainBinding');
  if (!binding) return false;
  const rules = binding.antiCompetitionRules || {};
  if (rules.crossChainMatchingBlocked !== true) return false;
  if (!factoryAnonymousId || !downstreamCompanyId) return false;
  const declaredUpstream = Array.isArray(binding.upstreamMaterials) ? binding.upstreamMaterials : [];
  // [CURSOR注意] 实际比对逻辑由后端完成，前端仅做本地缓存校验
  return declaredUpstream.some(function (m) {
    if (!m || typeof m !== 'object') return false;
    return String(m.matchedFactoryAnonymousId || '').trim() === String(factoryAnonymousId).trim();
  });
}
window.checkSupplyChainBinding = checkSupplyChainBinding;

/** 已入池因子数：只统计 pooledByIndustry 中真实条目（不靠 MOCK 数字） */
function countFactorAuthPoolEntries(state) {
  const s = state || window.AppState;
  const fa = (s && s.factorAuth) || {};
  const pooled = fa.pooledByIndustry;
  if (!pooled || typeof pooled !== 'object') return Number(fa.poolCount) || 0;
  return Object.keys(pooled).filter(function (k) {
    const e = pooled[k];
    return e && e.factor != null && Number(e.factor) > 0;
  }).length;
}
window.countFactorAuthPoolEntries = countFactorAuthPoolEntries;

/** 写入一条行业入池记录（父页真理 + localStorage 缓存） */
function persistFactorAuthPoolEntry(entry) {
  if (!entry || !entry.industry) return null;
  const st = resolveWritableAppState() || window.AppState;
  if (!st) return null;
  const fa = Object.assign({}, st.factorAuth || {});
  const pooled = Object.assign({}, fa.pooledByIndustry || {});
  pooled[entry.industry] = {
    factor: Number(entry.factor),
    certNo: entry.certNo || '',
    pooledAt: entry.pooledAt || new Date().toISOString(),
    source: entry.source || 'attest',
  };
  fa.pooledByIndustry = pooled;
  fa.poolCount = Object.keys(pooled).filter(function (k) {
    return pooled[k] && pooled[k].factor != null;
  }).length;
  fa.confirmedFactor = Number(entry.factor);
  fa.confirmedIndustry = entry.industry;
  fa.industry = entry.industry;
  if (entry.pledgeBy) fa.pledgeBy = entry.pledgeBy;
  if (entry.gmPoolRewardClaimed) fa.gmPoolRewardClaimed = true;
  if (entry.honors) fa.honors = entry.honors;
  if (entry.gcaCertGenerated != null) fa.gcaCertGenerated = !!entry.gcaCertGenerated;
  if (entry.gcaCertId) fa.gcaCertId = entry.gcaCertId;
  if (entry.pueValue != null && Number.isFinite(Number(entry.pueValue))) fa.pueValue = Number(entry.pueValue);
  if (entry.industryScopeFormal) fa.industryScopeFormal = true;

  const delta = { factorAuth: fa };
  Object.assign(st, deepMerge(st, delta));
  try { saveCachedState(st); } catch (_) {}
  mirrorAppStateShadowCopy(st);
  try { syncAppState(st); } catch (_) {}
  return fa;
}
window.persistFactorAuthPoolEntry = persistFactorAuthPoolEntry;

/** 热力图：overview 的 metrics/resonance → factorAuth（后端不下发 factorAuth 时补全） */
function syncFactorAuthResonanceFromMetrics(state) {
  const s = state || window.AppState;
  if (!s) return s;
  try { ensureEvidenceContractShape(s); } catch (_) {}
  if (!s.factorAuth || typeof s.factorAuth !== 'object') s.factorAuth = {};
  try { ensureFactorAuthLedgerShape(s); } catch (_) {}
  const fa = s.factorAuth;
  const m = s.metrics || {};
  const res = s.resonance || {};
  const ia = s.industryAudit || {};
  const co = s.company || {};

  hydrateFactorAuthPoolFromIndustryAudit(s);

  const waitingSrc = Number(
    m.resonanceCount != null ? m.resonanceCount : m.resonance_count
  ) || Number(res.pendingRequestsForIndustry) || Number(m.crusadeCount != null ? m.crusadeCount : m.crusade_count) || 0;
  const taxSrc = Number(
    m.totalTaxPenalty != null ? m.totalTaxPenalty : m.total_tax_penalty
  ) || Number(ia.totalTaxPenaltyEur) || Number(m.riskExposureEur != null ? m.riskExposureEur : co.riskExposureEur) || 0;

  // Keep factor-auth heatmap metrics aligned with backend resonance counters.
  // Previous "only fill when empty" logic caused stale non-zero values when
  // pending requests were fulfilled and should have dropped back down.
  fa.waitingCount = Number.isFinite(waitingSrc) ? waitingSrc : 0;
  fa.taxRiskEur = Number.isFinite(taxSrc) ? taxSrc : 0;

  fa.poolCount = countFactorAuthPoolEntries(s);
  fa.poolDownstream = Number.isFinite(waitingSrc) ? waitingSrc : 0;

  return s;
}
window.syncFactorAuthResonanceFromMetrics = syncFactorAuthResonanceFromMetrics;

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
      if (typeof applyFinancialsInDocument === 'function') {
        applyFinancialsInDocument(window.AppState);
      }
      if (typeof refreshSupplyChainUi === 'function') refreshSupplyChainUi(window.AppState);
      if (typeof broadcastHubPipelineToEmbeds === 'function') {
        broadcastHubPipelineToEmbeds(window.AppState);
      }
    } catch (e) {
      console.warn('[AppState] STATE_SYNCED ui hook', e);
    }
  });
})();

(function wireSovereigntyEvidenceSynced() {
  if (typeof EventBus === 'undefined' || window.__hengaiSovereigntyEvidenceSyncedWired) return;
  window.__hengaiSovereigntyEvidenceSyncedWired = true;
  EventBus.on('SOVEREIGNTY_EVIDENCE_SYNCED', function (payload) {
    try {
      const p = payload || {};
      const st = resolveWritableAppState() || window.AppState;
      if (!st) return;
      if (!st.company || typeof st.company !== 'object') st.company = {};
      if (p.cityState != null) st.company.cityState = p.cityState;
      if (p.pullEligible != null) st.company.pullEligible = !!p.pullEligible;
      if (p.certificateId) st.company.verifiedFactorCertId = p.certificateId;
      if (p.holder && !st.company.name) st.company.name = p.holder;
      ensureEvidenceContractShape(st);
      if (st.cbam && st.cbam.evidence) {
        if (p.cityState === 'certified') st.cbam.evidence.mode = 'SOVEREIGN_VERIFIED';
        else if (p.cityState === 'evidence_building' || p.cityState === 'mat_pending') {
          st.cbam.evidence.mode = 'PENDING_VERIFICATION';
          st.cbam.evidence.stage = p.cityState === 'mat_pending' ? 'hardware_pending' : 'software_evidenced';
        }
        if (p.certificateId) {
          if (!st.cbam.evidence.verified || typeof st.cbam.evidence.verified !== 'object') st.cbam.evidence.verified = {};
          st.cbam.evidence.verified.certId = p.certificateId;
        }
      }
      syncAppState(st, { fromRemote: true, emitStateSynced: true });
      try { saveCachedState(st); } catch (_) {}
    } catch (e) {
      console.warn('[AppState] SOVEREIGNTY_EVIDENCE_SYNCED hook', e);
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
  purgeClientStateForAuthSwitch();
  resetAppStateShellOnAuthSwitch();
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
  try {
    const ovHeaders = { Accept: 'application/json', Authorization: 'Bearer ' + token };
    const ovRes = await fetchWithTimeout(API_HUB_OVERVIEW, { credentials: 'include', headers: ovHeaders }, API_TIMEOUT_MS);
    if (ovRes.ok) {
      const rawOv = await ovRes.json().catch(function () { return null; });
      const live = sanitizeOverviewPayload(rawOv || {});
      if (hubOverviewUserMatchesCurrent(live)) {
        replaceAuthoritativeAppStateFromLive(live);
        if (live.user && Object.keys(live.user).length) AppState.updateAuth(live.user, token);
        if (!AppState.flags) AppState.flags = {};
        AppState.flags.hubOverviewReady = true;
        saveCachedState(AppState);
        applyBackendJourneyFromState(AppState);
        syncAppState();
      }
    }
  } catch (loginOvErr) {
    console.warn('[HengAI.login] overview 拉取失败，首屏待 initAppState 对齐', loginOvErr);
  }
  // V3.2 契约：返回值形状对外稳定为 { ok, token, user }，让调用侧可以
  // 直接 `const { ok } = await HengAI.login(...); if (ok) { ... }`，避免
  // 对返回值结构的二次推断。
  return { ok: true, token, user: userObj };
};

/**
 * 登出：自动清本会话全部用户数据 → 重置 AppState → 硬刷新/跳转登录页。
 * 公用申报终端：用户 A 退出后用户 B 登录，不应看到 A 的任何核心数据；无需手动清浏览器。
 */
function hengaiDoLogout(options) {
  const opts = options || {};
  if (opts.confirm !== false) {
    if (!confirm('确定退出当前企业账号吗？\n\n退出后本机会自动清除您的会话数据，下一位用户可安全登录。')) {
      return false;
    }
  }
  purgeClientStateForAuthSwitch();
  clearToken();
  resetAppStateShellOnAuthSwitch();
  try {
    if (window.AppState && typeof window.AppState.updateAuth === 'function') {
      window.AppState.updateAuth(null, null);
    } else if (window.AppState) {
      window.AppState.auth = { user: null, token: null };
    }
  } catch (_) {}
  try { syncAppState(); } catch (_) {}
  try { EventBus.emit('AUTH_CHANGED', null); } catch (_) {}
  if (opts.redirect !== false) {
    const href = String(window.location.href || '');
    const path = String(window.location.pathname || '');
    const onHub = /全域中心\.html/i.test(href) || /全域中心\.html/i.test(path);
    const indexUrl = (typeof window.hengaiPage === 'function')
      ? window.hengaiPage('index.html')
      : 'index.html';
    if (onHub) {
      window.location.replace(indexUrl);
    } else {
      window.location.reload();
    }
  }
  return true;
}
window.hengaiDoLogout = hengaiDoLogout;
window.doLogout = hengaiDoLogout;
window.HengAI.logout = hengaiDoLogout;

/* ═══════════════════════════════════════════════════════════════════════
   7 · 格式化工具集 F（防呆）
   ═══════════════════════════════════════════════════════════════════════ */
function _numOrZero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const HENGAI_UI_PREFS_KEY = 'hengai_ui_prefs_v1';
const MONEY_DISPLAY_MODES = Object.freeze(['eur_primary', 'cny_primary', 'eur_only']);

function getFxRate() {
  const st = window.AppState || {};
  const macro = st.macro || {};
  const fx = Number(macro.eur_cny_rate);
  return fx > 0 ? fx : 7.85;
}

function getMoneyDisplayMode() {
  const st = window.AppState || {};
  const ui = st.ui || {};
  const m = String(ui.moneyDisplay || 'eur_primary');
  return MONEY_DISPLAY_MODES.includes(m) ? m : 'eur_primary';
}

function loadUiPrefs() {
  try {
    const raw = localStorage.getItem(HENGAI_UI_PREFS_KEY);
    if (!raw) return;
    const p = JSON.parse(raw);
    if (!window.AppState) window.AppState = {};
    if (!window.AppState.ui) window.AppState.ui = { moneyDisplay: 'eur_primary' };
    if (p.moneyDisplay && MONEY_DISPLAY_MODES.includes(p.moneyDisplay)) {
      window.AppState.ui.moneyDisplay = p.moneyDisplay;
    }
  } catch (_) {}
}

function setMoneyDisplay(mode) {
  if (!MONEY_DISPLAY_MODES.includes(mode)) return;
  if (!window.AppState) window.AppState = {};
  if (!window.AppState.ui) window.AppState.ui = {};
  window.AppState.ui.moneyDisplay = mode;
  try {
    localStorage.setItem(HENGAI_UI_PREFS_KEY, JSON.stringify({ moneyDisplay: mode }));
  } catch (_) {}
  if (typeof EventBus !== 'undefined' && EventBus.emit) {
    EventBus.emit('UI_PREFS_CHANGED', { moneyDisplay: mode });
  }
  if (typeof syncAppState === 'function') syncAppState(window.AppState, { skipGhostClear: true });
  if (typeof window.__hengaiRefreshMoneyDisplay === 'function') window.__hengaiRefreshMoneyDisplay();
  if (typeof syncMoneyPrefUi === 'function') syncMoneyPrefUi();
}

window.getFxRate = getFxRate;
window.getMoneyDisplayMode = getMoneyDisplayMode;
window.loadUiPrefs = loadUiPrefs;
window.setMoneyDisplay = setMoneyDisplay;
loadUiPrefs();

window.F = window.F || {
  n:    (v, d=0) => _numOrZero(v).toLocaleString('zh-CN', { minimumFractionDigits:d, maximumFractionDigits:d }),
  t:    (v)      => `${F.n(v == null ? 0 : v, 1)} tCO₂e`,
  eur:  (v)      => {
    const n = _numOrZero(v);
    if (n >= 1e6)  return `€${(n/1e6).toFixed(2)}M`;
    if (n >= 1e4)  return `€${F.n(n, 0)}`;
    return `€${F.n(n, 2)}`;
  },
  /** 碳税敞口 · 战情室大盘（优先「亿」单位） */
  eurYi: (v)      => {
    const n = _numOrZero(v);
    if (n >= 1e8) return `€ ${(n / 1e8).toFixed(2)}亿`;
    if (n >= 1e4) return `€ ${(n / 1e4).toFixed(2)}万`;
    return F.eur(n);
  },
  /** 紧凑欧元（K/M）· 决策级 KPI 主显 */
  eurCompact: (v) => {
    const n = _numOrZero(v);
    if (n <= 0) return '—';
    if (n >= 1e6) return '€' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '€' + Math.round(n / 1e3) + 'K';
    return '€' + Math.round(n);
  },
  /** 欧元敞口 → 人民币参考值 */
  cnyFromEur: (vEur) => {
    const cny = _numOrZero(vEur) * getFxRate();
    if (cny <= 0) return '—';
    if (cny >= 1e8) return '¥' + (cny / 1e8).toFixed(2) + '亿';
    if (cny >= 1e4) return '¥' + (cny / 1e4).toFixed(1) + '万';
    return '¥' + F.n(cny, 0);
  },
  /** 决策级 KPI · 单行文本 */
  moneyExposureText: (vEur) => {
    const n = _numOrZero(vEur);
    if (n <= 0) return '—';
    const mode = getMoneyDisplayMode();
    const eur = F.eurCompact(n);
    const cny = F.cnyFromEur(n);
    if (mode === 'eur_only') return eur;
    if (mode === 'cny_primary') return cny + '（' + eur + '）';
    return eur + ' ≈ ' + cny;
  },
  /** 决策级 KPI · HTML 双行（默认 € 主 + ¥ 副） */
  moneyExposureHtml: (vEur) => {
    const n = _numOrZero(vEur);
    if (n <= 0) return '—';
    const mode = getMoneyDisplayMode();
    const fx = getFxRate();
    const eur = F.eurCompact(n);
    const cny = F.cnyFromEur(n);
    const fxNote = '<span class="money-fx-note">汇率 ' + fx.toFixed(2) + ' · 参考折算</span>';
    if (mode === 'eur_only') {
      return '<span class="money-exposure money-eur-only"><span class="money-primary">' + eur + '</span></span>';
    }
    if (mode === 'cny_primary') {
      return '<span class="money-exposure money-cny-primary"><span class="money-primary">' + cny + '</span><span class="money-secondary">' + eur + ' · ' + fxNote + '</span></span>';
    }
    return '<span class="money-exposure money-eur-primary"><span class="money-primary">' + eur + '</span><span class="money-secondary">≈ ' + cny + ' · ' + fxNote + '</span></span>';
  },
  /** FM 占位：syncAppState 内识别 _moneyExposure 后走 moneyExposureHtml */
  moneyExposure: (v) => _numOrZero(v),
  crusade: (v)   => `${F.n(v == null ? 0 : v, 0)}`,
  cny:  (v)      => `¥${F.n(v == null ? 0 : v, 0)}`,
  pct:  (v, d=1) => `${(_numOrZero(v) * 100).toFixed(d)}%`,
  gm:   (v)      => `${F.n(v == null ? 0 : v, 0)} GM`,
  dt:   (v)      => {
    if (v == null || v === '') return '待记录';
    const s = String(v).trim();
    if (!s || s === '---' || s === '—') return '待记录';
    try {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return '待记录';
      return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch {
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '待记录';
    }
  },
  /** 月-日（时间轴短格式） */
  md:   (v)      => {
    if (v == null || v === '') return '待记录';
    const s = String(v).trim();
    if (!s || s === '---' || s === '—') return '待记录';
    try {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) {
        const m = s.match(/(\d{2})-(\d{2})/);
        return m ? `${m[1]}-${m[2]}` : '待记录';
      }
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    } catch {
      const m = s.match(/(\d{2})-(\d{2})/);
      return m ? `${m[1]}-${m[2]}` : '待记录';
    }
  },
  /** 完整日期时间（开机对时 / 服务端时钟） */
  dtm:  (v)      => {
    if (v == null || v === '') return '待记录';
    try {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return '待记录';
      return d.toLocaleString('zh-CN', { hour12: false });
    } catch { return '待记录'; }
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
  { c:'dyn-gm-balance-num',      p:'user.gmBalance',         f:(v)=>(v==null||v===''||Number.isNaN(Number(v)))?'0':F.n(v,0) },
  { c:'dyn-generational-income', p:'user.generationalGm',    f:(v)=>(v==null||v===''||Number.isNaN(Number(v)))?'0':F.n(v,0) },
  { c:'dyn-gm-month-delta',      p:'metrics.gmMonthlyDelta', f:(v)=>{const n=Number(v);return(!Number.isFinite(n)||n<=0)?'0':'+'+F.n(n,0);} },
  { c:'dyn-tax-intensity',       p:'metrics.carbonIntensity', f:(v)=>(v==null||v===''||Number.isNaN(Number(v))||Number(v)<=0)?'0.00':Number(v).toFixed(2) },
  { c:'dyn-carbon-intensity',    p:'metrics.carbonIntensity', f:(v)=>(v==null||v===''||Number.isNaN(Number(v))||Number(v)<=0)?'0.00':Number(v).toFixed(2) },
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
  { c:'dyn-company-industry',    p:'company.industryLabel' },
  { c:'dyn-company-stage',       p:'company.stageLabel' },
  { c:'dyn-ent-stage-label',     p:'company.stageLabel' },
  { c:'dyn-company-employees',   p:'company.employeeCount',  f:F.n },
  { c:'dyn-company-compliance',  p:'company.complianceLevel' },
  { c:'dyn-company-revenue',     p:'company.annualRevenue',  f:(v)=>v?`¥${F.n(v/10000,0)}万`:'0' },
  { c:'dyn-ent-code',            p:'company.creditCode' },
  { c:'dyn-ent-export-tons',     p:'company.exportTons',     f:(v)=>F.n(v == null ? 0 : v, 0)+' t' },
  { c:'dyn-acf-product',         p:'company.productLine' },
  { c:'dyn-acf-method',          p:'company.factorMethod' },
  { c:'dyn-customs-level',       p:'company.customsLevel' },
  { c:'dyn-customs-declare-count',p:'company.declareCount',  f:F.n },
  { c:'dyn-rep-roi',             p:null, compute:(s)=>computeRepFinancials(s).roiDisplay },
  { c:'dyn-rep-save',            p:null, compute:(s)=>computeRepFinancials(s).netSavingsDisplay },
  { c:'dyn-credit-limit',        p:'company.creditLimit' },
  { c:'dyn-interest-save',       p:'company.interestSave' },

  /* ── company form inputs ── */
  { c:'dyn-company-name-inp',    p:'company.name',           a:'value' },
  { c:'dyn-company-credit-inp',  p:'company.creditCode',     a:'value' },

  /* ── metrics ── */
  { c:'dyn-tco2e-total',         p:'metrics.tCO2eTotal',         f:F.t },
  { c:'dyn-tco2e-topbar',        p:'metrics.tCO2eTotal',         f:F.t },
  { c:'dyn-total-co2',           p:'metrics.tCO2eTotal',         f:(v)=>F.n(v == null ? 0 : v, 1) },
  { c:'dyn-global-rank',         p:'metrics.globalRank',         f:(v)=>v?`#${F.n(v,0)}`:'0' },
  { c:'dyn-roi-ratio',           p:'metrics.roiRatio',           f:(v)=>F.pct(v == null ? 0 : v) },
  { c:'dyn-supply-pct',          p:'metrics.supplyChainCoverage',f:F.pct },
  { c:'dyn-sup-pct',             p:'metrics.supplyChainCoverage',f:F.pct },
  { c:'dyn-supply-coverage',     p:'metrics.supplyChainCoverage',f:F.pct },
  { c:'dyn-scope3-pct',          p:'metrics.scope3Coverage',     f:F.pct },
  { c:'dyn-risk-eur',            p:'metrics.riskExposureEur',    f:F.moneyExposure, moneyExposure: true },
  { c:'dyn-tax-risk',            p:'metrics.totalTaxPenalty',    f:F.moneyExposure, moneyExposure: true },
  { c:'dyn-tax-penalty',         p:'metrics.totalTaxPenalty',    f:F.moneyExposure, moneyExposure: true },
  { c:'dyn-crusade-count',       p:'metrics.crusadeCount',       f:F.crusade },
  { c:'dyn-resonance-count',     p:'metrics.resonanceCount',     f:F.n },
  { c:'dyn-resonance-rank',      p:'resonance.userRank',         f:(v)=>v != null && v !== '' ? F.n(v, 0) : '—' },
  { c:'dyn-resonance-amount',    p:'metrics.totalTaxPenalty',    f:F.moneyExposure, moneyExposure: true },
  { c:'dyn-cbam-tax',            p:'metrics.cbamTaxEstimate',    f:F.moneyExposure, moneyExposure: true },
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
  { c:'dyn-tax-savings',         p:'metrics.taxSavingsWan',      f:(v)=>`${F.n(v == null ? 0 : v, 2)} 万` },
  { c:'dyn-roi-multiple',        p:'metrics.roiMultiple',        f:(v)=>`${F.n(v == null ? 0 : v, 1)}x` },
  { c:'dyn-scope1-tco2',         p:'metrics.scope1',             f:(v)=>F.n(v == null ? 0 : v, 1) },
  { c:'dyn-scope2-tco2',         p:'metrics.scope2',             f:(v)=>F.n(v == null ? 0 : v, 1) },
  { c:'dyn-scope3-tco2',         p:'metrics.scope3',             f:(v)=>F.n(v == null ? 0 : v, 1) },
  { c:'dyn-rep-tax',             p:null, compute:(s)=>computeRepFinancials(s).riskNum, f:F.moneyExposure, moneyExposure: true },

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
  { c:'dyn-rep-risk',            p:'recentReports.0.riskExposureEur', f:F.moneyExposure, moneyExposure: true },

  /* ── diagnostic ── */
  { c:'dyn-diag-risk-level',     p:'metrics.riskExposureEur', f:(v)=>!v?'低风险':v>100000?'高风险':v>30000?'中等风险':'低风险' },
  { c:'dyn-diag-risk-eur',       p:'metrics.riskExposureEur', f:F.moneyExposure, moneyExposure: true },
  { c:'dyn-diag-tco2e',          p:'metrics.tCO2eTotal',      f:F.t },
  { c:'dyn-diag-score',          p:'diagnostic.overallScore' },

  /* ── compute ── */
  { c:'dyn-token-quota',         p:'compute.tokenQuota',     f:F.n },
  { c:'dyn-token-used',          p:'compute.tokenUsed',      f:F.n },
  { c:'dyn-deep-quota',          p:'compute.deepCalcQuota',  f:F.n },
  { c:'dyn-deep-used',           p:'compute.deepCalcUsed',   f:F.n },

  /* ── DLD / ACF / governance ── */
  { c:'dyn-dld-co2',             p:'dld.certifiedCO2e',      f:(v)=>`${F.n(v == null ? 0 : v, 1)} tCO₂e` },
  { c:'dyn-dld-credit',          p:'dld.creditLimit' },
  { c:'dyn-dld-status',          p:'dld.creditStatus' },
  { c:'dyn-acf-status',          p:'acf.certStatus' },
  { c:'dyn-gov-seat',            p:'governance.seatTitle' },
  { c:'dyn-gov-votes',           p:'governance.votesAvailable', f:F.n },
  { c:'dyn-gov-members',         p:'governance.totalMembers',   f:F.n },

  /* ── decision package ── */
  { c:'dyn-decision-tax-k',      p:null, compute:(s)=>computeRepFinancials(s).riskCompact },

  /* ── server time ── */
  { c:'dyn-server-time',         p:'serverTime', f:F.dtm },
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
function _parseBindNum(str) {
  const s = String(str || '').trim();
  if (!s || s === '...' || s === '—' || s === '--' || s === '待录入') return NaN;
  const m = s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

function _isFortressScoreEl(el) {
  const bind = el && el.getAttribute ? el.getAttribute('data-state-bind') || '' : '';
  return /^fortress\.(avgScore|dim)/.test(bind);
}

function _cancelCountUp(el) {
  if (el && el._countUpRaf) {
    cancelAnimationFrame(el._countUpRaf);
    el._countUpRaf = null;
  }
  if (el) el.classList.remove('counting');
}

function countUp(el, toStr, dur=700) {
  _cancelCountUp(el);
  const bind = String(el.getAttribute('data-state-bind') || '');
  const isFortress = _isFortressScoreEl(el);
  const from = _parseBindNum(el.textContent);
  let to = _parseBindNum(toStr);
  if (isFortress) {
    if (!Number.isFinite(to)) { el.textContent = String(toStr); return; }
    to = Math.max(0, Math.min(100, Math.round(to)));
    const toDisplay = bind === 'fortress.avgScore' ? String(to) : String(to) + '%';
    const fromSafe = Number.isFinite(from) && from >= 0 && from <= 100 ? Math.round(from) : NaN;
    if (isNaN(fromSafe) || fromSafe === to) { el.textContent = toDisplay; return; }
    const t0 = performance.now();
    el.classList.add('counting');
    function fr(now) {
      const p = Math.min((now - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      const c = Math.round(fromSafe + (to - fromSafe) * e);
      el.textContent = bind === 'fortress.avgScore' ? String(c) : String(c) + '%';
      if (p < 1) el._countUpRaf = requestAnimationFrame(fr);
      else { el.textContent = toDisplay; el._countUpRaf = null; el.classList.remove('counting'); }
    }
    el._countUpRaf = requestAnimationFrame(fr);
    return;
  }
  if (isNaN(from) || isNaN(to) || from === to) { el.textContent = toStr; return; }
  if (to < 0 || !Number.isFinite(to) || Math.abs(to) > 1e12) { el.textContent = toStr; return; }
  if (from < 0 || !Number.isFinite(from) || Math.abs(from) > 1e12) { el.textContent = toStr; return; }
  const cls = String(el.className || '') + ' ' + bind;
  const isCi = /intensity|carbon-intensity|dyn-carbon|碳强度/i.test(cls);
  const forcedDec = el.getAttribute('data-decimals');
  const dec = forcedDec != null && forcedDec !== ''
    ? Math.max(0, Math.min(4, parseInt(forcedDec, 10) || 0))
    : (isCi ? 2 : (/intensity|ci/i.test(cls) ? 2 : 0));
  const pre = String(toStr).match(/^[^\d-]*/)?.[0]||'';
  const suf = String(toStr).match(/[^\d.,]+$/)?.[0]||'';
  const t0  = performance.now();
  el.classList.add('counting');
  function fr(now) {
    const p = Math.min((now-t0)/dur,1);
    const e = 1 - Math.pow(1-p, 3);
    const c = from+(to-from)*e;
    el.textContent = pre+c.toLocaleString('zh-CN',{minimumFractionDigits:dec,maximumFractionDigits:dec})+(p<1?'':suf);
    if (p<1) el._countUpRaf = requestAnimationFrame(fr);
    else { el.textContent=toStr; el._countUpRaf = null; el.classList.remove('counting'); }
  }
  el._countUpRaf = requestAnimationFrame(fr);
}

const PENDING_FIELD_STYLE = 'rgba(250, 204, 21, 0.14)';

function _isNumericStatePath(path, cls) {
  const key = String(path || cls || '');
  return /fortress\.|metrics\.|gm|tax|co2|count|pct|intensity|roi|eur|cny|tokens|rank|scope|reduction|energy|quota|supplier|carbon|savings|wan/i.test(key);
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
      if (empty != null) d = empty;
      else if (_isNumericStatePath(path)) d = fmtKey === 'pct' ? '0%' : '0';
      else d = '待录入';
    } else if (fmtKey === 'dt' || fmtKey === 'date') {
      try { d = F.dt(raw); } catch { d = '待记录'; }
    } else if (fmtKey === 'md') {
      try { d = F.md(raw); } catch { d = '待记录'; }
    } else if (fmtKey === 'dtm') {
      try { d = F.dtm(raw); } catch { d = '待记录'; }
    } else if (fmtKey === 'n') {
      const dec = Number(el.getAttribute('data-decimals') || 0);
      d = F.n(raw, dec);
    } else if (fmtKey === 'eur') {
      d = F.eur(raw);
    } else if (fmtKey === 'moneyExposure') {
      const n = _numOrZero(raw);
      if (attr === 'value') d = F.moneyExposureText(n);
      else {
        el.innerHTML = n > 0 ? F.moneyExposureHtml(n) : (empty || '—');
        return;
      }
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
    if (raw == null || raw === '') {
      if (d === '待录入') {
        el.classList.add('hengai-pending-field');
        el.style.backgroundColor = PENDING_FIELD_STYLE;
      }
    } else {
      el.classList.remove('hengai-pending-field');
      if (el.classList.contains('hengai-pending-field') || el.style.backgroundColor === PENDING_FIELD_STYLE) {
        el.style.backgroundColor = '';
      }
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
  const d = (val==null||val==='') ? '0' : String(val);
  if (attr) {
    if (attr.startsWith('style.')) el.style[attr.slice(6)] = d;
    else el.setAttribute(attr, d);
    return;
  }
  if (el.textContent===d) return;
  const pending = el.textContent==='—'||el.textContent==='--'||el.textContent==='待录入'||el.textContent==='...';
  const ov = _parseBindNum(el.textContent);
  const nv = _parseBindNum(d);
  if (!pending && !isNaN(ov) && !isNaN(nv) && ov >= 0 && nv >= 0) {
    countUp(el, d);
  } else {
    _cancelCountUp(el);
    el.classList.add('hash-jump');
    el.textContent = d;
    setTimeout(()=>el.classList.remove('hash-jump'), 400);
  }
}

function applyPendingDynScan(s) {
  if (!s) return;
  document.querySelectorAll('[class*="dyn-"]').forEach((el) => {
    const dynCls = [...el.classList].find((c) => c.startsWith('dyn-'));
    if (!dynCls) return;
    const binding = FM.find((x) => x.c === dynCls);
    if (!binding) return;
    const raw = binding.compute ? binding.compute(s) : gp(s, binding.p);
    if (raw != null && raw !== '') return;
    const isNum = _isNumericStatePath(binding.p, dynCls);
    const pending = isNum ? '0' : '待录入';
    if (el.textContent === '—' || el.textContent === '--' || el.textContent === '---' || el.textContent === '') {
      setEl(el, pending, binding.a);
    }
    if (!isNum) {
      el.classList.add('hengai-pending-field');
      el.style.backgroundColor = PENDING_FIELD_STYLE;
    }
  });
}

function upsertSupplierNodeInList(list, node) {
  const nodes = Array.isArray(list) ? list.slice() : [];
  const nid = node.id != null ? String(node.id) : '';
  const nname = String(node.supplierName || node.supplier_name || '').trim().toLowerCase();
  let idx = -1;
  if (nid) idx = nodes.findIndex((n) => n && String(n.id) === nid);
  if (idx < 0 && nname) {
    idx = nodes.findIndex((n) => {
      if (!n) return false;
      return String(n.supplierName || n.supplier_name || '').trim().toLowerCase() === nname;
    });
  }
  if (idx >= 0) nodes[idx] = Object.assign({}, nodes[idx], node);
  else nodes.push(node);
  return nodes;
}

function supplierInviteIssued(node) {
  if (!node) return false;
  const code = node.inviteCode || node.invite_code;
  if (code && String(code).trim()) return true;
  if (node.inviteIssued === true || node.invite_issued === true) return true;
  return false;
}
window.supplierInviteIssued = supplierInviteIssued;

function recomputeSupplyMetricsFromNodes(nodes, baseMetrics) {
  const metrics = Object.assign({}, baseMetrics || {});
  let sub = 0;
  let inv = 0;
  const tot = nodes.length;
  nodes.forEach((n) => {
    const status = String((n && (n.status || n.supplierStatus)) || '').toLowerCase();
    if (status === 'submitted' || status === 'confirmed') sub += 1;
    else if (supplierInviteIssued(n)) inv += 1;
  });
  metrics.supplierCount = tot;
  metrics.supplierSubmitted = sub;
  metrics.supplierSubmittedCount = sub;
  metrics.supplierPendingCount = inv;
  if (tot > 0) {
    const cov = sub / tot;
    metrics.supplyChainCoverage = cov;
    metrics.scope3Coverage = cov;
    metrics.scope3Rate = cov * 100;
  }
  return metrics;
}

function _supplierStatusLabel(st, node) {
  const n = node && typeof node === 'object' ? node : null;
  const raw = n ? (n.status || n.supplierStatus || st) : st;
  const s = String(raw || '').toLowerCase();
  if (s === 'submitted' || s === 'confirmed') return { text: '已确权', cls: 'sc-done', done: true };
  if (supplierInviteIssued(n || { status: s, inviteCode: null })) {
    return { text: '已邀请·待填报', cls: 'sc-invite', done: false, awaiting: true };
  }
  if (s === 'draft' || s === 'none' || s === 'missing' || s === 'uninvited') {
    return { text: '待邀请', cls: 'sc-missing', done: false, needsInvite: true };
  }
  return { text: '待邀请', cls: 'sc-missing', done: false, needsInvite: true };
}
window._supplierStatusLabel = _supplierStatusLabel;

function _supplierIsCompleted(st) {
  const s = String(st || '').toLowerCase();
  return s === 'submitted' || s === 'confirmed';
}

function formatSupplierCarbonIntensity(node, isDone) {
  if (!isDone) return '—';
  const raw = node.carbonIntensityIndex != null
    ? node.carbonIntensityIndex
    : (node.tco2eReported != null ? node.tco2eReported : node.tco2e_reported);
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) {
    const issued = supplierInviteIssued(node);
    const tip = issued
      ? '链主已签发邀请，但供应商须在 H5 Screen2 点击「本地加密并生成碳足迹」后，碳强度才会写入此列'
      : '请先发送穿透卡片，并由供应商在 H5 完成 Screen2「生成碳足迹」';
    return '<span style="color:var(--amber);font-size:11px" title="' + tip + '">待回填</span>';
  }
  return (typeof F !== 'undefined' && F.n) ? F.n(num, 2) : num.toFixed(2);
}
window.formatSupplierCarbonIntensity = formatSupplierCarbonIntensity;

function getSupplierFactorStatusBadge(node) {
  var upstream = node && node.upstreamDeclaration;
  if (!upstream || typeof upstream !== 'object') {
    return '<span class="pill p-r" style="font-size:9.5px">🔴 因子缺失</span>';
  }
  var cfg = getSupplierFactorStatusMeta(upstream.factorStatus);
  return '<span class="pill ' + cfg.cls + '" title="' + F.esc(cfg.tip) + '" style="font-size:9.5px">'
    + cfg.icon + ' ' + cfg.txt + '</span>';
}
function getSupplierFactorStatusMeta(status) {
  var configs = {
    [FACTOR_STATUS.LV4_CERTIFIED]: {
      cls: 'p-g',
      icon: '🟢',
      txt: 'Lv.4确权',
      tip: '上游原厂已入因子池，使用认证因子'
    },
    [FACTOR_STATUS.INDUSTRY_AVG]: {
      cls: 'p-y',
      icon: '🟡',
      txt: '行业均值',
      tip: '使用行业平均值，存在税款高估风险'
    },
    [FACTOR_STATUS.RESONATING]: {
      cls: 'p-o',
      icon: '⚡',
      txt: '共振中',
      tip: '已发起因子请求，等待原厂响应'
    },
    [FACTOR_STATUS.MISSING]: {
      cls: 'p-r',
      icon: '🔴',
      txt: '因子缺失',
      tip: '未申报上游来源，碳数据不完整'
    }
  };
  return configs[status] || configs[FACTOR_STATUS.MISSING];
}
window.getSupplierFactorStatusMeta = getSupplierFactorStatusMeta;

function hengaiSortSupplierNodes(nodes) {
  const list = Array.isArray(nodes) ? nodes.slice() : [];
  return list.sort((a, b) => {
    const na = String((a && (a.supplierName || a.supplier_name)) || '');
    const nb = String((b && (b.supplierName || b.supplier_name)) || '');
    const ma = na.match(/节点\s*(\d+)/);
    const mb = nb.match(/节点\s*(\d+)/);
    if (ma && mb) return parseInt(ma[1], 10) - parseInt(mb[1], 10);
    return na.localeCompare(nb, 'zh-CN');
  });
}
window.hengaiSortSupplierNodes = hengaiSortSupplierNodes;

window.hengaiReconcileSupplierNodes = async function hengaiReconcileSupplierNodes() {
  const apiBase = String(hengaiApiOrigin() || '').replace(/\/+$/, '');
  const token = (typeof getToken === 'function' && getToken()) || '';
  const res = await fetch(apiBase + '/api/v1/hub/supplier-reconcile', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: '{}',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.detail || data.message || res.statusText;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  const st = (window.resolveWritableAppState && window.resolveWritableAppState()) || window.AppState;
  const appState = data.appState || data.app_state;
  if (appState && st) {
    if (typeof mergeAuthoritativeAppStateFromServer === 'function') {
      mergeAuthoritativeAppStateFromServer(appState);
    } else {
      Object.assign(st, deepMerge(st, sanitizeOverviewPayload(appState)));
      try { mirrorAppStateShadowCopy(st); } catch (_) {}
      syncAppState(st, { fromRemote: true });
    }
  }
  if (typeof window.hengaiRefreshSupplyConsole === 'function') window.hengaiRefreshSupplyConsole(st);
  return data;
};

window.hengaiMergeSupplierDuplicates = async function hengaiMergeSupplierDuplicates(opts) {
  opts = opts || {};
  const st = (window.resolveWritableAppState && window.resolveWritableAppState()) || window.AppState;
  const apiBase = String(hengaiApiOrigin() || '').replace(/\/+$/, '');
  const token = (typeof getToken === 'function' && getToken()) || '';
  const body = {
    keep_supplier_name: opts.keepSupplierName || opts.keep_supplier_name,
    remove_supplier_name: opts.removeSupplierName || opts.remove_supplier_name,
    keep_node_id: opts.keepNodeId || opts.keep_node_id,
    remove_node_id: opts.removeNodeId || opts.remove_node_id,
  };
  const res = await fetch(apiBase + '/api/v1/hub/supplier-merge-duplicates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.detail || data.message || res.statusText;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  const appState = data.appState || data.app_state;
  if (appState && st) {
    if (typeof mergeAuthoritativeAppStateFromServer === 'function') {
      mergeAuthoritativeAppStateFromServer(appState);
    } else {
      Object.assign(st, deepMerge(st, sanitizeOverviewPayload(appState)));
      try { mirrorAppStateShadowCopy(st); } catch (_) {}
      syncAppState(st, { fromRemote: true });
    }
  }
  if (typeof window.hengaiRefreshSupplyConsole === 'function') window.hengaiRefreshSupplyConsole(st);
  return data;
};

function computeClIvcHash(name, isoTime, intensity, nodeId) {
  const raw = String(nodeId || '') + '|' + String(name || '') + '|' + String(isoTime || '') + '|' + String(intensity || '');
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hex = (h >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return 'CL-IVC-' + hex + '-' + Date.now().toString(36).toUpperCase().slice(-6);
}

const CL_IVC_VIS_LOCK_TOOLTIP =
  'CL-IVC 物理隔离协议生效中：供应商能源账单等原始机密仅保存在供应商主权节点，您当前仅拥有结果查阅权。';

function openCarbonSovereigntyCertModal(node) {
  const data = node || {};
  const modal = document.getElementById('carbon-sovereignty-cert-modal');
  if (!modal) return;
  const name = String(data.supplierName || data.supplier_name || data.name || '供应链节点');
  const iso = data.submittedAt || data.submitted_at || data.at || data.updatedAt || data.updated_at || new Date().toISOString();
  const timeStr = (typeof F !== 'undefined' && F.dt) ? F.dt(iso) : String(iso).slice(0, 19).replace('T', ' ');
  const tco = data.tco2eReported != null ? data.tco2eReported : data.tco2e_reported;
  const intensityNum = tco != null && Number.isFinite(Number(tco))
    ? Number(tco)
    : (data.intensity != null && Number.isFinite(Number(data.intensity)) ? Number(data.intensity) : 0);
  const intensity = (typeof F !== 'undefined' && F.n) ? F.n(intensityNum, 2) : intensityNum.toFixed(2);
  const nodeId = data.id || data.nodeId || data.supplierNodeId || '';
  const hash = data.clIvcHash || data.cl_ivc_hash || computeClIvcHash(name, iso, intensity, nodeId);
  const conf = supplierConfidenceLabel(data);
  window.__hengaiLastCertPayload = { name, timeStr, intensity, hash, conf, node: data };
  modal.querySelectorAll('[data-state-bind]').forEach((el) => {
    const path = el.getAttribute('data-state-bind');
    if (path === 'cert.enterpriseName') el.textContent = name;
    else if (path === 'cert.issuedAt') el.textContent = timeStr;
    else if (path === 'cert.carbonIntensity') el.textContent = intensity + ' tCO₂e/t';
    else if (path === 'cert.confidenceLevel') el.textContent = conf;
    else if (path === 'cert.clIvcHash') el.textContent = hash;
  });
  modal.classList.add('open');
}

function downloadCarbonSovereigntyCertCard() {
  const p = window.__hengaiLastCertPayload || {};
  const card = document.querySelector('#carbon-sovereignty-cert-modal .cert-gold-card');
  if (!card) return;
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>碳贡献确权凭证</title>'
    + '<style>body{font-family:"Noto Sans SC",sans-serif;background:#0a0d16;color:#f0d080;padding:32px}'
    + '.card{max-width:440px;margin:0 auto;border:2px solid #c9a84c;border-radius:18px;padding:26px;background:linear-gradient(145deg,#1a1408,#2a2010)}'
    + '.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(201,168,76,.2);font-size:13px}'
    + '.lbl{color:#8896aa}.val{font-family:monospace;color:#f0d080;text-align:right}'
    + '.foot{margin-top:14px;padding:10px 12px;border:1px solid rgba(201,168,76,.35);border-radius:9px;font-size:12px;line-height:1.65;color:#f0d080}'
    + '</style></head><body><div class="card">'
    + '<div style="font-size:11px;letter-spacing:1.2px;color:#c9a84c;margin-bottom:8px">🛡️ CL-IVC · 碳资产确权凭证</div>'
    + '<div style="font-size:18px;font-weight:700;margin-bottom:14px">碳贡献确权凭证</div>'
    + '<div class="row"><span class="lbl">企业名称</span><span class="val">' + (p.name || '...') + '</span></div>'
    + '<div class="row"><span class="lbl">填报时间</span><span class="val">' + (p.timeStr || '...') + '</span></div>'
    + '<div class="row"><span class="lbl">碳强度</span><span class="val">' + (p.intensity || '0') + ' tCO₂e/t</span></div>'
    + '<div class="row"><span class="lbl">数据置信度</span><span class="val">' + (p.conf || '...') + '</span></div>'
    + '<div class="row"><span class="lbl">CL-IVC 哈希</span><span class="val">' + (p.hash || '...') + '</span></div>'
    + '<div class="foot">此凭证属于供应商，甲方仅可查阅碳强度结论，不可访问原始数据。原始工艺与能耗数据保留在供应商主权节点。</div>'
    + '</div></body></html>';
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'HengAI-碳贡献确权凭证-' + (p.name || 'supplier').replace(/[^\w\u4e00-\u9fff-]+/g, '_') + '.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if (typeof window.showToast === 'function') window.showToast('✓ 凭证卡片已下载', 'gold');
}

function openCarbonSovereigntyCert(encoded) {
  let node;
  try { node = typeof encoded === 'string' ? JSON.parse(decodeURIComponent(encoded)) : encoded; } catch (e) { return; }
  openCarbonSovereigntyCertModal(node);
}

function closeCarbonSovereigntyCertModal() {
  const modal = document.getElementById('carbon-sovereignty-cert-modal');
  if (modal) modal.classList.remove('open');
}

/** 城池等级（碳所有权框架 · 地基→要塞 共 5 级） */
const FORTRESS_LEVELS = ['地基', '初建', '成型', '强化', '要塞'];
const FORTRESS_MILESTONES = {
  '地基': '城池奠基 · 开始积累供应链碳信用',
  '初建': '初建完成 · 首条供应商数据已确权',
  '成型': '城池成型 · 覆盖率与置信度达标',
  '强化': '强化升级 · 四维雷达综合得分突破 62',
  '要塞': '要塞建成 · 供应链碳信用基础设施成熟',
};

function notifyFortressLevelUp(prevLevel, nextLevel) {
  if (!nextLevel || prevLevel === nextLevel) return;
  const msg = FORTRESS_MILESTONES[nextLevel] || ('城池升级至「' + nextLevel + '」');
  if (typeof window.showToast === 'function') {
    window.showToast('🏰 ' + msg, 'gold');
  }
  const tip = document.getElementById('fortress-milestone-tip');
  if (tip) {
    tip.textContent = '🏰 里程碑：' + msg;
    tip.classList.add('show');
    setTimeout(function () { tip.classList.remove('show'); }, 8000);
  }
  const panel = document.getElementById('fortress-panel');
  if (panel) {
    panel.classList.remove('fortress-level-up');
    void panel.offsetWidth;
    panel.classList.add('fortress-level-up');
    setTimeout(function () { panel.classList.remove('fortress-level-up'); }, 2400);
  }
  const badge = document.getElementById('fortress-level-badge');
  if (badge) {
    badge.textContent = nextLevel;
    badge.classList.add('fortress-badge-pulse');
    setTimeout(function () { badge.classList.remove('fortress-badge-pulse'); }, 1800);
  }
}

function resolveSupplierList(state) {
  const s = state || window.AppState || {};
  if (Array.isArray(s.suppliers) && s.suppliers.length) return s.suppliers;
  if (Array.isArray(s.supplierNodes) && s.supplierNodes.length) return s.supplierNodes;
  return [];
}

function computeSupplierCollaborationScore(node) {
  if (!node) return 0;
  if (node.collaborationScore != null && Number.isFinite(Number(node.collaborationScore))) {
    return Math.max(0, Math.min(100, Math.round(Number(node.collaborationScore))));
  }
  const dqRaw = Number(node.dataQualityScore != null ? node.dataQualityScore : node.data_quality_score);
  const confidence = Number.isFinite(dqRaw) ? (dqRaw > 1 ? dqRaw / 100 : dqRaw) : 0;
  const st = String((node.status || node.supplierStatus) || '').toLowerCase();
  const done = st === 'submitted' || st === 'confirmed';
  const timeliness = Number(node.reportTimeliness != null ? node.reportTimeliness : node.report_timeliness);
  const tScore = Number.isFinite(timeliness) && timeliness > 0 ? timeliness : (done ? 0.82 : 0.35);
  const consecutive = Number(node.consecutiveSubmissions != null ? node.consecutiveSubmissions : node.consecutive_submissions);
  const subCount = Number(node.submissionCount != null ? node.submissionCount : node.submission_count);
  const cCount = Number.isFinite(consecutive) && consecutive > 0
    ? consecutive
    : (Number.isFinite(subCount) && subCount > 0 ? subCount : (done ? 1 : 0));
  const conf = done && confidence <= 0 ? 0.72 : Math.max(confidence, 0.25);
  return Math.max(0, Math.min(100, Math.round(tScore * conf * Math.max(cCount, 0) * 100)));
}

function supplierConfidenceLabel(node) {
  if (node && (node.confidenceLevel || node.confidence_level)) {
    return String(node.confidenceLevel || node.confidence_level);
  }
  const dq = Number(node && (node.dataQualityScore != null ? node.dataQualityScore : node.data_quality_score));
  if (!Number.isFinite(dq)) return '...';
  const v = dq > 1 ? dq / 100 : dq;
  if (v >= 0.9) return 'A · 高置信';
  if (v >= 0.75) return 'B · 良好';
  if (v >= 0.55) return 'C · 可用';
  return 'D · 待提升';
}

function fortressLevelFromSignals(cov, avg, isComplete) {
  if (!isComplete) return '地基';
  if (avg >= 82 || cov >= 0.85) return '要塞';
  if (avg >= 62 || cov >= 0.6) return '强化';
  if (avg >= 40 || cov >= 0.35) return '成型';
  if (avg >= 18) return '初建';
  return '地基';
}

/**
 * 城池雷达四维：时间跨度 / 置信度 / 完整性 / 减排趋势（AppState.fortress 驱动）
 */
function updateFortressRadar(state) {
  const s = state || window.AppState;
  if (!s) return;
  const panel = document.getElementById('fortress-panel');
  if (!panel) return;
  const m = s.metrics || {};
  const u = s.user || {};
  const co = s.company || {};
  const nodes = resolveSupplierList(s);

  let cov = Number(m.supplyChainCoverage != null ? m.supplyChainCoverage : m.scope3Coverage);
  const total = Number(m.supplierCount) || nodes.length || 0;
  const submitted = Number(m.supplierSubmittedCount != null ? m.supplierSubmittedCount : m.supplierSubmitted) || 0;
  if (!Number.isFinite(cov)) cov = total > 0 ? submitted / total : 0;
  if (cov > 1) cov = cov / 100;

  const fb = s.fortress;
  let dims = null;
  let serverLevel = null;
  let serverAvg = null;
  if (fb && fb.source === 'server' && Array.isArray(fb.dims) && fb.dims.length === 4) {
    const parsed = fb.dims.map((v) => Number(v));
    if (parsed.every((v) => Number.isFinite(v))) {
      dims = parsed.map((v) => Math.max(0, Math.min(100, Math.round(v))));
      if (fb.levelLabel) serverLevel = String(fb.levelLabel);
      const sa = Number(fb.avgScoreNum != null ? fb.avgScoreNum : fb.avgScore);
      if (Number.isFinite(sa)) serverAvg = Math.round(sa);
    }
  }

  if (!dims) {
    let dataYears = 0;
    const reg = u.regDate || u.reg_date || u.regLabel;
    if (reg) {
      try {
        const d0 = new Date(String(reg).replace(/年|月/g, '-').replace(/日/g, ''));
        if (!Number.isNaN(d0.getTime())) {
          dataYears = Math.max(0, (Date.now() - d0.getTime()) / (365.25 * 86400000));
        }
      } catch (_) {}
    }
    const submittedNodes = nodes.filter((n) => {
      const st = String((n && (n.status || n.supplierStatus)) || '').toLowerCase();
      return st === 'submitted' || st === 'confirmed';
    });
    const dqVals = submittedNodes.map((n) => {
      const v = Number(n.dataQualityScore != null ? n.dataQualityScore : n.data_quality_score);
      return Number.isFinite(v) ? (v > 1 ? v / 100 : v) : 0.72;
    });
    const avgDq = dqVals.length ? dqVals.reduce((a, b) => a + b, 0) / dqVals.length : 0;
    const reduction = Number(m.reductionAchievedPct != null ? m.reductionAchievedPct : m.reductionTrendPct);
    dims = [
      Math.max(0, Math.min(100, Math.round(Math.min(dataYears, 4) / 4 * 100))),
      Math.max(0, Math.min(100, Math.round(avgDq * 100))),
      Math.max(0, Math.min(100, Math.round(cov * 100))),
      Math.max(0, Math.min(100, Number.isFinite(reduction) ? Math.round(reduction) : 0)),
    ];
  }

  const avg = serverAvg != null ? serverAvg : Math.round(dims.reduce((a, b) => a + b, 0) / 4);
  const isComplete = co.isComplete === true || co.is_complete === true
    || Number(m.riskExposureEur || 0) > 0 || !!(s.cbam && s.cbam.calcResult);
  const tier = serverLevel || fortressLevelFromSignals(cov, avg, isComplete);

  const prevLevel = (typeof window.__hengaiFortressLevel === 'string') ? window.__hengaiFortressLevel : null;
  if (prevLevel && prevLevel !== tier) notifyFortressLevelUp(prevLevel, tier);
  window.__hengaiFortressLevel = tier;

  if (!s.fortress) s.fortress = {};
  Object.assign(s.fortress, {
    levelLabel: tier,
    tier,
    dims,
    dimTimeSpan: String(dims[0]) + '%',
    dimConfidence: String(dims[1]) + '%',
    dimCompleteness: String(dims[2]) + '%',
    dimReduction: String(dims[3]) + '%',
    dimCoverage: String(dims[2]) + '%',
    dimSovereignty: String(dims[1]) + '%',
    dimNetwork: String(dims[0]) + '%',
    dimTrust: String(dims[3]) + '%',
    avgScore: String(avg),
    avgScoreNum: avg,
  });

  const cx = 90;
  const cy = 90;
  const r = 62;
  const angles = [-90, 0, 90, 180];
  const pts = dims.map((v, i) => {
    const rad = angles[i] * Math.PI / 180;
    const dist = (Math.max(8, v) / 100) * r;
    return (cx + Math.cos(rad) * dist).toFixed(1) + ',' + (cy + Math.sin(rad) * dist).toFixed(1);
  }).join(' ');
  const poly = panel.querySelector('#fortress-radar-poly');
  if (poly) poly.setAttribute('points', pts);
  panel.querySelectorAll('[data-fortress-dim]').forEach((el) => {
    const idx = Number(el.getAttribute('data-fortress-dim'));
    if (Number.isFinite(idx) && dims[idx] != null) el.textContent = dims[idx] + '%';
  });
  try { syncDataStateBinds(s); } catch (_) {}
  const badge = panel.querySelector('#fortress-level-badge');
  if (badge) badge.textContent = tier;
}

window.__hengaiSupplierTableFilter = window.__hengaiSupplierTableFilter || 'all';

function setSupplierTableFilter(mode) {
  window.__hengaiSupplierTableFilter = mode || 'all';
  document.querySelectorAll('[data-sup-filter]').forEach(function (btn) {
    btn.classList.toggle('active', btn.getAttribute('data-sup-filter') === window.__hengaiSupplierTableFilter);
  });
  try { renderHengaiSupplierTable(window.AppState); } catch (_) {}
}
window.setSupplierTableFilter = setSupplierTableFilter;

function exportPremiumPartnersCsv(state) {
  const s = state || window.AppState;
  const nodes = resolveSupplierList(s).filter(function (n) {
    const collab = computeSupplierCollaborationScore(n);
    const premium = n.isPremiumPartner === true || n.is_premium_partner === true || collab >= 80;
    const st = String((n && (n.status || n.supplierStatus)) || '').toLowerCase();
    return premium && (st === 'submitted' || st === 'confirmed');
  });
  if (!nodes.length) {
    if (typeof window.showToast === 'function') window.showToast('暂无优质碳伙伴可导出', 'gold');
    return;
  }
  const rows = [['企业名称', '碳强度 tCO2e/t', '置信度', '协作分', 'CL-IVC哈希', '填报时间']];
  nodes.forEach(function (n) {
    const ci = n.tco2eReported != null ? n.tco2eReported : n.tco2e_reported;
    rows.push([
      n.supplierName || n.supplier_name || '',
      ci != null ? String(ci) : '',
      supplierConfidenceLabel(n),
      String(computeSupplierCollaborationScore(n)),
      n.clIvcHash || n.cl_ivc_hash || '',
      n.submittedAt || n.submitted_at || '',
    ]);
  });
  const csv = rows.map(function (r) {
    return r.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(',');
  }).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'HengAI-优质碳伙伴-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  if (typeof window.showToast === 'function') window.showToast('✓ 已导出 ' + nodes.length + ' 家优质碳伙伴', 'gold');
}
window.exportPremiumPartnersCsv = exportPremiumPartnersCsv;

async function fetchSupplierConclusion(nodeId) {
  const id = nodeId || (window.__hengaiLastCertPayload && window.__hengaiLastCertPayload.node && window.__hengaiLastCertPayload.node.id);
  if (!id) throw new Error('缺少供应商节点 ID');
  const base = (window.API_BASE || location.origin || '').replace(/\/+$/, '');
  let token = null;
  try { token = localStorage.getItem('hengai_token') || localStorage.getItem('authToken'); } catch (_) {}
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(base + '/api/v1/hub/supplier-conclusion/' + encodeURIComponent(id), { headers });
  const data = await res.json().catch(function () { return null; });
  if (!res.ok) throw new Error((data && (data.detail || data.message)) || ('HTTP ' + res.status));
  return data;
}
window.fetchSupplierConclusion = fetchSupplierConclusion;

async function verifySupplierConclusionFromCert() {
  const p = window.__hengaiLastCertPayload || {};
  const nodeId = p.node && (p.node.id || p.node.supplierNodeId);
  if (!nodeId) {
    if (typeof window.showToast === 'function') window.showToast('无法核验：缺少节点 ID', 'error');
    return;
  }
  try {
    const data = await fetchSupplierConclusion(nodeId);
    const msg = '只读结论 API ✓ · ' + (data.supplierName || '') + ' · ' + (data.carbonIntensity != null ? data.carbonIntensity + ' tCO₂e/t' : '—');
    if (typeof window.showToast === 'function') window.showToast(msg, 'gold');
  } catch (e) {
    if (typeof window.showToast === 'function') window.showToast('核验失败：' + (e && e.message ? e.message : e), 'error');
  }
}
window.verifySupplierConclusionFromCert = verifySupplierConclusionFromCert;

function renderFortressPanel(state) {
  updateFortressRadar(state);
}

/** 电网碳因子（与 cbam-calc-core / 企业档案表单一致） */
const ENTERPRISE_GRID_FACTORS = {
  east: 0.581, north: 0.728, south: 0.391,
  northeast: 0.658, northwest: 0.493, central: 0.527,
};

/**
 * 企业档案 → CBAM 粗算（档案保存后无正式测算时，用出口量/用电量推导敞口与 ROI）
 * 正式 CBAM 测算（非 estimated）优先，不覆盖。
 */
function estimateCbamFromCompany(company, state) {
  const co = company || {};
  const exportTons = Number(co.annualExportTons != null ? co.annualExportTons : co.exportTons);
  const powerKwh = Number(co.annualPowerKwh != null ? co.annualPowerKwh : co.annual_power_kwh);
  if ((!Number.isFinite(exportTons) || exportTons <= 0) && (!Number.isFinite(powerKwh) || powerKwh <= 0)) {
    return null;
  }

  const s = state || window.AppState || {};
  const macro = s.macro || {};
  const price = Number(macro.cbam_current_price) || 75.36;
  const fx = Number(macro.eur_cny_rate || macro.eurCnyRate) || 7.85;
  const gridKey = String(co.powerGrid || co.power_grid || 'east').toLowerCase();
  const gridFactor = ENTERPRISE_GRID_FACTORS[gridKey] || 0.581;
  const penalty = 1.35;

  const vol = exportTons > 0 ? exportTons : Math.max(100, Math.round(powerKwh / 2800));
  const elec = powerKwh > 0 ? powerKwh : vol * 2800;
  const s1 = 0;
  const s2 = Math.max(0, (elec * gridFactor) / 1000);
  const matFactor = 0.508;
  const matVol = vol * 0.85;
  const s3 = matVol * matFactor;
  const totalEmit = s1 + s2 + s3;
  const ci = vol > 0 ? totalEmit / vol : 0;
  const baseTax = ci * vol * price;
  const totalTax = baseTax * penalty;

  if (!Number.isFinite(totalTax) || totalTax <= 0) return null;

  return {
    vol,
    price,
    fx,
    penalty,
    mode: 'manual',
    s1,
    s2,
    s3,
    totalEmit,
    ci,
    baseTax,
    totalTax,
    totalTaxCNY: totalTax * fx,
    coverage: 0.12,
    supDone: 0,
    supTotal: 8,
    mainProductLabel: co.mainProduct || co.main_product || '主营产品',
    estimatedFromEnterprise: true,
  };
}

/** 将企业档案字段同步进 metrics / cbam（供全站 dyn-rep-* 与 iframe 管道使用） */
function patchEnterpriseMetricsFromProfile(state, opts) {
  const s = state || window.AppState || {};
  const co = s.company || {};
  const crExisting = s.cbam && s.cbam.calcResult;
  const hasOfficialCalc =
    crExisting &&
    crExisting.totalTax > 0 &&
    !crExisting.estimatedFromEnterprise &&
    !opts?.forceEstimate;

  if (hasOfficialCalc) return null;

  const est = estimateCbamFromCompany(co, s);
  if (!est) return null;

  const investCny = 58000;
  const netSaveCny = Math.round(est.totalTax * est.fx) - investCny;
  const roiMult = investCny > 0 && netSaveCny > 0 ? netSaveCny / investCny : 0;

  return {
    cbam: Object.assign({}, s.cbam || {}, { calcResult: est, step: 4 }),
    metrics: Object.assign({}, s.metrics || {}, {
      riskExposureEur: Math.round(est.totalTax),
      cbamTaxEstimate: Math.round(est.totalTax),
      carbonIntensity: parseFloat(est.ci.toFixed(4)),
      tCO2eTotal: Math.round(est.totalEmit),
      scope1: est.s1,
      scope2: est.s2,
      scope3: est.s3,
      roiMultiple: roiMult > 0 ? roiMult : null,
      taxSavingsWan: netSaveCny > 0 ? netSaveCny / 10000 : null,
    }),
    company: Object.assign({}, co, {
      cbamRiskRaw: Math.round(est.totalTax),
      roiRatio: roiMult > 0 ? '1 : ' + roiMult.toFixed(1) : '—',
      netSavings: netSaveCny > 0 ? '¥' + Math.round(netSaveCny).toLocaleString('zh-CN') : '—',
      stageLabel: co.stageLabel || co.stage_label || (co.name ? '数字孪生体建立中' : '待激活'),
    }),
    impact: Object.assign({}, s.impact || {}, {
      riskExposureEur: Math.round(est.totalTax),
      tCO2eTotal: Math.round(est.totalEmit),
      carbonIntensity: parseFloat(est.ci.toFixed(4)),
    }),
  };
}

/** 规范化 CBAM calcResult（API / 缓存字段名不一致时补齐 totalTax、fx 等） */
function normalizeCalcResult(cr, state) {
  if (!cr || typeof cr !== 'object') return null;
  const s = state || window.AppState || {};
  const m = s.metrics || {};
  const macro = s.macro || {};
  const r = Object.assign({}, cr);
  const fx = Number(r.fx != null ? r.fx : r.FX != null ? r.FX : macro.eur_cny_rate || macro.eurCnyRate) || 7.85;
  r.fx = fx;

  let totalTax = Number(r.totalTax != null ? r.totalTax : r.total_tax != null ? r.total_tax : r.cbamTax);
  if (!Number.isFinite(totalTax) || totalTax <= 0) {
    const risk = Number(m.riskExposureEur != null ? m.riskExposureEur : m.cbamTaxEstimate);
    if (Number.isFinite(risk) && risk > 0) totalTax = risk;
    else totalTax = 0;
  }
  r.totalTax = totalTax;

  if (r.totalTaxCNY == null && totalTax > 0) {
    r.totalTaxCNY = Math.round(totalTax * fx);
  }
  if (r.vol == null && r.exportVolume != null) r.vol = Number(r.exportVolume);
  if (r.supTotal == null && r.supplierCount != null) r.supTotal = Number(r.supplierCount);
  if (r.supDone == null && r.supplierSubmitted != null) r.supDone = Number(r.supplierSubmitted);
  if (r.penalty == null || !Number.isFinite(Number(r.penalty))) r.penalty = 1.35;
  return r;
}

/** 碳税敞口 / ROI / 净节税 —— 全站唯一推导内核（CBAM 测算结果 → 各页 dyn-rep-* / 决策层呈送包） */
function computeRepFinancials(state) {
  const s = state || window.AppState || {};
  const m = s.metrics || {};
  const cr = (s.cbam && s.cbam.calcResult) || null;
  const co = s.company || {};
  const macro = s.macro || {};
  const fx = Number(macro.eur_cny_rate || macro.eurCnyRate) || 7.85;
  const investCny = 58000;

  let riskNum = Number(m.riskExposureEur != null ? m.riskExposureEur : m.cbamTaxEstimate);
  if (!Number.isFinite(riskNum) || riskNum <= 0) {
    if (cr && cr.totalTax != null) riskNum = Number(cr.totalTax);
    else if (co.cbamRiskRaw != null) riskNum = Number(co.cbamRiskRaw);
    else if (s.impact && s.impact.riskExposureEur != null) riskNum = Number(s.impact.riskExposureEur);
  }
  if (!Number.isFinite(riskNum) || riskNum < 0) riskNum = 0;

  let roiMult = Number(m.roiMultiple);
  const netSaveCny = riskNum > 0 ? Math.round(riskNum * fx) - investCny : 0;
  if (!Number.isFinite(roiMult) || roiMult <= 0) {
    roiMult = investCny > 0 && netSaveCny > 0 ? netSaveCny / investCny : 0;
  }

  let roiDisplay = String(co.roiRatio || co.roi_ratio || '').trim();
  if (!roiDisplay || roiDisplay === '—' || roiDisplay === '待测算') {
    roiDisplay = roiMult > 0 ? '1 : ' + roiMult.toFixed(1) : '待测算';
  }

  let netSavingsDisplay = String(co.netSavings || co.net_savings || '').trim();
  if (!netSavingsDisplay || netSavingsDisplay === '—' || netSavingsDisplay === '待测算') {
    netSavingsDisplay = netSaveCny > 0
      ? '¥' + Math.round(netSaveCny).toLocaleString('zh-CN')
      : '待测算';
  }

  const riskDisplay = riskNum > 0 ? F.eur(riskNum) : '待测算';
  let riskCompact = '待测算';
  if (riskNum >= 1000) riskCompact = '€ ' + Math.round(riskNum / 1000) + 'k';
  else if (riskNum > 0) riskCompact = '€ ' + Math.round(riskNum).toLocaleString('en-US');

  const penalty = cr && cr.penalty != null ? Number(cr.penalty) : 1.35;
  const penaltyLabel = 'Lv.2 惩罚 ×' + (Number.isFinite(penalty) ? penalty.toFixed(2) : '1.35');

  const riskEurStrip = riskNum >= 1e6
    ? '€' + (riskNum / 1e6).toFixed(2) + 'M'
    : (riskNum > 0 ? '€' + Math.round(riskNum).toLocaleString('en-US') : '待测算');
  const investDisplay = '¥' + Math.round(investCny / 1000) + 'k';
  const roiStripDisplay = roiMult > 0 ? 'ROI 1:' + roiMult.toFixed(1) : '待测算';

  return {
    riskNum,
    riskDisplay,
    riskCompact,
    riskEurStrip,
    roiDisplay,
    roiStripDisplay,
    netSavingsDisplay,
    investDisplay,
    roiMultiple: roiMult,
    netSaveCny,
    investCny,
    penaltyLabel,
  };
}

function applyRepFinancialsToDom(state) {
  const f = computeRepFinancials(state);
  document.querySelectorAll('.dyn-rep-tax').forEach((el) => {
    el.innerHTML = f.riskNum > 0 ? F.moneyExposureHtml(f.riskNum) : '待测算';
  });
  document.querySelectorAll('.dyn-rep-roi').forEach((el) => { el.textContent = f.roiDisplay; });
  document.querySelectorAll('.dyn-rep-save').forEach((el) => { el.textContent = f.netSavingsDisplay; });
  document.querySelectorAll('.dyn-decision-tax-k').forEach((el) => { el.textContent = f.riskCompact; });

  const setId = (id, val) => {
    const el = document.getElementById(id);
    if (!el || val == null) return;
    el.textContent = String(val);
  };

  /* 决策层呈送包 */
  setId('dec-tax-exposure', f.riskCompact);
  setId('dec-tax-penalty', f.riskDisplay);
  setId('dec-roi-ratio', f.roiDisplay);
  setId('dec-net-savings', f.netSavingsDisplay);

  /* 全域诊断报告 · 指标卡 */
  const repTaxStr = f.riskNum > 0
    ? (f.riskNum >= 1e6 ? 'EUR ' + (f.riskNum / 1e6).toFixed(2) + 'M' : 'EUR ' + Math.round(f.riskNum).toLocaleString())
    : '待测算';
  setId('rep-tax-exposure', repTaxStr);
  setId('rep-roi-ratio', f.roiMultiple > 0 ? '1 : ' + f.roiMultiple.toFixed(1) : '待测算');
  setId('rep-net-save', f.netSaveCny > 0 ? '¥' + Math.round(f.netSaveCny).toLocaleString('zh-CN') : '待测算');

  /* 全域总览 · 三步对冲 ROI（page-overview 内嵌 CBAM 结果区） */
  setId('cs-risk', f.riskEurStrip);
  setId('cs-invest', f.investDisplay);
  setId('cs-roi', f.roiStripDisplay);
  setId('hub-p2-roi-return', f.roiStripDisplay);

  /* 全域诊断报告 · 三步对冲 ROI 条（page-report） */
  setId('roi-risk', f.riskEurStrip);
  setId('H-rep-invest-lbl', f.investDisplay);
  setId('roi-result', f.roiStripDisplay);

  /* Phase2 总览卡片 */
  const hubP2Roi = document.getElementById('hub-p2-roi-k');
  if (hubP2Roi) {
    const span = hubP2Roi.querySelector('.dyn-rep-tax');
    if (span) span.textContent = f.riskCompact;
    else hubP2Roi.textContent = f.riskCompact;
  }
  setId('total-risk-val', f.riskDisplay);
  setId('r-total', f.riskDisplay);

  const titleR = document.getElementById('H-rep-roi-title-ratio');
  if (titleR) titleR.textContent = f.roiMultiple > 0 ? f.roiMultiple.toFixed(1) : '—';
  const hubOvRatio = document.getElementById('hub-overview-roi-ratio');
  if (hubOvRatio) hubOvRatio.textContent = f.roiMultiple > 0 ? '1:' + f.roiMultiple.toFixed(1) : '待测算';

  const penEl = document.getElementById('dec-penalty-label');
  if (penEl) penEl.textContent = f.penaltyLabel;

  applyEnterpriseFinancialsToDom(state, f);
  try { refreshSupplyChainUi(state); } catch (_) {}
  try { refreshDecisionAskCopy(state, f); } catch (_) {}
  return f;
}

/** 决策呈送包 · 请示文案 / 重点标签（用户未手改 cf-ask 时自动灌入财务数字） */
function refreshDecisionAskCopy(state, finPrecomputed) {
  const ask = document.getElementById('cf-ask');
  if (!ask) return;
  const f = finPrecomputed || computeRepFinancials(state);
  const riskLabel = f.riskCompact !== '待测算' ? f.riskCompact : f.riskDisplay;
  const tpl = '申请批准启动 Co2Lion 企业合规基础设施升级，年度预算 ¥58,000，预期消除 '
    + riskLabel + ' 碳税风险敞口。';
  if (ask.dataset.userEdited !== '1') ask.value = tpl;
  const prev = document.getElementById('prev-ask');
  if (prev && ask.dataset.userEdited !== '1') prev.textContent = ask.value;
  document.querySelectorAll('.rs-focus').forEach((el) => {
    el.textContent = f.riskNum > 0
      ? ('重点：' + f.riskCompact + ' 税务风险')
      : '重点：待测算 税务风险';
  });
}
window.refreshDecisionAskCopy = refreshDecisionAskCopy;

/** 企业档案 powerGrid → CBAM 电网下拉因子 */
const HENGAI_POWER_GRID_FACTORS = {
  east: 0.581,
  north: 0.728,
  south: 0.391,
  northeast: 0.658,
  northwest: 0.493,
  central: 0.527,
};

/** 企业档案主营产品 / 行业代码 → CBAM f-product 选项值 */
function mapMainProductToCbamSelect(mainProduct, industryCode) {
  const raw = String(mainProduct || '').trim().toLowerCase();
  const ind = String(industryCode || '').trim().toLowerCase();
  const known = [
    'automotive', 'machinery', 'electronics', 'steel', 'aluminum', 'aluminium',
    'cement', 'fertilizer', 'electricity', 'hydrogen', 'petro', 'paper', 'aviation',
    'ceramic', 'port', 'idc',
  ];
  if (known.indexOf(ind) >= 0) return ind === 'aluminium' ? 'aluminum' : ind;
  if (!raw) return null;
  if (raw.includes('汽车') || raw.includes('汽配') || raw === 'automotive') return 'automotive';
  if (raw.includes('机械') || raw === 'machinery') return 'machinery';
  if (raw.includes('电子') || raw === 'electronics') return 'electronics';
  if (raw.includes('铝') || raw === 'aluminum' || raw === 'aluminium') return 'aluminum';
  if (raw.includes('钢') || raw === 'steel') return 'steel';
  if (raw.includes('水泥') || raw === 'cement') return 'cement';
  if (raw.includes('化肥') || raw === 'fertilizer') return 'fertilizer';
  if (raw.includes('电') || raw === 'electricity') return 'electricity';
  if (raw.includes('氢') || raw === 'hydrogen') return 'hydrogen';
  return null;
}

function setCbamSelectByFactor(doc, selectId, factor) {
  const sel = doc.getElementById(selectId);
  const f = Number(factor);
  if (!sel || !Number.isFinite(f)) return;
  let best = null;
  let bestDiff = Infinity;
  for (let i = 0; i < sel.options.length; i++) {
    const v = parseFloat(sel.options[i].value);
    if (!Number.isFinite(v)) continue;
    const d = Math.abs(v - f);
    if (d < bestDiff) {
      bestDiff = d;
      best = sel.options[i].value;
    }
  }
  if (best != null) sel.value = best;
}

/**
 * 用企业数字档案 / AppState.company 预填 CBAM 测算表单（与登录企业名解耦，以档案为准）
 * @param {object} state
 * @param {Document} [targetDoc]
 */
function hydrateCbamFormFromCompany(state, targetDoc) {
  const doc = targetDoc || (typeof document !== 'undefined' ? document : null);
  if (!doc || !doc.getElementById('f-company')) return false;

  const s = state || window.AppState || {};
  const co = s.company || {};
  const cb = s.cbam || {};
  const me = s.metrics || {};
  const macro = s.macro || (typeof getMacroOracle === 'function' ? getMacroOracle() : {});

  const setVal = (id, val) => {
    if (val == null || val === '') return;
    const el = doc.getElementById(id);
    if (!el) return;
    el.value = String(val);
  };

  if (co.name) setVal('f-company', co.name);

  const vol = co.annualExportTons != null ? co.annualExportTons
    : co.annual_export_tons != null ? co.annual_export_tons
      : co.exportTons != null ? co.exportTons
        : co.export_tons != null ? co.export_tons
          : cb.exportVolume != null ? cb.exportVolume
            : (cb.calcResult && cb.calcResult.vol != null ? cb.calcResult.vol : null);
  if (vol != null && Number(vol) > 0) setVal('f-volume', vol);

  const prodKey = mapMainProductToCbamSelect(
    co.mainProduct || co.main_product,
    co.industryCode || co.industry_code
  );
  const selProd = doc.getElementById('f-product');
  const draftProd = cb.draft && (cb.draft.productCode || cb.draft.product);
  if (draftProd && selProd) {
    const hasDraft = Array.from(selProd.options).some((o) => o.value === draftProd);
    if (hasDraft) setVal('f-product', draftProd);
  } else if (selProd && !selProd.value && prodKey) {
    setVal('f-product', prodKey);
    const rough = window.HengAICbamRough;
    if (rough && typeof rough.rebuildMaterialOptionsForProduct === 'function') {
      try { rough.rebuildMaterialOptionsForProduct(); } catch (_) {}
    }
  }

  const gridKey = co.powerGrid || co.power_grid;
  const gridFactor = gridKey && HENGAI_POWER_GRID_FACTORS[gridKey]
    ? HENGAI_POWER_GRID_FACTORS[gridKey]
    : null;
  if (gridFactor != null) setCbamSelectByFactor(doc, 'f-grid', gridFactor);

  const kwh = co.annualPowerKwh != null ? co.annualPowerKwh : co.annual_power_kwh;
  if (kwh != null && Number(kwh) > 0) setVal('f-elec', kwh);

  if (me.supplierCount != null) setVal('f-sup-total', me.supplierCount);
  if (me.supplierSubmitted != null) setVal('f-sup-done', me.supplierSubmitted);

  if (macro.cbam_current_price != null) setVal('f-price', macro.cbam_current_price);
  if (macro.eur_cny_rate != null) setVal('f-fx', macro.eur_cny_rate);

  const cr = cb.calcResult;
  if (cr && typeof cr === 'object') {
    if (cr.vol != null && Number(cr.vol) > 0) setVal('f-volume', cr.vol);
    if (cr.price != null) setVal('f-price', cr.price);
    if (cr.fx != null) setVal('f-fx', cr.fx);
    if (cr.elec != null) setVal('f-elec', cr.elec);
    if (cr.gec != null) setVal('f-gec', cr.gec);
    if (cr.supTotal != null) setVal('f-sup-total', cr.supTotal);
    if (cr.supDone != null) setVal('f-sup-done', cr.supDone);
  }

  const roughApi = window.HengAICbamRough;
  if (roughApi && typeof roughApi.updateEnergyHelper === 'function') {
    try { roughApi.updateEnergyHelper(); } catch (_) {}
  }
  if (roughApi && typeof roughApi.previewSensitivity === 'function') {
    try { roughApi.previewSensitivity(); } catch (_) {}
  } else if (typeof window.previewSensitivity === 'function') {
    try { window.previewSensitivity(); } catch (_) {}
  }
  return true;
}
window.hydrateCbamFormFromCompany = hydrateCbamFormFromCompany;
window.mapMainProductToCbamSelect = mapMainProductToCbamSelect;

/** 企业档案 · 欧元预测展示（支持百万级敞口） */
function formatEurForecast(eur) {
  const n = Number(eur);
  if (!Number.isFinite(n) || n <= 0) return '待测算';
  if (n >= 1e6) return '€' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1000) return '€' + Math.round(n / 1000) + 'k';
  return '€' + Math.round(n).toLocaleString('en-US');
}
window.formatEurForecast = formatEurForecast;

/**
 * 企业数字档案页 · 碳税敞口 / 三年预测 / ROI
 * @param {object} state
 * @param {object} [finPrecomputed]
 * @param {Document} [targetDoc] — 必须传 iframe 的 document；默认当前 window.document
 */
function applyEnterpriseFinancialsToDom(state, finPrecomputed, targetDoc) {
  const doc = targetDoc || (typeof document !== 'undefined' ? document : null);
  if (!doc) return null;

  const hasEntDom = doc.getElementById('ent-cbam-risk')
    || doc.getElementById('ent-forecast-2026-val')
    || doc.querySelector('.dyn-ent-cbam-risk');
  if (!hasEntDom) {
    return null;
  }

  const f = finPrecomputed || computeRepFinancials(state);
  const setId = (id, val) => {
    const el = doc.getElementById(id);
    if (!el || val == null) return;
    el.textContent = String(val);
  };

  const riskHero = f.riskEurStrip !== '待测算'
    ? f.riskEurStrip
    : (f.riskCompact !== '待测算' ? f.riskCompact : f.riskDisplay);

  setId('ent-cbam-risk', riskHero);
  setId('ent-forecast-roi-pill', f.roiStripDisplay !== '待测算' ? f.roiStripDisplay : 'ROI 待测算');
  setId('ent-forecast-2026-val', riskHero);
  setId('ent-forecast-2026-sub', f.penaltyLabel ? '碳税敞口 · ' + f.penaltyLabel.replace('惩罚 ', '') : '碳税敞口 · Lv.2');

  const s = state || window.AppState || {};
  const cr = normalizeCalcResult(s.cbam && s.cbam.calcResult, s);
  let y27 = null;
  let y28 = null;
  if (cr && cr.totalTax > 0) {
    const pen = Number(cr.penalty) || 1.35;
    const vol = Number(cr.vol) || 0;
    const ci = Number(cr.ci) || 0;
    if (vol > 0 && ci > 0) {
      const tax27 = ci * vol * pen * 80;
      const tax28 = ci * vol * pen * 95;
      y27 = tax27 * 0.68;
      y28 = tax28 * 0.22;
    }
  }
  if ((y27 == null || y28 == null) && f.riskNum > 0) {
    y27 = f.riskNum * 0.68;
    y28 = f.riskNum * 0.22;
  }
  setId('ent-forecast-2027-val', formatEurForecast(y27));
  setId('ent-forecast-2028-val', formatEurForecast(y28));

  doc.querySelectorAll('.ent-dyn-rep-tax, .dyn-ent-cbam-risk').forEach((el) => {
    el.innerHTML = f.riskNum > 0 ? F.moneyExposureHtml(f.riskNum) : '待测算';
  });
  doc.querySelectorAll('.ent-dyn-rep-roi').forEach((el) => { el.textContent = f.roiDisplay; });
  const co = (state && state.company) || (window.AppState && window.AppState.company) || {};
  const stageLbl = resolveCompanyStageLabel(co, (state && state.metrics) || {}, state && state.cbam);
  doc.querySelectorAll('.dyn-ent-stage-label').forEach((el) => { el.textContent = stageLbl; });
  return f;
}

/** 管道 / 子页统一：注册时间与会员档位（消除各模块各写一套） */
function formatHubUserIdentity(u) {
  const user = u || {};
  const tierCode = normalizeTierCode(user.tier_code || user.tier);
  const regRaw = user.regDate || user.reg_date || user.createdAt || user.created_at;
  let regDate = null;
  let regLabel = '—';
  if (regRaw) {
    try {
      const d = new Date(regRaw);
      if (!Number.isNaN(d.getTime())) {
        regDate = d.toISOString().slice(0, 10);
        regLabel = '注册于 ' + regDate;
      }
    } catch (_) {}
  }
  const tierLabel = F.tier(tierCode);
  return { tierCode, tierLabel, regDate, regLabel };
}
window.formatHubUserIdentity = formatHubUserIdentity;

/** 企业档案阶段标签（CBAM 落库 / is_complete 后禁止再显示「待测算」） */
function resolveCompanyStageLabel(company, metrics, cbam) {
  const co = company || {};
  const m = metrics || {};
  const existing = String(co.stageLabel || co.stage_label || '').trim();
  if (existing && existing !== '待激活' && existing !== 'sandbox' && existing !== 'incomplete') {
    return existing;
  }
  const risk = Number(
    m.riskExposureEur != null ? m.riskExposureEur
      : m.cbamTaxEstimate != null ? m.cbamTaxEstimate
        : co.cbamRiskRaw != null ? co.cbamRiskRaw
          : co.riskExposureEur != null ? co.riskExposureEur : 0
  );
  const hasCalc = !!(cbam && cbam.calcResult) || co.isComplete === true || co.is_complete === true;
  if (hasCalc || (Number.isFinite(risk) && risk > 0)) return 'CBAM 已测算';
  const stage = String(co.stage || '').toLowerCase();
  if (stage === 'certified') return '企业官方金库';
  if (stage === 'sandbox') return co.isComplete || co.is_complete ? '沙盒 · 已建档' : '沙盒运行中';
  if (co.name) return '数字孪生体建立中';
  return '待激活';
}
window.resolveCompanyStageLabel = resolveCompanyStageLabel;

/** 将 iframe 管道 payload 还原为 computeRepFinancials 可用的 state 切片 */
function stateFromHubPipeline(p, rootState) {
  const pld = p || {};
  const root = rootState || window.AppState || {};
  const cbamSlice = pld.cbam && typeof pld.cbam === 'object'
    ? Object.assign({}, root.cbam || {}, pld.cbam)
    : (root.cbam || {});
  return {
    user: Object.assign({}, root.user || {}, pld.user || {}),
    company: Object.assign({}, root.company || {}, pld.company || {}),
    metrics: Object.assign({}, root.metrics || {}, pld.metrics || {}),
    impact: Object.assign({}, root.impact || {}, pld.impact || {}),
    cbam: cbamSlice,
    recentReports: pld.recentReports || root.recentReports || [],
    macro: root.macro || {},
    wallet: Object.assign({}, root.wallet || {}, pld.wallet || {}),
  };
}

/**
 * 全站 iframe 管道统一载荷（含 metrics.riskExposureEur / roiMultiple / company.roiRatio）
 * opts.supplierNodes / opts.reports 可覆盖列表类字段
 */
function buildHubPipelinePayload(state, opts) {
  const s = state || window.AppState || {};
  opts = opts || {};
  const u = s.user || {};
  const co = s.company || {};
  const m = s.metrics || {};
  const impact = s.impact || {};
  const fin = computeRepFinancials(s);

  const riskNum = fin.riskNum > 0
    ? fin.riskNum
    : Number(m.riskExposureEur != null ? m.riskExposureEur : impact.riskExposureEur) || 0;
  const tcoNum = Number(m.tCO2eTotal != null ? m.tCO2eTotal : impact.tCO2eTotal) || 0;

  let scopePct = Number(co.scope3Rate);
  if (!Number.isFinite(scopePct) || scopePct <= 0) {
    const covRaw = m.supplyChainCoverage != null ? m.supplyChainCoverage : m.scope3Coverage;
    if (covRaw != null && covRaw !== '') {
      const cx = Number(covRaw);
      if (Number.isFinite(cx)) scopePct = cx <= 1 && cx >= 0 ? cx * 100 : cx;
    }
  }
  if (!Number.isFinite(scopePct)) scopePct = 0;

  const suppliers = opts.supplierNodes || s.supplierNodes || s.suppliers || [];
  const reports = opts.recentReports || s.recentReports || [];
  let subN = Number(m.supplierSubmitted != null ? m.supplierSubmitted : m.supplierSubmittedCount);
  let totN = Number(m.supplierCount);
  let pendN = Number(m.supplierPendingCount);
  if (!Number.isFinite(subN) || subN < 0) {
    subN = 0;
    suppliers.forEach((sp) => {
      const st = String((sp && (sp.status || sp.supplierStatus)) || '').toLowerCase();
      if (st === 'submitted' || st === 'confirmed') subN += 1;
    });
  }
  if (!Number.isFinite(totN) || totN <= 0) totN = suppliers.length;
  if (!Number.isFinite(pendN) || pendN < 0) {
    pendN = Math.max(0, totN - subN);
    suppliers.forEach((sp) => {
      const st = String((sp && (sp.status || sp.supplierStatus)) || '').toLowerCase();
      if (st === 'invited' || st === 'pending') pendN += 1;
    });
    if (totN > 0 && pendN === 0) pendN = Math.max(0, totN - subN);
  }

  const riskFull = riskNum > 0 ? F.eur(riskNum) : '待测算';
  let riskCompact = '待测算';
  if (riskNum >= 1000) riskCompact = '€' + Math.round(riskNum / 1000) + 'k';
  else if (riskNum > 0) riskCompact = '€ ' + Math.round(riskNum).toLocaleString('en-US');

  const level = u.currentLevel || u.current_level || 'Level 1';
  const walletAddress = (s.wallet && s.wallet.address) || '#WL-TEMP';
  const ident = formatHubUserIdentity(u);

  return {
    _ownerUserId: u.id || u.userId || currentAuthUserId() || null,
    _authEpoch: _authSwitchEpoch,
    user: {
      id: u.id || u.userId || currentAuthUserId() || null,
      name: u.name || '',
      email: u.email || '',
      gmBalance: Number(u.gmBalance || 0),
      currentLevel: level,
      tier_code: ident.tierCode,
      tier: ident.tierLabel,
      tierLabel: ident.tierLabel,
      regDate: ident.regDate,
      regLabel: ident.regLabel,
      tCO2e_total: tcoNum,
    },
    company: Object.assign({}, co, {
      name: co.name || '未绑定企业',
      type: co.type || co.company_type || '',
      industryCode: co.industryCode || co.industry_code || '',
      industry_code: co.industry_code || co.industryCode || '',
      industry: co.industry || co.industryLabel || co.industry_label || '',
      industryLabel: co.industryLabel || co.industry_label || '',
      cbamRisk: riskNum > 0 ? riskFull : (co.cbamRisk || '待测算'),
      cbamRiskRaw: riskNum > 0 ? riskNum : (co.cbamRiskRaw != null ? co.cbamRiskRaw : null),
      scope3Rate: scopePct,
      roiRatio: fin.roiDisplay,
      netSavings: fin.netSavingsDisplay,
      isComplete: co.isComplete === true || co.is_complete === true || riskNum > 0 || !!(s.cbam && s.cbam.calcResult),
      stageLabel: resolveCompanyStageLabel(co, m, s.cbam),
    }),
    cbam: s.cbam && s.cbam.calcResult ? { calcResult: s.cbam.calcResult } : undefined,
    impact: {
      tCO2eTotal: tcoNum,
      riskExposureEur: riskNum,
      scope3Coverage: scopePct > 0 ? scopePct / 100 : 0,
    },
    metrics: Object.assign({}, m, {
      gm: Number(u.gmBalance || 0),
      co2: tcoNum,
      calcCount: reports.length,
      supplierCount: totN,
      supplierSubmitted: subN,
      supplierSubmittedCount: subN,
      supplierPendingCount: pendN,
      scope3Rate: scopePct,
      supplyChainCoverage: totN > 0 ? subN / totN : (m.supplyChainCoverage != null ? m.supplyChainCoverage : 0),
      generationalNodesCount: Number(m.generationalNodesCount != null ? m.generationalNodesCount : m.generational_nodes_count) || subN,
      riskExposureEur: riskNum,
      globalRank: m.globalRank != null ? m.globalRank : m.global_rank,
      roiMultiple: fin.roiMultiple > 0 ? fin.roiMultiple : null,
      scope1: m.scope1,
      scope2: m.scope2,
      scope3: m.scope3,
      carbonIntensity: m.carbonIntensity,
      resonanceCount: m.resonanceCount != null ? m.resonanceCount : m.resonance_count,
      totalTaxPenalty: m.totalTaxPenalty != null ? m.totalTaxPenalty : m.total_tax_penalty,
      crusadeCount: m.crusadeCount != null ? m.crusadeCount : m.crusade_count,
    }),
    wallet: { address: walletAddress },
    fortress: s.fortress && typeof s.fortress === 'object' ? s.fortress : undefined,
    meta: {
      calcCount: reports.length,
      supplierCount: totN,
    },
    supplierNodes: suppliers,
    recentReports: reports,
    gmLedger: s.gmLedger || [],
    milestones: typeof window.buildMilestonesFromState === 'function'
      ? window.buildMilestonesFromState(s)
      : (s.milestones || {}),
    badges: opts.badges || s.badges || [],
    activityTimeline: s.activityTimeline || [],
    compute: s.compute || {
      tokensLeft: u.tokensLeft != null ? u.tokensLeft : u.tokens_left,
      tokensUsed: u.tokensUsed != null ? u.tokensUsed : u.tokens_used,
      lastSyncAt: s.serverTime || null,
    },
    macro: s.macro || {},
    industryAudit: s.industryAudit || {},
    resonance: s.resonance || {},
    factorAuth: (function () {
      const fa = s.factorAuth;
      if (!fa || typeof fa !== 'object') return undefined;
      return {
        pledgeBy: fa.pledgeBy,
        pledgeTs: fa.pledgeTs,
        confirmedFactor: fa.confirmedFactor,
        confirmedIndustry: fa.confirmedIndustry,
        pooledByIndustry: fa.pooledByIndustry,
        poolCount: fa.poolCount,
        poolFactories: fa.poolFactories,
        poolDownstream: fa.poolDownstream,
        poolTaxSaved: fa.poolTaxSaved,
        waitingCount: fa.waitingCount,
        taxRiskEur: fa.taxRiskEur,
        demands: fa.demands,
        honors: fa.honors,
        gmPoolRewardClaimed: fa.gmPoolRewardClaimed,
        riskReportGeneratedAt: fa.riskReportGeneratedAt,
        gcaCertGenerated: fa.gcaCertGenerated,
        gcaCertId: fa.gcaCertId,
        pueValue: fa.pueValue,
        industryScopeFormal: fa.industryScopeFormal,
        consumptionLedger: fa.consumptionLedger,
        supplyChainBinding: fa.supplyChainBinding,
      };
    })(),
    flags: s.flags ? {
      currentPhase: s.flags.currentPhase,
      originAuditUnlocked: s.flags.originAuditUnlocked,
      hasOriginFactoryPerm: s.flags.hasOriginFactoryPerm,
    } : undefined,
  };
}

var _hubPipelineBroadcastTimer = null;
var _hubPipelineLastPayload = null;

/** 单 iframe 握手回传（禁止触发全员广播风暴） */
function replyHubPipelineToEmbed(targetWin, state, opts) {
  if (!targetWin || typeof targetWin.postMessage !== 'function') return null;
  const payload = buildHubPipelinePayload(state, opts);
  if (!hubOverviewUserMatchesCurrent(payload)) return null;
  _hubPipelineLastPayload = payload;
  try { window.__hubPipelineLastPayload = payload; } catch (_) {}
  try {
    targetWin.postMessage({ type: 'HENGAI_HUB_PIPELINE', payload }, '*');
  } catch (_) {}
  return payload;
}

/** 向全域中心 embed iframe 广播（防抖 · 同一 tick 只发一轮） */
function broadcastHubPipelineToEmbeds(state, opts) {
  const payload = buildHubPipelinePayload(state, opts);
  if (!hubOverviewUserMatchesCurrent(payload)) return null;
  _hubPipelineLastPayload = payload;
  try { window.__hubPipelineLastPayload = payload; } catch (_) {}
  if (typeof document === 'undefined') return payload;

  if (_hubPipelineBroadcastTimer) clearTimeout(_hubPipelineBroadcastTimer);
  _hubPipelineBroadcastTimer = setTimeout(function () {
    _hubPipelineBroadcastTimer = null;
    const msg = { type: 'HENGAI_HUB_PIPELINE', payload: _hubPipelineLastPayload || payload };
    var activePanel = document.querySelector('.page-panel.embed-panel.active');
    /* 总览/非 embed 页：不向隐藏 iframe 群发，避免 14×N postMessage 风暴 */
    if (!activePanel) return;
    var frames = activePanel.querySelectorAll('.embed-frame, #hub-main-frame');
    function postToFrame(frame, attempt) {
      try {
        if (!frame || !frame.contentWindow) return;
        var doc = frame.contentDocument;
        if (doc && doc.readyState && doc.readyState !== 'complete' && attempt < 8) {
          setTimeout(function () { postToFrame(frame, attempt + 1); }, 120);
          return;
        }
        frame.contentWindow.postMessage(msg, '*');
      } catch (_) {
        if (attempt < 6) setTimeout(function () { postToFrame(frame, attempt + 1); }, 150);
      }
    }
    frames.forEach(function (frame) {
      if (frame && !frame.dataset.hengaiPipelineBound) {
        frame.dataset.hengaiPipelineBound = '1';
        frame.addEventListener('load', function () {
          setTimeout(function () { postToFrame(frame, 0); }, 80);
        }, { once: true });
      }
      setTimeout(function () { postToFrame(frame, 0); }, 60);
    });
  }, 220);

  return payload;
}

/** 在当前 document 灌注财务数字（父页或已加载 AppState 的子页） */
function applyFinancialsInDocument(state) {
  const s = state || window.AppState;
  if (!s) return null;
  let fin = null;
  try { fin = applyRepFinancialsToDom(s); } catch (e) {
    console.warn('[AppState] applyRepFinancialsToDom', e);
  }
  if (typeof applyEnterpriseFinancialsToDom === 'function') {
    try { applyEnterpriseFinancialsToDom(s, fin); } catch (e) {
      console.warn('[AppState] applyEnterpriseFinancialsToDom', e);
    }
  }
  return fin;
}

/** 灌注 ROI + 若存在 CBAM 粗测结果则刷新图表区（财务数字以 applyRepFinancialsToDom 为准，避免被残缺 calcResult 覆盖） */
function refreshHubCbamUi(state) {
  const s = state || window.AppState;
  const cr = normalizeCalcResult(s && s.cbam && s.cbam.calcResult, s);
  if (cr && typeof window.renderCbamHubResults === 'function') {
    try { window.renderCbamHubResults(cr); } catch (e) {
      console.warn('[AppState] renderCbamHubResults', e);
    }
  }
  return applyRepFinancialsToDom(s);
}
window.normalizeCalcResult = normalizeCalcResult;
window.estimateCbamFromCompany = estimateCbamFromCompany;
window.patchEnterpriseMetricsFromProfile = patchEnterpriseMetricsFromProfile;
window.computeRepFinancials = computeRepFinancials;
window.applyRepFinancialsToDom = applyRepFinancialsToDom;
window.applyEnterpriseFinancialsToDom = applyEnterpriseFinancialsToDom;
window.refreshHubCbamUi = refreshHubCbamUi;
window.stateFromHubPipeline = stateFromHubPipeline;
window.buildHubPipelinePayload = buildHubPipelinePayload;
window.broadcastHubPipelineToEmbeds = broadcastHubPipelineToEmbeds;
window.replyHubPipelineToEmbed = replyHubPipelineToEmbed;
window.applyFinancialsInDocument = applyFinancialsInDocument;
window.hengaiApplyFinancials = applyFinancialsInDocument;

/** 由 CBAM / 供应链 / 档案指标推导五维合规诊断（API 未返回 dimensions 时使用） */
function buildDiagnosticDimensions(state) {
  const s = state || window.AppState || {};
  const m = s.metrics || {};
  const cr = (s.cbam && s.cbam.calcResult) || null;
  const co = s.company || {};
  const supTotal = Number(m.supplierCount != null ? m.supplierCount : (s.supplierNodes || []).length) || 0;
  const supDone = Number(m.supplierSubmittedCount != null ? m.supplierSubmittedCount : m.supplierSubmitted) || 0;
  const covPct = supTotal > 0 ? Math.round((supDone / supTotal) * 100) : 0;
  const s1 = cr && cr.s1 != null ? Number(cr.s1) : Number(m.scope1) || 0;
  const s2 = cr && cr.s2 != null ? Number(cr.s2) : Number(m.scope2) || 0;
  const s3 = cr && cr.s3 != null ? Number(cr.s3) : Number(m.scope3) || 0;
  const totalEm = s1 + s2 + s3;
  const scope3Share = totalEm > 0 ? Math.round((s3 / totalEm) * 100) : (Number(co.scope3Rate) || Number(m.scope3Rate) || 0);
  const penalty = cr && cr.penalty != null ? Number(cr.penalty) : NaN;
  const mode = String((s.cbam && s.cbam.dataMode) || (cr && cr.mode) || 'manual').toLowerCase();
  const confLv = mode === 'mat' || mode === 'third' ? 'Lv.4' : (Number.isFinite(penalty) && penalty > 1.2 ? 'Lv.2' : 'Lv.2');
  const hasCalc = !!(cr && (cr.emissions != null || cr.total != null || totalEm > 0));
  const carbonStatus = totalEm > 0
    ? `Scope3 黑盒占比约 ${scope3Share}%`
    : (scope3Share > 0 ? `Scope3 估算占比 ${scope3Share}%` : '尚未完成碳排放粗测');
  const carbonRisk = scope3Share >= 60 || covPct < 40 ? 'high' : scope3Share >= 45 ? 'mid' : 'low';
  const cbamStatus = !hasCalc
    ? '尚未完成 CBAM 粗测'
    : (confLv === 'Lv.4' ? 'MAT / 第三方证据链就绪' : '缺少书面证据链');
  const cbamRisk = !hasCalc ? 'high' : (confLv === 'Lv.4' ? 'low' : 'high');
  const supStatus = supTotal > 0 ? `${covPct}% 已提交（${supDone}/${supTotal} 家）` : '尚未录入供应商';
  const supRisk = covPct < 50 ? 'high' : covPct < 80 ? 'mid' : 'low';
  const supAction = supTotal > 0
    ? `推动剩余 ${Math.max(0, supTotal - supDone)} 家填报`
    : '前往供应链协同签发穿透填报卡片';
  const gec = Number(co.gecKwh != null ? co.gecKwh : m.gecKwh) || 0;
  const elec = Number(co.annualPowerKwh != null ? co.annualPowerKwh : m.annualPowerKwh) || 0;
  const greenPct = elec > 0 ? Math.min(100, Math.round((gec / elec) * 100)) : 0;
  const reductionPct = Number(co.reductionTargetPct != null ? co.reductionTargetPct : m.reductionTargetPct);
  const reductionStatus = Number.isFinite(reductionPct) && reductionPct > 0
    ? `${Math.round(reductionPct)}% 目标完成`
    : (greenPct > 0 ? `绿电覆盖约 ${greenPct}%` : '减排路径待规划');
  const reductionRisk = Number.isFinite(reductionPct) && reductionPct >= 70 ? 'low' : (greenPct >= 30 ? 'mid' : 'mid');
  const genAt = (s.diagnostic && (s.diagnostic.generatedAt || s.diagnostic.generated_at)) || null;
  const archiveStatus = genAt ? '链上存证已完成' : '诊断报告待生成';
  const archiveRisk = genAt ? 'low' : 'mid';
  return [
    { name: '碳数据完整性', status: carbonStatus, riskLevel: carbonRisk, action: '启动供应链穿透计划' },
    { name: 'CBAM申报就绪', status: cbamStatus, riskLevel: cbamRisk, action: hasCalc && confLv !== 'Lv.4' ? '完成3次通关预演并接驳 MAT' : '完成 CBAM 粗测并留存证据链' },
    { name: '供应链覆盖率', status: supStatus, riskLevel: supRisk, action: supAction },
    { name: '减排路径规划', status: reductionStatus, riskLevel: reductionRisk, action: greenPct < 20 ? '制定 Q3 减排方案并引入 GEC' : '维持绿电采购与工艺优化节奏' },
    { name: '合规文档存档', status: archiveStatus, riskLevel: archiveRisk, action: genAt ? '维持现有节奏' : '生成全域诊断报告并完成 CL-IVC 存证' },
  ];
}

function ensureDiagnosticDimensions(state) {
  const s = state || window.AppState;
  if (!s) return;
  s.diagnostic = s.diagnostic || {};
  const existing = s.diagnostic.dimensions;
  if (Array.isArray(existing) && existing.length > 0) return;
  s.diagnostic.dimensions = buildDiagnosticDimensions(s);
  if (s.diagnostic.overallScore == null || s.diagnostic.overallScore === '') {
    const highs = s.diagnostic.dimensions.filter((d) => d.riskLevel === 'high').length;
    const mids = s.diagnostic.dimensions.filter((d) => d.riskLevel === 'mid').length;
    s.diagnostic.overallScore = Math.max(0, Math.min(100, 88 - highs * 12 - mids * 5));
  }
}
window.buildDiagnosticDimensions = buildDiagnosticDimensions;
window.ensureDiagnosticDimensions = ensureDiagnosticDimensions;

/** 解析权威 AppState（管道 payload 无 gmLedger 时回退父页/本页完整状态） */
function resolveAuthoritativeAppState(input) {
  let root = null;
  try {
    if (window.parent && window.parent !== window && window.parent.AppState) {
      root = window.parent.AppState;
    }
  } catch (_) {}
  if (!root && window.AppState) root = window.AppState;
  if (input && (input.supplierNodes || input.suppliers || input.user || input.metrics)) {
    const hasLedger = Array.isArray(input.gmLedger)
      || (input.user && (Array.isArray(input.user.gm_ledger) || Array.isArray(input.user.gmLedger)));
    if (!hasLedger && root) return root;
    return input;
  }
  return root || input || null;
}
window.resolveAuthoritativeAppState = resolveAuthoritativeAppState;

/** 从状态对象提取 GM 流水；无字段返回 null（表示“本包未携带流水”，非空数组） */
function extractGmLedgerFromState(state) {
  if (!state || typeof state !== 'object') return null;
  if (Array.isArray(state.gmLedger)) return state.gmLedger;
  const u = state.user || {};
  if (Array.isArray(u.gm_ledger)) return u.gm_ledger;
  if (Array.isArray(u.gmLedger)) return u.gmLedger;
  return null;
}

function formatGenerationalSyncTime(iso) {
  if (!iso) return '';
  try {
    if (typeof F !== 'undefined' && F.dt) return F.dt(iso);
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) {
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
        + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
  } catch (_) {}
  return String(iso).slice(0, 16).replace('T', ' ');
}

/** 代际收益事件列表（供应链协同 · 从 GM 流水过滤） */
function buildGenerationalEventsFromLedger(ledger) {
  const events = [];
  (ledger || []).forEach((entry) => {
    if (events.length >= 3) return;
    const act = String(entry.action || entry.action_type || '').toLowerCase();
    if (act !== 'earn') return;
    const memo = [
      entry.memo,
      entry.title,
      entry.sourceRef,
      entry.source_ref,
    ].filter(Boolean).join(' ');
    if (!/供应商|代际|supplier|generational/i.test(memo)) return;
    const amt = Number(entry.amount != null ? entry.amount : entry.gm_earned != null ? entry.gm_earned : entry.gmEarned) || 0;
    const at = entry.createdAt || entry.created_at || '';
    events.push({
      title: String(entry.title || entry.memo || '供应链 GM'),
      sub: at ? ((typeof F !== 'undefined' && F.dt) ? F.dt(at) : String(at).slice(0, 16)) : '代际网络',
      val: `+${Math.round(amt)} GM`,
      color: /代际|generational/i.test(memo) ? 'var(--gold-l)' : 'var(--green-l)',
    });
  });
  if (!events.length) {
    events.push({
      title: '🛡️ 暂无代际收益，邀请更多供应商以激活网络',
      sub: '当供应商完成填报或触发代际分润时，流水将在此展示',
      val: '待激活',
      color: 'var(--ink3)',
      muted: true,
    });
  }
  return events.slice(0, 3);
}

function buildGenerationalEvents(state) {
  const s = state || window.AppState || {};
  const ledger = extractGmLedgerFromState(s);
  return buildGenerationalEventsFromLedger(ledger != null ? ledger : []);
}

/**
 * 代际收益渲染上下文：区分 live / stale / syncing / empty
 * stale = 当前包未带 gmLedger，展示上一次已验证流水并标注
 */
function resolveGenerationalRenderContext(state, opts) {
  opts = opts || {};
  const root = resolveAuthoritativeAppState(state);
  const ledgerInInput = extractGmLedgerFromState(state);
  const ledgerInRoot = extractGmLedgerFromState(root);
  const syncedAt = (root && (root.serverTime || (root.compute && root.compute.lastSyncAt)))
    || (state && (state.serverTime || (state.compute && state.compute.lastSyncAt)))
    || null;

  let syncStatus = 'syncing';
  let ledger = [];
  let events = [];
  let syncMessage = '正在等待 GM 流水同步…';

  if (ledgerInInput !== null) {
    ledger = ledgerInInput;
    events = buildGenerationalEventsFromLedger(ledger);
    syncStatus = events.some((e) => !e.muted) ? 'live' : 'empty';
    syncMessage = syncStatus === 'live'
      ? '已与服务器 GM 流水同步' + (syncedAt ? ' · ' + formatGenerationalSyncTime(syncedAt) : '')
      : '已同步：当前暂无供应链代际收益记录';
    if (syncStatus === 'live') {
      window.__hengaiGenIncomeLastGood = {
        events: events.map((e) => Object.assign({}, e)),
        syncedAt: syncedAt || new Date().toISOString(),
        ledgerCount: ledger.length,
      };
    }
  } else if (ledgerInRoot !== null) {
    ledger = ledgerInRoot;
    events = buildGenerationalEventsFromLedger(ledger);
    syncStatus = events.some((e) => !e.muted) ? 'live' : 'empty';
    syncMessage = syncStatus === 'live'
      ? '已与服务器 GM 流水同步' + (syncedAt ? ' · ' + formatGenerationalSyncTime(syncedAt) : '')
      : '已同步：当前暂无供应链代际收益记录';
    if (syncStatus === 'live') {
      window.__hengaiGenIncomeLastGood = {
        events: events.map((e) => Object.assign({}, e)),
        syncedAt: syncedAt || new Date().toISOString(),
        ledgerCount: ledger.length,
      };
    }
  } else if (window.__hengaiGenIncomeLastGood && Array.isArray(window.__hengaiGenIncomeLastGood.events)) {
    events = window.__hengaiGenIncomeLastGood.events.map((e) => Object.assign({}, e));
    syncStatus = 'stale';
    const at = window.__hengaiGenIncomeLastGood.syncedAt;
    syncMessage = '轻量刷新未携带 GM 流水，展示最近一次已验证记录'
      + (at ? ' · ' + formatGenerationalSyncTime(at) : '')
      + '（非伪造数据）';
  } else {
    events = buildGenerationalEventsFromLedger([]);
    syncStatus = 'syncing';
    syncMessage = '正在等待 GM 流水同步…';
  }

  if (opts.source === 'pipeline' && ledgerInInput === null && ledgerInRoot === null) {
    syncStatus = window.__hengaiGenIncomeLastGood ? 'stale' : 'syncing';
  }

  return { events, syncStatus, syncMessage, syncedAt };
}
window.resolveGenerationalRenderContext = resolveGenerationalRenderContext;

function renderGenerationalIncomeHtml(events) {
  return (events || []).map((e) => {
    const valColor = e.color || 'var(--teal-l)';
    const valText = e.muted ? F.esc(e.val) : F.esc(e.val);
    return (
      '<div style="padding:10px 12px;background:rgba(0,0,0,.25);border:1px solid var(--border);border-radius:9px">'
      + '<div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:12px">'
      + '<span style="color:var(--ink2)">' + F.esc(e.title) + '</span>'
      + '<span style="color:' + valColor + ';font-weight:700;font-family:\'DM Mono\',monospace">' + valText + '</span>'
      + '</div>'
      + '<div style="font-size:10.5px;color:var(--ink3)">' + F.esc(e.sub) + '</div>'
      + '</div>'
    );
  }).join('');
}

function renderGenerationalSyncBadge(ctx) {
  const badge = document.getElementById('sup-gen-sync');
  if (!badge || !ctx) return;
  const st = ctx.syncStatus || 'syncing';
  const msg = ctx.syncMessage || '';
  badge.className = 'sup-gen-sync ' + st;
  if (st === 'live') {
    badge.textContent = '';
    badge.style.visibility = 'hidden';
    badge.style.minHeight = '0';
    badge.style.marginBottom = '0';
    badge.style.padding = '0';
    badge.style.borderWidth = '0';
  } else {
    badge.textContent = msg;
    badge.style.visibility = 'visible';
    badge.style.minHeight = '26px';
    badge.style.marginBottom = '6px';
    badge.style.padding = '6px 10px';
    badge.style.borderWidth = '1px';
  }
}

function renderGenerationalIncome(state, opts) {
  const el = document.getElementById('sup-gen-events');
  if (!el) return;
  const ctx = resolveGenerationalRenderContext(state, opts);
  renderGenerationalSyncBadge(ctx);
  const html = renderGenerationalIncomeHtml(ctx.events);
  const fp = ctx.syncStatus + '|' + html.length + '|' + html.slice(0, 120);
  if (fp === window.__hengaiGenIncomeFp && el.innerHTML === html) return;
  window.__hengaiGenIncomeFp = fp;
  el.innerHTML = html;
}
window.buildGenerationalEvents = buildGenerationalEvents;
window.buildGenerationalEventsFromLedger = buildGenerationalEventsFromLedger;
window.renderGenerationalIncome = renderGenerationalIncome;
window.renderGenerationalIncomeHtml = renderGenerationalIncomeHtml;

function renderHengaiSupplierTable(state) {
  const s = state || window.AppState;
  const tbody = document.getElementById('supplier-table-body');
  if (!tbody || !s) return;
  const table = tbody.closest('table');
  const colCount = table ? table.querySelectorAll('thead th').length : 6;
  const slimTable = colCount <= 6;
  const nodes = resolveSupplierList(s);
  if (!nodes.length) {
    const emptyHtml =
      '<tr><td colspan="' +
      colCount +
      '" style="padding:18px;text-align:center;color:var(--ink3);font-size:12.5px">暂无供应商节点。完成 CBAM 测算或点击「导入供应商」后，数据将从企业底座实时同步。</td></tr>';
    if (window.__hengaiSupplierTableFp !== 'none') {
      window.__hengaiSupplierTableFp = 'none';
      tbody.innerHTML = emptyHtml;
    }
    const foldWrap = document.getElementById('supplier-table-fold-tools');
    if (foldWrap) foldWrap.style.display = 'none';
    return;
  }
  const tier = Number(window.__claimWorkbenchTier || 0);
  if (window.__hengaiSupplierTableExpanded == null) {
    try {
      const saved = localStorage.getItem('hengai_supply_table_expanded_v1');
      if (saved === '1') window.__hengaiSupplierTableExpanded = true;
      else if (saved === '0') window.__hengaiSupplierTableExpanded = false;
    } catch (_) {}
  }
  const previewCount = tier <= 0 ? 5 : 8;
  const expanded = window.__hengaiSupplierTableExpanded === true;
  const rankNodes = nodes.slice().sort((a, b) => {
    const score = (n) => {
      const wl = n && (n.isWhiteListed || n.is_white_listed) ? 3 : 0;
      const ins = n && (n.isInsured || n.is_insured) ? 2 : 0;
      const sug = String((n && (n.insuranceSuggestion || n.insurance_suggestion)) || '');
      const suggest = /建议投保/.test(sug) ? 1 : 0;
      return wl + ins + suggest;
    };
    const sa = score(a);
    const sb = score(b);
    if (sb !== sa) return sb - sa;
    const aa = String((a && (a.supplierName || a.supplier_name)) || '');
    const bb = String((b && (b.supplierName || b.supplier_name)) || '');
    return aa.localeCompare(bb, 'zh-CN');
  });
  const filterMode = window.__hengaiSupplierTableFilter || 'all';
  let displayNodes = rankNodes;
  if (filterMode === 'premium') {
    displayNodes = rankNodes.filter((node) => {
      const st = String((node && (node.status || node.supplierStatus)) || '').toLowerCase();
      const done = st === 'submitted' || st === 'confirmed';
      const collab = computeSupplierCollaborationScore(node);
      const premium = node.isPremiumPartner === true || node.is_premium_partner === true || collab >= 80;
      return done && premium;
    });
  } else if (filterMode === 'submitted') {
    displayNodes = rankNodes.filter((node) => {
      const st = String((node && (node.status || node.supplierStatus)) || '').toLowerCase();
      return st === 'submitted' || st === 'confirmed';
    });
  } else if (filterMode === 'pending') {
    displayNodes = rankNodes.filter((node) => {
      const st = String((node && (node.status || node.supplierStatus)) || '').toLowerCase();
      return st !== 'submitted' && st !== 'confirmed';
    });
  }
  if (displayNodes.length === 0 && filterMode !== 'all') {
    const emptyHtml =
      '<tr><td colspan="' +
      colCount +
      '" style="padding:18px;text-align:center;color:var(--ink3);font-size:12.5px">当前筛选条件下暂无匹配节点，请切换筛选或继续推进供应商填报。</td></tr>';
    if (window.__hengaiSupplierTableFp !== 'empty|' + filterMode) {
      window.__hengaiSupplierTableFp = 'empty|' + filterMode;
      tbody.innerHTML = emptyHtml;
    }
    const foldWrap = document.getElementById('supplier-table-fold-tools');
    if (foldWrap) foldWrap.style.display = 'none';
    return;
  }
  const visibleNodes = expanded ? displayNodes : displayNodes.slice(0, Math.min(previewCount, displayNodes.length));
  const fp =
    filterMode +
    '|' +
    (expanded ? '1' : '0') +
    '|' +
    visibleNodes
      .map(function (n) {
        return [
          n.id,
          n.status || n.supplierStatus,
          n.dataQualityScore,
          n.tco2eReported || n.tco2e_reported,
        ].join(':');
      })
      .join(';');
  if (fp === window.__hengaiSupplierTableFp) return;
  window.__hengaiSupplierTableFp = fp;
  const rows = [];
  visibleNodes.forEach((node, idx) => {
    const slotIdx = node.slotIndex != null ? Number(node.slotIndex) : null;
    const parsedSlot = slotIdx || (function () {
      const m = String(node.supplierName || node.supplier_name || '').match(/节点\s*(\d+)/);
      return m ? parseInt(m[1], 10) : null;
    })();
    const name = String(node.supplierName || node.supplier_name || (parsedSlot ? `供应链节点 ${parsedSlot}` : `供应链节点 ${idx + 1}`));
    const code = String(node.supplierCreditCode || node.supplier_credit_code || '待录入');
    const idHint = node.id != null ? String(node.id).slice(0, 8) : '';
    const rawSt = node.status || node.supplierStatus;
    const st = _supplierStatusLabel(rawSt, node);
    const isDone = _supplierIsCompleted(rawSt);
    const dq = node.dataQualityScore != null ? `${F.n(node.dataQualityScore, 0)}%` : (st.cls === 'sc-done' ? '100%' : '0%');
    const ci = formatSupplierCarbonIntensity(node, isDone);
    const collab = computeSupplierCollaborationScore(node);
    const premium = node.isPremiumPartner === true || node.is_premium_partner === true || collab >= 80;
    const pri = st.cls === 'sc-missing' ? 'pb-high' : (st.cls === 'sc-invite' ? 'pb-mid' : 'pb-low');
    const priLbl = st.cls === 'sc-missing' ? '高' : (st.cls === 'sc-invite' ? '中' : '低');
    const civ = [];
    if (node.isWhiteListed || node.is_white_listed) civ.push('<span style="font-size:10px;color:var(--gold-l);margin-left:6px">白名单</span>');
    const ins = node.insuranceSuggestion || node.insurance_suggestion
      || (node.isInsured || node.is_insured ? '已承保' : '');
    if (ins && ins !== '待评估') civ.push('<span style="font-size:10px;color:var(--teal-l);margin-left:4px">' + F.esc(ins) + '</span>');
    const safeName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const nodeId = node.id != null ? String(node.id) : '';
    const safeId = nodeId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const upstreamMaterial = node && node.upstreamDeclaration && node.upstreamDeclaration.materialType
      ? String(node.upstreamDeclaration.materialType)
      : '';
    const factorMeta = '<div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
      + getSupplierFactorStatusBadge(node)
      + (upstreamMaterial ? '<span style="font-size:10.5px;color:var(--ink3)">↑ ' + F.esc(upstreamMaterial) + '</span>' : '')
      + '<button onclick="openUpstreamDeclare(\'' + safeId + '\')" style="margin-left:auto;padding:2px 8px;border-radius:6px;border:1px solid var(--border2);background:var(--bg4);color:var(--ink3);font-size:10px;cursor:pointer;font-family:\'Noto Sans SC\',sans-serif">申报上游</button>'
      + '</div>';
    let action = '';
    if (st.needsInvite) {
      action = `<button class="invite-btn" onclick="openInvite('${safeName}','${safeId}')">发送穿透卡片</button>`;
    } else if (st.awaiting) {
      action = `<button type="button" class="invite-btn invite-btn-secondary" data-supplier-idx="${idx}" onclick="hengaiCopyInviteForRow(${idx})">📋 复制邀请链接</button>`
        + ` <button type="button" class="invite-btn" style="margin-left:6px" onclick="openInvite('${safeName}','${safeId}')">重新签发</button>`;
    } else if (isDone) {
      action = `<button type="button" class="cert-gen-btn" data-supplier-idx="${idx}" onclick="hengaiOpenCertFromRow(${idx})">📥 生成凭证</button>`;
    } else {
      action = `<button class="invite-btn" onclick="openInvite('${safeName}','${safeId}')">发送穿透卡片</button>`;
    }
    const visBuyerTip = '甲方可见：经 CL-IVC 核验的碳强度结论（' + ci + '），不含原始能耗明细。';
    const visPrivateTip = '供应商私有：原始工艺参数、能源账单与设备台账已物理隔离，甲方无权访问。';
    const visCell = '<td class="data-vis-cell"><div class="data-vis-split">'
      + '<span class="data-vis-open" tabindex="0" title="' + F.esc(visBuyerTip) + '">👁 甲方可见</span>'
      + '<span class="data-vis-lock" tabindex="0" title="' + F.esc(visPrivateTip) + '">🔒 供应商私有</span>'
      + '</div></td>';
    const collabCell = '<td><span style="font-family:\'DM Mono\',monospace;color:var(--gold-l)">' + (isDone ? collab : '0') + '</span>'
      + (premium && isDone ? ' <span class="pill p-gold" style="font-size:9px;margin-left:4px">优质碳伙伴</span>' : '')
      + '</td>';
    if (slimTable) {
      rows.push(
        '<tr data-supplier-idx="' + idx + '"' + (nodeId ? ' data-supplier-id="' + F.esc(nodeId) + '"' : '') + '>'
        + '<td><div style="font-weight:500">' + F.esc(name) + civ.join('') + '</div>'
        + '<div style="font-size:10px;color:var(--ink3)">槽位 #' + (parsedSlot != null ? parsedSlot : '—') + (idHint ? ' · ID ' + F.esc(idHint) : '') + '</div>'
        + (code && code !== '待录入' ? '<div style="font-size:10.5px;color:var(--ink3)">' + F.esc(code) + '</div>' : '')
        + factorMeta
        + '</td>'
        + '<td><span class="status-chip ' + st.cls + '">' + st.text + '</span></td>'
        + visCell
        + collabCell
        + '<td><span style="font-family:\'DM Mono\',monospace;color:var(--teal-l)">' + ci + '</span></td>'
        + '<td>' + action + '</td>'
        + '</tr>'
      );
    } else {
      rows.push(
        '<tr data-supplier-idx="' + idx + '"' + (nodeId ? ' data-supplier-id="' + F.esc(nodeId) + '"' : '') + '>'
        + '<td><div style="font-weight:500">' + F.esc(name) + civ.join('') + '</div>'
        + '<div style="font-size:10px;color:var(--ink3)">槽位 #' + (parsedSlot != null ? parsedSlot : '—') + (idHint ? ' · ID ' + F.esc(idHint) : '') + '</div>'
        + (code && code !== '待录入' ? '<div style="font-size:10.5px;color:var(--ink3)">' + F.esc(code) + '</div>' : '')
        + factorMeta
        + '</td>'
        + '<td><span class="status-chip ' + st.cls + '">' + st.text + '</span></td>'
        + visCell
        + collabCell
        + '<td style="font-size:11.5px;color:var(--ink2)">' + dq + '</td>'
        + '<td><span style="font-family:\'DM Mono\',monospace;color:var(--teal-l)">' + ci + '</span></td>'
        + '<td><span class="priority-badge ' + pri + '">' + priLbl + '</span></td>'
        + '<td>' + action + '</td>'
        + '</tr>'
      );
    }
  });
  tbody.innerHTML = rows.join('');
  window.__hengaiSupplierRowCache = displayNodes;

  const foldWrap = document.getElementById('supplier-table-fold-tools');
  const foldBtn = document.getElementById('supplier-table-fold-btn');
  const foldMeta = document.getElementById('supplier-table-fold-meta');
  if (foldWrap && foldBtn && foldMeta) {
    if (displayNodes.length <= previewCount) {
      foldWrap.style.display = 'none';
    } else {
      foldWrap.style.display = '';
      const hidden = Math.max(0, displayNodes.length - visibleNodes.length);
      const wlCnt = displayNodes.filter((n) => n && (n.isWhiteListed || n.is_white_listed)).length;
      const insCnt = displayNodes.filter((n) => n && (n.isInsured || n.is_insured)).length;
      const sugCnt = displayNodes.filter((n) => /建议投保/.test(String((n && (n.insuranceSuggestion || n.insurance_suggestion)) || ''))).length;
      foldMeta.textContent = expanded
        ? ('已展开全部 ' + displayNodes.length + ' 个节点 · 白名单 ' + wlCnt + ' · 已投保 ' + insCnt + ' · 建议投保 ' + sugCnt)
        : ('当前展示前 ' + visibleNodes.length + ' / ' + displayNodes.length + ' 个节点（已折叠 ' + hidden + ' 个以降低压迫感）');
      foldBtn.textContent = expanded ? '收起为精简视图' : '展开全部节点';
    }
  }
}

window.toggleSupplierTableExpand = function toggleSupplierTableExpand(forceExpand) {
  if (typeof forceExpand === 'boolean') window.__hengaiSupplierTableExpanded = forceExpand;
  else window.__hengaiSupplierTableExpanded = !(window.__hengaiSupplierTableExpanded === true);
  try {
    localStorage.setItem('hengai_supply_table_expanded_v1', window.__hengaiSupplierTableExpanded ? '1' : '0');
  } catch (_) {}
  try { renderHengaiSupplierTable(window.AppState); } catch (_) {}
};

function hengaiOpenCertFromRow(idx) {
  const nodes = window.__hengaiSupplierRowCache || (window.AppState && window.AppState.supplierNodes) || [];
  const node = nodes[idx];
  if (!node) return;
  openCarbonSovereigntyCertModal(node);
}

function hengaiCopyInviteForRow(idx) {
  const nodes = window.__hengaiSupplierRowCache
    || (window.resolveAppState && window.resolveAppState() && window.resolveAppState().supplierNodes)
    || (window.AppState && window.AppState.supplierNodes)
    || [];
  const node = nodes[idx];
  if (!node) {
    if (typeof window.showToast === 'function') window.showToast('未找到该供应商节点', 'error');
    return;
  }
  if (typeof window.hengaiRememberInviteFromNode === 'function') {
    window.hengaiRememberInviteFromNode(node);
  }
  if (typeof window.copyH5InviteLink === 'function') {
    window.copyH5InviteLink();
    return;
  }
  if (typeof window.hengaiBuildSupplierH5InviteUrl === 'function') {
    const info = window.hengaiBuildSupplierH5InviteUrl();
    if (info.ready && info.url && navigator.clipboard) {
      navigator.clipboard.writeText(info.url).then(function () {
        if (typeof window.showToast === 'function') {
          window.showToast('✓ 已复制「' + (node.supplierName || node.supplier_name || '供应商') + '」邀请链接', 'gold');
        }
      }).catch(function () {
        if (typeof window.showToast === 'function') window.showToast(info.url, 'gold');
      });
    } else if (typeof window.showToast === 'function') {
      window.showToast('请先发送穿透卡片签发邀请', 'error');
    }
  }
}
window.hengaiCopyInviteForRow = hengaiCopyInviteForRow;

window.hengaiRefreshSupplyConsole = function hengaiRefreshSupplyConsole(state) {
  const st = state || (window.resolveAppState && window.resolveAppState()) || window.AppState;
  if (!st) return;
  try { mirrorAppStateShadowCopy(st); } catch (_) {}
  try {
    if (typeof window.applySupplyPipeline === 'function' && typeof buildHubPipelinePayload === 'function') {
      window.applySupplyPipeline(buildHubPipelinePayload(st));
      return;
    }
  } catch (_) {}
  try { refreshSupplyChainUi(st); } catch (_) {}
};

window.hengaiNotifySupplyInviteSuccess = function hengaiNotifySupplyInviteSuccess(resp, supplierName) {
  const name = String(supplierName || '').trim() || '供应商';
  const ge = Number(resp && (resp.gmEarned != null ? resp.gmEarned : resp.gm_earned)) || 0;
  const msg = (resp && (resp.message || resp.msg)) ? String(resp.message || resp.msg) : '';
  const hubWin = typeof resolveHubHostWindow === 'function' ? resolveHubHostWindow() : window;
  const toastFn = typeof window.showToast === 'function'
    ? window.showToast
    : (hubWin && typeof hubWin.showToast === 'function' ? hubWin.showToast.bind(hubWin) : null);
  const detail = msg || (ge > 0 ? '穿透邀请已签发，请将链接发给对方' : '邀请链接已刷新，可立即复制分享');
  if (toastFn) {
    toastFn('🔔 「' + name + '」' + detail + (ge > 0 ? ' · +' + ge + ' GM' : ''), 'gold');
  }
  try {
    const banner = document.getElementById('sup-invite-success-banner');
    if (banner) {
      banner.textContent = '🔔 穿透邀请已成功签发 · 「' + name + '」· ' + detail;
      banner.classList.add('show');
      clearTimeout(window.__hengaiInviteBannerTimer);
      window.__hengaiInviteBannerTimer = setTimeout(function () {
        banner.classList.remove('show');
      }, 12000);
    }
  } catch (_) {}
  try {
    const gmToast = hubWin.showGMRewardToast || window.showGMRewardToast;
    if (ge > 0 && typeof gmToast === 'function') gmToast(ge, '穿透邀请已签发');
  } catch (_) {}
  emitAppStateEvent('SUPPLY_INVITE_SENT', { supplierName: name, response: resp, gmEarned: ge });
  try {
    localStorage.setItem('hengai_supply_invite_sent', JSON.stringify({
      at: new Date().toISOString(),
      supplierName: name,
      gmEarned: ge,
    }));
  } catch (_) {}
};

function refreshSupplyChainUi(state) {
  const s = state || window.AppState;
  if (!s) return;
  const m = s.metrics || {};
  const nodes = resolveSupplierList(s);
  const total = Number(m.supplierCount != null ? m.supplierCount : nodes.length) || 0;
  let done = 0;
  let pending = 0;
  let uninvited = 0;
  nodes.forEach((n) => {
    const st = String((n && (n.status || n.supplierStatus)) || '').toLowerCase();
    if (st === 'submitted' || st === 'confirmed') done += 1;
    else if (supplierInviteIssued(n)) pending += 1;
    else uninvited += 1;
  });
  let premiumCnt = 0;
  nodes.forEach((n) => {
    const st = String((n && (n.status || n.supplierStatus)) || '').toLowerCase();
    const isDone = st === 'submitted' || st === 'confirmed';
    const collab = computeSupplierCollaborationScore(n);
    const premium = n.isPremiumPartner === true || n.is_premium_partner === true || collab >= 80;
    if (isDone && premium) premiumCnt += 1;
  });
  const premEl = document.getElementById('sup-premium-count');
  if (premEl) premEl.textContent = '优质碳伙伴：' + premiumCnt + ' 家 · 协作分≥80';
  if (!nodes.length) {
    done = Number(m.supplierSubmittedCount != null ? m.supplierSubmittedCount : m.supplierSubmitted) || 0;
    pending = Number(m.supplierPendingCount != null ? m.supplierPendingCount : Math.max(0, total - done)) || 0;
    uninvited = Math.max(0, total - done - pending);
  }
  const partial = Math.max(0, total - done - pending - uninvited);
  const cov = m.supplyChainCoverage != null ? Number(m.supplyChainCoverage) : (total > 0 ? done / total : 0);
  const covPct = Number.isFinite(cov) ? (cov <= 1 ? cov * 100 : cov) : 0;
  const covStr = total > 0 ? `${covPct.toFixed(1)}%` : '0%';

  const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
  setTxt('sup-funnel-total', total);
  setTxt('sup-funnel-invited', pending);
  setTxt('sup-funnel-responded', done + partial);
  setTxt('sup-funnel-partial', partial);
  setTxt('sup-kpi-partial', partial);
  setTxt('sup-kpi-uninvited', uninvited);
  setTxt('sup-pending-val', pending);
  setTxt('sup-net-direct', done);
  setTxt('sup-net-tier2', partial);
  setTxt('sup-net-gm-pending', Math.max(0, pending * 200));

  const funnel = document.getElementById('sup-funnel-complete');
  if (funnel) funnel.style.width = (total > 0 ? Math.max(8, (done / total) * 100) : 0) + '%';

  document.querySelectorAll('.dyn-sup-pct').forEach((el) => {
    el.textContent = covStr;
    el.style.color = covPct > 0 ? '' : 'var(--ink3)';
  });
  try { renderGenerationalIncome(s); } catch (e) { console.warn('[AppState] renderGenerationalIncome', e); }
  try { updateFortressRadar(s); } catch (e) { console.warn('[AppState] updateFortressRadar', e); }
  try { renderHengaiSupplierTable(s); } catch (e) { console.warn('[AppState] renderHengaiSupplierTable', e); }
}
window.renderHengaiSupplierTable = renderHengaiSupplierTable;
window.refreshSupplyChainUi = refreshSupplyChainUi;
window.openCarbonSovereigntyCert = openCarbonSovereigntyCert;
window.openCarbonSovereigntyCertModal = openCarbonSovereigntyCertModal;
window.hengaiOpenCertFromRow = hengaiOpenCertFromRow;
window.closeCarbonSovereigntyCertModal = closeCarbonSovereigntyCertModal;
window.downloadCarbonSovereigntyCertCard = downloadCarbonSovereigntyCertCard;
window.computeSupplierCollaborationScore = computeSupplierCollaborationScore;
window.resolveSupplierList = resolveSupplierList;
window.renderFortressPanel = renderFortressPanel;
window.updateFortressRadar = updateFortressRadar;
window.computeClIvcHash = computeClIvcHash;

/** Hub 左侧四栏 · 产品定名（2026-06） */
window.HUB_PAGE_LABELS = Object.freeze({
  supply: '供应链协同',
  'batch-verify': '产业链核验',
  'origin-audit': '产业主权看板',
  'industry-audit': '产业主权看板',
  'factor-auth': '原厂因子精算',
});

/** 同步侧栏/导航文案（flags.navLabels / HUB_PAGE_LABELS） */
function syncNavLabels(state) {
  const s = state || window.AppState;
  const labels = Object.assign({}, window.HUB_PAGE_LABELS || {}, (s && s.flags && s.flags.navLabels) || {});
  Object.keys(labels).forEach(function (pageId) {
    const lbl = labels[pageId];
    if (!lbl) return;
    document.querySelectorAll('.sb-item[data-page="' + pageId + '"], #nav-' + pageId + ', #n-' + pageId).forEach(function (item) {
      const dot = item.querySelector('.sb-dot');
      if (!dot) return;
      let textNode = null;
      item.childNodes.forEach(function (n) {
        if (n.nodeType === Node.TEXT_NODE && String(n.textContent || '').trim()) textNode = n;
      });
      if (textNode) textNode.textContent = lbl;
      else item.appendChild(document.createTextNode(lbl));
    });
  });
  const supplyLbl = labels.supply || '供应链协同';
  const idEl = document.getElementById('nav-supply-label');
  if (idEl) idEl.textContent = supplyLbl;
  try {
    const doc = window.top && window.top.document ? window.top.document : document;
    const topLbl = doc.getElementById('nav-supply-label');
    if (topLbl && topLbl !== idEl) topLbl.textContent = supplyLbl;
  } catch (_) {}
}
window.syncNavLabels = syncNavLabels;

/* ═══════════════════════════════════════════════════════════════════════
   11 · syncAppState() —— 全量 DOM 灌注
   ═══════════════════════════════════════════════════════════════════════ */
/** 刷新诊断报告生成时间（优先最近 CBAM 报告提交时间） */
function refreshDiagnosticGeneratedAt(s) {
  const st = s || window.AppState || {};
  if (!st.diagnostic || typeof st.diagnostic !== 'object') st.diagnostic = {};
  const reports = st.recentReports || [];
  const r0 = reports[0];
  const fromReport = r0 && (r0.submittedAt || r0.createdAt || r0.submitted_at || r0.created_at);
  if (fromReport) {
    st.diagnostic.generatedAt = fromReport;
  } else if (!st.diagnostic.generatedAt) {
    st.diagnostic.generatedAt = st.serverTime || new Date().toISOString();
  }
  return st.diagnostic.generatedAt;
}
window.refreshDiagnosticGeneratedAt = refreshDiagnosticGeneratedAt;

/** 开机对时：写入 serverTime 并立即刷新 .dyn-server-time */
function pulseServerClock(s) {
  const st = s || window.AppState || {};
  const now = new Date().toISOString();
  st.serverTime = now;
  refreshDiagnosticGeneratedAt(st);
  if (typeof document === 'undefined') return now;
  const show = F.dtm(now);
  document.querySelectorAll('.dyn-server-time, #id-server-time').forEach((el) => {
    el.textContent = show;
  });
  return now;
}
window.pulseServerClock = pulseServerClock;

function syncAppState(state, opts) {
  let s = state || window.AppState;
  if (!s) return;
  try { ensureEvidenceContractShape(s); } catch (_) {}
  patchUserLoginFlag(s);
  pulseServerClock(s);
  const emitSynced = !(opts && opts.emitStateSynced === false);
  if (typeof window.clearGhostData === 'function' && opts && opts.skipGhostClear) { /* no-op */ }
  else if (typeof window.clearGhostData === 'function' && !(opts && opts.fromRemote)) {
    try { window.clearGhostData(); } catch (_) {}
  }

  /* FM 绑定 */
  FM.forEach(({ c, p, compute, f, a, moneyExposure }) => {
    const els = document.querySelectorAll('.' + c);
    if (!els.length) return;
    let raw = compute ? compute(s) : gp(s, p);
    if (moneyExposure) {
      const n = _numOrZero(raw);
      const html = n > 0 ? F.moneyExposureHtml(n) : '—';
      els.forEach((el) => {
        if (el.innerHTML !== html) el.innerHTML = html;
        el.classList.remove('hengai-pending-field');
        if (el.style.backgroundColor === PENDING_FIELD_STYLE) el.style.backgroundColor = '';
      });
      return;
    }
    let d;
    if (raw==null||raw==='') {
      if (c === 'dyn-tax-intensity' || c === 'dyn-carbon-intensity') d = '0.00';
      else if (c === 'dyn-gm-balance-num' || c === 'dyn-generational-income') d = '0';
      else if (_isNumericStatePath(p, c)) d = '0';
      else d = '待录入';
    }
    else if (f) { try { d=f(raw); } catch { d=String(raw); } }
    else d = String(raw);
    els.forEach((el) => {
      setEl(el, d, a);
      if (raw == null || raw === '') {
        if (d === '待录入') {
          el.classList.add('hengai-pending-field');
          el.style.backgroundColor = PENDING_FIELD_STYLE;
        }
      } else {
        el.classList.remove('hengai-pending-field');
        if (el.style.backgroundColor === PENDING_FIELD_STYLE) el.style.backgroundColor = '';
      }
    });
  });

  applyPendingDynScan(s);

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
  try { syncHubPhaseLocks(s); } catch (_) {}
  try { if (typeof window.applyIdentityAwareNav === 'function') window.applyIdentityAwareNav(s); } catch (_) {}
  try { if (typeof window.syncCbamIdentityUi === 'function') window.syncCbamIdentityUi(s); } catch (_) {}
  try { guardOriginFactoryPage(); } catch (_) {}
  try { syncNavLabels(s); } catch (_) {}

  /* Sidebar active item — 全域中心由 navTo/hash 决定，禁止按文件名硬锁 overview */
  const fn  = decodeURIComponent((location.pathname.split('/').pop()||'').split('?')[0]);
  const isHubShell = fn === '全域中心.html';
  const PAGE_MAP = {
    'index.html':'overview',
    'HengAI_星火成就档案.html':'achieve',
    'HengAI_CBAM测算工具.html':'calc',
    'HengAI_算力资源.html':'resource',
    'HengAI_法规知识库.html':'knowledge',
    'HengAI_工业原厂精算.html':'factor-auth',
    'HengAI_GM_Wallet.html':'wallet',
    'HengAI_HeavyIndustry_Suite.html':'origin-audit',
    'HengAI_企业数字档案.html':'enterprise',
    'HengAI_供应链协同.html':'supply',
    'HengAI_核验.html':'batch-verify',
    'HengAI_全域诊断报告.html':'report',
    'HengAI_决策层呈送包生成器.html':'decision',
    'HengAI_荣誉体系.html':'honor',
    'HengAI_Governance.html':'gov',
    'HengAI_EU_Customs.html':'eu',
    'HengAI_DLD_Credit.html':'dld',
    'HengAI_ACF_Cert.html':'acf',
  };
  let currentPage = isHubShell ? null : PAGE_MAP[fn];
  if (isHubShell) {
    if (typeof window.syncHubSidebarActive === 'function' && window.__hubActivePage) {
      window.syncHubSidebarActive(window.__hubActivePage);
    } else {
      try {
        var hubHash = (location.hash || '').replace(/^#/, '').toLowerCase();
        if (hubHash && document.getElementById('nav-' + hubHash)) currentPage = hubHash;
      } catch (_) {}
      if (!currentPage && window.__hubActivePage) currentPage = window.__hubActivePage;
      if (!currentPage) {
        try { currentPage = sessionStorage.getItem('hengai_hub_page'); } catch (_) {}
      }
      if (!currentPage || !document.getElementById('nav-' + currentPage)) currentPage = 'overview';
      var hubSidebar = document.getElementById('sidebar');
      if (hubSidebar) {
        hubSidebar.querySelectorAll('.sb-item[data-page]').forEach(function (el) {
          var on = el.getAttribute('data-page') === currentPage;
          el.classList.toggle('active', on);
          if (on) el.setAttribute('aria-current', 'page');
          else el.removeAttribute('aria-current');
        });
      }
    }
  } else if (currentPage) {
    document.querySelectorAll('.sidebar .sb-item[data-page]').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-page') === currentPage);
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

  try { ensureDiagnosticDimensions(s); } catch (e) { console.warn('[AppState] ensureDiagnosticDimensions', e); }
  try {
    const co = s.company || {};
    if (co.name && (co.annualExportTons > 0 || co.annualPowerKwh > 0)) {
      const estPatch = patchEnterpriseMetricsFromProfile(s);
      if (estPatch) {
        Object.assign(window.AppState, deepMerge(window.AppState, estPatch));
        s = window.AppState;
      }
    }
  } catch (e) { console.warn('[AppState] patchEnterpriseMetricsFromProfile', e); }
  try { refreshHubCbamUi(window.AppState); } catch (e) { console.warn('[AppState] refreshHubCbamUi', e); }
  try { syncDataStateBinds(s); } catch (e) { console.warn('[AppState] syncDataStateBinds', e); }
  try { updateHubSyncGate(s); } catch (_) {}
  try { renderHengaiSupplierTable(s); } catch (e) { console.warn('[AppState] renderHengaiSupplierTable', e); }
  try { refreshSupplyChainUi(s); } catch (_) {}
  try { if (typeof window.applyUiMapFromData === 'function') window.applyUiMapFromData(s); } catch (_) {}
  try { if (typeof window.applyHubMilestonesToDom === 'function') window.applyHubMilestonesToDom(s); } catch (_) {}

  if (emitSynced) {
    EventBus.emit('STATE_SYNCED', s);
  }
  EventBus.emit('STATE_UPDATED', s);
}
window.syncAppState = syncAppState;

/* ═══════════════════════════════════════════════════════════════════════
   12 · deepMerge —— 深合并 API 响应到 AppState
   ═══════════════════════════════════════════════════════════════════════ */
/** V4.5 · 防环深合并：避免 target/source 同引用导致 Maximum call stack size exceeded */
function deepMerge(target, source) {
  if (source == null || typeof source !== 'object' || Array.isArray(source)) {
    return target;
  }
  const MAX_DEPTH = 40;
  function mergeNode(t, s, depth) {
    if (depth > MAX_DEPTH) return Array.isArray(s) ? s.slice() : s;
    if (s == null || typeof s !== 'object') return s;
    if (Array.isArray(s)) return s.slice();
    const base = (t && typeof t === 'object' && !Array.isArray(t)) ? t : {};
    const out = Object.assign({}, base);
    for (const k of Object.keys(s)) {
      if (k === '__proto__' || k === 'constructor') continue;
      const sv = s[k];
      if (sv === undefined) continue;
      const tv = out[k];
      if (sv === null) {
        out[k] = null;
        continue;
      }
      if (typeof sv !== 'object') {
        out[k] = sv;
        continue;
      }
      if (sv === out || sv === t || sv === s) {
        out[k] = Array.isArray(sv) ? sv.slice() : Object.assign({}, sv);
        continue;
      }
      if (Array.isArray(sv)) {
        out[k] = sv.slice();
        continue;
      }
      if (tv === sv) {
        out[k] = sv;
        continue;
      }
      out[k] = mergeNode(
        tv && typeof tv === 'object' && !Array.isArray(tv) ? tv : {},
        sv,
        depth + 1
      );
    }
    return out;
  }
  const tgt = target && typeof target === 'object' && !Array.isArray(target) ? target : {};
  return mergeNode(tgt, source, 0);
}
window.deepMerge = deepMerge;

/**
 * 批次 8 · 与 hub_engine.normalize_app_state_for_frontend 对齐
 * 在 sanitize 阶段补齐 tier_code / regLabel / scope3Rate，避免旧后端或缓存缺字段
 */
function enrichOverviewPayloadIdentity(out) {
  if (!out || typeof out !== 'object' || Array.isArray(out)) return out;
  if (out.user && typeof out.user === 'object') {
    const u = out.user;
    const ident = formatHubUserIdentity(u);
    u.tier_code = ident.tierCode;
    u.tierLabel = ident.tierLabel;
    if (ident.regDate) u.regDate = ident.regDate;
    if (ident.regLabel && ident.regLabel !== '—') u.regLabel = ident.regLabel;
  }
  if (out.company && typeof out.company === 'object' && out.metrics && typeof out.metrics === 'object') {
    const co = out.company;
    const hasScope = co.scope3Rate != null && co.scope3Rate !== '' && Number(co.scope3Rate) > 0;
    if (!hasScope) {
      const cov = out.metrics.supplyChainCoverage != null
        ? out.metrics.supplyChainCoverage
        : out.metrics.scope3Coverage;
      if (cov != null && cov !== '') {
        const cx = Number(cov);
        if (Number.isFinite(cx)) {
          co.scope3Rate = cx <= 1 && cx >= 0 ? Math.round(cx * 10000) / 100 : cx;
        }
      }
    }
  }
  return out;
}
window.enrichOverviewPayloadIdentity = enrichOverviewPayloadIdentity;

function prunePayloadTree(val, depth) {
  if (depth > 28) return null;
  if (val == null) return val;
  const t = typeof val;
  if (t === 'function' || t === 'symbol' || t === 'bigint') return undefined;
  if (t !== 'object') return val;
  if (Array.isArray(val)) {
    return val.map(function (item) { return prunePayloadTree(item, depth + 1); })
      .filter(function (item) { return item !== undefined; });
  }
  const o = {};
  Object.keys(val).forEach(function (k) {
    if (k === '__proto__' || k === 'constructor') return;
    const v = prunePayloadTree(val[k], depth + 1);
    if (v !== undefined) o[k] = v;
  });
  return o;
}

/** 将 hub/overview 等松散 JSON 规范为可 deepMerge 的对象，避免 null/数组 导致下游抛错 */
function sanitizeOverviewPayload(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return {};
  var pickObj = function (v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  };
  try {
    var out = Object.assign({}, prunePayloadTree(src, 0) || {});
    if ('user' in out) {
      out.user = pickObj(out.user);
      if (out.user.gmBalance != null) out.user.gmBalance = Number(out.user.gmBalance) || 0;
      var gg = out.user.generationalGm != null ? out.user.generationalGm : out.user.generational_gm;
      out.user.generationalGm = Number(gg) || 0;
      var regIso = out.user.regDate || out.user.reg_date || out.user.createdAt || out.user.created_at;
      if (regIso) {
        out.user.regDate = String(regIso).slice(0, 10);
        out.user.createdAt = out.user.regDate;
      }
    }
    if ('gmLedger' in out && !Array.isArray(out.gmLedger)) out.gmLedger = [];
    if ('company' in out) out.company = pickObj(out.company);
    if ('metrics' in out) {
      out.metrics = pickObj(out.metrics);
      var ci = out.metrics.carbonIntensity != null ? out.metrics.carbonIntensity : out.metrics.carbon_intensity;
      if (ci == null || ci === '' || Number.isNaN(Number(ci)) || Number(ci) <= 0) {
        out.metrics.carbonIntensity = null;
        delete out.metrics.carbon_intensity;
      }
    }
    if ('impact' in out && out.impact) {
      var ti = out.impact.tax_intensity != null ? out.impact.tax_intensity : out.impact.taxIntensity;
      if (ti == null || ti === '' || Number.isNaN(Number(ti)) || Number(ti) <= 0) {
        out.impact.tax_intensity = null;
        out.impact.taxIntensity = null;
      }
    }
    if ('flags' in out) out.flags = pickObj(out.flags);
    if ('impact' in out) out.impact = pickObj(out.impact);
    if ('wallet' in out) out.wallet = pickObj(out.wallet);
    if ('macro' in out) out.macro = pickObj(out.macro);
    if ('cbam' in out && out.cbam != null && typeof out.cbam === 'object' && !Array.isArray(out.cbam)) {
      out.cbam = pickObj(out.cbam);
    }
    return enrichOverviewPayloadIdentity(out);
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
  var ep = String(endpoint || '');
  if (!ep.startsWith('/api/v1/')) {
    ep = ep.startsWith('/') ? '/api/v1' + ep : '/api/v1/' + ep;
  }
  const base = (API_BASE || 'http://localhost:8000').replace(/\/+$/, '');
  const r = await fetchWithTimeout(`${base}${ep}`, { ...options, headers });
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
function loadCachedState(userId) {
  try {
    const uid = userId != null ? String(userId) : (parseJwtSub(getToken()) || null);
    if (uid) {
      const raw = localStorage.getItem(hubCacheStorageKey(uid));
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed._ownerUserId && String(parsed._ownerUserId) !== uid) return null;
        if (parsed && parsed.user && parsed.user.id && String(parsed.user.id) !== uid) return null;
        if (parsed && !hubOverviewUserMatchesCurrent(parsed)) return null;
        return parsed;
      }
      return null;
    }
    return null;
  } catch { return null; }
}

/** 因子精算 / 核验等纯前端模块：overview 未下发时，从用户级 hub 缓存恢复，避免刷新被 MOCK 清空 */
function overlayClientModulesFromCache() {
  const uid = typeof currentAuthUserId === 'function' ? currentAuthUserId() : parseJwtSub(getToken());
  if (!uid) return false;
  const cached = loadCachedState(uid);
  if (!cached) return false;
  let touched = false;

  const fa = cached.factorAuth;
  if (fa && typeof fa === 'object' && (
    (fa.poolCount || 0) > 0 || (fa.demands || []).length > 0 || fa.confirmedFactor != null
    || fa.gmPoolRewardClaimed || (fa.pooledByIndustry && Object.keys(fa.pooledByIndustry).length)
    || (fa.waitingCount || 0) > 0 || (fa.taxRiskEur || 0) > 0
  )) {
    window.AppState.factorAuth = JSON.parse(JSON.stringify(fa));
    touched = true;
  }

  const bv = cached.batchVerification;
  if (bv && typeof bv === 'object' && (
    (bv.batches || []).length > 0 || (bv.certificates || []).length > 0
  )) {
    window.AppState.batchVerification = JSON.parse(JSON.stringify(bv));
    touched = true;
  }

  if (Array.isArray(cached.badges) && cached.badges.length) {
    const merged = (window.AppState.badges || []).slice();
    cached.badges.forEach(function (b) {
      const code = b.badgeId || b.badgeCode || b.badge_code;
      if (!code) return;
      if (!merged.some(function (m) { return (m.badgeId || m.badgeCode || m.badge_code) === code; })) {
        merged.push(b);
      }
    });
    if (merged.length > (window.AppState.badges || []).length) {
      window.AppState.badges = merged;
      touched = true;
    }
  }

  if (touched) {
    try { saveCachedState(window.AppState); } catch (_) {}
  }
  return touched;
}
window.overlayClientModulesFromCache = overlayClientModulesFromCache;
function saveCachedState(state) {
  try {
    const st = state || {};
    const uid = st.user && (st.user.id || st.user.userId) ? String(st.user.id || st.user.userId) : parseJwtSub(getToken());
    const slim = {
      user: st?.user, company: st?.company, metrics: st?.metrics,
      flags: st?.flags, wallet: st?.wallet, macro: st?.macro,
      cbam: st?.cbam && st.cbam.calcResult ? { calcResult: st.cbam.calcResult } : undefined,
      impact: st?.impact,
      factorAuth: st?.factorAuth,
      batchVerification: st?.batchVerification,
      badges: st?.badges,
      _ts: Date.now(),
      _ownerUserId: uid || null,
    };
    if (uid) {
      localStorage.setItem(hubCacheStorageKey(uid), JSON.stringify(slim));
    }
    localStorage.removeItem(LS_CACHE_KEY);
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
    _stateChannel.postMessage({
      type: 'STATE_PATCH',
      delta,
      _ts: Date.now(),
      _src: STATE_SRC_ID,
      _authEpoch: _authSwitchEpoch,
      _ownerUserId: currentAuthUserId(),
    });
  } catch (e) {
    console.warn('[AppState] broadcastStatePatch', e);
  }
}
window.broadcastStatePatch = broadcastStatePatch;

function applyIncomingStatePatch(msg) {
  if (!msg || msg.type !== 'STATE_PATCH' || !msg.delta) return;
  if (msg._src === STATE_SRC_ID) return;
  if (msg._authEpoch != null && Number(msg._authEpoch) < _authSwitchEpoch) return;
  const curUid = currentAuthUserId();
  if (curUid && msg._ownerUserId && String(msg._ownerUserId) !== curUid) return;
  const incomingUid = msg.delta.user && (msg.delta.user.id || msg.delta.user.userId);
  if (curUid && incomingUid && String(incomingUid) !== curUid) return;
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
  const target = resolveWritableAppState() || window.AppState;
  Object.assign(target, deepMerge(target, delta));
  mirrorAppStateShadowCopy(target);
  try { saveCachedState(target); } catch {}
  const syncOpts = { emitStateSynced: opts && opts.emitStateSynced === false ? false : true };
  syncAppState(undefined, syncOpts);
  try {
    if (window.HengAI && typeof window.HengAI.syncAllInternalData === 'function') {
      window.HengAI.syncAllInternalData(window.AppState);
    }
  } catch {}
  if (!opts?.skipBroadcast) broadcastStatePatch(delta);
  try {
    if (typeof window.hengaiAfterStateSync === 'function') {
      window.hengaiAfterStateSync(window.AppState, {
        source: (opts && opts.source) || 'patchAppState',
        light: true,
      });
    }
  } catch (resErr) {
    console.warn('[AppState] hengaiAfterStateSync', resErr);
  }
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
  var embedKind = type;
  if (type === 'ok') embedKind = 'info';
  if (type === 'err') embedKind = 'error';
  if (typeof window.hengaiEmbedToast === 'function' && window.hengaiEmbedToast(String(msg || ''), embedKind)) return;

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
  try {
  pulseServerClock(window.AppState);
  if (typeof window.clearGhostData === 'function') {
    try { window.clearGhostData(); } catch (_) {}
  }
  if (!window.AppState.flags || typeof window.AppState.flags !== 'object') window.AppState.flags = {};
  window.AppState.flags.hubOverviewReady = false;
  try { updateHubSyncGate(window.AppState); } catch (_) {}

  /* Step 1: 已登录用户禁止读本地缓存首屏（公用终端：只信服务端 overview） */
  const tokenAtBoot = getToken();
  const cached = tokenAtBoot ? null : loadCachedState();
  if (cached && hubOverviewUserMatchesCurrent(cached)) {
    try {
      replaceAuthoritativeAppStateFromLive(cached);
    } catch (e) {
      console.warn('[HengAI] 本地缓存合并失败，使用默认骨架', e);
    }
    syncAppState();
  }

  /* Step 2: 尝试在线 API（3s 超时）；无 Token 也拉访客骨架 */
  let token = getToken();
  let liveState = null;
  let overviewHttpOk = false;
  try {
    var overviewHeaders = { Accept: 'application/json' };
    if (token) overviewHeaders.Authorization = 'Bearer ' + token;
    const r = await fetchWithTimeout(
      API_HUB_OVERVIEW,
      { credentials: 'include', headers: overviewHeaders },
      API_TIMEOUT_MS
    );
      if (r.ok) {
        overviewHttpOk = true;
        var rawLive = await r.json().catch(function () { return null; });
        liveState = sanitizeOverviewPayload(rawLive || {});
      } else if (r.status === 401) {
        try { clearToken(); } catch (_) {}
        try {
          var r2 = await fetchWithTimeout(
            API_HUB_OVERVIEW,
            { credentials: 'include', headers: { Accept: 'application/json' } },
            API_TIMEOUT_MS
          );
          if (r2.ok) {
            overviewHttpOk = true;
            var rawGuest = await r2.json().catch(function () { return null; });
            liveState = sanitizeOverviewPayload(rawGuest || {});
          }
        } catch (_) {}
        if (!liveState) {
          try { EventBus.emit('HUB_FETCH_FAILED', { status: 401 }); } catch (_) {}
        }
      } else {
        console.warn(`[HengAI] /api/v1/hub/overview 返回 HTTP ${r.status}，维持缓存/骨架`);
        try { EventBus.emit('HUB_FETCH_FAILED', { status: r.status }); } catch (_) {}
      }
    } catch (e) {
      console.warn('[HengAI] /api/v1/hub/overview 拉取失败：', e.message);
      EventBus.emit('HUB_FETCH_FAILED', { error: e });
    }
  token = getToken();

  /* Step 3: 在线 overview 整枝替换（禁止 deepMerge 残留旧账号 nested 字段） */
  if (liveState && Object.keys(liveState).length) {
    if (token && !hubOverviewUserMatchesCurrent(liveState)) {
      console.warn('[HengAI] overview user 与 JWT 不一致，丢弃响应防串号');
      liveState = null;
    }
  }
  if (liveState && Object.keys(liveState).length) {
    try {
      replaceAuthoritativeAppStateFromLive(liveState);
      try {
        const lu = liveState.user;
        if (lu && (lu.created_at || lu.createdAt)) {
          window.AppState.user = window.AppState.user || {};
          window.AppState.user.regDate = lu.created_at || lu.createdAt;
        }
      } catch (_) {}
      saveCachedState(window.AppState);
      window.AppState._mode = 'live';
      applyBackendJourneyFromState(window.AppState);
    } catch (mergeErr) {
      console.warn('[HengAI] overview 合并失败，保持缓存/骨架', mergeErr);
      try { EventBus.emit('HUB_MERGE_FAILED', { error: mergeErr }); } catch (_) {}
    }
  } else if (!cached) {
    window.AppState._mode = 'pending';
  }

  if (!window.AppState.flags) window.AppState.flags = {};
  window.AppState.flags.hubOverviewReady = !!overviewHttpOk;
  try { updateHubSyncGate(window.AppState); } catch (_) {}

  /* Step 4: 同步 auth 状态 */
  if (token) {
    if (liveState?.user && Object.keys(liveState.user).length) {
      AppState.updateAuth(liveState.user, token);
    } else {
      try { await hydrateAuthSession({ skipFetch: false }); } catch (_) {}
    }
  }

  /* Step 5: 初始化宏观价源跨标签同步 */
  initMacroRealtimeSync();
  initAppStateBroadcastListener();

  if (window.AppState.user) {
    window.AppState.user.gmBalance = Number(window.AppState.user.gmBalance) || 0;
    window.AppState.user.generationalGm = Number(
      window.AppState.user.generationalGm != null
        ? window.AppState.user.generationalGm
        : window.AppState.user.generational_gm
    ) || 0;
  }

  /* Step 5b: 恢复因子精算/核验等前端模块缓存（overview 不含这些字段） */
  try { overlayClientModulesFromCache(); } catch (_) {}
  try { syncFactorAuthResonanceFromMetrics(window.AppState); } catch (_) {}

  /* Step 6: 全量 DOM 灌注 */
  syncAppState();

  /* Step 7: 回调 */
  if (typeof onReady === 'function') {
    try { onReady(window.AppState); } catch(e) { console.warn('[AppState] onReady error', e); }
  }

  EventBus.emit('APP_READY', window.AppState);
  return window.AppState;
  } catch (initErr) {
    console.error('[HengAI] initAppState 失败', initErr);
    throw initErr;
  } finally {
    if (typeof window.dismissHubLoadingOverlay === 'function') {
      try { window.dismissHubLoadingOverlay(); } catch (_) {}
    } else if (typeof window.showHubLoading === 'function') {
      try { window.showHubLoading(false); } catch (_) {}
    }
    var hubOv = typeof document !== 'undefined' && document.getElementById('hubLoadingOverlay');
    if (hubOv) hubOv.style.display = 'none';
  }
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

/** V4.5 · 子模块保存后向父页广播数据生命循环信号 */
function emitHengaiDataChanged(domain) {
  var msg = { type: 'HENGAI_DATA_CHANGED', domain: domain || 'hub', ts: Date.now() };
  try {
    if (window.parent && window.parent !== window) window.parent.postMessage(msg, '*');
  } catch (_) {}
  try { window.postMessage(msg, '*'); } catch (_) {}
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'DATA_SAVED', domain: domain || 'hub' }, '*');
    }
  } catch (_) {}
  try { window.postMessage({ type: 'DATA_SAVED', domain: domain || 'hub' }, '*'); } catch (_) {}
}
window.emitHengaiDataChanged = emitHengaiDataChanged;

/** CBAM/档案落库后：100ms 内全场 DOM 共振（无刷新） */
function pulseHubAfterDataSync(state) {
  var s = state || window.AppState;
  if (!s) return;
  try {
    if (typeof window.normalizeHubOverviewPayload === 'function') {
      window.__hubOverviewData = window.normalizeHubOverviewPayload(s);
    }
  } catch (_) {}
  try {
    if (typeof window.syncAppState === 'function') window.syncAppState(s, { fromRemote: true, emitStateSynced: true });
  } catch (_) {}
  try {
    if (typeof window.hubPulseFromAppState === 'function') window.hubPulseFromAppState();
  } catch (_) {}
  try {
    if (typeof window.renderHubDiagnosticReport === 'function') window.renderHubDiagnosticReport(s);
  } catch (_) {}
  try {
    if (typeof window.applyRealData === 'function' && window.__hubOverviewData) {
      window.applyRealData(window.__hubOverviewData);
    }
  } catch (_) {}
  try {
    if (typeof window.applyHubMilestonesToDom === 'function') {
      window.applyHubMilestonesToDom(s);
    }
  } catch (_) {}
  try {
    if (typeof window.HengAI !== 'undefined' && typeof window.HengAI.syncAllInternalData === 'function') {
      window.HengAI.syncAllInternalData(s);
    }
  } catch (_) {}
  try { broadcastHubPipelineToEmbeds(s); } catch (e) {
    console.warn('[AppState] broadcastHubPipelineToEmbeds', e);
  }
}
window.pulseHubAfterDataSync = pulseHubAfterDataSync;

function syncHubPhaseLocks(s) {
  if (typeof window.unlockNav !== 'function') return;
  var n = typeof resolveJourneyPhaseNumber === 'function'
    ? resolveJourneyPhaseNumber(s)
    : ((gp(s, 'flags.currentPhase') === 'Phase3')
      ? 3
      : (gp(s, 'flags.currentPhase') === 'Phase2' ? 2 : 1));
  var unlocked = gp(s, 'flags.unlockedMenusList') || [];
  if (Array.isArray(unlocked) && unlocked.indexOf('industry_factor_audit') !== -1 && n < 2) n = 2;
  if (currentAuthUserId()) {
    window.unlockNav(n);
    return;
  }
  if (window.MANUAL_PREVIEW && typeof window.PHASE !== 'undefined') {
    window.unlockNav(window.PHASE);
    return;
  }
  window.unlockNav(n);
}
window.syncHubPhaseLocks = syncHubPhaseLocks;

/**
 * 架构自检（控制台）：AppState、/hub/overview、幽灵硬编码扫描。
 * 用法：在已打开前端的页面控制台执行 `await HengAIAudit()`。
 */
window.HengAIAudit = async function HengAIAudit() {
  console.log('%c🔍 正在执行 HengAI 全域架构大体检...', 'color: #10B981; font-weight: bold; font-size: 16px;');

  if (!window.AppState) {
    console.error('❌ 致命：AppState 根本没加载，整个系统是死的！');
  }

  const overviewUrl = window.API_HUB_OVERVIEW || (hengaiApiOrigin() + '/api/v1/hub/overview');
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
    const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);
    const buf = [];
    const tw = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        let p = node.parentElement;
        while (p) {
          if (skip.has(p.tagName)) return NodeFilter.FILTER_REJECT;
          if (p.closest && p.closest('[data-ghost-ignore]')) return NodeFilter.FILTER_REJECT;
          if (p.hasAttribute && p.hasAttribute('data-factor')) return NodeFilter.FILTER_REJECT;
          if (p.hasAttribute && p.hasAttribute('data-state-bind')) return NodeFilter.FILTER_REJECT;
          var tag = p.tagName;
          if (tag === 'INPUT' || tag === 'SELECT' || tag === 'OPTION' || tag === 'TEXTAREA') {
            if (p.hasAttribute('value')) return NodeFilter.FILTER_REJECT;
          }
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

  if (typeof window.clearGhostData === 'function') {
    try { window.clearGhostData(); } catch (_) {}
  }

  const roots = [document.body];
  document.querySelectorAll('iframe').forEach(function (fr) {
    try {
      var doc = fr.contentDocument;
      if (doc && doc.body) roots.push(doc.body);
    } catch (_) {}
  });

  var visibleText = '';
  roots.forEach(function (root) {
    visibleText += collectVisibleText(root) + '\n';
  });

  const ghostChecks = [
    { label: '王磊', ok: !visibleText.includes('王磊') },
    { label: '王L', ok: !visibleText.includes('王L') },
    { label: '2,840', ok: !visibleText.includes('2,840') },
    { label: '145,000', ok: !visibleText.includes('145,000') },
    { label: '1.82', ok: !/(^|[^\d])1\.82([^\d.]|$)/.test(visibleText) },
  ];
  var blockCount = 0;
  ghostChecks.forEach(function (item) {
    if (!item.ok) {
      blockCount++;
      console.error('🚨【幽灵数据·展示区】InnerText 仍含写死样例「' + item.label + '」——立即清除！');
    }
  });

  if (blockCount === 0) {
    console.log('%c✅ 体检全绿：未发现阻断级幽灵 InnerText（已扫描主文档 + 同源 iframe）。', 'color: #10B981; font-weight: bold;');
  } else {
    console.log('%c⚠ 体检结束：发现 ' + blockCount + ' 项阻断级幽灵。合法因子仅允许出现在 data-* 等属性中。', 'color: #f59e0b; font-weight: bold;');
  }
};

/* 简写 $ */
window.$ = id => document.getElementById(id);

/* 模式标识（console 提示） */
window.HengAI = window.HengAI || {};
HengAI.nav = {
  go(page) {
    const fn = typeof window.hengaiPage === 'function' ? window.hengaiPage : (p) => p;
    window.location.href = fn(page);
  },
  hub(pageId) {
    if (typeof window.navTo === 'function') {
      const el = document.getElementById('nav-' + pageId)
        || document.querySelector('[data-page="' + pageId + '"]');
      if (el) { window.navTo(pageId, el); return; }
    }
    HengAI.nav.go('全域中心.html');
  },
};

function _toast(msg, type) {
  if (typeof window.showToast === 'function') window.showToast(msg, type);
  else console.info('[HengAI]', msg);
}

HengAI.act = {
  goEnterprise() { HengAI.nav.go('HengAI_企业数字档案.html'); },
  goCbam() { HengAI.nav.go('HengAI_CBAM测算工具.html'); },
  goKnowledge() { HengAI.nav.go('HengAI_法规知识库.html'); },
  goSupply() { HengAI.nav.go('HengAI_供应链协同.html'); },
  goGmWallet() { HengAI.nav.go('HengAI_GM_Wallet.html'); },
  goEuCustoms() { HengAI.nav.go('HengAI_EU_Customs.html'); },
  goDld() { HengAI.nav.go('HengAI_DLD_Credit.html'); },
  goDecision() { HengAI.nav.go('HengAI_决策层呈送包生成器.html'); },
  goAchieve() { HengAI.nav.go('HengAI_星火成就档案.html'); },
  goHonor() { HengAI.nav.go('HengAI_荣誉体系.html'); },
  goReport() { HengAI.nav.go('HengAI_全域诊断报告.html'); },
  openSupplyInvite() {
    if (typeof window.openH5ShareModal === 'function') window.openH5ShareModal();
    else HengAI.nav.goSupply();
  },
  async dldApply(requestedAmountCny) {
    const AS = window.AppState;
    if (!AS || typeof AS.saveData !== 'function') throw new Error('请先登录');
    const amt = requestedAmountCny != null ? requestedAmountCny : 500000;
    const resp = await AS.saveData('dld', {
      requestedAmountCny: amt,
      purpose: '绿色信贷 · 碳资产确权融资',
      durationMonths: 36,
    });
    const ge = Number(resp?.gmEarned || resp?.gm_earned || 0);
    _toast(ge > 0 ? `绿色信贷申请已登记 · +${ge} GM` : '绿色信贷申请已登记');
    return resp;
  },
  async generateDecisionPackage() {
    const AS = window.AppState;
    if (!AS || typeof AS.saveData !== 'function') throw new Error('请先登录');
    const risk = AS.metrics?.riskExposureEur || 0;
    const resp = await AS.saveData('decision', {
      title: '全域升级请示报告',
      body: `当前 CBAM 敞口 ${F.eur(risk)}，建议启用企业 MAT 网关与供应链穿透。`,
      recipient: '决策层',
    });
    HengAI.nav.goDecision();
    return resp;
  },
  exportSupplyMap() {
    const nodes = (window.AppState && window.AppState.supplierNodes) || [];
    const lines = ['供应商名称,统一社会信用代码,状态,tCO2e'];
    nodes.forEach((n) => {
      lines.push([
        n.supplierName || n.supplier_name || '',
        n.supplierCreditCode || n.supplier_credit_code || '',
        n.status || '',
        n.tco2eReported != null ? n.tco2eReported : '0',
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '供应链穿透全景_' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(a.href);
    _toast('供应链全景 CSV 已导出');
  },
  importSuppliers() {
    return this._importSuppliersCsv();
  },
  _importSuppliersCsv() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.txt';
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const text = await file.text();
      const rows = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const AS = window.AppState;
      if (!AS || typeof AS.saveData !== 'function') {
        _toast('请先登录后再导入', 'error');
        return;
      }
      let ok = 0;
      for (let i = 0; i < rows.length; i++) {
        if (i === 0 && /供应商|名称|name/i.test(rows[i])) continue;
        const cols = rows[i].split(/,|，|\t/).map((c) => c.replace(/^"|"$/g, '').trim());
        const supplierName = cols[0];
        if (!supplierName) continue;
        try {
          await AS.saveData('supply', {
            supplierName,
            supplierCreditCode: cols[1] || undefined,
          });
          ok++;
        } catch (e) {
          console.warn('[importSuppliers]', e);
        }
      }
      _toast(ok > 0 ? `已导入 ${ok} 家供应商并落库` : '未识别到有效供应商行');
    };
    input.click();
  },
  exportGmLedger() {
    HengAI.act.exportSupplyMap();
  },
};

function bindAppStateInstanceMethods() {
  const a = window.AppState;
  if (!a || !AppState) return;
  a.patchState = patchAppState;
  /** CBAM 等模块：合并 delta + 全量 dyn-* 刷新（patchAppState 已 sync，此处再补 sync() 的 GM 特护） */
  /** 生命周期「存入」：对象 patch 或点路径写值（factorAuth / batchVerification 模块） */
  a.update = function (pathOrDelta, value) {
    if (typeof pathOrDelta === 'string' && arguments.length >= 2) {
      if (typeof AppState.updateField === 'function') AppState.updateField(pathOrDelta, value);
      return a;
    }
    patchAppState(pathOrDelta || {}, { emitStateSynced: false, skipBroadcast: true });
    return a;
  };
  a.save = function () {
    const w = (typeof resolveWritableAppState === 'function' ? resolveWritableAppState() : null) || a;
    try { saveCachedState(w); } catch (_) {}
    if (typeof syncAppState === 'function') syncAppState(w);
    emitAppStateEvent('STATE_SYNCED', w);
    return a;
  };
  const names = ['updateAuth', 'updateGM', 'setGM', 'addContext', 'incrementTurn', 'updateField'];
  names.forEach((k) => {
    if (typeof AppState[k] === 'function') a[k] = AppState[k];
  });
  if (HengAI && HengAI.act && typeof HengAI.act.importSuppliers === 'function') {
    a.importSuppliers = () => HengAI.act.importSuppliers();
  }
}
window.bindAppStateInstanceMethods = bindAppStateInstanceMethods;

bindAppStateInstanceMethods();

/** H5 供应商提交后 · 链主端拉取最新 overview 并刷新供应链 UI */
window.hengaiOnSupplierSubmitted = async function hengaiOnSupplierSubmitted(_payload) {
  try {
    const st = (window.resolveWritableAppState && window.resolveWritableAppState()) || window.AppState;
    const inner = (_payload && _payload.data) ? _payload.data : (_payload || {});
    const appState = inner.appState || inner.app_state;
    const tco2 = inner.tco2eReported != null ? inner.tco2eReported : inner.tco2e_reported;
    const nodeId = inner.supplierNodeId || inner.supplier_node_id;
    if (appState && st) {
      if (typeof mergeAuthoritativeAppStateFromServer === 'function') {
        mergeAuthoritativeAppStateFromServer(appState);
      } else {
        Object.assign(st, deepMerge(st, sanitizeOverviewPayload(appState)));
        try { mirrorAppStateShadowCopy(st); } catch (_) {}
        syncAppState(st, { fromRemote: true });
      }
    } else if (st && Array.isArray(st.supplierNodes) && nodeId && tco2 != null) {
      const nid = String(nodeId);
      st.supplierNodes = st.supplierNodes.map((n) => {
        if (!n || String(n.id) !== nid) return n;
        return Object.assign({}, n, {
          status: 'submitted',
          tco2eReported: Number(tco2),
          carbonIntensityIndex: Number(tco2),
        });
      });
      try { mirrorAppStateShadowCopy(st); } catch (_) {}
    }
    if (!appState) {
      if (typeof initAppState === 'function') {
        await initAppState();
      } else if (typeof window.HengAI === 'object' && typeof window.HengAI.initHengAI === 'function') {
        await window.HengAI.initHengAI();
      }
    }
    const s = st || window.AppState;
    if (typeof refreshSupplyChainUi === 'function') refreshSupplyChainUi(s);
    if (typeof renderHengaiSupplierTable === 'function') renderHengaiSupplierTable(s);
    if (typeof updateFortressRadar === 'function') updateFortressRadar(s);
    if (typeof renderGenerationalIncome === 'function') renderGenerationalIncome(s);
    if (typeof broadcastHubPipelineToEmbeds === 'function') broadcastHubPipelineToEmbeds(s);
    if (typeof EventBus !== 'undefined') EventBus.emit('SUPPLIER_SUBMITTED', { payload: _payload, state: s });
    const hubWin = typeof resolveHubHostWindow === 'function' ? resolveHubHostWindow() : window;
    const toastFn = typeof window.showToast === 'function'
      ? window.showToast
      : (hubWin.showToast ? hubWin.showToast.bind(hubWin) : null);
    if (toastFn && tco2 != null && Number(tco2) > 0) {
      const nm = inner.supplierName || inner.supplier_name || '供应商';
      toastFn('🔔 「' + nm + '」已提交碳强度 ' + Number(tco2).toFixed(2) + ' tCO₂e/t', 'gold');
    }
  } catch (e) {
    console.warn('[AppState] hengaiOnSupplierSubmitted', e);
  }
};

function wireSupplierSubmitLiveRefresh() {
  if (window.__hengaiSupplierSubmitWired) return;
  window.__hengaiSupplierSubmitWired = true;
  window.addEventListener('storage', function (e) {
    if (e.key !== 'hengai_supplier_submitted') return;
    window.hengaiOnSupplierSubmitted();
  });
  try {
    const bc = new BroadcastChannel('hengai_supply_sync');
    bc.onmessage = function (ev) {
      if (ev.data && ev.data.type === 'SUPPLIER_SUBMITTED') {
        window.hengaiOnSupplierSubmitted(ev.data.payload);
      }
    };
  } catch (_) {}
  if (typeof EventBus !== 'undefined') {
    EventBus.on('SUPPLIER_SUBMITTED', function () {
      if (typeof refreshSupplyChainUi === 'function') refreshSupplyChainUi(window.AppState);
    });
  }
}
wireSupplierSubmitLiveRefresh();

initAppStateBroadcastListener();

console.info(
  '%c[HengAI AppState V4.5]%c 引擎已装载 · 数据生命循环已接通 · 等待 initAppState()',
  'color:#6dd5b0;font-weight:700', 'color:#8a95a8'
);
