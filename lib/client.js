/**
 * dsh-opencodego-usage — browser half (hand-built CJS bundle, zero runtime deps).
 *
 * Runs inside the dsh web GUI. Registers the locale dictionaries and mounts
 * two DOM surfaces: the sidebar entry row (toggles the panel) and the balance
 * panel in the center column. Everything is plain DOM + one scoped stylesheet
 * riding the dsh --dsw-* theme tokens — no React, no external requires — so
 * the bundle is self-contained and can never miss the module table.
 *
 * The panel queries GET /api/dsh-opencode-go/balance (host half) and renders
 * the rolling / weekly / monthly usage windows with progress bars, status
 * badges, reset countdowns, and a refresh button.
 *
 * Failure policy: DOM mounting problems are logged, never thrown — an
 * external plugin must not take the GUI down.
 */
window.__ModuleLoader__.load({
  id: '@dong-victor/dsh-opencodego-usage',
  factory: (require) => {
    'use strict'
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    // ======================== locale ========================

    /** Locale namespace this plugin owns. */
    var NS = 'dsh-opencode-go'

    /** zh is the key source; en mirrors every key. */
    var zh = {
      'entry.label': 'Go 余额',
      'entry.tooltip': 'opencode Go 套餐余额',
      'panel.title': 'opencode Go',
      'panel.subtitle': '套餐用量 · 链接账户',
      'panel.refresh': '刷新',
      'panel.close': '关闭',
      'panel.loading': '查询中…',
      'window.rolling': '滚动周期',
      'window.weekly': '本周',
      'window.monthly': '本月',
      'sidebar.rolling': '5小时',
      'sidebar.weekly': '周',
      'sidebar.monthly': '余额',
      'window.used': '已用 {p}%',
      'window.remaining': '剩余 {p}%',
      'window.resetsAt': '重置 {time}',
      'window.resetsIn': '{in} 后',
      'window.status.ok': '正常',
      'window.status.other': '注意',
      'meta.fetched': '查询于 {time}',
      'meta.cached': '缓存 {s}s',
      'meta.endpoint': '端点 {url}',
      'meta.key': '密钥 {ref} ({hint})',
      'meta.provider': '由 @dong-victor/dsh-opencodego-usage 提供 · GET /zen/go/v1/usage',
      'error.fetch': '查询失败：{error}',
      'error.noKey': '未配置 API 密钥（{ref}）——请在 DSH「模型」设置页写入密钥',
    }

    var en = {
      'entry.label': 'Go Plan',
      'entry.tooltip': 'opencode Go plan balance',
      'panel.title': 'opencode Go',
      'panel.subtitle': 'plan usage · linked account',
      'panel.refresh': 'Refresh',
      'panel.close': 'Close',
      'panel.loading': 'Fetching…',
      'window.rolling': 'Rolling',
      'window.weekly': 'This week',
      'window.monthly': 'This month',
      'sidebar.rolling': '5h',
      'sidebar.weekly': 'Week',
      'sidebar.monthly': 'Balance',
      'window.used': 'Used {p}%',
      'window.remaining': 'Remaining {p}%',
      'window.resetsAt': 'Resets {time}',
      'window.resetsIn': 'in {in}',
      'window.status.ok': 'OK',
      'window.status.other': 'Attention',
      'meta.fetched': 'Fetched {time}',
      'meta.cached': 'cached {s}s',
      'meta.endpoint': 'Endpoint {url}',
      'meta.key': 'Key {ref} ({hint})',
      'meta.provider': 'by @dong-victor/dsh-opencodego-usage · GET /zen/go/v1/usage',
      'error.fetch': 'Query failed: {error}',
      'error.noKey': 'No API key configured ({ref}) — store it on the DSH Models settings page',
    }

    /** Active dictionary, picked by the document language at call time. */
    function dictionary() {
      var lang = typeof document !== 'undefined' ? document.documentElement.lang : 'zh'
      return lang.toLowerCase().startsWith('en') ? en : zh
    }

    /** Translate a key with optional {name} template params (current language). */
    function tt(key, values) {
      var text = dictionary()[key]
      if (text === undefined) text = key
      if (values) {
        for (var k in values) {
          if (Object.prototype.hasOwnProperty.call(values, k)) {
            text = text.split('{' + k + '}').join(String(values[k]))
          }
        }
      }
      return text
    }

    // ======================== styles ========================

    /** Inject the scoped stylesheet once; the module system claims it via data-plugin. */
    var STYLE_TEXT = [
      "[data-pane='conversation']{position:relative}",
      '[data-dsh-opencode-go-view]{position:absolute;inset:0;display:none;z-index:5;box-sizing:border-box}',
      "html[data-dsh-opencode-go-active]:not([data-dsh-ssh-active]):not([data-dsh-taskboard-active]) [data-dsh-opencode-go-view]{display:block}",
      "html[data-dsh-opencode-go-active]:not([data-dsh-ssh-active]):not([data-dsh-taskboard-active]) [data-pane='conversation']>:not([data-dsh-opencode-go-view]){display:none}",
      '.og-entry{display:block;width:100%;box-sizing:border-box;padding:8px 12px;background:transparent;border:none;border-radius:8px;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:var(--dsw-font-family);text-align:left}',
      '.og-entry:hover{background:var(--dsw-specific-sidebar-nav-item-hover);color:var(--dsw-alias-label-primary)}',
      '.og-entry[data-active]{background:var(--dsw-specific-sidebar-nav-item-active);color:var(--dsw-alias-label-primary)}',
      '.og-entryHead{display:flex;align-items:center;gap:8px;height:20px;font-size:13px;white-space:nowrap}',
      '.og-entryIcon{display:inline-flex;flex:none}',
      '.og-entryLabel{overflow:hidden;text-overflow:ellipsis;min-width:0}',
      '.og-windowRows{display:flex;flex-direction:column;gap:3px;margin-top:6px}',
      '.og-windowRow{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;white-space:nowrap}',
      '.og-windowLabel{flex:none;width:30px;color:var(--dsw-alias-label-tertiary)}',
      '.og-windowBar{flex:1;min-width:24px;height:4px;border-radius:999px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);overflow:hidden}',
      '.og-windowFill{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary);transition:width .3s ease}',
      '.og-windowFill.hot{background:var(--dsw-alias-state-warn-primary)}',
      '.og-windowFill.danger{background:var(--dsw-alias-state-error-primary)}',
      '.og-windowPct{flex:none;min-width:30px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}',
      '.og-windowPct.hot{color:var(--dsw-alias-state-warn-primary)}',
      '.og-windowPct.danger{color:var(--dsw-alias-state-error-primary)}',
      '.og-windowReset{flex:none;min-width:64px;text-align:right;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary)}',
      '.og-view{width:100%;height:100%;padding:16px;overflow-y:auto;box-sizing:border-box;background:var(--dsw-alias-bg-base)}',
      '.og-panel{max-width:560px;margin:0 auto}',
      '.og-header{display:flex;align-items:center;gap:10px;margin-bottom:14px}',
      '.og-brand{min-width:0}',
      '.og-title{font-size:16px;font-weight:600;color:var(--dsw-alias-label-primary);line-height:22px}',
      '.og-subtitle{font-size:12px;color:var(--dsw-alias-label-tertiary);line-height:18px}',
      '.og-spacer{flex:1}',
      '.og-iconBtn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:none;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}',
      '.og-iconBtn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-specific-sidebar-nav-item-hover)}',
      '.og-banner{border:1px solid var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;margin-bottom:12px;font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary);background:var(--dsw-alias-bg-layer-2)}',
      '.og-loading{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:24px 0;text-align:center}',
      '.og-cards{display:flex;flex-direction:column;gap:10px}',
      '.og-card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:12px;padding:12px 14px}',
      '.og-cardHead{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
      '.og-cardName{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}',
      '.og-badge{font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;margin-left:auto}',
      '.og-badge.ok{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent)}',
      '.og-badge.warn{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent)}',
      '.og-percent{font-size:26px;font-weight:650;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;line-height:32px}',
      '.og-percent small{font-size:13px;color:var(--dsw-alias-label-tertiary);font-weight:500;margin-left:6px}',
      '.og-track{height:6px;border-radius:999px;background:var(--dsw-alias-bg-base);margin:10px 0 8px;overflow:hidden}',
      '.og-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary);transition:width .3s ease}',
      '.og-fill.hot{background:var(--dsw-alias-state-warn-primary)}',
      '.og-fill.danger{background:var(--dsw-alias-state-error-primary)}',
      '.og-cardFoot{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px;color:var(--dsw-alias-label-tertiary)}',
      '.og-resetAt{margin-right:6px}',
      '.og-resetIn{color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}',
      '.og-meta{margin-top:14px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary)}',
      '.og-metaRow{display:flex;align-items:center;gap:6px;flex-wrap:wrap}',
      '.og-cached{color:var(--dsw-alias-state-warn-primary)}',
    ].join('')

    function injectStyle() {
      if (document.getElementById('dsh-opencode-go-style') !== null) return
      var style = document.createElement('style')
      style.id = 'dsh-opencode-go-style'
      style.setAttribute('data-plugin', '@dong-victor/dsh-opencodego-usage')
      style.textContent = STYLE_TEXT
      document.head.append(style)
    }

    // ======================== DOM helpers ========================

    /** Tiny element builder: attrs are set via setAttribute, dataset, class, text or innerHTML. */
    function el(tag, attrs, children) {
      var node = document.createElement(tag)
      if (attrs) {
        for (var key in attrs) {
          if (!Object.prototype.hasOwnProperty.call(attrs, key)) continue
          var value = attrs[key]
          if (value === undefined || value === null || value === false) continue
          if (key === 'class') node.className = value
          else if (key === 'dataset') Object.assign(node.dataset, value)
          else if (key === 'text') node.textContent = value
          else if (key === 'html') node.innerHTML = value
          else node.setAttribute(key, value === true ? '' : String(value))
        }
      }
      if (children) {
        var list = Array.isArray(children) ? children : [children]
        for (var i = 0; i < list.length; i++) {
          var child = list[i]
          if (child !== undefined && child !== null && child !== false) node.append(child)
        }
      }
      return node
    }

    // ======================== controller ========================

    /** Panel open/close state with a tiny subscriber list. */
    function PanelController() {
      this.listeners = new Set()
      this.open = false
    }
    PanelController.prototype.subscribe = function (fn) {
      this.listeners.add(fn)
      var self = this
      return function () { self.listeners.delete(fn) }
    }
    PanelController.prototype.setOpen = function (open) {
      if (this.open === open) return
      this.open = open
      var listeners = Array.from(this.listeners)
      for (var i = 0; i < listeners.length; i++) listeners[i](open)
    }
    PanelController.prototype.toggle = function () { this.setOpen(!this.open) }
    PanelController.prototype.close = function () { this.setOpen(false) }

    // ======================== sidebar entry ========================

    var ENTRY_SELECTOR = '[data-dsh-opencode-go-entry]'
    var PANEL_NAME = 'opencode-go'
    var ACTIVATE_EVENT = 'dsh-panel-activate'
    var ACTIVE_ATTR = 'data-dsh-opencode-go-active'
    var OTHER_ACTIVE_ATTRS = ['data-dsh-ssh-active', 'data-dsh-taskboard-active']

    /** Entry icon: three gauge bars (rolling / weekly / monthly). */
    var ENTRY_ICON =
      '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" aria-hidden="true"><path d="M2.5 4.5h3v7h-3zM6.75 2.5h3v9h-3zM11 6h3v5.5h-3z"/></svg>'

    /** Find the sidebar shell root element, or undefined while not yet mounted. */
    function sidebarRoot() {
      var column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
      if (column === null) return undefined
      var logoOwner = column.querySelector('[class*="logoRow"]')
      return logoOwner ? logoOwner.parentElement : (column.firstElementChild || undefined)
    }

    /** The New Session button: nested in the logo row on current shells, a direct child on legacy shells. */
    function newSessionButton(root) {
      var nested = root.querySelector('button[class*="newSession"]')
      if (nested !== null) return nested
      for (var i = 0; i < root.children.length; i++) {
        if (root.children[i].tagName === 'BUTTON') return root.children[i]
      }
      return undefined
    }

    /** Build the entry row (a detached button; insert once the shell is up). */
    function createEntry(controller) {
      var entry = document.createElement('button')
      entry.type = 'button'
      entry.dataset.dshOpencodeGoEntry = ''
      entry.className = 'og-entry'
      entry.setAttribute('aria-label', tt('entry.label'))
      entry.setAttribute('title', tt('entry.tooltip'))
      var rows = ''
      for (var i = 0; i < WINDOWS.length; i++) {
        rows +=
          '<span class="og-windowRow" data-window="' + WINDOWS[i].key + '">' +
            '<span class="og-windowLabel"></span>' +
            '<span class="og-windowBar"><span class="og-windowFill"></span></span>' +
            '<span class="og-windowPct">--</span>' +
            '<span class="og-windowReset">--</span>' +
          '</span>'
      }
      entry.innerHTML =
        '<span class="og-entryHead">' +
          '<span class="og-entryIcon">' + ENTRY_ICON + '</span>' +
          '<span class="og-entryLabel"></span>' +
        '</span>' +
        '<span class="og-windowRows">' + rows + '</span>'
      var label = entry.querySelector('.og-entryLabel')
      label.textContent = tt('entry.label')
      entry.addEventListener('click', function () { controller.toggle() })
      return entry
    }

    /** Re-insert the entry after the family block (task board / ssh / this one). */
    function placeEntry(root, entry) {
      var button = newSessionButton(root)
      if (button === undefined) return false
      if (entry.parentElement !== root) {
        var row = button.closest('[class*="logoRow"]')
        var base = row !== null && row.parentElement === root ? row : button
        var family = Array.prototype.filter.call(root.children, function (child) {
          return child instanceof HTMLElement &&
            child.matches('[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-opencode-go-entry]')
        })
        var anchor = family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling
        root.insertBefore(entry, anchor)
      }
      return true
    }

    /** How often the sidebar summary re-queries (the host caches 30s, so 60s is cheap). */
    var ENTRY_REFRESH_MS = 60_000

    /** Mount the sidebar entry, waiting for the shell and self-healing on re-renders. */
    function mountSidebarEntry(controller) {
      var entry = createEntry(controller)
      var root
      var placed = false
      var entryTimer = undefined

      function refreshEntry() {
        fetchBalance(false)
          .then(function (body) { renderEntrySummary(entry, body) })
          .catch(function () { renderEntrySummary(entry, null) })
      }

      function startBalanceWatch() {
        refreshEntry()
        if (entryTimer === undefined) {
          entryTimer = setInterval(refreshEntry, ENTRY_REFRESH_MS)
        }
      }

      function tryPlace() {
        if (placed) return
        if (root !== undefined && !root.isConnected) {
          rootObserver.disconnect()
          root = undefined
        }
        root = root || sidebarRoot()
        if (root === undefined) return
        placed = placeEntry(root, entry)
        if (placed) {
          rootObserver.observe(root, { childList: true, subtree: true })
          waitObserver.disconnect()
        }
      }

      var waitObserver = new MutationObserver(function () { tryPlace() })
      waitObserver.observe(document.body, { childList: true, subtree: true })

      var rootObserver = new MutationObserver(function () {
        if (root === undefined || !root.isConnected) {
          placed = false
          tryPlace()
          return
        }
        if (!root.contains(entry)) placed = placeEntry(root, entry)
      })

      var unsubscribe = controller.subscribe(function (open) {
        if (open) entry.dataset.active = 'true'
        else delete entry.dataset.active
      })
      if (controller.open) entry.dataset.active = 'true'

      tryPlace()
      // The sidebar shows the balance without any click; start the watch at
      // mount even if the row is not placed yet (the render targets the
      // detached entry and lands once it is inserted).
      startBalanceWatch()

      return function () {
        if (entryTimer !== undefined) clearInterval(entryTimer)
        waitObserver.disconnect()
        rootObserver.disconnect()
        unsubscribe()
        entry.remove()
      }
    }

    // ======================== panel ========================

    var API_PATH = '/api/dsh-opencode-go/balance'

    var WINDOWS = [
      { key: 'rolling', labelKey: 'window.rolling' },
      { key: 'weekly', labelKey: 'window.weekly' },
      { key: 'monthly', labelKey: 'window.monthly' },
    ]

    // ======================== balance fetching (shared) ========================

    /** Last good balance payload and its fetch time (entry + panel share it). */
    var lastBalance = null
    var lastBalanceAt = 0
    var balanceInFlight = null

    /**
     * Fetch the balance from the host route. Concurrent callers share one
     * in-flight request; the host itself serves a 30s cache, so the sidebar's
     * 60s cadence stays cheap.
     * @param force - send ?refresh=1 to bypass the host cache.
     * @returns the parsed body (resolves even for ok:false bodies; rejects only
     *   on transport failure).
     */
    function fetchBalance(force) {
      if (balanceInFlight !== null) return balanceInFlight
      balanceInFlight = fetch(API_PATH + (force ? '?refresh=1' : ''), { headers: { accept: 'application/json' } })
        .then(function (response) { return response.json().catch(function () { return null }) })
        .then(function (body) {
          if (body !== null && body.ok === true && body.usage !== undefined) {
            lastBalance = body
            lastBalanceAt = Date.now()
          }
          return body
        })
        .finally(function () { balanceInFlight = null })
      return balanceInFlight
    }

    /**
     * Fill the sidebar entry's three window rows (label + progress bar +
     * used percent + reset time) from a payload.
     */
    function renderEntrySummary(entry, body) {
      var rows = entry.querySelectorAll('.og-windowRow')
      var ok = body !== null && body.ok === true && body.usage !== undefined
      var parts = []
      for (var i = 0; i < WINDOWS.length; i++) {
        var def = WINDOWS[i]
        var row = rows[i]
        var label = row.querySelector('.og-windowLabel')
        var fill = row.querySelector('.og-windowFill')
        var pct = row.querySelector('.og-windowPct')
        var reset = row.querySelector('.og-windowReset')
        label.textContent = tt('sidebar.' + def.key)
        var windowData = ok ? body.usage[def.key] : undefined
        if (windowData !== undefined && typeof windowData.percent === 'number') {
          var percent = Math.max(0, Math.min(100, Math.round(windowData.percent)))
          var severity = percent >= 90 ? 'danger' : percent >= 60 ? 'hot' : ''
          fill.style.width = percent + '%'
          fill.className = 'og-windowFill' + (severity !== '' ? ' ' + severity : '')
          pct.textContent = percent + '%'
          pct.className = 'og-windowPct' + (severity !== '' ? ' ' + severity : '')
          var iso = typeof windowData.resetsAt === 'string' ? windowData.resetsAt : ''
          reset.textContent = iso !== '' ? formatReset(iso) : '--'
          reset.title = iso !== '' ? tt('window.resetsAt', { time: formatTime(iso) }) : ''
          parts.push(tt('sidebar.' + def.key) + ' ' + percent + '%' + (iso !== '' ? ' · 重置 ' + formatTime(iso) : ''))
        } else {
          fill.style.width = '0%'
          fill.className = 'og-windowFill'
          pct.textContent = '--'
          pct.className = 'og-windowPct'
          reset.textContent = '--'
          reset.title = ''
        }
      }
      if (ok && parts.length === WINDOWS.length) {
        entry.title = tt('entry.tooltip') + ' — ' + parts.join(' · ')
        entry.dataset.ready = 'true'
      } else {
        entry.title = tt('entry.tooltip')
        delete entry.dataset.ready
      }
    }

    /** Format an ISO timestamp as a short local date-time. */
    function formatTime(iso) {
      var date = new Date(iso)
      if (isNaN(date.getTime())) return '--'
      return date.toLocaleString(undefined, {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      })
    }

    /** Compact reset display for the sidebar rows: "HH:mm" when within 24h, else "MM/DD HH:mm". */
    function formatReset(iso) {
      var date = new Date(iso)
      if (isNaN(date.getTime())) return '--'
      var withinDay = date.getTime() - Date.now() < 24 * 3600 * 1000
      return date.toLocaleString(undefined, withinDay
        ? { hour: '2-digit', minute: '2-digit' }
        : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    }

    /** Human countdown like "2h 13m" / "13m 42s" / "刚刚". */
    function formatCountdown(iso) {
      var diff = new Date(iso).getTime() - Date.now()
      if (diff <= 0) return tt('window.resetsIn', { in: '0m' })
      var seconds = Math.floor(diff / 1000)
      var days = Math.floor(seconds / 86400)
      var hours = Math.floor((seconds % 86400) / 3600)
      var minutes = Math.floor((seconds % 3600) / 60)
      var rest = seconds % 60
      var text = days > 0 ? days + 'd ' + hours + 'h' : hours > 0 ? hours + 'h ' + minutes + 'm' : minutes + 'm ' + rest + 's'
      return tt('window.resetsIn', { in: text })
    }

    /** Fill severity class by usage percent. */
    function fillClass(percent) {
      if (percent >= 90) return 'og-fill danger'
      if (percent >= 60) return 'og-fill hot'
      return 'og-fill'
    }

    /** Build one window card (empty; filled by updateCard). */
    function buildCard(windowDef) {
      var badge = el('span', { class: 'og-badge ok', text: tt('window.status.ok') })
      var head = el('div', { class: 'og-cardHead' }, [
        el('span', { class: 'og-cardName', text: tt(windowDef.labelKey) }),
        badge,
      ])
      var percentNode = el('div', { class: 'og-percent', text: tt('window.used', { p: '--' }) })
      var fill = el('div', { class: 'og-fill' })
      var track = el('div', { class: 'og-track' }, [fill])
      var remaining = el('span', { text: '--' })
      var resetAt = el('span', { class: 'og-resetAt', text: '--' })
      var resetIn = el('span', { class: 'og-resetIn', text: '' })
      var foot = el('div', { class: 'og-cardFoot' }, [
        remaining,
        el('span', {}, [resetAt, resetIn]),
      ])
      var card = el('div', { class: 'og-card' }, [head, percentNode, track, foot])
      return {
        root: card,
        badge: badge,
        percentNode: percentNode,
        fill: fill,
        remaining: remaining,
        resetAt: resetAt,
        resetIn: resetIn,
      }
    }

    /** Fill one card from a usage window object. */
    function updateCard(card, window) {
      var percent = Math.round(window.percent)
      var ok = window.status === 'ok'
      card.badge.className = 'og-badge ' + (ok ? 'ok' : 'warn')
      card.badge.textContent = tt(ok ? 'window.status.ok' : 'window.status.other')
      card.percentNode.textContent = ''
      card.percentNode.append(
        document.createTextNode(tt('window.used', { p: String(percent) })),
        el('small', { text: tt('window.remaining', { p: String(Math.max(0, 100 - percent)) }) }),
      )
      card.fill.className = fillClass(percent)
      card.fill.style.width = Math.max(0, Math.min(100, percent)) + '%'
      card.remaining.textContent = tt('window.remaining', { p: String(Math.max(0, 100 - percent)) })
      var resetAt = window.resetsAt
      if (typeof resetAt === 'string' && resetAt.length > 0) {
        card.resetAt.textContent = tt('window.resetsAt', { time: formatTime(resetAt) })
        card.resetAt.dataset.resetsAt = resetAt
      } else {
        card.resetAt.textContent = '--'
        delete card.resetAt.dataset.resetsAt
      }
    }

    /** Refresh only the countdown texts of every filled card. */
    function tickCountdowns(cards) {
      for (var i = 0; i < cards.length; i++) {
        var card = cards[i]
        var iso = card.resetAt.dataset.resetsAt
        card.resetIn.textContent = iso ? formatCountdown(iso) : ''
      }
    }

    /** Build the whole panel view (detached; appended to the conversation column). */
    function buildPanel(controller, cards) {
      var refreshIcon =
        '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13 2.5v2.4h-2.4"/></svg>'
      var closeIcon =
        '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>'

      var refreshButton = el('button', {
        type: 'button', class: 'og-iconBtn', title: tt('panel.refresh'), 'aria-label': tt('panel.refresh'),
        html: refreshIcon,
      })
      var closeButton = el('button', {
        type: 'button', class: 'og-iconBtn', title: tt('panel.close'), 'aria-label': tt('panel.close'),
        html: closeIcon,
      })

      var header = el('div', { class: 'og-header' }, [
        el('div', { class: 'og-brand' }, [
          el('div', { class: 'og-title', text: tt('panel.title') }),
          el('div', { class: 'og-subtitle', text: tt('panel.subtitle') }),
        ]),
        el('div', { class: 'og-spacer' }),
        refreshButton,
        closeButton,
      ])

      var banner = el('div', { class: 'og-banner', hidden: true })
      var loading = el('div', { class: 'og-loading', text: tt('panel.loading'), hidden: true })

      var cardsRoot = el('div', { class: 'og-cards', hidden: true })
      for (var i = 0; i < WINDOWS.length; i++) cardsRoot.append(cards[i].root)

      var fetchedNode = el('span')
      var cachedNode = el('span', { class: 'og-cached', hidden: true })
      var endpointNode = el('span')
      var keyNode = el('span')
      var meta = el('div', { class: 'og-meta' }, [
        el('div', { class: 'og-metaRow' }, [fetchedNode, cachedNode]),
        el('div', { class: 'og-metaRow' }, [endpointNode]),
        el('div', { class: 'og-metaRow' }, [keyNode]),
        el('div', { class: 'og-metaRow', text: tt('meta.provider') }),
      ])

      var panel = el('div', { class: 'og-panel' }, [header, banner, loading, cardsRoot, meta])
      var view = el('div', { dataset: { dshOpencodeGoView: '' }, class: 'og-view' }, [panel])

      refreshButton.addEventListener('click', function () { refresh(controller, cards, true) })
      closeButton.addEventListener('click', function () { controller.close() })

      return {
        view: view,
        banner: banner,
        loading: loading,
        cardsRoot: cardsRoot,
        fetchedNode: fetchedNode,
        cachedNode: cachedNode,
        endpointNode: endpointNode,
        keyNode: keyNode,
      }
    }

    /** Fetch the balance and render it into the panel. */
    function refresh(controller, cards, force) {
      var view = panelParts
      if (!view) return
      view.banner.hidden = true
      view.loading.hidden = false
      view.cardsRoot.hidden = true
      fetchBalance(force)
        .then(function (body) {
          view.loading.hidden = true
          if (body === null || body.ok !== true || body.usage === undefined) {
            var message = body && typeof body.error === 'string' ? body.error : 'HTTP error'
            view.banner.textContent = tt('error.fetch', { error: message })
            view.banner.hidden = false
            return
          }
          renderBalance(view, cards, body)
        })
        .catch(function (error) {
          view.loading.hidden = true
          view.banner.textContent = tt('error.fetch', { error: String(error && error.message ? error.message : error) })
          view.banner.hidden = false
        })
    }

    /** Render a successful balance payload into the panel. */
    function renderBalance(view, cards, body) {
      var usage = body.usage
      for (var i = 0; i < WINDOWS.length; i++) {
        var windowData = usage[WINDOWS[i].key]
        if (windowData) updateCard(cards[i], windowData)
      }
      view.cardsRoot.hidden = false
      view.fetchedNode.textContent = tt('meta.fetched', { time: formatTime(body.fetchedAt) })
      if (body.cached === true && typeof body.fetchedAt === 'string') {
        var seconds = Math.max(1, Math.round((Date.now() - new Date(body.fetchedAt).getTime()) / 1000))
        view.cachedNode.textContent = tt('meta.cached', { s: String(seconds) })
        view.cachedNode.hidden = false
      } else {
        view.cachedNode.hidden = true
      }
      var source = body.source || {}
      view.endpointNode.textContent = tt('meta.endpoint', { url: source.baseUrl || 'opencode.ai' })
      view.keyNode.textContent = tt('meta.key', {
        ref: source.keyRef || 'OPENCODE_GO_API_KEY',
        hint: source.keyHint || '--',
      })
      tickCountdowns(cards)
    }

    /** The panel parts (set once the view mounts). */
    var panelParts = undefined

    /** Mount the panel view into the center column and bind visibility to the controller. */
    function mountPanel(controller) {
      var cards = []
      for (var i = 0; i < WINDOWS.length; i++) cards.push(buildCard(WINDOWS[i]))
      var built = buildPanel(controller, cards)
      panelParts = built
      var container = built.view

      var ticker = undefined

      function applyActive(open) {
        if (open) {
          for (var i = 0; i < OTHER_ACTIVE_ATTRS.length; i++) {
            document.documentElement.removeAttribute(OTHER_ACTIVE_ATTRS[i])
          }
          document.documentElement.setAttribute(ACTIVE_ATTR, '')
          document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
          if (ticker === undefined) {
            ticker = setInterval(function () { tickCountdowns(cards) }, 1000)
          }
          refresh(controller, cards, false)
        } else {
          document.documentElement.removeAttribute(ACTIVE_ATTR)
          if (ticker !== undefined) {
            clearInterval(ticker)
            ticker = undefined
          }
        }
      }

      function onOtherActivate(event) {
        var detail = event.detail
        if ((detail === 'ssh' || detail === 'taskboard') && controller.open) controller.close()
      }

      // Jump out on sidebar context clicks: clicking a session/workspace row
      // hands the center column back to the conversation. Capture phase.
      var SIDEBAR_ROW_SELECTOR =
        '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
      function onClickSidebarRow(event) {
        if (!controller.open) return
        var target = event.target
        if (target && target.closest && target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.close()
      }

      function ensure() {
        if (container.isConnected) return
        var column = document.querySelector('[data-pane="conversation"]')
        if (column === null) return
        column.appendChild(container)
        applyActive(controller.open)
      }

      var waitObserver = new MutationObserver(function () { ensure() })
      waitObserver.observe(document.body, { childList: true, subtree: true })
      document.addEventListener('click', onClickSidebarRow, true)
      document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
      var unsubscribe = controller.subscribe(applyActive)
      ensure()

      return function () {
        document.removeEventListener('click', onClickSidebarRow, true)
        document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
        waitObserver.disconnect()
        unsubscribe()
        if (ticker !== undefined) clearInterval(ticker)
        document.documentElement.removeAttribute(ACTIVE_ATTR)
        container.remove()
        panelParts = undefined
      }
    }

    // ======================== entry ========================

    /** Services required (fiber inject waiting — the runtime must be up first). */
    exports.inject = ['slots', 'locale']

    /**
     * Mount the sidebar entry and the balance panel.
     * @param ctx - client root context (locale service).
     */
    exports.apply = function (ctx) {
      ctx.effect(function () {
        return ctx.locale.register(NS, { zh: zh, en: en })
      }, 'dsh-opencode-go: dictionaries')

      injectStyle()
      var controller = new PanelController()
      var disposers = []
      try {
        disposers.push(mountSidebarEntry(controller))
        disposers.push(mountPanel(controller))
      } catch (error) {
        // DOM failures degrade the panel, never the GUI.
        console.warn('[dsh-opencode-go] mount failed:', error)
      }
      ctx.effect(function () {
        return function () {
          for (var i = 0; i < disposers.length; i++) disposers[i]()
          disposers.length = 0
          var style = document.getElementById('dsh-opencode-go-style')
          if (style !== null) style.remove()
        }
      }, 'dsh-opencode-go: ui mounts')
    }

    return module.exports
  },
})
