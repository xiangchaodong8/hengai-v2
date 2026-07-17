# 原厂因子精算 · VO 布局合并与回滚

## 已合并内容（现网 `HengAI_工业原厂精算.html`）

| 项 | 说明 |
|----|------|
| 7:5 工作区 | `fa-work-grid`：左工序 / 右精算结果常驻 |
| 矩阵行业 | 钢铁、铝、水泥 → 工序 ribbon + 横表（`renderProcMatrix`） |
| 混合行业 | 石化（分配法 Tab + 卡片）、数据中心 PUE 区等保持原逻辑 |
| 右侧图表 | 同比折线、结构占比：**默认演示数据**，`factorAuth.yoySeries` / `emissionStructure` 有值时自动替换 |
| 数据主权区 | 页底 pipeline + 三 CTA，接 `submitPool` / `genRiskReport` / `openPledge` |
| 因子消费账本 | **已迁出** → `HengAI_HeavyIndustry_Suite.html` `#hi-factor-ledger-card` |
| 共享脚本 | `hengai-factor-layout.css`、`hengai-factor-ledger.js` |

## 回滚方式

### 方式 A · 整页还原（推荐）

```powershell
Copy-Item frontend\HengAI_工业原厂精算.pre-vo-layout.html frontend\HengAI_工业原厂精算.html -Force
```

并手动撤销（若已合并主权看板账本）：

- `HengAI_HeavyIndustry_Suite.html` 中 `#hi-factor-ledger-card` 区块
- `hengai-factor-ledger.js` 引用

### 方式 B · 仅停用 VO 样式

删除 `HengAI_工业原厂精算.html` 内：

```html
<link rel="stylesheet" href="hengai-factor-layout.css">
```

页面会退回旧版 DOM 结构错乱风险——**建议用方式 A**。

### 参考草稿（不维护）

- `HengAI_工业原厂精算.vo-draft.html` — 早期隔离预览，**以现网为准**

## 验收清单

- [x] `?dev=1` 打开因子页：左侧 Tab 可切换，钢铁/铝/水泥为横表
- [x] 填写工序 → 右侧 `fr-val` 实时更新，`onInput` / `submitPool` 正常
- [x] 右侧图表带「演示」标签；入池后有真实数据时标签消失
- [x] 因子页**无**因子消费账本大卡片
- [x] 产业主权看板 → 「因子消费账本」折叠区（入池后有数据时显示）
- [x] `embed=1` iframe 内布局正常
- [x] 待确认绑定 → 供应链协同 `sup-origin-pending-bindings`
- [x] calc 阶段入池：顶栏 + 底部主权（右侧主按钮隐藏）

## 文件对照

| 文件 | 角色 |
|------|------|
| `HengAI_工业原厂精算.html` | 生产页（已合并 VO 布局） |
| `HengAI_工业原厂精算.pre-vo-layout.html` | 合并前快照 |
| `hengai-factor-layout.css` | VO 工作区样式 |
| `hengai-factor-ledger.js` | 账本渲染（主权看板） |
