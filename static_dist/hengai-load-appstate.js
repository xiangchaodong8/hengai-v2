/**
 * 按是否 embed 决定加载 AppState 或父页桥接，避免 iframe 内双实例。
 * 暴露 whenHengaiAppStateReady(fn)，供 DOMContentLoaded 安全等待 initAppState。
 */
(function () {
  var embed = /[?&]embed=1/.test(window.location.search || '');
  var head = document.head || document.getElementsByTagName('head')[0];
  var ready = false;
  var queue = [];

  function flush() {
    ready = true;
    var pending = queue.slice();
    queue.length = 0;
    pending.forEach(function (fn) {
      try { fn(); } catch (e) { console.error('[hengai-load-appstate]', e); }
    });
  }

  window.whenHengaiAppStateReady = function (fn) {
    if (typeof fn !== 'function') return;
    if (ready || typeof window.initAppState === 'function') {
      fn();
      return;
    }
    queue.push(fn);
  };

  function load(src, onload) {
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    if (onload) s.onload = onload;
    head.appendChild(s);
  }

  load('hengai-embed-parent-bridge.js');
  if (!embed) {
    load('AppState.js', flush);
  } else {
    window.addEventListener('load', function () {
      if (typeof window.initAppState === 'function') flush();
      else {
        var n = 0;
        var iv = setInterval(function () {
          if (typeof window.initAppState === 'function') {
            clearInterval(iv);
            flush();
          } else if (++n > 120) {
            clearInterval(iv);
            flush();
          }
        }, 50);
      }
    }, { once: true });
  }
})();
