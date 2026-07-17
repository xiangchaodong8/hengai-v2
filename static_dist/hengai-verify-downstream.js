/**
 * 核验页 · Step3 下游供应商核验（supplierNodes + supplier-conclusion + claim-verify）
 */
(function (W) {
  'use strict';
  if (W.__hengaiVerifyDownstream) return;
  W.__hengaiVerifyDownstream = true;

  var INDUSTRY_DEFAULTS = {
    steel: 2.1,
    aluminum: 1.82,
    aluminium: 1.82,
    cement: 0.89,
    machinery: 2.1,
    chemical: 1.6,
  };

  function resolveState() {
    try {
      if (W.parent && W.parent !== W && W.parent.AppState) return W.parent.AppState;
    } catch (_) {}
    return W.AppState || {};
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function collectSupplierNodes(st) {
    st = st || resolveState();
    var raw = st.supplierNodes || st.suppliers || [];
    return Array.isArray(raw) ? raw.filter(Boolean) : [];
  }

  function industryBaseline(st) {
    st = st || resolveState();
    var co = st.company || {};
    var ind = String(co.industryCode || co.industry_code || 'steel').toLowerCase();
    return INDUSTRY_DEFAULTS[ind] || 2.1;
  }

  function isSubmittedNode(n) {
    if (!n) return false;
    var st = String(n.status || n.supplierStatus || n.supplier_status || '').toLowerCase();
    if (st === 'submitted' || st === 'confirmed') return true;
    if (n.responded === true) return true;
    return Number(n.tco2eReported || n.tco2e_reported || n.carbonIntensityIndex || 0) > 0;
  }

  async function fetchConclusion(nodeId) {
    if (!nodeId || typeof W.apiFetch !== 'function') return null;
    try {
      return await W.apiFetch('hub/supplier-conclusion/' + encodeURIComponent(String(nodeId)), {
        method: 'GET',
      });
    } catch (_) {
      return null;
    }
  }

  async function fetchClaimVerify(certId) {
    if (!certId || typeof W.apiFetch !== 'function') return null;
    try {
      return await W.apiFetch('eco/claim-verify/' + encodeURIComponent(String(certId).trim()), {
        method: 'GET',
      });
    } catch (_) {
      return null;
    }
  }

  function renderRow(s) {
    var tag = s.isAnomaly
      ? '<span class="pill p-r">异常标记</span>'
      : '<span class="pill p-g">数据正常</span>';
    var claimTag = '';
    if (s.certId) {
      claimTag = s.claimOk === true
        ? '<span class="pill p-g" style="margin-left:6px">CL-CLAIM 已核验</span>'
        : (s.claimOk === false
          ? '<span class="pill p-o" style="margin-left:6px">认领凭证待核</span>'
          : '');
    }
    var ivc = s.clIvcHash
      ? '<div style="font-size:10.5px;color:var(--ink3);margin-top:4px;font-family:DM Mono,monospace">'
        + esc(s.clIvcHash) + '</div>'
      : '';
    var anomalyBlock = s.isAnomaly
      ? '<div class="anomaly-flag">'
        + '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1L13 12H1L7 1Z" stroke="var(--red)" stroke-width="1.2"/><line x1="7" y1="5.5" x2="7" y2="8.5" stroke="var(--red-l)" stroke-width="1.3" stroke-linecap="round"/><circle cx="7" cy="10" r=".7" fill="var(--red-l)"/></svg>'
        + '<span style="color:var(--red-l);flex:1">碳强度偏离行业均值超过10%，建议要求供应商补充说明或重新填报</span>'
        + '<button type="button" onclick="hengaiSendDownstreamRecheck(\''
        + esc(s.nodeId || '') + '\',\'' + esc(s.name) + '\')" style="padding:3px 9px;border-radius:6px;border:1px solid var(--red-b);background:var(--red-d);color:var(--red-l);font-size:10px;cursor:pointer;font-family:Noto Sans SC,sans-serif;white-space:nowrap">发送复核请求</button>'
        + '</div>'
      : '';
    return '<div class="layer-card" data-supplier-node-id="' + esc(s.nodeId || '') + '">'
      + '<div class="layer-head">'
      + '<div class="layer-ic" style="background:var(--teal-d);border:1px solid var(--teal-b)">🔧</div>'
      + '<div class="layer-title">' + esc(s.name) + ' · ' + esc(s.product) + claimTag + '</div>'
      + tag
      + '</div>'
      + '<div style="display:flex;gap:10px;font-size:11.5px;flex-wrap:wrap">'
      + '<span>申报碳强度：<strong style="font-family:DM Mono,monospace;color:var(--ink)">'
      + (Number.isFinite(s.factor) ? s.factor.toFixed(2) : '—') + ' tCO₂e/t</strong></span>'
      + '<span>偏差：<strong style="color:' + (s.isAnomaly ? 'var(--red-l)' : 'var(--green-l)') + '">'
      + (Number.isFinite(s.deviation) ? s.deviation.toFixed(1) : '—') + '%</strong></span>'
      + (s.confidence ? '<span>置信度：<strong>' + esc(s.confidence) + '</strong></span>' : '')
      + '</div>'
      + ivc
      + anomalyBlock
      + '</div>';
  }

  W.hengaiRenderDownstreamVerification = async function (batch) {
    var el = document.getElementById('downstream-layers');
    if (!el) return { ok: false, rows: [] };

    el.innerHTML = '<div style="color:var(--ink3);font-size:12px;text-align:center;padding:16px">正在核验下游供应商数据…</div>';

    var st = resolveState();
    var baseline = industryBaseline(st);
    var nodes = collectSupplierNodes(st);
    var candidates = nodes.filter(isSubmittedNode);

    if (!candidates.length) {
      el.innerHTML = '<div style="color:var(--ink3);font-size:12px;text-align:center;padding:20px;line-height:1.65">'
        + '暂无已提交的下游供应商。<br>请前往 <strong>[全域中心] → [供应链协同]</strong> 签发穿透填报邀请；'
        + '供应商完成 H5 填报后，本页将自动对账碳强度结论（不含原始数据）。</div>';
      if (batch) batch.downstreamOk = false;
      return { ok: false, rows: [] };
    }

    var rows = [];
    var allOk = true;

    for (var i = 0; i < candidates.length; i++) {
      var n = candidates[i];
      var nodeId = n.id || n.supplierNodeId || n.supplier_node_id;
      var conclusion = nodeId ? await fetchConclusion(nodeId) : null;
      var factor = Number(
        (conclusion && (conclusion.carbonIntensity != null ? conclusion.carbonIntensity : conclusion.carbon_intensity))
        || n.tco2eReported || n.tco2e_reported || n.carbonIntensityIndex || 0
      );
      var name = (conclusion && conclusion.supplierName) || n.supplierName || n.supplier_name || '供应商';
      var product = n.productType || n.product || n.materialType || n.material_type
        || (batch && batch.product) || '—';
      var certId = n.claimCertificateId || n.claim_certificate_id;
      var claimOk = null;
      if (certId) {
        var cv = await fetchClaimVerify(certId);
        claimOk = !!(cv && cv.valid === true);
      }
      var deviation = baseline > 0 ? ((factor - baseline) / baseline) * 100 : 0;
      var isAnomaly = Math.abs(deviation) > 10;
      if (isAnomaly) allOk = false;

      rows.push({
        nodeId: nodeId,
        name: name,
        product: product,
        factor: factor,
        deviation: deviation,
        isAnomaly: isAnomaly,
        certId: certId,
        claimOk: claimOk,
        clIvcHash: (conclusion && (conclusion.clIvcHash || conclusion.cl_ivc_hash))
          || n.clIvcHash || n.cl_ivc_hash,
        confidence: (conclusion && (conclusion.confidenceLevel || conclusion.confidence_level)) || n.confidenceLevel,
      });
    }

    el.innerHTML = rows.map(renderRow).join('');

    if (batch) {
      batch.downstreamOk = allOk && rows.length > 0;
      batch.downstreamVerifiedCount = rows.length;
      if (W.AppState && typeof W.AppState.update === 'function') {
        try {
          var batches = (W.AppState.batchVerification && W.AppState.batchVerification.batches) || [];
          if (Array.isArray(batches)) {
            var copy = batches.slice();
            var idx = copy.findIndex(function (b) { return b && batch.id && String(b.id) === String(batch.id); });
            if (idx >= 0) {
              copy[idx] = Object.assign({}, copy[idx], {
                downstreamOk: batch.downstreamOk,
                status: rows.length ? 'verifying' : copy[idx].status,
              });
              W.AppState.update('batchVerification.batches', copy);
            }
          }
        } catch (_) {}
      }
    }

    if (typeof W.syncStepGateButtons === 'function') W.syncStepGateButtons();

    return { ok: allOk, rows: rows };
  };

  W.hengaiSendDownstreamRecheck = function (nodeId, name) {
    var label = name || '供应商';
    if (typeof W.showToast === 'function') {
      W.showToast('已向「' + label + '」发送数据复核请求（已记录至批次 ' + (W.currentBatch && W.currentBatch.id ? W.currentBatch.id : '—') + '）');
    }
    try {
      var emit = typeof W.emitAppStateEvent === 'function' ? W.emitAppStateEvent : (W.EventBus && W.EventBus.emit);
      if (emit) {
        emit('DOWNSTREAM_RECHECK_REQUESTED', { supplierNodeId: nodeId, supplierName: label });
      }
    } catch (_) {}
  };
})(window);
