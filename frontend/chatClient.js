// chatClient.js — HengAI V3.1 前端对话客户端
// 职责：SSE 流接收 + AppState 双向广播 + 对话框与数字面板实时联动
// 严禁手动修改 AppState 数字！所有数据必须来自后端返回值

/**
 * HengAI Chat Client
 *
 * 使用方式：
 *   import { HengAIChatClient } from './chatClient.js'
 *   const client = new HengAIChatClient()
 *   await client.sendMessage("我们公司年用电量 800 万度")
 */

// 防呆：唯一从 window 取
const HENGAI_API_BASE = String(
  (typeof window !== "undefined" && window.API_BASE != null && window.API_BASE !== undefined
    ? window.API_BASE
    : typeof window !== "undefined" && window.HENGAI_API_BASE != null && window.HENGAI_API_BASE !== undefined
      ? window.HENGAI_API_BASE
      : typeof window !== "undefined" && window.APP_CONFIG && (window.APP_CONFIG.API_BASE || window.APP_CONFIG.api_base) != null
        ? (window.APP_CONFIG.API_BASE || window.APP_CONFIG.api_base)
        : "")
)
  .replace(/\/+$/, "")
  .replace(/\/api\/v1$/i, "")
if (typeof window !== "undefined") {
  window.API_BASE = window.API_BASE || HENGAI_API_BASE
  window.HENGAI_API_BASE = window.HENGAI_API_BASE || HENGAI_API_BASE
}

/** 每次发消息时解析 URL，避免 module 加载顺序导致地址冻结为错误 host */
function resolveChatPostUrl() {
  if (typeof window !== 'undefined' && window.API_CHAT_URL) {
    return String(window.API_CHAT_URL);
  }
  var base = '';
  if (typeof window !== 'undefined') {
    if (typeof window.hengaiApiOrigin === 'function') {
      base = String(window.hengaiApiOrigin() || '');
    } else if (window.API_BASE != null) {
      base = String(window.API_BASE).replace(/\/+$/, '').replace(/\/api\/v1$/i, '');
    }
  }
  if (!base) base = HENGAI_API_BASE;
  return `${base.replace(/\/+$/, '')}/api/v1/chat`;
}

/** 聊天大脑：V3.1 正式路由 POST /api/v1/chat（SSE event:token） */
let HENGAI_CHAT_POST_URL = resolveChatPostUrl();


/** 从 SSE JSON 载荷提取文本（禁止混用 ?? 与 ||，避免 SyntaxError） */
function pickSseTextChunk(payload) {
  if (!payload || typeof payload !== "object") return ""
  if (payload.text != null && payload.text !== "") return String(payload.text)
  if (payload.content != null && payload.content !== "") return String(payload.content)
  if (payload.reply != null && payload.reply !== "") return String(payload.reply)
  const choices = payload.choices
  if (Array.isArray(choices) && choices[0] && choices[0].delta) {
    const deltaContent = choices[0].delta.content
    if (deltaContent != null && deltaContent !== "") return String(deltaContent)
  }
  return ""
}

function slimAppStateForChat(appState) {
  if (!appState || typeof appState !== "object") return {}
  const u = appState.user || {}
  return {
    user: {
      name: u.name,
      email: u.email,
      tier: u.tier,
      tier_code: u.tier_code,
      gmBalance: u.gmBalance,
      tokensLeft: u.tokensLeft,
      id: u.id,
    },
    company: appState.company || {},
    flags: appState.flags || {},
    metrics: appState.metrics || {},
    wallet: appState.wallet || {},
    supplierNodes: Array.isArray(appState.supplierNodes) ? appState.supplierNodes.slice(0, 50) : [],
    recentReports: Array.isArray(appState.recentReports) ? appState.recentReports.slice(0, 10) : [],
    contextTags: appState.contextTags || [],
    cbam: (function () {
      const cb = appState.cbam || {}
      const ev = cb.evidence || {}
      return {
        carbonIntensity: cb.carbonIntensity,
        evidence: {
          mode: ev.mode,
          stage: ev.stage,
          value: ev.value,
          unit: ev.unit,
          dictVersion: ev.dictVersion,
          calcVersion: ev.calcVersion,
          verified: ev.verified,
          shadow: ev.shadow,
        },
      }
    })(),
    _commitDomain: appState._commitDomain,
    _commitAt: appState._commitAt,
  }
}

export class HengAIChatClient {
  constructor(options = {}) {
    this.chatPostUrl =
      options.chatPostUrl ||
      options.chatUrl ||
      resolveChatPostUrl()
    this.onToken      = options.onToken      || (() => {})   // 收到文本片段
    this.onDone       = options.onDone       || (() => {})   // 流结束
    this.onStateSync  = options.onStateSync  || (() => {})   // AppState 更新
    this.onGmChange   = options.onGmChange   || (() => {})   // GM 余额变动
    this.onPhaseChange= options.onPhaseChange|| (() => {})   // Phase 升级
    this.onToolResult = options.onToolResult || (() => {})   // 工具调用结果
    this.onActionsTaken = options.onActionsTaken || (() => {}) // 原始 actions_taken payload

    this._history     = []   // 对话历史，每轮追加
    this._controller  = null // AbortController，用于中断流
    this._lastKnownPhase = HengAIChatClient._phaseFromState(options.initialAppState || window.AppState)
  }

  static _phaseRank(phase) {
    const p = String(phase || "Phase1")
    if (p.startsWith("Phase3")) return 3
    if (p.startsWith("Phase2")) return 2
    return 1
  }

  static _phaseFromState(appState) {
    const flags = appState && appState.flags
    const cp = (flags && (flags.currentPhase || flags.current_phase)) ||
      (appState && appState.currentPhase) ||
      "Phase1"
    return String(cp)
  }

  /**
   * 发送消息并监听 SSE 流
   * @param {string} userText - 用户输入
   * @param {object} appState - window.AppState 当前快照（必传）
   */
  async sendMessage(userText, appState = window.AppState || {}) {
    // 追加用户消息到历史
    this._history.push({ role: "user", content: userText })
    this._lastKnownPhase = HengAIChatClient._phaseFromState(appState)

    // 中止上一个未完成的流
    if (this._controller) {
      this._controller.abort()
    }
    this._controller = new AbortController()

    // 🚨 任务 2 · 紧凑摘要（Context Injection）—— 让 AI 不可能与 AppState 现状冲突
    const summary = buildAppStateSummary(appState)

    const requestBody = {
      messages         : this._history,
      appState         : slimAppStateForChat(appState),
      appStateSummary  : summary,
      stream           : true,
    }

    const chatUrl = resolveChatPostUrl()
    this.chatPostUrl = chatUrl

    let assistantReply = ""

    try {
      const token =
        (typeof window !== "undefined" &&
          typeof window.getToken === "function" &&
          window.getToken()) ||
        (typeof localStorage !== "undefined" && localStorage.getItem("hengai_token")) ||
        (typeof localStorage !== "undefined" && localStorage.getItem("authToken")) ||
        ""
      const response = await fetch(chatUrl, {
        method  : "POST",
        credentials: "include",
        headers : {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(token ? { Authorization: "Bearer " + token } : {}),
        },
        body    : JSON.stringify(requestBody),
        signal  : this._controller.signal,
      })

      if (!response.ok) {
        const errText = await response.text()
        throw new Error(`Chat API error ${response.status}: ${errText}`)
      }

      const reader  = response.body.getReader()
      const decoder = new TextDecoder()
      let   buffer  = ""
      let   streamError = null

      // SSE 流解析
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop()   // 最后一个可能不完整，留到下次

        for (const line of lines) {
          this._parseSseLine(line, {
            onToken: (text) => {
              assistantReply += text
              this.onToken(text)
            },
            onActionsTaken: (payload) => this._handleActionsTaken(payload),
            onToolResult  : (payload) => this.onToolResult(payload),
            onDone        : ()        => this.onDone(assistantReply),
            onError       : (payload) => {
              const msg =
                (payload && (payload.message || payload.detail || payload.error)) ||
                "流式响应异常"
              streamError = new Error(String(msg))
            },
          })
          if (streamError) break
        }
        if (streamError) break
      }

      if (streamError) throw streamError

    } catch (err) {
      if (err.name === "AbortError") return ""
      console.error("[HengAI Chat] 流式请求失败:", err)
      throw err
    }

    // 追加 AI 回复到历史（保持多轮上下文）
    if (assistantReply) {
      this._history.push({ role: "assistant", content: assistantReply })
    }

    return assistantReply
  }

  /**
   * 解析单行 SSE 数据
   */
  _currentEvent = null

  _parseSseLine(line, handlers) {
    if (line.startsWith("event: ")) {
      this._currentEvent = line.slice(7).trim()
      return
    }
    if (!line.startsWith("data: ")) return

    const rawData = line.slice(6).trim()
    if (!rawData || rawData === "[DONE]") {
      if (rawData === "[DONE]") handlers.onDone?.()
      return
    }
    let payload = {}
    try {
      payload = JSON.parse(rawData)
    } catch {
      handlers.onToken?.(rawData)
      return
    }

    const event = this._currentEvent
    this._currentEvent = null

    /* 兼容无 event 行：content / error 载荷 */
    if (!event) {
      if (payload.error) {
        handlers.onError?.({ message: String(payload.error) })
        return
      }
      const chunk = pickSseTextChunk(payload)
      if (chunk) {
        handlers.onToken?.(chunk)
        return
      }
    }

    switch (event) {
      case "token":
        handlers.onToken?.(payload.text || payload.content || "")
        break

      case "actions_taken":
        handlers.onActionsTaken?.(payload)
        break

      case "tool_result":
        handlers.onToolResult?.(payload)
        break

      case "done":
        handlers.onDone?.()
        break

      case "error":
        handlers.onError?.(payload)
        break
    }
  }

  /**
   * 处理 actions_taken 元数据帧
   * 触发 AppState 广播 + GM 数字跳动 + Phase 升级动画
   */
  _handleActionsTaken(payload) {
    const { actionsTaken, gmDelta, phaseChanged, updatedState } = payload
    this.onActionsTaken(payload)

    // ── 1. 全量同步 AppState + 批次6全场共振（iframe / 财务 / hub）
    if (updatedState && window.AppState) {
      if (typeof window.hengaiApplyChatStateUpdate === "function") {
        window.hengaiApplyChatStateUpdate(updatedState, { source: "chat-sse" })
      } else if (typeof window.patchAppState === "function") {
        window.patchAppState(updatedState, { source: "chat-sse" })
      } else if (typeof window.HengAI?.patchState === "function") {
        window.HengAI.patchState(updatedState)
      } else if (typeof window.deepMerge === "function") {
        Object.assign(window.AppState, window.deepMerge(window.AppState, updatedState))
        window.syncAppState?.(window.AppState, { fromRemote: true })
      }
      this.onStateSync(window.AppState)

      window.dispatchEvent(new CustomEvent("hengai:state-updated", {
        detail: window.AppState,
      }))
    }

    if (typeof window.EventBus?.emit === "function") {
      try {
        window.EventBus.emit("CHAT_ACTIONS_TAKEN", Object.assign({}, payload, { _skipApply: true }))
      } catch (e) {
        console.warn("[HengAI Chat] EventBus CHAT_ACTIONS_TAKEN", e)
      }
    }

    window.dispatchEvent(new CustomEvent("hengai:actions-taken", {
      detail: Object.assign({}, payload, { _skipApply: true }),
    }))

    // ── 2. GM 余额变动通知 ─────────────────────────────────────────────
    if (parseFloat(gmDelta) > 0) {
      this.onGmChange({
        delta     : parseFloat(gmDelta),
        newBalance: window.AppState?.user?.gmBalance,
      })
      window.dispatchEvent(new CustomEvent("hengai:gm-awarded", {
        detail: { delta: parseFloat(gmDelta) },
      }))
    }

    // ── 3. Phase 升级通知（仅真实跃迁，防后端重复广播当前 Phase） ─────
    if (phaseChanged) {
      const prevRank = HengAIChatClient._phaseRank(this._lastKnownPhase)
      const nextRank = HengAIChatClient._phaseRank(phaseChanged)
      const nextLabel = String(phaseChanged)
      if (nextRank > prevRank) {
        this._lastKnownPhase = nextLabel
        this.onPhaseChange(phaseChanged)
        window.dispatchEvent(new CustomEvent("hengai:phase-changed", {
          detail: { newPhase: phaseChanged },
        }))
      }
    }

    // ── 4. 控制台摘要（开发调试） ────────────────────────────────────
    if (actionsTaken?.length > 0) {
      console.group("[HengAI] 本轮对话触发数据写入")
      actionsTaken.forEach(a => {
        console.log(`✅ ${a.type}`, a.changes, `+${a.gmAwarded} GM`)
      })
      console.groupEnd()
    }
  }

  /** 清空对话历史（开启新会话时调用） */
  clearHistory() {
    this._history = []
  }

  /** 中止当前流 */
  abort() {
    this._controller?.abort()
  }
}


// ---------------------------------------------------------------------------
// 浏览器端自挂载
// 让 <script type="module" src="chatClient.js"> 一行即可全局可用，无需额外 shim
// ---------------------------------------------------------------------------

if (typeof window !== "undefined") {
  window.HengAIChatClient = HengAIChatClient
  HENGAI_CHAT_POST_URL = resolveChatPostUrl()
  const chatUrl = HENGAI_CHAT_POST_URL
  if (!window.__hengaiChatClient) {
    window.__hengaiChatClient = new HengAIChatClient({ chatPostUrl: chatUrl })
  } else {
    window.__hengaiChatClient.chatPostUrl = chatUrl
  }
  window.dispatchEvent(new Event("hengai:chat-client-ready"))
  window.addEventListener("hengai:init-complete", function () {
    HENGAI_CHAT_POST_URL = resolveChatPostUrl()
    if (window.__hengaiChatClient) window.__hengaiChatClient.chatPostUrl = HENGAI_CHAT_POST_URL
  })
}


// ---------------------------------------------------------------------------
// 🚨 任务 2 · AppState 紧凑摘要构造器（Context Injection）
//
// 输出的字符串将由后端 chat.py 注入到 system role 最末尾（紧贴 user query），
// 强制 AI 在每一次回复时都能立刻知道：
//   - 账户等级（GUEST/FREE/PRO/ENT_VERIFIED）
//   - GM 余额、Token 剩余
//   - 当前 Phase（1/2/3）
//   - 企业档案完整度（is_complete / 已填字段计数）
//   - 已邀请/已提交的供应商数量
//   - 已生成的 CBAM 报告数量
//   - 最近一笔 commit domain（避免重复引导）
// ---------------------------------------------------------------------------

function buildAppStateSummary(s) {
  if (!s || typeof s !== "object") return "（AppState 为空）"
  const u = s.user    || {}
  const c = s.company || {}
  const f = s.flags   || {}
  const m = s.metrics || {}
  const nodes = Array.isArray(s.supplierNodes) ? s.supplierNodes : []
  const submitted = nodes.filter(n => (n.status || "").toLowerCase() === "submitted").length
  const reports = Array.isArray(s.recentReports) ? s.recentReports.length : 0
  const ev = (s.cbam && s.cbam.evidence) || {}
  const coCity = c.cityState || c.city_state || "—"
  const evMode = ev.mode || "SIMULATED"
  const personaMap = {
    SIMULATED: "参谋长（推演/假如/建议）",
    PENDING_VERIFICATION: "实证推进官（进度/下一步）",
    SOVEREIGN_VERIFIED: "首席合规官（可执行/已确权）",
  }
  const persona = personaMap[evMode] || personaMap.SIMULATED
  const evVal = ev.value != null && Number.isFinite(Number(ev.value)) ? Number(ev.value).toFixed(4) : "—"

  const lines = [
    "【实时 AppState 摘要 · AI 必读 · 严禁与下列数字冲突】",
    `用户：${u.name || "（未登录）"} · 等级：${u.tier || "GUEST"} · GM 余额：${u.gmBalance || 0} · Token 剩余：${u.tokensLeft != null ? u.tokensLeft : "—"}`,
    `企业：${c.name || "（未建档）"} · 信用代码：${c.creditCode || "未录入"} · 行业：${c.industryCode || "未录入"} · 阶段：${c.stage || "—"} · 档案完整：${c.isComplete ? "是" : "否"}`,
    `产品：${c.mainProduct || "待录入"} · HS：${c.hsCode || "待录入"} · 年产能：${c.annualCapacityTons || "待录入"} · 年出口欧盟：${c.annualExportTons || "待录入"} · 出口国：${c.exportCountries || "待录入"}`,
    `能耗：年用电 ${c.annualPowerKwh || "待录入"} kWh · 电网：${c.powerGrid || "待录入"}`,
    `碳数据：tCO2e=${m.tCO2eTotal != null ? m.tCO2eTotal : "—"} · Scope3 覆盖=${m.scope3Coverage != null ? m.scope3Coverage : "—"} · 风险敞口=€${m.riskExposureEur || "待测算"}`,
    `证据态：${evMode} · 城池态 cityState=${coCity} · 碳强度=${evVal} ${ev.unit || "tCO2e/t"} · AI身份=${persona} · dictVersion=${ev.dictVersion || "—"}`,
    `供应链：已邀请 ${nodes.length} 家 · 已提交 ${submitted} 家 · 待提交 ${nodes.length - submitted} 家`,
    `历史：已完成 CBAM 报告 ${reports} 份 · 当前 Phase：${f.currentPhase || "Phase1"}`
  ]
  if (s._commitDomain) lines.push(`上一次提交：${s._commitDomain}（${s._commitAt || "—"}）`)
  return lines.join("\n")
}


// ---------------------------------------------------------------------------
// 工具函数：深合并对象
// ---------------------------------------------------------------------------

function deepMerge(target, source) {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (
      source[key] !== null
      && typeof source[key] === "object"
      && !Array.isArray(source[key])
      && typeof target[key] === "object"
    ) {
      result[key] = deepMerge(target[key] || {}, source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}


// ---------------------------------------------------------------------------
// AppState 初始化器（页面加载时调用一次）
// ---------------------------------------------------------------------------

/**
 * 从 ${HENGAI_API_BASE}/api/v1/hub/overview 拉取初始状态并挂载到 window.AppState
 * 之后所有数字更新通过 hengai:state-updated 事件驱动，不再轮询。
 */
export async function initAppState() {
  try {
    const token =
      (typeof localStorage !== "undefined" && (localStorage.getItem("hengai_token") || localStorage.getItem("authToken"))) || ""
    const headers = { Accept: "application/json" }
    if (token) headers.Authorization = "Bearer " + token

    const res = await fetch(`${HENGAI_API_BASE}/api/v1/hub/overview`, {
      headers,
    })
    if (!res.ok) throw new Error(`Overview API ${res.status} ${res.statusText}`)

    const data = await res.json()
    if (window.AppState && typeof window.deepMerge === "function") {
      Object.assign(window.AppState, window.deepMerge(window.AppState, data))
    } else if (window.AppState) {
      Object.assign(window.AppState, data)
    } else {
      window.AppState = data
    }
    window.syncAppState?.(window.AppState, { fromRemote: true })

    window.dispatchEvent(new CustomEvent("hengai:state-updated", {
      detail: window.AppState,
    }))

    console.log("[HengAI] AppState 初始化完成", {
      user : data.user && data.user.name,
      phase: data.flags && data.flags.currentPhase,
      gm   : data.user && data.user.gmBalance,
    })

    return data
  } catch (err) {
    console.error("[HengAI] AppState 初始化失败:", err)
    return null
  }
}


// ---------------------------------------------------------------------------
// React Hook 示例（如果使用 React）
// ---------------------------------------------------------------------------

/**
 * useHengAIChat — React Hook
 *
 * const { sendMessage, reply, isLoading, gmDelta } = useHengAIChat()
 */
export function useHengAIChat() {
  // 仅为示例，实际使用时从 react 导入 useState/useRef/useCallback
  throw new Error(
    "请在 React 环境中使用此 Hook。" +
    "将此函数体移入你的组件文件，并从 react 导入 useState/useRef/useCallback。"
  )

  /*
  const [reply,     setReply]     = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [gmDelta,   setGmDelta]   = useState(0)
  const clientRef = useRef(null)

  useEffect(() => {
    clientRef.current = new HengAIChatClient({
      onToken      : (text) => setReply(prev => prev + text),
      onGmChange   : ({ delta }) => setGmDelta(delta),
      onPhaseChange: (phase) => console.log("Phase 升级:", phase),
      onStateSync  : (state) => { /* 触发数字面板重渲染 * / },
    })
    initAppState()
  }, [])

  const sendMessage = useCallback(async (text) => {
    setReply("")
    setIsLoading(true)
    try {
      await clientRef.current.sendMessage(text, window.AppState)
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { sendMessage, reply, isLoading, gmDelta }
  */
}
