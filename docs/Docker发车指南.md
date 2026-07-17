# HengAI V3.2 · Docker 发车指南（批次 9）

> 唯一入口：`http://localhost:8000/static/index.html`  
> 真理源：`./frontend` 挂载到容器 `/app/frontend`（改 HTML 后浏览器 **Ctrl+F5**）  
> **非真理源**：仓库根 `static_dist/`、`backend/static_dist/` 仅为离线包副本；详见 [`static_dist/README.md`](../static_dist/README.md)。发版前可选 `cd frontend && npm run sync:dist`。

---

## 一、前置条件

| 工具 | 用途 |
|------|------|
| Docker Desktop | `docker compose` |
| Node.js 20+ | `npm run preflight` |
| Python 3.11+ | 后端契约单测（preflight 内） |

`backend/.env` 需配置 `DEEPSEEK_API_KEY`（对话功能；烟测不强制）。

---

## 二、推荐：一键发车

在项目根目录执行：

```powershell
cd frontend
npm run docker:go-live
```

等价于：

1. `npm run preflight`（静态审计 + 契约 + 后端单测）
2. `docker compose up -d --build`
3. 轮询 `GET /api/health` 直至就绪
4. `smoke-live-stack`（overview / 静态资源 / AppState 关键字）

跳过本地 preflight（仅重建容器时）：

```powershell
$env:SKIP_PREFLIGHT="1"
npm run docker:go-live
```

---

## 三、手动分步

```powershell
# 1. 代码侧校验
cd frontend
npm run preflight

# 2. 启动栈
cd ..
docker compose up -d --build

# 3. 查看状态
docker compose ps
docker compose logs -f backend

# 4. 运行栈烟测
cd frontend
npm run smoke:live
```

---

## 四、健康检查说明

`docker-compose.yml` 中 `backend` 服务：

- **depends_on**：等待 Postgres `healthy`
- **healthcheck**：`GET /api/health` 返回 `{"status":"ok"}`

数据库慢启动时，backend 可能重启数次，属正常现象。

---

## 五、烟测覆盖项

| 请求 | 预期 |
|------|------|
| `/api/health` | `status: ok` |
| `/api/v1/hub/overview` | `user.tier_code` + `schemaVersion: 3.1` |
| `/static/index.html` | 含 `AppState.js` |
| `/static/AppState.js` | 含 `enrichOverviewPayloadIdentity` |
| `/static/hengai-state-resonance.js` | 含 `hengaiApplyChatStateUpdate` |

自定义地址：

```powershell
$env:HENGAI_BASE_URL="http://127.0.0.1:8000"
npm run smoke:live
```

---

## 六、常见问题

### 1. `8000` 端口占用

修改 `docker-compose.yml` 中 `ports: "8001:8000"`，并设置：

```powershell
$env:HENGAI_BASE_URL="http://127.0.0.1:8001"
```

### 2. 静态页 404

确认容器内文件存在：

```powershell
docker exec hengai_backend test -f /app/frontend/index.html
```

应输出无错误；否则检查 `./frontend` 挂载。

### 3. overview 无 `tier_code`

确保 `backend/hub_engine.py` 含 `normalize_app_state_for_frontend`；拉最新代码后 `docker compose up -d --build`。

### 4. 对话 503

`DEEPSEEK_API_KEY` 未配置 —— 不影响财务数字绑定烟测，仅对话不可用。

---

## 七、发车后人工验收

自动化通过后，继续执行：**[全链路通车大考.md](./全链路通车大考.md)**

---

## 相关命令速查

```powershell
cd frontend
npm run preflight          # 仅本地校验
npm run smoke:live         # 仅运行栈烟测（需容器已 up）
npm run docker:go-live     # preflight + compose + smoke
npm run sync:dist          # 同步 offline 包
npm run test:factor-vo     # 原厂因子 VO 收尾 E2E（需 :8000 已启动）
```
