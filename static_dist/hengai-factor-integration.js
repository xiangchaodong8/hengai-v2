/**
 * 工业原厂精算 + 核验 · EventBus 跨模块缝合（v1.0）
 * 由全域中心宿主加载；子 iframe 事件经 emitAppStateEvent 上浮后在此统一分发。
 */
(function (W) {
  'use strict';
  if (W.__hengaiFactorIntegration) return;
  W.__hengaiFactorIntegration = true;

  function getPath(o, p) {
    if (!o || !p) return null;
    return String(p).split('.').reduce(function (c, k) { return c != null ? c[k] : null; }, o);
  }

  function showToast(msg) {
    if (typeof W.showToast === 'function') {
      W.showToast(msg);
      return;
    }
    if (typeof W.hengaiEmbedToast === 'function' && W.hengaiEmbedToast(msg)) return;
    try { console.info('[HengAI][FactorBus]', msg); } catch (_) {}
  }

  function wire() {
    if (!W.EventBus || !W.EventBus.on) {
      setTimeout(wire, 80);
      return;
    }

    W.EventBus.on('BATCH_CERT_ISSUED', function (payload) {
      if (!payload || !W.AppState || typeof W.AppState.update !== 'function') return;
      W.AppState.update('cbam.pendingDeclaration', {
        batchId: payload.batchId,
        certNo: payload.certNo,
        factor: payload.factor,
        dest: payload.dest,
        issueDate: payload.issueDate,
      });
      if (typeof W.AppState.save === 'function') W.AppState.save();
      showToast('批次证书 ' + (payload.certNo || '') + ' 已就绪，可直接提交 CBAM 申报');
    });

    W.EventBus.on('FACTOR_POOL_UPDATED', function (payload) {
      var st = (typeof W.resolveWritableAppState === 'function' ? W.resolveWritableAppState() : null) || W.AppState;
      if (!st) return;
      if (payload && typeof st.update === 'function') {
        if (payload.factor != null) st.update('factorAuth.confirmedFactor', payload.factor);
        if (payload.industry) st.update('factorAuth.confirmedIndustry', payload.industry);
        if (typeof st.save === 'function') st.save();
      }
      if (!W.AppState) return;
      var badges = (getPath(W.AppState, 'badges') || []).slice();
      var exists = badges.some(function (b) {
        return (b.badgeId || b.badgeCode || b.badge_code) === 'carbon_pool_builder';
      });
      if (!exists) {
        badges.push({
          badgeId: 'carbon_pool_builder',
          badgeCode: 'carbon_pool_builder',
          badgeName: '碳城池建筑师',
          gmReward: 500,
          earnedAt: new Date().toISOString(),
          locked: false,
        });
        if (typeof W.AppState.update === 'function') W.AppState.update('badges', badges);
        if (typeof W.AppState.save === 'function') W.AppState.save();
      }
      if (typeof W.broadcastHubPipelineToEmbeds === 'function') {
        try { W.broadcastHubPipelineToEmbeds(W.AppState); } catch (_) {}
      }
    });
  }

  wire();
})(window);
