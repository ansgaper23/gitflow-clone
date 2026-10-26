;(function () {
  // Se inyecta vía nginx (sub_filter) en TODAS las vistas previas, sin tocar el código de
  // cada proyecto. Corre dentro del iframe (otro origen) y solo habla con el padre por
  // postMessage. Cuando el modo selección está activo: resalta el elemento bajo el mouse con
  // borde azul brillante y etiqueta flotante (badge), y al hacer clic, extrae la procedencia
  // del elemento en el código fuente usando el Fiber de React DevTools (_debugSource)
  // o cae a una descripción estructurada por selector/texto.
  const PARENT_ORIGIN = 'https://flow-pro.online'
  let active = false
  let overlay = null
  let badge = null

  function ensureOverlay() {
    if (overlay && badge) return { overlay, badge }
    if (!overlay) {
      overlay = document.createElement('div')
      overlay.id = '__flowpro_selector_overlay'
      overlay.style.cssText =
        'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3b82f6;' +
        'background:rgba(59,130,246,0.12);border-radius:4px;transition:all 40ms ease-out;display:none;'
      document.documentElement.appendChild(overlay)
    }
    if (!badge) {
      badge = document.createElement('div')
      badge.id = '__flowpro_selector_badge'
      badge.style.cssText =
        'position:fixed;pointer-events:none;z-index:2147483647;background:#2563eb;color:#ffffff;' +
        'font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;font-weight:600;' +
        'padding:2px 7px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.35);white-space:nowrap;display:none;transition:all 40ms ease-out;'
      document.documentElement.appendChild(badge)
    }
    return { overlay, badge }
  }

  function cleanSourceFile(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let p = raw.replace(/\\/g, '/');
    const srcIdx = p.indexOf('src/');
    if (srcIdx !== -1) {
      return p.slice(srcIdx);
    }
    p = p.replace(/^\.?\//, '');
    p = p.replace(/^(?:opt\/[^\/]+\/workspace-[^\/]+\/|workspace\/|app\/)/, '');
    return p;
  }

  function highlight(el) {
    if (!el || el === overlay || el === badge || el === document.documentElement || el === document.body) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return

    const { overlay: o, badge: b } = ensureOverlay()
    o.style.display = 'block'
    o.style.top = `${rect.top}px`
    o.style.left = `${rect.left}px`
    o.style.width = `${rect.width}px`
    o.style.height = `${rect.height}px`

    const compName = findComponentName(el)
    const tag = el.tagName.toLowerCase()
    const src = findSource(el)
    const cleanFile = src ? cleanSourceFile(src.fileName) : null
    const lineTag = cleanFile && src?.lineNumber ? ` · ${cleanFile.split('/').pop()}:${src.lineNumber}` : ''
    b.textContent = compName ? `<${tag}> · ${compName}${lineTag}` : `<${tag}>${lineTag}`
    b.style.display = 'block'

    // Si el elemento está muy pegado al borde superior (rect.top < 26), renderizar la etiqueta dentro
    const badgeTop = rect.top < 26 ? (rect.top + 2) : (rect.top - 24)
    b.style.top = `${Math.max(2, badgeTop)}px`
    b.style.left = `${Math.max(2, rect.left)}px`
  }

  function hideHighlight() {
    if (overlay) overlay.style.display = 'none'
    if (badge) badge.style.display = 'none'
  }

  function findFiber(dom) {
    if (!dom) return null
    let curr = dom
    for (let i = 0; i < 4 && curr && curr !== document.body; i++) {
      const key = Object.keys(curr).find(
        (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
      )
      if (key && curr[key]) return curr[key]
      curr = curr.parentElement
    }
    return null
  }

  function findSource(dom) {
    if (!dom) return null

    // 1. Detección por atributos de compilación (data-flow-id, data-source, data-loc)
    let node = dom
    while (node && node !== document.body) {
      const flowId = node.getAttribute?.('data-flow-id') || node.getAttribute?.('data-source') || node.getAttribute?.('data-loc')
      if (flowId) {
        const parts = flowId.split(':')
        if (parts.length >= 2) {
          return {
            fileName: cleanSourceFile(parts[0]),
            lineNumber: parseInt(parts[1], 10),
            columnNumber: parts[2] ? parseInt(parts[2], 10) : 0,
          }
        }
      }
      node = node.parentElement
    }

    // 2. Detección nativa por React Fiber Dev Source (_debugSource)
    const fiber = findFiber(dom)
    let curr = fiber
    let hops = 0
    while (curr && hops < 50) {
      if (curr._debugSource) {
        return {
          fileName: cleanSourceFile(curr._debugSource.fileName),
          lineNumber: curr._debugSource.lineNumber,
          columnNumber: curr._debugSource.columnNumber,
        }
      }
      if (curr._debugOwner?._debugSource) {
        return {
          fileName: cleanSourceFile(curr._debugOwner._debugSource.fileName),
          lineNumber: curr._debugOwner._debugSource.lineNumber,
          columnNumber: curr._debugOwner._debugSource.columnNumber,
        }
      }
      curr = curr.return
      hops++
    }
    return null
  }

  function findComponentName(dom) {
    if (!dom) return null
    const explicit = dom.getAttribute?.('data-component') || dom.closest?.('[data-component]')?.getAttribute('data-component')
    if (explicit) return explicit

    let fiber = findFiber(dom)
    let hops = 0
    while (fiber && hops < 40) {
      const type = fiber.type
      if (typeof type === 'function' && (type.name || type.displayName)) {
        return type.displayName || type.name
      }
      if (typeof type === 'object' && type && (type.displayName || type.name)) {
        return type.displayName || type.name
      }
      if (fiber._debugOwner?.type?.name) {
        return fiber._debugOwner.type.name
      }
      fiber = fiber.return
      hops++
    }
    return null
  }

  function getParentHierarchy(el) {
    const chain = []
    let node = el.parentElement
    for (let i = 0; i < 4 && node && node !== document.body && node.nodeType === 1; i++) {
      const tag = node.tagName.toLowerCase()
      const cls = typeof node.className === 'string' && node.className.trim()
        ? '.' + node.className.trim().split(/\s+/).slice(0, 3).join('.')
        : ''
      chain.push(`${tag}${cls}`)
      node = node.parentElement
    }
    return chain.join(' > ')
  }

  function selectorPath(el) {
    const parts = []
    let node = el
    for (let i = 0; i < 5 && node && node.nodeType === 1 && node !== document.body; i++) {
      let part = node.tagName.toLowerCase()
      if (node.id) part += `#${node.id}`
      else if (typeof node.className === 'string' && node.className.trim()) {
        part += `.${node.className.trim().split(/\s+/).slice(0, 2).join('.')}`
      }
      parts.unshift(part)
      node = node.parentElement
    }
    return parts.join(' > ')
  }

  function onMove(e) {
    highlight(e.target)
  }

  function onClick(e) {
    e.preventDefault()
    e.stopPropagation()
    const el = e.target
    const source = findSource(el)
    const componentName = findComponentName(el)
    const parentHierarchy = getParentHierarchy(el)
    const currentPath = window.location.pathname || '/'
    const cleanFile = source?.fileName || null
    const sourceLine = source?.lineNumber ? parseInt(source.lineNumber, 10) : null
    const sourceCol = source?.columnNumber ? parseInt(source.columnNumber, 10) : null

    const payload = {
      tagName: el.tagName.toLowerCase(),
      className: typeof el.className === 'string' ? el.className.trim() : '',
      currentClasses: typeof el.className === 'string' ? el.className.trim() : '',
      innerText: (el.innerText || el.textContent || '').trim().slice(0, 100),
      pathname: currentPath,
      parentHierarchy: parentHierarchy || selectorPath(el),
      componentName: componentName || null,
      sourceFile: cleanFile,
      sourceLine: sourceLine,
      sourceCol: sourceCol,
      source: source ? { fileName: cleanFile, lineNumber: sourceLine, columnNumber: sourceCol } : null,
      selectorPath: selectorPath(el),
      textSnippet: (el.textContent || '').trim().slice(0, 140),
      outerHTMLSnippet: (el.outerHTML || '').slice(0, 400),
    }
    try {
      window.parent.postMessage({ type: 'gitflow:selected', payload }, PARENT_ORIGIN)
      window.parent.postMessage({ type: 'FLOWPRO_SELECTED_ELEMENT', payload }, PARENT_ORIGIN)
    } catch (_) {}
    try {
      window.parent.postMessage({ type: 'gitflow:selected', payload }, '*')
      window.parent.postMessage({ type: 'FLOWPRO_SELECTED_ELEMENT', payload }, '*')
    } catch (_) {}
    setActive(false)
  }

  function setActive(next) {
    active = next
    if (active) {
      document.addEventListener('mousemove', onMove, true)
      document.addEventListener('click', onClick, true)
      document.body.style.cursor = 'crosshair'
    } else {
      document.removeEventListener('mousemove', onMove, true)
      document.removeEventListener('click', onClick, true)
      document.body.style.cursor = ''
      hideHighlight()
    }
  }

  function isAllowedMessage(e) {
    if (!e) return false
    if (!e.origin || e.origin === PARENT_ORIGIN) return true
    if (e.origin.includes('flow-pro.online') || e.origin.includes('localhost') || e.origin.includes('127.0.0.1') || e.origin.includes('130.51.22.140')) return true
    if (window.parent && window.parent === e.source) return true
    return false
  }

  window.addEventListener('message', (e) => {
    if (!isAllowedMessage(e)) return
    if (e.data?.type === 'gitflow:select-mode') setActive(Boolean(e.data.enabled))
    if (e.data?.type === 'FLOWPRO_TOGGLE_SELECTOR') setActive(Boolean(e.data.active))
  })

  // Atajos de teclado dentro del iframe
  window.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 's' || e.key === 'S')) {
      e.preventDefault()
      const next = !active
      setActive(next)
      try {
        window.parent.postMessage({ type: 'gitflow:select-mode', enabled: next }, '*')
        window.parent.postMessage({ type: 'FLOWPRO_TOGGLE_SELECTOR', active: next }, '*')
      } catch (_) {}
    } else if (e.key === 'Escape' && active) {
      e.preventDefault()
      setActive(false)
      try {
        window.parent.postMessage({ type: 'gitflow:select-mode', enabled: false }, '*')
        window.parent.postMessage({ type: 'FLOWPRO_TOGGLE_SELECTOR', active: false }, '*')
      } catch (_) {}
    }
  }, true)

  // Muchos proyectos navegan del lado del cliente (pushState/replaceState, con o sin un
  // router) sin recargar el iframe — el padre (PreviewPanel) no tiene forma de enterarse por
  // sí solo (es otro origen), así que le avisamos cada vez que la ruta visible cambia, para que
  // el selector de página y "abrir en pestaña nueva" reflejen dónde está el usuario en verdad.
  // "_gfr" es el parámetro anticaché que agrega el propio PreviewPanel para forzar recargas —
  // no es parte de la ruta real de la app, así que lo sacamos antes de reportar para no
  // contaminar el selector de página ni "abrir en pestaña nueva" con esa basura.
  function currentAppPath() {
    const url = new URL(location.href)
    url.searchParams.delete('_gfr')
    const qs = url.searchParams.toString()
    return url.pathname + (qs ? `?${qs}` : '')
  }
  // ── Active View Context Tracker (Implicit Contextual Comprehension Engine) ──
  let lastActiveViewJson = ''
  let viewContextTimer = null

  function getVisibleHeading() {
    try {
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]'))
      for (const h of headings) {
        const rect = h.getBoundingClientRect()
        if (rect.height > 0 && rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight) {
          const txt = (h.innerText || h.textContent || '').trim()
          if (txt) return txt.slice(0, 120)
        }
      }
    } catch (_) {}
    return null
  }

  function getActiveModalOrDrawer() {
    try {
      const modal = document.querySelector(
        '[role="dialog"][data-state="open"], [role="dialog"]:not([data-state="closed"]), dialog[open], [data-radix-dialog-content], [data-state="open"][role="alertdialog"]'
      )
      if (modal) {
        const titleEl = modal.querySelector('h1, h2, h3, [class*="title"], [role="heading"]')
        const title = titleEl ? (titleEl.innerText || titleEl.textContent || '').trim() : ''
        return {
          isOpen: true,
          title: title.slice(0, 100) || 'Modal abierto',
          node: modal
        }
      }
    } catch (_) {}
    return null
  }

  function getActiveTab() {
    try {
      const tab = document.querySelector(
        '[role="tab"][data-state="active"], [role="tab"][aria-selected="true"], button[data-state="active"][role="tab"]'
      )
      if (tab) {
        return (tab.innerText || tab.textContent || '').trim().slice(0, 80)
      }
    } catch (_) {}
    return null
  }

  function getFocusedComponentFile(activeModal) {
    try {
      if (activeModal?.node) {
        const src = findSource(activeModal.node)
        if (src?.fileName) return src.fileName
      }
      const candidates = [
        document.querySelector('main'),
        document.querySelector('#root > div'),
        document.querySelector('body > div:not(#gitflow-selector-overlay)'),
        document.querySelector('h1'),
        document.querySelector('h2')
      ]
      for (const c of candidates) {
        if (c) {
          const src = findSource(c)
          if (src?.fileName) return src.fileName
        }
      }
    } catch (_) {}
    return null
  }

  function reportActiveViewContextNow() {
    try {
      const route = currentAppPath()
      const heading = getVisibleHeading()
      const modalInfo = getActiveModalOrDrawer()
      const tab = getActiveTab()
      const focusedFile = getFocusedComponentFile(modalInfo)

      const context = {
        route,
        visibleHeading: heading,
        activeModal: modalInfo?.title || null,
        activeTab: tab,
        focusedFile: focusedFile || null
      }

      const str = JSON.stringify(context)
      if (str === lastActiveViewJson) return
      lastActiveViewJson = str

      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'FLOWPRO_ACTIVE_VIEW_CONTEXT', context }, '*')
      }
    } catch (_) {}
  }

  function reportActiveViewContext() {
    clearTimeout(viewContextTimer)
    viewContextTimer = setTimeout(reportActiveViewContextNow, 300)
  }

  let lastPath = currentAppPath()
  function reportPath() {
    const path = currentAppPath()
    reportActiveViewContext()
    if (path === lastPath) return
    lastPath = path
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'gitflow:navigated', path }, PARENT_ORIGIN)
      window.parent.postMessage({ type: 'gitflow:navigated', path }, '*')
    }
  }
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method]
    history[method] = function (...args) {
      const result = original.apply(this, args)
      reportPath()
      return result
    }
  }
  window.addEventListener('popstate', reportPath)
  window.addEventListener('hashchange', reportPath)

  // ── Auto-Healing Runtime Error Reporter ──
  function reportRuntimeError(event) {
    try {
      const msg = event?.error?.message || event?.message || event?.reason?.message || String(event?.reason || event || 'Unknown error');
      const file = event?.error?.fileName || event?.filename || '';
      const line = event?.error?.lineNumber || event?.lineno || 0;
      const stack = event?.error?.stack || event?.reason?.stack || '';
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: 'PREVIEW_RUNTIME_ERROR',
          message: msg,
          filename: file,
          lineno: line,
          stack: stack
        }, '*');
      }
    } catch (_) {}
  }
  window.addEventListener('error', reportRuntimeError);
  window.addEventListener('unhandledrejection', reportRuntimeError);

  try {
    const observer = new MutationObserver(() => {
      reportActiveViewContext()
    })
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'class', 'style', 'open'] })
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        if (document.body) {
          observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-state', 'class', 'style', 'open'] })
        }
        reportActiveViewContext()
      })
    }
  } catch (_) {}
  window.addEventListener('click', reportActiveViewContext, true)

  if (window.parent !== window) {
    window.parent.postMessage({ type: 'gitflow:ready' }, PARENT_ORIGIN)
    window.parent.postMessage({ type: 'gitflow:ready' }, '*')
    // También cubre navegación de página completa (sin pushState) dentro del iframe: cada vez
    // que este script se re-ejecuta (nueva carga de documento) avisamos dónde quedamos.
    window.parent.postMessage({ type: 'gitflow:navigated', path: lastPath }, PARENT_ORIGIN)
    window.parent.postMessage({ type: 'gitflow:navigated', path: lastPath }, '*')
    setTimeout(reportActiveViewContextNow, 500)
  }
})()
