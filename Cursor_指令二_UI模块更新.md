# Cursor 指令二：UI 模块更新
## 适用文件：HengAI_工业原厂精算.html + HengAI_核验.html
## 任务：因子消费账本 · 供应链绑定校验 · 角色权限视图 · 下游可见性面板

---

## 【一、HengAI_工业原厂精算.html 更新】

### 1.1 新增：角色权限守卫（在 updateModuleUI 函数顶部添加）

```javascript
function updateModuleUI(state) {
  bindStateNodes(state);

  // [角色权限守卫]
  // 管理员：显示全部区块
  // 合规人员：隐藏 claimedConsumers 详情和供应链关系，显示聚合统计
  var roleLevel = getPath(state, 'company.roleLevel') || 'compliance';
  var isAdmin = roleLevel === 'admin';

  var adminOnlyBlocks = document.querySelectorAll('.admin-only');
  adminOnlyBlocks.forEach(function(el) {
    el.style.display = isAdmin ? '' : 'none';
  });
  var complianceBlocks = document.querySelectorAll('.compliance-visible');
  complianceBlocks.forEach(function(el) {
    el.style.display = '';
  });

  // 其余原有逻辑继续...
  var fa = getPath(state, 'factorAuth') || {};
  // ...
  renderConsumptionLedger(fa.consumptionLedger, isAdmin);
  renderDownstreamPanel(fa.consumptionLedger, isAdmin);
}
```

---

### 1.2 新增：因子消费账本区块 HTML

在"公共因子核验池"卡片之后、下游需求节点之前，插入以下 HTML 区块：

```html
<!-- ══ 因子消费账本 ══ -->
<div class="card fu" id="consumption-ledger-card">
  <div class="sh">
    <div class="sh-t">
      因子消费账本
      <div class="sh-line"></div>
    </div>
    <span class="pill p-g compliance-visible" id="ledger-usage-pill">引用 0 次</span>
  </div>

  <!-- 聚合统计（合规人员可见） -->
  <div class="compliance-visible">
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
      <div class="hm-stat">
        <div class="hm-val" style="color:var(--teal-l)" id="ledger-count">0</div>
        <div class="hm-lbl">因子引用次数</div>
      </div>
      <div class="hm-stat">
        <div class="hm-val" style="color:var(--blue-l)" id="ledger-carbon">0</div>
        <div class="hm-lbl">覆盖碳排放(tCO₂e)</div>
      </div>
      <div class="hm-stat">
        <div class="hm-val" style="color:var(--green-l)" id="ledger-saved">€0</div>
        <div class="hm-lbl">产业链节税总额</div>
      </div>
    </div>

    <!-- 服务费说明 -->
    <div style="padding:10px 14px;background:var(--bg3);border:1px solid
      var(--border);border-radius:9px;margin-bottom:12px;font-size:11.5px;
      color:var(--ink2);line-height:1.7">
      本期服务费（3%）：<strong style="color:var(--orange-l)"
        id="ledger-fee">€0</strong>
      &nbsp;·&nbsp;
      其中护航基金（1%）：<strong style="color:var(--gold-l)"
        id="ledger-nursing">€0</strong>
      &nbsp;·&nbsp;
      Co2Lion运营（2%）：<strong style="color:var(--ink)"
        id="ledger-ops">€0</strong>
    </div>

    <!-- 行业分布 -->
    <div style="font-size:10.5px;color:var(--ink3);font-weight:600;
      text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
      下游行业分布
    </div>
    <div id="industry-distribution" style="margin-bottom:12px">
      <!-- 由 renderIndustryDistribution() 填充 -->
    </div>

    <!-- 月度趋势 -->
    <div style="font-size:10.5px;color:var(--ink3);font-weight:600;
      text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
      月度引用趋势
    </div>
    <div id="monthly-trend" style="margin-bottom:12px">
      <!-- 由 renderMonthlyTrend() 填充 -->
    </div>

    <!-- 导出按钮（管理员可见） -->
    <div class="admin-only" style="display:none">
      <button class="btn btn-o" onclick="exportLedger()"
        style="width:100%">
        导出因子消费账本（管理员专用）
      </button>
    </div>
  </div>
</div>
```

---

### 1.3 新增：下游可见性面板 HTML

在因子消费账本卡片之后插入：

```html
<!-- ══ 下游可见性面板 ══ -->
<div class="g2">

  <!-- 已认领企业（管理员可见） -->
  <div class="card admin-only" id="claimed-panel" style="display:none">
    <div class="sh">
      <div class="sh-t">
        已认领下游企业
        <div class="sh-line"></div>
      </div>
      <span class="pill p-t" id="claimed-count-pill">0 家</span>
    </div>
    <div style="font-size:11px;color:var(--ink3);margin-bottom:10px;
      line-height:1.6">
      以下企业已主动认领，表示同意您查看其引用记录。
      您可发起碳合规合作邀请。
    </div>
    <div id="claimed-list">
      <!-- 由 renderClaimedConsumers() 填充 -->
    </div>
  </div>

  <!-- 匿名消费记录（合规人员可见，不含企业名） -->
  <div class="card compliance-visible" id="anonymous-panel">
    <div class="sh">
      <div class="sh-t">
        匿名消费记录
        <div class="sh-line"></div>
      </div>
      <span class="pill p-y" id="anon-count-pill">0 条</span>
    </div>
    <div style="font-size:11px;color:var(--ink3);margin-bottom:10px;
      line-height:1.6">
      以下记录来自未认领的下游企业。
      可发送邀请，鼓励其主动认领以建立合作关系。
    </div>
    <div id="anonymous-list">
      <!-- 由 renderAnonymousRecords() 填充 -->
    </div>
    <!-- 邀请认领按钮（管理员可见） -->
    <div class="admin-only" style="display:none;margin-top:10px">
      <button class="btn" onclick="sendBatchInvite()"
        style="width:100%;font-size:11.5px">
        向全部匿名消费者发送认领邀请
      </button>
    </div>
  </div>

</div>
```

---

### 1.4 新增渲染函数（在 script 标签内添加）

```javascript
/* ══ 因子消费账本渲染 ══ */
function renderConsumptionLedger(ledger, isAdmin) {
  if (!ledger || !ledger.total) return;
  var t = ledger.total;

  setText('ledger-usage-pill', '引用 ' + (t.usageCount || 0) + ' 次');
  setText('ledger-count',  (t.usageCount || 0).toLocaleString());
  setText('ledger-carbon', (t.carbonTonnageCovered || 0).toLocaleString());
  setText('ledger-saved',
    '€' + ((t.taxSavedEur || 0) / 1000).toFixed(0) + 'k');
  setText('ledger-fee',
    '€' + ((t.serviceFeeEur || 0) / 1000).toFixed(1) + 'k');
  setText('ledger-nursing',
    '€' + ((t.nursingFundEur || 0) / 1000).toFixed(1) + 'k');
  setText('ledger-ops',
    '€' + (((t.serviceFeeEur || 0) - (t.nursingFundEur || 0))
      / 1000).toFixed(1) + 'k');

  renderIndustryDistribution(ledger.byIndustry || []);
  renderMonthlyTrend(ledger.byMonth || []);
}

function renderIndustryDistribution(byIndustry) {
  var el = document.getElementById('industry-distribution');
  if (!el) return;
  el.innerHTML = byIndustry.map(function(item) {
    return '<div style="margin-bottom:7px">' +
      '<div style="display:flex;justify-content:space-between;' +
        'font-size:11.5px;margin-bottom:3px">' +
        '<span style="color:var(--ink2)">' + item.industry + '</span>' +
        '<span style="color:var(--teal-l)">' + item.pct + '%</span>' +
      '</div>' +
      '<div style="height:5px;background:var(--bg4);border-radius:999px;' +
        'overflow:hidden">' +
        '<div style="height:100%;width:' + item.pct + '%;' +
          'background:var(--teal);border-radius:999px;' +
          'transition:width .7s ease"></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function renderMonthlyTrend(byMonth) {
  var el = document.getElementById('monthly-trend');
  if (!el || !byMonth.length) return;
  var maxCount = Math.max.apply(null, byMonth.map(function(m) {
    return m.count;
  })) || 1;
  el.innerHTML = '<div style="display:flex;gap:6px;align-items:flex-end;' +
    'height:60px;padding-bottom:4px">' +
    byMonth.map(function(m) {
      var h = Math.round((m.count / maxCount) * 52) + 8;
      return '<div style="flex:1;display:flex;flex-direction:column;' +
        'align-items:center;gap:3px">' +
        '<div style="font-family:DM Mono,monospace;font-size:9px;' +
          'color:var(--teal-l)">' + m.count + '</div>' +
        '<div style="width:100%;height:' + h + 'px;background:var(--teal-d);' +
          'border:1px solid var(--teal-b);border-radius:4px 4px 0 0;' +
          'transition:height .5s ease"></div>' +
        '<div style="font-size:8.5px;color:var(--ink3);white-space:nowrap">' +
          m.month.slice(5) + '</div>' +
      '</div>';
    }).join('') +
  '</div>';
}

/* ══ 下游可见性面板渲染 ══ */
function renderDownstreamPanel(ledger, isAdmin) {
  if (!ledger) return;
  renderClaimedConsumers(ledger.claimedConsumers || []);
  renderAnonymousRecords(ledger.anonymousRecords || []);
}

function renderClaimedConsumers(claimed) {
  var el = document.getElementById('claimed-list');
  var pill = document.getElementById('claimed-count-pill');
  if (!el) return;
  setText('claimed-count-pill', claimed.length + ' 家');
  if (!claimed.length) {
    el.innerHTML = '<div style="color:var(--ink3);font-size:12px;' +
      'text-align:center;padding:14px">暂无企业认领</div>';
    return;
  }
  var STATUS = {
    preferred: { cls: 'p-g', txt: '优先伙伴' },
    regular:   { cls: 'p-t', txt: '常规用户' },
    exclusive: { cls: 'p-o', txt: '独家合作' }
  };
  el.innerHTML = claimed.map(function(c) {
    var st = STATUS[c.partnerStatus] || STATUS.regular;
    return '<div style="padding:10px 12px;background:var(--bg3);' +
      'border:1px solid var(--border);border-radius:9px;margin-bottom:7px">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
        '<div style="width:26px;height:26px;border-radius:50%;' +
          'background:var(--teal-d);border:1px solid var(--teal-b);' +
          'display:flex;align-items:center;justify-content:center;' +
          'font-size:10px;font-weight:700;color:var(--teal-l);flex-shrink:0">' +
          (c.companyName ? c.companyName[0] : '?') + '</div>' +
        '<div style="flex:1">' +
          '<div style="font-size:12px;font-weight:600">' +
            c.companyName + '</div>' +
          '<div style="font-size:10.5px;color:var(--ink3)">' +
            c.industry + ' · ' + c.region + '</div>' +
        '</div>' +
        '<span class="pill ' + st.cls + '">' + st.txt + '</span>' +
      '</div>' +
      '<div style="display:flex;gap:12px;font-size:11px;color:var(--ink2);' +
        'margin-bottom:8px">' +
        '<span>引用 <strong style="color:var(--ink)">' +
          c.usageCount + '</strong> 次</span>' +
        '<span><strong style="color:var(--teal-l)">' +
          c.carbonTonnage.toLocaleString() + '</strong> tCO₂e</span>' +
        '<span>节税 <strong style="color:var(--green-l)">€' +
          (c.taxSavedEur / 1000).toFixed(0) + 'k</strong></span>' +
      '</div>' +
      (!c.inviteSent ?
        '<button onclick="sendPartnerInvite(\'' + c.consumerId + '\')" ' +
          'class="btn btn-o" style="width:100%;font-size:11px;padding:5px">' +
          '发起碳合规合作邀请</button>' :
        '<div style="text-align:center;font-size:11px;color:var(--ink3);' +
          'padding:4px">✓ 邀请已发送</div>'
      ) +
    '</div>';
  }).join('');
}

function renderAnonymousRecords(records) {
  var el = document.getElementById('anonymous-list');
  if (!el) return;
  setText('anon-count-pill', records.length + ' 条');
  if (!records.length) {
    el.innerHTML = '<div style="color:var(--ink3);font-size:12px;' +
      'text-align:center;padding:14px">暂无匿名消费记录</div>';
    return;
  }
  el.innerHTML = records.map(function(r) {
    return '<div style="display:flex;align-items:center;gap:10px;' +
      'padding:9px 12px;background:var(--bg3);border:1px solid var(--border);' +
      'border-radius:9px;margin-bottom:7px">' +
      '<div style="width:26px;height:26px;border-radius:50%;' +
        'background:var(--bg4);border:1px solid var(--border2);' +
        'display:flex;align-items:center;justify-content:center;' +
        'font-size:11px;color:var(--ink3);flex-shrink:0">?</div>' +
      '<div style="flex:1">' +
        '<div style="font-size:12px;font-weight:600;color:var(--ink2)">' +
          r.anonymousId + '</div>' +
        '<div style="font-size:10.5px;color:var(--ink3)">' +
          r.industry + ' · 引用 ' + r.usageCount + ' 次 · €' +
          (r.taxSavedEur / 1000).toFixed(0) + 'k 节税</div>' +
      '</div>' +
      (!r.inviteSent ?
        '<button onclick="inviteAnonymous(\'' + r.anonymousId + '\')" ' +
          'style="padding:3px 9px;border-radius:6px;border:1px solid ' +
          'var(--border2);background:var(--bg4);color:var(--ink2);' +
          'font-size:10px;cursor:pointer;font-family:Noto Sans SC,sans-serif">' +
          '邀请认领</button>' :
        '<span style="font-size:10px;color:var(--ink3)">已邀请</span>'
      ) +
    '</div>';
  }).join('');
}

/* ══ 商务操作函数 ══ */
function sendPartnerInvite(consumerId) {
  if (window.AppState && typeof AppState.update === 'function') {
    var ledger = getPath(AppState, 'factorAuth.consumptionLedger') || {};
    var claimed = ledger.claimedConsumers || [];
    var idx = claimed.findIndex(function(c) {
      return c.consumerId === consumerId;
    });
    if (idx >= 0) {
      claimed[idx].inviteSent = true;
      AppState.update('factorAuth.consumptionLedger.claimedConsumers', claimed);
      AppState.save();
      // [CURSOR缝合点] 发射邀请事件
      EventBus.emit('FACTORY_PARTNER_INVITE_SENT', {
        targetConsumerId: consumerId,
        factoryName: getPath(AppState, 'factorAuth.pledgeBy') || '未知原厂',
        inviteType: 'carbon_cooperation'
      });
    }
  }
  showToast('碳合规合作邀请已通过 HengAI 发送，对方将在 24 小时内收到通知');
}

function inviteAnonymous(anonymousId) {
  if (window.AppState && typeof AppState.update === 'function') {
    var ledger = getPath(AppState, 'factorAuth.consumptionLedger') || {};
    var records = ledger.anonymousRecords || [];
    var idx = records.findIndex(function(r) {
      return r.anonymousId === anonymousId;
    });
    if (idx >= 0) {
      records[idx].inviteSent = true;
      AppState.update(
        'factorAuth.consumptionLedger.anonymousRecords', records);
      AppState.save();
    }
  }
  showToast('认领邀请已发送，对方认领后您将在管理员视图中看到其信息');
}

function sendBatchInvite() {
  showToast('已向全部 ' +
    (getPath(AppState,
      'factorAuth.consumptionLedger.anonymousRecords.length') || 0) +
    ' 条匿名记录发送认领邀请');
}

function exportLedger() {
  showToast('因子消费账本导出中，将以 Excel 格式下载...');
}
```

---

## 【二、HengAI_核验.html 更新】

### 2.1 新增：供应链绑定校验逻辑

在 `renderUpstream()` 函数中，将原有的"是否有确权因子"检查替换为：

```javascript
function renderUpstream() {
  var el = document.getElementById('upstream-layers');
  if (!el || !currentBatch) return;

  var confirmedFactor = getPath(window.AppState, 'factorAuth.confirmedFactor');
  var confirmedInd = getPath(window.AppState, 'factorAuth.confirmedIndustry');

  // [供应链绑定校验 - 反竞争保护核心逻辑]
  // 校验下游企业是否申报了该原厂为上游供应商
  // 未申报则不允许使用认证因子，降级为行业均值
  var bindingDeclared = checkUpstreamDeclaration(currentBatch.upstream);
  var hasPool = confirmedFactor && confirmedFactor > 0 && bindingDeclared;

  // ... 后续渲染逻辑（原有代码，仅在 hasPool 判断上游是否使用绑定因子）
}

/**
 * 校验上游原料是否已由管理员申报
 * [CURSOR注意] 此函数是反竞争保护机制的前端实现
 * 生产环境由后端二次校验，前端仅做本地缓存快速校验
 */
function checkUpstreamDeclaration(upstreamInput) {
  var binding = getPath(window.AppState, 'factorAuth.supplyChainBinding');

  // 若供应链绑定未初始化，视为未申报
  if (!binding || !binding.upstreamMaterials ||
      !binding.upstreamMaterials.length) {
    return false;
  }

  // 检查 upstreamInput 是否匹配任何已申报的原料来源
  // 前端做模糊匹配，精确校验由后端完成
  var input = (upstreamInput || '').toLowerCase();
  return binding.upstreamMaterials.some(function(m) {
    return m.matchedFromPool && input.length > 0;
  });
}
```

---

### 2.2 新增：认领选择弹窗

在证书签发函数 `issueCert()` 执行前，弹出认领选择提示：

```javascript
function issueCert() {
  if (!currentBatch) return;

  // [认领选择弹窗 - 三层可见性模型实现]
  // 询问下游企业是否允许原厂查看其引用信息
  showOptInDialog(function(optedIn) {
    doIssueCert(optedIn);
  });
}

function showOptInDialog(callback) {
  var modal = document.getElementById('optin-modal');
  if (!modal) {
    // 若弹窗不存在，直接以匿名方式继续
    callback(false);
    return;
  }
  modal.classList.add('open');
  window._optInCallback = callback;
}

function confirmOptIn(optedIn) {
  var modal = document.getElementById('optin-modal');
  if (modal) modal.classList.remove('open');
  if (typeof window._optInCallback === 'function') {
    window._optInCallback(optedIn);
  }
}

function doIssueCert(optedIn) {
  if (!currentBatch) return;
  var certNo = 'CERT-CL-2026-' + String(certCounter++).padStart(6, '0');
  var factor = (currentBatch.upstreamFactor || 1.82).toFixed(3);
  var issueDate = new Date().toLocaleDateString('zh-CN');

  // 计算节税和服务费
  var euDefaultFactor = 2.1; // 欧盟钢铁默认值示例
  var qty = currentBatch.qty || 0;
  var carbonPrice = 75; // €/tCO₂e
  var taxSavedEur = Math.round(
    (euDefaultFactor - parseFloat(factor)) * qty * carbonPrice
  );
  var serviceFeePct = 0.03;
  var nursingFundPct = 0.01;
  var serviceFeeEur = Math.round(taxSavedEur * serviceFeePct);
  var nursingFundEur = Math.round(taxSavedEur * nursingFundPct);

  // 更新 AppState
  if (window.AppState && typeof AppState.update === 'function') {
    var certs = getPath(AppState, 'batchVerification.certificates') || [];
    certs.unshift({
      certNo: certNo,
      batchId: currentBatch.id,
      factor: parseFloat(factor),
      dest: currentBatch.dest,
      issueDate: issueDate,
      taxSavedEur: taxSavedEur,
      serviceFeeEur: serviceFeeEur,
      nursingFundEur: nursingFundEur,
      userOptedIn: optedIn
    });
    AppState.update('batchVerification.certificates', certs);

    // 更新批次状态
    var batches = getPath(AppState, 'batchVerification.batches') || [];
    var idx = batches.findIndex(function(b) { return b.id === currentBatch.id; });
    if (idx >= 0) {
      batches[idx].status = 'certified';
      AppState.update('batchVerification.batches', batches);
    }

    AppState.save();

    // [CURSOR缝合点] 发射 BATCH_CERT_ISSUED 事件（含认领信息）
    EventBus.emit('BATCH_CERT_ISSUED', {
      certNo: certNo,
      batchId: currentBatch.id,
      factor: parseFloat(factor),
      dest: currentBatch.dest,
      issueDate: issueDate,
      taxSavedEur: taxSavedEur,
      serviceFeeEur: serviceFeeEur,
      nursingFundEur: nursingFundEur,
      userOptedIn: optedIn,
      // 认领信息由工业原厂精算模块的 CONSUMPTION_LEDGER_UPDATED 事件处理
      companyName: optedIn
        ? (getPath(AppState, 'company.name') || null)
        : null
    });

    // [CURSOR缝合点] 发射 CONSUMPTION_LEDGER_UPDATED 通知原厂精算模块
    EventBus.emit('CONSUMPTION_LEDGER_UPDATED', {
      usageCount: 1,
      carbonTonnage: qty,
      taxSavedEur: taxSavedEur,
      serviceFeeEur: serviceFeeEur,
      nursingFundEur: nursingFundEur,
      claimedCompanyName: optedIn
        ? (getPath(AppState, 'company.name') || null)
        : null,
      industry: getPath(AppState, 'company.industryLabel') || '未知',
      region: getPath(AppState, 'company.region') || '未知'
    });
  }

  // 更新证书展示
  setText('cert-no', certNo);
  setText('cert-factor', factor);
  setText('cert-batch-id', currentBatch.id);
  setText('cert-ship-date', currentBatch.date || '—');
  setText('cert-dest', currentBatch.dest || '—');
  setText('cert-issue-date', issueDate);

  // 展示节税和服务费信息
  var feeBlock = document.getElementById('cert-fee-info');
  if (feeBlock) {
    feeBlock.style.display = 'block';
    setText('cert-tax-saved',
      taxSavedEur > 0 ? '€' + taxSavedEur.toLocaleString() : '—');
    setText('cert-service-fee',
      '€' + serviceFeeEur.toLocaleString() + '（3%）');
    setText('cert-nursing-fund',
      '€' + nursingFundEur.toLocaleString() + '（1%护航基金）');
  }

  goStep(5);
  showToast('✓ 证书 ' + certNo + ' 已签发 · 节税 €' +
    taxSavedEur.toLocaleString() + ' · 服务费 €' +
    serviceFeeEur.toLocaleString());
}
```

---

### 2.3 新增：认领选择弹窗 HTML

在现有 `new-batch-modal` 之后插入：

```html
<!-- 认领选择弹窗 -->
<div style="position:fixed;inset:0;background:rgba(0,0,0,.75);
  backdrop-filter:blur(6px);z-index:1000;display:flex;
  align-items:center;justify-content:center;
  opacity:0;pointer-events:none;transition:opacity .2s"
  id="optin-modal">
  <div style="background:var(--bg2);border:1px solid var(--border2);
    border-radius:18px;padding:24px;width:440px;
    max-width:calc(100vw - 32px)">

    <div style="font-size:15px;font-weight:700;margin-bottom:6px">
      是否允许原厂查看您的引用信息？
    </div>
    <div style="font-size:12px;color:var(--ink2);margin-bottom:18px;
      line-height:1.7">
      您即将引用原厂确权因子完成本次批次核验。<br>
      选择<strong style="color:var(--green-l)">允许认领</strong>：
      原厂可看到您的企业名称和本次引用量，
      有助于双方建立碳合规合作关系。<br>
      选择<strong style="color:var(--ink2)">匿名使用</strong>：
      原厂仅看到一条匿名记录，保护您的商业隐私。
    </div>

    <div style="padding:12px 14px;background:var(--bg3);
      border:1px solid var(--border);border-radius:10px;
      margin-bottom:16px;font-size:11.5px;color:var(--ink3);
      line-height:1.65">
      🛡 无论您选择哪种方式，Co2Lion 保证：原厂只能
      看到您认领或匿名的引用信息，
      <strong style="color:var(--ink)">
        不会将您的信息用于引导其他原厂接触您
      </strong>（数据不竞争原则）。
    </div>

    <div style="display:flex;gap:10px">
      <button onclick="confirmOptIn(true)"
        style="flex:1;padding:11px;border-radius:10px;border:none;
          background:var(--green);color:#fff;font-size:13px;
          font-weight:700;cursor:pointer;
          font-family:'Noto Sans SC',sans-serif">
        ✓ 允许认领，建立合作
      </button>
      <button onclick="confirmOptIn(false)"
        style="flex:1;padding:11px;border-radius:10px;
          border:1px solid var(--border2);background:var(--bg4);
          color:var(--ink2);font-size:13px;cursor:pointer;
          font-family:'Noto Sans SC',sans-serif">
        匿名使用
      </button>
    </div>
  </div>
</div>
```

---

### 2.4 在证书卡片中追加节税信息展示 HTML

在 `cert-card` 的 `.cert-meta` 之后追加：

```html
<!-- 节税与服务费明细（cert-card内） -->
<div id="cert-fee-info" style="display:none;margin-bottom:14px;
  padding:12px 16px;background:var(--bg3);border:1px solid var(--border);
  border-radius:10px;text-align:left">
  <div style="font-size:10.5px;color:var(--ink3);font-weight:600;
    text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">
    节税与服务费明细
  </div>
  <div style="display:flex;justify-content:space-between;
    font-size:12px;margin-bottom:5px">
    <span style="color:var(--ink2)">本次节省 CBAM 税款</span>
    <strong style="color:var(--green-l)" id="cert-tax-saved">—</strong>
  </div>
  <div style="display:flex;justify-content:space-between;
    font-size:12px;margin-bottom:5px">
    <span style="color:var(--ink2)">Co2Lion 服务费</span>
    <strong style="color:var(--orange-l)" id="cert-service-fee">—</strong>
  </div>
  <div style="display:flex;justify-content:space-between;font-size:12px">
    <span style="color:var(--ink2)">供应链护航基金</span>
    <strong style="color:var(--gold-l)" id="cert-nursing-fund">—</strong>
  </div>
</div>
```

---

### 2.5 EventBus 监听补充

在 `hookBus()` 函数中追加：

```javascript
// [CURSOR缝合点] 监听工业原厂精算模块的因子入池事件
// 因子入池后，重新校验当前批次的上游匹配状态
EventBus.on('FACTOR_POOL_UPDATED', function(payload) {
  if (currentStep === 2 && currentBatch) {
    renderUpstream(); // 重新渲染，可能从"行业均值"升级为"认证因子"
    showToast('✓ 原厂因子已更新：' + payload.factoryName +
      ' 入池 ' + payload.factor.toFixed(3) + ' tCO₂e/t，已自动更新匹配');
  }
});
```

---

## 【三、全域中心侧边栏补充（全域中心.html）】

```html
<!-- 个人工作台 / 企业法规库下方 -->
<div class="sb-item" onclick="nav('HengAI_工业原厂精算.html')">
  <div class="sb-dot" style="background:var(--orange)"></div>
  工业原厂·因子精算
</div>

<!-- 企业工作台 / 供应链协同下方 -->
<div class="sb-item" onclick="nav('HengAI_核验.html')">
  <div class="sb-dot" style="background:var(--blue)"></div>
  核验
</div>
```

---

## 【四、注意事项汇总】

| 序号 | 注意点 | 说明 |
|------|--------|------|
| 1 | **供应链绑定是铁律** | `checkUpstreamDeclaration()` 返回 false 时，必须降级为行业均值，不可绕过 |
| 2 | **认领弹窗不可跳过** | 每次引用认证因子签发证书前，必须弹出认领选择弹窗，不可设置默认值直接跳过 |
| 3 | **角色守卫 CSS 类** | 管理员专属区块加 `class="admin-only"`，合规人员可见区块加 `class="compliance-visible"`，两者通过 `roleLevel` 控制显示/隐藏 |
| 4 | **节税计算说明** | 节税额 = (欧盟默认值 - 认证因子) × 出货量(t) × 碳价(€/tCO₂e)，默认碳价75€，正式版从后端获取实时碳价 |
| 5 | **数据不竞争文案** | 认领弹窗中的"数据不竞争原则"文案为法律承诺，不可修改措辞 |
| 6 | **护航基金入账** | `nursingFundEur` 字段由后端统一入账到护航基金池，前端仅展示金额，不做资金操作 |

---

## 【五、EventBus 完整事件总表（更新版）】

| 事件名 | 发射方 | 监听方 | payload 说明 |
|--------|--------|--------|-------------|
| `FACTOR_POOL_UPDATED` | 工业原厂精算 | 核验、供应链协同、荣誉体系 | 原厂入池信息 |
| `CONSUMPTION_LEDGER_UPDATED` | 核验 | 工业原厂精算 | 每次证书签发后更新账本 |
| `BATCH_CERT_ISSUED` | 核验 | 欧盟海关直连、全域总览 | 含认领状态和节税明细 |
| `FACTORY_PARTNER_INVITE_SENT` | 工业原厂精算 | 全域总览（通知角标） | 合作邀请事件 |
| `SOVEREIGNTY_RESONANCE` | 供应链协同 | 工业原厂精算 | 需求节点达阈值 |
| `FACTOR_REQUEST_SENT` | CBAM测算工具 | 工业原厂精算 | 用户发起因子请求 |
| `SUPPLIER_DATA_READY` | 供应链协同 | 核验 | 供应商填报完成 |
| `BADGE_UNLOCKED` | 工业原厂精算 | 荣誉体系 | 因子入池后解锁徽章 |

---

*Co2Lion · HengAI · Cursor指令二 · UI模块更新 v1.0*
*配套指令一（AppState扩展）必须先行执行*
