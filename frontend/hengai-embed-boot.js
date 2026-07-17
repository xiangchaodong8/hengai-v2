/**
 * HengAI V4.5 · 子页引导引擎（防抖灌注 · iframe onload 握手）
 */
(function () {
  if (!window.__hengaiExtChannelSilenced) {
    window.__hengaiExtChannelSilenced = true;
    window.addEventListener('unhandledrejection', function (ev) {
      var msg = String((ev && ev.reason && (ev.reason.message || ev.reason)) || '');
      if (/message channel closed|asynchronous response/i.test(msg)) {
        if (typeof ev.preventDefault === 'function') ev.preventDefault();
      }
    });
  }
  /* 被全域中心 iframe 引用时强制 embed=1，避免子页自带侧栏叠在父壳上（套娃） */
  try {
    if (window.parent !== window && !/[?&]embed=1/.test(window.location.search || '')) {
      var fix = new URL(window.location.href);
      fix.searchParams.set('embed', '1');
      window.location.replace(fix.toString());
      return;
    }
  } catch (_) {}

  if (window.__hengaiEmbedBoot) return;
  window.__hengaiEmbedBoot = true;

  var _bootSent = false;
  var _lastApplyKey = '';
  var _applyTimer = null;

  function parentWin() {
    try {
      if (window.parent && window.parent !== window) return window.parent;
    } catch (_) {}
    return null;
  }

  function payloadKey(p) {
    if (!p) return '';
    var u = p.user || {};
    return [
      p._ownerUserId || u.id || u.userId || '',
      u.email || '',
      u.gmBalance != null ? u.gmBalance : '',
      u.name || '',
      (p.company && p.company.name) || '',
    ].join('|');
  }

  function pipelineOwnerMatchesCurrent(p) {
    if (!p) return false;
    var root = parentWin() || window;
    var fn = root.hubOverviewUserMatchesCurrent || window.hubOverviewUserMatchesCurrent;
    if (typeof fn === 'function') return fn(p);
    return true;
  }

  function dispatchPipeline(p) {
    if (!p) return false;
    if (typeof window.dispatchHengaiModulePipelines === 'function') {
      window.dispatchHengaiModulePipelines(p);
      return true;
    }
    if (typeof window.hengaiApplyStandardPipeline === 'function') {
      window.hengaiApplyStandardPipeline(p);
      return true;
    }
    return false;
  }

  function autoApplyPipeline(payload) {
    if (!payload || !pipelineOwnerMatchesCurrent(payload)) return;
    var key = payloadKey(payload);
    if (key && key === _lastApplyKey) return;

    if (_applyTimer) clearTimeout(_applyTimer);
    _applyTimer = setTimeout(function () {
      _applyTimer = null;
      _lastApplyKey = key;
      if (dispatchPipeline(payload)) return;

      document.querySelectorAll('[data-state-bind]').forEach(function (el) {
        var path = el.getAttribute('data-state-bind');
        if (!path) return;
        var value = path.split('.').reduce(function (o, i) {
          return o != null ? o[i] : undefined;
        }, payload);
        var empty = el.getAttribute('data-empty') || '---';
        el.textContent = value != null && value !== '' ? value : empty;
      });
    }, 80);
  }

  window.addEventListener('message', function (ev) {
    if (!ev.data || ev.data.type !== 'HENGAI_HUB_PIPELINE') return;
    autoApplyPipeline(ev.data.payload);
  });

  function signalReady() {
    var p = parentWin();
    if (!p) return;
    try {
      p.postMessage({ type: 'HENGAI_EMBED_READY', href: location.href, readyState: document.readyState }, '*');
    } catch (_) {}
  }

  function boot() {
    if (_bootSent) return;
    _bootSent = true;
    var p = parentWin();
    if (!p) return;
    try {
      p.postMessage({ type: 'HENGAI_EMBED_BOOT_REQUEST', href: location.href, readyState: document.readyState }, '*');
    } catch (_) {}
  }

  window.hengaiEmbedBoot = boot;

  function onReady() {
    signalReady();
    setTimeout(boot, 120);
    setTimeout(boot, 480);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  } else {
    onReady();
  }
  window.addEventListener('load', function () {
    signalReady();
    setTimeout(boot, 80);
  }, { once: true });

  function isEmbedPage() {
    return document.documentElement.getAttribute('data-embed') === '1';
  }

  /** iframe 内 toast/弹窗委托给父页全域中心，避免 fixed 落在长文档底部 */
  window.hengaiIsEmbedPage = isEmbedPage;

  window.hengaiEmbedToast = function (msg, kind) {
    if (!isEmbedPage()) return false;
    var p = parentWin();
    if (!p) return false;
    try {
      p.postMessage({ type: 'HENGAI_EMBED_TOAST', msg: String(msg || ''), kind: kind || 'info' }, '*');
      return true;
    } catch (_) { return false; }
  };

  window.hengaiEmbedDialog = function (payload) {
    if (!isEmbedPage()) return false;
    var p = parentWin();
    if (!p) return false;
    try {
      p.postMessage({ type: 'HENGAI_EMBED_DIALOG', payload: payload || {} }, '*');
      return true;
    } catch (_) { return false; }
  };
})();
