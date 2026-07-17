# static_dist · 非运行时真理源

> **勿用于本地开发预览或 Docker 现网。**  
> 运行时真理源为仓库根目录 **`frontend/`**（`backend/main.py` 挂载 `/app/frontend`，见 `docs/Docker发车指南.md`）。

## 用途

- 离线静态包 / CI 一致性镜像（由 `frontend/scripts/sync-static-dist.js` 生成）
- 与 `backend/static_dist/` 同步，内容相同

## 发版前（可选 hygiene）

```powershell
cd frontend
npm run sync:dist
```

将 `static_dist/` 与 `backend/static_dist/` 一并提交，避免 Git 中与 `frontend/` 长期分叉。

## 开发纪律

- 改 HTML/JS/CSS **只改 `frontend/`**
- 不要直接编辑本目录 expecting `:8000` 立即生效
- 预览请用 `http://localhost:8000/static/...`（读 live `frontend`）
