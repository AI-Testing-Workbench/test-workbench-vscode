// dsh-client-tscode client bundle (ModuleLoader format).
//
// Runs in the dsh Agent BrowserWindow. The window preload exposes the bounded
// `window.tscodeAgent` bridge only inside the tscode-hosted origin, so this
// plugin is inert in a normal browser or the standalone dsh desktop app.
//
// Responsibilities:
// 1. Route workspace file-link clicks to the IDE instead of dsh's sidebar.
// 2. Publish IDE context (workspace root, active file, selection) as a DOM
//    event so dsh UI plugins can consume it without another IPC surface.
// 3. Mirror the IDE theme on <html data-tscode-theme> for host-specific CSS.
//
// The preload also installs a click fallback so the integration still works
// when the user has not installed this plugin into their dsh profile.

window.__ModuleLoader__.load({ id: 'dsh-client-tscode', factory: () => {
  const module = { exports: {} }
  const exports = module.exports
  const PLUGIN_VERSION = '0.1.0'
  const FILE_LINK_CLASS = 'fileLink'
  const CONTEXT_EVENT = 'tscode-agent-context'
  let bridge
  let context
  let disposers = []

  function safeBridge() {
    try {
      bridge = window.tscodeAgent
      if (!bridge || bridge.protocolVersion !== 1) return undefined
      return bridge
    } catch (_error) {
      return undefined
    }
  }

  function pathOf(button) {
    const title = button.getAttribute('title')
    if (typeof title === 'string' && title.length > 0 && title.length <= 4096) return title.trim()
    const text = (button.textContent ?? '').trim()
    return text.length > 0 && text.length <= 4096 ? text : ''
  }

  function fileLinkButtonOf(node) {
    if (!node || typeof node.closest !== 'function') return null
    const button = node.closest('button')
    if (!button) return null
    const className = button.getAttribute('class') ?? ''
    return /(^|\s)_?fileLink_?\w*/.test(className) ? button : null
  }

  function onClick(event) {
    if (!bridge || event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const button = fileLinkButtonOf(event.target)
    if (!button) return
    const path = pathOf(button)
    if (path === '') return
    event.preventDefault()
    Promise.resolve(bridge.openFile({ path })).catch(() => undefined)
  }

  function publish(next) {
    context = next
    try {
      window.dispatchEvent(new CustomEvent(CONTEXT_EVENT, { detail: next }))
    } catch (_error) { /* old runtimes */ }
    if (next && typeof next.theme === 'string') {
      document.documentElement.setAttribute('data-tscode-theme', next.theme)
    }
  }

  function arm() {
    document.addEventListener('click', onClick, true)
    const activeBridge = safeBridge()
    if (!activeBridge) return
    disposers.push(activeBridge.onContextChanged(publish))
    disposers.push(activeBridge.onThemeChanged(function (dark) {
      document.documentElement.setAttribute('data-tscode-theme', dark ? 'dark' : 'light')
    }))
    Promise.resolve(activeBridge.getContext()).then(publish, function () { /* Host may still be starting */ })
  }

  function disarm() {
    document.removeEventListener('click', onClick, true)
    for (const dispose of disposers) {
      try { dispose() } catch (_error) { /* already gone */ }
    }
    disposers = []
  }

  function apply(ctx) {
    if (ctx && typeof ctx.effect === 'function') {
      ctx.effect(function () { arm(); return disarm })
    } else {
      arm()
    }
    window.__dshTscodeBridge = {
      version: PLUGIN_VERSION,
      available: function () { return Boolean(bridge) },
      context: function () { return context }
    }
  }

  exports.apply = apply
  exports.inject = []
  return module.exports
} })
