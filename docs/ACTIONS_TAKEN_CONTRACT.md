# HengAI V3.1 · `actions_taken` SSE 契约

> 单一真相：`hub_engine.build_app_state` → `normalize_app_state_for_frontend`  
> 消费方：`chatClient.js` → `hengaiApplyChatStateUpdate` → `hengai-state-resonance.js`

## 传输格式

对话接口 `POST /api/v1/chat` 使用 **Server-Sent Events**。在 LLM token 流之前，服务端先发一帧元数据：

```
event: actions_taken
data: {"actionsTaken":[...],"gmDelta":"0","phaseChanged":null,"updatedState":{...}}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `actionsTaken` | `array` | 本轮成功执行的动作摘要 |
| `gmDelta` | `string` | 本轮 GM 增量（Decimal 序列化为字符串） |
| `phaseChanged` | `string \| null` | 阶段跃迁，如 `Phase1` → `Phase2` |
| `updatedState` | `object` | **完整 AppState DNA**，与 `GET /api/v1/hub/overview` 同构 |

前端 **必须** 使用 camelCase 键名 `updatedState`（不是 `updated_state`）。  
`chat.py` 的 Pydantic 响应模型仍保留 `updated_state` 供非流式场景；SSE 载荷固定为 `updatedState`。

## `updatedState` 顶层结构

与 `/api/v1/hub/overview` 一致：

| 键 | 必填 | 用途 |
|----|------|------|
| `user` | ✓ | 身份、GM、注册时间、商业档位 |
| `company` | 可空 | 企业档案；无 workspace 时为 `null` |
| `metrics` | ✓ | ROI、碳税敞口、供应链覆盖率 |
| `flags` | ✓ | Phase 状态机 |
| `impact` | ✓ | 与 metrics 同步的 CBAM 冲击切片 |
| `cbam` | ✓ | 测算步骤与 `calcResult` |
| `recentReports` | ✓ | 最近报告列表 |
| `supplierNodes` | ✓ | 供应商节点 |
| `schemaVersion` | ✓ | 当前 `"3.1"` |

## `user` 身份字段（管道绑定）

后端 `normalize_app_state_for_frontend` 在吐出前 enrichment：

| 字段 | 示例 | 前端消费 |
|------|------|----------|
| `regDate` | `2024-06-01T00:00:00+00:00` | `formatHubUserIdentity` → ISO 日期 |
| `regLabel` | `注册于 2024-06-01` | 各模块 `.dyn-user-reg` |
| `tier` | `Guardian`（DB 地球公民轨） | 展示/兼容 |
| `tier_code` | `PRO_PERSONAL` | `ACCOUNT_TIER` 商业档位 |
| `tierLabel` | `个人专业版` | 会员徽章文案 |
| `gmBalance` | `128.5` | GM 钱包 |

### `tier` → `tier_code` 映射（后端）

| DB `UserTier` | `tier_code` |
|---------------|-------------|
| Seed, Sprout | `FREE_USER` |
| Guardian, Pioneer | `PRO_PERSONAL` |
| Sovereign | `ENT_VERIFIED` |
| 未登录访客 | `GUEST` |

## `metrics` 财务字段（消除「待测算」）

| 字段 | 驱动 UI |
|------|---------|
| `riskExposureEur` | 碳税敞口、`.dyn-rep-tax` |
| `roiMultiple` | ROI 倍数、`.dyn-rep-roi` |
| `taxSavingsWan` | 节税（万） |
| `supplyChainCoverage` | 供应链 %；并推导 `company.scope3Rate` |

前端 `computeRepFinancials` → `applyRepFinancialsToDom` / `buildHubPipelinePayload` 为二次汇算层；**源数字必须来自 `metrics`**。

## 前端处理生命周期

```
SSE actions_taken
  → chatClient 解析 updatedState
  → hengaiApplyChatStateUpdate(updatedState, { source: 'actions_taken' })
  → patchAppState ( _skipApply 防双补丁 )
  → hengaiAfterStateSync({ light: true })
  → broadcastHubPipelineToEmbeds
```

自定义事件：`hengai:actions-taken`（detail 与 SSE payload 同形）。

## 与 `hub/overview` 的对齐保证

- `build_app_state` 与 `build_guest_app_state` 返回前均调用 `normalize_app_state_for_frontend`。
- `chat` 流式帧中的 `updatedState` 在 `_stream_deepseek_response` 出口再次 normalize（降级快照路径亦覆盖）。
- 契约单测：`backend/tests/test_normalize_app_state.py`  
- 静态校验：`frontend/scripts/validate-actions-contract.js`

## 变更记录

| 批次 | 变更 |
|------|------|
| 7 | 新增 `normalize_app_state_for_frontend`；文档化 SSE 契约；Playwright 浏览器烟测 |
| 8 | 前端 `enrichOverviewPayloadIdentity`；`npm run preflight`；`docs/全链路通车大考.md` |
| 9 | `docker:go-live` / `smoke:live`；compose healthcheck；`docs/Docker发车指南.md` |
