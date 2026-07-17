/**
 * HengAI 批次 6 · 全场共振总线
 * 聊天 SSE actions_taken、commit、hub 同步后统一唤醒 iframe + 财务数字
 */
(function (W) {
  'use strict';
  if (W.__hengaiStateResonance) return;
  W.__hengaiStateResonance = true;

  function lightResonance(s) {
    try {
      if (typeof W.normalizeHubOverviewPayload === 'function') {
        W.__hubOverviewData = W.normalizeHubOverviewPayload(s);
      }
    } catch (_) {}
    try {
      if (typeof W.applyFinancialsInDocument === 'function') W.applyFinancialsInDocument(s);
      else if (typeof W.applyRepFinancialsToDom === 'function') W.applyRepFinancialsToDom(s);
    } catch (_) {}
    try {
      if (typeof W.hubPulseFromAppState === 'function') W.hubPulseFromAppState();
    } catch (_) {}
    try {
      if (typeof W.applyRealData === 'function' && W.__hubOverviewData) {
        W.applyRealData(W.__hubOverviewData);
      }
    } catch (_) {}
    /* applyRealData / navTo 已负责向当前 embed 发报；此处不再二次全员广播 */
    try {
      if (W.HengAI && typeof W.HengAI.syncAllInternalData === 'function') {
        W.HengAI.syncAllInternalData(s);
      }
    } catch (_) {}
  }

  /**
   * @param {object} state
   * @param {{ source?: string, light?: boolean }} opts — light=true 跳过二次 syncAppState（patch 后使用）
   */
  W.hengaiAfterStateSync = function hengaiAfterStateSync(state, opts) {
    opts = opts || {};
    const s = state || W.AppState;
    if (!s) return s;

    if (opts.light) {
      lightResonance(s);
    } else {
      try {
        if (typeof W.pulseHubAfterDataSync === 'function') {
          W.pulseHubAfterDataSync(s);
        } else {
          lightResonance(s);
          if (typeof W.syncAppState === 'function') {
            W.syncAppState(s, { fromRemote: true, emitStateSynced: true });
          }
        }
      } catch (e) {
        console.warn('[HengAI] hengaiAfterStateSync', opts.source || '', e);
      }
    }

    try {
      W.dispatchEvent(new CustomEvent('hengai:resonance-complete', {
        detail: { state: s, source: opts.source || 'unknown' },
      }));
    } catch (_) {}

    return s;
  };

  W.hengaiApplyChatStateUpdate = function hengaiApplyChatStateUpdate(updatedState, opts) {
    opts = opts || {};
    if (!updatedState || typeof updatedState !== 'object') return W.AppState;

    if (typeof W.patchAppState === 'function') {
      W.patchAppState(updatedState, {
        source: opts.source || 'chat',
        emitStateSynced: opts.emitStateSynced !== false,
        skipBroadcast: opts.skipBroadcast,
      });
    } else if (typeof W.deepMerge === 'function' && W.AppState) {
      Object.assign(W.AppState, W.deepMerge(W.AppState, updatedState));
      if (typeof W.syncAppState === 'function') {
        W.syncAppState(W.AppState, { fromRemote: true });
      }
      W.hengaiAfterStateSync(W.AppState, { source: opts.source || 'chat', light: true });
    }
    return W.AppState;
  };

  function onActionsTakenPayload(payload) {
    const p = payload || {};
    if (p._skipApply) return;
    if (p.updatedState) {
      W.hengaiApplyChatStateUpdate(p.updatedState, { source: 'actions_taken' });
    } else {
      W.hengaiAfterStateSync(W.AppState, { source: 'actions_taken-empty', light: true });
    }
  }

  W.wireHengaiStateResonance = function wireHengaiStateResonance() {
    if (W.__hengaiStateResonanceWired) return;
    W.__hengaiStateResonanceWired = true;

    W.addEventListener('hengai:actions-taken', function (e) {
      onActionsTakenPayload(e && e.detail);
    });

    if (typeof W.EventBus !== 'undefined' && W.EventBus.on) {
      W.EventBus.on('CHAT_ACTIONS_TAKEN', function (payload) {
        onActionsTakenPayload(payload);
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { W.wireHengaiStateResonance(); });
  } else {
    W.wireHengaiStateResonance();
  }
})(window);
