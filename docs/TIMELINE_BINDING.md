# 时间记载问题 · 根因与修复说明

## 根因（三层）

1. **后端未下发流水与时间轴**  
   `build_app_state` 仅有 `user.regDate`，没有 `gmLedger`、`milestones`、`activityTimeline`，各模块只能显示 HTML 里写死的 `04-12` / `2026-04-13`。

2. **管道未绑定时间 DOM**  
   `hengai-module-pipeline.js` 只处理姓名、ROI、会员档，未触碰 `.tx-time`、`.badge-date`、`.reg-strip .rt-date`。

3. **全域总览未灌注里程碑**  
   `applyRealData` 不更新注册条 `---`；`updateTimeline` 还把 `tl-dt4` 写回 `---`。

## 修复

| 层 | 改动 |
|----|------|
| 后端 | `hub_engine.py`：`gmLedger`、`milestones`、`activityTimeline`、`compute` |
| 管道 | `buildHubPipelinePayload` 携带上述字段 |
| 前端 | `hengai-timeline-bind.js` 统一绑定；`applyHubMilestonesToDom` |
| 母页 | 全域中心时间轴 id + `navTo` 高亮修复 + `HENGAI_HUB_NAV` |

## 法规库说明

`HengAI_法规知识库.html` 内容为**运营发布型静态知识**，非用户行为流水。展示「法规库更新 · {macro.last_updated}」；正文批次需 CMS/运营后台另行配置。

## 验收

1. 登录后打开全域中心 → 注册条显示真实 `MM-DD`（非 `---`）  
2. 有 GM 流水时 → 绿印钱包 `.tx-time` 与库内 `created_at` 一致  
3. 有徽章时 → 星火/荣誉 `.badge-date` 来自 `badges[].awardedAt`  
4. 点击「星火成就档案」→ 左侧高亮星火、顶栏标题同步  
