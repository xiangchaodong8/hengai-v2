# 精算芯 ↔ Hub · Sync 工程联调验收

> **对齐**：`docs/SYNC_CONTRACT_v2.md` · `docs/三界定位_v2.md`  
> **日期**：2026-07-15  
> **范围**：`POST /api/v1/hub/overview/sync` + `POST /api/v1/hub/evidence/redeem`  
> **不在本轮**：官网 OSS 切链、CL-MAT 硬联、商业卡口 ON

---

## 1. 两条并网路径（勿混）

| 路径 | 端点 | 谁用 | 鉴权 |
|------|------|------|------|
| **A · 工程直连** | `POST /api/v1/hub/overview/sync` | 精算芯 `syncToGlobalHub` / e2e | `Authorization: Bearer <CL token>` |
| **B · 产品主路径** | `POST /api/v1/hub/evidence/redeem` | Hub 供应链「兑换实证包」 | 同上 + `HENGAI1.` 兑换码 |

硬规则（契约 §3）：

- `evidence_building` / `mat_pending` → **不可 Pull**
- 仅 `certified` 写入 `verified-factor-pool`
- 禁止 `processes[]` / 绝对能耗入站

---

## 2. 启动

```powershell
# Hub :8000
cd C:\Users\Administrator\Desktop\HengAI-V2
docker compose up -d

# 健康检查
curl.exe http://127.0.0.1:8000/api/health
```

精算芯 :8001（浏览器联调可选）：

```bat
cd C:\Users\Administrator\Desktop\HengAI_Core_Test
run_test.bat
```

并网联调时，将 `HengAI_Universal_Core.html` 内：

```js
LOCAL_CONFIG.standalone = false
LOCAL_CONFIG.hubAccessToken = '<登录全域中心后拿到的 access_token>'
```

或 URL：`http://localhost:8001/...?hubToken=<token>`

---

## 3. 自动化冒烟（本仓必跑）

```powershell
cd C:\Users\Administrator\Desktop\HengAI-V2

# 既有 Hub sync 冒烟
python backend/scripts/e2e_hub_sync.py

# Core 载荷形状 + Bearer 门禁 + 兑换码双路径
python backend/scripts/e2e_hub_sync_core_bridge.py
```

期望：全部 PASS，打印 `"ok": true`。

---

## 4. 浏览器真联调（已自动化）

### 4.1 一键脚本（推荐）

```powershell
# Hub 需 healthy；脚本可自动拉起 Core :8001
cd frontend
node e2e/_core-hub-browser-sync.mjs
```

期望：`ok: true` · `cityState: evidence_building` · `pullEligible: false`

**结果（2026-07-17）**：PASS（Edge · Core `syncToGlobalHub` → Hub overview）

### 4.2 人工手测

1. 登录 `http://127.0.0.1:8000/static/全域中心.html`，抄 `access_token`
2. 企业档案 `creditCode` 与精算芯并网 `productionEntity` 一致
3. 打开：
   `http://127.0.0.1:8001/HengAI_Universal_Core.html?hubSync=1&hubToken=<token>`
   （`hubSync=1` 仅覆盖本次会话 `standalone`，不改 POC 默认）
4. 加冕触发并网，或控制台调用 `syncToGlobalHub(bundle)`
5. Hub overview：`factorAuth.cityState === evidence_building`

---

## 5. 本轮已落地改动

| 位置 | 内容 |
|------|------|
| `backend/scripts/e2e_hub_sync_core_bridge.py` | Core 形状 payload · 无 Bearer→401 · 禁 processes · redeem 双路径 |
| `HengAI_Core_Test/app.js` | `syncToGlobalHub` 注入 Bearer；缺 token / 401 明确提示；超时用 `fetchWithTimeout` |
| `backend/models.py` + `main.py` | `verified_factor_cert_id` 扩至 VARCHAR(96)，启动时 ALTER |
| `backend/hub_engine.py` | certified 并网不再把长 CL-GTCID 写入 `verification_code`；改签发短批次码 |
| 本文档 | 联调验收步骤 |

**冒烟结果（2026-07-15）**：`e2e_hub_sync.py` OK · `e2e_hub_sync_core_bridge.py` 全 PASS。

---

## 6. 共振触发 API §6（已落地）

```powershell
python backend/scripts/e2e_resonance_trigger.py
```

端点：`POST/GET /api/v1/hub/resonance/trigger` · `POST .../fulfill`  
规则：同一 workspace 不重复计次；达阈后 fulfill 写 `fundingMode=resonance_triggered`；**无资金归集**。

**结果（2026-07-17）**：PASS

## 7. 精算芯签发 HENGAI1 兑换码（已落地）

| 侧 | 路径 |
|----|------|
| Core | `POST http://127.0.0.1:8001/api/v1/core/evidence/issue-redeem` |
| Hub | `POST http://127.0.0.1:8000/api/v1/hub/evidence/redeem` |
| 密钥 | 两端默认 `dev-redeem-hmac-change-me`（生产设同值 `HENGAI_REDEEM_HMAC_SECRET`） |

```powershell
# 需 :8000 + :8001 均在线
python backend/scripts/e2e_core_issue_redeem.py
```

**结果（2026-07-17）**：PASS（签发 → 兑换 → 防重放 409）

### 人工测验（推荐）

1. **起服**
   - Hub：`docker compose up -d` → http://127.0.0.1:8000/static/全域中心.html  
   - Core：桌面 `HengAI_Core_Test` 下 `run_test.bat` → http://127.0.0.1:8001/HengAI_Universal_Core.html  

2. **签发（Core）**  
   浏览器打开精算芯，F12 控制台：

```js
const sync = {
  syncTier: 'L1', source: 'hengai_universal_core', industryId: 'steel',
  batchId: 'MANUAL-' + Date.now(), dataFingerprint: 'fp:m1', encHash: 'enc:m1',
  carbonIntensity: 1.87, gmReward: 50, holder: '你的企业名',
  productionEntity: '你的统一社会信用代码', // 必须与 Hub 企业档案一致
  qualityTag: { calibration:'cited', matBoxLocked:false, maturityTier:'L1_reference',
    provenanceGrade:'cited', riskFlags:[], activeJurisdiction:'cbam' }
};
const r = await issueHubRedeemPackage(sync, { asSync: true });
console.log(r.redeemCode); // 已尝试复制到剪贴板
```

3. **兑换（Hub）**  
   - 登录全域中心，企业档案 `creditCode` = 上面的 `productionEntity`  
   - 打开 `[供应链协同]` →「导入精算芯实证包」粘贴 `HENGAI1.…` → 提交  
   - 期望：城池 `evidence_building`，不可 Pull；同一码再兑 → 已使用  

4. **一键冒烟（省手工）**

```powershell
cd C:\Users\Administrator\Desktop\HengAI-V2
python backend/scripts\e2e_core_issue_redeem.py
```

## 8. 共振/举力前端入口（已落地）

供应链协同页（`HengAI_供应链协同.html`）新增卡片 **「实名举力 · 推动上游进入实证」**：

- 举力 +1 → `POST /api/v1/hub/resonance/trigger`
- 查询进度 → `GET .../resonance/trigger?productionEntity=`
- 达阈开启实证入口 → `POST .../resonance/trigger/fulfill`

手测：登录 SME 账号 → 全域中心 `#supply` → 填写原厂信用代码与名称 → 举力 → 见进度条文案。

## 9. 仍待

| 项 | 说明 |
|----|------|
| 官网 OSS 切链 | Hub Done 后再动 |
| 生产 HMAC 密钥 | 两端统一正式密钥，勿用默认串 |

---

*Co2Lion · Sync 工程联调验收 · Path A/B*
