# 本地 UI 预览与开发调试

> 目标：在不登录、不配置原厂 Workspace 的情况下，**直接打开页面改样式、点按钮、调交互**。  
> 适用：产业主权看板、原厂因子精算及同源模块的前端迭代。

---

## 一、入口（推荐）

| 方式 | URL |
|------|-----|
| **预览台（书签这个）** | `http://127.0.0.1:8000/static/HengAI_本地UI预览台.html` |
| 仅静态服务时 | `http://127.0.0.1:8080/HengAI_本地UI预览台.html` |

文件路径：`frontend/HengAI_本地UI预览台.html`

预览台按场景列出常用链接（未认领 / 审核中 / 已通过等），一键在新标签打开。

---

## 二、启动本地 HTTP（必做）

**不要用 `file://` 双击 HTML**（`fetch`、模块路径、AppState 会异常）。

### 方式 A · Docker 全栈（与线上一致）

```powershell
cd frontend
npm run docker:go-live
```

浏览器访问：`http://127.0.0.1:8000/static/HengAI_本地UI预览台.html`

### 方式 B · 仅前端静态（改 CSS 最快）

```powershell
cd frontend
python -m http.server 8080
```

浏览器访问：`http://127.0.0.1:8080/HengAI_本地UI预览台.html`

---

## 三、`?dev=1` 做了什么

核心脚本：`frontend/hengai-dev-preview.js`

| 能力 | 说明 |
|------|------|
| 注入演示 `AppState` | 企业名、认领状态、诉求 KPI 等有默认值，页面不空 |
| 跳过原厂门禁 | `guardOriginFactoryPage()` 在 dev 模式下不再显示「工业原厂专属界面」 |
| 顶部 DEV 条 | 橙色提示条，标明当前场景，可回到预览台 |
| 与 embed 兼容 | 可加 `embed=1` 模拟全域中心 iframe 内布局 |

### 手动拼 URL

```
HengAI_HeavyIndustry_Suite.html?dev=1
HengAI_HeavyIndustry_Suite.html?dev=1&scenario=origin-pending
HengAI_HeavyIndustry_Suite.html?dev=1&scenario=origin-approved&embed=1
HengAI_工业原厂精算.html?dev=1&scenario=origin-preview
HengAI_工业原厂精算.vo-draft.html?dev=1&scenario=origin-preview
```

### 内置场景（`scenario`）

| 值 | 用途 |
|----|------|
| `origin-preview` | 原厂未认领，显示预览横幅（**默认**） |
| `origin-pending` | 主权认领审核中，可测档案弹窗 |
| `origin-approved` | 认领通过，有碳强度与执行总览 |
| `origin-rejected` | 认领驳回 |
| `sme` | 下游 SME 身份（正常会拦截看板；dev 下仍可浏览 UI） |

### 持久开关（可选）

控制台或任意页执行一次：

```javascript
localStorage.setItem('hengai_dev_preview', '1');
```

之后即使不带 `?dev=1` 也会走预览逻辑；关闭：

```javascript
localStorage.removeItem('hengai_dev_preview');
```

---

## 四、为何单独打开会看到「工业原厂专属界面」

`HengAI_HeavyIndustry_Suite.html`（产业主权看板）在生产逻辑里只允许 **ROLE_ORIGIN**（钢铁/铝/水泥等原厂）访问。

单独打开 HTML 时通常没有登录态 → `AppState.js` 的 `guardOriginFactoryPage()` 会隐藏看板并显示拦截页。

**开发时请始终加 `?dev=1`**，或从预览台进入。

---

## 五、改 UI 时对照文件

| 页面 | 文件 |
|------|------|
| 产业主权看板 | `frontend/HengAI_HeavyIndustry_Suite.html` |
| 看板样式（hi-*） | `frontend/style.css` |
| 原厂因子精算 | `frontend/HengAI_工业原厂精算.html` |
| **原厂因子精算 VO 草稿** | `frontend/HengAI_工业原厂精算.vo-draft.html` + `hengai-factor-vo-draft.css` |
| 预览 / 门禁逻辑 | `frontend/hengai-dev-preview.js`、`frontend/AppState.js` |

VO 草稿评审与并入说明见 **`docs/原厂因子精算_VO草稿说明.md`**。

改完保存 → 浏览器 **Ctrl+F5** 强刷。

---

## 六、注意事项

1. **dev 模式不调用真实入池/认领 API 的替代**；要测接口请用 Docker + 登录账号。
2. **勿将 `?dev=1` 链接发给客户或写入生产导航**。
3. 全域中心侧栏「阶段锁」仍可能限制菜单；测整站时可用预览台里的「全域中心（整站）」链接，或先在控制台放宽 `AppState.flags.unlockedMenusList`。
4. 更多发车与健康检查见 `docs/Docker发车指南.md`。

---

## 七、快速自检清单

- [ ] 地址是 `http://` 而不是 `file://`
- [ ] URL 含 `dev=1` 或从预览台点击
- [ ] 顶部出现橙色 **DEV 预览** 条
- [ ] 产业主权看板显示「产业主权看板」标题，而非「工业原厂专属界面」
