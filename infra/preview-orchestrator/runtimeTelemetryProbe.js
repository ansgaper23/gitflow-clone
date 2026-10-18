// infra/preview-orchestrator/runtimeTelemetryProbe.js
// SONDA AVANZADA DE TELEMETRÍA EN TIEMPO REAL PARA EL PREVIEW IFRAME (FLOWPRO)

export function getRuntimeTelemetryProbeScript(ownerKey, publicApiUrl) {
  return `<!-- FLOWPRO_TELEMETRY_PROBE_START -->
    <script src="https://cdn.jsdelivr.net/npm/html2canvas-pro@2.5.2/dist/html2canvas-pro.min.js"></script>
    <script>
    (function() {
      const SESSION_ID = "${ownerKey}";
      const REPORT_URL = "${publicApiUrl}";
      
      // Buffer circular de logs recientes (últimos 25)
      const recentLogs = [];
      function recordLog(level, args) {
        try {
          const str = Array.from(args).map(a => {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return a.stack || a.message;
            try { return JSON.stringify(a); } catch(_) { return String(a); }
          }).join(' ');
          recentLogs.push({ level, text: str.slice(0, 500), time: Date.now() });
          if (recentLogs.length > 25) recentLogs.shift();
        } catch (_) {}
      }

      // Interceptar console.error y console.warn
      const origError = console.error;
      console.error = function(...args) {
        recordLog('error', args);
        origError.apply(console, args);
      };
      const origWarn = console.warn;
      console.warn = function(...args) {
        recordLog('warn', args);
        origWarn.apply(console, args);
      };

      // Debounce Anti-Tormenta (1000ms): agrupa y deduplica errores repetidos
      let pendingPayloads = [];
      let debounceTimer = null;

      function flushCrashReports() {
        if (pendingPayloads.length === 0) return;
        const primary = pendingPayloads[0];
        const count = pendingPayloads.length;
        const consolidated = {
          ...primary,
          occurrenceCount: count,
          recentLogs: recentLogs.slice(-10),
          timestamp: Date.now()
        };
        if (count > 1) {
          consolidated.message = primary.message + ' (repetido ' + count + ' veces)';
        }
        pendingPayloads = [];
        debounceTimer = null;

        // Notificar al padre (Chat.jsx) vía postMessage
        try {
          window.parent.postMessage({ type: 'FLOWPRO_RUNTIME_ERROR', sessionId: SESSION_ID, payload: consolidated }, '*');
        } catch (_) {}

        // Notificar al backend vía HTTP beacon
        try {
          fetch(REPORT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: SESSION_ID, ...consolidated }),
            keepalive: true
          }).catch(() => {});
        } catch (_) {}
      }

      function queueCrash(payload) {
        // Ignorar errores benignos de extensiones o HMR disconnect
        const msg = String(payload.message || '').toLowerCase();
        if (msg.includes('resizeobserver loop') || msg.includes('extension context') || msg.includes('vite:connecting')) {
          return;
        }

        // Deduplicación en la ventana de 1000ms
        const existing = pendingPayloads.find(p => p.message === payload.message);
        if (!existing) {
          pendingPayloads.push(payload);
        }

        if (!debounceTimer) {
          debounceTimer = setTimeout(flushCrashReports, 1000);
        }
      }

      // 1. Excepciones de Javascript y fallos de recursos
      window.addEventListener('error', (event) => {
        queueCrash({
          source: 'UNCAUGHT_EXCEPTION',
          message: event.message || event.error?.message || (event.target && event.target.src ? 'Error cargando recurso: ' + event.target.src : 'Error de script/módulo'),
          filename: event.filename || event.target?.src || null,
          lineno: event.lineno,
          colno: event.colno,
          stack: event.error ? event.error.stack : null
        });
      }, true);

      // 2. Promesas rechazadas no manejadas
      window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason;
        queueCrash({
          source: 'UNHANDLED_REJECTION',
          message: reason?.message || String(reason),
          stack: reason?.stack || null
        });
      });

      // 3. Detección de Vite Error Overlay en el DOM
      try {
        const observer = new MutationObserver((mutations) => {
          for (const m of mutations) {
            for (const node of m.addedNodes) {
              if (node.tagName === 'VITE-ERROR-OVERLAY' || (node.id && node.id.includes('vite-error'))) {
                const text = node.shadowRoot ? node.shadowRoot.textContent : node.textContent;
                queueCrash({ source: 'VITE_ERROR_OVERLAY', message: text || 'Vite compile overlay detected' });
              }
            }
          }
        });
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
      } catch (_) {}

      // 4. Detección Proactiva de Pantalla Negra/Blanca y ErrorBoundary Visual
      function renderVisualDiagnosticCard(title, message, source) {
        try {
          if (document.getElementById('flowpro-runtime-diagnostic-overlay')) return;
          const overlay = document.createElement('div');
          overlay.id = 'flowpro-runtime-diagnostic-overlay';
          overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(9,9,11,0.96);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:24px;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;color:#f4f4f5;box-sizing:border-box;';
          
          const card = document.createElement('div');
          card.style.cssText = 'max-width:680px;width:100%;background:#18181b;border:1px solid #ef4444;border-radius:16px;padding:26px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.7);box-sizing:border-box;';
          
          card.innerHTML = 
            '<div style="display:flex;align-items:flex-start;gap:14px;margin-bottom:16px;">' +
              '<div style="width:44px;height:44px;border-radius:12px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.3);display:flex;align-items:center;justify-content:center;color:#ef4444;font-size:22px;flex-shrink:0;">⚠️</div>' +
              '<div style="flex:1;">' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                  '<span style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;background:#ef4444;color:#ffffff;padding:2px 8px;border-radius:6px;">Runtime Error</span>' +
                  '<span style="font-size:11px;font-family:monospace;color:#a1a1aa;">' + (source || 'REACT_CRASH') + '</span>' +
                '</div>' +
                '<h3 style="margin:6px 0 0 0;font-size:17px;font-weight:700;color:#ffffff;line-height:1.3;">' +
                  (title || 'Error de Renderizado en Vista Previa') +
                '</h3>' +
              '</div>' +
            '</div>' +
            '<p style="margin:0 0 12px 0;font-size:13px;color:#d4d4d8;line-height:1.5;">' +
              'Vite compiló el proyecto sin errores de sintaxis, pero un error de runtime en tus componentes React desmontó el contenedor principal <code style="background:#27272a;padding:2px 6px;border-radius:4px;color:#fca5a5;">#root</code> dejando la pantalla negra.' +
            '</p>' +
            '<div style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:14px;margin-bottom:16px;overflow-x:auto;">' +
              '<div style="font-size:12px;font-family:monospace;color:#f87171;white-space:pre-wrap;word-break:break-all;line-height:1.4;">' +
                (message || 'Error desconocido de renderizado en React') +
              '</div>' +
            '</div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:12px;border-top:1px solid #27272a;font-size:12px;color:#a1a1aa;">' +
              '<span>⚡ FlowPro detectó el fallo y notificó al agente para corregir el código.</span>' +
              '<button type="button" onclick="window.location.reload()" style="background:#27272a;color:#ffffff;border:1px solid #3f3f46;border-radius:8px;padding:6px 14px;font-size:12px;cursor:pointer;font-weight:600;">Reintentar</button>' +
            '</div>';

          overlay.appendChild(card);
          (document.body || document.documentElement).appendChild(overlay);
        } catch (_) {}
      }

      function removeVisualDiagnosticCard() {
        try {
          const el = document.getElementById('flowpro-runtime-diagnostic-overlay');
          if (el) el.remove();
        } catch (_) {}
      }

      function checkRootEmpty(triggerSource) {
        try {
          const rootEl = document.getElementById('root') || document.getElementById('app') || document.querySelector('main');
          const hasZeroContent = !rootEl || rootEl.innerHTML.trim() === '';
          const rect = rootEl ? rootEl.getBoundingClientRect() : { width: 0, height: 0 };
          const hasZeroDimensions = rect.width === 0 && rect.height === 0;
          const bodyChildrenCount = document.body ? document.body.children.length : 0;

          if (hasZeroContent && (hasZeroDimensions || bodyChildrenCount <= 2)) {
            const lastErr = recentLogs.filter(l => l.level === 'error').pop();
            const errDetail = lastErr ? lastErr.text : 'El contenedor #root quedó vacío (0 elementos renderizados)';
            
            renderVisualDiagnosticCard(
              'Error de Renderizado en Vista Previa (React desmontó #root)',
              errDetail,
              triggerSource || 'BLACK_SCREEN_WATCHDOG'
            );

            queueCrash({
              source: triggerSource || 'WHITE_SCREEN_DETECTED',
              message: 'WHITE_SCREEN_DETECTED: #root rendered empty (' + errDetail + ')',
              stack: lastErr ? ('Último log de error: ' + lastErr.text) : 'Sin excepciones explícitas capturadas pero el contenedor React está vacío.'
            });
          } else if (!hasZeroContent && (rect.width > 0 || rect.height > 0)) {
            removeVisualDiagnosticCard();
          }
        } catch (e) {
          console.warn('[TelemetryProbe] Error en checkRootEmpty:', e);
        }
      }

      // Chequeos reactivos escalonados (1500ms, 3500ms, window.load y Vite HMR updates)
      setTimeout(function() { checkRootEmpty('CHECK_1500MS'); }, 1500);
      setTimeout(function() { checkRootEmpty('CHECK_3500MS'); }, 3500);
      window.addEventListener('load', function() {
        setTimeout(function() { checkRootEmpty('WINDOW_LOAD_CHECK'); }, 1800);
      });

      // MutationObserver sobre #root para atrapar desmontajes post-render
      try {
        const rootTarget = document.getElementById('root') || document.documentElement;
        if (rootTarget) {
          const rObserver = new MutationObserver(function() {
            const rootEl = document.getElementById('root');
            if (rootEl && (rootEl.children.length === 0 || rootEl.innerHTML.trim() === '')) {
              setTimeout(function() { checkRootEmpty('MUTATION_UNMOUNT'); }, 300);
            }
          });
          rObserver.observe(rootTarget, { childList: true, subtree: true });
        }
      } catch (_) {}

      // 5. Captura visual bajo demanda (Snapshot)
      window.addEventListener('message', async (event) => {
        if (event.data?.type === 'FLOWPRO_TRIGGER_SNAPSHOT') {
          try {
            const h2c = window.html2canvas?.default || window.html2canvas;
            if (typeof h2c === 'function') {
              const canvas = await h2c(document.body, {
                logging: false,
                useCORS: true,
                scale: 0.4,
                allowTaint: false,
                ignoreElements: (el) => el.tagName === 'IFRAME' || el.classList.contains('no-snapshot')
              });
              const webpData = canvas.toDataURL('image/webp', 0.5);
              window.parent.postMessage({ type: 'FLOWPRO_SNAPSHOT_SUCCESS', payload: webpData }, '*');
            } else {
              window.parent.postMessage({ type: 'FLOWPRO_SNAPSHOT_FALLBACK' }, '*');
            }
          } catch (err) {
            console.warn('[Snapshot] Error al generar captura:', err.message);
            window.parent.postMessage({ type: 'FLOWPRO_SNAPSHOT_FALLBACK' }, '*');
          }
        }
      });
      // 6. Click-to-Edit Visual Selector
      (function initVisualSelector() {
        if (window.__FLOWPRO_SELECTOR_INITIALIZED__) return;
        window.__FLOWPRO_SELECTOR_INITIALIZED__ = true;

        let selOverlay = null;
        let selBadge = null;

        function getOverlayAndBadge() {
          if (!selOverlay) {
            selOverlay = document.createElement('div');
            selOverlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #3b82f6;background:rgba(59,130,246,0.12);border-radius:4px;transition:all 40ms ease-out;display:none;';
            document.documentElement.appendChild(selOverlay);
          }
          if (!selBadge) {
            selBadge = document.createElement('div');
            selBadge.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#2563eb;color:#ffffff;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:11px;font-weight:600;padding:2px 7px;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,0.35);white-space:nowrap;display:none;transition:all 40ms ease-out;';
            document.documentElement.appendChild(selBadge);
          }
          return { selOverlay, selBadge };
        }

        function highlightEl(el) {
          if (!el || el === selOverlay || el === selBadge || el === document.documentElement || el === document.body) return;
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return;

          const { selOverlay: o, selBadge: b } = getOverlayAndBadge();
          o.style.display = 'block';
          o.style.top = rect.top + 'px';
          o.style.left = rect.left + 'px';
          o.style.width = rect.width + 'px';
          o.style.height = rect.height + 'px';

          const compName = findComponentName(el);
          const tag = el.tagName.toLowerCase();
          b.textContent = compName ? ('<' + tag + '> · ' + compName) : ('<' + tag + '>');
          b.style.display = 'block';

          const badgeTop = rect.top < 26 ? (rect.top + 2) : (rect.top - 24);
          b.style.top = Math.max(2, badgeTop) + 'px';
          b.style.left = Math.max(2, rect.left) + 'px';
        }

        function hideHighlight() {
          if (selOverlay) selOverlay.style.display = 'none';
          if (selBadge) selBadge.style.display = 'none';
        }

        function findFiber(dom) {
          const key = Object.keys(dom || {}).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
          return key ? dom[key] : null;
        }

        function findSource(dom) {
          let fiber = findFiber(dom);
          let hops = 0;
          while (fiber && hops < 40) {
            if (fiber._debugSource) return fiber._debugSource;
            fiber = fiber.return;
            hops++;
          }
          return null;
        }

        function findComponentName(dom) {
          if (!dom) return null;
          const explicit = dom.getAttribute?.('data-component') || dom.closest?.('[data-component]')?.getAttribute('data-component');
          if (explicit) return explicit;
          let fiber = findFiber(dom);
          let hops = 0;
          while (fiber && hops < 40) {
            const type = fiber.type;
            if (typeof type === 'function' && (type.name || type.displayName)) return type.displayName || type.name;
            if (typeof type === 'object' && type && (type.displayName || type.name)) return type.displayName || type.name;
            if (fiber._debugOwner?.type?.name) return fiber._debugOwner.type.name;
            fiber = fiber.return;
            hops++;
          }
          return null;
        }

        function getParentHierarchy(el) {
          const chain = [];
          let node = el.parentElement;
          for (let i = 0; i < 4 && node && node !== document.body && node.nodeType === 1; i++) {
            const tag = node.tagName.toLowerCase();
            const cls = typeof node.className === 'string' && node.className.trim()
              ? '.' + node.className.trim().split(/\\s+/).slice(0, 3).join('.')
              : '';
            chain.push(tag + cls);
            node = node.parentElement;
          }
          return chain.join(' > ');
        }

        function selectorPath(el) {
          const parts = [];
          let node = el;
          for (let i = 0; i < 5 && node && node.nodeType === 1 && node !== document.body; i++) {
            let part = node.tagName.toLowerCase();
            if (node.id) part += '#' + node.id;
            else if (typeof node.className === 'string' && node.className.trim()) {
              part += '.' + node.className.trim().split(/\\s+/).slice(0, 2).join('.');
            }
            parts.unshift(part);
            node = node.parentElement;
          }
          return parts.join(' > ');
        }

        function onHover(e) { highlightEl(e.target); }

        function onPick(e) {
          e.preventDefault();
          e.stopPropagation();
          const el = e.target;
          const source = findSource(el);
          const componentName = findComponentName(el);
          const parentHierarchy = getParentHierarchy(el);
          const payload = {
            tagName: el.tagName.toLowerCase(),
            className: typeof el.className === 'string' ? el.className.trim() : '',
            innerText: (el.innerText || el.textContent || '').trim().slice(0, 100),
            pathname: window.location.pathname || '/',
            parentHierarchy: parentHierarchy || selectorPath(el),
            componentName: componentName || null,
            source: source ? { fileName: source.fileName, lineNumber: source.lineNumber, columnNumber: source.columnNumber } : null,
            selectorPath: selectorPath(el),
            textSnippet: (el.textContent || '').trim().slice(0, 140),
            outerHTMLSnippet: (el.outerHTML || '').slice(0, 400)
          };
          try { window.parent.postMessage({ type: 'gitflow:selected', payload }, '*'); } catch (_) {}
          try { window.parent.postMessage({ type: 'FLOWPRO_SELECTED_ELEMENT', payload }, '*'); } catch (_) {}
          setSelectActive(false);
        }

        let isCurrentSelectActive = false;
        function setSelectActive(active) {
          isCurrentSelectActive = active;
          if (active) {
            document.addEventListener('mousemove', onHover, true);
            document.addEventListener('click', onPick, true);
            document.body.style.cursor = 'crosshair';
          } else {
            document.removeEventListener('mousemove', onHover, true);
            document.removeEventListener('click', onPick, true);
            document.body.style.cursor = '';
            hideHighlight();
          }
        }

        window.addEventListener('message', (e) => {
          if (e.data?.type === 'gitflow:select-mode') {
            setSelectActive(Boolean(e.data.enabled));
          } else if (e.data?.type === 'FLOWPRO_TOGGLE_SELECTOR') {
            setSelectActive(Boolean(e.data.active));
          }
        });

        window.addEventListener('keydown', (e) => {
          if (e.altKey && (e.key === 's' || e.key === 'S')) {
            e.preventDefault();
            const next = !isCurrentSelectActive;
            setSelectActive(next);
            try {
              window.parent.postMessage({ type: 'gitflow:select-mode', enabled: next }, '*');
              window.parent.postMessage({ type: 'FLOWPRO_TOGGLE_SELECTOR', active: next }, '*');
            } catch (_) {}
          } else if (e.key === 'Escape' && isCurrentSelectActive) {
            e.preventDefault();
            setSelectActive(false);
            try {
              window.parent.postMessage({ type: 'gitflow:select-mode', enabled: false }, '*');
              window.parent.postMessage({ type: 'FLOWPRO_TOGGLE_SELECTOR', active: false }, '*');
            } catch (_) {}
          }
        }, true);
      })();
    })();
    </script>
<!-- FLOWPRO_TELEMETRY_PROBE_END -->
  `;
}
