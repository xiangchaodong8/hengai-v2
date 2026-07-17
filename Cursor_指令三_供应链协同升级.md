# Cursor 指令三：供应链协同 升级
## 适用文件：HengAI_供应链协同.html
## 任务：上游申报 · 因子质量状态 · 主权共振入口 · 批次核验衔接 · 视角切换

---

## 【背景】

本次升级将供应链协同从"供应商数据收集工具"升级为
"供应链碳数据全链路管理中枢"，打通与以下模块的数据联动：

- 工业原厂·因子精算：上游申报触发因子匹配请求
- 核验：供应商数据完整后自然衔接批次核验
- CBAM测算工具：接收因子缺失标记，引导用户申报
- AppState：consumptionLedger / supplyChainBinding（指令一已定义）

执行本指令前，请确认指令一（AppState扩展）已完成。

---

## 【第一步：AppState 供应链协同命名空间扩展】

在 MOCK_STATE 的 suppliers 数组每个元素中追加以下字段：

```javascript
// 每个 supplier 对象新增字段
{
  // ── 原有字段保持不变 ──
  id: 'SUP-001',
  name: '深圳华锐金属',
  contact: '...',
  status: 'submitted',    // pending | submitted | overdue
  carbonFactor: 1.76,

  // ── 新增：上游原料申报 ──
  upstreamDeclaration: {
    materialType: '铝锭',         // 原料类型（合规人员填写）
    sourceName: null,             // 原厂名称（管理员填写，合规人员不可见）
    sourceAnonymousId: null,      // 原厂匿名ID（系统分配）
    factorStatus: 'industry_avg', // 'lv4_certified'|'industry_avg'|'missing'|'resonating'
    matchedFactor: null,          // 匹配到的确权因子值
    declaredAt: null,             // 申报时间
    resonanceJoined: false        // 是否加入主权共振队列
  },

  // ── 新增：数据质量评分 ──
  dataQualityScore: 0,  // 0-100，综合评分
  dataQualityLevel: 'missing'  // 'lv4'|'industry_avg'|'missing'|'resonating'
}
```

在 MOCK_STATE 顶层追加供应链整体状态：

```javascript
supplyChain: {
  // 整体碳数据质量评分
  qualityScore: 78,
  lv4CertifiedPct: 43,   // Lv.4认证覆盖率
  industryAvgPct: 35,    // 行业均值覆盖率
  missingPct: 22,        // 缺失覆盖率

  // 视角切换状态
  currentView: 'downstream',  // 'downstream'（我的供应商）| 'upstream'（我的上游来源）

  // 上游来源申报（我作为下游企业，申报我的上游原料来源）
  upstreamSources: [
    // {
    //   id: 'UPS-001',
    //   materialType: '铝锭',
    //   sourceName: null,        // 原厂名称（管理员填写）
    //   factorStatus: 'missing',
    //   resonanceJoined: false,
    //   taxRiskEur: 85000        // 因缺失因子导致的税款风险
    // }
  ],

  // 主权共振状态
  resonanceGroups: [
    // {
    //   factoryAnonymousId: 'FAC-007',
    //   materialType: '铝锭',
    //   participantCount: 3,     // 加入该共振的供应商数量
    //   totalTaxRiskEur: 128000, // 累计碳税风险
    //   status: 'pending',       // 'pending'|'sent'|'responded'
    //   sentAt: null
    // }
  ]
}
```

---

## 【第二步：页面顶部新增视角切换 + 质量评分面板】

在现有 topbar 之后、主内容之前，插入以下区块：

```html
<!-- ══ 视角切换 ══ -->
<div style="display:flex;gap:8px;padding:12px 18px;
  border-bottom:1px solid var(--border);background:var(--bg1)">
  <button class="view-tab on" id="vtab-downstream"
    onclick="switchView('downstream')">
    ↓ 我的供应商（向下管理）
  </button>
  <button class="view-tab" id="vtab-upstream"
    onclick="switchView('upstream')">
    ↑ 我的上游来源（向上申报）
  </button>
</div>
```

在 `<style>` 中追加视角切换样式：

```css
.view-tab {
  padding: 7px 18px;
  border-radius: 9px;
  border: 1px solid var(--border2);
  background: var(--bg3);
  color: var(--ink2);
  font-size: 12px;
  cursor: pointer;
  font-family: 'Noto Sans SC', sans-serif;
  font-weight: 500;
  transition: all .14s;
}
.view-tab:hover { border-color: var(--teal-b); color: var(--teal-l); }
.view-tab.on {
  background: var(--teal-d);
  border-color: var(--teal-b);
  color: var(--teal-l);
  font-weight: 700;
}
```

---

## 【第三步：新增主权共振状态面板 HTML】

在主内容区域顶部（供应商列表之前）插入，初始仅在有共振数据时显示：

```html
<!-- ══ 主权共振状态面板（有共振数据时显示）══ -->
<div id="resonance-panel" style="display:none;
  background:rgba(249,115,22,.06);
  border:1.5px solid rgba(249,115,22,.28);
  border-radius:14px;padding:16px;margin-bottom:14px">
  <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
    <div style="width:9px;height:9px;border-radius:50%;
      background:var(--orange);animation:blink 1s infinite;
      flex-shrink:0"></div>
    <span style="font-size:14px;font-weight:700;
      color:var(--orange-l)">产业链主权共振</span>
    <span class="pill p-o" id="resonance-group-count">0 组</span>
  </div>

  <div id="resonance-groups-list">
    <!-- 由 renderResonanceGroups() 填充 -->
  </div>

  <button onclick="launchResonance()"
    style="width:100%;margin-top:10px;padding:10px;
      border-radius:10px;border:none;background:var(--orange);
      color:#fff;font-size:13px;font-weight:700;cursor:pointer;
      font-family:'Noto Sans SC',sans-serif">
    ⚡ 联合发起主权共振请求
  </button>
</div>
```

---

## 【第四步：供应商列表新增因子质量状态列】

找到现有供应商行的渲染函数（通常是 `renderSupplierList()` 或类似命名），
在每行追加因子质量状态显示。

在供应商行 HTML 模板中，在现有状态标签之后追加：

```javascript
// 在 renderSupplierList() 的 supplier 行模板中追加
function getFactorStatusBadge(supplier) {
  var s = supplier.upstreamDeclaration;
  if (!s) return '<span class="pill" style="background:var(--red-d);' +
    'color:var(--red-l);border-color:var(--red-b);font-size:9.5px">' +
    '未申报</span>';

  var configs = {
    'lv4_certified': {
      cls: 'p-g', icon: '🟢',
      txt: 'Lv.4确权',
      tip: '上游原厂已入因子池，使用认证因子'
    },
    'industry_avg': {
      cls: 'p-y', icon: '🟡',
      txt: '行业均值',
      tip: '使用行业平均值，存在税款高估风险'
    },
    'resonating': {
      cls: 'p-o', icon: '⚡',
      txt: '共振中',
      tip: '已发起因子请求，等待原厂响应'
    },
    'missing': {
      cls: 'p-r', icon: '🔴',
      txt: '因子缺失',
      tip: '未申报上游来源，碳数据不完整'
    }
  };
  var cfg = configs[s.factorStatus] || configs['missing'];
  return '<span class="pill ' + cfg.cls + '" title="' + cfg.tip +
    '" style="font-size:9.5px">' + cfg.icon + ' ' + cfg.txt + '</span>';
}
```

在每个供应商行的现有状态 pill 后追加调用：

```javascript
// 在供应商行模板末尾追加
'<div style="margin-top:6px;display:flex;align-items:center;gap:8px">' +
  getFactorStatusBadge(supplier) +
  (supplier.upstreamDeclaration &&
   supplier.upstreamDeclaration.materialType ?
    '<span style="font-size:10.5px;color:var(--ink3)">↑ ' +
      supplier.upstreamDeclaration.materialType + '</span>' : '') +
  '<button onclick="openUpstreamDeclare(\'' + supplier.id + '\')" ' +
    'style="margin-left:auto;padding:2px 8px;border-radius:6px;' +
      'border:1px solid var(--border2);background:var(--bg4);' +
      'color:var(--ink3);font-size:10px;cursor:pointer;' +
      'font-family:\'Noto Sans SC\',sans-serif">申报上游</button>' +
'</div>'
```

---

## 【第五步：新增供应链碳数据质量评分面板 HTML】

在主内容区域，供应商列表卡片的顶部插入：

```html
<!-- ══ 供应链碳数据质量评分 ══ -->
<div style="background:var(--bg3);border:1px solid var(--border);
  border-radius:12px;padding:14px 16px;margin-bottom:14px"
  id="quality-score-panel">
  <div style="display:flex;align-items:center;
    justify-content:space-between;margin-bottom:10px">
    <div>
      <div style="font-size:12px;font-weight:700;margin-bottom:2px">
        供应链碳数据质量评分
      </div>
      <div style="font-size:10.5px;color:var(--ink3)">
        评分影响 CBAM 申报精度和节税空间
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-family:'DM Mono',monospace;font-size:28px;
        font-weight:700;line-height:1" id="quality-score-val">
        0
      </div>
      <div style="font-size:10px;color:var(--ink3)">/ 100</div>
    </div>
  </div>

  <!-- 进度条组 -->
  <div style="display:flex;flex-direction:column;gap:6px">
    <!-- Lv.4认证 -->
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:11px;color:var(--green-l);width:80px;
        flex-shrink:0">🟢 Lv.4认证</span>
      <div style="flex:1;height:5px;background:var(--bg4);
        border-radius:999px;overflow:hidden">
        <div id="bar-lv4" style="height:100%;background:var(--green);
          border-radius:999px;transition:width .7s ease;width:0%"></div>
      </div>
      <span style="font-family:'DM Mono',monospace;font-size:11px;
        color:var(--green-l);width:30px;text-align:right"
        id="pct-lv4">0%</span>
    </div>
    <!-- 行业均值 -->
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:11px;color:var(--gold-l);width:80px;
        flex-shrink:0">🟡 行业均值</span>
      <div style="flex:1;height:5px;background:var(--bg4);
        border-radius:999px;overflow:hidden">
        <div id="bar-avg" style="height:100%;background:var(--gold);
          border-radius:999px;transition:width .7s ease;width:0%"></div>
      </div>
      <span style="font-family:'DM Mono',monospace;font-size:11px;
        color:var(--gold-l);width:30px;text-align:right"
        id="pct-avg">0%</span>
    </div>
    <!-- 缺失 -->
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:11px;color:var(--red-l);width:80px;
        flex-shrink:0">🔴 缺失</span>
      <div style="flex:1;height:5px;background:var(--bg4);
        border-radius:999px;overflow:hidden">
        <div id="bar-missing" style="height:100%;background:var(--red);
          border-radius:999px;transition:width .7s ease;width:0%"></div>
      </div>
      <span style="font-family:'DM Mono',monospace;font-size:11px;
        color:var(--red-l);width:30px;text-align:right"
        id="pct-missing">0%</span>
    </div>
  </div>

  <!-- 达标提示 & 核验入口 -->
  <div id="quality-action" style="margin-top:12px"></div>
</div>
```

---

## 【第六步：上游申报弹窗 HTML】

```html
<!-- 上游原料申报弹窗 -->
<div style="position:fixed;inset:0;background:rgba(0,0,0,.75);
  backdrop-filter:blur(6px);z-index:1000;display:flex;
  align-items:center;justify-content:center;
  opacity:0;pointer-events:none;transition:opacity .2s"
  id="upstream-declare-modal">
  <div style="background:var(--bg2);border:1px solid var(--border2);
    border-radius:18px;padding:24px;width:460px;
    max-width:calc(100vw - 32px);position:relative">
    <button onclick="closeUpstreamDeclare()"
      style="position:absolute;top:14px;right:14px;width:26px;height:26px;
        border-radius:50%;background:var(--bg4);border:1px solid var(--border);
        color:var(--ink2);font-size:13px;cursor:pointer;
        display:flex;align-items:center;justify-content:center">✕</button>

    <div style="font-size:15px;font-weight:700;margin-bottom:4px">
      申报上游原料来源
    </div>
    <div style="font-size:12px;color:var(--ink2);margin-bottom:16px;
      line-height:1.65">
      申报后系统将自动从公共因子核验池中匹配认证因子。
      <br>
      <span style="color:var(--ink3)">
        注：原厂名称由管理员填写，合规人员仅填写原料类型。
      </span>
    </div>

    <!-- 原料类型（合规人员填写） -->
    <div style="margin-bottom:12px">
      <label style="display:block;font-size:10.5px;color:var(--ink3);
        margin-bottom:5px;font-weight:500">
        原料类型（必填）
      </label>
      <select id="ud-material-type"
        style="width:100%;padding:8px 11px;background:var(--bg1);
          border:1px solid var(--border2);border-radius:8px;
          color:var(--ink);font-size:12.5px;outline:none;
          font-family:'Noto Sans SC',sans-serif">
        <option value="">请选择原料类型</option>
        <option value="铝锭">铝锭</option>
        <option value="钢材/钢锭">钢材/钢锭</option>
        <option value="铝型材">铝型材</option>
        <option value="铸铁件">铸铁件</option>
        <option value="水泥">水泥</option>
        <option value="化工原料">化工原料</option>
        <option value="其他">其他（手动输入）</option>
      </select>
    </div>

    <!-- 原厂名称（管理员专属，合规人员视图隐藏） -->
    <div class="admin-only" id="ud-source-row"
      style="display:none;margin-bottom:12px">
      <label style="display:block;font-size:10.5px;color:var(--ink3);
        margin-bottom:5px;font-weight:500">
        上游原厂名称（管理员填写，合规人员不可见）
      </label>
      <input id="ud-source-name"
        style="width:100%;padding:8px 11px;background:var(--bg1);
          border:1px solid var(--border2);border-radius:8px;
          color:var(--ink);font-size:12.5px;outline:none;
          font-family:'Noto Sans SC',sans-serif"
        placeholder="如：宝武钢铁武汉分厂">
    </div>

    <!-- 加入主权共振选项 -->
    <div style="padding:10px 14px;background:var(--orange-d);
      border:1px solid var(--orange-b);border-radius:9px;
      margin-bottom:16px;font-size:12px;color:var(--orange-l);
      display:flex;align-items:center;gap:10px">
      <input type="checkbox" id="ud-join-resonance"
        style="width:14px;height:14px;flex-shrink:0">
      <label for="ud-join-resonance" style="cursor:pointer;line-height:1.5">
        若该原厂未在因子池中，自动加入
        <strong>主权共振队列</strong>，联合向原厂发起因子确权请求
      </label>
    </div>

    <button onclick="saveUpstreamDeclaration()"
      style="width:100%;padding:11px;border-radius:10px;border:none;
        background:var(--teal);color:#fff;font-size:13px;font-weight:700;
        cursor:pointer;font-family:'Noto Sans SC',sans-serif">
      确认申报，触发因子匹配
    </button>
  </div>
</div>
```

---

## 【第七步：上游申报视图（视角切换后的界面）HTML】

当用户切换到"上游来源申报"视角时，显示此区块，隐藏供应商列表：

```html
<!-- 上游来源申报视图（默认隐藏） -->
<div id="view-upstream" style="display:none">

  <div style="background:var(--bg2);border:1px solid var(--border);
    border-radius:14px;padding:16px;margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;
      margin-bottom:12px">
      <div>
        <div style="font-size:13px;font-weight:700;margin-bottom:2px">
          我的上游原料来源申报
        </div>
        <div style="font-size:11.5px;color:var(--ink2)">
          申报您所使用的上游原料及其来源原厂，
          系统将自动匹配认证因子，降低 CBAM 税款
        </div>
      </div>
      <button onclick="addUpstreamSource()"
        style="padding:7px 14px;border-radius:8px;
          border:1px solid var(--teal-b);background:var(--teal-d);
          color:var(--teal-l);font-size:12px;cursor:pointer;
          font-family:'Noto Sans SC',sans-serif;white-space:nowrap">
        + 新增原料来源
      </button>
    </div>

    <div id="upstream-sources-list">
      <!-- 由 renderUpstreamSources() 填充 -->
    </div>
  </div>

</div>
```

---

## 【第八步：新增 JavaScript 函数】

在 `<script>` 标签内追加以下函数：

```javascript
/* ══ 视角切换 ══ */
function switchView(view) {
  var isDownstream = view === 'downstream';

  // 切换 tab 样式
  ['downstream', 'upstream'].forEach(function(v) {
    var t = document.getElementById('vtab-' + v);
    if (t) t.className = 'view-tab' + (v === view ? ' on' : '');
  });

  // 切换视图显示
  var downstream = document.getElementById('view-downstream');
  var upstream = document.getElementById('view-upstream');
  if (downstream) downstream.style.display = isDownstream ? '' : 'none';
  if (upstream) upstream.style.display = isDownstream ? 'none' : '';

  // 更新 AppState
  if (window.AppState && typeof AppState.update === 'function') {
    AppState.update('supplyChain.currentView', view);
    AppState.save();
  }
}

/* ══ 质量评分渲染 ══ */
function renderQualityScore(sc) {
  if (!sc) return;
  setText('quality-score-val', sc.qualityScore || 0);

  // 进度条动画
  setTimeout(function() {
    var setBar = function(id, pct) {
      var el = document.getElementById(id);
      if (el) el.style.width = (pct || 0) + '%';
    };
    setBar('bar-lv4',    sc.lv4CertifiedPct || 0);
    setBar('bar-avg',    sc.industryAvgPct  || 0);
    setBar('bar-missing',sc.missingPct       || 0);
  }, 200);

  setText('pct-lv4',     (sc.lv4CertifiedPct || 0) + '%');
  setText('pct-avg',     (sc.industryAvgPct  || 0) + '%');
  setText('pct-missing', (sc.missingPct      || 0) + '%');

  // 达标提示 & 批次核验入口
  var actionEl = document.getElementById('quality-action');
  if (!actionEl) return;
  var score = sc.qualityScore || 0;
  if (score >= 80) {
    actionEl.innerHTML =
      '<div style="padding:10px 14px;background:var(--green-d);' +
        'border:1px solid var(--green-b);border-radius:9px;' +
        'display:flex;align-items:center;justify-content:space-between">' +
        '<span style="font-size:12px;color:var(--green-l)">' +
          '✓ 供应商数据达到核验标准（评分 ' + score + ' 分）' +
        '</span>' +
        '<button onclick="nav(\'HengAI_核验.html\')" ' +
          'style="padding:6px 14px;border-radius:7px;border:none;' +
            'background:var(--green);color:#fff;font-size:12px;' +
            'font-weight:700;cursor:pointer;white-space:nowrap;' +
            'font-family:\'Noto Sans SC\',sans-serif">' +
          '发起批次核验 →' +
        '</button>' +
      '</div>';
  } else {
    actionEl.innerHTML =
      '<div style="padding:10px 14px;background:var(--bg3);' +
        'border:1px solid var(--border);border-radius:9px;' +
        'font-size:11.5px;color:var(--ink3);line-height:1.65">' +
        '评分达到 80 分后可发起批次核验。' +
        '当前缺口：' + (sc.missingPct || 0) + '% 供应商未完成因子申报，' +
        '建议优先推动主权共振或补充上游申报。' +
      '</div>';
  }
}

/* ══ 主权共振渲染 ══ */
function renderResonanceGroups(groups) {
  var panel = document.getElementById('resonance-panel');
  var list = document.getElementById('resonance-groups-list');
  if (!panel || !list) return;

  if (!groups || !groups.length) {
    panel.style.display = 'none';
    return;
  }

  panel.style.display = 'block';
  setText('resonance-group-count', groups.length + ' 组');

  list.innerHTML = groups.map(function(g) {
    var statusText = {
      pending: '待发起',
      sent: '已发送，等待响应',
      responded: '原厂已响应 ✓'
    }[g.status] || '待发起';
    var statusColor = {
      pending: 'var(--orange-l)',
      sent: 'var(--gold-l)',
      responded: 'var(--green-l)'
    }[g.status] || 'var(--orange-l)';

    return '<div style="padding:10px 13px;background:var(--bg3);' +
      'border:1px solid var(--border);border-radius:9px;margin-bottom:8px">' +
      '<div style="display:flex;justify-content:space-between;' +
        'align-items:center;margin-bottom:5px">' +
        '<span style="font-size:12px;font-weight:600">' +
          g.materialType + ' · ' + g.participantCount + '家供应商联合</span>' +
        '<span style="font-size:11px;color:' + statusColor + '">' +
          statusText + '</span>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--ink2)">' +
        '累计碳税风险敞口：<strong style="color:var(--red-l)">€' +
          (g.totalTaxRiskEur / 1000).toFixed(0) + 'k</strong>' +
        ' · 若原厂响应并入池，可直接消除此风险' +
      '</div>' +
    '</div>';
  }).join('');
}

function launchResonance() {
  var groups = getPath(window.AppState, 'supplyChain.resonanceGroups') || [];
  var pending = groups.filter(function(g) { return g.status === 'pending'; });
  if (!pending.length) {
    showToast('暂无待发起的主权共振请求');
    return;
  }
  if (window.AppState && typeof AppState.update === 'function') {
    var updated = groups.map(function(g) {
      if (g.status === 'pending') {
        // [CURSOR缝合点] 发射主权共振事件到工业原厂精算模块
        EventBus.emit('SOVEREIGNTY_RESONANCE', {
          factoryAnonymousId: g.factoryAnonymousId,
          count: g.participantCount,
          industry: g.materialType,
          taxRisk: g.totalTaxRiskEur
        });
        return Object.assign({}, g, {
          status: 'sent',
          sentAt: new Date().toISOString()
        });
      }
      return g;
    });
    AppState.update('supplyChain.resonanceGroups', updated);
    AppState.save();
  }
  showToast('✓ 主权共振请求已发出，' + pending.length +
    ' 组请求将显示在原厂的产业链诉求热力图中');
}

/* ══ 上游申报弹窗 ══ */
var currentDeclareSupId = null;

function openUpstreamDeclare(supId) {
  currentDeclareSupId = supId;
  var modal = document.getElementById('upstream-declare-modal');
  if (modal) {
    modal.style.opacity = '1';
    modal.style.pointerEvents = 'all';
  }
  // 角色权限：管理员显示原厂名称输入
  var isAdmin = getPath(window.AppState, 'company.roleLevel') === 'admin';
  var sourceRow = document.getElementById('ud-source-row');
  if (sourceRow) sourceRow.style.display = isAdmin ? '' : 'none';
}

function closeUpstreamDeclare() {
  var modal = document.getElementById('upstream-declare-modal');
  if (modal) {
    modal.style.opacity = '0';
    modal.style.pointerEvents = 'none';
  }
  currentDeclareSupId = null;
}

function saveUpstreamDeclaration() {
  var materialType = (document.getElementById('ud-material-type') || {}).value;
  var sourceName = (document.getElementById('ud-source-name') || {}).value || null;
  var joinResonance = (document.getElementById('ud-join-resonance') || {}).checked;

  if (!materialType) { showToast('请选择原料类型'); return; }

  if (window.AppState && typeof AppState.update === 'function') {
    var suppliers = getPath(AppState, 'suppliers') || [];
    var idx = suppliers.findIndex(function(s) {
      return s.id === currentDeclareSupId;
    });
    if (idx >= 0) {
      suppliers[idx].upstreamDeclaration = {
        materialType: materialType,
        sourceName: sourceName,         // 管理员可见，合规人员不可见
        sourceAnonymousId: null,        // 后端分配
        factorStatus: joinResonance ? 'resonating' : 'industry_avg',
        matchedFactor: null,
        declaredAt: new Date().toISOString(),
        resonanceJoined: joinResonance
      };
      AppState.update('suppliers', suppliers);

      // 若加入共振，更新共振队列
      if (joinResonance) {
        var groups = getPath(AppState, 'supplyChain.resonanceGroups') || [];
        var existing = groups.find(function(g) {
          return g.materialType === materialType;
        });
        if (existing) {
          existing.participantCount += 1;
        } else {
          groups.push({
            factoryAnonymousId: 'FAC-PENDING-' + Date.now(),
            materialType: materialType,
            participantCount: 1,
            totalTaxRiskEur: 85000,  // 估算值，后端精确计算
            status: 'pending',
            sentAt: null
          });
        }
        AppState.update('supplyChain.resonanceGroups', groups);
      }

      AppState.save();
    }
  }

  closeUpstreamDeclare();
  showToast('✓ 上游原料申报已保存，系统正在匹配因子池...');
}

/* ══ 上游来源视图渲染 ══ */
function renderUpstreamSources(sources) {
  var el = document.getElementById('upstream-sources-list');
  if (!el) return;
  if (!sources || !sources.length) {
    el.innerHTML = '<div style="color:var(--ink3);font-size:12px;' +
      'text-align:center;padding:20px">' +
      '尚未申报上游原料来源<br>' +
      '<span style="font-size:11px">申报后系统将自动匹配认证因子</span>' +
    '</div>';
    return;
  }
  el.innerHTML = sources.map(function(s) {
    var statusCfg = {
      'lv4_certified': { color: 'var(--green-l)', icon: '🟢', txt: 'Lv.4已认证' },
      'industry_avg':  { color: 'var(--gold-l)',  icon: '🟡', txt: '使用行业均值' },
      'resonating':    { color: 'var(--orange-l)',icon: '⚡', txt: '共振请求中' },
      'missing':       { color: 'var(--red-l)',   icon: '🔴', txt: '因子缺失' }
    }[s.factorStatus] || { color: 'var(--ink3)', icon: '—', txt: '未知' };

    return '<div style="padding:12px 14px;background:var(--bg3);' +
      'border:1px solid var(--border);border-radius:10px;margin-bottom:8px">' +
      '<div style="display:flex;justify-content:space-between;' +
        'align-items:center;margin-bottom:5px">' +
        '<span style="font-size:13px;font-weight:600">' +
          s.materialType + '</span>' +
        '<span style="font-size:11px;color:' + statusCfg.color + '">' +
          statusCfg.icon + ' ' + statusCfg.txt + '</span>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--ink3)">' +
        '税款风险：<strong style="color:var(--red-l)">€' +
          ((s.taxRiskEur || 0) / 1000).toFixed(0) + 'k/年</strong>' +
        (s.factorStatus === 'lv4_certified' ?
          ' · <span style="color:var(--green-l)">已通过认证因子优化</span>' : '') +
      '</div>' +
    '</div>';
  }).join('');
}

/* ══ updateModuleUI 扩展（追加到现有函数末尾）══ */
// 在现有 updateModuleUI(state) 函数末尾追加：
function updateSupplyChainExtensions(state) {
  var sc = getPath(state, 'supplyChain') || {};
  renderQualityScore(sc);
  renderResonanceGroups(sc.resonanceGroups || []);
  renderUpstreamSources(sc.upstreamSources || []);
}
```

---

## 【第九步：EventBus 钩子追加】

在现有 `hookBus()` 函数中追加：

```javascript
// [CURSOR缝合点] 监听工业原厂因子入池事件
// 原厂入池后，更新相关供应商的因子状态
EventBus.on('FACTOR_POOL_UPDATED', function(payload) {
  if (!window.AppState) return;
  var suppliers = getPath(AppState, 'suppliers') || [];
  var updated = false;
  suppliers.forEach(function(s) {
    if (s.upstreamDeclaration &&
        s.upstreamDeclaration.materialType === payload.industry) {
      s.upstreamDeclaration.factorStatus = 'lv4_certified';
      s.upstreamDeclaration.matchedFactor = payload.factor;
      s.dataQualityLevel = 'lv4';
      updated = true;
    }
  });
  if (updated) {
    AppState.update('suppliers', suppliers);
    // 重新计算质量评分
    recalcQualityScore();
    AppState.save();
    showToast('✓ 原厂因子已更新，' +
      suppliers.filter(function(s) {
        return s.upstreamDeclaration &&
               s.upstreamDeclaration.factorStatus === 'lv4_certified';
      }).length + ' 家供应商因子状态升级为 Lv.4 认证');
  }
});

// [CURSOR缝合点] 供应商数据提交完成后通知核验模块
// 在供应商 H5 数据保存到 AppState 后触发
function notifySupplierDataReady(supplierId, supplierName, factor) {
  EventBus.emit('SUPPLIER_DATA_READY', {
    batchId: getPath(AppState, 'currentBatchId') || null,
    supplierId: supplierId,
    supplierName: supplierName,
    factor: factor
  });
}

// 质量评分重新计算
function recalcQualityScore() {
  var suppliers = getPath(AppState, 'suppliers') || [];
  if (!suppliers.length) return;
  var lv4 = 0, avg = 0, missing = 0;
  suppliers.forEach(function(s) {
    var level = s.dataQualityLevel || 'missing';
    if (level === 'lv4') lv4++;
    else if (level === 'industry_avg') avg++;
    else missing++;
  });
  var total = suppliers.length;
  var score = Math.round((lv4 / total) * 60 + (avg / total) * 30);
  AppState.update('supplyChain.qualityScore', score);
  AppState.update('supplyChain.lv4CertifiedPct',
    Math.round(lv4 / total * 100));
  AppState.update('supplyChain.industryAvgPct',
    Math.round(avg / total * 100));
  AppState.update('supplyChain.missingPct',
    Math.round(missing / total * 100));
}
```

---

## 【注意事项】

| 序号 | 注意点 | 说明 |
|------|--------|------|
| 1 | **上游来源的原厂名称字段** | `sourceName` 仅在 `roleLevel === 'admin'` 时显示，合规人员只能填原料类型 |
| 2 | **主权共振阈值** | 当同一材料类型的共振参与数 ≥ 3 时，"联合发起"按钮高亮为强调色，提升用户行动意愿 |
| 3 | **质量评分算法** | Lv.4认证每家供应商贡献60分权重，行业均值30分，缺失0分，按比例加权计算总分 |
| 4 | **视图切换不影响数据** | 切换视角仅影响 UI 展示，供应商数据和上游来源数据同时存在于 AppState |
| 5 | **供应链申报与因子绑定** | `saveUpstreamDeclaration()` 保存后，核验模块的 `checkUpstreamDeclaration()` 校验才能通过 |
| 6 | **批次核验入口的触发条件** | qualityScore ≥ 80 时才显示"发起批次核验"按钮，避免数据不完整时跳转 |

---

## 【完整数据流（三模块联动）】

```
供应链协同（申报上游来源）
  → saveUpstreamDeclaration()
  → resonanceJoined=true → resonanceGroups 更新
  → launchResonance()
  → EventBus.emit('SOVEREIGNTY_RESONANCE')
      ↓
工业原厂精算（收到共振请求）
  → 热力图更新，waitingCount++
  → 原厂完成精算，submitPool()
  → EventBus.emit('FACTOR_POOL_UPDATED')
      ↓
供应链协同（监听因子入池）
  → 对应供应商 factorStatus → 'lv4_certified'
  → recalcQualityScore()
  → qualityScore ≥ 80 → 显示"发起批次核验"按钮
      ↓
核验（从供应链协同跳转）
  → checkUpstreamDeclaration() 通过
  → renderUpstream() 显示 Lv.4 认证因子
  → 完成批次核验，签发证书
```

---

*Co2Lion · HengAI · Cursor指令三 · 供应链协同升级 v1.0*
*需配合指令一（AppState扩展）一同使用*
*建议执行顺序：指令一 → 指令三 → 指令二*
