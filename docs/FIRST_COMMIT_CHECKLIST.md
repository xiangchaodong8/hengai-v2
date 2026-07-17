# 首个 Git Commit 前清单

> 仓库当前：`main` 尚无 commit。完成 hygiene 后按本清单再提交。

## 必须做

- [ ] 根目录已有 `.gitignore`（含 `.env`、`node_modules`、`_recovery/`、`backend/static_dist/`）
- [ ] `cd frontend && npm run preflight` 通过
- [ ] `cd frontend && npm run test:e2e` 通过
- [ ] **不要**把 `backend/.env`、密钥、本地 `_recovery/` 加入暂存区
- [ ] 大体积：`HengAI_集成说明.pdf`、`冗余与副本/`、WPS 临时文件 — 确认是否入库；不确定则先移出或补 ignore

## 建议暂存范围（首 commit）

优先「可运行真理源」：

```
.cursorrules
.gitignore
docker-compose.yml
backend/          # 排除 .env
frontend/         # 含 AppState / 模块 HTML
docs/             # 契约与验收文档
.github/          # 若有 CI
static_dist/      # 与 frontend sync 后一致（或首 commit 只交 frontend，发版再 sync）
```

可延后：

```
Cursor_指令*.md          # 历史指令稿
G1/ / delivery_modules/  # 若为交付包副本
冗余与副本/
docs/BP/*.docx           # 若含商业机密可只交 md 附录
```

## 建议首条 commit message

```
chore: initial HengAI-V2 hub baseline with hygiene gates

Establish ignore rules, clear ghost-sample blockers, and align
static_dist resonance checks so preflight/e2e can gate the repo.
```

## 禁止

- 勿 `git add -A` 不看 diff
- 勿把精算芯 `HengAI_Core_Test` 误拷进本仓
- 勿在首 commit 开启 `HENGAI_COMMERCIAL_GATES_ENABLED`
