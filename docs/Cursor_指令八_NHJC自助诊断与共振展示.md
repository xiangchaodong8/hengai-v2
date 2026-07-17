# Cursor 指令八：NHJC自助诊断 + 共振展示维度
## 对应七条策略中的第四、第五条
## 版本：v1.0 · 契约规格版（非文件级patch，适配正在调整中的工业原厂精算/资产确权模块）

---

## 〇、设计原则说明

本指令不假设`工业原厂精算.html`/`HeavyIndustry Suite`的当前具体结构（这两个文件正在独立调整中）。

给出的是**数据契约 + 组件规格 + 判定函数**，要求是：无论这两个文件现在长什么样，只要按本指令的数据结构和函数签名接入，第四、第五条策略就能生效，不依赖文件现状的具体行号或DOM结构。

**核心设计洞察**：第四条（共振展示里的合规状态提示）和第五条（自助诊断工具）不是两个独立功能，是**同一份数据的两个视角**——

```
第五条：原厂登录自己的工业原厂精算 → 自助诊断 → 产出 company.nhjcStatus
                                                      │
                                                      ▼ (经授权后可见，复用三层可见性模型)
第四条：下游中小企业在供应链协同/热力图里 → 看到该原厂的nhjcStatus → 调整等待预期
```

先建第五条（产出数据），第四条是消费这份数据的展示层，不是另起一套逻辑。

---

## 一、AppState数据契约（新增字段）

在`company`对象（无论当前文件结构如何，company这个顶层概念应该存在）追加：

```javascript
company: {
  // ... 现有字段不变 ...

  // 新增：NHJC自助诊断结果
  nhjcStatus: {
    diagnosed: false,           // 是否已完成自助诊断
    deployed: null,              // true/false/null(未知) — 是否已部署合规端设备
    vendorInput: null,           // 用户输入的原始厂商/型号文本
    matchedVendor: null,         // 系统匹配到的已知厂商key，未匹配为null
    tier: null,                  // 'tier0' | 'tier1' | null
    estimatedWeeks: null,        // 预计接入周期
    diagnosedAt: null,           // 诊断时间
    visibilityOptIn: false,      // 是否允许下游中小企业看到此状态（复用三层可见性模型的授权逻辑）
  }
}
```

在`factorAuth.demands[]`（供应链协同/热力图消费的需求节点列表，已在前序指令中定义）每项追加：

```javascript
// demands[] 数组每个元素追加
{
  // ... 现有字段（name/industry/region/taxRisk）不变 ...
  upstreamNhjcHint: null,  // 由匹配到的上游原厂nhjcStatus回填，结构同下方getNhjcStatusDisplay()返回值，未匹配为null
}
```

---

## 二、厂商识别表（第五条核心，需求是"覆盖面会持续扩展"的活表，非一次性写死）

```javascript
/**
 * NHJC合规端设备厂商识别表
 * [重要] 这是一份持续扩展的列表，当前仅覆盖市场调研已确认、
 * 有钢铁/化工/有色金属实际案例支撑的厂商。
 * 未匹配到的输入，一律降级为Tier 1（电表直连方案），
 * 不假设未知厂商一定兼容Tier 0。
 */
const NHJC_VENDOR_LOOKUP = {
  'acrel':   { label: '安科瑞',                 tier: 'tier0', estimatedWeeks: 2 },
  '安科瑞':   { label: '安科瑞',                 tier: 'tier0', estimatedWeeks: 2 },
  'compere': { label: '康派智能 (T@Energy-AIO)', tier: 'tier0', estimatedWeeks: 2 },
  '康派':     { label: '康派智能 (T@Energy-AIO)', tier: 'tier0', estimatedWeeks: 2 },
  '许继':     { label: '许继电气/康派智能',        tier: 'tier0', estimatedWeeks: 2 },
  'inspur':  { label: '浪潮',                   tier: 'tier0', estimatedWeeks: 3 },
  '浪潮':     { label: '浪潮',                   tier: 'tier0', estimatedWeeks: 3 },
  '群智合':   { label: '群智合信息科技',           tier: 'tier0', estimatedWeeks: 3 },
};

const NHJC_VENDOR_DEFAULT = {
  label: '未识别厂商',
  tier: 'tier1',
  estimatedWeeks: 8,
};

/**
 * 厂商文本匹配（简单包含匹配，避免过度设计成精确NLP）
 */
function matchNhjcVendor(inputText) {
  if (!inputText || !inputText.trim()) return null;
  const normalized = inputText.trim().toLowerCase();
  for (const key in NHJC_VENDOR_LOOKUP) {
    if (normalized.includes(key.toLowerCase())) {
      return { matchedKey: key, ...NHJC_VENDOR_LOOKUP[key] };
    }
  }
  return { matchedKey: null, ...NHJC_VENDOR_DEFAULT };
}
```

---

## 三、第五条：自助诊断组件规格

**插入位置（概念性，不依赖具体行号）**：工业原厂精算模块里，"开始因子精算"按钮之前，或保密承诺弹窗之前——逻辑上应该在原厂**第一次接触精算流程时**就先完成这一步诊断，让原厂在投入精算之前先知道自己走哪条路、要多久。

**组件交互流程**：

```
[原厂首次进入] 
    → 弹出/嵌入"NHJC合规自助诊断"卡片
    → 输入框：请输入您使用的能耗监测/端设备系统厂商名称
    → [诊断]按钮
    → 结果展示：
        匹配Tier0 → 绿色 "您已具备XX系统，预计2-3周可完成快速接入"
        匹配Tier1/未匹配 → 橙色 "建议采用电表直连方案，预计6-8周完成部署"
    → 复选框："允许下游合作企业看到我的接入进度预期"（默认不勾选，对应visibilityOptIn）
    → [确认诊断结果]按钮 → 写入 company.nhjcStatus，触发EventBus通知
```

**HTML结构示例（供参考，非强制DOM结构，可融入现有卡片样式）**：

```html
<div class="card" id="nhjc-diagnostic-card">
  <div class="sh">
    <div class="sh-t">NHJC合规自助诊断 <div class="sh-line"></div></div>
    <span class="pill p-b" id="nhjc-diag-status-pill">尚未诊断</span>
  </div>
  <div style="font-size:12px;color:var(--ink2);margin-bottom:12px;line-height:1.7">
    告诉我们您正在使用的能耗监测/端设备系统厂商，
    系统将判断您的最优接入路径和预计周期。
  </div>
  <div style="display:flex;gap:8px;margin-bottom:12px">
    <input class="f-inp" id="nhjc-vendor-input" placeholder="如：安科瑞 / 康派 / 浪潮 / 其他厂商名称..." style="flex:1">
    <button class="btn btn-o" onclick="runNhjcDiagnostic()">诊断</button>
  </div>
  <div id="nhjc-diag-result" style="display:none"></div>
</div>
```

**JS实现**：

```javascript
function runNhjcDiagnostic() {
  const input = document.getElementById('nhjc-vendor-input').value;
  const matched = matchNhjcVendor(input);
  const resultEl = document.getElementById('nhjc-diag-result');
  const pillEl = document.getElementById('nhjc-diag-status-pill');

  if (!matched) {
    showToast('请输入厂商名称');
    return;
  }

  const isTier0 = matched.tier === 'tier0';
  resultEl.style.display = 'block';
  resultEl.innerHTML = `
    <div style="padding:12px 14px;border-radius:10px;margin-bottom:10px;
      background:${isTier0 ? 'var(--green-d)' : 'var(--orange-d)'};
      border:1px solid ${isTier0 ? 'var(--green-b)' : 'var(--orange-b)'}">
      <div style="font-size:13px;font-weight:700;color:${isTier0 ? 'var(--green-l)' : 'var(--orange-l)'};margin-bottom:4px">
        ${isTier0 ? '✓ 已识别合规系统 · Tier 0快速通道' : '建议采用Tier 1电表直连方案'}
      </div>
      <div style="font-size:11.5px;color:var(--ink2)">
        ${matched.label} · 预计 ${matched.estimatedWeeks} 周完成接入
      </div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--ink2);margin-bottom:10px">
      <input type="checkbox" id="nhjc-visibility-optin">
      允许下游合作企业看到我的接入进度预期（不涉及任何生产数据，仅显示预计周期）
    </label>
    <button class="btn btn-o" style="width:100%" onclick="confirmNhjcDiagnostic('${matched.matchedKey || ''}', '${matched.tier}', ${matched.estimatedWeeks})">
      确认诊断结果
    </button>
  `;
  pillEl.textContent = isTier0 ? 'Tier 0 可用' : 'Tier 1 建议';
  pillEl.className = `pill ${isTier0 ? 'p-g' : 'p-o'}`;
}

function confirmNhjcDiagnostic(matchedKey, tier, estimatedWeeks) {
  const optIn = document.getElementById('nhjc-visibility-optin')?.checked || false;
  const vendorInput = document.getElementById('nhjc-vendor-input').value;

  if (window.AppState && typeof AppState.update === 'function') {
    AppState.update('company.nhjcStatus', {
      diagnosed: true,
      deployed: tier === 'tier0',
      vendorInput: vendorInput,
      matchedVendor: matchedKey || null,
      tier: tier,
      estimatedWeeks: estimatedWeeks,
      diagnosedAt: new Date().toISOString(),
      visibilityOptIn: optIn,
    });
    AppState.save();

    // [关键] 通知供应链协同/全域中心：该原厂的合规状态已更新
    EventBus.emit('NHJC_STATUS_DIAGNOSED', {
      tier: tier,
      estimatedWeeks: estimatedWeeks,
      visibilityOptIn: optIn,
    });
  }
  showToast('✓ 诊断结果已保存' + (optIn ? '，下游企业将看到您的接入进度预期' : ''));
}
```

---

## 四、第四条：共振展示消费第五条的数据

**插入位置（概念性）**：工业原厂精算的"产业链诉求热力图"区域，或供应链协同的需求列表/共振面板——这两个文件目前都在调整中，具体插哪个文件由你们当前的模块归属决定，**数据来源和展示逻辑是一份共享契约**：

```javascript
/**
 * 生成NHJC状态展示文案（同一份逻辑，热力图和需求列表都调用这个函数）
 */
function getNhjcStatusDisplay(nhjcStatus) {
  if (!nhjcStatus || !nhjcStatus.diagnosed || !nhjcStatus.visibilityOptIn) {
    return null;  // 未诊断或未授权可见，不展示任何NHJC相关提示
  }
  if (nhjcStatus.tier === 'tier0') {
    return {
      text: `已具备NHJC合规基础 · 预计${nhjcStatus.estimatedWeeks}周内可完成接入`,
      color: 'var(--green-l)',
      pillClass: 'p-g',
    };
  }
  return {
    text: `正在筹备电表直连方案 · 预计${nhjcStatus.estimatedWeeks}周内可完成接入`,
    color: 'var(--orange-l)',
    pillClass: 'p-o',
  };
}

/**
 * 在热力图/需求列表渲染时，对每条原厂相关记录追加展示
 * [CURSOR注意] 这个函数接入点取决于当前文件结构，
 * 找到渲染"等待响应""共振中"这类状态文案的位置，在其后追加调用
 */
function renderNhjcHint(targetElementId, nhjcStatus) {
  const hint = getNhjcStatusDisplay(nhjcStatus);
  const el = document.getElementById(targetElementId);
  if (!el) return;
  if (!hint) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.innerHTML = `<span style="font-size:10.5px;color:${hint.color}">${hint.text}</span>`;
}
```

**EventBus监听（在产业链热力图/共振面板所在文件中添加）**：

```javascript
// [CURSOR缝合点] 监听第五条诊断完成事件，更新热力图banner文案
EventBus.on('NHJC_STATUS_DIAGNOSED', function(payload) {
  if (!payload.visibilityOptIn) return;  // 未授权可见，不更新对外展示

  const bannerEl = document.getElementById('hm-banner'); // 或当前文件里对应的热力图banner元素
  if (bannerEl) {
    const hint = getNhjcStatusDisplay({
      diagnosed: true,
      tier: payload.tier,
      estimatedWeeks: payload.estimatedWeeks,
      visibilityOptIn: payload.visibilityOptIn,
    });
    if (hint) {
      bannerEl.innerHTML += `<br><span style="color:${hint.color};font-size:11px">${hint.text}</span>`;
    }
  }
});
```

---

## 五、与三层可见性模型的复用关系（不新造一套授权逻辑）

`visibilityOptIn`这个字段，复用的是指令一/指令二里已经定义的"三层可见性模型"同一套授权哲学——**默认不可见，原厂主动勾选才可见，且可见的内容仅是预计周期，不涉及任何生产数据**。

**[CTO要求]** 不要为NHJC状态展示单独发明一套新的隐私/授权机制，所有"是否可见给下游"的判断逻辑，都应该复用已有的opt-in模式，保持整个产品里"谁能看见什么"这件事只有一套规则，不要出现两套平行的可见性逻辑互相打架。

---

## 六、验收标准

| # | 验收项 | 通过标准 |
|---|--------|---------|
| 1 | 自助诊断组件 | 输入"安科瑞"得到Tier0+2周提示；输入未知厂商名得到Tier1+8周提示 |
| 2 | 数据写入 | 确认诊断后，`company.nhjcStatus`正确写入AppState，字段完整 |
| 3 | 授权门控 | `visibilityOptIn`为false时，`getNhjcStatusDisplay()`返回null，下游侧不展示任何信息 |
| 4 | 跨模块联动 | 诊断确认后触发`NHJC_STATUS_DIAGNOSED`事件，目标展示区域（无论在哪个文件）能正确接收并渲染 |
| 5 | 厂商表可扩展 | `NHJC_VENDOR_LOOKUP`新增一个厂商条目，无需改动其他任何函数逻辑 |

---

## 七、给当前文件调整工作的一个建议

由于`工业原厂精算`和`资产确权`两个文件正在你们手上调整，**建议把本指令的三个核心产出物（`NHJC_VENDOR_LOOKUP`查表、`matchNhjcVendor()`、`getNhjcStatusDisplay()`）做成一个独立的小型共享JS文件**（比如`nhjc-diagnostic-shared.js`），两个文件都引用它，而不是各自复制一份逻辑——这样无论你们现在怎么调整文件结构，这部分逻辑只有一个真理源，不会出现"工业原厂精算"和"资产确权"两边对同一个厂商判断出不同结果的情况。

---

*Co2Lion · HengAI · Cursor指令八 · NHJC自助诊断与共振展示 v1.0*
*策略对应：七条策略中的第四、第五条*
*设计原则：契约规格，非文件级patch，适配当前进行中的模块调整*
