/**
 * DOM smoke test for the @dong-victor/dsh-opencodego-usage browser half.
 *
 * Runs lib/client.js inside jsdom with a minimal dsh shell skeleton, drives
 * the real DOM paths: factory registration, apply/entry contract, sidebar
 * entry placement, panel mount into the conversation column, fetch -> card
 * render, countdown tick, refresh, error banner, and full disposal.
 *
 * Usage: node test/client-smoke.test.mjs   (needs `npm i -D jsdom` once)
 */
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok  ${name}`)
  } else {
    failures += 1
    console.error(`FAIL  ${name}${detail !== undefined ? ` — ${detail}` : ''}`)
  }
}

const html = `<!doctype html><html lang="zh"><head></head><body>
  <div data-pane="sidebar"><div class="logoRow"><button class="newSession">New Session</button></div><div class="sidebarCol-inner"></div></div>
  <div data-pane="conversation"><div class="chat">conversation</div></div>
</body></html>`

const dom = new JSDOM(html, { url: 'http://127.0.0.1:3080/', runScripts: 'outside-only', pretendToBeVisual: true })
const { window } = dom
const { document } = window

// --- fixtures --------------------------------------------------------------
const now = Date.now()
const fakeBalance = {
  ok: true,
  fetchedAt: new Date(now).toISOString(),
  cached: false,
  source: { baseUrl: 'https://opencode.ai', keyRef: 'DEEPSEEK_API_KEY', keyHint: 'sk-yAE…eLEj' },
  usage: {
    rolling: { status: 'ok', percent: 1, resetsAt: new Date(now + 3600e3).toISOString() },
    weekly: { status: 'ok', percent: 12, resetsAt: new Date(now + 2 * 86400e3).toISOString() },
    monthly: { status: 'warn', percent: 35, resetsAt: new Date(now + 7 * 86400e3).toISOString() },
  },
}
const fetchCalls = []
window.fetch = async (url) => {
  fetchCalls.push(String(url))
  return { ok: true, json: async () => fakeBalance }
}

// --- module loader capture --------------------------------------------------
let registered = undefined
window.__ModuleLoader__ = { load: (handoff) => { registered = handoff } }

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')
window.eval(source)

check('bundle registers via __ModuleLoader__.load', registered !== undefined)
check('registered id matches package name', registered?.id === '@dong-victor/dsh-opencodego-usage')

const moduleExports = registered.factory((spec) => { throw new Error(`unexpected require: ${spec}`) })
check('factory exports apply + inject', typeof moduleExports?.apply === 'function' && Array.isArray(moduleExports?.inject))
check('inject waits for slots + locale', JSON.stringify(moduleExports.inject) === JSON.stringify(['slots', 'locale']))

// --- fake ctx ----------------------------------------------------------------
const registeredLocales = {}
const ctx = {
  locale: {
    register(ns, dicts) {
      registeredLocales.ns = ns
      registeredLocales.zh = dicts.zh
      registeredLocales.en = dicts.en
      return () => {}
    },
  },
  effect(fn) {
    // Mirror cordis semantics: the effect runs immediately, its return value
    // is the disposer.
    const disposer = fn()
    ctx.effects.push(disposer)
    return () => {}
  },
  effects: [],
}
moduleExports.apply(ctx)

await new Promise((resolve) => setTimeout(resolve, 60))

// --- sidebar entry ------------------------------------------------------------
const entry = document.querySelector('[data-dsh-opencode-go-entry]')
check('sidebar entry mounted', entry !== null)
check('entry placed inside sidebar root', entry?.parentElement?.getAttribute('data-pane') === 'sidebar')
check('locale registered under dsh-opencode-go', registeredLocales.ns === 'dsh-opencode-go')
check('zh dict has entry.label', registeredLocales.zh?.['entry.label'] === 'Go 余额')
check('entry label text rendered (zh)', entry?.querySelector('.og-entryLabel')?.textContent === 'Go 余额')

// --- sidebar inline balance (no click needed) -------------------------------------
const windowRows = entry?.querySelectorAll('.og-windowRow') ?? []
check('entry has three window rows', windowRows.length === 3)
check('row labels are 5小时/周/余额', Array.from(windowRows).map((r) => r.querySelector('.og-windowLabel')?.textContent).join(',') === '5小时,周,余额')
check('fills carry percent widths', windowRows[0]?.querySelector('.og-windowFill')?.style.width === '1%' && windowRows[1]?.querySelector('.og-windowFill')?.style.width === '12%' && windowRows[2]?.querySelector('.og-windowFill')?.style.width === '35%')
check('row percents rendered', windowRows[2]?.querySelector('.og-windowPct')?.textContent === '35%')
check('reset times rendered', (windowRows[0]?.querySelector('.og-windowReset')?.textContent ?? '').length > 0 && (windowRows[2]?.querySelector('.og-windowReset')?.textContent ?? '').length > 0)
check('rolling reset is HH:mm (within 24h)', /^\d{2}:\d{2}$/.test(windowRows[0]?.querySelector('.og-windowReset')?.textContent ?? ''))
check('weekly reset is MM/DD HH:mm', /^\d{2}\/\d{2} \d{2}:\d{2}$/.test(windowRows[1]?.querySelector('.og-windowReset')?.textContent ?? ''))
check('entry marked data-ready', entry?.hasAttribute('data-ready'))
check('entry tooltip carries breakdown + reset', (entry?.getAttribute('title') ?? '').includes('35%') && (entry?.getAttribute('title') ?? '').includes('重置'))
check('entry fetch uses plain balance path (host cache)', fetchCalls.length > 0 && fetchCalls[0] === '/api/dsh-opencode-go/balance')

// --- open panel -----------------------------------------------------------------
entry.click()
await new Promise((resolve) => setTimeout(resolve, 80))

const view = document.querySelector('[data-dsh-opencode-go-view]')
check('panel view mounted in conversation column', view !== null && view.parentElement?.getAttribute('data-pane') === 'conversation')
check('html carries data-dsh-opencode-go-active', document.documentElement.hasAttribute('data-dsh-opencode-go-active'))

const cards = document.querySelectorAll('.og-card')
check('three window cards rendered', cards.length === 3)
const firstPercent = document.querySelector('.og-percent')?.textContent ?? ''
check('rolling card shows used 1%', firstPercent.includes('1%'))
const badges = Array.from(document.querySelectorAll('.og-badge'))
check('two ok badges + one warn badge', badges.filter((b) => b.classList.contains('ok')).length === 2 && badges.filter((b) => b.classList.contains('warn')).length === 1)
check('monthly card badge is warn', document.querySelectorAll('.og-card')[2]?.querySelector('.og-badge')?.classList.contains('warn'))
check('endpoint meta rendered', document.body.textContent.includes('https://opencode.ai'))
check('key meta masked', document.body.textContent.includes('sk-yAE…eLEj'))

// --- countdown tick ----------------------------------------------------------------
const resetIn = document.querySelector('.og-resetIn')?.textContent ?? ''
check('countdown text present', resetIn.length > 0)
await new Promise((resolve) => setTimeout(resolve, 1100))
const resetIn2 = document.querySelector('.og-resetIn')?.textContent ?? ''
check('countdown ticked after 1s', resetIn2 !== resetIn)

// --- refresh -----------------------------------------------------------------------
const fetchBefore = fetchCalls.length
document.querySelector('.og-iconBtn[title="刷新"]').click()
await new Promise((resolve) => setTimeout(resolve, 80))
check('refresh button hits ?refresh=1', fetchCalls.length > fetchBefore && fetchCalls[fetchCalls.length - 1].includes('refresh=1'))

// --- error banner path --------------------------------------------------------------
window.fetch = async () => ({ ok: false, json: async () => ({ ok: false, error: 'opencode Go usage rejected the API key (HTTP 401)' }) })
document.querySelector('.og-iconBtn[title="刷新"]').click()
await new Promise((resolve) => setTimeout(resolve, 80))
const banner = document.querySelector('.og-banner')
check('error banner visible on 401-style failure', banner !== null && !banner.hidden && banner.textContent.includes('查询失败'))
window.fetch = async (url) => { fetchCalls.push(String(url)); return { ok: true, json: async () => fakeBalance } }

// --- close / disposal -----------------------------------------------------------------
document.querySelector('.og-iconBtn[title="关闭"]').click()
check('close removes active attr', !document.documentElement.hasAttribute('data-dsh-opencode-go-active'))
check('entry loses active state', !entry.hasAttribute('data-active'))

// dispose everything
for (const dispose of ctx.effects.splice(0)) dispose()
await new Promise((resolve) => setTimeout(resolve, 30))
check('dispose removes sidebar entry', document.querySelector('[data-dsh-opencode-go-entry]') === null)
check('dispose removes panel view', document.querySelector('[data-dsh-opencode-go-view]') === null)
check('dispose removes active attr', !document.documentElement.hasAttribute('data-dsh-opencode-go-active'))
check('dispose removes injected style', document.getElementById('dsh-opencode-go-style') === null)

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
