# Cursor 指令：工业原厂·因子精算 行业扩展
## 文件：HengAI_工业原厂精算.html
## 任务：修复现有3个行业 + 扩展5个新行业

---

## 【背景说明】

当前 `INDS` 对象包含 `steel / aluminum / cement` 三个行业。
本次改动分两部分：
1. **修复**现有三个行业的精算缺陷
2. **扩展**五个新行业：石化、陶瓷、造纸、数据中心、港口交通

所有改动均在 `<script>` 标签内的 `INDS` 对象和 `switchInd` 相关逻辑中完成。
UI层的行业Tab按钮和工序渲染由 `renderProcs()` 和 `switchInd()` 自动处理，无需单独修改。

---

## 【第一步：修复现有三个行业】

### 1.1 修复钢铁：增加长流程/短流程切换

找到 `INDS.steel` 对象，替换为以下内容：

```javascript
steel: {
  name: '钢铁',
  tag: '钢铁 · CISA标准',
  ref: 2.1,
  // 新增：长流程/短流程子类型
  subTypes: [
    { id: 'bf_bof', label: '长流程（高炉转炉 BF-BOF）', ref: 2.1 },
    { id: 'eaf',    label: '短流程（电弧炉 EAF）',       ref: 0.8 }
  ],
  currentSubType: 'bf_bof',
  procs: {
    bf_bof: [
      { n:'1', name:'焦化工序',   unit:'tCO₂e/t焦炭'   },
      { n:'2', name:'球团工序',   unit:'tCO₂e/t球团'   },
      { n:'3', name:'烧结工序',   unit:'tCO₂e/t烧结矿' },
      { n:'4', name:'炼铁工序',   unit:'tCO₂e/t铁水'   },
      { n:'5', name:'转炉炼钢',   unit:'tCO₂e/t钢'     },
      { n:'6', name:'连铸工序',   unit:'tCO₂e/t坯'     },
      { n:'7', name:'轧制工序',   unit:'tCO₂e/t材'     },
      { n:'8', name:'自备电厂',   unit:'tCO₂e/MWh'     },
      { n:'9', name:'掺烧辅助',   unit:'tCO₂e/t产品'   },
    ],
    eaf: [
      { n:'1', name:'废钢预处理', unit:'tCO₂e/t废钢'   },
      { n:'2', name:'电弧炉熔炼', unit:'tCO₂e/t钢液'   },
      { n:'3', name:'精炼工序',   unit:'tCO₂e/t钢'     },
      { n:'4', name:'连铸工序',   unit:'tCO₂e/t坯'     },
      { n:'5', name:'轧制工序',   unit:'tCO₂e/t材'     },
      { n:'6', name:'辅助能耗',   unit:'tCO₂e/t产品'   },
    ]
  }
},
```

在 `renderProcs()` 函数中，钢铁行业的工序渲染需读取 `INDS.steel.procs[INDS.steel.currentSubType]`。

在 `panel-steel` 的 HTML 中，在工序Grid之前插入子类型切换按钮：

```html
<div id="steel-subtype-tabs" style="display:flex;gap:6px;margin-bottom:10px">
  <button class="ind-tab on" id="stab-bf_bof"
    onclick="switchSteelSub('bf_bof')" style="font-size:11px;padding:5px 12px">
    高炉转炉（长流程）
  </button>
  <button class="ind-tab" id="stab-eaf"
    onclick="switchSteelSub('eaf')" style="font-size:11px;padding:5px 12px">
    电弧炉（短流程）
  </button>
</div>
```

新增 `switchSteelSub` 函数：

```javascript
function switchSteelSub(subId) {
  INDS.steel.currentSubType = subId;
  ['bf_bof','eaf'].forEach(function(s) {
    var t = document.getElementById('stab-' + s);
    if (t) t.className = 'ind-tab' + (s === subId ? ' on' : '');
  });
  // 重新渲染钢铁工序
  var grid = document.getElementById('grid-steel');
  if (grid) {
    var procs = INDS.steel.procs[subId];
    grid.innerHTML = procs.map(function(p) {
      var id = 'inp-steel-' + p.n;
      return '<div class="proc-card" id="card-' + id + '">' +
        '<div class="proc-num">工序 ' + p.n + '</div>' +
        '<div class="proc-name">' + p.name + '</div>' +
        '<input class="proc-inp" type="number" step="0.001" min="0" id="' + id +
          '" placeholder="0.000" oninput="onInput()">' +
        '<div class="proc-unit">' + p.unit + '</div>' +
      '</div>';
    }).join('');
  }
  document.getElementById('factor-result').classList.remove('show');
}
```

---

### 1.2 修复铝业：增加原铝/铝深加工子类型

找到 `INDS.aluminum` 对象，替换为：

```javascript
aluminum: {
  name: '铝业',
  tag: '铝业 · 有色协会标准',
  ref: 1.82,
  subTypes: [
    { id: 'primary',      label: '原铝生产（电解铝）', ref: 1.82 },
    { id: 'processing',   label: '铝深加工（压铸/型材/箔）', ref: 0.45 }
  ],
  currentSubType: 'primary',
  procs: {
    primary: [
      { n:'1', name:'氧化铝制备', unit:'tCO₂e/t氧化铝' },
      { n:'2', name:'阳极制造',   unit:'tCO₂e/t阳极'   },
      { n:'3', name:'电解铝',     unit:'tCO₂e/t铝液'   },
      { n:'4', name:'铸造成型',   unit:'tCO₂e/t铸件'   },
      { n:'5', name:'热处理',     unit:'tCO₂e/t产品'   },
      { n:'6', name:'辅助能耗',   unit:'tCO₂e/t产品'   },
    ],
    processing: [
      { n:'1', name:'铝锭/铝液购入（嵌入碳）', unit:'tCO₂e/t铝料'  },
      { n:'2', name:'熔化/合金化',             unit:'tCO₂e/t铝液'  },
      { n:'3', name:'压铸/挤压/轧制',          unit:'tCO₂e/t产品'  },
      { n:'4', name:'热处理/表面处理',          unit:'tCO₂e/t产品'  },
      { n:'5', name:'机加工/装配',             unit:'tCO₂e/t产品'  },
      { n:'6', name:'辅助能耗',               unit:'tCO₂e/t产品'  },
    ]
  }
},
```

在 `panel-aluminum` 中同样插入子类型切换按钮（参照钢铁的实现方式），
函数名改为 `switchAluminumSub`，逻辑与 `switchSteelSub` 完全相同，替换 `steel` → `aluminum`。

---

### 1.3 修复水泥：增加熟料比例字段

找到 `INDS.cement` 对象，在工序列表中增加第7项，并在工序Grid下方增加熟料比例输入：

```javascript
cement: {
  name: '水泥',
  tag: '水泥 · CBAM标准',
  ref: 0.89,
  procs: [
    { n:'1', name:'石灰石采掘',   unit:'tCO₂e/t石灰石' },
    { n:'2', name:'原料磨制',     unit:'tCO₂e/t生料'   },
    { n:'3', name:'熟料煅烧',     unit:'tCO₂e/t熟料'   },
    { n:'4', name:'水泥粉磨',     unit:'tCO₂e/t水泥'   },
    { n:'5', name:'包装发运',     unit:'tCO₂e/t产品'   },
    { n:'6', name:'辅助能耗',     unit:'tCO₂e/t产品'   },
  ]
},
```

在 `panel-cement` 的工序Grid之后，追加熟料比例输入块：

```html
<div style="margin-top:10px;padding:12px 14px;background:var(--bg3);
  border:1px solid var(--border);border-radius:10px">
  <div style="font-size:11px;color:var(--ink3);margin-bottom:8px;font-weight:600">
    ⚙ 熟料比例修正（clinker ratio）
  </div>
  <div style="display:flex;align-items:center;gap:10px">
    <div style="font-size:12px;color:var(--ink2);flex:1">
      熟料占水泥成品的质量比例（%）<br>
      <span style="font-size:10.5px;color:var(--ink3)">
        P.O 42.5普通硅酸盐约85% · 复合水泥约45%—65%
      </span>
    </div>
    <input class="proc-inp" type="number" step="1" min="30" max="100"
      id="inp-cement-clinker" placeholder="65" oninput="onInput()"
      style="width:80px;text-align:center;font-size:14px;font-weight:700">
    <span style="font-size:13px;color:var(--ink2)">%</span>
  </div>
</div>
```

在 `onInput()` 函数中，水泥行业的因子计算增加熟料比例修正：

```javascript
// 在 onInput() 的水泥分支中
if (curInd === 'cement') {
  var clinkerRatio = parseFloat(
    (document.getElementById('inp-cement-clinker') || {}).value || '65'
  ) / 100;
  // 熟料工序（n=3）的碳排放按实际熟料比例加权
  factor = factor * (0.5 + clinkerRatio * 0.5); // 简化加权公式
}
```

---

## 【第二步：扩展五个新行业】

在 `INDS` 对象中追加以下五个行业定义。

### 2.1 石化（Petrochemicals）

```javascript
petrochem: {
  name: '石化',
  tag: '石化 · 能量分配法 · ISO 14067',
  ref: 1.2,
  note: '联产品碳分配采用ISO 14067推荐的能量分配法，支持切换至经济价值分配法',
  allocationMethod: 'energy', // 'energy' | 'economic' | 'mass'
  procs: [
    { n:'1', name:'原料预处理（脱硫/脱水）', unit:'tCO₂e/t原料'     },
    { n:'2', name:'裂解/催化重整',           unit:'tCO₂e/t进料'     },
    { n:'3', name:'分离提纯（精馏/吸收）',   unit:'tCO₂e/t产品'     },
    { n:'4', name:'合成/聚合反应',           unit:'tCO₂e/t产品'     },
    { n:'5', name:'公用工程（蒸汽/冷却水）', unit:'tCO₂e/GJ'        },
    { n:'6', name:'储运及火炬放空',          unit:'tCO₂e/t产品'     },
  ],
  // 联产品配比输入（需在UI中额外展示）
  coproducts: [
    { id:'ethylene',  name:'乙烯',   defaultShare: 30 },
    { id:'propylene', name:'丙烯',   defaultShare: 15 },
    { id:'benzene',   name:'苯',     defaultShare: 8  },
    { id:'other',     name:'其他',   defaultShare: 47 },
  ]
},
```

在 `panel-petrochem` 中，工序Grid之后追加联产品配比输入块：

```html
<div style="margin-top:10px;padding:12px 14px;background:var(--gold-d);
  border:1px solid var(--gold-b);border-radius:10px">
  <div style="font-size:11px;color:var(--gold-l);margin-bottom:8px;font-weight:600">
    ⚗ 联产品碳分配（能量分配法）· 各产品产量占比合计须为100%
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
    <div><label style="font-size:10.5px;color:var(--ink3)">乙烯 %</label>
      <input class="proc-inp" type="number" id="cp-ethylene" placeholder="30" oninput="onInput()"></div>
    <div><label style="font-size:10.5px;color:var(--ink3)">丙烯 %</label>
      <input class="proc-inp" type="number" id="cp-propylene" placeholder="15" oninput="onInput()"></div>
    <div><label style="font-size:10.5px;color:var(--ink3)">苯 %</label>
      <input class="proc-inp" type="number" id="cp-benzene" placeholder="8" oninput="onInput()"></div>
    <div><label style="font-size:10.5px;color:var(--ink3)">其他产品 %</label>
      <input class="proc-inp" type="number" id="cp-other" placeholder="47" oninput="onInput()"></div>
  </div>
  <div style="font-size:10.5px;color:var(--ink3);margin-top:6px">
    系统将按各产品能量含量比例分配总碳排放，符合ISO 14067联产品处理规范
  </div>
</div>
```

---

### 2.2 陶瓷（Ceramics）

```javascript
ceramics: {
  name: '陶瓷',
  tag: '陶瓷 · 佛山/潮州标准',
  ref: 0.55,
  note: '广东省陶瓷行业碳强度均值约0.55 tCO₂e/t，以高温窑炉烧成工序为主要碳源',
  procs: [
    { n:'1', name:'原料制备（破碎/球磨）', unit:'tCO₂e/t原料'  },
    { n:'2', name:'配料混合（泥浆/粉料）', unit:'tCO₂e/t配料'  },
    { n:'3', name:'成形（压制/注浆/挤出）',unit:'tCO₂e/t坯体'  },
    { n:'4', name:'干燥（窑前干燥）',      unit:'tCO₂e/t坯体'  },
    { n:'5', name:'烧成（高温窑炉）',      unit:'tCO₂e/t熟瓷'  },
    { n:'6', name:'深加工（抛光/切割）',   unit:'tCO₂e/t产品'  },
  ]
},
```

---

### 2.3 造纸（Paper & Pulp）

```javascript
paper: {
  name: '造纸',
  tag: '造纸 · GHG Protocol · 生物碳标注',
  ref: 0.72,
  note: '生物质碳排放按GHG Protocol处理（分开标注），支持原生浆与再生纸分类核算',
  fiberType: 'recycled', // 'virgin' | 'recycled' | 'mixed'
  procs: [
    { n:'1', name:'原料准备（木片/废纸处理）',  unit:'tCO₂e/t原料'  },
    { n:'2', name:'制浆（化学浆/机械浆/废纸浆）',unit:'tCO₂e/t浆'   },
    { n:'3', name:'洗涤漂白',                   unit:'tCO₂e/t浆'   },
    { n:'4', name:'抄纸成形',                   unit:'tCO₂e/t纸'   },
    { n:'5', name:'涂布加工',                   unit:'tCO₂e/t产品'  },
    { n:'6', name:'动力车间（蒸汽/电力）',       unit:'tCO₂e/GJ'    },
  ]
},
```

在 `panel-paper` 中，工序Grid之前追加纤维类型切换：

```html
<div style="display:flex;gap:6px;margin-bottom:10px">
  <button class="ind-tab on" id="ftab-recycled"
    onclick="switchFiberType('recycled')" style="font-size:11px;padding:5px 12px">
    再生纸浆（废纸回收）
  </button>
  <button class="ind-tab" id="ftab-virgin"
    onclick="switchFiberType('virgin')" style="font-size:11px;padding:5px 12px">
    原生木浆
  </button>
  <button class="ind-tab" id="ftab-mixed"
    onclick="switchFiberType('mixed')" style="font-size:11px;padding:5px 12px">
    混合浆
  </button>
</div>
<div style="padding:8px 12px;background:var(--bg3);border-radius:8px;
  font-size:11px;color:var(--ink3);margin-bottom:10px" id="fiber-bio-note">
  再生纸浆：生物质碳为零（废纸已完成一个生命周期），碳强度约0.45—0.65 tCO₂e/t
</div>
```

---

### 2.4 数据中心（Data Center）

```javascript
datacenter: {
  name: '数据中心',
  tag: '数据中心 · GCA零碳算力 · PUE核算',
  ref: 0.38,
  note: '碳强度以tCO₂e/MWh IT负荷表示，结合PUE自动换算为每单位算力碳强度',
  procs: [
    { n:'1', name:'IT设备（服务器/存储/网络）',  unit:'MWh/月'      },
    { n:'2', name:'制冷系统（空调/冷却塔）',      unit:'MWh/月'      },
    { n:'3', name:'UPS不间断电源损耗',           unit:'MWh/月'      },
    { n:'4', name:'照明及辅助设施',              unit:'MWh/月'      },
  ],
  // PUE 自动计算
  pueNote: '系统将自动根据上述用电量计算PUE值，并生成GCA零碳算力护照'
},
```

在 `panel-datacenter` 中，工序Grid之后追加PUE自动计算结果展示：

```html
<div style="margin-top:10px;padding:12px 14px;background:var(--teal-d);
  border:1px solid var(--teal-b);border-radius:10px">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <div>
      <div style="font-size:11px;color:var(--teal-l);font-weight:600;margin-bottom:3px">
        ⚡ PUE自动计算结果
      </div>
      <div style="font-size:10.5px;color:var(--ink3)">
        PUE = 总用电量 ÷ IT设备用电量 · 优秀数据中心目标 &lt;1.3
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-family:'DM Mono',monospace;font-size:24px;
        font-weight:700;color:var(--teal-l)" id="pue-val">—</div>
      <div style="font-size:10px;color:var(--ink3)">PUE值</div>
    </div>
  </div>
  <div style="margin-top:8px;font-size:11px;color:var(--teal-l)" id="pue-grade">
    请填写各项用电量以计算PUE
  </div>
</div>
```

在 `onInput()` 中，数据中心行业增加PUE计算逻辑：

```javascript
// 数据中心PUE自动计算
if (curInd === 'datacenter') {
  var itPower = parseFloat(
    (document.getElementById('inp-datacenter-1') || {}).value || '0'
  );
  var totalPower = ['1','2','3','4'].reduce(function(sum, n) {
    return sum + (parseFloat(
      (document.getElementById('inp-datacenter-' + n) || {}).value || '0'
    ));
  }, 0);
  if (itPower > 0 && totalPower > 0) {
    var pue = (totalPower / itPower).toFixed(2);
    setText('pue-val', pue);
    var grade = pue < 1.3 ? '🟢 优秀 · 符合GCA零碳算力认证要求'
              : pue < 1.5 ? '🟡 良好 · 建议进一步优化制冷系统'
              : '🔴 待改进 · 建议申请GCA节能改造方案';
    setText('pue-grade', grade);
  }
}
```

---

### 2.5 港口交通（Port Transportation）

```javascript
port: {
  name: '港口',
  tag: '港口 · 单位TEU核算 · IMO标准',
  ref: 0.012,
  note: '碳强度以tCO₂e/TEU表示，适用于港口运营商和货运企业Scope 3核算',
  procs: [
    { n:'1', name:'岸桥装卸（集装箱起重机）',  unit:'tCO₂e/TEU'    },
    { n:'2', name:'场桥堆场（轮胎式龙门吊）',  unit:'tCO₂e/TEU'    },
    { n:'3', name:'水平运输（集卡/AGV/拖头）', unit:'tCO₂e/TEU'    },
    { n:'4', name:'冷链仓储（冷藏箱插电）',    unit:'tCO₂e/TEU/天' },
    { n:'5', name:'辅助设施（照明/办公/消防）',unit:'tCO₂e/TEU'    },
    { n:'6', name:'船舶靠泊供电（岸电）',      unit:'tCO₂e/艘次'   },
  ]
},
```

---

## 【第三步：更新行业切换Tab按钮】

找到HTML中的 `ind-tabs` 区域，替换为8个行业的完整Tab列表：

```html
<div class="ind-tabs">
  <button class="ind-tab on"  id="tab-steel"     onclick="switchInd(event,'steel')">🏗 钢铁</button>
  <button class="ind-tab"     id="tab-aluminum"  onclick="switchInd(event,'aluminum')">⚡ 铝业</button>
  <button class="ind-tab"     id="tab-cement"    onclick="switchInd(event,'cement')">🏛 水泥</button>
  <button class="ind-tab"     id="tab-petrochem" onclick="switchInd(event,'petrochem')">🧪 石化</button>
  <button class="ind-tab"     id="tab-ceramics"  onclick="switchInd(event,'ceramics')">🏺 陶瓷</button>
  <button class="ind-tab"     id="tab-paper"     onclick="switchInd(event,'paper')">📄 造纸</button>
  <button class="ind-tab"     id="tab-datacenter"onclick="switchInd(event,'datacenter')">💻 数据中心</button>
  <button class="ind-tab"     id="tab-port"      onclick="switchInd(event,'port')">🚢 港口</button>
</div>
```

对应在HTML中增加5个新的 `ind-panel` 区块（参照现有 `panel-steel` 的结构，id分别为
`panel-petrochem / panel-ceramics / panel-paper / panel-datacenter / panel-port`，
内部各自放对应的 `proc-grid`）。

---

## 【第四步：更新 renderProcs() 函数以支持子类型】

将现有 `renderProcs()` 中的工序数组引用从 `ind.procs` 改为智能读取：

```javascript
function getProcs(indKey) {
  var ind = INDS[indKey];
  if (!ind) return [];
  // 支持子类型（钢铁/铝业）
  if (ind.procs && Array.isArray(ind.procs)) return ind.procs;
  if (ind.procs && ind.currentSubType) return ind.procs[ind.currentSubType] || [];
  return [];
}

function renderProcs() {
  Object.keys(INDS).forEach(function(k) {
    var grid = document.getElementById('grid-' + k);
    if (!grid) return;
    var procs = getProcs(k);
    grid.innerHTML = procs.map(function(p) {
      var id = 'inp-' + k + '-' + p.n;
      return '<div class="proc-card" id="card-' + id + '">' +
        '<div class="proc-num">工序 ' + p.n + '</div>' +
        '<div class="proc-name">' + p.name + '</div>' +
        '<input class="proc-inp" type="number" step="0.001" min="0" id="' + id +
          '" placeholder="0.000" oninput="onInput()">' +
        '<div class="proc-unit">' + p.unit + '</div>' +
      '</div>';
    }).join('');
  });
}
```

同理，`onInput()` 中的工序遍历改为调用 `getProcs(curInd)`。

---

## 【注意事项】

1. **入网协议不变**：所有新增行业的确权因子仍通过 `AppState.update('factorAuth.confirmedFactor', factor)` 写入，`EventBus.emit('FACTOR_POOL_UPDATED', ...)` 发射，不新增其他数据路径。

2. **数据中心与GCA联动**：数据中心行业完成精算入池后，应同时触发GCA护照生成逻辑。在 `submitPool()` 函数中增加判断：
   ```javascript
   if (curInd === 'datacenter') {
     // 额外生成GCA零碳算力护照
     AppState.update('factorAuth.gcaCertGenerated', true);
     AppState.update('factorAuth.pueValue', parseFloat(document.getElementById('pue-val').textContent) || null);
   }
   ```

3. **石化联产品分配**：石化行业的最终碳强度需在 `onInput()` 中按联产品配比加权后再展示，不能直接用工序均值。

4. **行业均值参考值更新**：`showResult()` 函数中显示的行业参考值需按 `INDS[curInd].ref` 动态读取，确保各行业显示正确基准。

---

*Co2Lion · HengAI · 工业原厂因子精算 · 行业扩展指令 v1.0*
*适用文件：HengAI_工业原厂精算.html*
