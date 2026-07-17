/**
 * embed=1 子页：禁止再加载 AppState.js，改从父页（全域中心）继承 API，避免双实例 / 双请求 / 控制台报错。
 */
(function (W) {
  'use strict';
  if (!/[?&]embed=1/.test(W.location.search || '')) return;
  if (W.__hengaiEmbedParentBridge) return;
  W.__hengaiEmbedParentBridge = true;

  function parentWin() {
    try {
      if (W.parent && W.parent !== W) return W.parent;
    } catch (_) {}
    return null;
  }

  function bind() {
    const p = parentWin();
    if (!p) return false;
    const pick = [
      'AppState',
      'getToken',
      'setToken',
      'resolveAppState',
      'initAppState',
      'syncAppState',
      'EventBus',
      'API_BASE',
      'hengaiApiOrigin',
      'showGMRewardToast',
      'computeRepFinancials',
      'formatHubUserIdentity',
      'buildHubPipelinePayload',
      'broadcastHubPipelineToEmbeds',
      'replyHubPipelineToEmbed',
      'refreshGmChip',
      'navigateToHub',
    ];
    pick.forEach((key) => {
      if (p[key] !== undefined) W[key] = p[key];
    });
    if (p.HengAI) W.HengAI = p.HengAI;
    return !!W.AppState;
  }

  if (!bind()) {
    W.addEventListener('load', () => { bind(); }, { once: true });
  }
})(window);
