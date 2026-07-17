/**
 * 因子消费账本 · 共享渲染（产业主权看板）
 */
(function (W) {
  'use strict';

  function setT(id, v) {
    var el = document.getElementById(id);
    if (el && v != null) el.textContent = String(v);
  }

  function setMoneyKpi(id, eurAmount) {
    var el = document.getElementById(id);
    if (!el) return;
    var n = Number(eurAmount) || 0;
    if (n <= 0) { el.textContent = '€0'; return; }
    if (W.F && typeof W.F.moneyExposureHtml === 'function') {
      el.innerHTML = W.F.moneyExposureHtml(n);
      el.classList.add('money-kpi-host');
    } else {
      el.textContent = '€' + (n / 1000).toFixed(0) + 'k';
    }
  }

  function renderIndustryDistribution(byIndustry) {
    var el = document.getElementById('industry-distribution');
    if (!el) return;
    if (!byIndustry.length) {
      el.innerHTML = '<div style="color:var(--ink3);font-size:12px;text-align:center;padding:12px">暂无行业分布数据</div>';
      return;
    }
    el.innerHTML = byIndustry.map(function (item) {
      var pct = Number(item.pct != null ? item.pct : 0);
      if (!pct) {
        var count = Number(item.count) || 0;
        var total = byIndustry.reduce(function (s, x) { return s + (Number(x.count) || 0); }, 0) || 1;
        pct = Math.round((count / total) * 100);
      }
      return '<div style="margin-bottom:7px"><div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:3px">' +
        '<span style="color:var(--ink2)">' + (item.industry || item.industryLabel || '未知') + '</span>' +
        '<span style="color:var(--teal-l)">' + pct + '%</span></div>' +
        '<div style="height:5px;background:var(--bg4);border-radius:999px;overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:var(--teal);border-radius:999px"></div></div></div>';
    }).join('');
  }

  function renderMonthlyTrend(byMonth) {
    var el = document.getElementById('monthly-trend');
    if (!el) return;
    if (!byMonth.length) {
      el.innerHTML = '<div style="color:var(--ink3);font-size:12px;text-align:center;padding:10px">暂无月度趋势数据</div>';
      return;
    }
    var maxCount = Math.max.apply(null, byMonth.map(function (m) { return Number(m.count) || 0; })) || 1;
    el.innerHTML = '<div style="display:flex;gap:6px;align-items:flex-end;height:60px;padding-bottom:4px">' +
      byMonth.map(function (m) {
        var c = Number(m.count) || 0;
        var h = Math.round((c / maxCount) * 52) + 8;
        return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:3px">' +
          '<div style="font-family:DM Mono,monospace;font-size:9px;color:var(--teal-l)">' + c + '</div>' +
          '<div style="width:100%;height:' + h + 'px;background:var(--teal-d);border:1px solid var(--teal-b);border-radius:4px 4px 0 0"></div>' +
          '<div style="font-size:8.5px;color:var(--ink3)">' + String(m.month || '').slice(5) + '</div></div>';
      }).join('') + '</div>';
  }

  function renderConsumptionLedger(ledger) {
    if (!document.getElementById('consumption-ledger-card')) return;
    if (!ledger || !ledger.total) return;
    var t = ledger.total;
    var usageCount = Number(t.usageCount != null ? t.usageCount : t.count) || 0;
    var carbonCovered = Number(t.carbonTonnageCovered != null ? t.carbonTonnageCovered : t.carbonTonnage) || 0;
    var taxSaved = Number(t.taxSavedEur) || 0;
    var fee = Number(t.serviceFeeEur != null ? t.serviceFeeEur : (taxSaved * 0.03)) || 0;
    var nursing = Number(t.nursingFundEur != null ? t.nursingFundEur : (taxSaved * 0.01)) || 0;
    var ops = fee - nursing;
    setT('ledger-usage-pill', '引用 ' + usageCount + ' 次');
    setT('ledger-count', usageCount.toLocaleString());
    setT('ledger-carbon', carbonCovered.toLocaleString());
    setMoneyKpi('ledger-saved', taxSaved);
    setT('ledger-fee', '€' + (fee / 1000).toFixed(1) + 'k');
    setT('ledger-nursing', '€' + (nursing / 1000).toFixed(1) + 'k');
    setT('ledger-ops', '€' + (ops / 1000).toFixed(1) + 'k');
    renderIndustryDistribution(ledger.byIndustry || []);
    renderMonthlyTrend(ledger.byMonth || []);
  }

  function renderDownstreamPanel(ledger) {
    if (!ledger) return;
    var claimed = ledger.claimedConsumers || [];
    renderClaimedConsumers(claimed);
    renderAnonymousRecords(ledger.anonymousRecords || ledger.anonymousConsumers || []);
  }

  function renderClaimedConsumers(claimed) {
    var el = document.getElementById('claimed-list');
    if (!el) return;
    setT('claimed-count-pill', claimed.length + ' 家');
    el.innerHTML = !claimed.length
      ? '<div style="color:var(--ink3);font-size:12px;text-align:center;padding:14px">暂无企业认领</div>'
      : claimed.map(function (c) {
        return '<div style="padding:10px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:9px;margin-bottom:7px">' +
          '<div style="font-size:12px;font-weight:600">' + (c.companyName || '未署名') + '</div></div>';
      }).join('');
  }

  function renderAnonymousRecords(records) {
    var el = document.getElementById('anonymous-list');
    if (!el) return;
    setT('anon-count-pill', records.length + ' 条');
    el.innerHTML = !records.length
      ? '<div style="color:var(--ink3);font-size:12px;text-align:center;padding:14px">暂无匿名记录</div>'
      : records.map(function (r) {
        return '<div style="padding:8px 12px;font-size:11px;color:var(--ink2)">' + (r.anonymousId || '匿名') + '</div>';
      }).join('');
  }

  W.renderHengaiFactorLedger = function (ledger) {
    renderConsumptionLedger(ledger || {});
    renderDownstreamPanel(ledger || {});
    var wrap = document.getElementById('hi-factor-ledger-card');
    if (wrap && ledger && ledger.total) {
      var n = Number(ledger.total.usageCount || ledger.total.count) || 0;
      wrap.hidden = n <= 0;
    }
  };

  W.exportHengaiFactorLedger = function () {
    if (typeof W.showToast === 'function') W.showToast('因子消费账本导出中…');
  };
})(window);
