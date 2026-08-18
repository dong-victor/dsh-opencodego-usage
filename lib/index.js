/**
 * dsh-opencodego-usage — host half.
 *
 * Lets the user (and any agent) see how much of the linked opencode Go plan
 * is left, from inside the dsh web GUI. The single data source is the
 * official endpoint
 *
 *     GET https://opencode.ai/zen/go/v1/usage
 *     Authorization: Bearer <key>
 *
 * which returns usage percentages over three windows:
 *
 *     { "usage": {
 *         "rolling": { "status": "ok", "percent": 1,  "resetsAt": "<iso>" },
 *         "weekly":  { "status": "ok", "percent": 12, "resetsAt": "<iso>" },
 *         "monthly": { "status": "ok", "percent": 35, "resetsAt": "<iso>" } } }
 *
 * No second credential is introduced: the API key and the API base URL are
 * derived from the official opencode wiring the LLM provider already uses —
 * the `opencode-go` route of the `llm-pi-ai` settings namespace
 * (`baseURL` https://opencode.ai/zen/go/v1, `apiKeyEnv` OPENCODE_GO_API_KEY
 * resolved through the credentials service), falling back to this plugin's own
 * defaults (https://opencode.ai / OPENCODE_GO_API_KEY) so it works even when
 * no LLM route is configured, with config overrides for other zen deployments.
 *
 * NOTE: the key must never be inherited from the `llm-deepseek` settings
 * namespace — its schema default is DEEPSEEK_API_KEY, the DeepSeek LLM key,
 * which the opencode Go plan does not accept.
 *
 * Surfaces mounted here:
 *   - GET /api/dsh-opencode-go/balance   (loopback-fenced, 30s in-memory cache)
 *   - the opencode_go_balance agent tool (dsh-tools)
 *   - a system-prompt announcement section
 *
 * The browser half (./client) renders the sidebar entry and the balance panel.
 * Everything rides the official DSH seams — no dsh source changes.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'

/** Stable cordis plugin name. */
export const name = 'opencode-go'

/** Services required before the surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

/** Settings namespaces consulted for wiring (spelled, not imported: the browser half must not depend on Host packages). */
export const LLM_SETTINGS_NAMESPACE = 'llm-deepseek'
export const PI_AI_SETTINGS_NAMESPACE = 'llm-pi-ai'

/** The pi-ai provider route that carries the official opencode-Go wiring. */
export const OPENCODE_GO_PROVIDER = 'opencode-go'

/** Fallback API root when no base URL is configured anywhere. */
export const DEFAULT_BASE_URL = 'https://opencode.ai'

/** Fallback credential reference (POSIX shell identifier). */
export const DEFAULT_KEY_REF = 'OPENCODE_GO_API_KEY'

/** How long one fetched balance is served from the in-memory cache. */
export const DEFAULT_CACHE_TTL_MS = 30_000

/** Per-request timeout for the upstream usage call. */
export const DEFAULT_TIMEOUT_MS = 15_000

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 150

/** Model-facing announcement: plugin presence, capabilities, and limits. */
export const OPENCODE_GO_GUIDANCE =
  '本机已安装 @dong-victor/dsh-opencodego-usage 插件（查看链接的 opencode Go 套餐余额）：侧边栏「Go 余额」入口。能力：查询 GET https://opencode.ai/zen/go/v1/usage（Authorization: Bearer），显示 rolling / weekly / monthly 三档用量百分比、状态与重置时间；提供 opencode_go_balance 工具供 agent 查询，宿主侧带 30s 缓存；密钥默认取 llm-pi-ai 的 opencode-go 路由 apiKeyEnv（即 OPENCODE_GO_API_KEY）或插件自身默认值，经 credentials 服务解析，不用 DEEPSEEK_API_KEY，无需二次配置。限制：余额查询依赖 opencode 官方端点，网络不可达、密钥失效（401）或无 Go 套餐时返回错误；密钥仅在本机使用、不会外发；缓存期内重复查询不会触发上游请求。用户提到「opencode go 套餐 / Go 余额 / 用量 / balance / 额度」时即指本插件，请据此协作。'

/**
 * Plugin config. All fields optional; defaults applied in apply().
 * @typedef {Object} Config
 * @property {boolean} [enabled] Master switch for the plugin (route, tool, prompt section).
 * @property {boolean} [announceToAgent] When true (default), a system-prompt section announces the plugin to every agent.
 * @property {string} [apiBaseUrl] API root override, e.g. "https://opencode.ai" or a full base URL like "https://opencode.ai/zen/go/v1". Default: derived from the llm-pi-ai opencode-go route baseURL, then llm-deepseek baseURL.
 * @property {string} [apiKeyEnv] Credential reference override (e.g. "OPENCODE_GO_API_KEY"). Default: llm-pi-ai opencode-go route apiKeyEnv, then OPENCODE_GO_API_KEY — never DEEPSEEK_API_KEY.
 * @property {number} [cacheTtlMs] Cache TTL in ms (default 30000).
 * @property {number} [timeoutMs] Upstream request timeout in ms (default 15000).
 */

/**
 * Mask an API key for display: `sk-yAENpqW1…ZeLEj`.
 * @param key - the secret value.
 * @returns a short display hint (never the full secret).
 */
export function maskKey(key) {
  if (typeof key !== 'string' || key.length === 0) return ''
  if (key.length <= 8) return '****'
  return `${key.slice(0, 6)}…${key.slice(-4)}`
}

/** Brand a credential reference (same rule as dsh-credentials; kept inline so the host has no extra import). */
function credentialRef(value) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new TypeError(`credential ref "${value}" must be a POSIX shell identifier`)
  }
  return value
}

/** Normalize an apiBaseUrl config value to a bare origin ('' when empty). */
export function originOf(value) {
  if (typeof value !== 'string' || value.trim() === '') return ''
  const trimmed = value.trim().replace(/\/+$/, '')
  try {
    return new URL(trimmed).origin
  } catch {
    return trimmed
  }
}

/**
 * The zen usage URL for an API base URL.
 * @param baseUrl - an API root (origin) or a full base URL like https://opencode.ai/zen/go/v1.
 * @returns `${origin}/zen/go/v1/usage`.
 */
export function usageUrl(baseUrl) {
  return `${originOf(baseUrl) || DEFAULT_BASE_URL}/zen/go/v1/usage`
}

/**
 * Fetch and parse the opencode Go usage payload.
 * @param options - baseUrl (API root or base URL), apiKey, optional timeout and fetch impl.
 * @returns the parsed `usage` object {rolling, weekly, monthly}, each {status, percent, resetsAt}.
 * @throws Error with a human-readable message on transport/auth/malformed responses.
 */
export async function fetchGoUsage({ baseUrl, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch }) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('no API key to query the opencode Go plan')
  }
  const url = usageUrl(baseUrl)
  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new Error(`opencode Go usage request failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`opencode Go usage rejected the API key (HTTP ${response.status}) — the stored key is missing, expired, or not entitled to the Go plan`)
  }
  if (!response.ok) {
    throw new Error(`opencode Go usage failed: HTTP ${response.status}`)
  }
  let body
  try {
    body = await response.json()
  } catch {
    throw new Error('opencode Go usage returned an invalid JSON body')
  }
  const usage = body?.usage
  if (typeof usage !== 'object' || usage === null) {
    throw new Error('opencode Go usage response has no "usage" object')
  }
  for (const windowName of ['rolling', 'weekly', 'monthly']) {
    const window = usage[windowName]
    if (typeof window !== 'object' || window === null || typeof window.percent !== 'number') {
      throw new Error(`opencode Go usage window "${windowName}" is malformed`)
    }
  }
  return usage
}

/** Extract a readable message from any thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Resolve the balance source (base URL + credential ref + live key) from the
 * plugin config and the running tree. The default follows the official
 * opencode wiring: the `opencode-go` route of the `llm-pi-ai` settings
 * namespace supplies baseURL and apiKeyEnv; the credentials service resolves
 * the ref; process.env is the fallback. The `llm-deepseek` namespace is only
 * consulted for a baseURL fallback — its apiKeyEnv (schema default
 * DEEPSEEK_API_KEY) is never used, because that is the DeepSeek LLM key, not
 * the opencode Go credential.
 * @param ctx - the cordis context (settings/credentials services read lazily).
 * @param config - resolved plugin config.
 * @returns { baseUrl, keyRef, keyHint, apiKey } — keyHint is the masked key.
 */
export async function resolveSource(ctx, config = {}) {
  let llm
  let piAi
  try {
    const settings = ctx?.get?.('settings')
    llm = settings?.get?.(LLM_SETTINGS_NAMESPACE)
    piAi = settings?.get?.(PI_AI_SETTINGS_NAMESPACE)
  } catch {
    llm = undefined
    piAi = undefined
  }
  // The dedicated official opencode-Go route (apiKeyEnv OPENCODE_GO_API_KEY) —
  // this is what the user linked the Go plan with; llm-deepseek's apiKeyEnv
  // must NOT leak in (its schema default DEEPSEEK_API_KEY is the LLM key).
  const opencodeGo = piAi?.providers?.[OPENCODE_GO_PROVIDER]
  const rawBase = config.apiBaseUrl ?? opencodeGo?.baseURL ?? llm?.baseURL ?? ''
  const baseUrl = originOf(rawBase) || DEFAULT_BASE_URL
  const keyRef = credentialRef(config.apiKeyEnv ?? opencodeGo?.apiKeyEnv ?? DEFAULT_KEY_REF)
  let apiKey = ''
  try {
    const credentials = ctx?.get?.('credentials')
    if (credentials !== undefined) {
      const hit = await credentials.resolve(keyRef)
      if (hit !== undefined && typeof hit.value === 'string' && hit.value.length > 0) apiKey = hit.value
    }
  } catch {
    apiKey = ''
  }
  if (apiKey === '' && typeof process !== 'undefined') apiKey = process.env[keyRef] ?? ''
  return { baseUrl, keyRef, keyHint: maskKey(apiKey), apiKey }
}

/**
 * The balance service: fetch + short TTL cache. The cached copy carries the
 * original fetchedAt and a `cached: true` flag.
 */
export class BalanceService {
  constructor({ getSource, fetchImpl, cacheTtlMs = DEFAULT_CACHE_TTL_MS }) {
    this.getSource = getSource
    this.fetchImpl = fetchImpl
    this.cacheTtlMs = cacheTtlMs
    this.cached = undefined
    this.cachedAt = 0
  }

  /** Last successfully resolved source (kept so errors can still describe the target). */
  lastSource = null

  /**
   * Get the balance, serving the cache within the TTL.
   * @param options - refresh bypasses the cache.
   * @returns a structured outcome: { ok, fetchedAt, cached, source, usage?, error? }.
   */
  async get({ refresh = false } = {}) {
    const now = Date.now()
    if (!refresh && this.cached !== undefined && now - this.cachedAt < this.cacheTtlMs) {
      return { ...this.cached, cached: true }
    }
    const fresh = await this.fetchFresh()
    this.cached = fresh
    this.cachedAt = Date.now()
    return { ...fresh, cached: false }
  }

  async fetchFresh() {
    const fetchedAt = new Date().toISOString()
    let source
    try {
      source = await this.getSource()
      this.lastSource = source
    } catch (error) {
      return { ok: false, fetchedAt, error: messageOf(error), source: this.lastSource }
    }
    if (typeof source.apiKey !== 'string' || source.apiKey.length === 0) {
      return {
        ok: false,
        fetchedAt,
        error: `no API key for credential ref "${source.keyRef}" — store it through the credentials service (the web Models page writes it), or export ${source.keyRef} in the launching environment`,
        source,
      }
    }
    try {
      const usage = await fetchGoUsage({ baseUrl: source.baseUrl, apiKey: source.apiKey, fetchImpl: this.fetchImpl })
      return { ok: true, fetchedAt, source, usage }
    } catch (error) {
      return { ok: false, fetchedAt, error: messageOf(error), source }
    }
  }
}

/** Render the balance outcome as agent-facing text (markdown table). */
export function renderUsageText(value) {
  const lines = []
  if (value.ok !== true || value.usage === undefined) {
    lines.push(`opencode Go 套餐余额查询失败：${value.error ?? 'unknown error'}`)
  } else {
    const source = value.source ?? {}
    lines.push(`opencode Go 套餐用量（${value.cached ? '缓存' : '实时'}，查询于 ${new Date(value.fetchedAt).toLocaleString()}）：`)
    for (const [windowName, label] of [['rolling', '滚动周期'], ['weekly', '本周'], ['monthly', '本月']]) {
      const window = value.usage[windowName]
      const resets = window.resetsAt ? ` · 重置 ${new Date(window.resetsAt).toLocaleString()}` : ''
      lines.push(`- ${label}（${windowName}）: 已用 ${window.percent}% · 状态 ${window.status}${resets}`)
    }
    lines.push(`端点: ${usageUrl(source.baseUrl ?? DEFAULT_BASE_URL)} · 密钥: ${source.keyRef ?? DEFAULT_KEY_REF} (${source.keyHint ?? ''})`)
  }
  return lines.join('\n')
}

/** Loopback check plus browser same-origin markers (mirrors the pairing/ssh routes' fence). */
function isLoopbackRequest(request) {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** One JSON response. */
function writeJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(JSON.stringify(body))
}

/**
 * Mount the balance route, the agent tool, and the announcement.
 * @param ctx - host plugin context carrying webServer/tools/systemPrompt.
 * @param config - resolved plugin config (defaults applied here).
 */
export function apply(ctx, config) {
  const resolved = {
    enabled: config?.enabled ?? true,
    announceToAgent: config?.announceToAgent ?? true,
    apiBaseUrl: config?.apiBaseUrl,
    apiKeyEnv: config?.apiKeyEnv,
    cacheTtlMs: config?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
    timeoutMs: config?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }
  if (!resolved.enabled) return

  const service = new BalanceService({
    getSource: () => resolveSource(ctx, resolved),
    cacheTtlMs: resolved.cacheTtlMs,
  })

  // The balance route: exact path, loopback-fenced, cache served unless ?refresh=1.
  const route = {
    kind: 'exact',
    path: '/api/dsh-opencode-go/balance',
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      let refresh = false
      try {
        refresh = new URL(req.url ?? '/', 'http://x').searchParams.get('refresh') === '1'
      } catch {
        refresh = false
      }
      const outcome = await service.get({ refresh })
      writeJson(res, 200, outcome)
    },
  }

  // One usage window schema, inlined per window below — the dsh-tools value
  // schema DSL supports only type/properties/required/additionalProperties/
  // items/enum/const/oneOf (no $ref / definitions).
  const windowSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      status: { type: 'string', required: true },
      percent: { type: 'number', required: true },
      resetsAt: { type: 'string', required: true },
    },
  }

  // The agent tool: query the balance through the same service.
  const tool = defineTool({
    name: 'opencode_go_balance',
    description: 'Query the balance/usage of the linked opencode Go plan (rolling / weekly / monthly usage percentages, status and reset times from GET https://opencode.ai/zen/go/v1/usage). ' +
      'Triggers: opencode go 套餐余额, Go 套餐用量, opencode 余额, balance, quota, 额度查询.',
    parameters: {
      refresh: { type: 'boolean', description: 'Bypass the 30s cache and query the upstream endpoint.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          cached: { type: 'boolean', required: true },
          fetchedAt: { type: 'string', required: true },
          source: {
            type: 'object',
            additionalProperties: false,
            properties: {
              baseUrl: { type: 'string', required: true },
              keyRef: { type: 'string', required: true },
              keyHint: { type: 'string', required: true },
            },
          },
          usage: {
            type: 'object',
            additionalProperties: false,
            properties: {
              rolling: { ...windowSchema, required: true },
              weekly: { ...windowSchema, required: true },
              monthly: { ...windowSchema, required: true },
            },
          },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderUsageText(value) }],
    },
    async execute(args) {
      return service.get({ refresh: args.refresh === true })
    },
  })

  const disposeRoute = ctx.webServer.register(route)
  const disposeTool = ctx.tools.register(tool)
  let disposeSection = undefined
  if (resolved.announceToAgent) {
    disposeSection = ctx.systemPrompt.section({
      name: 'plugin:dsh-opencode-go',
      order: SECTION_ORDER,
      text: OPENCODE_GO_GUIDANCE,
    })
  }
  ctx.effect(() => () => {
    disposeRoute()
    disposeTool()
    disposeSection?.()
  }, 'dsh-opencode-go: surfaces')
}
