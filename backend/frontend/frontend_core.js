/**
 * frontend_core.js — HengAI V3.1 前端渲染引擎
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 唯一真理协议：所有 HTML 数字必须来自 window.AppState
 * 严禁在 HTML 里硬编码任何业务数字！
 *
 * 核心 API：
 *   syncAllInternalData(state)   → 全量灌注，所有 .dyn-* 节点瞬间更新
 *   patchState(delta)            → 局部补丁，仅更新变化的字段（律动感跳变）
 *   initHengAI()                 → 页面加载入口，拉取首屏数据并初始化
 */

;(function (global) {
  "use strict"

  // ─── 唯一 API 地址源（与 chatClient.js 严格一致）─────────────────────────
  //
  // 解析顺序：
  //   1. window.APP_CONFIG.API_BASE （部署时由 config-sync.js 注入，例如 nginx 代理域）
  //   2. http://localhost:8000        （开发环境后端默认监听端口）
  //
  // 不允许出现裸路径 fetch("/api/...")——必须显式拼接 API_BASE，避免
  // Nginx/Vite 代理回环导致前端拿不到 8000 端口的真实后端，从而报 404。

  const API_BASE = (
    (typeof global !== "undefined" && global.APP_CONFIG && global.APP_CONFIG.API_BASE) ||
    "http://localhost:8000"
  ).replace(/\/+$/, "")

  if (typeof global !== "undefined") {
    global.HENGAI_API_BASE = API_BASE
  }


  // ─── 格式化工具 ────────────────────────────────────────────────────────────

  const fmt = {
    /** 数字加千分位，保留指定小数 */
    num: (v, decimals = 0) => {
      if (v == null || v === "") return "—"
      return Number(v).toLocaleString("zh-CN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    },
    /** 欧元金额 */
    eur: (v) => {
      if (v == null) return "—"
      if (v >= 1_000_000) return `€${(v / 1_000_000).toFixed(2)}M`
      if (v >= 10_000)    return `€${fmt.num(v, 0)}`
      return `€${fmt.num(v, 2)}`
    },
    /** 百分比，0.0~1.0 → "38.6%" */
    pct: (v, decimals = 1) => {
      if (v == null) return "—"
      return (Number(v) * 100).toFixed(decimals) + "%"
    },
    /** tCO2e 碳排放量 */
    tco2e: (v) => {
      if (v == null || v === 0) return "—"
      if (v >= 10_000) return `${fmt.num(v / 1000, 2)}k tCO₂e`
      return `${fmt.num(v, 2)} tCO₂e`
    },
    /** GM 余额 */
    gm: (v) => {
      if (v == null) return "0 GM"
      return `${fmt.num(v, 0)} GM`
    },
    /** 日期字符串 */
    date: (v) => {
      if (!v) return "—"
      return new Date(v).toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" })
    },
    /** Phase 徽章样式 */
    phaseClass: (phase) => ({
      Phase1: "phase-badge--enlightenment",
      Phase2: "phase-badge--reality",
      Phase3: "phase-badge--governance",
    }[phase] || ""),
    /** 供应商状态翻译 */
    supplierStatus: (s) => ({ invited: "已邀请", submitted: "已提交", confirmed: "已确认" }[s] || s),
    /** UserTier 翻译 */
    tier: (t) => ({ Seed: "种子公民", Sprout: "新芽公民", Guardian: "守护者", Pioneer: "先锋", Sovereign: "主权者" }[t] || t),
  }


  // ─── 字段映射表（CSS class → state path → formatter）─────────────────────
  //
  // 规则：
  //   key   = HTML 元素的 class 名（.dyn-{key}）
  //   path  = AppState 中的点路径
  //   fn    = 格式化函数（可选，默认 toString）
  //   attr  = 写入属性（默认 textContent，也可指定 src / href / class / style.xxx）
  //
  // 覆盖全域中心 14 个菜单下所有动态数字。

  const FIELD_MAP = [
    // ── user 对象
    { cls: "dyn-user-name",          path: "user.name" },
    { cls: "dyn-user-email",         path: "user.email" },
    { cls: "dyn-user-avatar",        path: "user.avatarUrl",       attr: "src" },
    { cls: "dyn-user-tier",          path: "user.tier",            fn: fmt.tier },
    { cls: "dyn-user-level",         path: "user.currentLevel" },
    { cls: "dyn-user-reg-date",      path: "user.regDate",         fn: fmt.date },
    { cls: "dyn-user-last-login",    path: "user.lastLoginAt",     fn: fmt.date },
    { cls: "dyn-user-compliance",    path: "user.complianceScore" },
    { cls: "dyn-gm-balance",         path: "user.gmBalance",       fn: fmt.gm },
    { cls: "dyn-gm-balance-num",     path: "user.gmBalance",       fn: (v) => fmt.num(v, 0) },
    { cls: "dyn-tokens-left",        path: "user.tokensLeft",      fn: fmt.num },
    { cls: "dyn-tokens-used",        path: "user.tokensUsed",      fn: fmt.num },
    { cls: "dyn-co2e-saved",         path: "user.totalCo2eSaved",  fn: fmt.tco2e },
    { cls: "dyn-badge-count",        path: "user.badgeCount" },

    // ── company 对象
    { cls: "dyn-company-name",       path: "company.name" },
    { cls: "dyn-company-credit",     path: "company.creditCode" },
    { cls: "dyn-company-industry",   path: "company.industryLabel" },
    { cls: "dyn-company-stage",      path: "company.stage" },
    { cls: "dyn-company-employees",  path: "company.employeeCount", fn: fmt.num },
    { cls: "dyn-company-revenue",    path: "company.annualRevenue", fn: (v) => v ? `¥${fmt.num(v/10000, 0)}万` : "—" },
    { cls: "dyn-company-compliance", path: "company.complianceLevel" },

    // ── metrics 对象（核心数字面板）
    { cls: "dyn-tco2e-total",        path: "metrics.tCO2eTotal",         fn: fmt.tco2e },
    { cls: "dyn-tco2e-num",          path: "metrics.tCO2eTotal",         fn: (v) => fmt.num(v, 2) },
    { cls: "dyn-global-rank",        path: "metrics.globalRank",         fn: (v) => v ? `#${fmt.num(v, 0)}` : "—" },
    { cls: "dyn-roi-ratio",          path: "metrics.roiRatio",           fn: (v) => v != null ? fmt.pct(v) : "—" },
    { cls: "dyn-supply-coverage",    path: "metrics.supplyChainCoverage",fn: fmt.pct },
    { cls: "dyn-scope3-coverage",    path: "metrics.scope3Coverage",     fn: fmt.pct },
    { cls: "dyn-risk-eur",           path: "metrics.riskExposureEur",    fn: fmt.eur },
    { cls: "dyn-risk-eur-raw",       path: "metrics.riskExposureEur",    fn: (v) => fmt.num(v, 0) },
    { cls: "dyn-cbam-tax",           path: "metrics.cbamTaxEstimate",    fn: fmt.eur },
    { cls: "dyn-reduction-target",   path: "metrics.reductionTarget",    fn: fmt.tco2e },
    { cls: "dyn-reduction-achieved", path: "metrics.reductionAchieved",  fn: fmt.tco2e },
    { cls: "dyn-reduction-pct",      path: "metrics.reductionProgress",  fn: fmt.pct },
    { cls: "dyn-energy-tco2e",       path: "metrics.energyTco2eSum",     fn: fmt.tco2e },
    { cls: "dyn-supplier-count",     path: "metrics.supplierCount",      fn: fmt.num },
    { cls: "dyn-supplier-submitted", path: "metrics.supplierSubmitted",  fn: fmt.num },
    { cls: "dyn-supplier-gap",       path: null, // 动态计算：declared - submitted
      compute: (s) => {
        const declared = s.company?.declaredSupplierCount || 0
        const submitted = s.metrics?.supplierSubmitted || 0
        return Math.max(0, declared - submitted)
      },
      fn: fmt.num,
    },

    // ── 进度条（写 style.width）
    { cls: "dyn-scope3-bar",         path: "metrics.scope3Coverage",     attr: "style.width", fn: (v) => `${Math.min(100, (v||0)*100).toFixed(1)}%` },
    { cls: "dyn-reduction-bar",      path: "metrics.reductionProgress",  attr: "style.width", fn: (v) => `${Math.min(100, (v||0)*100).toFixed(1)}%` },
    { cls: "dyn-supply-bar",         path: "metrics.supplyChainCoverage",attr: "style.width", fn: (v) => `${Math.min(100, (v||0)*100).toFixed(1)}%` },
    { cls: "dyn-tier-bar",           path: "user.tierLevel",             attr: "style.width", fn: (v) => `${((v-1)/4*100).toFixed(0)}%` },

    // ── flags / 阶段
    { cls: "dyn-phase-label",        path: "flags.phaseLabel" },
    { cls: "dyn-phase-code",         path: "flags.currentPhase" },
    { cls: "dyn-next-action",        path: "flags.nextAction" },

    // ── 报告相关（用于 CBAM 报告面板的最新一条）
    { cls: "dyn-rep-period",         path: "recentReports.0.reportingPeriod" },
    { cls: "dyn-rep-status",         path: "recentReports.0.status" },
    { cls: "dyn-rep-tco2e",          path: "recentReports.0.tCO2eTotal",     fn: fmt.tco2e },
    { cls: "dyn-rep-tax",            path: "recentReports.0.riskExposureEur",fn: fmt.eur },
    { cls: "dyn-rep-submitted",      path: "recentReports.0.submittedAt",    fn: fmt.date },

    // ── 服务器时间戳
    { cls: "dyn-server-time",        path: "serverTime",                 fn: (v) => v ? new Date(v).toLocaleTimeString("zh-CN") : "" },
  ]


  // ─── 路径解析器（支持点路径 + 数组索引）─────────────────────────────────

  function getPath(obj, path) {
    if (!path) return undefined
    return path.split(".").reduce((cur, key) => {
      if (cur == null) return null
      // 数字 key → 数组索引
      const idx = parseInt(key, 10)
      return isNaN(idx) ? cur[key] : cur[idx]
    }, obj)
  }


  // ─── 单元素更新（含律动感数字跳变动画）────────────────────────────────────

  function updateElement(el, newVal, attr) {
    if (!el) return

    const displayVal = newVal == null ? "—" : String(newVal)
    const oldVal = attr ? _readAttr(el, attr) : el.textContent

    if (oldVal === displayVal) return   // 无变化，跳过

    // 触发律动动画（仅对数字节点）
    if (!attr || attr === "textContent") {
      _triggerJump(el, displayVal)
    } else if (attr.startsWith("style.")) {
      const prop = attr.slice(6)
      el.style[prop] = displayVal
    } else if (attr === "src") {
      el.src = displayVal
    } else if (attr === "href") {
      el.href = displayVal
    } else {
      el.setAttribute(attr, displayVal)
    }
  }

  function _readAttr(el, attr) {
    if (attr.startsWith("style.")) return el.style[attr.slice(6)] || ""
    if (attr === "src") return el.src
    if (attr === "href") return el.href
    return el.getAttribute(attr) || ""
  }

  /**
   * 数字跳变"律动感"动画
   * 如果是纯数字变化，做 countUp 渐变；否则直接 hash-jump 闪烁。
   */
  function _triggerJump(el, newVal) {
    const oldNum = parseFloat(el.textContent.replace(/[^\d.-]/g, ""))
    const newNum = parseFloat(String(newVal).replace(/[^\d.-]/g, ""))
    const isNumericChange = !isNaN(oldNum) && !isNaN(newNum) && oldNum !== newNum

    if (isNumericChange) {
      _countUp(el, oldNum, newNum, newVal, 600)
    } else {
      el.classList.add("hash-jump")
      el.textContent = newVal
      requestAnimationFrame(() => {
        el.classList.remove("hash-jump")
      })
    }
  }

  /**
   * countUp 动画：从 from → to 在 duration ms 内滚动数字
   * 保留原始格式化字符串的前缀/后缀（如 "€" "tCO₂e"）
   */
  function _countUp(el, from, to, formattedTo, duration) {
    const prefix = String(formattedTo).match(/^[^\d-]*/)?.[0] || ""
    const suffix = String(formattedTo).match(/[^\d.,]+$/)?.[0] || ""
    const decimals = (String(formattedTo).split(".")?.[1]?.replace(/[^\d]/g, "") || "").length

    const start = performance.now()
    el.classList.add("counting")

    function frame(now) {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = from + (to - from) * eased
      el.textContent = prefix + current.toLocaleString("zh-CN", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }) + (progress < 1 ? "" : suffix)

      if (progress < 1) {
        requestAnimationFrame(frame)
      } else {
        el.textContent = formattedTo
        el.classList.remove("counting")
      }
    }
    requestAnimationFrame(frame)
  }


  // ─── 核心函数：全量同步 ───────────────────────────────────────────────────

  /**
   * syncAllInternalData(state)
   *
   * 遍历 FIELD_MAP，将 AppState 中所有字段一次性灌注到
   * 全域中心 14 个菜单下的所有 .dyn-* 节点。
   *
   * @param {object} state - window.AppState 或后端返回的完整 AppState 对象
   */
  function syncAllInternalData(state) {
    if (!state) return

    FIELD_MAP.forEach(({ cls, path, compute, fn, attr }) => {
      const els = document.querySelectorAll(`.${cls}`)
      if (!els.length) return

      // 取值：优先 compute，其次 path
      let raw = compute ? compute(state) : getPath(state, path)

      // 格式化
      let display
      if (raw == null || raw === "") {
        display = "—"
      } else if (fn) {
        try { display = fn(raw) } catch { display = String(raw) }
      } else {
        display = String(raw)
      }

      els.forEach(el => updateElement(el, display, attr))
    })

    // 阶段样式切换（Phase 徽章 class）
    const phase = getPath(state, "flags.currentPhase")
    document.querySelectorAll(".dyn-phase-badge").forEach(el => {
      el.className = el.className.replace(/phase-badge--\S+/g, "").trim()
      el.classList.add("phase-badge", fmt.phaseClass(phase))
    })

    // 菜单权限锁（未解锁菜单加 locked class）
    const unlocked = new Set(getPath(state, "flags.unlockedMenusList") || [])
    document.querySelectorAll("[data-menu-slug]").forEach(el => {
      const slug = el.dataset.menuSlug
      if (unlocked.has(slug)) {
        el.classList.remove("menu--locked")
        el.removeAttribute("aria-disabled")
      } else {
        el.classList.add("menu--locked")
        el.setAttribute("aria-disabled", "true")
      }
    })

    // 供应商列表渲染（如果页面上有 .dyn-supplier-list 容器）
    const supplierListEl = document.querySelector(".dyn-supplier-list")
    if (supplierListEl && state.supplierNodes) {
      _renderSupplierList(supplierListEl, state.supplierNodes)
    }

    // 勋章列表渲染
    const badgeListEl = document.querySelector(".dyn-badge-list")
    if (badgeListEl && state.badges) {
      _renderBadgeList(badgeListEl, state.badges)
    }

    // 报告列表渲染
    const reportListEl = document.querySelector(".dyn-report-list")
    if (reportListEl && state.recentReports) {
      _renderReportList(reportListEl, state.recentReports)
    }
  }


  // ─── 局部补丁（对话触发后只更新变化字段，保留律动感）──────────────────────

  /**
   * patchState(delta)
   *
   * 将 delta 深合并到 window.AppState，然后调用 syncAllInternalData。
   * 只有真正变化的 DOM 节点会触发 countUp/hash-jump 动画。
   *
   * @param {object} delta - 后端 actions_taken 返回的增量数据
   */
  function patchState(delta) {
    const d = delta || {}
    if (window.AppState && typeof window.AppState.patchState === "function") {
      window.AppState.patchState(d, { source: "HengAI" })
      return
    }
    if (window.AppState && typeof window.deepMerge === "function") {
      Object.assign(window.AppState, window.deepMerge(window.AppState, d))
    } else {
      Object.assign(window.AppState || {}, _deepMerge(window.AppState || {}, d))
    }
    syncAllInternalData(window.AppState)
    if (typeof global.syncAppState === "function") {
      try {
        global.syncAppState(window.AppState, {})
      } catch (_) {}
    }
  }


  // ─── 列表渲染器 ───────────────────────────────────────────────────────────

  function _renderSupplierList(container, nodes) {
    if (!nodes.length) {
      container.innerHTML = `<p class="empty-state">暂无供应商节点，发起邀请后数据将实时同步</p>`
      return
    }
    container.innerHTML = nodes.map(s => `
      <div class="supplier-node supplier-node--${s.status}" data-id="${s.id}">
        <span class="supplier-node__name">${_esc(s.supplierName)}</span>
        <span class="supplier-node__code">${s.supplierCreditCode || "—"}</span>
        <span class="supplier-node__status">${fmt.supplierStatus(s.status)}</span>
        <span class="supplier-node__tco2e">${s.tco2eReported != null ? fmt.tco2e(s.tco2eReported) : "待提交"}</span>
        <span class="supplier-node__date">${fmt.date(s.submittedAt)}</span>
      </div>
    `).join("")
  }

  function _renderBadgeList(container, badges) {
    if (!badges.length) {
      container.innerHTML = `<p class="empty-state">完成首次碳数据录入，解锁第一枚勋章</p>`
      return
    }
    container.innerHTML = badges.map(b => `
      <div class="badge-item" data-code="${b.badgeCode}" title="${_esc(b.badgeName)}">
        <div class="badge-item__icon badge-item__icon--${b.badgeCode}"></div>
        <div class="badge-item__name">${_esc(b.badgeName)}</div>
        <div class="badge-item__date">${fmt.date(b.awardedAt)}</div>
      </div>
    `).join("")
  }

  function _renderReportList(container, reports) {
    if (!reports.length) {
      container.innerHTML = `<p class="empty-state">暂无 CBAM 报告，录入碳数据后自动生成草稿</p>`
      return
    }
    container.innerHTML = reports.map(r => `
      <div class="report-row report-row--${r.status}" data-id="${r.id}">
        <span class="report-row__period">${r.reportingPeriod}</span>
        <span class="report-row__status">${r.status}</span>
        <span class="report-row__tco2e">${fmt.tco2e(r.tCO2eTotal)}</span>
        <span class="report-row__risk">${fmt.eur(r.riskExposureEur)}</span>
        <span class="report-row__date">${fmt.date(r.submittedAt)}</span>
      </div>
    `).join("")
  }


  // ─── SSE 对话动作监听器 ───────────────────────────────────────────────────

  /**
   * 监听 chat.py 推送的 actions_taken 事件，触发全场数字律动。
   * 在 chatClient.js 的 onStateSync 回调中调用，或直接监听全局事件。
   */
  function listenToStateUpdates() {
    if (listenToStateUpdates._hengaiAttached) return
    listenToStateUpdates._hengaiAttached = true
    window.addEventListener("hengai:state-updated", (e) => {
      const d = e.detail
      if (!d) return
      syncAllInternalData(d)
      if (typeof global.syncAppState === "function") {
        try {
          global.syncAppState(d, {})
        } catch (_) {}
      }
    })

    window.addEventListener("hengai:gm-awarded", (e) => {
      // GM 增加时：触发钱包数字 glow 特效
      document.querySelectorAll(".dyn-gm-balance, .dyn-gm-balance-num").forEach(el => {
        el.classList.add("gm-glow")
        setTimeout(() => el.classList.remove("gm-glow"), 1500)
      })
    })

    window.addEventListener("hengai:phase-changed", (e) => {
      // Phase 升级时：触发全屏庆祝动画
      _triggerPhaseUpgradeAnimation(e.detail.newPhase)
    })
  }


  // ─── Phase 升级庆祝动画 ───────────────────────────────────────────────────

  function _triggerPhaseUpgradeAnimation(newPhase) {
    const overlay = document.createElement("div")
    overlay.className = "phase-upgrade-overlay"
    overlay.innerHTML = `
      <div class="phase-upgrade-card">
        <div class="phase-upgrade-card__icon">🌍</div>
        <div class="phase-upgrade-card__title">阶段跃迁</div>
        <div class="phase-upgrade-card__phase">${newPhase}</div>
        <div class="phase-upgrade-card__desc">${PHASE_LABELS[newPhase] || ""}</div>
      </div>
    `
    document.body.appendChild(overlay)
    setTimeout(() => overlay.classList.add("phase-upgrade-overlay--visible"), 50)
    setTimeout(() => {
      overlay.classList.remove("phase-upgrade-overlay--visible")
      setTimeout(() => overlay.remove(), 500)
    }, 3000)
  }

  const PHASE_LABELS = {
    Phase1: "个体启蒙 · The Enlightenment",
    Phase2: "业务映射 · The Reality Projection",
    Phase3: "全域共治 · The Governance",
  }


  // ─── 页面初始化 ───────────────────────────────────────────────────────────

  /**
   * initHengAI()
   *
   * 1. 从 ${API_BASE}/api/v1/hub/overview 拉取完整 AppState
   * 2. 挂载到 window.AppState
   * 3. 调用 syncAllInternalData 完成首屏灌注
   * 4. 启动 SSE 监听器
   *
   * 必须显式拼接 API_BASE，确保前端无论从 file:// / nginx / docker
   * 哪条链路加载，都能直击 8000 端口的 FastAPI 后端。
   */
  async function initHengAI() {
    let initState = null
    let initError = null

    try {
      const token =
        (typeof global.getToken === "function" && global.getToken()) ||
        (typeof localStorage !== "undefined" && localStorage.getItem("hengai_token")) ||
        ""
      const headers = { Accept: "application/json" }
      if (token) headers.Authorization = "Bearer " + token

      const res = await fetch(`${API_BASE}/api/v1/hub/overview`, {
        credentials: "include",
        headers,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)

      initState = await res.json()
      const live = initState
      if (window.AppState && typeof window.deepMerge === "function") {
        Object.assign(window.AppState, window.deepMerge(window.AppState, live))
      } else if (window.AppState) {
        Object.assign(window.AppState, live)
      } else {
        window.AppState = live
      }
      initState = window.AppState
      if (typeof window.bindAppStateInstanceMethods === "function") window.bindAppStateInstanceMethods()
      syncAllInternalData(window.AppState)
      listenToStateUpdates()
      try {
        if (typeof window.broadcastStatePatch === "function") {
          window.broadcastStatePatch({
            user: window.AppState.user,
            company: window.AppState.company,
            metrics: window.AppState.metrics,
            flags: window.AppState.flags,
            wallet: window.AppState.wallet,
            macro: window.AppState.macro,
          })
        }
      } catch (_) {}

      console.info(
        `[HengAI] ✅ AppState 初始化完成 | API_BASE=${API_BASE} | Phase=${initState.flags && initState.flags.currentPhase} | GM=${initState.user && initState.user.gmBalance}`
      )
    } catch (err) {
      initError = err
      console.error("[HengAI] AppState 初始化失败:", err)
      _renderPhase1Shell()
    } finally {
      try {
        if (typeof global.syncAppState === "function" && window.AppState) {
          global.syncAppState(window.AppState, { fromRemote: Boolean(!initError && initState) })
        }
      } catch (_) {}
      // 无论成功失败都广播一次「init 已完成」信号，让全域中心等监听者关掉
      // loading overlay。成功时 detail = state；失败时 detail = null。
      try {
        window.dispatchEvent(new CustomEvent("hengai:state-updated", {
          detail: initState || window.AppState,
        }))
        window.dispatchEvent(new CustomEvent("hengai:init-complete", {
          detail: { ok: !initError, state: initState, error: initError },
        }))
      } catch (broadcastErr) {
        console.warn("[HengAI] init-complete 事件广播失败:", broadcastErr)
      }
    }

    return initState
  }

  function _renderPhase1Shell() {
    document.querySelectorAll("[class*='dyn-']").forEach(el => {
      if (!el.textContent.trim()) el.textContent = "—"
    })
    document.querySelectorAll(".dyn-phase-label").forEach(el => {
      el.textContent = "个体启蒙 · The Enlightenment"
    })
  }


  // ─── 工具函数 ─────────────────────────────────────────────────────────────

  function _deepMerge(target, source) {
    const result = { ...target }
    for (const key of Object.keys(source)) {
      if (
        source[key] !== null &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key]) &&
        typeof target[key] === "object"
      ) {
        result[key] = _deepMerge(target[key] || {}, source[key])
      } else {
        result[key] = source[key]
      }
    }
    return result
  }

  function _esc(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
  }


  // ─── CSS 样式注入（律动感动画关键帧）──────────────────────────────────────
  //
  // 生产环境请将此段移至独立 CSS 文件。
  // 此处内联是为了保证"通电即可用"，无需额外配置。

  const ANIMATION_CSS = `
    @keyframes hashJump {
      0%   { opacity: 0.3; transform: translateY(-4px) scale(0.96); filter: blur(1px); }
      60%  { opacity: 1;   transform: translateY(1px)  scale(1.02); filter: none; }
      100% { opacity: 1;   transform: translateY(0)    scale(1);    filter: none; }
    }
    @keyframes gmGlow {
      0%   { text-shadow: 0 0 0 transparent; }
      40%  { text-shadow: 0 0 16px #00e5a0, 0 0 32px #00e5a044; color: #00e5a0; }
      100% { text-shadow: 0 0 0 transparent; }
    }
    @keyframes phaseOverlayIn {
      from { opacity: 0; transform: scale(0.88); }
      to   { opacity: 1; transform: scale(1); }
    }

    .hash-jump       { animation: hashJump 0.38s cubic-bezier(0.22,1,0.36,1) forwards; }
    .counting        { font-variant-numeric: tabular-nums; }
    .gm-glow         { animation: gmGlow 1.5s ease-out forwards; }

    .phase-upgrade-overlay {
      position: fixed; inset: 0; z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      background: rgba(6,8,15,0.82); backdrop-filter: blur(12px);
      opacity: 0; transition: opacity 0.4s;
      pointer-events: none;
    }
    .phase-upgrade-overlay--visible { opacity: 1; pointer-events: auto; }
    .phase-upgrade-card {
      text-align: center; padding: 48px 64px;
      background: rgba(255,255,255,0.04);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 24px;
      animation: phaseOverlayIn 0.5s cubic-bezier(0.22,1,0.36,1) forwards;
    }
    .phase-upgrade-card__icon  { font-size: 56px; margin-bottom: 16px; }
    .phase-upgrade-card__title { font-size: 14px; opacity: 0.5; letter-spacing: 0.2em; text-transform: uppercase; }
    .phase-upgrade-card__phase { font-size: 36px; font-weight: 700; margin: 8px 0; color: #00e5a0; }
    .phase-upgrade-card__desc  { font-size: 15px; opacity: 0.7; }

    .menu--locked { opacity: 0.35; pointer-events: none; cursor: not-allowed; }
    .menu--locked::after { content: "🔒"; margin-left: 6px; font-size: 0.8em; }
  `

  ;(function injectCSS() {
    if (document.getElementById("hengai-core-styles")) return
    const style = document.createElement("style")
    style.id = "hengai-core-styles"
    style.textContent = ANIMATION_CSS
    document.head.appendChild(style)
  })()


  // ─── 导出到全局 ───────────────────────────────────────────────────────────

  global.HengAI = {
    ...(global.HengAI || {}),
    syncAllInternalData,
    patchState,
    initHengAI,
    listenToStateUpdates,
    fmt,
    getPath,
  }

  // DOM 就绪后自动初始化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initHengAI)
  } else {
    initHengAI()
  }

})(window)
