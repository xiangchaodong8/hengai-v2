# Cursor 指令四：P0 铝业独立行业码 + Ring基准修复
## 版本：v1.0 · 严格边界版
## 优先级：P0（必须在任何功能扩展前完成）
## 预计改动量：约 80 行，仅前端

---

## ⚠️ 阅读本指令的第一件事

**在执行任何改动前，先运行以下命令创建回滚快照：**

```bash
cp HengAI_HeavyIndustry_Suite.html HengAI_HeavyIndustry_Suite.html.bak_$(date +%Y%m%d_%H%M%S)
```

**若任一验收标准失败，立即执行回滚：**

```bash
# 找到最近的备份文件
ls -lt HengAI_HeavyIndustry_Suite.html.bak_* | head -1
# 回滚（替换文件名中的时间戳）
cp HengAI_HeavyIndustry_Suite.html.bak_YYYYMMDD_HHMMSS HengAI_HeavyIndustry_Suite.html
```

---

## 1. 目标边界（P0 Only）

### ✅ 本次允许做的事

| # | 目标 | 具体操作 |
|---|------|---------|
| P0-A | 铝业独立行业码 | 将 `aluminum` 从 `steel` 映射中分离，建立独立 key |
| P0-B | 铝业 ringMax 独立 | 铝业仪表盘环形上限从 3.5 改为 18.0（对应其碳强度量级） |
| P0-C | 铝业 bench/penalty 独立 | 铝业行业均值基准 12.5，欧盟惩罚线 16.5（1.35x） |
| P0-D | INDUSTRY_CODE_MAP 修复 | '铝'/'铝业'/aluminum/aluminium 映射到 'aluminum' 而非 'steel' |

### ❌ 本次严禁做的事

```
禁止修改：
  - engine.py（后端）
  - 任何 DB / API 协议 / 接口字段名
  - EventBus 事件名（STATE_SYNCED / FACTOR_POOL_UPDATED 等）
  - AppState 已有字段名
  - 全域中心路由逻辑
  - HengAI_工业原厂精算.html（本次不动）
  - 供应链协同、核验等其他模块

严禁附带改动：
  - 不顺手重构其他行业配置
  - 不添加新的 UI 组件或面板
  - 不修改任何已通过验收的功能
  - 不改变 LOCAL_VAULT 数据结构（下一个指令的任务）
```

---

## 2. 文件边界

```
本次允许改动的文件（仅一个）：
  ✅ HengAI_HeavyIndustry_Suite.html

本次禁止改动的文件：
  ❌ HengAI_工业原厂精算.html
  ❌ HengAI_核验.html
  ❌ HengAI_供应链协同.html
  ❌ 全域中心.html
  ❌ appstate.js
  ❌ 任何 .py / .ts / .json 后端文件
```

---

## 3. 真理源规则

```
原则：UI 可保留本地计算，脱敏结果写 AppState.factorAuth，不改后端契约。

具体含义：
  ① 铝业的碳强度计算逻辑在前端完成（与现有钢铁/水泥一致）
  ② 计算结果通过 AppState.update('factorAuth.confirmedFactor', value) 写入
  ③ AppState.factorAuth 的字段名不新增、不删除、不改名
  ④ 后端接收的脱敏系数字段名保持不变
```

---

## 4. 禁改项清单

```javascript
// 以下内容在 HengAI_HeavyIndustry_Suite.html 中必须保持原样，不得触碰：

// 1. EventBus 事件名
EventBus.on('STATE_SYNCED', ...)
EventBus.emit('FACTOR_POOL_UPDATED', ...)
EventBus.emit('SOVEREIGNTY_RESONANCE', ...)

// 2. AppState 已有字段（只能追加，不能改名/删除）
AppState.factorAuth.confirmedFactor     // 禁改
AppState.factorAuth.confirmedIndustry   // 禁改
AppState.factorAuth.poolCount           // 禁改
AppState.factorAuth.waitingCount        // 禁改

// 3. LOCAL_VAULT 相关逻辑（本次不动）
saveLocalVault()   // 禁改
loadLocalVault()   // 禁改

// 4. 全域中心路由
nav('全域中心.html')   // 禁改

// 5. 其他行业的 Blueprint 配置（钢铁/水泥/石化等）
// 仅允许改 aluminum 相关，其余行业的数值和结构一律不动
```

---

## 5. 具体改动指令

### 改动 A：修复 INDUSTRY_CODE_MAP 中的铝业映射

**定位**：在 `HengAI_HeavyIndustry_Suite.html` 的 `<script>` 标签内，找到以下代码：

```javascript
// 【原代码 - 错误的映射，必须修复】
const INDUSTRY_CODE_MAP = {
  steel: 'steel', '钢铁': 'steel', steel_mill: 'steel',
  cement: 'cement', '水泥': 'cement', '水泥业': 'cement',
  petro: 'petro', petrochemical: 'petro', '石化': 'petro', '化工': 'petro',
  paper: 'paper', papermaking: 'paper', '造纸': 'paper',
  aviation: 'aviation', '民航': 'aviation', airline: 'aviation',
  ceramic: 'ceramic', ceramics: 'ceramic', '陶瓷': 'ceramic',
  port: 'port', ports: 'port', '港口': 'port', '交通': 'port',
  idc: 'idc', datacenter: 'idc', '数据中心': 'idc',
  // ⬇️ 这里是 BUG：铝业被错误映射到 steel
  aluminum: 'steel', aluminium: 'steel', al: 'steel', '铝': 'steel', '铝业': 'steel',
};
```

**替换为**：

```javascript
// 【新代码 - 铝业独立行业码】
const INDUSTRY_CODE_MAP = {
  steel: 'steel', '钢铁': 'steel', steel_mill: 'steel',
  cement: 'cement', '水泥': 'cement', '水泥业': 'cement',
  petro: 'petro', petrochemical: 'petro', '石化': 'petro', '化工': 'petro',
  paper: 'paper', papermaking: 'paper', '造纸': 'paper',
  aviation: 'aviation', '民航': 'aviation', airline: 'aviation',
  ceramic: 'ceramic', ceramics: 'ceramic', '陶瓷': 'ceramic',
  port: 'port', ports: 'port', '港口': 'port', '交通': 'port',
  idc: 'idc', datacenter: 'idc', '数据中心': 'idc',
  // ✅ P0修复：铝业独立行业码（原映射到steel是BUG）
  aluminum: 'aluminum', aluminium: 'aluminum', al: 'aluminum',
  '铝': 'aluminum', '铝业': 'aluminum', '电解铝': 'aluminum',
  '铝加工': 'aluminum', '铝压铸': 'aluminum', '铝型材': 'aluminum',
};
```

---

### 改动 B：在 HI_INDUSTRY_BLUEPRINT 中追加铝业独立配置

**定位**：找到 `window.HI_INDUSTRY_BLUEPRINT` 对象定义处（通常在第一个 `<script>` 标签内，或独立的 data script 块中）。

**操作**：在现有 Blueprint 对象中，找到 `steel`（钢铁）的配置块，在其**之后**（不是之内）追加铝业独立配置：

```javascript
// 在 HI_INDUSTRY_BLUEPRINT 对象内追加（放在 steel 配置之后）：

aluminum: {
  code: 'aluminum',
  display: '铝业',
  shortLabel: '铝业',
  title: '电解铝 / 铝加工行业碳因子精算',
  sub: '覆盖氧化铝制备→电解铝→铸造加工全工序，兼容中国有色金属工业协会标准',
  productLabel: '铝产品',
  unitLabel: 't',
  unitRing: 'tCO₂e/t',
  intensityUnit: 'tCO₂e/t',

  // ✅ P0核心修复：铝业独立基准值
  // 中国电解铝行业均值（火电依赖型）
  bench: 12.5,
  // 欧盟CBAM铝业默认惩罚值（1.35x基准）
  best: 4.0,   // 西南水电铝绿色标杆值
  // 铝业Ring仪表盘上限（必须独立，原steel的3.5完全不适用）
  ringMax: 18.0,

  // 广东ETS覆盖
  gdEts: true,
  cbamExpandWarning: false,

  // 计算模式：铝业分为原铝生产和铝加工两个子模式
  calcMode: 'aluminum_dual',

  // 核心KPI
  coreKpis: [
    { key: 'electricity', label: '电力碳因子', unit: 'tCO₂e/MWh' },
    { key: 'anode_consumption', label: '阳极净耗', unit: 'kg/t-Al' },
    { key: 'pfc_emission', label: 'PFC过氟化碳排放', unit: 'tCO₂e/t-Al' },
  ],

  // 子类型：原铝 vs 深加工（用于 calcMode=aluminum_dual 时的分支渲染）
  subTypes: {
    primary: {
      label: '原铝生产（电解铝）',
      bench: 12.5,
      ringMax: 18.0,
      penaltyLine: 16.5,    // 欧盟1.35x惩罚线
      steps: [
        { name: '氧化铝制备',   icon: '🧱', defaults: { ef: 1.0,  energy: 10.5,  unit: 'GJ/t' }},
        { name: '碳素阳极生产', icon: '🔲', defaults: { ef: 0.5,  energy: 3.0,   unit: 'GJ/t' }},
        { name: '电解铝（直流电耗）', icon: '⚡', defaults: { ef: 11.5, energy: 13000, unit: 'kWh/t' }},
        { name: '铝液铸造',     icon: '🏭', defaults: { ef: 0.15, energy: 1.5,   unit: 'GJ/t' }},
        { name: '辅助能耗',     icon: '🔧', defaults: { ef: 0.1,  energy: null,  unit: 'tCO₂e/t' }},
      ]
    },
    processing: {
      label: '铝深加工（压铸/型材/箔）',
      bench: 1.2,
      ringMax: 3.0,
      penaltyLine: 1.62,    // 欧盟铝加工1.35x惩罚线（参照铝制品分类）
      steps: [
        { name: '铝锭/铝液购入（嵌入碳）', icon: '📦', defaults: { ef: 0.85, energy: null, unit: 'tCO₂e/t原料' }},
        { name: '熔化/合金化',             icon: '🔥', defaults: { ef: 0.08, energy: 0.5,  unit: 'GJ/t' }},
        { name: '压铸/挤压/轧制',          icon: '⚙️', defaults: { ef: 0.12, energy: 0.8,  unit: 'GJ/t' }},
        { name: '热处理/表面处理',         icon: '🌡️', defaults: { ef: 0.06, energy: 0.4,  unit: 'GJ/t' }},
        { name: '机加工/装配',             icon: '🔩', defaults: { ef: 0.04, energy: 0.2,  unit: 'GJ/t' }},
        { name: '辅助能耗',               icon: '🔧', defaults: { ef: 0.03, energy: null,  unit: 'tCO₂e/t' }},
      ]
    }
  },

  // 电力来源结构（铝业专属：影响最大的变量）
  powerSourceConfig: {
    enabled: true,
    label: '电力来源结构',
    hint: '西南水电铝（云南/四川）可大幅降低电解工序碳强度',
    fields: [
      { id: 'hydro_pct',  label: '水电占比', unit: '%', default: 20 },
      { id: 'wind_pct',   label: '风光电占比', unit: '%', default: 5 },
      { id: 'coal_pct',   label: '火电占比', unit: '%', default: 75 },
    ],
    // 各电源碳因子（tCO₂e/MWh）
    emissionFactors: {
      hydro: 0.004,
      wind:  0.011,
      coal:  0.850,
    }
  },

  // kpi：铝业仪表盘专属指标
  kpi: {
    penaltyLine: 16.5,   // 欧盟默认值（1.35x）
    industryAvg: 12.5,   // 中国行业均值
    greenBench: 4.0,     // 西南水电铝标杆
    unit: 'tCO₂e/t'
  }
},
```

---

### 改动 C：修复 ringMax 初始化逻辑

**定位**：找到以下初始化代码（通常紧跟在 `buildIndustryMetaFromBlueprint()` 调用之后）：

```javascript
// 【原代码】
ringMax = (INDUSTRY_META.steel && INDUSTRY_META.steel.ringMax) || 3.5;
```

**替换为**：

```javascript
// 【新代码 - P0修复：ringMax 随当前激活行业动态调整，不硬编码 steel】
// 初始值仍用 steel（默认激活行业），但后续由 switchIndustry() 动态更新
ringMax = (INDUSTRY_META.steel && INDUSTRY_META.steel.ringMax) || 3.5;
// P0注：switchIndustry() 中已有 ringMax 更新逻辑，此处只需修复初始值来源
// 不新增逻辑，仅保留现有动态更新机制即可覆盖铝业场景
```

---

### 改动 D：在 switchIndustry() 中确保铝业 ringMax 正确更新

**定位**：找到 `switchIndustry(ind)` 函数体，找到其中更新 `ringMax` 的代码行。

**确认**（不修改，仅验证其存在）：

```javascript
// 确认 switchIndustry() 中存在类似以下逻辑（形式可能略有不同）：
// ringMax = (INDUSTRY_META[ind] && INDUSTRY_META[ind].ringMax) || 3.5;
//
// 若存在 → 无需修改，改动 B 注入的 aluminum.ringMax=18.0 会被自动读取 ✅
// 若不存在 → 在 switchIndustry() 函数体内追加（见下方补丁）
```

**若 switchIndustry() 中不存在 ringMax 更新，追加以下补丁**：

```javascript
// 在 switchIndustry(ind) 函数体内，行业切换完成后追加：
// P0补丁：确保铝业等大碳强度行业的Ring仪表盘上限正确更新
var _newMeta = INDUSTRY_META[ind] || {};
if (_newMeta.ringMax && _newMeta.ringMax !== ringMax) {
  ringMax = _newMeta.ringMax;
  // 触发环形图重绘（如现有函数支持）
  if (typeof redrawRing === 'function') redrawRing();
  else if (typeof updateRingDisplay === 'function') updateRingDisplay();
}
```

---

### 改动 E：更新 HI_INDUSTRY_ORDER（确保铝业出现在 Tab 列表中）

**定位**：找到 `window.HI_INDUSTRY_ORDER` 数组定义处。

**确认铝业 key 已包含**：

```javascript
// 原数组中若已有 'aluminum'（或之前可能是通过 steel 代理的）：
// 确保改动后 'aluminum' 作为独立 key 存在于 ORDER 数组中
window.HI_INDUSTRY_ORDER = [
  'steel',
  'aluminum',  // ✅ 确认此项存在且是 'aluminum' 而非 'steel'
  'cement',
  'petro',
  'paper',
  'ceramic',
  'port',
  'idc',
  // 'aviation',  // 保持注释状态，暂不显示
];
```

**若 ORDER 数组中铝业是 'steel'（被吸收）或不存在，修正为 'aluminum'**。

---

## 6. 验收标准（逐条检查，全部通过才可提交）

### 验收 1：铝业不再映射 steel

**检查方法**：在浏览器控制台执行：

```javascript
// 打开 HengAI_HeavyIndustry_Suite.html 后执行
console.log('铝业code:', INDUSTRY_CODE_MAP['铝业']);
console.log('aluminum:', INDUSTRY_CODE_MAP['aluminum']);
console.log('铝压铸:', INDUSTRY_CODE_MAP['铝压铸']);

// ✅ 期望输出（全部为 'aluminum'，不能出现 'steel'）：
// 铝业code: aluminum
// aluminum: aluminum
// 铝压铸: aluminum
```

**若任一输出为 'steel' → 验收失败，立即回滚**

---

### 验收 2：铝业 ringMax/bench/penaltyLine 独立

**检查方法**：

```javascript
// 控制台执行
var al = INDUSTRY_META['aluminum'];
console.log('aluminum ringMax:', al && al.ringMax);
console.log('aluminum bench:', al && al.kpi && al.kpi.industryAvg);
console.log('aluminum penalty:', al && al.kpi && al.kpi.penaltyLine);

// ✅ 期望输出：
// aluminum ringMax: 18
// aluminum bench: 12.5
// aluminum penalty: 16.5
```

**切换到铝业 Tab 后，Ring 仪表盘刻度上限必须为 18.0，不能为 3.5**

**若输出不匹配 → 验收失败，立即回滚**

---

### 验收 3：切换铝业 Tab 不影响钢铁数据

**检查方法**：

```javascript
// 先切换到钢铁，记录值
switchIndustry('steel');
var steelRing = ringMax;
console.log('steel ringMax:', steelRing);  // 期望: 3.5

// 切换到铝业
switchIndustry('aluminum');
console.log('aluminum ringMax:', ringMax);  // 期望: 18

// 切回钢铁
switchIndustry('steel');
console.log('steel ringMax after switch:', ringMax);  // 期望: 3.5（必须恢复）

// ✅ 三次输出：3.5 → 18 → 3.5
// ❌ 若钢铁切回后 ringMax 仍为 18 → 验收失败
```

---

### 验收 4：AppState 写入路径不变

**检查方法**：在铝业工序输入数值后触发精算，确认写入路径：

```javascript
// 精算完成后执行
console.log('confirmedIndustry:', AppState.factorAuth.confirmedIndustry);
console.log('confirmedFactor:', AppState.factorAuth.confirmedFactor);

// ✅ 期望：
// confirmedIndustry: 'aluminum'（不是 'steel'）
// confirmedFactor: [计算结果，数值在合理范围内]

// 确认 EventBus 事件正常发射（不新增/不改名）
EventBus.on('FACTOR_POOL_UPDATED', function(p) {
  console.log('FACTOR_POOL_UPDATED payload industry:', p.industry);
  // ✅ 期望: 'aluminum'
});
```

---

### 验收 5：sync:dist + test:e2e 通过

```bash
# 执行构建
npm run sync:dist
# 期望：无新增 error（warning 可忽略）

# 执行 E2E
npm run test:e2e
# 期望：全部通过，无新增失败用例

# 执行 lint
npm run lint HengAI_HeavyIndustry_Suite.html
# 期望：0 new errors
```

---

### 验收 6：视觉确认清单

打开页面，手动检查以下项：

```
□ 行业 Tab 中存在独立的"铝业"按钮（不与钢铁合并）
□ 切换铝业 Tab 后：
  □ Ring 仪表盘刻度上限显示为 18（而非 3.5）
  □ 基准线标注显示 12.5 tCO₂e/t（行业均值）
  □ 惩罚线标注显示 16.5 tCO₂e/t（欧盟1.35x）
  □ 绿色标杆显示 4.0 tCO₂e/t（西南水电铝）
  □ 工序列表显示铝业专属工序（氧化铝/电解铝等）
  □ 电力来源结构输入块可见（水电/风光/火电占比）
□ 切换回钢铁 Tab 后：
  □ Ring 仪表盘刻度上限恢复为 3.5
  □ 钢铁基准线和工序列表不受影响
□ 控制台无新增 Error（Warning 可忽略）
```

---

## 7. 回滚策略

### 触发回滚的条件（满足任一即回滚）

```
条件 1：验收 1 失败（铝业仍映射 steel）
条件 2：验收 2 失败（ringMax/bench/penalty 不独立）
条件 3：验收 3 失败（钢铁数据被铝业污染）
条件 4：验收 4 失败（AppState 写入路径改变）
条件 5：sync:dist 出现新增 error
条件 6：test:e2e 出现新增失败用例
条件 7：lint 出现新增 error
条件 8：页面出现 JS 报错（console.error）
```

### 回滚执行步骤

```bash
# 步骤 1：确认备份文件存在
ls HengAI_HeavyIndustry_Suite.html.bak_*

# 步骤 2：选择最近的备份（替换时间戳）
BACKUP=HengAI_HeavyIndustry_Suite.html.bak_YYYYMMDD_HHMMSS

# 步骤 3：执行回滚
cp $BACKUP HengAI_HeavyIndustry_Suite.html

# 步骤 4：确认回滚成功
diff $BACKUP HengAI_HeavyIndustry_Suite.html
# 期望：无输出（文件完全一致）

# 步骤 5：重新验证回滚后版本正常
# 在浏览器中打开，确认铝业仍映射 steel（回滚前的状态）
# 记录失败原因，等待下一次指令修订
```

---

## 8. 改动完成后的状态说明

P0 完成后，系统的铝业数据流应为：

```
用户在铝业 Tab 填写工序数据
    ↓
本地计算（Browser，不出域）
    ↓
ringMax=18 的仪表盘展示结果（视觉正确）
    ↓
AppState.update('factorAuth.confirmedFactor', factor)
AppState.update('factorAuth.confirmedIndustry', 'aluminum')  ← 不再是 'steel'
    ↓
EventBus.emit('FACTOR_POOL_UPDATED', { industry: 'aluminum', ... })
    ↓
供应链协同监听到铝业因子入池（指令三的逻辑）
    ↓
核验模块匹配铝业确权因子（指令二的逻辑）
```

---

## 9. 完成 P0 后的下一步（不在本指令范围内）

```
P1（下一个指令）：
  - LOCAL_VAULT 数据迁移到 AppState.factorAuth
  - BLUEPRINT 引擎与工业原厂精算模块对接
  - 金色确权仪式组件迁移

P2（再下一个指令）：
  - 影响力排行榜与消费账本合并
  - 广东ETS政策感知抽离
  - 民航行业 Tab 隐藏
```

---

## 附录：关键数值参考表

| 行业 | ringMax | 行业均值 bench | 欧盟惩罚线（1.35x） | 绿色标杆 |
|------|---------|-------------|----------------|---------|
| 钢铁（长流程） | 3.5 | 2.1 | 2.2 | 1.2 |
| 钢铁（短流程） | 1.5 | 0.8 | 0.95 | 0.4 |
| **铝业（电解铝）** | **18.0** | **12.5** | **16.5** | **4.0** |
| **铝业（深加工）** | **3.0** | **1.2** | **1.62** | **0.5** |
| 水泥 | 1.5 | 0.89 | 0.95 | 0.65 |
| 石化 | 3.5 | 2.0 | 2.2 | 1.1 |
| 陶瓷 | 1.2 | 0.55 | 0.80 | 0.30 |
| 造纸 | 1.8 | 0.72 | 1.10 | 0.35 |
| 数据中心 | — | PUE 1.5 | — | PUE 1.25 |
| 港口 | — | 3.5 kgCO₂/TEU | — | 0.4 kgCO₂/TEU |

---

*Co2Lion · HengAI · Cursor指令四 · P0铝业修复 v1.0*
*改动范围：仅 HengAI_HeavyIndustry_Suite.html*
*配套文档：指令一（AppState）/ 指令二（UI）/ 指令三（供应链协同）*
*执行顺序：本指令（P0）→ 验收通过 → 再执行指令一~三*
