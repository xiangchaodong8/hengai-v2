# Cursor 指令一：AppState 数据结构扩展
## 适用文件：appstate.js（或各模块内嵌的 MOCK_STATE）
## 任务：新增因子消费账本、供应链绑定声明、企业角色权限三个命名空间

---

## 【背景】

本次扩展支持以下新功能：
1. 因子消费账本（三层可见性模型）
2. 供应链绑定声明（反竞争泄露保护）
3. 企业角色权限（合规人员 vs 管理员权限分离）

所有新增字段遵循入网协议：初始值为 null / 0 / []，
通过 AppState.update() 写入，EventBus.emit('STATE_SYNCED') 触发更新。

---

## 【第一步：在 MOCK_STATE 的 factorAuth 对象中追加】

找到现有的 `factorAuth` 对象，在末尾追加以下字段：

```javascript
factorAuth: {
  // ── 原有字段保持不变 ──
  industry: null,
  pledgeBy: null,
  pledgeTs: null,
  confirmedFactor: null,
  confirmedIndustry: null,
  poolCount: 0,
  poolFactories: 0,
  poolDownstream: 0,
  poolTaxSaved: 0,
  waitingCount: 1420,
  taxRiskEur: 120000000,
  demands: [],
  honors: [],

  // ── 新增：因子消费账本 ──
  consumptionLedger: {
    // 聚合统计（对合规人员可见）
    total: {
      usageCount: 0,           // 因子被引用总次数
      carbonTonnageCovered: 0, // 覆盖碳排放总量（tCO₂e）
      taxSavedEur: 0,          // 为产业链节省碳税总量（€）
      serviceFeePct: 0.03,     // 服务费率 3%
      nursingFundPct: 0.01,    // 其中护航基金 1%
      serviceFeeEur: 0,        // 累计服务费（€）
      nursingFundEur: 0        // 累计护航基金（€）
    },
    // 行业分布（对合规人员可见，不含企业名）
    byIndustry: [
      // { industry: '铝压铸', count: 38, pct: 38, taxSaved: 450000 }
    ],
    // 地区分布（对合规人员可见）
    byRegion: [
      // { region: '广东', count: 52, pct: 52 }
    ],
    // 月度趋势（对合规人员可见）
    byMonth: [
      // { month: '2026-04', count: 12, carbonTonnage: 1240, taxSaved: 93000 }
    ],
    // 已认领的下游企业（管理员可见，需下游主动认领）
    claimedConsumers: [
      // {
      //   consumerId: 'CLM-001',
      //   companyName: '深圳华锐金属有限公司',
      //   industry: '铝压铸',
      //   region: '广东深圳',
      //   usageCount: 11,
      //   carbonTonnage: 3200,
      //   taxSavedEur: 240000,
      //   firstUsedAt: '2026-04-12',
      //   lastUsedAt: '2026-06-08',
      //   partnerStatus: 'regular', // 'regular' | 'preferred' | 'exclusive'
      //   inviteSent: false
      // }
    ],
    // 匿名消费记录（合规人员可见数字，不含企业名）
    anonymousRecords: [
      // {
      //   anonymousId: '匿名企业-047',
      //   usageCount: 3,
      //   carbonTonnage: 420,
      //   taxSavedEur: 31500,
      //   industry: '钢结构',
      //   inviteSent: false
      // }
    ]
  },

  // ── 新增：供应链绑定声明 ──
  supplyChainBinding: {
    // 申报信息（管理员操作）
    declaredBy: null,          // 申报人（管理员账号）
    declaredAt: null,          // 申报时间
    lastUpdatedAt: null,

    // 上游原料类型申报（合规人员可见，不含供应商名称）
    // 仅暴露材料类型和碳因子，商业关系由管理员单独管理
    upstreamMaterials: [
      // {
      //   materialId: 'UM-001',
      //   materialType: '冶金焦',        // 原料类型（合规人员可见）
      //   carbonFactor: null,            // 该原料碳因子（从因子池匹配或手动输入）
      //   matchedFromPool: false,        // 是否从因子池自动匹配
      //   matchedFactoryAnonymous: true, // 匹配源是否匿名（合规人员不可见供应商名）
      //   scope: 'scope3_upstream',
      //   unit: 'tCO₂e/t'
      // }
    ],

    // 下游已认领企业（管理员可见）
    // 由下游企业在核验时主动选择认领触发
    downstreamOptIns: [
      // {
      //   consumerId: 'CLM-001',
      //   companyName: '深圳华锐金属',  // 管理员可见
      //   optInAt: '2026-05-20',
      //   status: 'active'
      // }
    ],

    // 反竞争保护规则（系统强制执行，不可修改）
    antiCompetitionRules: {
      crossChainMatchingBlocked: true,  // 禁止跨供应链因子匹配
      undeclaredFactoryBlocked: true,   // 未申报的原厂因子不可被引用
      fallbackToIndustryAverage: true   // 无匹配时使用行业均值
    }
  }
},
```

---

## 【第二步：在 MOCK_STATE 的 company 对象中追加】

找到现有的 `company` 对象，追加以下字段：

```javascript
company: {
  // ── 原有字段保持不变 ──
  name: '...',
  creditCode: '...',
  // ...

  // ── 新增：企业角色权限 ──
  roleLevel: 'compliance',
  // 取值说明：
  // 'admin'      - 企业管理员：全视图，可操作所有数据，可审批入池，可查看供应链关系
  // 'compliance' - 合规操作员：可见原料类型和碳因子，可做工序精算，不可见供应商/客户名称
  // 'readonly'   - 只读用户：仅查看已发布的报告，不可操作

  // ── 新增：上游原料清单（合规人员视图，仅类型不含供应商名）
  upstreamMaterials: [
    // { materialType: '冶金焦', unit: 'tCO₂e/t', carbonFactor: null }
  ],

  // ── 新增：是否为工业原厂（影响企业工作台视图）
  isIndustrialFactory: false,
  // 为 true 时，企业工作台显示：上游原料申报 + 因子精算管理 + 供应链关系
  // 为 false 时（中小出口商），企业工作台显示：供应链协同 + 核验 + 诊断报告

  // ── 新增：工厂类型（仅 isIndustrialFactory=true 时有效）
  factoryType: null,
  // 取值：'steel_bf_bof' | 'steel_eaf' | 'aluminum_primary' |
  //        'aluminum_processing' | 'cement' | 'petrochem' |
  //        'ceramics' | 'paper' | 'datacenter' | 'port'
},
```

---

## 【第三步：在 MOCK_STATE 中追加 batchVerification（如尚未添加）】

```javascript
batchVerification: {
  batches: [],
  certificates: [],
  pendingApprovals: [],

  // ── 新增：供应链引用校验记录 ──
  // 每次批次核验引用因子时，记录是否通过了供应链绑定校验
  factorUsageLog: [
    // {
    //   batchId: '2026-Q2-001',
    //   factoryAnonymousId: 'FAC-003', // 不存原厂真实名称
    //   industry: 'steel',
    //   factorValue: 2.03,
    //   bindingVerified: true,     // 是否通过供应链绑定校验
    //   userOptedIn: false,        // 下游用户是否选择认领
    //   taxSavedEur: 31500,
    //   serviceFeePct: 0.03,
    //   serviceFeeEur: 945,
    //   nursingFundEur: 315,
    //   timestamp: '2026-06-10T09:23:00Z'
    // }
  ]
},
```

---

## 【第四步：新增两个 EventBus 事件定义（加注释到代码中）】

在 EventBus 初始化部分（或 initAppState 附近）加入以下注释说明：

```javascript
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
```

---

## 【第五步：供应链绑定校验函数（在 appstate.js 或公共工具函数中添加）】

```javascript
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
  var binding = getPath(AppState, 'factorAuth.supplyChainBinding');
  if (!binding || !binding.antiCompetitionRules.crossChainMatchingBlocked) {
    return false; // 保护机制未开启，默认拒绝
  }
  var declaredUpstream = binding.upstreamMaterials || [];
  // 检查该工厂是否在下游企业的申报清单中
  // [CURSOR注意] 实际比对逻辑由后端完成，前端仅做本地缓存校验
  return declaredUpstream.some(function(m) {
    return m.matchedFactoryAnonymousId === factoryAnonymousId;
  });
}
```

---

## 【注意事项】

1. **roleLevel 的视图控制在各模块实现**，不在 appstate.js 中做拦截。
   每个模块在 `updateModuleUI(state)` 时检查 `state.company.roleLevel`，
   据此显示或隐藏相应区块。

2. **consumptionLedger 的数据在生产环境由后端实时推送**，
   前端 MOCK_STATE 中的数据仅用于演示，Cursor 开发时可用以下 mock 数据：

```javascript
consumptionLedger: {
  total: {
    usageCount: 47,
    carbonTonnageCovered: 12400,
    taxSavedEur: 930000,
    serviceFeePct: 0.03,
    nursingFundPct: 0.01,
    serviceFeeEur: 27900,
    nursingFundEur: 9300
  },
  byIndustry: [
    { industry: '铝压铸', count: 18, pct: 38, taxSaved: 353400 },
    { industry: '钢结构', count: 14, pct: 29, taxSaved: 269700 },
    { industry: '化工件', count: 8,  pct: 17, taxSaved: 158100 },
    { industry: '其他',   count: 7,  pct: 16, taxSaved: 148800 }
  ],
  byMonth: [
    { month: '2026-03', count: 6,  carbonTonnage: 1580, taxSaved: 118500 },
    { month: '2026-04', count: 12, carbonTonnage: 3160, taxSaved: 237000 },
    { month: '2026-05', count: 18, carbonTonnage: 4740, taxSaved: 355500 },
    { month: '2026-06', count: 11, carbonTonnage: 2920, taxSaved: 219000 }
  ],
  claimedConsumers: [
    {
      consumerId: 'CLM-001',
      companyName: '深圳华锐金属有限公司',
      industry: '铝压铸', region: '广东深圳',
      usageCount: 11, carbonTonnage: 3200, taxSavedEur: 240000,
      firstUsedAt: '2026-04-12', lastUsedAt: '2026-06-08',
      partnerStatus: 'preferred', inviteSent: true
    },
    {
      consumerId: 'CLM-002',
      companyName: '佛山顺联铝业科技',
      industry: '铝型材', region: '广东佛山',
      usageCount: 7, carbonTonnage: 1960, taxSavedEur: 147000,
      firstUsedAt: '2026-04-28', lastUsedAt: '2026-06-05',
      partnerStatus: 'regular', inviteSent: false
    }
  ],
  anonymousRecords: [
    { anonymousId: '匿名企业-047', usageCount: 8, carbonTonnage: 2240,
      taxSavedEur: 168000, industry: '钢结构', inviteSent: false },
    { anonymousId: '匿名企业-023', usageCount: 5, carbonTonnage: 1400,
      taxSavedEur: 105000, industry: '化工件', inviteSent: false },
    { anonymousId: '匿名企业-091', usageCount: 4, carbonTonnage: 1120,
      taxSavedEur: 84000,  industry: '其他',   inviteSent: false }
  ]
}
```

---

*Co2Lion · HengAI · Cursor指令一 · AppState扩展 v1.0*
