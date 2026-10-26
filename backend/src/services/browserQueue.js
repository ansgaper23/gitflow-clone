// La VPS de producción tiene muy poco margen de RAM — un solo Chromium de Playwright ya
// consume buena parte. Esta cola global asegura que NUNCA haya dos instancias de Playwright
// corriendo al mismo tiempo (capturas de miniatura vs. pruebas de preview con test_preview),
// sin importar qué parte del backend las dispare.
let queue = Promise.resolve()

export function withBrowserLock(fn) {
  const run = queue.then(fn, fn)
  // Encadena el próximo turno de la cola sin importar si este resultó en error, para que un
  // fallo puntual no deje la cola trabada para siempre.
  queue = run.then(
    () => {},
    () => {},
  )
  return run
}
