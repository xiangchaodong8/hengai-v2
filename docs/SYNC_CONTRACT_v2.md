# Hub 并网 Sync 契约 v2

> **版本**：2026-06 · 对齐《三界定位 v2》  
> **消费方**：精算芯 `buildHubSyncPayload` · CL-MAT 封签推送（Phase-B）· Hub `hub_engine`  
> **原则**：仅 ingest **L0/L1 脱敏摘要**；**禁止** `processes[]` / 工序绝对能耗；Pull 资格由 `cityState` 决定，非 sync 成功即 Pull。

---

## 1. 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/hub/overview/sync` | 精算芯 / 魔盒 → Hub 城池态并网（本文档） |
| `GET` | `/api/v1/hub/overview` | 并网后 AppState 全量 DNA（已有） |
| `GET` | `/api/v1/hub/attestations` | 可选 · 并网历史列表（Hub 实现时对齐） |

### 1.1 认证

- **精算芯并网**：`Authorization: Bearer <access_token>`（原厂 CL 账号或已授权服务账号）
- **魔盒 Phase-B**：独立签名头（`cl-mat/specs/` 定稿后追加，本阶段可 `mat_service_token` 占位）
- 未认证：`401`；主体与 `productionEntity` 不匹配：`403`

### 1.2 超时与降级

- 精算侧：`AppState.hub.endpoint` 默认 `http://localhost:8000/api/v1/hub/overview/sync`，超时 **2.5s**，**Hub 离线不阻塞** :8001 初始化（见衔接说明）
- Hub 侧：sync 失败返回 JSON `detail`；精算芯本地 vault 仍保留真理

---

## 2. 与精算芯 `buildHubSyncPayload` 对齐

精算芯已实现字段（`HengAI_Core_Test/app.js`）为 **规范基线**。Hub **必须**接受下列 camelCase 键（可同时接受 snake_case 别名，响应统一 camelCase）。

### 2.1 L0 必填（最小字段集）

| 字段 | 类型 | 说明 |
|------|------|------|
| `syncTier` | `"L0"` \| `"L1"` | 精算芯分级；Hub 另派生 `cityState` / `pullEligible` |
| `source` | string | 如 `hengai_universal_core` · `cl_mat` |
| `industryId` | string | `steel` · `aluminum` · `cement` … |
| `batchId` | string | 批次指纹 |
| `dataFingerprint` | string | 数据指纹 |
| `encHash` | string | 加密哈希摘要 |
| `carbonIntensity` | number | 单位产品碳强度（**唯一可公示强度**） |
| `gmReward` | number | 本次 GM 激励（≥0） |
| `holder` | string | 原厂实名企业名称（原厂自证状态可见） |
| `productionEntity` | string | 统一社会信用代码或 CL 主体 ID |
| `productionEntitySource` | string | `local_config` \| `enterprise_legal` \| `industry_default` |
| `enterpriseRegistryId` | string \| null | 企业注册表 ID |
| `qualityTag` | object | 见 §2.3 |

### 2.2 L1 追加（`syncTier === "L1"`）

| 字段 | 类型 | 说明 |
|------|------|------|
| `cnCode` | string | HS/CN 编码 |
| `totalEmission` | number | 总排放（脱敏汇总） |
| `productOutputT` | number | 产量吨 |
| `certificateId` | string | **CL-GTCID** 权证号 |
| `issuedAt` | string (ISO8601) | 签发时间 |
| `dataFitReport` | object | 拟合度、`credibilityScore`、`suspicionLevel` 等 |
| `deviationSummary` | object | 偏差条数摘要 |

### 2.3 `qualityTag`（与精算芯一致 + v2 增量）

| 字段 | 类型 | 说明 |
|------|------|------|
| `calibration` | string | `golden` \| `cited` \| `placeholder` … |
| `matBoxLocked` | boolean | 魔盒封签状态 |
| `credibilityScore` | number \| null | 可信度 |
| `suspicionLevel` | string \| null | `LOW` \| `HIGH` |
| `maturityTier` | string | `L0_present` \| `L1_reference` \| `L2_mat_attested` \| `L3_chain_ready` |
| `provenanceGrade` | string | `unregistered` \| `cited` \| `verified` \| `golden` |
| `riskFlags` | string[] | `red` \| `star` |
| `activeJurisdiction` | string | 默认 `cbam` |

**v2 Hub 增量（可选，精算芯未传时由 Hub 派生）**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `fundingMode` | string | `self_paid` \| `resonance_triggered` |
| `provenanceGrade` | 已存在 | 软件实证多为 `cited` / `verified` |

### 2.4 禁止入站字段

以下字段 **不得**出现在 sync body（Hub `400` + `FORBIDDEN_DETAIL_FIELD`）：

- `processes` / `processes[]` / 工序明细数组
- `cems` / `rawEnergy` / `gasVolume` / `cokeRatio` 等绝对能耗
- `vault` 原始路径、LOCAL_VAULT 全量

---

## 3. Hub 派生：`cityState` 与 `pullEligible`

并网成功后，Hub **除存储 attestation** 外，必须派生：

| `cityState` | 派生条件（满足其一组合） | `pullEligible` | 下游展示 |
|-------------|-------------------------|----------------|----------|
| `evidence_building` | `matBoxLocked === false` 且 `maturityTier` ∈ `L0_present`,`L1_reference` | **false** | 实证中卡片 |
| `mat_pending` | `matBoxLocked === true` 且未达 `verified-factor-pool` 正式门槛 | **false** | 待建城池 |
| `certified` | `maturityTier` ∈ `L2_mat_attested`,`L3_chain_ready` **且** 通过 Hub 核验池规则 | **true** | 正式碳城池 |

**硬规则（v2 产品）**：

- `evidence_building` **永不可** 写入 `verified_factor` Pull 池
- `certified` 方可出现在 `GET /api/v1/hub/verified-factor-pool/search` 命中结果
- `matBoxLocked: false` 时，响应 `message` 必须含「软件实证，未 hardware 封签，不可 Pull」

### 3.1 `syncTier`（L0/L1）与展示 tier 对照

| 精算 `syncTier` | 典型 `maturityTier` | `cityState` | 能否 Pull |
|-----------------|---------------------|-------------|-----------|
| L0 | L0_present | evidence_building | 否 |
| L1 | L1_reference | evidence_building | 否 |
| L1 + mat | L2_mat_attested | mat_pending → certified | 封签完成后是 |
| L1 + mat + 法人 | L3_chain_ready | certified | 是 |

### 3.2 `cityState` ↔ `EvidenceMode` 映射（联调前置）

> 未确认映射表，不开启 `POST /api/v1/hub/overview/sync` 联调。

| `cityState` | `EvidenceMode` | 说明 |
|-------------|----------------|------|
| `evidence_building` | `PENDING_VERIFICATION` | 软件实证推进中，未达 Pull/申报资格 |
| `mat_pending` | `PENDING_VERIFICATION` | 物理网关在线/筹建中，仍非正式确权 |
| `certified` | `SOVEREIGN_VERIFIED` | 正式确权完成 |
| *(无城池态)* | `SIMULATED` | 全域线上推演，不进入城池治理口径 |

---

## 4. 请求 / 响应示例

### 4.1 请求（L1 · 软件实证 · 玩法 A）

```json
{
  "syncTier": "L1",
  "source": "hengai_universal_core",
  "industryId": "steel",
  "batchId": "BATCH-2026-0621-STL-01",
  "dataFingerprint": "fp:a1b2c3…",
  "encHash": "enc:9f8e7d…",
  "carbonIntensity": 1.87,
  "gmReward": 150,
  "holder": "武汉钢铁有限公司",
  "productionEntity": "91420000XXXXXXXXXX",
  "productionEntitySource": "enterprise_legal",
  "enterpriseRegistryId": "REG-WSG-001",
  "certificateId": "CL-GTCID-2026-WSG-STL-01",
  "issuedAt": "2026-06-21T08:00:00+08:00",
  "cnCode": "7208",
  "totalEmission": 18700,
  "productOutputT": 10000,
  "fundingMode": "self_paid",
  "qualityTag": {
    "calibration": "cited",
    "matBoxLocked": false,
    "credibilityScore": 72,
    "suspicionLevel": "LOW",
    "maturityTier": "L1_reference",
    "provenanceGrade": "cited",
    "riskFlags": [],
    "activeJurisdiction": "cbam"
  }
}
```

### 4.2 响应（200）

```json
{
  "syncTier": "L1",
  "cityState": "evidence_building",
  "pullEligible": false,
  "gmBalance": 1280,
  "gmRewardApplied": 150,
  "certificateId": "CL-GTCID-2026-WSG-STL-01",
  "holder": "武汉钢铁有限公司",
  "syncedAt": "2026-06-21T08:00:01+08:00",
  "message": "软件实证已进城池展示；未 hardware 封签，不可 Pull。下游可见：实名实证中。",
  "resonance": {
    "industryId": "steel",
    "visibleToBoundChain": true,
    "visibleToIndustryBoard": true
  }
}
```

### 4.3 错误码

| HTTP | code | 说明 |
|------|------|------|
| 400 | `INVALID_SYNC_TIER` | 非 L0/L1 |
| 400 | `FORBIDDEN_DETAIL_FIELD` | 含工序绝对值 |
| 401 | `UNAUTHORIZED` | 无 token |
| 403 | `ENTITY_MISMATCH` | token 主体 ≠ productionEntity |
| 409 | `DUPLICATE_BATCH` | 同 batchId 幂等冲突（可选实现） |
| 503 | `HUB_BUSY` | 过载 |

---

## 5. Hub 落库与 AppState 映射

并网成功后 Hub 应更新（`build_app_state` / `normalize_app_state_for_frontend` 消费）：

| AppState 路径 | 来源 |
|---------------|------|
| `company.name` | `holder`（若 workspace 匹配） |
| `company.verifiedFactor` | **仅** `pullEligible` 时写入 |
| `company.verifiedFactorCertId` | `certificateId` |
| `factorAuth.confirmedFactor` | `carbonIntensity`（展示用，标注未封签） |
| `factorAuth.confirmedIndustry` | `industryId` |
| `resonance.industryBoard[]` | 原厂实名条目 + `cityState` |
| `supplierNodes[].upstreamStatus` | 绑定链「实证中」卡片 |
| `metrics.resonanceCount` | 行业大盘（宏观，可匿名计数） |
| `flags.lastSyncAt` | `syncedAt` |

### 5.1 EventBus（前端）

Hub 宿主在 sync 成功并刷新 overview 后发射：

| 事件 | 载荷要点 |
|------|----------|
| `STATE_SYNCED` | 全量 AppState |
| `FACTOR_POOL_UPDATED` | **仅** `cityState === certified` |
| `SOVEREIGNTY_EVIDENCE_SYNCED` | **新增** · `{ holder, certificateId, cityState, pullEligible }` |

`FACTOR_POOL_UPDATED` 不得在 `evidence_building` 触发，避免下游误判可 Pull。

### 5.2 可见性双场景（强制）

- **场景 A（原厂自证状态）**：可实名展示。  
- **场景 B（下游消费账本身份）**：默认匿名，需下游 `opt-in` 后实名。  
- 原厂在其授权边界内可见真实消费主体。  

---

## 6. 共振阈值触发（Hub 原生 · 非 sync 体）

共振触发由 Hub 管理，**不**通过 `overview/sync` 传入任何交易进度。

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/v1/hub/resonance/trigger` | 共振次数 +1（无资金归集） |
| `GET` | `/api/v1/hub/resonance/trigger` | 查询阈值进度（`?productionEntity=`） |
| `POST` | `/api/v1/hub/resonance/trigger/fulfill` | 达阈后触发原厂实证入口 |

### 6.1 `trigger` 请求

```json
{
  "productionEntity": "91420000XXXXXXXXXX",
  "holder": "武汉钢铁有限公司",
  "message": "请启动 CL-GTCID 实证"
}
```

### 6.2 阈值状态（GET 响应摘要）

```json
{
  "productionEntity": "91420000XXXXXXXXXX",
  "holder": "武汉钢铁有限公司",
  "targetCount": 30,
  "currentCount": 14,
  "participantCount": 14,
  "status": "collecting | fulfilled | rejected | expired",
  "fundingMode": "resonance_triggered"
}
```

达阈后：任一供应商可选择为其购买 CL-MAT 终端 → Hub 通知原厂进入实证流程 → 原厂完成实证后走 §4 `sync` → `fundingMode: resonance_triggered`。

---

## 7. 实现检查清单（Hub 代码阶段）

- [x] `POST /api/v1/hub/overview/sync` Pydantic 模型与 §2 对齐
- [x] 拒绝 §2.4 禁止字段
- [x] `cityState` / `pullEligible` 派生逻辑 §3
- [x] `verified-factor-pool/search` 仅命中 `certified`
- [x] overview 吐出 `resonance.industryBoard` 实名列表
- [x] 绑定链节点 `upstreamCityState` 字段
- [x] EventBus `SOVEREIGNTY_EVIDENCE_SYNCED` 文档化并接线
- [x] 共振触发 API §6（`POST/GET /resonance/trigger` + `POST .../fulfill` · 无资金归集）
- [x] 工程联调冒烟：`backend/scripts/e2e_hub_sync.py` + `e2e_hub_sync_core_bridge.py`（见 `docs/SYNC_联调验收.md`）
- [x] 浏览器真联调：`frontend/e2e/_core-hub-browser-sync.mjs`
- [x] 共振举力冒烟：`backend/scripts/e2e_resonance_trigger.py`

---

## 8. 相关文档

| 文档 | 内容 |
|------|------|
| `docs/三界定位_v2.md` | 产品定位 · 双玩法 · 三态城池 |
| `docs/FUNNEL_COPY_v2.md` | 首页 → 实证 → 共振触发 → Hub 话术 |
| `HengAI_Core_Test/docs/全域中心_衔接说明.md` | 精算侧 endpoint · L0 示例 |
| `HengAI_Core_Test/docs/CL-GTCID_城池成熟度共识_V1.0.md` | maturityTier 语义 |

---

*Co2Lion · Hub Sync Contract v2 · L0/L1 ingest · cityState 派生 · Pull 仅 certified*
