# Hub 页面功能验收 · 阶段 ①（功能优先）

> **真理源静态目录**：`frontend/` → `http://localhost:8000/static/`  
> **商业卡口**：`AppState.js` → `HENGAI_COMMERCIAL_GATES_ENABLED = false`（功能阶段禁止拦截）  
> **卡口预留表**：同文件 → `COMMERCIAL_GATE_REGISTRY`（后期只改注册表 + 开开关）

---

## 开发纪律（固定顺序）

| 阶段 | 内容 | 当前 |
|------|------|------|
| ① | 每页核心功能跑通（API + AppState） | **进行中** |
| ①‑b | 双模状态机 Phase 1（CBAM Evidence Bar） | **已归档** · 见 `双模状态机_开发契约_v1.md` §6 |
| ② | 角色静默分轨（原厂/SME UI，无广告牌） | 部分（CBAM） |
| ③ | FUNNEL 话术 / 空态 | 冻结 |
| ④ | 商业卡口（Pro / 金库 / 共振触发） | **冻结** · 开关 OFF |

---

## 页面验收矩阵

| 路由/页面 | 文件 | ① 功能通过标准 | 状态 |
|-----------|------|----------------|------|
| 首页 T0 | `index.html` | Widget 粗测出数；无「可申报」暗示 | **① PASS**（queue e2e） |
| CBAM 测算 | `全域中心.html#calc` · `HengAI_CBAM测算工具.html` | 1→4 步算完；`commit cbam` 成功；Evidence Bar 三态 + shadow/drift | **① PASS**（cbam + evidence e2e） |
| 企业数字档案 | `HengAI_企业数字档案.html` | `workspace-update` 落库；overview company 更新 | **① PASS**（queue e2e） |
| 供应链协同 | `HengAI_供应链协同.html` | invite + binding + consume + redeem/revoke/函件 + **申请/审批解锁** | **① PASS**（supply batch · 27项） |
| 产业链核验 | `HengAI_核验.html` | **上游** GTCID/因子池；**下游** supplier-conclusion + CL-CLAIM；步骤门禁 | **① PASS**（verify e2e · 上游+下游） |
| 产业主权看板 | `HengAI_HeavyIndustry_Suite.html` | overview 驱动战情室；embed 藏顶栏+main-pad；Hub `.sh`/`.metric`/`.act-btn` 对齐 | **① PASS**（`npm run test:origin-audit` · 16+6 项） |
| 原厂因子精算 | `HengAI_工业原厂精算.html` | attest API + GTCID 展示 + 行业收敛 + embed 壳 + **VO 7:5 / CTA 收敛** | **① PASS**（`npm run test:factor-vo` · 29 项） |

**回归账号**：登录后固定使用同一测试账号（建议 ziteng 或自建 steel 原厂）。

---

## 商业卡口预留（后期统一调整）

所有 hook 已在 `frontend/AppState.js` → `COMMERCIAL_GATE_REGISTRY` 登记。  
启用方式：

```javascript
window.HENGAI_COMMERCIAL_GATES_ENABLED = true;
```

各调用点应使用 `notifyCbamCommercialBlock(actionId)` 或 `checkCommercialGate(actionId)`，**不要**在页面内写散落 if。

### 维度说明

| dimension | 含义 | 典型卡口 |
|-----------|------|----------|
| `passport` | 个人护照 account_tier | Pro ¥99、访客登录 |
| `supplyChainRole` | 原厂 vs SME | Pull 仅 SME；Suite 仅 ORIGIN |
| `workspaceVault` | Phase / Sandbox / Certified | Phase2 才共振；企业金库 ¥29800 |
| `cityState` | 城池三态 | Pull 仅 `certified`（产品规则，非 tier） |
| `mat` | CL-MAT 物理网关 | 改脱碳路径 Upsell 2B |

### 已接线 actionId（CBAM）

| actionId | hook 位置 | 后期卡口 |
|----------|-----------|----------|
| `commit_cbam` | `cbam-calc-core.js` persistCbamCommit | login + Pro |
| `pull` | `cbam-verified-factor.js` | login + SME 角色 |
| `verify` | 同上 | login + SME |
| `detect_doc` | 同上 | login + SME |
| `resonance` | `cbam-v2-tracks.js` | login + Phase2 |

### 已登记待接线（④ 阶段）

| actionId | 页面 | 说明 |
|----------|------|------|
| `widget_round_6` | index | 对话第 6 轮 Paywall |
| `widget_download` | index | 下载报表 Pro |
| `resonance_trigger` | 供应链 | 共振阈值触发 |
| `mat_path_edit` | factor-auth | MAT Upsell 2B |
| `industry_factor_attest` | factor-auth | 原厂 + Phase2（后端已有） |

### 非商业 · 角色分轨（始终 ON，不走开关）

| 机制 | 文件 |
|------|------|
| 原厂误点 Pull | `cbam-identity-sovereignty.js` |
| SME 进 Suite 挡板 | `guardOriginFactoryPage()` |
| Pull 仅 certified | `canPullVerifiedFactor()` + 后端 pool |

---

## 自动化验收命令

```bash
# API 层（原厂 commit + SME pool/resonance + ziteng 回归）
python backend/scripts/e2e_cbam_acceptance.py

# 浏览器层（商业开关 OFF + Step UI + 无 pageerror）
node frontend/e2e/_cbam-acceptance-browser.mjs

# 阶段 ① 队列 · 首页 T0 + 企业数字档案
python backend/scripts/e2e_hub_phase1_queue.py
node frontend/e2e/_hub-phase1-queue-browser.mjs

# 阶段 ① · 供应链协同批次（invite + binding + redeem + revoke + 申请/审批 + 函件）
python backend/scripts/e2e_hub_supply_batch.py

# 阶段 ① · 核验（GTCID 对账 + 因子池检索 + 步骤门禁）
python backend/scripts/e2e_hub_verify_phase1.py

# 阶段 ① · 原厂资产确权（overview 战情室 + 角色分轨）
python backend/scripts/e2e_hub_origin_audit_phase1.py

# 阶段 ① · 工业原厂精算（attest + GTCID + 行业收敛 + VO 收尾）
cd frontend && npm run test:factor-vo
# 或 API 层：python backend/scripts/e2e_hub_factor_auth_phase1.py
```

**2026-06-21 结果**：31/31 API PASS · 8/8 浏览器 PASS（CBAM）  
**2026-06-23 结果**：19/19 API PASS · 10/10 浏览器 PASS（T0 + 企业档案）  
**2026-06-23 结果**：27/27 API PASS（供应链协同 · 含申请/审批解锁）  
**2026-06-23 结果**：17/17 API PASS（核验 · 上游 GTCID + 下游 supplier-conclusion/claim-verify）
**2026-06-23 结果**：18/18 API PASS（工业原厂精算 · attest + GTCID + 收敛壳）  
**2026-06-23 结果**：29/29 浏览器 PASS（VO 收尾 · `test:factor-vo`：因子页 + 主权账本 + 供应链 pending UI）  
**2026-06-23 结果**：22/22 API PASS（原厂资产确权 · overview 战情室 + 角色边界）

---

## 手测 · CBAM（① 第一步）

1. 硬刷新 `http://localhost:8000/static/全域中心.html#calc`
2. 登录原厂账号 → 走完 Step 1–4，**无**顶部商业卡片、**无** Pro 拦截 Toast
3. 确认供应链区为「城池指挥台」，非 SME Pull 主流程
4. 换 SME 账号 → Pull / 共振可点（不因 FREE_USER 被 commit 拦住）
5. 控制台：`commercialGatesEnabled()` → `false`

---

## 与并网 / 精算芯

| 项 | 阶段 |
|----|------|
| 双模 Phase 1（Evidence Bar / 升格 PENDING） | **已归档** |
| `POST /overview/sync` redeem UI · 精算芯钥匙码 | **Hub 已实现** · `POST /api/v1/hub/evidence/redeem` + 供应链页兑换入口 |
| `POST /overview/sync` 工程联调 | **冒烟 PASS** · 见 `docs/SYNC_联调验收.md`；浏览器注入 token 可选手测 |
| :8001 精算芯浏览器联调 | `standalone:false` + `hubAccessToken`；见联调验收 §4 |
| 官网切链 | Hub 验收通过后 |

**当前队列（① 待验）**：~~原厂资产确权 → 工业原厂精算~~ **① 矩阵已全部 PASS** → **Sync 工程联调进行中**（见 `docs/SYNC_联调验收.md` · `e2e_hub_sync_core_bridge.py`）

---

*Co2Lion · Hub 功能验收 · 卡口预留注册表 · 开关 OFF*
