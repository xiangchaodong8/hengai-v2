if (typeof window !== 'undefined' && typeof window.hengaiPage !== 'function') {
  window.hengaiPage = function (name) {
    try {
      return new URL(String(name || ''), window.location.href).href;
    } catch (e) {
      return String(name || '');
    }
  };
}

// --- HengAI index.html bridge（套娃已废除：统一走 hengai-hub-nav.js → 全域中心.html）---
function openHubOverlay(pageId) {
    if (typeof window.navigateToHub === 'function') {
        window.navigateToHub(pageId || null);
        return;
    }
    window.location.href = (typeof hengaiPage === 'function') ? hengaiPage('全域中心.html') : '全域中心.html';
}
function closeHubOverlay() {
    var hub = document.getElementById('co2lion-hub-overlay');
    if (hub) {
        hub.style.display = 'none';
        hub.style.opacity = '0';
    }
    document.body.style.overflow = '';
    if (window.location.hash === '#hub') {
        try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (_) {}
    }
}
window.addEventListener('DOMContentLoaded', function () {
    if (window.location.hash === '#hub') {
        openHubOverlay();
    }
});
function cyclePhaseSidebar() {
    if (typeof window.setPhase !== 'function') return;
    var ph = typeof window.PHASE !== 'undefined' ? window.PHASE : INDEX_HUB_PHASE;
    window.setPhase(ph >= 3 ? 1 : ph + 1);
}

// ═══════════════════════════════════════════════════════
// STATE — ACCOUNT_TIER / PHASE_CFG 仅由 AppState.js 定义，此处只读 window.*
// ═══════════════════════════════════════════════════════

/** V4.0 数据-视图静态映射（12 模块数字灌注唯一表） */
window.UI_MAP = window.UI_MAP || {
  'user.name': ['id-name', 'sb-uname', 'achieve-name'],
  'user.gmBalance': ['top-gm', 'H-sb-gm', 'achieve-gm-val'],
  'user.generationalGm': ['dyn-generational-income', 'achieve-generational-gm'],
  'impact.tax_exposure': ['rep-tax-exposure', 'total-risk-val'],
  'enterprise.companyName': ['ent-company-name', 'achieve-org'],
  'user.regDate': ['id-user-reg-date', '.dyn-reg-date', '.dyn-user-reg-date'],
  'diagnostic.generatedAt': ['id-report-date', 'rep-gen-date', 'footer-date', '.dyn-report-date', '.dyn-diag-date'],
  'serverTime': ['id-server-time', '.dyn-server-time'],
};

function uiMapGetByPath(data, path) {
  if (!data || !path) return undefined;
  if (path === 'user.name') return data.user && data.user.name;
  if (path === 'user.gmBalance') return data.user && data.user.gmBalance;
  if (path === 'user.generationalGm') {
    var u = data.user || {};
    return u.generationalGm != null ? u.generationalGm : (u.generational_gm != null ? u.generational_gm : 0);
  }
  if (path === 'impact.tax_exposure') {
    var co = data.company || {};
    if (co.cbamRisk) return co.cbamRisk;
    var raw = data.raw || {};
    var imp = raw.impact || data.impact || {};
    var n = Number(imp.riskExposureEur != null ? imp.riskExposureEur : imp.risk_exposure_eur);
    if (Number.isFinite(n) && n > 0) {
      if (typeof hubJsFormatEurRisk === 'function') return hubJsFormatEurRisk(n);
      return '€ ' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    return co.cbamRisk || '待测算';
  }
  if (path === 'enterprise.companyName') {
    var c = data.company || {};
    return c.name || (data.enterprise && data.enterprise.companyName) || '待完善企业档案';
  }
  if (path === 'user.regDate') {
    var u = data.user || {};
    return u.regDate || u.reg_date || u.createdAt || u.created_at;
  }
  if (path === 'diagnostic.generatedAt') {
    var d = data.diagnostic || {};
    var reps = data.recentReports || [];
    var r0 = reps[0];
    return d.generatedAt || d.generated_at
      || (r0 && (r0.submittedAt || r0.createdAt || r0.submitted_at || r0.created_at))
      || data.serverTime;
  }
  if (path === 'serverTime') {
    return data.serverTime || new Date().toISOString();
  }
  return undefined;
}

function uiMapFormatValue(path, raw) {
  if (path === 'user.regDate' || path === 'diagnostic.generatedAt') {
    if (raw == null || raw === '') return (typeof F !== 'undefined' && F.dt) ? F.dt(null) : '待记录';
    return (typeof F !== 'undefined' && F.dt) ? F.dt(raw) : String(raw).slice(0, 10);
  }
  if (path === 'serverTime') {
    if (raw == null || raw === '') return (typeof F !== 'undefined' && F.dtm) ? F.dtm(null) : '待记录';
    return (typeof F !== 'undefined' && F.dtm) ? F.dtm(raw) : String(raw);
  }
  if (raw == null || raw === '') {
    if (path === 'user.gmBalance' || path === 'user.generationalGm') return '0';
    return '---';
  }
  if (path === 'user.gmBalance' || path === 'user.generationalGm') return Number(raw || 0).toLocaleString('zh-CN');
  if (path === 'user.name') return String(raw);
  return String(raw);
}

function applyUiMapTarget(selector, text) {
  if (!selector || typeof document === 'undefined') return;
  if (selector.charAt(0) === '.' || selector.indexOf(' ') >= 0) {
    document.querySelectorAll(selector).forEach(function (el) { el.textContent = text; });
    return;
  }
  var el = document.getElementById(selector);
  if (el) el.textContent = text;
}

function applyUiMapFromData(data) {
  if (typeof window === 'undefined' || !window.UI_MAP || !data) return;
  Object.entries(window.UI_MAP).forEach(function (entry) {
    var path = entry[0];
    var targets = entry[1];
    var raw = uiMapGetByPath(data, path);
    var text = uiMapFormatValue(path, raw);
    (targets || []).forEach(function (sel) {
      applyUiMapTarget(sel, text);
    });
  });
}
if (typeof window !== 'undefined') window.applyUiMapFromData = applyUiMapFromData;

/** API 回灌前暴力清洗：杜绝 InnerText 残留幽灵样例 */
function clearGhostData() {
  if (typeof document === 'undefined') return;
  var scrub = {
    '.dyn-user-name': '...',
    '.dyn-gm-val': '0',
    '.dyn-gm-balance': '0',
    '.dyn-gm-balance-num': '0',
    '.dyn-wallet-balance': '0',
    '.gm-chip-val': '0',
    '.dyn-gm-month-delta': '0',
    '.dyn-tax-intensity': '0.00',
    '.dyn-carbon-intensity': '0.00',
    '.dyn-generational-income': '0',
    '.dyn-cbam-tax': '0',
    '.dyn-risk-eur': '€ 0',
    '.dyn-val-placeholder': '---'
  };
  Object.keys(scrub).forEach(function (sel) {
    document.querySelectorAll(sel).forEach(function (el) {
      el.textContent = scrub[sel];
    });
  });
  ['id-name', 'sb-uname', 'top-gm', 'H-sb-gm', 'achieve-gm-val', 'rb-ci', 'r-badge-ci', 'rep-tax-exposure', 'total-risk-val'].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    if (id === 'rb-ci' || id === 'r-badge-ci') {
      el.textContent = id === 'r-badge-ci' ? '碳强度 0.00 t/t' : '0.00 t/t';
    } else if (id.indexOf('gm') >= 0 || id === 'top-gm' || id === 'H-sb-gm') {
      el.textContent = '0';
    } else if (id.indexOf('tax') >= 0 || id === 'rep-tax-exposure' || id === 'total-risk-val') {
      el.textContent = id === 'rep-tax-exposure' || id === 'total-risk-val' ? '---' : el.textContent;
    } else {
      el.textContent = '---';
    }
  });
}
if (typeof window !== 'undefined') window.clearGhostData = clearGhostData;

function applyCarbonIntensityFromData(data) {
  if (typeof document === 'undefined' || !data) return;
  var raw = data.raw || data;
  var m = (raw && raw.metrics) || data.metrics || {};
  var ciRaw = m.carbonIntensity != null ? m.carbonIntensity : (m.carbon_intensity != null ? m.carbon_intensity : (raw.impact && raw.impact.carbonIntensity));
  var ci = Number(ciRaw);
  if (!Number.isFinite(ci) || ci < 0) ci = 0;
  var ciStr = ci > 0 ? ci.toFixed(2) : '0.00';
  document.querySelectorAll('.dyn-tax-intensity, .dyn-carbon-intensity').forEach(function (el) {
    if (el.id === 'r-badge-ci') el.textContent = '碳强度 ' + ciStr + ' t/t';
    else if (el.tagName === 'SPAN' && el.classList.contains('dyn-carbon-intensity') && el.parentElement && el.parentElement.id === 'r-badge-ci') return;
    else el.textContent = el.id === 'r-badge-ci' ? '碳强度 ' + ciStr + ' t/t' : ciStr;
  });
  var rb = document.getElementById('rb-ci');
  if (rb && !rb.querySelector('.dyn-carbon-intensity')) rb.textContent = ciStr + ' t/t';
}
if (typeof window !== 'undefined') window.applyCarbonIntensityFromData = applyCarbonIntensityFromData;

if (typeof window !== 'undefined' && !window.CBAM_GLOBAL_BENCHMARKS) {
  window.CBAM_GLOBAL_BENCHMARKS = {
    aluminum: { name: '铝及铝制品', hs: 'CN 7601-7616', def: 11.5, best: 4.8 },
    steel: { name: '钢铁及制品', hs: 'CN 7201-7326', def: 2.4, best: 1.6 },
    cement: { name: '水泥及熟料', hs: 'CN 2523', def: 0.85, best: 0.6 },
    fertilizer: { name: '化肥 (合成氨/尿素)', hs: 'CN 2814/3102', def: 2.2, best: 1.5 },
    hydrogen: { name: '氢气', hs: 'CN 2804', def: 9.8, best: 1.5 },
    electricity: { name: '电力', hs: 'CN 2716', def: 0.58, best: 0.0 }
  };
}

if (typeof window !== 'undefined') {
  window.AppState = window.AppState || {};
  window.AppState.macro = window.AppState.macro || {
    cbam_current_price: 75.36,
    eur_cny_rate: 7.85,
    last_updated: ''
  };
}

function deepMerge(target, source) {
  if (typeof window !== 'undefined' && typeof window.deepMerge === 'function' && window.deepMerge !== deepMerge) {
    return window.deepMerge(target, source);
  }
  if (source == null || typeof source !== 'object' || Array.isArray(source)) return target;
  const MAX_DEPTH = 40;
  function mergeNode(t, s, depth) {
    if (depth > MAX_DEPTH) return Array.isArray(s) ? s.slice() : s;
    if (s == null || typeof s !== 'object') return s;
    if (Array.isArray(s)) return s.slice();
    const base = (t && typeof t === 'object' && !Array.isArray(t)) ? t : {};
    const out = Object.assign({}, base);
    Object.keys(s).forEach(function (k) {
      if (k === '__proto__' || k === 'constructor') return;
      const sv = s[k];
      if (sv === undefined) return;
      const tv = out[k];
      if (sv === null) { out[k] = null; return; }
      if (typeof sv !== 'object') { out[k] = sv; return; }
      if (sv === out || sv === t || sv === s) {
        out[k] = Array.isArray(sv) ? sv.slice() : Object.assign({}, sv);
        return;
      }
      if (Array.isArray(sv)) { out[k] = sv.slice(); return; }
      if (tv === sv) { out[k] = sv; return; }
      out[k] = mergeNode(tv && typeof tv === 'object' && !Array.isArray(tv) ? tv : {}, sv, depth + 1);
    });
    return out;
  }
  const tgt = target && typeof target === 'object' && !Array.isArray(target) ? target : {};
  return mergeNode(tgt, source, 0);
}

function getHubSafeUserName(rawName) {
  const raw = String(rawName || '').trim();
  if (!raw) return '新用户';
  if (raw.indexOf('@') > 0) return raw.split('@')[0] || raw;
  return raw;
}

function isHubRuntimePage() {
  if (typeof window === 'undefined') return false;
  const path = String(window.location.pathname || '');
  return /(?:全域中心|HengAI_Hub)\.html$/i.test(path);
}

function requireHubAuth() {
  if (typeof window === 'undefined') return true;
  const onHubPage = isHubRuntimePage();
  if (!onHubPage) return true;
  const token = localStorage.getItem('hengai_token');
  if (!token) {
    window.location.href = window.hengaiPage('index.html');
    return false;
  }
  return true;
}
if (typeof window !== 'undefined') window.requireHubAuth = requireHubAuth;

function getMacroOracle() {
  if (typeof window === 'undefined') return { cbam_current_price: 75.36, eur_cny_rate: 7.85, last_updated: '' };
  if (!window.AppState) window.AppState = {};
  if (!window.AppState.macro) {
    window.AppState.macro = { cbam_current_price: 75.36, eur_cny_rate: 7.85, last_updated: '' };
  }
  return window.AppState.macro;
}

var API_ROOT = (typeof window !== 'undefined' && typeof window.hengaiApiOrigin === 'function')
  ? window.hengaiApiOrigin()
  : '';
if (!API_ROOT && typeof window !== 'undefined') {
  API_ROOT = 'http://localhost:8000';
  window.API_BASE = API_ROOT;
}
var API_BASE = (API_ROOT || 'http://localhost:8000') + '/api/v1';
const AUTH_API_BASE = API_BASE + '/auth';
if (typeof window !== 'undefined') {
  window.HUB_API_BASE = API_BASE;
  window.AUTH_API_BASE = AUTH_API_BASE;
}

async function apiFetch(endpoint, options = {}) {
  const token = localStorage.getItem('hengai_token') || localStorage.getItem('authToken');
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (token) headers.Authorization = 'Bearer ' + token;
  var ep = String(endpoint || '');
  if (!ep.startsWith('/api/v1/')) {
    ep = ep.startsWith('/') ? '/api/v1' + ep : '/api/v1/' + ep;
  }
  const base = (API_ROOT || 'http://localhost:8000').replace(/\/+$/, '');
  const response = await fetch(base + ep, { ...options, headers });
  if (response.status === 401) {
    localStorage.removeItem('hengai_token');
    localStorage.removeItem('authToken');
    window.location.href = window.hengaiPage('index.html');
    throw new Error('认证已过期，请重新登录');
  }
  if (!response.ok) {
    let err = {};
    try { err = await response.json(); } catch (e) {}
    const detailRaw = err && (err.detail || err.message || err.error);
    const detail = typeof detailRaw === 'string' ? detailRaw : JSON.stringify(detailRaw || '网络请求异常');
    if (response.status === 404) throw new Error('404 接口未找到，请检查后端路由');
    throw new Error(detail);
  }
  if (response.status === 204) return null;
  return response.json();
}
if (typeof window !== 'undefined') window.apiFetch = apiFetch;

async function uploadAndParseBill(file) {
  const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  const isAllowed = !!file && (allowedTypes.includes((file.type || '').toLowerCase()) || /\.(pdf|png|jpe?g|webp)$/i.test(file.name || ''));
  if (!isAllowed) {
    throw new Error('仅支持 PDF、PNG、JPG、JPEG、WEBP 格式凭证');
  }
  const token = localStorage.getItem('hengai_token') || localStorage.getItem('authToken') || '';
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(API_BASE + '/assets/parse-bill', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token },
    body: formData
  });
  let result = null;
  try {
    result = await response.json();
  } catch (e) {
    throw new Error('解析服务返回非 JSON 数据');
  }
  if (!response.ok) {
    const msg = (result && (result.message || result.detail || result.error)) || '票据解析失败';
    throw new Error(msg);
  }
  return result;
}
if (typeof window !== 'undefined') window.uploadAndParseBill = uploadAndParseBill;

async function fetchGlobalHubData() {
  try {
    return await apiFetch('/api/v1/hub/overview', { method: 'GET' });
  } catch (e) {
    console.error('全域中心数据拉取失败', e);
    return null;
  }
}
if (typeof window !== 'undefined') window.fetchGlobalHubData = fetchGlobalHubData;

function hubJsPhaseMetaToNum(pm) {
  const cp = pm && (pm.current_phase || pm.currentPhase);
  if (cp === 'Phase2' || cp === 'phase2') return 2;
  if (cp === 'Phase3' || cp === 'phase3') return 3;
  return 1;
}

function hubJsFormatLevelDisplay(levRaw) {
  if (levRaw === undefined || levRaw === null || levRaw === '') return '未激活';
  if (typeof levRaw === 'string') {
    const s = String(levRaw).trim();
    if (/lv\.?\s*\d/i.test(s) || /架构师|观察员|生态|专家|践行/.test(s)) return s;
  }
  const n = Number(levRaw);
  if (!Number.isFinite(n) || n <= 0) return '未激活';
  const ti = Math.min(5, Math.max(1, Math.floor(n)));
  const titles = { 1: '观察员', 2: '践行者', 3: '架构师', 4: '专家', 5: '生态领袖' };
  return 'Lv.' + ti + ' ' + (titles[ti] || '');
}

function hubJsDeriveTier(pm, company, impact) {
  const label = pm && (pm.phase_label || pm.phaseLabel);
  if (label) return label;
  const stage = company && (company.stage || company.stageName);
  if (stage && String(stage).toLowerCase().includes('certified')) return '企业官方金库 · 已认证';
  if (company && company.name) return '个人会员 · 企业档案已建立';
  const risk = impact && (impact.riskExposureEur != null ? impact.riskExposureEur : impact.risk_exposure_eur);
  const tco = impact && (impact.tCO2eTotal != null ? impact.tCO2eTotal : impact.tco2e_total);
  if ((risk != null && Number(risk) > 0) || (tco != null && Number(tco) > 0)) return '个人会员 · 测算已激活';
  return '个人会员 · 未激活';
}

function hubJsFormatEurRisk(riskNum) {
  if (riskNum == null || !Number.isFinite(Number(riskNum)) || Number(riskNum) <= 0) return '待测算';
  return '€ ' + Math.round(Number(riskNum)).toLocaleString('en-US');
}

function hubJsFormatEurCompact(riskNum) {
  if (riskNum == null || !Number.isFinite(Number(riskNum)) || Number(riskNum) <= 0) return '待测算';
  const n = Number(riskNum);
  if (n >= 1000) return '€' + Math.round(n / 1000) + 'k';
  return '€ ' + Math.round(n).toLocaleString('en-US');
}

function normalizeHubOverviewPayload(raw) {
  const r = raw || {};
  const user = r.user || {};
  const company = r.company || {};
  const impact = r.impact || {};
  const pm = r.phaseMeta || r.phase_meta || {};

  let gmBalance = Number(user.gmBalance != null ? user.gmBalance : user.gm_balance != null ? user.gm_balance : 0);
  if (!Number.isFinite(gmBalance)) gmBalance = 0;

  const tcoRaw = impact.tCO2eTotal != null ? impact.tCO2eTotal : impact.tco2e_total;
  let tCO2e_total = tcoRaw != null && tcoRaw !== '' ? Number(tcoRaw) : 0;
  if (!Number.isFinite(tCO2e_total)) tCO2e_total = 0;

  const scopeRaw = impact.scope3Coverage != null ? impact.scope3Coverage : impact.scope3_coverage;
  let scope3Rate = 0;
  if (scopeRaw != null && scopeRaw !== '') {
    const sx = Number(scopeRaw);
    if (Number.isFinite(sx)) {
      scope3Rate = sx <= 1 && sx >= 0 ? Math.round(sx * 1000) / 10 : Math.round(sx * 10) / 10;
    }
  }

  const riskRaw = impact.riskExposureEur != null ? impact.riskExposureEur : impact.risk_exposure_eur;
  let riskNum = riskRaw != null && riskRaw !== '' ? Number(riskRaw) : NaN;
  if (!Number.isFinite(riskNum)) riskNum = null;

  const levRaw = user.currentLevel != null ? user.currentLevel : user.current_level;
  const currentLevel = hubJsFormatLevelDisplay(levRaw);
  const tier = hubJsDeriveTier(pm, company, impact);
  const phase = hubJsPhaseMetaToNum(pm);
  const companyName = String(company.name || company.company_name || '').trim();

  return {
    phase,
    user: {
      gmBalance,
      tCO2e_total,
      currentLevel,
      tier,
      name: user.name || ''
    },
    company: {
      name: companyName || '待完善企业档案',
      cbamRisk: hubJsFormatEurRisk(riskNum),
      cbamRiskCompact: hubJsFormatEurCompact(riskNum),
      scope3Rate,
      rawRiskNum: riskNum
    },
    raw: r
  };
}
if (typeof window !== 'undefined') window.normalizeHubOverviewPayload = normalizeHubOverviewPayload;

function applyRealData(data) {
  if (typeof window === 'undefined' || !data || !data.user) return;
  if (typeof window.hubOverviewUserMatchesCurrent === 'function' && !window.hubOverviewUserMatchesCurrent(data)) {
    console.warn('[applyRealData] 忽略与当前 JWT 不一致的 overview 快照');
    return;
  }
  if (typeof window.clearGhostData === 'function') window.clearGhostData();
  window.__hubOverviewData = data;

  applyUiMapFromData(data);
  if (typeof window.applyCarbonIntensityFromData === 'function') window.applyCarbonIntensityFromData(data);

  const u = data.user;
  const co = data.company || {};
  const raw = data.raw || {};
  const impact = raw.impact || {};
  const reports = raw.recentReports || raw.recent_reports || [];
  const suppliers = raw.supplierNodes || raw.supplier_nodes || [];
  const name = String(u.name || '新用户');
  const avatar = name.replace(/\s/g, '').slice(0, 2).toUpperCase() || '新';
  const gmStr = Number(u.gmBalance || 0).toLocaleString();
  const tcoNum = Number(u.tCO2e_total || 0);
  const tcoStr = tcoNum.toLocaleString(undefined, { maximumFractionDigits: 2 });
  const scopePct = co.scope3Rate != null ? Number(co.scope3Rate) : 0;
  const scopeStr = (Number.isFinite(scopePct) ? scopePct : 0) + '%';
  const riskFull = co.cbamRisk || '待测算';
  const riskK = co.cbamRiskCompact || '待测算';
  const scopeColor = scopePct > 0 ? 'var(--red)' : 'var(--green-l)';
  const riskColor = riskFull === '待测算' ? 'var(--gold-l)' : 'var(--red)';

  // --- zero-hardcode dynamic nodes (批量广播到全场“dyn-*”传感器) ---
  const companyName = String(co.name || '待完善企业档案');
  const creditCode = String((co.creditCode || co.credit_code || (raw.company && (raw.company.creditCode || raw.company.credit_code)) || '')).trim();
  const stageLabel = String((co.stageLabel || co.stage_label || co.stage || (raw.company && (raw.company.stage || raw.company.stageName)) || '')).trim() || '待测算';
  const supTotal = Array.isArray(suppliers) ? suppliers.length : 0;
  const supDone = Array.isArray(suppliers)
    ? suppliers.filter(s => ['submitted', 'confirmed'].includes(String((s && (s.status || s.supplierStatus)) || '').toLowerCase())).length
    : 0;
  const supPending = Array.isArray(suppliers)
    ? suppliers.filter(s => ['invited', 'pending'].includes(String((s && (s.status || s.supplierStatus)) || '').toLowerCase())).length
    : 0;
  const supPctDyn = Number.isFinite(scopePct) && scopePct > 0 ? (scopePct + '%') : '待测算';
  var fin = (typeof window.computeRepFinancials === 'function' && window.AppState)
    ? window.computeRepFinancials(window.AppState)
    : null;
  const repTaxText = fin ? fin.riskDisplay : (riskFull || '待测算');
  const repRoiText = fin ? fin.roiDisplay : (String((co.roiRatio || co.roi_ratio || '')).trim() || '待测算');
  const repSaveText = fin ? fin.netSavingsDisplay : (String((co.netSavings || co.net_savings || '')).trim() || '待测算');
  const regRaw = raw && raw.user && (raw.user.createdAt || raw.user.created_at);
  const regDate = regRaw ? String(regRaw).slice(0, 10) : '—';
  const globalRank = (raw.metrics && raw.metrics.globalRank != null) ? ('#' + String(raw.metrics.globalRank)) : '—';
  const customsLevel = String((raw.company && (raw.company.customsLevel || raw.company.customs_level)) || '').trim() || '—';
  const creditLimitText = String((raw.company && (raw.company.creditLimit || raw.company.credit_limit)) || '').trim() || '—';
  const interestSaveText = String((raw.company && (raw.company.interestSave || raw.company.interest_save)) || '').trim() || '—';

  document.querySelectorAll('.dyn-user-name').forEach(function (el) { el.textContent = name; });
  document.querySelectorAll('.dyn-user-avatar').forEach(function (el) { el.textContent = avatar; });
  document.querySelectorAll('.dyn-gm-balance').forEach(function (el) { el.textContent = gmStr; });
  document.querySelectorAll('.dyn-co2-total').forEach(function (el) { el.textContent = tcoStr; });
  document.querySelectorAll('.dyn-user-reg-date').forEach(function (el) { el.textContent = regDate || '—'; });
  document.querySelectorAll('.dyn-company-name').forEach(function (el) { el.textContent = companyName; });
  document.querySelectorAll('.dyn-gm-month-delta').forEach(function (el) { el.textContent = '0'; });
  document.querySelectorAll('.dyn-ent-name').forEach(function (el) { el.textContent = companyName || '未录入'; });
  document.querySelectorAll('.dyn-ent-code').forEach(function (el) { el.textContent = creditCode || '未录入'; });
  document.querySelectorAll('.dyn-ent-stage-label').forEach(function (el) { el.textContent = stageLabel || '待测算'; });
  document.querySelectorAll('.dyn-sup-pct').forEach(function (el) { el.textContent = supPctDyn; });
  document.querySelectorAll('.dyn-sup-count').forEach(function (el) { el.textContent = String(supDone); });
  document.querySelectorAll('.dyn-sup-total').forEach(function (el) { el.textContent = String(supTotal); });
  document.querySelectorAll('.dyn-sup-pending').forEach(function (el) { el.textContent = String(supPending); });
  document.querySelectorAll('.dyn-rep-tax').forEach(function (el) { el.textContent = repTaxText; });
  document.querySelectorAll('.dyn-rep-roi').forEach(function (el) { el.textContent = repRoiText; });
  document.querySelectorAll('.dyn-rep-save').forEach(function (el) { el.textContent = repSaveText; });
  document.querySelectorAll('.dyn-sup-sample-name').forEach(function (el) { el.textContent = '核心一级供应商'; });
  document.querySelectorAll('.dyn-total-co2').forEach(function (el) { el.textContent = tcoStr; });
  document.querySelectorAll('.dyn-gm-val').forEach(function (el) { el.textContent = gmStr; });
  document.querySelectorAll('.dyn-global-rank').forEach(function (el) { el.textContent = globalRank; });
  document.querySelectorAll('.dyn-credit-limit').forEach(function (el) { el.textContent = creditLimitText; });
  document.querySelectorAll('.dyn-interest-save').forEach(function (el) { el.textContent = interestSaveText; });
  document.querySelectorAll('.dyn-customs-level').forEach(function (el) { el.textContent = customsLevel; });

  document.querySelectorAll('#top-gm, #H-sb-gm, .gm-chip-val').forEach(function (el) {
    el.textContent = gmStr;
  });
  ['reset-account'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.textContent = name;
  });
  ['H-uav', 'achieve-avatar', 'achieve-avatar-initials'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.textContent = avatar;
  });

  const overlay = document.getElementById('co2lion-hub-overlay');
  if (overlay) {
    const ovGm = overlay.querySelector('.gm-val-big');
    if (ovGm) {
      ovGm.innerHTML =
        gmStr +
        ' <span style="font-size:14px;color:var(--ink2);font-weight:400">GM</span>';
    }
    const alarms = overlay.querySelectorAll('.alarm-val');
    alarms.forEach(function (el) {
      el.textContent = riskFull;
      el.style.color = riskColor;
    });
    const covRing = overlay.querySelector('.coverage-ring svg circle:last-of-type');
    if (covRing && typeof covRing.setAttribute === 'function') {
      const C = 2 * Math.PI * 32;
      const p = Math.max(0, Math.min(100, Number(scopePct) || 0));
      covRing.setAttribute('stroke-dasharray', C * p / 100 + ' ' + C * (1 - p / 100));
      covRing.setAttribute('stroke', p > 0 ? 'var(--red)' : 'var(--green-l)');
    }
    overlay.querySelectorAll('.coverage-pct').forEach(function (el) {
      el.textContent = scopeStr;
      el.style.color = scopeColor;
    });
    const roiVals = overlay.querySelectorAll('.roi-val');
    if (roiVals.length) {
      roiVals[0].textContent = riskK;
      roiVals[0].style.color = riskK === '待测算' ? 'var(--ink3)' : 'var(--red)';
    }
    overlay.querySelectorAll('.report-title').forEach(function (el) {
      el.textContent = (co.name || '待完善企业档案') + ' · 全域碳合规诊断报告 v0.2';
    });
    overlay.querySelectorAll('.bdg-r').forEach(function (el) {
      if (el.textContent && el.textContent.indexOf('覆盖率') >= 0) {
        el.textContent = scopePct > 0 ? '覆盖率 ' + scopeStr : '覆盖率 待测算';
      }
    });
    overlay.querySelectorAll('.ent-name').forEach(function (el) {
      el.textContent = co.name || '待完善企业档案';
    });
  }

  const pmCo2 = document.getElementById('pm-co2');
  if (pmCo2) {
    pmCo2.innerHTML =
      tcoStr +
      ' <span class="metric-unit">tCO₂e</span> <span class="magic-trigger-co2" onclick="openEarthLedger()">🔗 链上存证 可核验</span>';
    pmCo2.style.color = tcoNum > 0 ? 'var(--teal-l)' : 'var(--ink3)';
  }

  const pmGm = document.getElementById('pm-gm');
  if (pmGm) {
    pmGm.innerHTML =
      gmStr +
      ' <span class="metric-unit" style="font-size:13px">GM</span> <span class="magic-trigger-gm" onclick="openProtocol()">✨ 解析绿印法则</span>';
  }

  const fCompany = document.getElementById('f-company');
  if (fCompany && co.name) fCompany.value = co.name;

  const riskRaw = impact.riskExposureEur != null ? impact.riskExposureEur : impact.risk_exposure_eur;
  const riskNum = Number(riskRaw);
  let walletAddress = '#WL-TEMP';
  if (u.email) {
    const local = String(u.email).split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10) || 'USER';
    walletAddress = '#WL-' + local + '-E87D\n-B4F2-9A1C';
  }

  const walletHash = String(walletAddress || '#WL-TEMP').split('\n').slice(-1)[0] || '#WL-TEMP';
  document.querySelectorAll('.dyn-wallet-hash').forEach(function (el) { el.textContent = walletHash; });

  const supFunnel = document.getElementById('sup-funnel-complete');
  if (supFunnel) {
    const pct = supTotal > 0 ? Math.max(0, Math.min(100, (supDone / supTotal) * 100)) : 0;
    supFunnel.style.width = pct + '%';
  }
  if (typeof window.applyRepFinancialsToDom === 'function' && window.AppState) {
    try { window.applyRepFinancialsToDom(window.AppState); } catch (finErr) {
      console.warn('[app.js] applyRepFinancialsToDom', finErr);
    }
  }
  /* iframe 广播由全域中心 applyRealData / broadcastHubPipelineToEmbeds 统一调度，此处不再重复 postMessage */
}
if (typeof window !== 'undefined') window.applyRealData = applyRealData;

function applyHubIdentityBindings() {
  if (typeof window === 'undefined' || !window.AppState || !window.AppState.user) return;
  const user = window.AppState.user;
  const userName = getHubSafeUserName(user.name || user.email);
  const gmBalance = Number(user.gmBalance ?? user.gm_balance ?? 0);
  const gmText = gmBalance.toLocaleString();
  const levelText =
    user.currentLevel || hubJsFormatLevelDisplay(user.current_level);
  const tierText = user.tier || '个人会员 · 未激活';
  const regDate = user.regDate || user.reg_date || '--';
  const avatar = (userName || 'H').slice(0, 2).toUpperCase();

  document.querySelectorAll('#id-name, #sb-uname').forEach(function (el) {
    el.textContent = userName;
  });
  document.querySelectorAll('#id-avatar, #sb-avatar').forEach(function (el) {
    if (el.id === 'id-avatar' && el.firstChild) {
      el.firstChild.nodeValue = avatar;
    } else {
      el.textContent = avatar;
    }
  });
  document.querySelectorAll('#top-gm, #H-sb-gm, .gm-chip-val').forEach(function (el) {
    el.textContent = gmText;
  });
  const idMeta = document.getElementById('id-meta');
  if (idMeta) idMeta.textContent = '注册于 ' + regDate;
  const userMeta = document.getElementById('user-meta');
  if (userMeta) userMeta.textContent = tierText;

  const tagsEl = document.getElementById('id-tags');
  if (tagsEl && levelText) {
    const firstPill = tagsEl.querySelector('.id-tag, .pill');
    if (firstPill) firstPill.textContent = levelText;
  }
}

function applyHubPanelMetrics() {
  if (typeof window === 'undefined' || !window.AppState || !window.AppState.hub) return;
  const hub = window.AppState.hub;
  const metrics = hub.metrics || hub.overview_metrics || {};
  const impact = hub.impact || {};
  const carbonIntensity =
    metrics.carbon_intensity ??
    metrics.carbonIntensity ??
    (hub.enterprise && (hub.enterprise.carbon_intensity ?? hub.enterprise.carbonIntensity));
  let supplyCoverage =
    metrics.supply_coverage ??
    metrics.supplyCoverage ??
    (hub.supply && (hub.supply.coverage ?? hub.supply.coverage_rate));
  let totalReduction =
    metrics.total_reduction_tco2e ??
    metrics.totalReductionTco2e ??
    metrics.total_reduction ??
    metrics.totalReduction;

  const scopeRaw = impact.scope3Coverage ?? impact.scope3_coverage;
  if (supplyCoverage == null && scopeRaw != null) {
    const sx = Number(scopeRaw);
    supplyCoverage = Number.isFinite(sx) ? (sx <= 1 ? sx * 100 : sx) : supplyCoverage;
  }
  const tcoImpact = impact.tCO2eTotal ?? impact.tco2e_total;
  if (totalReduction == null && tcoImpact != null) totalReduction = tcoImpact;

  const setText = function (selector, val, suffix) {
    if (val === undefined || val === null || Number.isNaN(Number(val))) return;
    const txt = Number(val).toLocaleString(undefined, { maximumFractionDigits: 2 }) + (suffix || '');
    document.querySelectorAll(selector).forEach(function (el) {
      el.textContent = txt;
    });
  };

  setText('[data-hub-field="carbon-intensity"]', carbonIntensity, ' tCO₂e/t');
  setText('[data-hub-field="supply-coverage"]', supplyCoverage, '%');
  setText('[data-hub-field="total-reduction"]', totalReduction, ' tCO₂e');
}

async function fetchHubData() {
  if (typeof window === 'undefined') return null;
  if (!window.AppState.flags) window.AppState.flags = {};
  window.AppState.flags.hubOverviewReady = false;
  try {
    if (typeof window.updateHubSyncGate === 'function') window.updateHubSyncGate(window.AppState);
  } catch (_) {}
  try {
  const response = await fetchGlobalHubData();
  if (!response) {
    try {
      if (typeof window.updateHubSyncGate === 'function') window.updateHubSyncGate(window.AppState);
    } catch (_) {}
    return null;
  }
  const payload = response.data || response.hub || response;
  if (typeof window.hubOverviewUserMatchesCurrent === 'function' && !window.hubOverviewUserMatchesCurrent(payload)) {
    console.warn('[fetchHubData] overview user 与 JWT 不一致，丢弃防串号');
    return null;
  }
  const userRaw = payload.user || {};
  const normalized = normalizeHubOverviewPayload(payload);
  window.__hubOverviewData = normalized;

  const liveSanitized = typeof window.sanitizeOverviewPayload === 'function'
    ? window.sanitizeOverviewPayload(payload)
    : payload;
  if (typeof window.replaceAuthoritativeAppStateFromLive === 'function') {
    window.replaceAuthoritativeAppStateFromLive(liveSanitized);
  } else {
    Object.assign(window.AppState, deepMerge(window.AppState || {}, liveSanitized));
  }
  window.AppState.currentPhase = normalized.phase >= 1 && normalized.phase <= 3 ? normalized.phase : 1;
  if (!window.AppState.user) window.AppState.user = {};
  window.AppState.user.name = getHubSafeUserName(userRaw.name || userRaw.email || userRaw.username);
  window.AppState.user.gmBalance = normalized.user.gmBalance;
  window.AppState.user.tCO2e_total = normalized.user.tCO2e_total;
  window.AppState.user.currentLevel = normalized.user.currentLevel;
  window.AppState.user.tier = normalized.user.tier;
  window.AppState.user.email = userRaw.email || window.AppState.user.email || '';
  const ca = userRaw.created_at || userRaw.createdAt || userRaw.reg_date || userRaw.regDate;
  if (ca) window.AppState.user.regDate = ca;
  if (!window.AppState.company) window.AppState.company = {};
  if (normalized.company && normalized.company.name) window.AppState.company.name = normalized.company.name;
  window.AppState.hub = payload;
  if (!window.AppState.flags) window.AppState.flags = {};
  window.AppState.flags.hubOverviewReady = true;
  applyHubIdentityBindings();
  try {
    if (typeof window.setPhase === 'function') {
      var cp = (window.AppState.flags && window.AppState.flags.currentPhase) || window.AppState.currentPhase;
      var phaseNum = 1;
      if (typeof cp === 'string') {
        var pm = /Phase\s*(\d)/i.exec(cp);
        if (pm) phaseNum = parseInt(pm[1], 10);
      } else if (Number.isFinite(Number(cp))) {
        phaseNum = Number(cp);
      }
      if (phaseNum >= 1 && phaseNum <= 3) window.setPhase(phaseNum);
    }
  } catch (phaseErr) {
    console.warn('[Hub] setPhase skipped:', phaseErr);
  }
  applyRealData(normalized);
  applyHubPanelMetrics();
  try { if (typeof window.updateHubSyncGate === 'function') window.updateHubSyncGate(window.AppState); } catch (_) {}
  try { if (typeof window.syncAppState === 'function') window.syncAppState(); } catch (_) {}
  return payload;
  } catch (hubErr) {
    console.error('[Hub] fetchHubData 失败', hubErr);
    return null;
  } finally {
    if (typeof window.dismissHubLoadingOverlay === 'function') window.dismissHubLoadingOverlay();
    else if (typeof window.showHubLoading === 'function') window.showHubLoading(false);
  }
}
if (typeof window !== 'undefined') window.fetchHubData = fetchHubData;

async function initGlobalHub() {
  try {
    return await fetchHubData();
  } catch (e) {
    console.error('[Hub] initGlobalHub 失败', e);
    return null;
  } finally {
    if (typeof window.dismissHubLoadingOverlay === 'function') window.dismissHubLoadingOverlay();
  }
}
if (typeof window !== 'undefined') window.initGlobalHub = initGlobalHub;

function openEnterpriseProfileDrawer() {
  const mask = document.getElementById('enterprise-profile-drawer-mask');
  const drawer = document.getElementById('enterprise-profile-drawer');
  if (!mask || !drawer) return;
  const company = (window.AppState && window.AppState.company) || {};
  const nameEl = document.getElementById('input-ent-name');
  const codeEl = document.getElementById('input-ent-code');
  const industryEl = document.getElementById('input-ent-industry');
  if (nameEl) nameEl.value = company.name || '';
  if (codeEl) codeEl.value = company.creditCode || company.credit_code || '';
  if (industryEl) {
    const raw = String(company.industryCode || company.industry_code || '').toLowerCase();
    const candidates = ['steel', 'cement', 'petro', 'paper', 'aviation', 'ceramic', 'port', 'idc',
      'aluminum', 'fertilizer', 'electricity', 'hydrogen', 'other'];
    industryEl.value = candidates.includes(raw) ? raw : 'steel';
  }
  const regionEl = document.getElementById('input-ent-region');
  if (regionEl) {
    const rt = String(company.regionTag || company.region_tag || '').toLowerCase();
    regionEl.value = rt || '';
  }
  mask.style.display = 'block';
  requestAnimationFrame(function () {
    mask.style.opacity = '1';
    drawer.style.transform = 'translateX(0)';
  });
}

function closeEnterpriseProfileDrawer() {
  const mask = document.getElementById('enterprise-profile-drawer-mask');
  const drawer = document.getElementById('enterprise-profile-drawer');
  if (!mask || !drawer) return;
  mask.style.opacity = '0';
  drawer.style.transform = 'translateX(100%)';
  setTimeout(function () {
    mask.style.display = 'none';
  }, 220);
}

async function saveEnterpriseProfile() {
  const nameEl = document.getElementById('input-ent-name');
  const codeEl = document.getElementById('input-ent-code');
  const industryEl = document.getElementById('input-ent-industry');
  const submitBtn = document.getElementById('enterprise-save-btn');
  if (!nameEl || !codeEl || !industryEl) return;
  const pick = function (id) {
    const el = document.getElementById(id);
    if (!el) return undefined;
    const v = String(el.value || '').trim();
    return v === '' ? undefined : v;
  };
  const pickNum = function (id) {
    const el = document.getElementById(id);
    if (!el || el.value === '' || el.value == null) return undefined;
    const n = Number(el.value);
    return Number.isFinite(n) ? n : undefined;
  };
  const payload = {
    name: String(nameEl.value || '').trim(),
    industryCode: String(industryEl.value || '').trim(),
    creditCode: String(codeEl.value || '').trim()
  };
  const mp = pick('input-ent-product');
  const hs = pick('input-ent-hs');
  const ec = pick('input-ent-export-countries');
  const pg = pick('input-ent-grid');
  const em = pick('input-ent-email');
  const rg = pick('input-ent-region');
  if (mp !== undefined) payload.mainProduct = mp;
  if (hs !== undefined) payload.hsCode = hs;
  if (ec !== undefined) payload.exportCountries = ec;
  if (pg !== undefined) payload.powerGrid = pg;
  if (em !== undefined) payload.contactEmail = em;
  if (rg !== undefined) payload.regionTag = rg;
  const cap = pickNum('input-ent-capacity');
  const exv = pickNum('input-ent-export-volume');
  const pwr = pickNum('input-ent-power-kwh');
  if (cap !== undefined) payload.annualCapacityTons = cap;
  if (exv !== undefined) payload.annualExportTons = exv;
  if (pwr !== undefined) payload.annualPowerKwh = pwr;
  if (!payload.name) {
    nameEl.focus();
    return;
  }
  if (submitBtn) submitBtn.disabled = true;
  try {
    if (typeof window.AppState !== 'undefined' && typeof window.AppState.commit === 'function') {
      await window.AppState.commit('enterprise', payload);
    } else {
      await apiFetch('/api/v1/hub/workspace-update', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (typeof initGlobalHub === 'function') {
        await initGlobalHub();
      } else if (typeof fetchHubData === 'function') {
        await fetchHubData();
      }
    }
    closeEnterpriseProfileDrawer();
    if (typeof setPhase === 'function' && window.AppState && window.AppState.flags && window.AppState.flags.currentPhase) {
      var phs = String(window.AppState.flags.currentPhase);
      var m = /Phase\s*(\d)/i.exec(phs);
      if (m) setPhase(parseInt(m[1], 10));
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}
if (typeof window !== 'undefined') {
  window.openEnterpriseProfileDrawer = openEnterpriseProfileDrawer;
  window.closeEnterpriseProfileDrawer = closeEnterpriseProfileDrawer;
  window.saveEnterpriseProfile = saveEnterpriseProfile;
  if (window.AppState && typeof window.AppState.saveData === 'function') {
    window.saveData = window.AppState.saveData.bind(window.AppState);
  }
}

/** index.html 内嵌 Hub 浮层专用；全域中心.html 使用 window.PHASE（在页面内单独声明） */
var INDEX_HUB_PHASE = 1;
const STATE = {
  1: {
    gm: 0,
    phaseName: '个体启蒙期',
    phaseBadge: '阶段一 · 个体启蒙',
    phaseClass: 'pb-p1',
    phaseDot: '#3b9e4a',
    phaseStripClass: 'p1',
    shieldColor: 'var(--green)',
    shieldLevel: '1',
    shieldLabel: 'Lv.1',
    shieldStroke: '#3b9e4a',
    shieldFill: 'rgba(59,158,74,0.12)',
    userMeta: '个人会员 · 月付',
    tags: [
      {text:'Lv.1 观察员', style:'background:var(--green-d);color:var(--green-l);border:1px solid rgba(59,158,74,0.3)'},
      {text:'CBAM 合规学习者', style:'background:rgba(255,255,255,0.05);color:var(--ink2);border:1px solid var(--border)'},
    ],
    navLocked: ['n-origin-audit','nav-supply','nav-report','nav-decision','nav-eco','nav-honor','nav-eu','nav-dld','nav-acf'],
    upgradeBtn: '升级企业账户',
  },
  2: {
    gm: 0,
    phaseName: '业务映射期',
    phaseBadge: '阶段二 · 业务映射',
    phaseClass: 'pb-p2',
    phaseDot: '#c9a84c',
    phaseStripClass: 'p2',
    shieldColor: 'var(--gold)',
    shieldLevel: '3',
    shieldLabel: 'Lv.3',
    shieldStroke: '#c9a84c',
    shieldFill: 'rgba(201,168,76,0.12)',
    userMeta: '个人会员 · 年付',
    tags: [
      {text:'Lv.3 架构师', style:'background:var(--gold-d);color:var(--gold-l);border:1px solid rgba(201,168,76,0.3)'},
      {text:'CBAM 合规专家', style:'background:var(--green-d);color:var(--green-l);border:1px solid rgba(59,158,74,0.3)'},
      {text:'Scope 3 穿透中', style:'background:var(--blue-d);color:var(--blue-l);border:1px solid rgba(24,95,165,0.3)'},
    ],
    navLocked: ['n-origin-audit','nav-eco','nav-honor','nav-eu','nav-dld','nav-acf'],
    upgradeBtn: '申请企业升级',
  },
  3: {
    gm: 0,
    phaseName: '全域共治期',
    phaseBadge: '阶段三 · 全域共治',
    phaseClass: 'pb-p3',
    phaseDot: '#7f77dd',
    phaseStripClass: 'p3',
    shieldColor: 'var(--purple-l)',
    shieldLevel: '5',
    shieldLabel: 'Lv.5',
    shieldStroke: '#7f77dd',
    shieldFill: 'rgba(127,119,221,0.12)',
    userMeta: '企业账户 · 旗舰版',
    tags: [
      {text:'Lv.5 生态领袖', style:'background:var(--purple-d);color:var(--purple-l);border:1px solid rgba(127,119,221,0.3)'},
      {text:'地球公民勋章', style:'background:var(--gold-d);color:var(--gold-l);border:1px solid rgba(201,168,76,0.3)'},
      {text:'Global Eco-Advisor', style:'background:var(--teal-d);color:var(--teal-l);border:1px solid rgba(29,158,117,0.3)'},
    ],
    navLocked: [],
    upgradeBtn: '全域枢纽已激活',
  },
};

// ═══════════════════════════════════════════════════════
// PHASE CONTENT GENERATORS
// ═══════════════════════════════════════════════════════

function renderPhase1() {
  return `
  <div class="g12 mb-14">
    <!-- GM Card -->
    <div class="gm-card">
      <div class="sec-head"><div class="sec-title">GreenMark 绿印资产</div><span class="bdg-y">本月活跃</span></div>
      <div class="gm-val-big"><span class="dyn-gm-balance-num">0</span> <span style="font-size:14px;color:var(--ink2);font-weight:400">GM</span></div>
      <div class="gm-delta">+<span class="dyn-gm-month-delta">0</span> GM 本月积累</div>
      <div class="gm-bar-track"><div class="gm-bar-fill" style="width:28%"></div></div>
      <div class="gm-bar-label"><span>0</span><span style="color:var(--green-l)">Lv.2 门槛 500 GM</span></div>
      <div class="gm-events" style="margin-top:14px">
        <div class="gm-event">
          <div class="gm-event-left">
            <div class="gm-event-icon" style="background:var(--green-d);border:1px solid rgba(59,158,74,0.3)"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><polyline points="1,6 4,9 11,3" stroke="#7dd98a" stroke-width="1.3" stroke-linecap="round"/></svg></div>
            <div><div class="gm-event-text">注册 + 首次 AI 问答</div><div class="gm-event-sub"><span data-state-bind="user.regDate" data-state-fmt="md" data-empty="---">---</span></div></div>
          </div>
          <span class="gm-event-val" style="color:var(--green-l)">---</span>
        </div>
        <div class="gm-event">
          <div class="gm-event-left">
            <div class="gm-event-icon" style="background:var(--blue-d);border:1px solid rgba(24,95,165,0.3)"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="6" r="4.5" stroke="#93c5fd" stroke-width="1"/><line x1="6" y1="3.5" x2="6" y2="6" stroke="#93c5fd" stroke-width="1"/><circle cx="6" cy="7.5" r="0.6" fill="#93c5fd"/></svg></div>
            <div><div class="gm-event-text">付费成为月度会员</div><div class="gm-event-sub">---</div></div>
          </div>
          <span class="gm-event-val" style="color:var(--blue-l)">---</span>
        </div>
        <div class="gm-event">
          <div class="gm-event-left">
            <div class="gm-event-icon" style="background:var(--gold-d);border:1px solid rgba(201,168,76,0.3)"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1.5L7.2 4.8L10.5 5.2L8.2 7.5L8.8 10.5L6 9L3.2 10.5L3.8 7.5L1.5 5.2L4.8 4.8L6 1.5Z" stroke="#c9a84c" stroke-width="1"/></svg></div>
            <div><div class="gm-event-text">完成 CBAM 粗测算</div><div class="gm-event-sub">---</div></div>
          </div>
          <span class="gm-event-val" style="color:var(--gold-l)">---</span>
        </div>
      </div>
    </div>

    <!-- Right column: AI callout + next steps -->
    <div class="gap-14">
      <div class="insight insight-teal">
        <svg width="15" height="15" viewBox="0 0 15 15" fill="none" style="flex-shrink:0;margin-top:1px"><circle cx="7.5" cy="7.5" r="6.5" stroke="var(--teal-l)" stroke-width="1"/><line x1="7.5" y1="4.5" x2="7.5" y2="7.5" stroke="var(--teal-l)" stroke-width="1.1"/><circle cx="7.5" cy="9.5" r="0.7" fill="var(--teal-l)"/></svg>
        <div><strong style="color:var(--teal-l)">HengAI 提示：</strong>您已完成粗测，发现供应链数据黑盒是主要风险。建立企业档案后，系统可为您生成精确的碳税敞口诊断。</div>
      </div>
      <div class="card">
        <div class="sec-title" style="font-size:10px;color:var(--ink3);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px">下一步行动</div>
        <div class="steps">
          <div class="step">
            <div class="step-dot step-done" style="top:0"><svg width="11" height="9" viewBox="0 0 11 9" fill="none"><polyline points="1,4.5 4,7.5 10,1.5" stroke="#7dd98a" stroke-width="1.3" stroke-linecap="round"/></svg></div>
            <div><div class="step-title">完成注册 · 首次 AI 问答</div><div class="step-desc">初次接触 HengAI，感受到知识颠覆感</div></div>
          </div>
          <div class="step">
            <div class="step-dot step-done" style="top:0"><svg width="11" height="9" viewBox="0 0 11 9" fill="none"><polyline points="1,4.5 4,7.5 10,1.5" stroke="#7dd98a" stroke-width="1.3" stroke-linecap="round"/></svg></div>
            <div><div class="step-title">付费月度会员 · CBAM 粗测</div><div class="step-desc">用极低成本解决了工作的第一个拦路虎</div></div>
          </div>
          <div class="step">
            <div class="step-dot step-active" style="top:0"><div style="width:7px;height:7px;background:var(--blue-l);border-radius:50%"></div></div>
            <div><div class="step-title" style="color:var(--blue-l)">建立企业数字档案</div><div class="step-desc">将个人知识转化为企业的合规资产，解锁精确诊断</div></div>
          </div>
          <div class="step" style="padding-bottom:0">
            <div class="step-dot step-lock" style="top:0">4</div>
            <div><div class="step-title" style="color:var(--ink3)">推动供应链数据填报</div><div class="step-desc" style="color:var(--ink3)">Scope 3 覆盖率提升，GM 大幅增加</div></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Enterprise CTA -->
  <div class="card mb-14" style="border-style:dashed;border-color:rgba(255,255,255,0.15);background:rgba(0,0,0,0.2)">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px">
      <div style="display:flex;align-items:flex-start;gap:12px">
        <div style="width:36px;height:36px;border-radius:9px;background:var(--blue-d);border:1px solid rgba(24,95,165,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="4" width="12" height="10" rx="1.5" stroke="#93c5fd" stroke-width="1.1"/><path d="M5 4V3a3 3 0 016 0v1" stroke="#93c5fd" stroke-width="1"/></svg>
        </div>
        <div>
          <div style="font-size:13px;font-weight:600;margin-bottom:3px">建立企业数字档案</div>
          <div style="font-size:11.5px;color:var(--ink2);line-height:1.6">当您准备好将个人的知识转化为企业的资产时，可随时建立企业数字档案——这是解锁精确碳税诊断与供应链协同的关键一步。</div>
        </div>
      </div>
      <button class="topbar-btn primary" style="white-space:nowrap;padding:8px 16px" onclick="window.location.href=window.hengaiPage('HengAI_企业数字档案.html')">立即建立 →</button>
    </div>
  </div>

  <!-- Quick tools -->
  <div class="mb-14">
    <div class="sec-head"><div class="sec-title">快速工具</div></div>
    <div class="action-grid">
      <div class="action-btn" onclick="window.location.href=window.hengaiPage('HengAI_法规知识库.html')">
        <div class="action-btn-icon" style="background:var(--teal-d);border:1px solid rgba(29,158,117,0.3)"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="var(--teal-l)" stroke-width="1"/><line x1="7" y1="4" x2="7" y2="7.5" stroke="var(--teal-l)" stroke-width="1.1"/><circle cx="7" cy="9.5" r="0.7" fill="var(--teal-l)"/></svg></div>
        <div><div class="action-btn-label">法规问答</div><div class="action-btn-sub">AI 智库 · 7 次 / 剩余 93</div></div>
      </div>
      <div class="action-btn" onclick="window.location.href=window.hengaiPage('HengAI_CBAM测算工具.html')">
        <div class="action-btn-icon" style="background:var(--gold-d);border:1px solid rgba(201,168,76,0.3)"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="2" width="10" height="10" rx="1.5" stroke="var(--gold-l)" stroke-width="1"/><line x1="5" y1="7" x2="9" y2="7" stroke="var(--gold-l)" stroke-width="1"/><line x1="7" y1="5" x2="7" y2="9" stroke="var(--gold-l)" stroke-width="1"/></svg></div>
        <div><div class="action-btn-label">单品粗测</div><div class="action-btn-sub">快速估算碳税敞口</div></div>
      </div>
      <div class="action-btn" onclick="window.location.href=window.hengaiPage('HengAI_法规知识库.html')">
        <div class="action-btn-icon" style="background:var(--blue-d);border:1px solid rgba(24,95,165,0.3)"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1.5" width="10" height="11" rx="1.5" stroke="var(--blue-l)" stroke-width="1"/><line x1="4.5" y1="5" x2="9.5" y2="5" stroke="var(--blue-l)" stroke-width="0.9"/><line x1="4.5" y1="7.5" x2="9.5" y2="7.5" stroke="var(--blue-l)" stroke-width="0.9"/><line x1="4.5" y1="10" x2="7" y2="10" stroke="var(--blue-l)" stroke-width="0.9"/></svg></div>
        <div><div class="action-btn-label">知识库</div><div class="action-btn-sub">CBAM · ESG · 绿色贸易</div></div>
      </div>
    </div>
  </div>`;
}

function renderPhase2() {
  return `
  <!-- Alarm + ROI row -->
  <div class="g2 mb-14">
    <div class="alarm-box">
      <div class="alarm-icon"><svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M11 2L20 18H2L11 2Z" stroke="var(--red)" stroke-width="1.5" fill="var(--red-d)"/><line x1="11" y1="8" x2="11" y2="13" stroke="var(--red)" stroke-width="1.3"/><circle cx="11" cy="15.5" r="0.9" fill="var(--red)"/></svg></div>
      <div>
        <div class="alarm-val"><span class="dyn-rep-tax">—</span></div>
        <div class="alarm-label">预计 2026 年 CBAM 碳税敞口</div>
        <div class="alarm-desc" style="margin-top:4px">照妖镜数据 · 基于当前供应链穿透率 12% 核定</div>
      </div>
    </div>
    <div class="card" style="padding:14px 16px">
      <div style="font-size:10px;color:var(--ink3);margin-bottom:10px;text-transform:uppercase;letter-spacing:1px;font-weight:600">三步对冲方案 ROI 预测</div>
      <div class="roi-row">
        <div class="roi-box" style="background:var(--red-d);border:1px solid rgba(226,75,74,0.2)">
          <div class="roi-val" style="color:var(--red)"><span class="dyn-rep-tax">—</span></div>
          <div class="roi-label" style="color:rgba(252,165,165,0.7)">当前敞口</div>
          <div class="roi-note" style="color:rgba(252,165,165,0.5)">未处理</div>
        </div>
        <div class="roi-arrow"><svg width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5h10M11 5l-4-3M11 5l-4 3" stroke="var(--ink3)" stroke-width="1.2" stroke-linecap="round"/></svg></div>
        <div class="roi-box" style="background:rgba(0,0,0,0.25);border:1px solid var(--border)">
          <div class="roi-val" style="color:var(--ink2)">¥ 58k</div>
          <div class="roi-label" style="color:var(--ink3)">方案投入</div>
          <div class="roi-note" style="color:var(--ink3)">MAT+ZCP</div>
        </div>
        <div class="roi-arrow"><svg width="14" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5h10M11 5l-4-3M11 5l-4 3" stroke="var(--ink3)" stroke-width="1.2" stroke-linecap="round"/></svg></div>
        <div class="roi-box" style="background:var(--green-d);border:1px solid rgba(59,158,74,0.2)">
          <div class="roi-val" style="color:var(--green-l)"><span class="dyn-rep-roi">—</span></div>
          <div class="roi-label" style="color:rgba(125,217,138,0.7)">真实 ROI</div>
          <div class="roi-note" style="color:rgba(125,217,138,0.5)">净节税 <span class="dyn-rep-save">—</span></div>
        </div>
      </div>
      <div class="insight insight-gold" style="margin-top:10px;padding:8px 11px;font-size:10.5px">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style="flex-shrink:0"><path d="M6.5 1L12 4.5V10.5L6.5 12L1 10.5V4.5L6.5 1Z" stroke="var(--gold-l)" stroke-width="1" fill="var(--gold-d)"/></svg>
        以当前个人权限，数据诊断已完成。<strong style="color:var(--gold-l)">实质性对冲须启用企业基建</strong>——一键生成《全域升级报告》，由决策层定夺。
      </div>
    </div>
  </div>

  <!-- Supply chain coverage -->
  <div class="g2 mb-14">
    <div class="card">
      <div class="sec-head"><div class="sec-title">供应链穿透状态</div><span class="bdg-r">覆盖率 <span class="dyn-sup-pct">—</span></span></div>
      <div class="coverage-wrap" style="margin-bottom:14px">
        <div class="coverage-ring">
          <svg viewBox="0 0 80 80">
            <circle cx="40" cy="40" r="32" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="7"/>
            <circle cx="40" cy="40" r="32" fill="none" stroke="var(--red)" stroke-width="7"
              stroke-dasharray="${2*3.14159*32*0.12} ${2*3.14159*32*0.88}" stroke-linecap="round"/>
          </svg>
          <div class="coverage-center"><span class="coverage-pct dyn-sup-pct" style="color:var(--red)">待测算</span><span class="coverage-sub">穿透率</span></div>
        </div>
        <div style="flex:1">
          <div style="display:flex;flex-direction:column;gap:7px">
            <div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--ink2)">已填报供应商</span><span style="font-weight:600"><span class="dyn-sup-count">0</span> / <span class="dyn-sup-total">0</span> 家</span></div>
            <div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--ink2)">Scope 3 数据缺口</span><span style="font-weight:600;color:var(--red)">88%</span></div>
            <div style="display:flex;justify-content:space-between;font-size:11.5px"><span style="color:var(--ink2)">待催办</span><span style="font-weight:600;color:var(--amber)">5 家</span></div>
          </div>
        </div>
      </div>
      <div class="action-grid" style="grid-template-columns:1fr 1fr">
        <div class="action-btn" onclick="window.location.href=window.hengaiPage('HengAI_供应链协同.html')">
          <div class="action-btn-icon" style="background:var(--teal-d);border:1px solid rgba(29,158,117,0.3)"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="3" r="1.7" stroke="var(--teal-l)" stroke-width="1"/><circle cx="2" cy="10" r="1.4" stroke="var(--teal-l)" stroke-width="1"/><circle cx="11" cy="10" r="1.4" stroke="var(--teal-l)" stroke-width="1"/><line x1="6.5" y1="4.7" x2="2.8" y2="8.6" stroke="var(--teal-l)" stroke-width="0.8"/><line x1="6.5" y1="4.7" x2="10.2" y2="8.6" stroke="var(--teal-l)" stroke-width="0.8"/></svg></div>
          <div><div class="action-btn-label">查看供应链</div><div class="action-btn-sub">协同填报状态</div></div>
        </div>
        <div class="action-btn" onclick="openH5ShareModal()">
          <div class="action-btn-icon" style="background:var(--gold-d);border:1px solid rgba(201,168,76,0.3)"><svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1.5" y="3.5" width="10" height="7" rx="1.5" stroke="var(--gold-l)" stroke-width="1"/><path d="M1.5 6l5 3 5-3" stroke="var(--gold-l)" stroke-width="0.9"/></svg></div>
          <div><div class="action-btn-label">发送穿透卡片</div><div class="action-btn-sub">催办供应商填报</div></div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="sec-head"><div class="sec-title">GreenMark</div><span style="font-size:18px;font-weight:700;color:var(--gold);font-family:'DM Mono',monospace">840</span></div>
      <div class="gm-bar-track"><div class="gm-bar-fill" style="width:42%"></div></div>
      <div class="gm-bar-label" style="margin-bottom:12px"><span>0</span><span style="color:var(--gold-l)">Lv.4 门槛 2,000 GM</span></div>
      <div class="gm-events">
        <div class="gm-event">
          <div class="gm-event-left">
            <div class="gm-event-icon" style="background:var(--blue-d);border:1px solid rgba(24,95,165,0.3)"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1.5" y="1.5" width="9" height="9" rx="1.5" stroke="#93c5fd" stroke-width="1"/><line x1="4" y1="5" x2="8" y2="5" stroke="#93c5fd" stroke-width="0.9"/><line x1="4" y1="7" x2="6.5" y2="7" stroke="#93c5fd" stroke-width="0.9"/></svg></div>
            <div><div class="gm-event-text">建立企业数字档案</div><div class="gm-event-sub">+50 GM · 真实数据录入</div></div>
          </div>
          <span class="gm-event-val" style="color:var(--blue-l)">+50</span>
        </div>
        <div class="gm-event">
          <div class="gm-event-left">
            <div class="gm-event-icon" style="background:var(--green-d);border:1px solid rgba(59,158,74,0.3)"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="6" cy="3" r="1.5" stroke="#7dd98a" stroke-width="1"/><circle cx="2" cy="9.5" r="1.2" stroke="#7dd98a" stroke-width="1"/><circle cx="10" cy="9.5" r="1.2" stroke="#7dd98a" stroke-width="1"/><line x1="6" y1="4.5" x2="2.8" y2="8.3" stroke="#7dd98a" stroke-width="0.8"/><line x1="6" y1="4.5" x2="9.2" y2="8.3" stroke="#7dd98a" stroke-width="0.8"/></svg></div>
            <div><div class="gm-event-text">2 家供应商完成填报</div><div class="gm-event-sub">代际收益累计中</div></div>
          </div>
          <span class="gm-event-val" style="color:var(--green-l)">+400</span>
        </div>
      </div>
      <button class="action-btn" style="width:100%;margin-top:10px;justify-content:center;background:rgba(201,168,76,0.08);border-color:rgba(201,168,76,0.25);color:var(--gold-l)" onclick="(window.HengAI&&HengAI.act.generateDecisionPackage?HengAI.act.generateDecisionPackage():window.location.href=window.hengaiPage('HengAI_决策层呈送包生成器.html'))">
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><rect x="1.5" y="1.5" width="10" height="10" rx="1.5" stroke="var(--gold-l)" stroke-width="1"/><line x1="4" y1="5" x2="9" y2="5" stroke="var(--gold-l)" stroke-width="0.9"/><line x1="4" y1="7.5" x2="9" y2="7.5" stroke="var(--gold-l)" stroke-width="0.9"/></svg>
        生成《全域升级报告》→ 呈送决策层
      </button>
    </div>
  </div>

  <!-- Report in progress -->
  <div class="report-banner mb-14">
    <div class="report-status">
      <div class="report-live"></div>
      <span style="font-size:10px;color:var(--green);font-weight:600;letter-spacing:0.5px">诊断报告生成中</span>
    </div>
    <div class="report-title"><span class="dyn-ent-name">待完善企业档案</span> · 全域碳合规诊断报告 v0.2</div>
    <div class="report-meta">供应链穿透率提升至 12% 时自动更新 · 下次更新预计：供应商填报完成后</div>
    <div class="report-pills">
      <span class="report-pill bdg-r">碳税敞口 <span class="dyn-rep-tax">—</span></span>
      <span class="report-pill bdg-y">Scope 3 覆盖率 <span class="dyn-sup-pct">—</span></span>
      <span class="report-pill bdg-gray">MAT 网关 未启用</span>
      <span class="report-pill bdg-gray">ZCP 签证 未启用</span>
    </div>
  </div>`;
}

function renderPhase3() {
  return `
  <!-- Dual rail -->
  <div class="dual-rail mb-14">
    <div class="dual-rail-row">
      <div class="rail-personal">
        <div class="rail-tag" style="color:var(--gold-l)">地球公民 · 个人成就</div>
        <div class="rail-level" style="color:var(--purple-l)">Lv.5 生态领袖</div>
        <div class="rail-en">Global Eco-Advisor</div>
        <div class="rail-stat" style="color:var(--teal-l)">2,847 <span style="font-size:14px;font-weight:400;color:var(--ink2)">tCO₂e</span></div>
        <div class="rail-stat-label">累计推动链上存证减排量</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <span class="badge bdg-p">生态顾问委员会</span>
          <span class="badge bdg-y">GM 乘数 ×2.0</span>
          <span class="badge" style="background:var(--teal-d);color:var(--teal-l);border:1px solid rgba(29,158,117,0.3)">减排证书颁发权</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:14px;padding:10px 13px;background:var(--gold-d);border:1px solid rgba(201,168,76,0.25);border-radius:9px">
          <svg width="28" height="28" viewBox="0 0 28 28" fill="none"><path d="M14 2L26 8V20L14 26L2 20V8L14 2Z" fill="rgba(201,168,76,0.15)" stroke="var(--gold)" stroke-width="1.2"/><path d="M9 13L13 17L19 10" stroke="var(--gold-l)" stroke-width="1.5" stroke-linecap="round"/></svg>
          <div>
            <div style="font-size:11.5px;font-weight:600;color:var(--gold-l)">地球公民荣誉勋章</div>
            <div style="font-size:10px;color:var(--gold);margin-top:1px">#--- · CL-IVC 链上存证</div>
          </div>
        </div>
        <div style="font-size:26px;font-weight:700;font-family:'DM Mono',monospace;color:var(--gold);margin-top:14px;letter-spacing:-1px">4,280 <span style="font-size:13px;font-weight:400;color:var(--ink2)">GM</span></div>
        <div style="font-size:10.5px;color:var(--ink2);margin-top:3px">GreenMark · 可授予合作伙伴</div>
      </div>
      <div class="rail-corp">
        <div class="rail-tag" style="color:var(--teal-l)">企业文明 · 官方认证</div>
        <div class="rail-level" style="color:var(--teal-l)">认证金库</div>
        <div class="rail-en" style="color:var(--teal)">Certified Vault · Enterprise</div>
        <div class="cert-vault">
          <div class="vault-pulse"></div>
          <div class="vault-text">MAT 网关在线 · ZCP 算力时移生效中</div>
        </div>
        <div class="gateway-row">
          <div class="gateway-item">
            <div class="gw-status" style="background:var(--green)"></div>
            <div class="gw-text">MAT 边缘感知网关</div>
            <div class="gw-label">Lv.4 物理级</div>
          </div>
          <div class="gateway-item">
            <div class="gw-status" style="background:var(--blue-l)"></div>
            <div class="gw-text">ZCP 零碳算力签证</div>
            <div class="gw-label">时移套利中</div>
          </div>
          <div class="gateway-item">
            <div class="gw-status" style="background:var(--teal)"></div>
            <div class="gw-text">CL-GTS 欧盟直连通道</div>
            <div class="gw-label">CBAM 申报就绪</div>
          </div>
        </div>
        <div style="margin-top:12px;padding:11px 13px;background:var(--green-d);border:1px solid rgba(59,158,74,0.25);border-radius:9px">
          <div style="font-size:10px;color:var(--green);font-weight:600;margin-bottom:5px">年度企业文明进步奖 · 候选资格</div>
          <div style="font-size:12px;color:var(--green-l);line-height:1.6">供应链覆盖率 <strong>94%</strong> · 碳强度 <strong>1.62 tCO₂e/t</strong> · 优于行业均值 31%</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Global hub actions -->
  <div class="mb-14">
    <div class="sec-head"><div class="sec-title">全域枢纽</div><span class="bdg-p">旗舰模式</span></div>
    <div class="action-grid">
      <div class="action-btn" onclick="window.location.href=window.hengaiPage('HengAI_EU_Customs.html')">
        <div class="action-btn-icon" style="background:var(--blue-d);border:1px solid rgba(24,95,165,0.3)"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="var(--blue-l)" stroke-width="1"/><path d="M3 7h8M7 3v8" stroke="var(--blue-l)" stroke-width="1" stroke-dasharray="1.5 1.5"/><circle cx="7" cy="7" r="2" stroke="var(--blue-l)" stroke-width="1"/></svg></div>
        <div><div class="action-btn-label">欧盟海关直连</div><div class="action-btn-sub">CBAM 申报一键提交</div></div>
      </div>
      <div class="action-btn" onclick="window.location.href=window.hengaiPage('HengAI_DLD_Credit.html')">
        <div class="action-btn-icon" style="background:var(--green-d);border:1px solid rgba(59,158,74,0.3)"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1.5" y="3.5" width="11" height="8" rx="1.5" stroke="var(--green-l)" stroke-width="1"/><line x1="4" y1="7" x2="10" y2="7" stroke="var(--green-l)" stroke-width="1"/><line x1="7" y1="4.5" x2="7" y2="9.5" stroke="var(--green-l)" stroke-width="1"/></svg></div>
        <div><div class="action-btn-label">DLD 绿色信贷</div><div class="action-btn-sub">碳资产金融确权</div></div>
      </div>
      <div class="action-btn" onclick="showToast('里程碑数据同步中 · 全球减排账本更新')">
        <div class="action-btn-icon" style="background:var(--purple-d);border:1px solid rgba(127,119,221,0.3)"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5L12.5 4.5V10.5L7 13.5L1.5 10.5V4.5L7 1.5Z" stroke="var(--purple-l)" stroke-width="1" fill="var(--purple-d)"/><path d="M4.5 7L6.5 9.5L9.5 5" stroke="var(--purple-l)" stroke-width="1.2" stroke-linecap="round"/></svg></div>
        <div><div class="action-btn-label">生态贡献同步</div><div class="action-btn-sub">向全球减排账本提交</div></div>
      </div>
      <div class="action-btn" onclick="window.location.href=window.hengaiPage('HengAI_供应链协同.html')">
        <div class="action-btn-icon" style="background:var(--teal-d);border:1px solid rgba(29,158,117,0.3)"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="3" r="1.7" stroke="var(--teal-l)" stroke-width="1"/><circle cx="2.5" cy="11" r="1.4" stroke="var(--teal-l)" stroke-width="1"/><circle cx="11.5" cy="11" r="1.4" stroke="var(--teal-l)" stroke-width="1"/><line x1="7" y1="4.7" x2="3.2" y2="9.6" stroke="var(--teal-l)" stroke-width="0.8"/><line x1="7" y1="4.7" x2="10.8" y2="9.6" stroke="var(--teal-l)" stroke-width="0.8"/></svg></div>
        <div><div class="action-btn-label">供应商网络</div><div class="action-btn-sub">28 个节点 · 双向可视</div></div>
      </div>
      <div class="action-btn" onclick="showToast('ZCP 时移签证 · 本月节税 ¥3.2万')">
        <div class="action-btn-icon" style="background:var(--gold-d);border:1px solid rgba(201,168,76,0.3)"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 2L12 5V9L7 12L2 9V5L7 2Z" stroke="var(--gold-l)" stroke-width="1"/><path d="M5.5 7l2 2 4-4" stroke="var(--gold-l)" stroke-width="1.1" stroke-linecap="round"/></svg></div>
        <div><div class="action-btn-label">ZCP 套利监控</div><div class="action-btn-sub">本月节税 ¥3.2万</div></div>
      </div>
      <div class="action-btn" onclick="showToast('荣誉体系页面跳转中')">
        <div class="action-btn-icon" style="background:var(--purple-d);border:1px solid rgba(127,119,221,0.3)"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1.5L8.5 5.5L13 6.2L9.8 9.4L10.5 14L7 12L3.5 14L4.2 9.4L1 6.2L5.5 5.5L7 1.5Z" stroke="var(--purple-l)" stroke-width="1" fill="var(--purple-d)"/></svg></div>
        <div><div class="action-btn-label">荣誉体系</div><div class="action-btn-sub">勋章 · 里程碑 · 名录</div></div>
      </div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────
// ENTERPRISE PAGE
// ─────────────────────────────────────────────────────────
function getIndexHubPhaseNum() {
  return typeof INDEX_HUB_PHASE !== 'undefined' ? INDEX_HUB_PHASE : 1;
}

function renderEnterprisePage() {
  if (getIndexHubPhaseNum() === 1) {
    return `
    <div class="sec-head"><div class="sec-title">企业数字档案</div></div>
    <div class="card" style="border-style:dashed;border-color:rgba(255,255,255,0.15);background:rgba(0,0,0,0.2);text-align:center;padding:48px 24px">
      <div style="width:48px;height:48px;border-radius:12px;background:var(--blue-d);border:1px solid rgba(24,95,165,0.3);display:flex;align-items:center;justify-content:center;margin:0 auto 14px">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect x="2" y="5" width="16" height="13" rx="2" stroke="#93c5fd" stroke-width="1.2"/><path d="M6 5V4a4 4 0 018 0v1" stroke="#93c5fd" stroke-width="1.1"/></svg>
      </div>
      <div style="font-size:15px;font-weight:600;margin-bottom:8px">尚未建立企业档案</div>
      <div style="font-size:12px;color:var(--ink2);line-height:1.8;max-width:360px;margin:0 auto 20px">当您准备好将个人的知识转化为企业的资产时，可随时建立企业数字档案——这是解锁精确碳税诊断与供应链协同的关键一步。</div>
      <button class="topbar-btn primary" style="padding:10px 24px;font-size:13px" onclick="setPhase(2);showToast('企业档案已建立 · +50 GM · 欢迎进入阶段二')">立即建立企业档案 →</button>
    </div>`;
  }

  const isP3 = getIndexHubPhaseNum() === 3;
  return `
  <div class="sec-head"><div class="sec-title">企业数字档案</div>
    <div style="display:flex;gap:8px">
      <span class="${isP3?'bdg-g':'bdg-y'}">${isP3?'认证金库 · 旗舰版':'数字孪生体建立中'}</span>
      <button class="action-link" onclick="openEnterpriseProfileDrawer()">编辑</button>
    </div>
  </div>
  <div class="card mb-14">
    <div class="ent-header">
      <div class="ent-logo">企</div>
      <div style="flex:1">
        <div class="ent-name dyn-ent-name">待完善企业档案</div>
        <div class="ent-meta">统一社会信用代码: <span data-state-bind="company.creditCode" data-empty="---">---</span> · 绑定于 <span data-state-bind="user.regDate" data-state-fmt="dt" data-empty="---">---</span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <span class="ent-status ${isP3?'bdg-g':'bdg-y'}">${isP3?'✓ 官方认证企业':'数字孪生体建立中'}</span>
          <span class="badge bdg-gray"><span data-state-bind="company.mainProduct" data-empty="---">---</span></span>
          <span class="badge bdg-b">年出口 <span data-state-bind="company.annualRevenue" data-state-fmt="n" data-empty="---">---</span></span>
        </div>
      </div>
      ${isP3 ? `<div style="text-align:right">
        <div style="font-size:20px;font-weight:700;color:var(--green-l);font-family:'DM Mono',monospace"><span data-state-bind="metrics.carbonIntensity" data-state-fmt="n" data-decimals="2" data-empty="---">---</span></div>
        <div style="font-size:10px;color:var(--ink2)">tCO₂e/t · 行业对比 <span data-state-bind="metrics.roiRatio" data-state-fmt="pct" data-empty="---">---</span></div>
      </div>` : `<div style="text-align:right">
        <div style="font-size:18px;font-weight:700;color:var(--red);font-family:'DM Mono',monospace"><span class="dyn-rep-tax">—</span></div>
        <div style="font-size:10px;color:rgba(252,165,165,0.7)">碳税敞口预测</div>
      </div>`}
    </div>
    <div style="padding:14px 18px">
      <div class="g4">
        <div class="metric-box"><div class="metric-label">产品碳强度</div><div class="metric-val" style="color:${isP3?'var(--green-l)':'var(--amber)'}"><span class="dyn-carbon-intensity">待测算</span><span class="metric-unit" style="font-size:10px">t/t</span></div><div class="metric-sub">tCO₂e / 吨产品</div></div>
        <div class="metric-box"><div class="metric-label">供应链覆盖</div><div class="metric-val" style="color:${isP3?'var(--green-l)':'var(--red)'}"><span class="dyn-supply-coverage">—</span></div><div class="metric-sub">Scope 3 穿透率</div></div>
        <div class="metric-box"><div class="metric-label">数据置信度</div><div class="metric-val" style="color:${isP3?'var(--teal-l)':'var(--amber)'}">Lv.${isP3?'4':'2'}</div><div class="metric-sub">${isP3?'物理级 · 免审':'人工凭证'}</div></div>
        <div class="metric-box"><div class="metric-label">年度节税</div><div class="metric-val" style="color:${isP3?'var(--green-l)':'var(--ink3)'}">${isP3?'<span class="dyn-rep-save">—</span>':'--'}</div><div class="metric-sub">${isP3?'ROI <span class="dyn-rep-roi">—</span>':'待激活基建'}</div></div>
      </div>
    </div>
  </div>
  ${isP3 ? `
  <div class="g2 mb-14">
    <div class="card"><div class="sec-head"><div class="sec-title">基础设施状态</div><span class="bdg-g">全量在线</span></div>
      <div class="gateway-row">
        <div class="gateway-item"><div class="gw-status" style="background:var(--green)"></div><div style="flex:1"><div class="gw-text">MAT 边缘感知网关</div><div class="gw-label">物理级数据采集 · Lv.4 认证</div></div><span class="badge bdg-g">在线</span></div>
        <div class="gateway-item"><div class="gw-status" style="background:var(--blue-l)"></div><div style="flex:1"><div class="gw-text">ZCP 零碳算力签证</div><div class="gw-label">绿电时移生效中 · 节税 ¥3.2万/月</div></div><span class="badge bdg-b">运行中</span></div>
        <div class="gateway-item"><div class="gw-status" style="background:var(--teal)"></div><div style="flex:1"><div class="gw-text">CL-GTS 欧盟直连</div><div class="gw-label">CBAM 申报通道就绪</div></div><span class="badge" style="background:var(--teal-d);color:var(--teal-l);border:1px solid rgba(29,158,117,0.3)">就绪</span></div>
      </div>
    </div>
    <div class="card"><div class="sec-head"><div class="sec-title">企业文明进步奖</div><span class="bdg-p">候选资格</span></div>
      <div style="font-size:12px;color:var(--ink2);line-height:1.75">贵司已具备参选 Co2Lion 年度《企业文明进步奖》资格。链上存证数据可供全球独立核验——这是中国制造出海的绿色信用护照。</div>
      <button class="action-btn" style="width:100%;margin-top:12px;justify-content:center;background:var(--purple-d);border-color:rgba(127,119,221,0.3);color:var(--purple-l)" onclick="showToast('参选申请已提交')">提交参选申请 →</button>
    </div>
  </div>` : `
  <div class="insight insight-gold mb-14">
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0;margin-top:1px"><path d="M7 1L13 4.5V11.5L7 13L1 11.5V4.5L7 1Z" stroke="var(--gold-l)" stroke-width="1" fill="var(--gold-d)"/><line x1="7" y1="4.5" x2="7" y2="8" stroke="var(--gold-l)" stroke-width="1.1"/><circle cx="7" cy="9.5" r="0.6" fill="var(--gold-l)"/></svg>
    <div>以当前个人权限，您已完成全部数据诊断。若要实质性对冲 <span class="dyn-rep-tax">—</span> 碳税敞口，需要为企业启用 MAT 网关与 ZCP 签证。<strong style="color:var(--gold-l)">一键生成《全域升级报告》，由决策层定夺。</strong></div>
  </div>`}
  <div id="enterprise-profile-drawer-mask" style="position:fixed;inset:0;background:rgba(2,6,12,0.72);backdrop-filter:blur(3px);z-index:5200;display:none;opacity:0;transition:opacity .22s ease" onclick="closeEnterpriseProfileDrawer()">
    <div id="enterprise-profile-drawer" style="position:absolute;top:0;right:0;height:100%;width:min(540px,92vw);background:linear-gradient(180deg,#0b1320,#080e18);border-left:1px solid rgba(16,185,129,0.28);box-shadow:-24px 0 56px rgba(0,0,0,0.45);transform:translateX(100%);transition:transform .24s ease;padding:24px 22px 18px;display:flex;flex-direction:column;gap:14px" onclick="event.stopPropagation()">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:rgba(16,185,129,0.85)">Enterprise Profile Writer</div>
          <div style="font-size:18px;font-weight:700;color:#ecfdf5;margin-top:2px">企业数字档案录入面板</div>
        </div>
        <button type="button" class="topbar-btn" onclick="closeEnterpriseProfileDrawer()">✕</button>
      </div>
      <div style="display:flex;flex-direction:column;gap:12px;background:rgba(255,255,255,0.02);border:1px solid rgba(16,185,129,0.14);border-radius:14px;padding:14px 12px">
        <label style="display:flex;flex-direction:column;gap:6px">
          <span style="font-size:11px;color:var(--ink2)">企业全称</span>
          <input id="input-ent-name" type="text" class="f-inp" placeholder="请输入企业全称" style="width:100%">
        </label>
        <label style="display:flex;flex-direction:column;gap:6px">
          <span style="font-size:11px;color:var(--ink2)">所属行业</span>
          <select id="input-ent-industry" class="f-sel" style="width:100%">
            <option value="steel">钢铁</option>
            <option value="cement">水泥</option>
            <option value="petro">石化/化工</option>
            <option value="paper">造纸</option>
            <option value="aviation">民航</option>
            <option value="ceramic">陶瓷</option>
            <option value="port">交通/港口</option>
            <option value="idc">数据中心</option>
            <option value="aluminum">铝及铝合金</option>
            <option value="fertilizer">化肥</option>
            <option value="electricity">电力</option>
            <option value="hydrogen">氢</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:6px">
          <span style="font-size:11px;color:var(--ink2)">地域标签（GD-ETS 2026）</span>
          <select id="input-ent-region" class="f-sel" style="width:100%">
            <option value="">未指定</option>
            <option value="gd">广东省 · 重点排放单位</option>
            <option value="guangdong">广东（别名）</option>
            <option value="other">其他省份</option>
          </select>
        </label>
        <label style="display:flex;flex-direction:column;gap:6px">
          <span style="font-size:11px;color:var(--ink2)">统一社会信用代码</span>
          <input id="input-ent-code" type="text" class="f-inp" placeholder="请输入统一社会信用代码" style="width:100%">
        </label>
      </div>
      <div style="margin-top:auto;display:flex;gap:10px">
        <button type="button" class="topbar-btn" style="flex:1;border-color:rgba(248,113,113,0.45);color:#fecaca;background:rgba(127,29,29,0.16)" onclick="closeEnterpriseProfileDrawer()">❌ 取消</button>
        <button id="enterprise-save-btn" type="button" class="topbar-btn primary" style="flex:1;justify-content:center;box-shadow:0 0 16px rgba(16,185,129,0.32) inset" onclick="saveEnterpriseProfile()">🛡️ 确认存入数字底座</button>
      </div>
    </div>
  </div>`;
}

// ─────────────────────────────────────────────────────────
// SUPPLY CHAIN PAGE
// ─────────────────────────────────────────────────────────
function renderSupplyPage() {
  if (getIndexHubPhaseNum() === 1) {
    return `<div class="card" style="text-align:center;padding:48px 24px;border-style:dashed;border-color:rgba(255,255,255,0.15);background:rgba(0,0,0,0.2)">
      <div style="font-size:14px;font-weight:600;margin-bottom:8px;color:var(--ink3)">供应链协同（未解锁）</div>
      <div style="font-size:12px;color:var(--ink3)">建立企业档案后解锁</div>
    </div>`;
  }
  const isP3 = getIndexHubPhaseNum() === 3;
  let genIncomeHtml = '<div style="padding:10px;color:var(--ink3);font-size:11.5px">暂无二级节点激活 · 邀请供应商后将显示代际 GM</div>';
  try {
    if (typeof window.buildGenerationalEvents === 'function' && typeof window.renderGenerationalIncomeHtml === 'function') {
      genIncomeHtml = window.renderGenerationalIncomeHtml(window.buildGenerationalEvents(window.AppState));
    }
  } catch (_) {}
  const supChain = [
    {name:'供应商 A',tier:'Tier 1',status:'done',pct:0,co2:'---',gm_effect:'---',last:'---'},
    {name:'供应商 B',tier:'Tier 1',status:'pending',pct:0,co2:'---',gm_effect:'---',last:'---'},
    {name:'供应商 C',tier:'Tier 1',status:'pending',pct:0,co2:'---',gm_effect:'---',last:'---'},
    {name:'供应商 D',tier:'Tier 2',status:'pending',pct:0,co2:'---',gm_effect:'---',last:'---'},
    {name:'供应商 E',tier:'Tier 2',status:'pending',pct:0,co2:'---',gm_effect:'---',last:'---'},
  ];
  return `
  <div class="sec-head">
    <div class="sec-title">供应链协同</div>
    <div style="display:flex;gap:8px;align-items:center">
      <span class="${isP3?'bdg-g':'bdg-r'}"><span data-state-bind="metrics.supplyChainCoverage" data-state-fmt="pct" data-empty="---">---</span></span>
      <button class="action-link" onclick="typeof openH5ShareModal==='function'?openH5ShareModal():window.location.href=window.hengaiPage('HengAI_供应链协同.html')">批量邀请 →</button>
    </div>
  </div>
  <div class="card mb-14" style="padding:0;overflow:hidden">
    <table class="sc-table">
      <thead><tr>
        <th>供应商</th><th>层级</th><th>填报进度</th>
        <th>碳强度</th><th>GM 贡献</th><th>最近更新</th><th>操作</th>
      </tr></thead>
      <tbody>
        ${supChain.map(s => {
          const statusMap = {done:['sp-done','已完成'],partial:['sp-partial','填报中'],missing:['sp-missing','数据缺口'],pending:['sp-pending','待催办']};
          const [cls,label] = statusMap[s.status];
          const barColor = s.status==='done'?'var(--green)':s.status==='partial'?'var(--gold)':'var(--border)';
          return `<tr>
            <td style="font-weight:500">${s.name}</td>
            <td><span class="badge bdg-gray">${s.tier}</span></td>
            <td>
              <div style="display:flex;align-items:center;gap:8px">
                <div class="progress-mini"><div class="progress-mini-fill" style="width:${s.pct}%;background:${barColor}"></div></div>
                <span class="status-pill ${cls}">${label}</span>
              </div>
            </td>
            <td class="mono" style="color:${s.co2==='--'?'var(--ink3)':'var(--ink)'}">${s.co2==='--'?'--':s.co2+' t'}</td>
            <td style="color:${s.gm_effect==='--'?'var(--ink3)':'var(--green-l)'};font-weight:600">${s.gm_effect}</td>
            <td class="text-muted text-small mono">${s.last}</td>
            <td>${s.status==='missing'?`<span class="action-link" onclick="openH5ShareModal()">一键催办</span>`:s.status==='pending'?`<span class="action-link" onclick="openH5ShareModal()">发送邀请</span>`:`<span class="action-link">查看详情</span>`}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>
  <div class="g2">
    <div class="card">
      <div class="sec-head"><div class="sec-title">邀请漏斗追踪</div></div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${[['已发送邀请','---','var(--ink2)'],['已打开链接','---','var(--blue-l)'],['已完成注册','---','var(--teal-l)'],['已完成填报','---','var(--green-l)'],['已付费升级','---','var(--gold)']].map(([l,v,c])=>`
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:90px;font-size:11px;color:var(--ink2)">${l}</div>
          <div style="flex:1;height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden">
            <div style="height:100%;background:${c};border-radius:3px;width:0%"></div>
          </div>
          <div style="font-size:11.5px;font-weight:600;color:${c};width:30px;text-align:right">${v}</div>
        </div>`).join('')}
      </div>
    </div>
    <div class="card">
      <div class="sec-head"><div class="sec-title">代际收益追踪</div><span class="bdg-g">新机制</span></div>
      <div style="font-size:11.5px;color:var(--ink2);line-height:1.7;margin-bottom:12px">您推动的供应商若推动了其下游，您将获得代际 GM 奖励。二级节点数量与奖励以系统核算为准。</div>
      <div id="sup-gen-events" style="display:flex;flex-direction:column;gap:7px">${genIncomeHtml}</div>
    </div>
  </div>`;
}

// ═══════════════════════════════════════════════════════
// PHASE SWITCH (index.html co2lion-hub-overlay only)
// ═══════════════════════════════════════════════════════
function setIndexHubOverlayPhase(p) {
  const appPhase = Number(window.AppState && window.AppState.currentPhase);
  const targetPhase = Number.isFinite(appPhase) && appPhase >= 1 && appPhase <= 3
    ? appPhase
    : p;
  INDEX_HUB_PHASE = targetPhase;
  const s = STATE[targetPhase];
  if (!s) return;

  const liveGm =
    window.AppState &&
    window.AppState.user &&
    window.AppState.user.gmBalance != null
      ? Number(window.AppState.user.gmBalance)
      : s.gm;
  const gmDisplay = Number.isFinite(liveGm) ? liveGm : s.gm;

  const pb = document.getElementById('phase-badge');
  if (pb) {
    pb.textContent = s.phaseBadge;
    pb.className = 'phase-badge ' + s.phaseClass;
  }
  const upgradeBtn = document.getElementById('upgrade-btn');
  if (upgradeBtn) upgradeBtn.textContent = s.upgradeBtn;

  const strip = document.getElementById('sidebar-phase');
  if (strip) strip.className = 'phase-strip ' + s.phaseStripClass;
  const phaseLabel = document.getElementById('phase-label');
  if (phaseLabel) phaseLabel.textContent = s.phaseName;
  const phaseDot = document.getElementById('phase-dot');
  if (phaseDot) phaseDot.style.background = s.phaseDot;

  const userMeta = document.getElementById('user-meta');
  if (userMeta) {
    userMeta.textContent =
      (window.AppState && window.AppState.user && window.AppState.user.tier) || s.userMeta;
  }

  const shieldLevel = document.getElementById('shield-level');
  if (shieldLevel) {
    shieldLevel.textContent = s.shieldLevel;
    shieldLevel.style.color = s.shieldColor;
  }
  const shieldLabel = document.getElementById('shield-label');
  if (shieldLabel) {
    shieldLabel.textContent = s.shieldLabel;
    shieldLabel.style.color = s.shieldColor;
  }
  const shieldPath = document.getElementById('shield-path');
  if (shieldPath) {
    shieldPath.setAttribute('fill', s.shieldFill);
    shieldPath.setAttribute('stroke', s.shieldStroke);
  }
  const shieldCrown = document.getElementById('shield-crown');
  if (shieldCrown) shieldCrown.setAttribute('stroke', s.shieldStroke);

  const tagsEl = document.getElementById('id-tags');
  if (tagsEl) tagsEl.innerHTML = s.tags.map(t => `<span class="id-tag" style="${t.style}">${t.text}</span>`).join('');

  document.querySelectorAll('.nav-item').forEach(el => {
    const id = el.id;
    if (!id) return;
    if (s.navLocked.includes(id)) {
      el.classList.add('locked');
      el.querySelector('[id$="-dot"]') && (el.querySelector('[id$="-dot"]').style.background = 'var(--ink3)');
    } else {
      el.classList.remove('locked');
    }
  });
  // 企业工作台 P2 · 工业原厂因子核验 Phase 2 起激活
  if (targetPhase > 1) {
    const navSupply = document.getElementById('nav-supply');
    const navReport = document.getElementById('nav-report');
    const navDecision = document.getElementById('nav-decision');
    const navOrigin = document.getElementById('n-origin-audit');
    if (navSupply) navSupply.classList.remove('locked');
    if (navReport) navReport.classList.remove('locked');
    if (navDecision) navDecision.classList.remove('locked');
    if (navOrigin) {
      navOrigin.classList.remove('locked');
      const dot = document.getElementById('dot-origin-audit');
      if (dot) dot.style.background = 'var(--gold-l)';
    }
  }
  if (targetPhase >= 3) {
    ['nav-eco','nav-honor','nav-eu','nav-dld','nav-acf'].forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.classList.remove('locked');
    });
  }

  if (typeof updateTimeline === 'function') updateTimeline(targetPhase);

  const phaseContent = document.getElementById('phase-content');
  if (phaseContent) {
    phaseContent.innerHTML =
      targetPhase === 1 ? renderPhase1() : targetPhase === 2 ? renderPhase2() : renderPhase3();
  }

  const entPage = document.getElementById('ent-page-content');
  if (entPage) entPage.innerHTML = renderEnterprisePage();
  const supplyPage = document.getElementById('supply-page-content');
  if (supplyPage) {
    supplyPage.innerHTML = renderSupplyPage();
    if (typeof window.renderGenerationalIncome === 'function') {
      try { window.renderGenerationalIncome(window.AppState); } catch (_) {}
    }
  }
  const pmGm = document.getElementById('pm-gm');
  if (pmGm) {
    pmGm.innerHTML = gmDisplay.toLocaleString() + ' <span class="metric-unit" style="font-size:13px">GM</span> <span class="magic-trigger-gm" onclick="openProtocol()">✨ 解析绿印法则</span>';
  }
  const liveTco =
    window.AppState && window.AppState.user && window.AppState.user.tCO2e_total != null
      ? Number(window.AppState.user.tCO2e_total)
      : NaN;
  const tcoDisp =
    Number.isFinite(liveTco) ? liveTco.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
  const pmCo2 = document.getElementById('pm-co2');
  const co2Html =
    tcoDisp +
    ' <span class="metric-unit">tCO₂e</span> <span class="magic-trigger-co2" onclick="openEarthLedger()">🔗 链上存证 可核验</span>';
  if (targetPhase > 1) {
    const pmCalcs = document.getElementById('pm-calcs');
    const pmCalcsSub = document.getElementById('pm-calcs-sub');
    if (pmCalcs) pmCalcs.textContent = '—';
    if (pmCalcsSub) pmCalcsSub.textContent = '待数据同步';
    if (pmCo2) pmCo2.innerHTML = co2Html;
  } else if (pmCo2) {
    pmCo2.innerHTML = co2Html;
  }

  if (window.__hubOverviewData && typeof applyRealData === 'function') applyRealData(window.__hubOverviewData);

  ['p1', 'p2', 'p3'].forEach((c, i) => {
    const btn = document.getElementById('btn-' + c);
    if (btn) btn.className = 'ps-btn' + (i + 1 === targetPhase ? ' ' + c + '-active' : '');
  });
  try {
    const uid = window.AppState && window.AppState.user && (window.AppState.user.id || window.AppState.user.userId);
    const cacheKey = uid ? ('hengai_hub_cache_v1:' + uid) : null;
    if (cacheKey) {
      localStorage.setItem(cacheKey, JSON.stringify({
        phase: targetPhase,
        user: window.AppState && window.AppState.user ? window.AppState.user : {},
        company: window.AppState && window.AppState.company ? window.AppState.company : {},
        _ownerUserId: uid,
      }));
    }
    localStorage.removeItem('hengai_hub_cache_v1');
  } catch (e) {}
  try {
    if (typeof window.syncAppState === 'function') window.syncAppState();
  } catch (_) {}
}

function updateTimeline(p) {
  const steps = [
    {dotId:'tl-dot-4',lineId:'tl-line-3',numId:'tl-4-num',checkId:'tl-4-check',labelId:'tl-label-4',dateId:'tl-date-4',label:'建立企业档案',date:'---',phase:2},
    {dotId:'tl-dot-5',lineId:'tl-line-4',numId:'tl-5-num',labelId:'tl-label-5',label:'供应链协同',date:'---',phase:2},
    {dotId:'tl-dot-6',lineId:'tl-line-5',numId:'tl-6-num',labelId:'tl-label-6',label:'全域升级',date:'---',phase:3},
  ];
  steps.forEach((s,i) => {
    const done = p > s.phase || (p === s.phase && i === 0) || (p===3);
    const dot = document.getElementById(s.dotId);
    const line = document.getElementById(s.lineId);
    if (!dot) return;
    if (p >= s.phase) {
      dot.style.background = 'var(--green-d)';
      dot.style.border = '1.5px solid var(--green)';
      if (s.checkId) {
        const chk = document.getElementById(s.checkId);
        const num = document.getElementById(s.numId);
        if (chk) chk.style.display = 'block';
        if (num) num.style.display = 'none';
      }
      if (document.getElementById(s.labelId)) {
        document.getElementById(s.labelId).className = 'rt-label done';
        document.getElementById(s.labelId).textContent = s.label;
      }
      if (s.dateId && document.getElementById(s.dateId))
        document.getElementById(s.dateId).textContent = s.date;
    }
    if (line) line.style.background = p >= s.phase ? 'rgba(59,158,74,0.4)' : 'var(--border)';
  });
}

// ═══════════════════════════════════════════════════════
// IDENTITY-AWARE NAV · SME vs 工业原厂
// ═══════════════════════════════════════════════════════
window.USER_ROLE = window.USER_ROLE || { GUEST: 'ROLE_GUEST', SME: 'ROLE_SME', ORIGIN: 'ROLE_ORIGIN' };

function applyIdentityAwareNav(state) {
  var s = state || window.AppState || {};
  var role = typeof window.resolveUserRoleFromState === 'function'
    ? window.resolveUserRoleFromState(s)
    : (s.flags && s.flags.userRole) || window.USER_ROLE.GUEST;
  var isOrigin = role === window.USER_ROLE.ORIGIN;
  var isGuest = role === window.USER_ROLE.GUEST;

  document.querySelectorAll('[data-role-nav="origin-only"]').forEach(function (node) {
    node.style.display = isOrigin ? '' : 'none';
  });
  document.querySelectorAll('[data-role-nav="sme-only"]').forEach(function (node) {
    node.style.display = isOrigin ? 'none' : (isGuest ? 'none' : '');
  });

  var navSupply = document.getElementById('nav-supply');
  if (navSupply && !navSupply.hasAttribute('data-role-nav')) {
    navSupply.style.display = isOrigin ? 'none' : (isGuest ? 'none' : '');
  } else if (navSupply && !isOrigin && !isGuest) {
    var phaseNumSme = 1;
    try {
      var cpS = (s.flags && s.flags.currentPhase) || 'Phase1';
      phaseNumSme = cpS === 'Phase3' ? 3 : cpS === 'Phase2' ? 2 : 1;
    } catch (_) {}
    if (typeof PHASE !== 'undefined' && Number(PHASE) >= 2) {
      phaseNumSme = Math.max(phaseNumSme, Number(PHASE));
    }
    if (phaseNumSme >= 2 && role === window.USER_ROLE.SME) {
      navSupply.classList.remove('locked');
      navSupply.classList.remove('locked-clickable');
      navSupply.setAttribute('onclick', "navTo('supply', this)");
      var dotS = document.getElementById('dot-supply');
      if (dotS) dotS.style.background = 'var(--teal)';
    }
  }

  var navBatchVerify = document.getElementById('nav-batch-verify');
  if (navBatchVerify && !isOrigin && !isGuest) {
    navBatchVerify.style.display = '';
    var phaseNumBv = 1;
    try {
      var cpBv = (s.flags && s.flags.currentPhase) || 'Phase1';
      phaseNumBv = cpBv === 'Phase3' ? 3 : cpBv === 'Phase2' ? 2 : 1;
    } catch (_) {}
    if (typeof PHASE !== 'undefined' && Number(PHASE) >= 2) {
      phaseNumBv = Math.max(phaseNumBv, Number(PHASE));
    }
    if (phaseNumBv >= 2 && role === window.USER_ROLE.SME) {
      navBatchVerify.classList.remove('locked');
      navBatchVerify.classList.remove('locked-clickable');
      navBatchVerify.setAttribute('onclick', "navTo('batch-verify', this)");
      var dotBv = document.getElementById('dot-batch-verify');
      if (dotBv) dotBv.style.background = 'var(--blue-l)';
    }
  } else if (navBatchVerify) {
    navBatchVerify.style.display = isOrigin ? 'none' : (isGuest ? 'none' : '');
  }

  var navOrigin = document.getElementById('n-origin-audit') || document.getElementById('nav-origin-audit');
  if (navOrigin) {
    navOrigin.style.display = isOrigin || (!isGuest && (s.flags || {}).originAuditUnlocked !== false) ? '' : '';
    if (isOrigin) {
      var dot = document.getElementById('dot-origin-audit');
      if (dot) dot.style.background = 'var(--gold-l)';
      var phaseNum = 1;
      try {
        var cp = (s.flags && s.flags.currentPhase) || 'Phase1';
        phaseNum = cp === 'Phase3' ? 3 : cp === 'Phase2' ? 2 : 1;
      } catch (_) {}
      if (typeof PHASE !== 'undefined' && Number(PHASE) >= 2) {
        phaseNum = Math.max(phaseNum, Number(PHASE));
      }
      if (phaseNum >= 2) {
        navOrigin.classList.remove('locked');
        navOrigin.classList.remove('locked-clickable');
        navOrigin.setAttribute('data-page', 'origin-audit');
        navOrigin.setAttribute('onclick', "navTo('origin-audit', this)");
      }
    } else if (!isGuest) {
      navOrigin.classList.toggle('locked', role === window.USER_ROLE.SME && !(s.flags || {}).originAuditUnlocked);
    }
  }

  var navFactorAuth = document.getElementById('nav-factor-auth');
  if (navFactorAuth) {
    if (isOrigin) {
      var dotFa = document.getElementById('dot-factor-auth');
      if (dotFa) dotFa.style.background = 'var(--orange-l)';
      var phaseNumFa = 1;
      try {
        var cpFa = (s.flags && s.flags.currentPhase) || 'Phase1';
        phaseNumFa = cpFa === 'Phase3' ? 3 : cpFa === 'Phase2' ? 2 : 1;
      } catch (_) {}
      if (typeof PHASE !== 'undefined' && Number(PHASE) >= 2) {
        phaseNumFa = Math.max(phaseNumFa, Number(PHASE));
      }
      if (phaseNumFa >= 2) {
        navFactorAuth.classList.remove('locked');
        navFactorAuth.classList.remove('locked-clickable');
        navFactorAuth.setAttribute('onclick', "navTo('factor-auth', this)");
      }
    }
  }

  if (typeof window.syncCbamIdentityUi === 'function') window.syncCbamIdentityUi(s);
}
window.applyIdentityAwareNav = applyIdentityAwareNav;

// ═══════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════
function hubNavOriginAudit(el) {
  var ph = typeof getIndexHubPhaseNum === 'function' ? getIndexHubPhaseNum() : (typeof INDEX_HUB_PHASE !== 'undefined' ? INDEX_HUB_PHASE : 1);
  if (ph < 2) {
    if (typeof showToast === 'function') showToast('阶段二解锁：请先建立企业数字档案');
    return;
  }
  if (typeof navigateToHub === 'function') navigateToHub('origin-audit');
  else if (el) navTo('origin-audit', el);
}
window.hubNavOriginAudit = hubNavOriginAudit;
window.hubNavIndustryAudit = hubNavOriginAudit;

function indexShellNavTo(page, el) {
  if (typeof window.__hengaiHubNavTo === 'function' && document.getElementById('sidebar')) {
    return window.__hengaiHubNavTo(page, el);
  }
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.page-view').forEach(p => p.classList.remove('active'));
  const pageId = page.startsWith('page-') ? page : ('page-' + page);
  const target = document.getElementById(pageId);
  if (target) target.classList.add('active');
  const titles = {
    overview:'全域总览', personal:'星火成就档案', calc:'CBAM 测算工具',
    knowledge:'法规知识库', enterprise:'企业数字档案', supply:'供应链协同',
    'batch-verify':'产业链核验', 'factor-auth':'原厂因子精算',
    'gm-wallet':'GreenMark 绿印资产钱包', 'eu-customs':'CL-GTS 欧盟直连通道', 'dld-credit':'DLD 绿色信贷确权',
    'page-overview':'全域总览', 'page-personal':'星火成就档案', 'page-calc':'CBAM 测算工具',
    'page-knowledge':'法规知识库', 'page-origin-audit':'产业主权看板',
    'page-enterprise':'企业数字档案', 'page-supply':'供应链协同',
    'page-diagnostic':'全域诊断报告', 'page-gm-wallet':'GreenMark 绿印资产钱包',
    'page-eu-customs':'CL-GTS 欧盟直连通道', 'page-dld-credit':'DLD 绿色信贷确权'
  };
  const titleEl = document.getElementById('page-title');
  if (titleEl) titleEl.textContent = titles[page] || titles[pageId] || page;
}
if (typeof window.navTo !== 'function' || !window.__hengaiHubNavTo) {
  window.navTo = indexShellNavTo;
}

window.loadInFrame = function (htmlFileName, menuElement) {
  const frame = document.getElementById('hub-main-frame');
  if (frame) {
    frame.src = htmlFileName;
  }

  if (menuElement) {
    const menuItems = document.querySelectorAll('.sidebar-menu-item');
    menuItems.forEach(item => item.classList.remove('active'));
    menuElement.classList.add('active');
  }

  // Clean legacy page-slot architecture on first iframe navigation.
  if (!window.__hubIframeModeCleaned) {
    document.querySelectorAll('.content.page-view').forEach(node => node.remove());
    window.__hubIframeModeCleaned = true;
  }
};

// ═══════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════
function showToast(msg) {
  const el = document.getElementById('toast-el') || document.getElementById('toast');
  if (!el) return;
  const msgEl = el.querySelector('#toast-msg') || el.querySelector('#toast-msg-el') || document.getElementById('toast-msg') || document.getElementById('toast-msg-el');
  if (msgEl) msgEl.textContent = msg;
  if (el.id === 'toast-el') {
    el.classList.add('show');
    setTimeout(() => el.classList.remove('show'), 2800);
  } else {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(8px)';
    }, 2600);
  }
}
// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
function openEarthLedger() {
  document.getElementById('earthLedger').classList.add('show');
}
function closeEarthLedger() {
  document.getElementById('earthLedger').classList.remove('show');
}
function openProtocol() {
  document.getElementById('protocolOverlay').classList.add('show');
  setTimeout(() => { document.getElementById('protocolDrawer').classList.add('open'); }, 10);
}
function closeProtocol() {
  document.getElementById('protocolDrawer').classList.remove('open');
  setTimeout(() => { document.getElementById('protocolOverlay').classList.remove('show'); }, 300);
}
function mintSocialCard() {
    const btn = event.currentTarget;
    const originalText = btn.innerHTML;
    // 1. 按钮进入算力加载态
    btn.innerHTML = '⏳ 正在上链并刻录专属海报...';
    btn.style.opacity = '0.8';
    btn.style.pointerEvents = 'none';

    // 2. 延迟弹出真实海报模态框
    setTimeout(() => {
        btn.innerHTML = originalText;
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
        const now = new Date();
        document.getElementById('posterTimestamp').innerText = `MINTED AT: ${now.toISOString().replace('T', ' ').substring(0, 19)} UTC`;
        document.getElementById('posterModal').classList.add('show');
    }, 1200);
}

function closePosterModal() {
    document.getElementById('posterModal').classList.remove('show');
}

function downloadPosterReal() {
    const btn = event.currentTarget;
    btn.innerHTML = '✅ 海报已生成并保存';
    setTimeout(() => {
        btn.innerHTML = '💾 保存海报至本地';
    }, 2000);
}
if (typeof window !== 'undefined') {
  if (!isHubRuntimePage()) {
    window.setPhase = setIndexHubOverlayPhase;
    if (document.getElementById('phase-badge')) {
      try { setIndexHubOverlayPhase(1); } catch (e) { console.warn('[IndexHub] setIndexHubOverlayPhase', e); }
    }
  }
  document.addEventListener('DOMContentLoaded', async function () {
    if (!isHubRuntimePage()) return;
    if (!requireHubAuth()) return;
    try {
      await fetchHubData();
    } catch (e) {
      console.error('Hub 数据加载失败', e);
    } finally {
      if (typeof window.dismissHubLoadingOverlay === 'function') window.dismissHubLoadingOverlay();
      else if (typeof window.showHubLoading === 'function') window.showHubLoading(false);
    }
  });
}

function switchIndexHubPage(pageId, menuElement) {
    // 1. 隐藏所有页面
    const pages = document.querySelectorAll('.hub-page-container');
    pages.forEach(page => page.classList.remove('active'));

    // 2. 显示目标页面
    const targetPage = document.getElementById(pageId);
    if (targetPage) targetPage.classList.add('active');

    // 3. 更新左侧菜单的高亮状态
    if (menuElement) {
        const menuItems = document.querySelectorAll('.sidebar-menu-item');
        menuItems.forEach(item => item.classList.remove('active'));
        menuElement.classList.add('active');
    }

    // (如果目标页面内为空，可在未来调用外部 fetch 加载 html 文件内容)
}

function gmWalletOpenSend() {
    const modal = document.getElementById('gm-send-modal');
    if (modal) modal.classList.add('open');
}

function gmWalletCloseSend() {
    const modal = document.getElementById('gm-send-modal');
    if (modal) modal.classList.remove('open');
}

function gmWalletUpdatePreview() {
    const amountInput = document.getElementById('gm-send-amount');
    const toInput = document.getElementById('gm-send-to');
    const preview = document.getElementById('gm-send-preview');
    const after = document.getElementById('gm-pv-after');
    if (!amountInput || !toInput || !preview || !after) return;
    const amount = parseInt(amountInput.value, 10) || 0;
    const liveBalance = Number(window.AppState && window.AppState.user && window.AppState.user.gmBalance);
    const safeBalance = Number.isFinite(liveBalance) ? liveBalance : 0;
    if (amount > 0 && toInput.value.trim()) {
        preview.style.display = 'block';
        after.textContent = Math.max(0, safeBalance - amount) + ' GM';
    } else {
        preview.style.display = 'none';
    }
}

function gmWalletConfirmSend() {
    const amountInput = document.getElementById('gm-send-amount');
    const toInput = document.getElementById('gm-send-to');
    const amount = parseInt(amountInput ? amountInput.value : '0', 10) || 0;
    const target = toInput ? toInput.value.trim() : '';
    if (!target) {
        showToast('请输入收款方地址');
        return;
    }
    if (!amount || amount < 1) {
        showToast('请输入赠与数量');
        return;
    }
    const liveBalance = Number(window.AppState && window.AppState.user && window.AppState.user.gmBalance);
    const safeBalance = Number.isFinite(liveBalance) ? liveBalance : 0;
    if (amount > safeBalance) {
        showToast('余额不足');
        return;
    }
    gmWalletCloseSend();
    showToast('已赠出 ' + amount + ' GM · 链上存证中 · 等级不受影响');
}

function submitCustomsDeclaration() {
    const submitBtn = document.querySelector('#page-eu-customs .submit-btn');
    if (!submitBtn) return;
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = '提交中…';
    setTimeout(function () {
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
        showToast('✓ 已提交至 EU CBAM Registry · 实时确认 · 无需等待审核');
    }, 1800);
}

if (document.getElementById('hub-main-frame')) {
    /* V2.0 MPA: 旧 hub-iframe 残骸兼容 · 直接跳转至全域中心 */
    window.location.href = window.hengaiPage('全域中心.html');
}

// ═══════════════════════════════════════════════════════
// PAGE: CBAM CALC + KNOWLEDGE INTERACTIONS
// ═══════════════════════════════════════════════════════
let cbamGM = 0;
let cbamCalcResult = null;
let cbamCurrentStep = 1;

/** CBAM 粗测内核：cbam-calc-core.js（runCalc / previewSensitivity / Scope3 / 行业能耗辅助） */
(function wireCbamEnergyHelperOnLoad() {
    function bootEnergyHelper() {
        if (typeof window.initCbamScope3MaterialLinkage === 'function') {
            window.initCbamScope3MaterialLinkage();
        } else if (typeof window.updateEnergyHelper === 'function') {
            window.updateEnergyHelper();
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootEnergyHelper);
    } else {
        bootEnergyHelper();
    }
})();

function fmtK(n) {
    if (window.HengAICbamRough && window.HengAICbamRough.fmtK) return window.HengAICbamRough.fmtK(n);
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return Math.round(n / 1000) + 'k';
    return Math.round(n).toLocaleString();
}

function renderResults(r) {
    cbamCalcResult = r;
    window.cbamCalcResult = r;
    const main = document.getElementById('r-main');
    const total = document.getElementById('rb-total');
    const base = document.getElementById('rb-base');
    const ci = document.getElementById('rb-ci');
    if (main) main.textContent = '€ ' + fmtK(r.totalTax);
    if (total) total.textContent = '€ ' + fmtK(r.totalTax);
    if (base) base.textContent = '€ ' + fmtK(r.baseTax);
    if (ci) ci.textContent = r.ci.toFixed(3) + ' t/t';
    updateResultSensitivity(getMacroOracle().cbam_current_price);
}


function showSaveModal() { const m = document.getElementById('save-modal'); if (m) m.classList.add('show'); }
function genReport() { showToast('《全域升级报告》生成中，+15 GM'); }
function shareResult() { if (typeof openH5ShareModal === 'function') { openH5ShareModal(); } else { showToast('供应商邀请链接已生成，可分享至微信'); } }
function confirmSave() {
    const m = document.getElementById('save-modal');
    if (m) m.classList.remove('show');
    showToast('企业档案已建立 · +50 GM · 供应链协同已解锁');
}
function showHistory() { showToast('历史测算记录：共 1 条（当前）'); }
function resetAll() { goStep(1); cbamCalcResult = null; }

function toggleExpand(card) {
    const pts = card.querySelector('[id^="pts-"]');
    const hint = card.querySelector('.expand-hint');
    if (!pts) return;
    const open = pts.style.display !== 'none';
    pts.style.display = open ? 'none' : 'flex';
    if (hint) hint.innerHTML = open
        ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="2,4 5,7 8,4" stroke="var(--teal-l)" stroke-width="1.2" stroke-linecap="round"/></svg> 展开查看关键条款'
        : '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><polyline points="2,7 5,4 8,7" stroke="var(--teal-l)" stroke-width="1.2" stroke-linecap="round"/></svg> 收起';
}

function toggleFaq(item) {
    const wasOpen = item.classList.contains('open');
    document.querySelectorAll('#page-knowledge .faq-item').forEach(f => f.classList.remove('open'));
    if (!wasOpen) item.classList.add('open');
}

function setCat(el, cat) {
    document.querySelectorAll('#page-knowledge .cat-tab').forEach(t => t.className = 'cat-tab ct-off');
    if (el) el.className = 'cat-tab ct-active';
    const msg = cat === 'all' ? '显示全部法规' :
        cat === 'cbam' ? '筛选：CBAM 碳关税' :
        cat === 'esg' ? '筛选：ESG 披露' :
        cat === 'carbon' ? '筛选：碳排放交易' :
        cat === 'china' ? '筛选：中国政策' : '显示常见问题';
    showToast(msg);
}

function filterRegs(v) {
    if (v && v.trim()) showToast('AI 检索中：' + v.trim());
}

/** index 大厅：STATE_SYNCED 时刷新 .dyn-user-name（与 AppState.js 双保险，不调用 syncAppState 以免重入） */
(function wireAppJsDynUserOnStateSynced() {
    if (typeof window === 'undefined' || window.__hengaiAppJsDynUserSynced) return;
    function tryBind() {
        if (typeof EventBus === 'undefined' || !EventBus.on) return false;
        window.__hengaiAppJsDynUserSynced = true;
        EventBus.on('STATE_SYNCED', function () {
            try {
                var nm = String((window.AppState && window.AppState.user && window.AppState.user.name) || '---');
                document.querySelectorAll('.dyn-user-name').forEach(function (el) { el.textContent = nm; });
            } catch (_) {}
        });
        return true;
    }
    if (tryBind()) return;
    var n = 0;
    var id = setInterval(function () {
        n += 1;
        if (tryBind() || n > 200) clearInterval(id);
    }, 40);
})();

/** PIPL / GDPR 全局合规页脚（与 hengai-compliance.js 协同） */
(function wireHengaiComplianceAnchors() {
    function boot() {
        if (window.HengAICompliance && typeof window.HengAICompliance.init === 'function') {
            try { window.HengAICompliance.init(); } catch (_) {}
        } else if (window.HengAICompliance && typeof window.HengAICompliance.injectGlobalFooter === 'function') {
            try { window.HengAICompliance.injectGlobalFooter(); } catch (_) {}
        }
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();

/**
 * V3.5 · 八大高耗能行业工序精算蓝图（Heavy Industry Suite 唯一数据源）
 * 原始绝对能耗仅存 LOCAL_VAULT，不上传云端。
 */
window.HI_INDUSTRY_BLUEPRINT = {
  petro: {
    code: 'petro', display: '石化/化工', shortLabel: '石化',
    title: '石化/化工全工序链路', gdEts: true, cbamExpandWarning: true,
    sub: '原料预处理 → 蒸汽裂解 → 压缩分离 → 氧化合成 → 副产品回收 · 共 5 道',
    kpi: 'tCO₂e / 吨乙烯(或单品)', unitRing: 'tCO₂e/t', unitLabel: '单位产品碳强度',
    productLabel: '乙烯', bench: 1.856, best: 1.420, ringMax: 2.5, calcMode: 'standard',
    coreKpis: ['碳平衡系数', '副产品碳分摊'],
    intensityUnit: 'tCO2e/t',
    steps: [
      { name: '原料预处理', icon: '🛢', defaults: { ef: 0.78, energy: 1.15 } },
      { name: '蒸汽裂解', icon: '♨', defaults: { ef: 0.82, energy: 2.40 } },
      { name: '压缩与分离', icon: '⚙', defaults: { ef: 0.55, energy: 0.85 } },
      { name: '氧化/合成', icon: '⚗', defaults: { ef: 0.71, energy: 1.60 } },
      { name: '副产品回收', icon: '♻', defaults: { ef: 0.35, energy: 0.45 } },
    ],
  },
  paper: {
    code: 'paper', display: '造纸', shortLabel: '造纸',
    title: '造纸热电联产链路', gdEts: true,
    sub: '制浆 → 抄造 → 烘干 → 涂布整饰 · 共 4 道',
    kpi: 'tCO₂e / 吨纸', unitRing: 'tCO₂e/t', unitLabel: '单位产品碳强度',
    productLabel: '文化纸', bench: 0.920, best: 0.680, ringMax: 1.4, calcMode: 'standard',
    coreKpis: ['纸机单耗', '化石能源替代率'],
    intensityUnit: 'tCO2e/t',
    steps: [
      { name: '制浆', icon: '🌲', defaults: { ef: 0.68, energy: 1.20 } },
      { name: '抄造', icon: '📜', defaults: { ef: 0.52, energy: 0.95 } },
      { name: '烘干', icon: '💨', defaults: { ef: 0.75, energy: 2.10 } },
      { name: '涂布与整饰', icon: '✨', defaults: { ef: 0.48, energy: 0.55 } },
    ],
  },
  aviation: {
    code: 'aviation', display: '民航', shortLabel: '民航',
    title: '航段生命周期链路', gdEts: true,
    sub: '地面保障 → LTO循环 → 巡航 → 维保测试 · 共 4 道',
    kpi: 'tCO₂e / 吨公里 (RTK)', unitRing: 'tCO₂e/RTK', unitLabel: '吨公里碳强度',
    productLabel: '客运航段', bench: 0.000125, best: 0.000098, ringMax: 0.0002, calcMode: 'rtk',
    coreKpis: ['LTO 循环', '巡航油耗强度'],
    intensityUnit: 'tCO2e/RTK',
    steps: [
      { name: '地面保障', icon: '🛫', defaults: { ef: 3.15, energy: 0.12 } },
      { name: 'LTO循环', icon: '🔺', defaults: { ef: 3.15, energy: 0.28 } },
      { name: '巡航', icon: '✈', defaults: { ef: 3.15, energy: 0.52 } },
      { name: '维保与地面测试', icon: '🔧', defaults: { ef: 3.15, energy: 0.08 } },
    ],
  },
  ceramic: {
    code: 'ceramic', display: '陶瓷', shortLabel: '陶瓷',
    title: '陶瓷高温窑炉链路', gdEts: true, cbamExpandWarning: true,
    sub: '球磨干燥 → 成型施釉 → 窑炉烧成 → 抛光加工 · 共 4 道',
    kpi: 'tCO₂e / ㎡产品', unitRing: 'tCO₂e/m²', unitLabel: '单位面积碳强度',
    productLabel: '建筑陶瓷', bench: 0.680, best: 0.520, ringMax: 1.0, calcMode: 'area',
    coreKpis: ['窑炉单耗', '化石能源替代率'],
    intensityUnit: 'tCO2e/m2',
    steps: [
      { name: '球磨与喷雾干燥', icon: '🪨', defaults: { ef: 0.62, energy: 0.45 } },
      { name: '成型与施釉', icon: '🏺', defaults: { ef: 0.48, energy: 0.35 } },
      { name: '窑炉烧成', icon: '🔥', defaults: { ef: 0.85, energy: 1.85 } },
      { name: '抛光与成品加工', icon: '✨', defaults: { ef: 0.42, energy: 0.28 } },
    ],
  },
  port: {
    code: 'port', display: '交通/港口', shortLabel: '港口',
    title: '港口装卸物流链路', gdEts: true,
    sub: '岸电 → 水平运输 → 垂直装卸 → 仓储冷链 · 共 4 道',
    kpi: 'tCO₂e / TEU', unitRing: 'tCO₂e/TEU', unitLabel: '标准箱碳强度',
    productLabel: '集装箱吞吐', bench: 0.042, best: 0.028, ringMax: 0.08, calcMode: 'teu',
    coreKpis: ['岸电使用率', '水平运输 electrification'],
    intensityUnit: 'tCO2e/TEU',
    steps: [
      { name: '船舶靠泊供电', icon: '⚓', defaults: { ef: 0.58, energy: 0.22 } },
      { name: '水平运输', icon: '🚛', defaults: { ef: 0.72, energy: 0.48 } },
      { name: '垂直装卸', icon: '🏗', defaults: { ef: 0.55, energy: 0.65 } },
      { name: '仓储冷链与辅助', icon: '❄', defaults: { ef: 0.61, energy: 0.35 } },
    ],
  },
  idc: {
    code: 'idc', display: '数据中心', shortLabel: '数据中心',
    title: '数据中心能效链路', gdEts: true,
    sub: 'IT负载 → 制冷 → 供配电 → 柴发备用 · 共 4 道',
    kpi: 'PUE & tCO₂e/算力单元', unitRing: 'PUE', unitLabel: 'PUE 与算力碳强度',
    productLabel: '算力集群', bench: 1.45, best: 1.25, ringMax: 2.0, calcMode: 'idc',
    coreKpis: ['PUE值', '绿电消纳率', '算力碳强度'],
    intensityUnit: 'PUE',
    steps: [
      { name: 'IT负载运行', icon: '🖥', defaults: { ef: 0.000581, energy: 1.0 } },
      { name: '制冷系统', icon: '❄', defaults: { ef: 0.000581, energy: 0.35 } },
      { name: '供配电系统', icon: '⚡', defaults: { ef: 0.000581, energy: 0.12 } },
      { name: '柴油发电机组', icon: '⛽', defaults: { ef: 0.000581, energy: 0.05 } },
    ],
  },
  steel: {
    code: 'steel', display: '钢铁', shortLabel: '钢铁',
    title: '钢铁全工序链路 (CISA 1-9)', gdEts: true,
    sub: '焦化 → 球团 → 烧结 → 炼铁 → 炼钢 → 转炉 → 电炉 → 掺烧 → 其他 · 共 9 道',
    kpi: 'tCO₂e / 吨钢', unitRing: 'tCO₂e/t', unitLabel: '单位产品碳强度',
    productLabel: '钢铁综合', bench: 2.156, best: 1.650, ringMax: 3.5, calcMode: 'standard',
    coreKpis: ['工序能耗', 'Scope1 直排'],
    intensityUnit: 'tCO2e/t',
    steps: [
      { name: '焦化', icon: '♨', defaults: { ef: 0.92, energy: 1.10 } },
      { name: '球团', icon: '⚙', defaults: { ef: 0.88, energy: 0.45 } },
      { name: '烧结', icon: '🔥', defaults: { ef: 0.85, energy: 0.38 } },
      { name: '炼铁', icon: '🏭', defaults: { ef: 0.82, energy: 0.55 } },
      { name: '炼钢', icon: '🔩', defaults: { ef: 0.78, energy: 0.42 } },
      { name: '转炉', icon: '🔄', defaults: { ef: 0.75, energy: 0.12 } },
      { name: '电炉', icon: '⚡', defaults: { ef: 0.72, energy: 0.35 } },
      { name: '掺烧等', icon: '🔀', defaults: { ef: 0.68, energy: 0.08 } },
      { name: '其他工序', icon: '📏', defaults: { ef: 0.95, energy: 0.22 } },
    ],
  },
  cement: {
    code: 'cement', display: '水泥', shortLabel: '水泥',
    title: '水泥熟料煅烧链路', gdEts: true,
    sub: '生料准备 → 熟料煅烧 → 水泥粉磨 · 共 3 道',
    kpi: 'tCO₂e / 吨熟料', unitRing: 'tCO₂e/t', unitLabel: '单位熟料碳强度',
    productLabel: '硅酸盐水泥', bench: 0.820, best: 0.650, ringMax: 1.2, calcMode: 'standard',
    coreKpis: ['石灰石脱碳', '熟料系数'],
    intensityUnit: 'tCO2e/t',
    steps: [
      { name: '生料准备', icon: '🪨', defaults: { ef: 0.12, energy: 1.0 } },
      { name: '熟料煅烧', icon: '🔥', defaults: { ef: 0.82, energy: 0.65 } },
      { name: '水泥粉磨', icon: '🏗', defaults: { ef: 0.05, energy: 1.0 } },
    ],
  },
};
window.HI_INDUSTRY_ORDER = ['petro', 'paper', 'aviation', 'ceramic', 'port', 'idc', 'steel', 'cement'];

/**
 * CBAM · 组装业上游原料缺省库（汽车 / 机械 / 电子）
 * value = tCO₂e / 计量单位；缺省测算含 20% 安全边际（见 cbam-calc-core.js）
 */
window.ASSEMBLY_INDUSTRY_MAP = {
  automotive: [
    { label: '车身用高强钢', value: 2.45, unit: 't' },
    { label: '压铸铝合金', value: 12.8, unit: 't' },
    { label: '动力电池 (LFP)', value: 82.0, unit: 'kWh' },
    { label: '工程塑料 (PP/PA)', value: 3.85, unit: 't' },
  ],
  machinery: [
    { label: '铸铁件', value: 1.95, unit: 't' },
    { label: '特种合金钢', value: 5.10, unit: 't' },
    { label: '重型锻件', value: 2.80, unit: 't' },
  ],
  electronics: [
    { label: '多层 PCB 板', value: 45.2, unit: 'sqm' },
    { label: '精炼电解铜', value: 4.50, unit: 't' },
    { label: '逻辑芯片 (组件)', value: 0.85, unit: 'unit' },
  ],
};
window.CHINA_DEFAULT_FACTOR_SAFETY_MARGIN = 1.2;
