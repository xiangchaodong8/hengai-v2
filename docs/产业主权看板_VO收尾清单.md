# 产业主权看板 · VO 收尾清单

> **性质**：在「不插队 CL-MAT / 精算芯 / 回填」前提下，把 `frontend/HengAI_HeavyIndustry_Suite.html` 从 **~70% → 可验收**。  
> **真理源**：`frontend/`（`:8000` 由 `backend/main.py` 挂载 `frontend`）。  
> **定位**：`docs/三界定位_v2.md` §9.3 — **可视化壳**（大盘、榜、动效）；不算力真理（→ `factor-auth`）。

---

## 已锁定决策（2026-06-23）

| # | 决策 | 结论 |
|---|------|------|
| 1 | **工序矩阵** | **embed 与 standalone 均隐藏** `#hi-body-wrap`；精算收敛至原厂因子精算 |
| 2 | **CTA 去重** | **执行简报**保留精算/核验/供应链三按钮；底部 hero **隐藏** `#hi-btn-goto-factor` / `#hi-btn-attest` |
| 3 | **消费账本** | 留在 `#hi-factor-ledger-card`；样式 scoped 至看板；本页 **`loadOriginLedger()`** 拉 API |
| 4 | **导航标签** | `shared-shell.html` 中 `origin-audit` → **产业主权看板**（非「原厂因子精算」） |
| 5 | **三类材料边界** | ① 政策配套 = 只读告示；② CL 事实材料 PDF = 客观附件；③ 企业内部呈批 = **`#decision` 决策层呈送包**（经办人组稿） |

---

## P5 · 材料边界收敛（2026-06-23）

| # | 项 | 动作 | 验收 |
|---|----|------|------|
| P5-1 | **政策弹窗** | 只读 + 免责；移除预算/导出 CTA | ✅ E2E `policyReadOnly` |
| P5-2 | **事实材料 PDF** | 重命名 · 去呈批章/补贴章 | ✅ `exportComplianceFactBriefPdf` |
| P5-3 | **执行总览** | embed 可见：`导出 CL 事实材料` + `去决策层呈送包` | ✅ E2E |
| P5-4 | **确权转化弹窗** | 事实附件 vs 呈送包分按钮 | ✅ |

---

## P6 · 影响力榜单可读性（2026-06-23）

| # | 项 | 动作 | 验收 |
|---|----|------|------|
| P6-1 | **榜单边界** | 说明「其他原厂 #1–7」vs「本企业」 | ✅ E2E |
| P6-2 | **EIS 释义** | 区块内常驻公式条 | ✅ |
| P6-3 | **示意命名** | 示意原厂 A–G · 待链上汇入 | ✅ |
| P6-4 | **名次文案** | 第 N 名 · 非 # 混淆 | ✅ |

---

## P7 · CBAM 敞口双币种（2026-06-23）

| # | 项 | 动作 | 验收 |
|---|----|------|------|
| P7-1 | **默认 A** | 决策级 KPI · € 主 + ¥ 副 | ✅ `F.moneyExposureHtml` |
| P7-2 | **用户偏好** | `eur_primary` / `cny_primary` / `eur_only` · localStorage | ✅ 总览 + CBAM |
| P7-3 | **汇率** | `macro.eur_cny_rate` · 参考折算免责 | ✅ |

---

## P0 · 导航与真源

| # | 项 | 动作 | 验收 |
|---|----|------|------|
| P0-1 | **shared-shell 标题** | `PAGE_TITLE_MAP` + 侧栏 lbl | ✅ |
| P0-2 | **Hub embed 路由** | `全域中心.html#origin-audit` iframe | ✅ E2E |

---

## P1 · IA 收敛（与因子页 VO 同规格）

| # | 项 | 动作 | 验收 |
|---|----|------|------|
| P1-1 | **隐藏第二算力** | `.hi-body{display:none!important}` 全局 | ✅ embed + standalone |
| P1-2 | **底部 CTA 去重** | hidden + CSS 隐藏重复 hero | ✅ E2E |
| P1-3 | **执行简报主导航** | `#hi-eb-actions` 三按钮保留 | ✅ E2E |

---

## P2 · 账本与样式

| # | 项 | 动作 | 验收 |
|---|----|------|------|
| P2-1 | **账本 scoped CSS** | `#hi-factor-ledger-card .card/.pill/.sh-t` | ✅ |
| P2-2 | **loadOriginLedger** | `GET hub/origin-factor-ledger` → `bindAppState` | ✅ E2E 函数存在 |
| P2-3 | **消费账本 E2E** | 沿用 `test:factor-vo` 第 2 段 | ✅ |

---

## P3 · UI 对齐全域中心（2026-06-23）

| # | 项 | 动作 | 验收 |
|---|----|------|------|
| UI-1 | **embed 壳** | 藏 `hi-topbar`；`#hi-warroom-main` main-pad 24/28；`hi-embed-strip` | ✅ E2E |
| UI-2 | **区块标题** | 四区块 `.sh/.sh-t/.sh-line` + `.hi-hub-section` | ✅ E2E |
| UI-3 | **KPI / 按钮** | `.metric` / `.act-btn` / `.prog`；减 glass glow | ✅ |
| UI-4 | **账本 / 榜单** | 账本单层 card；podium 收入 fold | ✅ |
| UI-5 | **standalone 底** | ISO pipeline → `.ins-blue`；`.act-btn` 预算/足迹 | ✅ |

样式真理源：`hi-hub-tokens.css` + **`hi-hub-align.css`**（Hub 组件 scoped `#hi-suite`）。

---

## P4 · 回归命令

```powershell
cd frontend
npm run test:origin-audit
```

含：`e2e/_origin-audit-vo.mjs`（壳对齐 + CTA + Hub iframe）+ `_factor-consumption-ledger.mjs`（账本数据态）。

---

## 完成定义（Definition of Done）

- [x] P0–P2 全过
- [x] P3 UI 对齐（UI-1～UI-5）
- [x] `npm run test:origin-audit` 通过
- [x] `docs/HUB_PAGE_ACCEPTANCE.md` 中 origin-audit 仍 PASS
- [x] 未新增 CL-MAT / 精算芯 / 回填相关入口

---

*Owner：全域中心前端 · 对齐 `原厂因子精算_VO收尾清单.md`*
