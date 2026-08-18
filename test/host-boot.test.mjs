/**
 * Host-boot regression test: simulates the loader calling the plugin's
 * apply() with stubbed services. This is the exact path that failed at boot
 * when the tool's output schema used $ref/definitions (unsupported by the
 * dsh-tools value schema DSL). apply() must complete without throwing and
 * register the route, the tool, and the prompt section.
 *
 * Usage: node test/host-boot.test.mjs
 */
import { apply } from '../lib/index.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`)
  } else {
    failures += 1
    console.error(`FAIL  ${name}${detail !== undefined ? ` — ${detail}` : ''}`)
  }
}

const registered = { routes: [], tools: [], sections: [] }
const disposers = []
const ctx = {
  webServer: {
    register: (route) => {
      registered.routes.push(route)
      return () => {}
    },
  },
  tools: {
    register: (tool) => {
      registered.tools.push(tool)
      return () => {}
    },
  },
  systemPrompt: {
    section: (section) => {
      registered.sections.push(section)
      return () => {}
    },
  },
  effect: (fn) => {
    const dispose = fn()
    disposers.push(dispose)
    return () => {}
  },
  get: () => undefined,
}

let applyError
try {
  apply(ctx, {})
} catch (error) {
  applyError = error
}
check('apply() completes without throwing (schema compiles)', applyError === undefined, applyError?.message)

check('balance route registered', registered.routes.length === 1 && registered.routes[0].path === '/api/dsh-opencode-go/balance')
check('route kind is exact', registered.routes[0]?.kind === 'exact')

const tool = registered.tools[0]
check('tool registered', tool !== undefined)
check('tool name is opencode_go_balance', tool?.name === 'opencode_go_balance')
check('tool has output schema', tool?.output?.schema?.type === 'object' && tool?.output?.schema?.properties?.usage !== undefined)

// The no-key path must short-circuit before any network call and return a
// structured failure (process.env must not carry OPENCODE_GO_API_KEY here).
const originalKey = process.env.OPENCODE_GO_API_KEY
delete process.env.OPENCODE_GO_API_KEY
let outcome
let executeError
try {
  outcome = await tool.execute({})
} catch (error) {
  executeError = error
}
if (originalKey !== undefined) process.env.OPENCODE_GO_API_KEY = originalKey
check('tool.execute() resolves without throwing', executeError === undefined, executeError?.message)
check('tool.execute() returns structured no-key failure', outcome?.ok === false && typeof outcome?.error === 'string' && outcome.error.includes('no API key'))

check('prompt section registered', registered.sections.length === 1 && registered.sections[0].name === 'plugin:dsh-opencode-go')
check('prompt section order in guidance band', registered.sections[0]?.order === 150)

// Render path must not throw on a realistic payload.
const renderBlocks = tool?.output?.render?.(
  {},
  {
    ok: true,
    cached: false,
    fetchedAt: new Date().toISOString(),
    source: { baseUrl: 'https://opencode.ai', keyRef: 'OPENCODE_GO_API_KEY', keyHint: 'sk-yAE…eLEj' },
    usage: {
      rolling: { status: 'ok', percent: 1, resetsAt: new Date().toISOString() },
      weekly: { status: 'ok', percent: 12, resetsAt: new Date().toISOString() },
      monthly: { status: 'ok', percent: 35, resetsAt: new Date().toISOString() },
    },
  },
)
check('render produces a text block', Array.isArray(renderBlocks) && typeof renderBlocks[0]?.text === 'string' && renderBlocks[0].text.includes('滚动周期'))

// Disposal path: the effect disposer must run the route/tool/section disposers.
for (const dispose of disposers.splice(0)) dispose()
check('disposers run without throwing', true)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
