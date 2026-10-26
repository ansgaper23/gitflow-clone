// Este script corre dentro del iframe del preview:
(function () {
  // 1. Escuchar cuando el usuario navega dentro de su app (React Router o links)
  const notifyParentRoute = () => {
    window.parent.postMessage({
      type: 'FLOWPRO_ROUTE_CHANGED',
      path: window.location.pathname
    }, '*');
  };

  window.addEventListener('popstate', notifyParentRoute);
  
  // Interceptar pushState para SPAs
  const originalPushState = history.pushState;
  history.pushState = function (...args) {
    originalPushState.apply(this, args);
    notifyParentRoute();
  };

  // 2. Escuchar cuando el usuario cambia la ruta desde la cabecera de FlowPro
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'FLOWPRO_NAVIGATE') {
      const targetPath = event.data.path;
      if (window.location.pathname !== targetPath) {
        history.pushState(null, '', targetPath);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    }
  });
})();
