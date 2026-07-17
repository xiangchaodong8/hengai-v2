# HengAI — 碳合规智能助手

> Co2Lion · 下一代碳合规 / ESG 合规 SaaS 平台

面向外贸企业、制造商与合规顾问的 AI 驱动碳合规操作系统。提供从核算、CBAM 填报、供应链因子溯源到管理层呈送包的一站式闭环。

## 功能模块

- **AI 对话引擎**：自然语言驱动碳数据录入、诊断与报告生成（DeepSeek / OpenAI SDK）
- **CBAM 测算工具**：欧盟碳边境调节机制全流程填报与自动化验算
- **企业数字档案**：碳足迹与合规状态的一体化看板（Workspace / Sandbox）
- **供应链协同**：上游因子确权、双向下游声明绑定、共振邀约
- **全域诊断报告**：多维度合规评分与风险热力图
- **星火成就体系**：GreenMark (GM) 生态积分、徽章与冠军等级
- **决策层呈送包**：一键生成 CFO / CEO 级别 PDF 简报

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | [FastAPI](https://fastapi.tiangolo.com/) · Python 3.12+ · SQLAlchemy (async) · Pydantic |
| 数据库 | PostgreSQL 16 |
| AI / LLM | OpenAI SDK → DeepSeek / 兼容 API |
| 前端 | Vanilla JS （ES Module 拆分） · Chart.js · html2pdf · Marked |
| 测试 | Playwright (E2E) · Node.js 合约校验 · Python unittest |
| 部署 | Docker Compose · Nginx |
| CI | GitHub Actions (`hengai-audit.yml`) |

## 项目结构

```
HengAI-V2/
├── backend/                    # FastAPI 后端
│   ├── main.py                 # 应用入口 & 路由挂载
│   ├── chat.py                 # AI 对话流式接口
│   ├── engine.py               # 核心业务引擎
│   ├── hub_engine.py           # AppState 聚合中枢
│   ├── intent_engine.py        # NLP 意图识别 → 结构化指令
│   ├── action_executor.py      # 动作执行器
│   ├── models.py               # SQLAlchemy ORM 模型
│   ├── auth.py / auth_utils.py # JWT 认证
│   ├── database.py             # 数据库连接管理
│   ├── frontend/               # 前端源文件（HTML 页面）
│   ├── tests/                  # 后端单元测试
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/                   # 前端 JS 构建与测试
│   ├── chatClient.js           # 对话客户端
│   ├── AppState.js             # 全局状态管理（唯一真相源）
│   ├── hengai-*.js             # 模块化组件
│   ├── e2e/                    # E2E & 因子管廊测试
│   ├── scripts/                # CI 脚本 & 合约校验
│   └── package.json
├── static_dist/                # 前端构建产物 & Nginx 根目录
├── delivery_modules/           # 交付物 HTML 模板
├── tools/                      # 运维工具脚本
├── docs/                       # 设计文档
├── docker-compose.yml          # 编排：backend + db + nginx
└── .github/workflows/          # CI
```

## 快速开始

### 环境要求

- Docker Desktop
- Node.js 20+（前端测试）
- Python 3.12+（本地开发）

### 1. 配置文件

```bash
cp backend/.env.example backend/.env
# 编辑 backend/.env 填入你的 DEEPSEEK_API_KEY
```

### 2. Docker Compose 启动

```bash
docker compose up -d
```

启动三个服务：

| 服务 | 端口 | 说明 |
|---|---|---|
| `hengai_db` | 5432 | PostgreSQL |
| `hengai_backend` | 8000 | FastAPI (uvicorn, hot-reload) |
| `hengai_nginx` | 8080 | Nginx（前端静态 + API 反向代理） |

### 3. 访问

- 前端：http://localhost:8080
- API 文档：http://localhost:8000/docs
- 健康检查：http://localhost:8000/health

### 4. 数据库初始化

容器启动后会自动执行 `Base.metadata.create_all`。如需全新重建：

```bash
docker compose stop backend
docker compose run --rm backend python init_db.py
docker compose up -d backend
```

## 开发指南

### 后端

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 前端

```bash
cd frontend
npm install
# 合约校验
npm run test:contract
# 占位符审计
npm run audit:placeholders
# 全量 CI 前检查
npm run preflight
```

### E2E 测试

```bash
cd frontend
# 无浏览器模式
npm run test:e2e
# 浏览器模式（需 Playwright）
npm run test:e2e:browser
```

### 同步到 static_dist

```bash
npm run sync:dist
```

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `DEEPSEEK_API_KEY` | LLM API Key | 必填 |
| `DEEPSEEK_BASE_URL` | LLM Base URL | `https://api.deepseek.com` |
| `LLM_MODEL` | 调用模型 | `deepseek-chat` |
| `DATABASE_URL` | PostgreSQL DSN | `postgresql+asyncpg://...` |
| `HENGAI_DB_RESET_ON_START` | 启动时重建表 | `0` |
| `JWT_SECRET` | JWT 签名密钥 | 必填 |

## CI

Push 到 `frontend/**`、`backend/` 关键文件时触发 GitHub Actions 审计：

- 占位符/伪代码扫描
- 合约接口一致性校验
- E2E 共鸣检查
- `static_dist` 同步验证

## License

Proprietary. All rights reserved.
