# 原厂因子精算 · VO 布局草稿说明

> **策略**：先开隔离草稿，评审通过后再整体并入现网 `HengAI_工业原厂精算.html`，避免 React/shadcn 代码污染与一次性大改风险。

---

## 文件清单

| 文件 | 用途 |
|------|------|
| `frontend/HengAI_工业原厂精算.vo-draft.html` | VO 布局草稿页（独立 HTML） |
| `frontend/hengai-factor-vo-draft.css` | 草稿专用样式，**不写入** `style.css` |
| `docs/原厂因子精算/` | VO 参考源码（Next.js，只读借鉴） |

现网生产页 **未修改**：`frontend/HengAI_工业原厂精算.html`

---

## 预览入口

1. 启动本地 HTTP（见 `docs/本地UI预览与开发调试.md`）
2. 打开 **本地 UI 预览台** → 区块「原厂因子精算 · VO 布局草稿」
3. 或直接访问：

```
HengAI_工业原厂精算.vo-draft.html?dev=1&scenario=origin-preview
HengAI_工业原厂精算.vo-draft.html?dev=1&embed=1   # 模拟全域中心 iframe（仅右侧内容区）
```

**壳层**：左侧全域菜单 + 右侧顶栏 + `main-pad` 工作区，与 `HengAI_工业原厂精算.html` 一致；VO 仅作用于右侧内容区，非全屏独立页。

内容区顶部的橙色说明条可一键跳转 **现网页** 做左右对比。

---

## 从 VO 拆借了什么（本页）

VO 原设计是 **一页合成**（共振看板 + 工序矩阵 + 精算结果 + 数据主权）。草稿按全域中心架构 **拆开借用**：

| 借自 VO | 草稿中的位置 | 说明 |
|---------|--------------|------|
| 工序流程 ribbon + 横向表格 | 左侧 7 列 | 钢/铝/水泥三行业 Tab，演示数据可编辑 |
| 精算结果面板 | 右侧 5 列 | 碳强度仪表、同比折线、结构占比条 |
| 数据主权 pipeline | 页底 | LOCAL_VAULT → 脱敏 → 核验池 |
| 三 CTA + 承诺书条 | 页底 | 入池 / 月报 / 历史（草稿仅 toast） |
| 紧凑密度与青色主色 | 全局 token | `--vo-cyan` 等，与现网橙色侧栏区分 |

---

## 刻意不借 / 不放在本页

| 不借内容 | 归属 |
|----------|------|
| 共振四栏大看板（排名、荣誉、政策等） | **产业主权看板** `HengAI_HeavyIndustry_Suite.html` |
| 「定海神针」等鼓励文案 | 已按产品要求移除，草稿不含 |
| Next.js / shadcn 组件栈 | 仅参考视觉与信息架构 |
| 整页合并 sovereignty + factor | 违反「前店后厂」分模块原则 |

草稿顶部 KPI 仅为 **3 格摘要条**，完整 KPI 通过链接跳转到产业主权看板。

---

## 评审清单（确认后再并入现网）

- [ ] **7:5 分栏** 在 1100px+ 宽屏是否舒适；窄屏是否自然堆叠
- [ ] **工序矩阵** 横向滚动与现网 `proc-grid` 卡片相比，哪类行业更易填数
- [ ] **精算结果** 仪表 + 图表信息量是否足够（是否需接真实 `factor-result` 数据）
- [ ] **数据主权区** pipeline 与三 CTA 是否应置于矩阵下方（现网在更底部折叠区）
- [ ] **embed=1** 在全域中心 iframe 内边距、高度是否合格
- [ ] 与现网页 **功能对齐**：入池、GTCID、NHJC、EventBus 四条生命周期

---

## 并入现网时的建议步骤

1. 将 `hengai-factor-vo-draft.css` 中有价值的 class **合并进**现页 `<style>` 或 `style.css` 的 `fa-vo-*` 命名空间
2. 保留现网 JS：`switchInd`、`proc-grid` 生成逻辑 → 改为渲染 VO 式 **table + flow**
3. `factor-result` 区域替换为草稿右侧结构，数据仍走现有计算/API
4. 数据主权区对接 `hengai-module-pipeline.js` 与 EventBus
5. 删除或归档 `.vo-draft.html`，避免双维护

---

## 参考

- VO 组件：`docs/原厂因子精算/components/dashboard/process-matrix.tsx`、`calculation-results.tsx`、`data-security.tsx`
- 本地调试：`docs/本地UI预览与开发调试.md`
