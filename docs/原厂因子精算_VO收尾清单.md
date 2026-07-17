# 原厂因子精算 · VO 收尾清单

> **性质**：在「不插队 CL-MAT / 精算芯 / 回填」前提下，把 `frontend/HengAI_工业原厂精算.html` 从 **85% → 可验收**。  
> **真理源**：`frontend/`（`:8000` 由 `backend/main.py` 挂载 `frontend`，非 `static_dist`）。  
> **回滚**：`HengAI_工业原厂精算.pre-vo-layout.html` → 现网文件。

---

## 已锁定决策（2026-06-23）

| # | 决策 | 结论 |
|---|------|------|
| 1 | **static_dist** | **只标注、本轮不手工同步**；`:8000` 真理源恒为 `frontend/` |
| 2 | **待确认绑定** | 落在 **`HengAI_供应链协同.html`**；因子页删除 `renderPendingBindings` 相关死链 |
| 3 | **入池 CTA** | **隐藏**右侧 `#btn-submit-pool`；calc/pooled 保留 **顶栏 + 底部主权** 两处 |

### static_dist 会不会成遗留问题？

**对现网 Hub（Docker / `main.py` 挂 `frontend/`）→ 不会。** 用户看到的永远是 `frontend/`，与 `static_dist` 是否旧无关。

**可能踩坑的只有这些场景**（标注清楚即可规避）：

| 场景 | 风险 | 缓解 |
|------|------|------|
| 有人直接打开仓库根 `static_dist/*.html` 做预览 | 看到 VO 前旧因子页 | 在 `static_dist/README`（或 Docker 指南）写：**非运行时真理，请用 `:8000` 或 `frontend/`** |
| 某部署脚本误挂 `static_dist` 而非 `frontend` | 整站回退旧 UI | 部署 checklist 只认 `frontend`；`docker-compose` 已挂 live frontend |
| Git 里 `static_dist` 与 `frontend` 长期 diff | 新人困惑、误改错目录 | **首版 git commit / 发版前** 跑一次 `cd frontend && npm run sync:dist` 并提交（不算插队开发，是一次性 hygiene）；或 CI 已含 sync 步骤但**不会自动 push**，需发版时手动 sync+commit |
| `backend/static_dist` 副本 | 同上 | 与根 `static_dist` 同策略，由 `sync-static-dist.js` 一并更新 |

**结论**：选「只标注」**不是产品遗留债**，是 **仓库副本次生滞后**；Hub 跑起来不受影响。建议在 **P2 收尾或首次 commit 前** 用一条命令 sync 进库，之后改 `frontend` 时发版再 sync，避免双份 HTML 永久分叉。

---

## 使用方式

- 按 **P0 → P1 → P2** 顺序做；每项做完打 `[x]` 并记日期。
- 每项附 **验收动作**；失败则停在该项，不往下堆 diff。
- 单 PR / 单次提交建议只含 **一个优先级块**，便于回滚。

---

## P0 · 真源与可观测（先做）

| # | 项 | 现状 | 动作 | 验收 |
|---|----|------|------|------|
| P0-1 | **运行时真理源** | `main.py` 已指向 `frontend/` | 本地 `:8000` 打开 `#factor-auth`，确认 iframe 为 7:5 布局、无账本大卡片 | ✅ |
| P0-2 | **static_dist 标注** | 副本仍为 VO 前旧版；**本轮不手工 sync** | `static_dist/README.md` + Docker 指南 | ✅ |
| P0-3 | **手动冒烟（embed）** | — | 顶栏阶段 + 入池 CTA 收敛 | ✅ 代码/E2E |
| P0-4 | **手动冒烟（独立页）** | — | 侧栏/8 行业/锁定 | ✅ 结构保留 |

---

## P1 · 逻辑悬空与 IA 收敛

| # | 项 | 现状 | 动作 | 验收 |
|---|----|------|------|------|
| P1-1 | **待确认绑定 UI** | DOM 缺 | 供应链 `sup-origin-pending-bindings` | ✅ |
| P1-2 | **入池 CTA 去重** | 三处入池 | 隐藏右侧主按钮 | ✅ |
| P1-3 | **死调用清理** | 因子页 ledger | 已移除 | ✅ |
| P1-4 | **置信度文案** | Lv.4 写死 | `#pool-confidence-label` | ✅ |

---

## P2 · 整洁度、测试与文档

| # | 项 | 现状 | 动作 | 验收 |
|---|----|------|------|------|
| P2-1 | **死 CSS** | `.heatmap` / `.privacy-wall` | 已删未用规则 | ✅ |
| P2-2 | **重复主权文案** | `#fa-privacy-fold` | 已删 | ✅ |
| P2-3 | **E2E 账本用例** | 因子页 DOM | 改测主权看板 | ✅ |
| P2-4 | **E2E 因子主路径** | ziteng | 补 VO 布局断言 | ✅ |
| P2-5 | **回滚说明验收框** | 未勾 | 已更新 | ✅ |

---

## 建议排期（贴合初期计划）

| 批次 | 内容 | 预估 |
|------|------|------|
| **批次 1** | P0 全部（含 static_dist 文档标注） | 0.5 天 |
| **批次 2** | P1-1 绑定 UI → **供应链协同** | 0.5–1 天 |
| **批次 3** | P1-2～P1-4 | 0.5 天 |
| **批次 4** | P2 整洁 + E2E | 0.5 天 |

**不做（已校准，勿插队）**：只读授权书签署、6 个月回填、`CLE` 注册/sync、精算芯并网 UI。

---

## 完成定义（Definition of Done）

- [x] P0 四项全过（文档标注 + 结构/E2E 对齐）
- [x] P1 四项全过（绑定 UI → 供应链 · CTA 收敛 · 死调用 · 置信度文案）
- [x] P2 E2E 与文档勾选完成
- [x] `docs/HUB_PAGE_ACCEPTANCE.md` 中 factor-auth 仍 PASS（`npm run test:factor-vo` · 2026-06-23 实跑 29/29 通过）
- [x] 未新增 CL-MAT / 精算芯 / 回填相关入口  

---

*Owner：全域中心前端 · 对齐 `原厂因子精算_VO合并回滚说明.md`*
