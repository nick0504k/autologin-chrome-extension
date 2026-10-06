// MAIN-world bridge: provide keypad data on demand and report real SPA navigation.
(function () {
  'use strict';
  window.__awaMobileBridge?.dispose();
  const originals = {};
  const wrappers = {};
  const route = () => window.location.pathname + window.location.search + window.location.hash;
  function publishKeypad() {
    if (!document.body) return;
    const dki = window.mtk?.now?.dki;
    if (!Array.isArray(dki)) {
      delete document.body.dataset.transkeyDki;
      return;
    }
    const value = JSON.stringify(dki);
    if (document.body.dataset.transkeyDki !== value) document.body.dataset.transkeyDki = value;
  }
  window.addEventListener('awa-request-keypad-map', publishKeypad);
  for (const method of ['pushState', 'replaceState']) {
    originals[method] = history[method];
    wrappers[method] = function (...args) {
      const before = route();
      const result = originals[method].apply(this, args);
      if (route() !== before) window.dispatchEvent(new Event('awa-mobile-route-change'));
      return result;
    };
    history[method] = wrappers[method];
  }
  window.__awaMobileBridge = {
    dispose() {
      window.removeEventListener('awa-request-keypad-map', publishKeypad);
      for (const method of Object.keys(originals)) {
        if (history[method] === wrappers[method]) history[method] = originals[method];
      }
    }
  };
})();
