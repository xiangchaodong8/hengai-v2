/**
 * 供应链协同 · Phase2 批次（redeem + 因子撤回/申请/审批 + 规则变更函）
 */
(function (W) {
  'use strict';
  if (W.__hengaiSupplyPhase2) return;
  W.__hengaiSupplyPhase2 = true;

  function apiBase() {
    return String(W.API_BASE || W.location.origin || '').replace(/\/+$/, '');
  }

  function authHeaders() {
    var t = null;
    try {
      t = localStorage.getItem('hengai_token') || localStorage.getItem('authToken');
    } catch (_) {}
    return t
      ? { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', Accept: 'application/json' }
      : { 'Content-Type': 'application/json', Accept: 'application/json' };
  }

  function resolveState() {
    try {
      if (W.parent && W.parent !== W && W.parent.AppState) return W.parent.AppState;
    } catch (_) {}
    return W.AppState || {};
  }

  function isOriginRole(st) {
    st = st || resolveState();
    var co = st.company || {};
    var role = (st.user && st.user.workspaceRole) || co.type || '';
    if (String(role).toUpperCase() === 'ORIGIN' || String(role).toUpperCase() === 'ROLE_ORIGIN') return true;
    var ind = String(co.industryCode || co.industry_code || '').toLowerCase();
    if (typeof W.isOriginIndustryCode === 'function') return W.isOriginIndustryCode(ind);
    return ['steel', 'aluminum', 'aluminium', 'cement'].indexOf(ind) >= 0;
  }

  async function fetchJson(path, opts) {
    var res = await fetch(apiBase() + path, opts);
    var data = await res.json().catch(function () { return {}; });
    return { ok: res.ok, status: res.status, data: data };
  }

  async function loadOriginLedger() {
    return fetchJson('/api/v1/hub/origin-factor-ledger', { headers: authHeaders() });
  }

  function toast(msg, kind) {
    if (typeof W.showToast === 'function') W.showToast(msg, kind || 'info');
    else if (typeof W.hengaiEmbedToast === 'function') W.hengaiEmbedToast(msg, kind);
  }

  function renderPendingSupplyBindings(pending) {
    var box = document.getElementById('sup-origin-pending-bindings');
    var pill = document.getElementById('sup-pending-binding-pill');
    pending = Array.isArray(pending) ? pending : [];
    if (pill) pill.textContent = pending.length + '条';
    if (!box) return;
    if (!pending.length) {
      box.innerHTML = '<div style="font-size:11.5px;color:var(--ink3)">暂无待确认申报 · 下游申报与贵司的供应链关系后将出现在此处</div>';
      return;
    }
    box.innerHTML = pending.map(function (b) {
      var bid = b.bindingId || b.binding_id;
      var name = b.downstreamName || b.originQuery || '未知企业';
      var meta = (b.downstreamIndustry || '—') + ' · 申报于 ' + String(b.declaredAt || '').slice(0, 10)
        + (b.materialType ? (' · ' + b.materialType) : '');
      return '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;padding:10px 0;border-bottom:1px solid var(--border)">'
        + '<div style="flex:1;min-width:0"><div style="font-size:12.5px;font-weight:600">' + name + '</div>'
        + '<div style="font-size:10.5px;color:var(--ink3);margin-top:3px">' + meta + '</div></div>'
        + '<div style="display:flex;gap:6px;flex-shrink:0">'
        + '<button type="button" class="tb-btn tb-btn-primary" style="font-size:11px" data-binding-id="' + bid + '" onclick="hengaiConfirmSupplyBinding(this.getAttribute(\'data-binding-id\'), true)">确认</button>'
        + '<button type="button" class="tb-btn" style="font-size:11px" data-binding-id="' + bid + '" onclick="hengaiConfirmSupplyBinding(this.getAttribute(\'data-binding-id\'), false)">拒绝</button>'
        + '</div></div>';
    }).join('');
  }

  function renderPendingApplications(ledger) {
    var box = document.getElementById('sup-origin-pending-applications');
    if (!box) return;
    var apps = (ledger.factorAuthApplications || []).filter(function (a) {
      return a && String(a.status || '').toLowerCase() === 'pending';
    });
    if (!apps.length) {
      box.innerHTML = '<div style="font-size:11.5px;color:var(--ink3)">暂无待审批申请</div>';
      return;
    }
    box.innerHTML = apps.map(function (a) {
      var bid = a.bindingId || a.binding_id;
      var name = a.downstreamName || '下游企业';
      var note = a.note ? '<div style="font-size:11px;color:var(--ink3);margin-top:4px">' + a.note + '</div>' : '';
      return '<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">'
        + '<div><div style="font-size:12.5px">' + name + ' · 申请解锁</div>'
        + note
        + '<div style="font-size:10.5px;color:var(--ink3);margin-top:4px">' + (a.appliedAt || '').slice(0, 19) + '</div></div>'
        + '<div style="display:flex;gap:6px;flex-shrink:0;margin-left:8px">'
        + '<button type="button" class="tb-btn tb-btn-primary" style="font-size:11px" data-binding-id="' + bid + '" onclick="hengaiApproveFactorAuthApplication(this.getAttribute(\'data-binding-id\'), true)">批准</button>'
        + '<button type="button" class="tb-btn" style="font-size:11px" data-binding-id="' + bid + '" onclick="hengaiApproveFactorAuthApplication(this.getAttribute(\'data-binding-id\'), false)">拒绝</button>'
        + '</div></div>';
    }).join('');
  }

  function renderOriginGovernancePanel(ledger) {
    var panel = document.getElementById('sup-origin-governance');
    if (!panel) return;
    if (!isOriginRole()) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    var list = document.getElementById('sup-origin-downstream-list');
    var letters = document.getElementById('sup-factor-letters-history');
    if (!list) return;
    var cl = (ledger && ledger.consumptionLedger) || {};
    var optIns = cl.downstreamOptIns || [];
    var pending = ledger.pendingBindings || [];
    var confirmed = ledger.confirmedBindings || [];
    var revocations = ledger.factorAuthRevocations || [];
    var revokedIds = {};
    revocations.forEach(function (r) {
      if (r && r.downstreamWorkspaceId) revokedIds[String(r.downstreamWorkspaceId)] = true;
    });

    var rows = [];
    confirmed.forEach(function (b) {
      if (!b) return;
      var bid = b.bindingId || b.binding_id;
      var ds = b.downstreamWorkspaceId || b.downstream_workspace_id || '';
      var revoked = revokedIds[String(ds)] || b.factorAuthRequired;
      rows.push({
        name: b.downstreamName || b.downstream_name || '下游企业',
        bindingId: bid,
        status: revoked ? 'factor_auth_revoked' : 'active',
      });
    });
    optIns.forEach(function (o) {
      if (!o) return;
      var hit = rows.some(function (r) { return r.name === o.companyName; });
      if (hit) return;
      rows.push({
        name: o.companyName || '下游企业',
        bindingId: null,
        status: o.status || 'active',
        tag: o.tag,
      });
    });

    if (!rows.length) {
      list.innerHTML = '<div style="font-size:12px;color:var(--ink3);padding:12px 0">暂无已确认下游绑定。待 SME 申报绑定并确认后，可在此管理因子授权。</div>';
    } else {
      list.innerHTML = rows.map(function (r) {
        var tag = r.status === 'factor_auth_revoked' || r.tag === '需申请因子'
          ? '<span class="pill p-gold" style="margin-left:6px">🔒 需申请因子</span>'
          : '<span class="pill p-green" style="margin-left:6px">授权中</span>';
        var revokeBtn = r.bindingId && r.status !== 'factor_auth_revoked'
          ? '<button type="button" class="tb-btn" style="margin-left:8px;font-size:11px" data-binding-id="' + r.bindingId + '" onclick="hengaiRevokeFactorAuth(this.getAttribute(\'data-binding-id\'))">撤回授权</button>'
          : '';
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">'
          + '<span style="font-size:12.5px">' + r.name + tag + '</span>'
          + revokeBtn
          + '</div>';
      }).join('');
    }

    renderPendingSupplyBindings(pending);
    renderPendingApplications(ledger);

    if (letters) {
      var hist = ledger.factorRuleLetters || [];
      if (!hist.length) {
        letters.innerHTML = '<div style="font-size:11.5px;color:var(--ink3)">暂无下发记录</div>';
      } else {
        letters.innerHTML = hist.slice(0, 8).map(function (l) {
          var read = l.readAt ? '已读' : '未读';
          return '<div style="font-size:11.5px;padding:6px 0;border-bottom:1px dashed var(--border)">'
            + (l.downstreamName || '—') + ' · ' + (l.sentAt || '').slice(0, 19)
            + ' · <span style="color:var(--gold-l)">' + read + '</span></div>';
        }).join('');
      }
    }
  }

  async function refreshDownstreamFactorNotice() {
    if (isOriginRole()) return;
    var panel = document.getElementById('sup-downstream-factor-notice');
    var body = document.getElementById('sup-downstream-factor-notice-body');
    if (!panel || !body) return;
    var resp = await fetchJson('/api/v1/hub/supply-binding/mine', { headers: authHeaders() });
    if (!resp.ok) {
      panel.hidden = true;
      return;
    }
    var revoked = (resp.data.bindings || []).filter(function (b) {
      return b && b.status === 'confirmed' && b.factorAuthRequired;
    });
    if (!revoked.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    body.innerHTML = revoked.map(function (b) {
      var bid = b.bindingId || b.binding_id;
      var msg = b.factorAuthNotice
        || ('因未及时提交自身数据，原厂因子已不可用；填报前需向「' + (b.originName || '上游原厂') + '」提交申请，审批后解锁。');
      var appSt = String(b.factorAuthApplicationStatus || '').toLowerCase();
      var action = '';
      if (appSt === 'pending') {
        action = '<div style="margin-top:8px"><span class="pill p-gold">审核中 · 请等待原厂审批</span></div>';
      } else if (appSt === 'rejected') {
        action = '<div style="margin-top:8px"><button type="button" class="tb-btn tb-btn-primary" style="font-size:11px" data-binding-id="' + bid + '" onclick="hengaiApplyFactorAuthUnlock(this.getAttribute(\'data-binding-id\'))">重新申请解锁</button></div>';
      } else {
        action = '<div style="margin-top:8px"><button type="button" class="tb-btn tb-btn-primary" style="font-size:11px" data-binding-id="' + bid + '" onclick="hengaiApplyFactorAuthUnlock(this.getAttribute(\'data-binding-id\'))">向原厂申请解锁</button></div>';
      }
      return '<div style="padding:8px 0;border-bottom:1px dashed var(--border)">' + msg + action + '</div>';
    }).join('');
  }

  W.hengaiRefreshDownstreamFactorNotice = refreshDownstreamFactorNotice;

  async function refreshOriginGovernance() {
    if (!isOriginRole()) return;
    var resp = await loadOriginLedger();
    if (!resp.ok) return;
    renderOriginGovernancePanel(resp.data);
  }

  W.hengaiRefreshOriginGovernance = refreshOriginGovernance;

  W.hengaiApplyFactorAuthUnlock = async function (bindingId) {
    if (!bindingId) return;
    var resp = await fetchJson('/api/v1/hub/supply/factor-auth/apply', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        bindingId: bindingId,
        note: '已补全上游原料数据，申请重新引用原厂碳因子',
      }),
    });
    if (!resp.ok) {
      var detail = resp.data && resp.data.detail;
      var msg = typeof detail === 'object' && detail && detail.message
        ? detail.message
        : (typeof detail === 'string' ? detail : '申请失败');
      toast(msg, 'error');
      return;
    }
    toast(resp.data.message || '解锁申请已提交', 'gold');
    if (resp.data.appState && typeof W.mergeAuthoritativeAppStateFromServer === 'function') {
      W.mergeAuthoritativeAppStateFromServer(resp.data.appState);
    }
    refreshDownstreamFactorNotice();
  };

  W.hengaiConfirmSupplyBinding = async function (bindingId, approve) {
    if (!bindingId) return;
    var resp = await fetchJson('/api/v1/hub/supply-binding/confirm', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ bindingId: bindingId, approve: !!approve }),
    });
    if (!resp.ok) {
      var detail = resp.data && resp.data.detail;
      toast('操作失败：' + (typeof detail === 'string' ? detail : JSON.stringify(detail)), 'error');
      return;
    }
    toast(resp.data.message || (approve ? '已确认绑定' : '已拒绝申报'), approve ? 'gold' : 'info');
    refreshOriginGovernance();
  };

  W.hengaiApproveFactorAuthApplication = async function (bindingId, approve) {
    if (!bindingId) return;
    var resp = await fetchJson('/api/v1/hub/supply/factor-auth/approve', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ bindingId: bindingId, approve: !!approve }),
    });
    if (!resp.ok) {
      var detail = resp.data && resp.data.detail;
      toast('审批失败：' + (typeof detail === 'string' ? detail : JSON.stringify(detail)), 'error');
      return;
    }
    toast(resp.data.message || (approve ? '已批准解锁' : '已拒绝申请'), approve ? 'gold' : 'info');
    if (resp.data.appState && typeof W.mergeAuthoritativeAppStateFromServer === 'function') {
      W.mergeAuthoritativeAppStateFromServer(resp.data.appState);
    }
    refreshOriginGovernance();
  };

  W.hengaiRevokeFactorAuth = async function (bindingId) {
    if (!bindingId) return;
    var resp = await fetchJson('/api/v1/hub/supply/factor-auth/revoke', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ bindingId: bindingId }),
    });
    if (!resp.ok) {
      var detail = resp.data && resp.data.detail;
      toast('撤回失败：' + (typeof detail === 'string' ? detail : JSON.stringify(detail)), 'error');
      return;
    }
    toast(resp.data.message || '已撤回因子授权', 'gold');
    if (resp.data.appState && typeof W.mergeAuthoritativeAppStateFromServer === 'function') {
      W.mergeAuthoritativeAppStateFromServer(resp.data.appState);
    }
    refreshOriginGovernance();
  };

  W.hengaiBatchFactorRuleLetters = async function () {
    var resp = await loadOriginLedger();
    if (!resp.ok) {
      toast('无法读取绑定列表', 'error');
      return;
    }
    var ids = (resp.data.confirmedBindings || []).filter(function (b) {
      return b && (b.bindingId || b.binding_id);
    }).map(function (b) { return b.bindingId || b.binding_id; });
    if (!ids.length) {
      toast('暂无已确认绑定可下发函件', 'error');
      return;
    }
    var batch = await fetchJson('/api/v1/hub/supply/factor-rule-letters/batch', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ bindingIds: ids }),
    });
    if (!batch.ok) {
      toast('批量下发失败', 'error');
      return;
    }
    toast(batch.data.message || '规则变更函已下发', 'gold');
    refreshOriginGovernance();
  };

  W.hengaiOpenEvidenceRedeemModal = function () {
    var modal = document.getElementById('sup-evidence-redeem-modal');
    if (modal) {
      modal.style.opacity = '1';
      modal.style.pointerEvents = 'auto';
    }
  };

  W.hengaiCloseEvidenceRedeemModal = function () {
    var modal = document.getElementById('sup-evidence-redeem-modal');
    if (modal) {
      modal.style.opacity = '0';
      modal.style.pointerEvents = 'none';
    }
  };

  W.hengaiSubmitEvidenceRedeem = async function () {
    var input = document.getElementById('sup-redeem-code-input');
    var code = input ? String(input.value || '').trim() : '';
    if (!code) {
      toast('请输入精算芯兑换钥匙码', 'error');
      return;
    }
    var resp = await fetchJson('/api/v1/hub/evidence/redeem', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ redeemCode: code }),
    });
    if (!resp.ok) {
      var d = resp.data && resp.data.detail;
      var msg = typeof d === 'object' && d && d.message ? d.message : (typeof d === 'string' ? d : '兑换失败');
      toast(msg, 'error');
      return;
    }
    toast(resp.data.message || '实证包已入库', 'gold');
    W.hengaiCloseEvidenceRedeemModal();
    if (resp.data.appState && typeof W.mergeAuthoritativeAppStateFromServer === 'function') {
      W.mergeAuthoritativeAppStateFromServer(resp.data.appState);
    } else if (typeof W.initAppState === 'function') {
      try { await W.initAppState(); } catch (_) {}
    }
    if (typeof W.hengaiRefreshSupplyConsole === 'function') {
      try { W.hengaiRefreshSupplyConsole(resolveState()); } catch (_) {}
    }
  };

  W.hengaiDeclareSupplyBinding = async function (originQuery, materialType) {
    if (!originQuery) return null;
    return fetchJson('/api/v1/hub/supply-binding/declare', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ originQuery: originQuery, materialType: materialType || null }),
    });
  };

  var _rtLastEntity = '';

  function _rtReadEntityHolder() {
    var entityEl = document.getElementById('sup-rt-entity-input');
    var holderEl = document.getElementById('sup-rt-holder-input');
    var entity = entityEl ? String(entityEl.value || '').trim() : '';
    var holder = holderEl ? String(holderEl.value || '').trim() : '';
    if (!entity) {
      try {
        entity = String((_rtLastEntity || localStorage.getItem('hengai_rt_entity') || '')).trim();
      } catch (_) {}
    }
    if (!holder) {
      try {
        holder = String(localStorage.getItem('hengai_rt_holder') || '').trim();
      } catch (_) {}
    }
    return { entity: entity, holder: holder };
  }

  function _rtPersist(entity, holder) {
    _rtLastEntity = entity || '';
    try {
      if (entity) localStorage.setItem('hengai_rt_entity', entity);
      if (holder) localStorage.setItem('hengai_rt_holder', holder);
    } catch (_) {}
  }

  function _rtRenderStatus(data) {
    var el = document.getElementById('sup-rt-status');
    var fulfillBtn = document.getElementById('sup-rt-fulfill-btn');
    if (!el || !data) return;
    var cur = Number(data.currentCount != null ? data.currentCount : data.current_count) || 0;
    var tgt = Number(data.targetCount != null ? data.targetCount : data.target_count) || 30;
    var st = data.status || 'collecting';
    var holder = data.holder || '—';
    var already = !!(data.alreadyParticipated != null ? data.alreadyParticipated : data.already_participated);
    var msg = data.message || '';
    el.textContent = (data.productionEntity || data.production_entity || _rtLastEntity || '—')
      + ' · ' + holder
      + ' · ' + cur + '/' + tgt
      + ' · ' + st
      + (already ? ' · 您已参与' : '')
      + (msg ? ' · ' + msg : '');
    if (fulfillBtn) {
      var canFulfill = st === 'collecting' && cur >= tgt && tgt > 0;
      fulfillBtn.hidden = !(canFulfill || st === 'fulfilled');
      fulfillBtn.textContent = st === 'fulfilled' ? '已开启实证入口' : '达阈 · 开启实证入口';
      fulfillBtn.disabled = st === 'fulfilled';
    }
  }

  function _setModal(id, open) {
    var modal = document.getElementById(id);
    if (!modal) return;
    modal.style.opacity = open ? '1' : '0';
    modal.style.pointerEvents = open ? 'auto' : 'none';
  }

  W.hengaiOpenResonanceTriggerModal = function () {
    var eh = _rtReadEntityHolder();
    var entityEl = document.getElementById('sup-rt-entity-input');
    var holderEl = document.getElementById('sup-rt-holder-input');
    if (entityEl && !entityEl.value && eh.entity) entityEl.value = eh.entity;
    if (holderEl && !holderEl.value && eh.holder) holderEl.value = eh.holder;
    _setModal('sup-resonance-trigger-modal', true);
  };

  W.hengaiCloseResonanceTriggerModal = function () {
    _setModal('sup-resonance-trigger-modal', false);
  };

  W.hengaiRefreshResonanceTrigger = async function (opts) {
    var silent = !!(opts && opts.silent);
    var eh = _rtReadEntityHolder();
    if (!eh.entity) {
      if (!silent) {
        toast('请先填写原厂统一社会信用代码', 'error');
        W.hengaiOpenResonanceTriggerModal();
      }
      return;
    }
    _rtPersist(eh.entity, eh.holder);
    var q = encodeURIComponent(eh.entity);
    var resp = await fetchJson('/api/v1/hub/resonance/trigger?productionEntity=' + q, {
      method: 'GET',
      headers: authHeaders(),
    });
    if (!resp.ok) {
      if (!silent) toast('查询举力进度失败', 'error');
      return;
    }
    _rtRenderStatus(resp.data);
    if (!silent) toast('已刷新举力进度', 'gold');
  };

  W.hengaiSubmitResonanceTrigger = async function () {
    var entityEl = document.getElementById('sup-rt-entity-input');
    var holderEl = document.getElementById('sup-rt-holder-input');
    var msgEl = document.getElementById('sup-rt-msg-input');
    var entity = entityEl ? String(entityEl.value || '').trim() : '';
    var holder = holderEl ? String(holderEl.value || '').trim() : '';
    var message = msgEl ? String(msgEl.value || '').trim() : '';
    if (!entity || entity.length < 2) {
      toast('请填写原厂统一社会信用代码', 'error');
      return;
    }
    if (!holder) {
      toast('请填写原厂名称', 'error');
      return;
    }
    _rtPersist(entity, holder);
    var resp = await fetchJson('/api/v1/hub/resonance/trigger', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        productionEntity: entity,
        holder: holder,
        message: message || '请启动 CL-GTCID 实证',
      }),
    });
    if (!resp.ok) {
      var d = resp.data && resp.data.detail;
      var err = typeof d === 'object' && d && d.message ? d.message : (typeof d === 'string' ? d : '举力失败');
      toast(err, 'error');
      return;
    }
    _rtRenderStatus(resp.data);
    W.hengaiCloseResonanceTriggerModal();
    toast(resp.data.message || '举力已记录', 'gold');
  };

  W.hengaiFulfillResonanceTrigger = async function () {
    var eh = _rtReadEntityHolder();
    if (!eh.entity) {
      toast('缺少原厂信用代码', 'error');
      return;
    }
    var resp = await fetchJson('/api/v1/hub/resonance/trigger/fulfill', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        productionEntity: eh.entity,
        holder: eh.holder || null,
      }),
    });
    if (!resp.ok) {
      var d = resp.data && resp.data.detail;
      var err = typeof d === 'object' && d && d.message ? d.message : (typeof d === 'string' ? d : '履行失败');
      toast(err, 'error');
      return;
    }
    _rtRenderStatus(resp.data);
    toast(resp.data.message || '实证入口已开启', 'gold');
  };

  function boot() {
    if (isOriginRole()) refreshOriginGovernance();
    else refreshDownstreamFactorNotice();
    var redeemCard = document.getElementById('sup-evidence-redeem-card');
    if (redeemCard) redeemCard.hidden = false;
    var rtCard = document.getElementById('sup-resonance-trigger-card');
    if (rtCard) rtCard.hidden = false;
    try {
      var saved = localStorage.getItem('hengai_rt_entity');
      if (saved) {
        _rtLastEntity = saved;
        W.hengaiRefreshResonanceTrigger({ silent: true }).catch(function () {});
      }
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    setTimeout(boot, 400);
  }

  W.addEventListener('message', function (ev) {
    if (ev.data && ev.data.type === 'HENGAI_HUB_PIPELINE') {
      setTimeout(function () {
        if (isOriginRole()) refreshOriginGovernance();
        else refreshDownstreamFactorNotice();
      }, 300);
    }
  });
})(window);
