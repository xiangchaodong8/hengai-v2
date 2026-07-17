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

// ─── 唯一 API 地址源（与 frontend_core.js 严格一致）────────────────────────
const HENGAI_API_BASE = (
  (typeof window !== "undefined" && window.APP_CONFIG && window.APP_CONFIG.API_BASE) ||
  (typeof window !== "undefined" && window.HENGAI_API_BASE) ||
  "http://localhost:8000"
).replace(/\/+$/, "")


export class HengAIChatClient {
  constructor(options = {}) {
    // 默认值：直接拼后端 8000 端口的 /api/v1，绝不依赖 nginx/前端代理。
    this.apiBase      = options.apiBase || (HENGAI_API_BASE + "/api/v1")
    this.onToken      = options.onToken      || (() => {})   // 收到文本片段
    this.onDone       = options.onDone       || (() => {})   // 流结束
    this.onStateSync  = options.onStateSync  || (() => {})   // AppState 更新
    this.onGmChange   = options.onGmChange   || (() => {})   // GM 余额变动
    this.onPhaseChange= options.onPhaseChange|| (() => {})   // Phase 升级
    this.onToolResult = options.onToolResult || (() => {})   // 工具调用结果
    this.onActionsTaken = options.onActionsTaken || (() => {}) // 原始 actions_taken payload

    this._history     = []   // 对话历史，每轮追加
    this._controller  = null // AbortController，用于中断流
  }

  /**
   * 发送消息并监听 SSE 流
   * @param {string} userText - 用户输入
   * @param {object} appState - window.AppState 当前快照（必传）
   */
  async sendMessage(userText, appState = window.AppState || {}) {
    // 追加用户消息到历史
    this._history.push({ role: "user", content: userText })

    // 中止上一个未完成的流
    if (this._controller) {
      this._controller.abort()
    }
    this._controller = new AbortController()

    const requestBody = {
      messages : this._history,
      appState : appState,   // 注意：后端 Schema 用 snake_case，FastAPI 会自动处理
      stream   : true,
    }

    let assistantReply = ""

    try {
      const response = await fetch(`${this.apiBase}/chat`, {
        method  : "POST",
        headers : {
          "Content-Type": "application/json",
          ...(localStorage.getItem("hengai_token")
            ? { Authorization: "Bearer " + localStorage.getItem("hengai_token") }
            : {}),
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
            onError       : (err)     => { throw new Error(err.message) },
          })
        }
      }

    } catch (err) {
      if (err.name === "AbortError") return
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
    let   payload = {}
    try {
      payload = JSON.parse(rawData)
    } catch {
      return
    }

    const event = this._currentEvent
    this._currentEvent = null

    switch (event) {
      case "token":
        handlers.onToken?.(payload.text || "")
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

    // ── 1. 全量同步 AppState：禁止替换 window.AppState 引用，走唯一真理 patch 链
    if (updatedState && window.AppState) {
      if (typeof window.patchAppState === "function") {
        window.patchAppState(updatedState)
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
        window.EventBus.emit("CHAT_ACTIONS_TAKEN", payload)
      } catch (e) {
        console.warn("[HengAI Chat] EventBus CHAT_ACTIONS_TAKEN", e)
      }
    }

    window.dispatchEvent(new CustomEvent("hengai:actions-taken", {
      detail: payload,
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

    // ── 3. Phase 升级通知 ─────────────────────────────────────────────
    if (phaseChanged) {
      this.onPhaseChange(phaseChanged)
      window.dispatchEvent(new CustomEvent("hengai:phase-changed", {
        detail: { newPhase: phaseChanged },
      }))
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
  if (!window.__hengaiChatClient) {
    window.__hengaiChatClient = new HengAIChatClient({})
  }
  window.dispatchEvent(new Event("hengai:chat-client-ready"))
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
