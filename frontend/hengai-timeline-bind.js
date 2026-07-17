/**
 * HengAI · 时间轴 / 流水 / 徽章日期统一绑定
 */
(function (W) {
  'use strict';
  if (W.__hengaiTimelineBind) return;
  W.__hengaiTimelineBind = true;

  function fmtTime(v, mode) {
    if (v == null || v === '') return '待记录';
    var F = W.F;
    if (F) {
      if (mode === 'md') return F.md(v) || '待记录';
      if (mode === 'mdhm') {
        var md = F.md(v);
        if (!md || md === '待录入' || md === '待记录') return '待记录';
        try {
          var d = new Date(v);
          if (!Number.isNaN(d.getTime())) {
            var hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
            return md + ' ' + hm;
          }
        } catch (_) {}
        return md;
      }
      if (mode === 'dt') return F.dt(v) || '待记录';
    }
    try {
      var d2 = new Date(v);
      if (Number.isNaN(d2.getTime())) return '—';
      if (mode === 'md') {
        return String(d2.getMonth() + 1).padStart(2, '0') + '-' + String(d2.getDate()).padStart(2, '0');
      }
      return d2.toLocaleString('zh-CN', { hour12: false });
    } catch (_) {
      return '—';
    }
  }

  W.formatHubTime = fmtTime;

  W.buildMilestonesFromState = function buildMilestonesFromState(state) {
    var s = state || W.AppState || {};
    var u = s.user || {};
    var ms = Object.assign({}, s.milestones || {});
    if (!ms.register) ms.register = u.regDate || u.reg_date;
    if (!ms.proMember && (u.tier_code === 'PRO_PERSONAL' || u.tier_code === 'ENT_VERIFIED')) {
      ms.proMember = ms.register;
    }
    var reports = s.recentReports || [];
    if (!ms.cbamCalc && reports.length) {
      var r0 = reports[0];
      ms.cbamCalc = r0.submittedAt || r0.createdAt;
    }
    var co = s.company || {};
    if (!ms.enterprise && co.isComplete) ms.enterprise = co.updatedAt || co.createdAt;
    if (!ms.supply) {
      (s.supplierNodes || []).forEach(function (n) {
        var st = String((n && n.status) || '').toLowerCase();
        if (st === 'submitted' || st === 'confirmed') {
          var at = n.submittedAt || n.createdAt;
          if (at && (!ms.supply || String(at) < String(ms.supply))) ms.supply = at;
        }
      });
    }
    return ms;
  };

  function bindByMilestoneKey(ms) {
    var map = [
      ['register', '#tl-dt-reg, .reg-strip .rt-node:nth-child(1) .rt-date'],
      ['proMember', '#tl-dt-pro, .reg-strip .rt-node:nth-child(2) .rt-date'],
      ['cbamCalc', '#tl-dt-cbam, .reg-strip .rt-node:nth-child(3) .rt-date'],
      ['enterprise', '#tl-dt4'],
      ['supply', '#tl-dt5'],
      ['activation', '#tl-dt6'],
    ];
    map.forEach(function (pair) {
      var val = fmtTime(ms[pair[0]], 'md');
      document.querySelectorAll(pair[1]).forEach(function (el) { el.textContent = val; });
    });
    document.querySelectorAll('[data-milestone], .dyn-milestone-time').forEach(function (el) {
      var key = el.getAttribute('data-milestone');
      if (key && ms[key] != null) {
        el.textContent = fmtTime(ms[key], el.getAttribute('data-time-fmt') || 'md');
      }
    });
  }

  function bindIndexedTimes(selector, times, mode) {
    document.querySelectorAll(selector).forEach(function (el, i) {
      el.textContent = times[i] != null ? fmtTime(times[i], mode || 'mdhm') : '—';
    });
  }

  function bindGmLedgerRows(ledger) {
    var items = document.querySelectorAll('.tx-list .tx-item');
    if (!items.length) return;
    if (!ledger || !ledger.length) {
      items.forEach(function (row, i) {
        if (i === 0) {
          row.style.display = '';
          var t0 = row.querySelector('.tx-title');
          var tm0 = row.querySelector('.tx-time');
          if (t0) t0.textContent = '暂无记录';
          if (tm0) tm0.textContent = '—';
        } else {
          row.style.display = 'none';
        }
      });
      return;
    }
    items.forEach(function (row) { row.style.display = ''; });
    (ledger || []).forEach(function (rec, i) {
      if (!items[i]) return;
      var timeEl = items[i].querySelector('.tx-time');
      if (timeEl) timeEl.textContent = rec ? fmtTime(rec.createdAt, 'mdhm') : '—';
      if (!rec) return;
      var titleEl = items[i].querySelector('.tx-title');
      if (titleEl && rec.title) titleEl.textContent = rec.title;
      var valEl = items[i].querySelector('.tx-val');
      if (valEl && rec.amount != null) {
        var n = Number(rec.amount);
        valEl.textContent = (n >= 0 ? '+' : '') + n + ' GM';
      }
    });
  }

  function inferComputePill(rec) {
    var ref = String(rec.sourceRef || rec.source_ref || '').toLowerCase();
    var blob = (ref + ' ' + String(rec.title || '') + ' ' + String(rec.memo || '')).toLowerCase();
    if (blob.indexOf('regulation') >= 0 || blob.indexOf('阅读法规') >= 0 || blob.indexOf('read_kb') >= 0) {
      return { label: 'READ_KB', cls: 'pl-gray' };
    }
    if (blob.indexOf('supplier') >= 0 || blob.indexOf('供应商') >= 0 || blob.indexOf('invite') >= 0) {
      return { label: 'INVITE_SUPPLIER', cls: 'pl-y' };
    }
    if (blob.indexOf('cbam') >= 0 || blob.indexOf('测算') >= 0 || blob.indexOf('report') >= 0) {
      return { label: 'GENERATE_CFO_REPORT', cls: 'pl-g' };
    }
    if (blob.indexOf('workspace') >= 0 || blob.indexOf('档案') >= 0 || blob.indexOf('bill') >= 0 || blob.indexOf('energy') >= 0) {
      return { label: 'UPLOAD_BILL', cls: 'pl-b' };
    }
    if (blob.indexOf('decision') >= 0 || blob.indexOf('决策') >= 0) {
      return { label: 'GENERATE_CFO_REPORT', cls: 'pl-p' };
    }
    if (blob.indexOf('dld') >= 0) return { label: 'DLD_APPLY', cls: 'pl-b' };
    return { label: 'ACTION', cls: 'pl-gray' };
  }

  function buildComputeLedgerEntries(p) {
    var seen = {};
    var rows = [];
    function push(row) {
      if (!row || !row.at) return;
      var key = String(row.at) + '|' + String(row.title || '');
      if (seen[key]) return;
      seen[key] = true;
      rows.push(row);
    }
    (p.gmLedger || []).forEach(function (g) {
      push({
        at: g.createdAt,
        title: g.title || g.memo || 'GM 流水',
        memo: g.memo,
        gm: g.amount,
        sourceRef: g.sourceRef || g.source_ref,
      });
    });
    (p.activityTimeline || []).forEach(function (a) {
      push({
        at: a.at,
        title: a.title || '系统动作',
        gm: a.gm != null ? a.gm : a.amount,
        type: a.type,
      });
    });
    rows.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    return rows.slice(0, 20);
  }

  var LEDGER_FOLD_KEY = 'hengai_compute_ledger_fold';

  function ledgerFoldPref() {
    try { return localStorage.getItem(LEDGER_FOLD_KEY); } catch (_) { return null; }
  }

  function setLedgerFoldPref(collapsed) {
    try { localStorage.setItem(LEDGER_FOLD_KEY, collapsed ? '1' : '0'); } catch (_) {}
  }

  function syncComputeLedgerFold(rows) {
    var fold = document.getElementById('compute-ledger-fold');
    var summary = document.getElementById('compute-ledger-summary');
    var hint = document.getElementById('compute-ledger-hint');
    var toggle = document.getElementById('compute-ledger-toggle');
    if (!fold) return;
    var n = (rows && rows.length) || 0;
    var pref = ledgerFoldPref();
    var collapsed;
    if (pref === '1') collapsed = true;
    else if (pref === '0') collapsed = false;
    else collapsed = n > 5;
    if (summary) {
      if (!n) {
        summary.textContent = '暂无流水';
      } else {
        var latest = rows[0];
        var weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        var gm7 = 0;
        rows.forEach(function (r) {
          var t = new Date(r.at).getTime();
          if (!Number.isNaN(t) && t >= weekAgo) gm7 += Number(r.gm) || 0;
        });
        var gmStr = gm7 !== 0 ? ' · 近7日 ' + (gm7 > 0 ? '+' : '') + Math.round(gm7) + ' GM' : '';
        summary.textContent = n + ' 条 · 最新 ' + fmtTime(latest.at, 'mdhm') + gmStr;
      }
    }
    if (hint) hint.textContent = collapsed ? '点击展开明细' : '收起明细';
    fold.classList.toggle('collapsed', collapsed);
    if (toggle) toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  function initComputeLedgerFoldToggle() {
    if (W.__ledgerFoldInit) return;
    W.__ledgerFoldInit = true;
    var toggle = document.getElementById('compute-ledger-toggle');
    var fold = document.getElementById('compute-ledger-fold');
    var hint = document.getElementById('compute-ledger-hint');
    if (!toggle || !fold) return;
    toggle.addEventListener('click', function () {
      var collapsed = !fold.classList.contains('collapsed');
      fold.classList.toggle('collapsed', collapsed);
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      if (hint) hint.textContent = collapsed ? '点击展开明细' : '收起明细';
      setLedgerFoldPref(collapsed);
    });
  }

  function bindComputeActionLedger(p) {
    initComputeLedgerFoldToggle();
    var root = document.getElementById('compute-action-ledger');
    if (!root) return;
    var rows = buildComputeLedgerEntries(p);
    if (!rows.length) {
      root.innerHTML =
        '<div class="log-empty" style="padding:14px 6px;font-size:12px;color:var(--ink3)">' +
        '暂无算力流水。完成 CBAM 测算、法规阅读、供应商邀请等操作后，将按真实时间记入此处。' +
        '</div>';
      syncComputeLedgerFold(rows);
      return;
    }
    var html = '';
    rows.forEach(function (rec) {
      var pill = inferComputePill(rec);
      var gmNum = Number(rec.gm);
      var gmHtml = Number.isFinite(gmNum) && gmNum !== 0
        ? '<div class="log-save ' + (gmNum > 0 ? 'pos' : '') + '">' + (gmNum > 0 ? '+' : '') + Math.round(gmNum) + ' GM</div>'
        : '';
      var desc = rec.memo && rec.memo !== rec.title
        ? '<div class="log-desc">' + escHtml(rec.memo) + '</div>'
        : '<div class="log-desc">已记入绿印行为流水 · Co2Lion 全域底座</div>';
      html +=
        '<div class="log-item">' +
          '<div class="log-ic" style="background:var(--teal-d);border:1px solid rgba(29,158,117,0.3)"></div>' +
          '<div class="log-body">' +
            '<div class="log-title">' + escHtml(rec.title) + '<span class="pill ' + pill.cls + '">' + escHtml(pill.label) + '</span></div>' +
            desc +
          '</div>' +
          '<div class="log-right">' +
            '<div class="log-cost" style="color:var(--ink3)">—</div>' +
            gmHtml +
            '<div class="log-time">' + escHtml(fmtTime(rec.at, 'mdhm')) + '</div>' +
          '</div>' +
        '</div>';
    });
    root.innerHTML = html;
    syncComputeLedgerFold(rows);
  }

  W.syncComputeLedgerFold = syncComputeLedgerFold;
  W.buildComputeLedgerEntries = buildComputeLedgerEntries;
  W.bindComputeActionLedger = bindComputeActionLedger;

  function bindComputeHeroMetrics(p) {
    var u = p.user || {};
    var co = p.compute || {};
    var used = Number(co.tokensUsed != null ? co.tokensUsed : u.tokensUsed || 0);
    var left = Number(co.tokensLeft != null ? co.tokensLeft : u.tokensLeft || 0);
    var total = used + left;
    var pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
    var reports = (p.recentReports || []).length;
    document.querySelectorAll('.dyn-token-used,[data-bind="tokensUsed"]').forEach(function (el) {
      el.textContent = used.toLocaleString();
    });
    var calcRow = document.querySelector('.vh-compare .vc-row:nth-child(2) .vc-val');
    if (calcRow) calcRow.textContent = reports + ' / 100';
    var repRow = document.querySelector('.vh-compare .vc-row:nth-child(3) .vc-val');
    if (repRow) repRow.textContent = reports + ' 份';
    var pctRow = document.querySelector('.vh-compare .vc-row:nth-child(4) .vc-val');
    if (pctRow) pctRow.textContent = pct + '%';
    var gmKpi = document.querySelector('.vh-kpi-val.gold');
    if (gmKpi && u.gmBalance != null) {
      var gm = Number(u.gmBalance);
      if (Number.isFinite(gm)) gmKpi.innerHTML = Math.round(gm) + '<span class="vh-kpi-unit">GM</span>';
    }
  }

  function bindActivityLog(activity, compute) {
    var items = document.querySelectorAll('.log-list .log-item');
    if (document.getElementById('compute-action-ledger')) return;
    if (items.length && activity && activity.length) {
      activity.forEach(function (rec, i) {
        if (!items[i]) return;
        var timeEl = items[i].querySelector('.log-time');
        if (timeEl) timeEl.textContent = fmtTime(rec.at, 'mdhm');
      });
    }
    if (compute) {
      document.querySelectorAll('[data-bind="tokensUsed"]').forEach(function (el) {
        el.textContent = Number(compute.tokensUsed || 0).toLocaleString();
      });
      document.querySelectorAll('[data-bind="tokensLeft"]').forEach(function (el) {
        el.textContent = Number(compute.tokensLeft || 0).toLocaleString();
      });
      document.querySelectorAll('[data-bind="computeSync"]').forEach(function (el) {
        el.textContent = fmtTime(compute.lastSyncAt, 'dt');
      });
    }
  }

  function bindBadges(badges) {
    var dates = (badges || []).map(function (b) { return b.awardedAt; });
    bindIndexedTimes('.badge-date', dates, 'dt');
    bindIndexedTimes('.medal-date', dates, 'dt');
    bindIndexedTimes('.cert-date:not(.dyn-cert-date)', dates, 'dt');
  }

  function bindGmEvents(ms, ledger) {
    var evTimes = document.querySelectorAll('.gm-ev-time');
    if (!evTimes.length) return;
    var keys = ['register', 'proMember', 'cbamCalc'];
    evTimes.forEach(function (el, i) {
      var at = (ms && ms[keys[i]]) || (ledger[i] && ledger[i].createdAt);
      var target = el.querySelector('span') || el;
      target.textContent = fmtTime(at, 'md');
    });
  }

  function bindCustomsReports(reports) {
    var tbody = document.querySelector('.decl-table tbody');
    if (!tbody || !reports || !reports.length) return;
    var rows = tbody.querySelectorAll('tr');
    reports.forEach(function (rep, i) {
      if (!rows[i] || !rows[i].cells[0]) return;
      var period = rep.reportingPeriod || rep.reporting_period || ('报告 ' + (i + 1));
      var at = rep.submittedAt || rep.createdAt;
      rows[i].cells[0].innerHTML =
        '<div style="font-weight:500">' + period + '</div>' +
        '<div style="font-size:10.5px;color:var(--ink3)">' + fmtTime(at, 'dt') + ' 提交</motion div>'.replace('</motion div>', '</div>');
    });
  }

  function periodLabel(rep) {
    return rep.reportingPeriod || rep.reporting_period || '批次';
  }

  function bindDldFromReports(reports) {
    var card = document.querySelector('#dld-certified-co2');
    if (!card) return;
    var tbody = card.closest('.card');
    tbody = tbody ? tbody.querySelector('table tbody') : document.querySelector('table tbody');
    if (!tbody || !reports || !reports.length) return;
    var rows = tbody.querySelectorAll('tr');
    reports.forEach(function (rep, i) {
      if (!rows[i] || !rows[i].cells[0]) return;
      var at = rep.submittedAt || rep.createdAt;
      var label = 'DLD-' + String(periodLabel(rep)).replace(/\s/g, '');
      rows[i].cells[0].innerHTML =
        '<div style="font-weight:500">' + label + '</div>' +
        '<div style="font-size:10.5px;color:var(--ink3)">' + fmtTime(at, 'dt') + ' 确权</div>';
    });
  }

  function bindDiagDates(reports, ms) {
    var at = (reports[0] && (reports[0].submittedAt || reports[0].createdAt)) || ms.cbamCalc;
    var show = fmtTime(at, 'dt');
    document.querySelectorAll('.dyn-diag-date, [data-bind="diagDate"]').forEach(function (el) {
      el.textContent = show;
    });
  }

  function bindKnowledgeMacro(macro) {
    if (!macro) return;
    var at = macro.last_updated || macro.lastUpdated;
    document.querySelectorAll('.dyn-law-updated, [data-bind="lawUpdated"]').forEach(function (el) {
      el.textContent = at ? ('法规库更新 · ' + fmtTime(at, 'dt')) : '法规库 · 运营发布中';
    });
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function inferAchieveEntryMeta(rec) {
    var blob = ((rec.title || '') + ' ' + (rec.memo || '') + ' ' + (rec.type || '')).toLowerCase();
    if (rec.type === 'cbam' || blob.indexOf('cbam') >= 0 || blob.indexOf('测算') >= 0) {
      return { dotBg: 'var(--gold-d)', dotBorder: 'var(--gold)', gmColor: 'var(--gold-l)', tag: 'CBAM', tagClass: 'pl-y' };
    }
    if (rec.type === 'supply' || blob.indexOf('供应商') >= 0 || blob.indexOf('supplier') >= 0) {
      return { dotBg: 'var(--green-d)', dotBorder: 'var(--green)', gmColor: 'var(--green-l)', tag: '供应链', tagClass: 'pl-g' };
    }
    if (rec.type === 'badge' || blob.indexOf('徽章') >= 0) {
      return { dotBg: 'var(--purple-d)', dotBorder: 'var(--purple-l)', gmColor: 'var(--purple-l)', tag: '徽章', tagClass: 'pl-p' };
    }
    if (blob.indexOf('法规') >= 0 || blob.indexOf('regulation') >= 0 || blob.indexOf('阅读') >= 0) {
      return { dotBg: 'var(--teal-d)', dotBorder: 'var(--teal)', gmColor: 'var(--teal-l)', tag: '法规阅读', tagClass: 'pl-t' };
    }
    if (blob.indexOf('档案') >= 0 || blob.indexOf('workspace') >= 0 || blob.indexOf('企业') >= 0) {
      return { dotBg: 'var(--blue-d)', dotBorder: 'var(--blue-l)', gmColor: 'var(--blue-l)', tag: '企业档案', tagClass: 'pl-b' };
    }
    if (rec.type === 'auth' || blob.indexOf('登录') >= 0 || blob.indexOf('注册') >= 0) {
      return { dotBg: 'var(--teal-d)', dotBorder: 'var(--teal)', gmColor: 'var(--teal-l)', tag: '账户', tagClass: 'pl-t' };
    }
    return { dotBg: 'rgba(255,255,255,0.06)', dotBorder: 'var(--ink2)', gmColor: 'var(--ink2)', tag: '行动', tagClass: 'pl-gray' };
  }

  function buildAchieveTimelineEntries(p) {
    var seen = {};
    var entries = [];
    function push(entry) {
      if (!entry || !entry.at) return;
      var key = String(entry.at) + '|' + String(entry.title || '');
      if (seen[key]) return;
      seen[key] = true;
      entries.push(entry);
    }
    (p.activityTimeline || []).forEach(function (a) {
      push({
        at: a.at,
        title: a.title || '系统动作',
        gm: a.gm != null ? a.gm : a.amount,
        type: a.type || 'activity',
      });
    });
    (p.gmLedger || []).forEach(function (g) {
      push({
        at: g.createdAt,
        title: g.title || g.memo || 'GM 流水',
        memo: g.memo,
        gm: g.amount,
        type: 'gm',
      });
    });
    (p.recentReports || []).forEach(function (r) {
      push({
        at: r.submittedAt || r.createdAt,
        title: 'CBAM 测算 · ' + (r.reportingPeriod || r.reporting_period || '报告'),
        type: 'cbam',
      });
    });
    (p.supplierNodes || []).forEach(function (n) {
      var st = String((n && n.status) || '').toLowerCase();
      if (st === 'submitted' || st === 'confirmed') {
        push({
          at: n.submittedAt || n.createdAt,
          title: '供应商填报 · ' + (n.supplierName || n.name || '节点'),
          type: 'supply',
        });
      } else if (st === 'invited') {
        push({
          at: n.createdAt,
          title: '签发穿透邀请 · ' + (n.supplierName || n.name || '节点'),
          type: 'supply',
        });
      }
    });
    (p.badges || []).forEach(function (b) {
      push({
        at: b.awardedAt || b.createdAt,
        title: '徽章解锁 · ' + (b.name || b.title || b.badgeName || '成就'),
        type: 'badge',
      });
    });
    var regReads = (p.regulation && p.regulation.reads) || [];
    regReads.forEach(function (rr) {
      push({
        at: rr.readAt || rr.read_at,
        title: '阅读法规 · ' + (rr.title || rr.regulationId || ''),
        gm: rr.gmEarned || rr.gm_earned,
        type: 'regulation',
      });
    });
    var ms = p.milestones || W.buildMilestonesFromState(p);
    if (ms.register) push({ at: ms.register, title: '注册 HengAI · 旅程起点', type: 'auth' });
    entries.sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    return entries.slice(0, 30);
  }

  function monthLabelFromIso(iso) {
    try {
      var d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '待记录';
      return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
    } catch (_) {
      return '待记录';
    }
  }

  function bindAchieveActionTimeline(p) {
    var root = document.getElementById('achieve-action-timeline');
    if (!root) return;
    var entries = buildAchieveTimelineEntries(p);
    var countEl = document.getElementById('achieve-timeline-count');
    if (countEl) {
      countEl.textContent = entries.length
        ? ('全部 ' + entries.length + ' 条记录')
        : '暂无行动记录';
    }
    if (!entries.length) {
      var hint = root.getAttribute('data-empty-hint') || '暂无行动记录';
      root.innerHTML = '<div class="tl-empty" style="padding:12px 4px;font-size:12px;color:var(--ink3)">' + escHtml(hint) + '</div>';
      return;
    }
    var groups = [];
    var groupMap = {};
    entries.forEach(function (rec) {
      var ml = monthLabelFromIso(rec.at);
      if (!groupMap[ml]) {
        groupMap[ml] = { label: ml, items: [] };
        groups.push(groupMap[ml]);
      }
      groupMap[ml].items.push(rec);
    });
    var html = '';
    groups.forEach(function (grp) {
      html += '<div class="tl-month">' + escHtml(grp.label) + '</div><div class="tl-items">';
      grp.items.forEach(function (rec, idx) {
        var meta = inferAchieveEntryMeta(rec);
        var gmNum = Number(rec.gm);
        var gmLine = '';
        if (Number.isFinite(gmNum) && gmNum !== 0) {
          gmLine = '<div class="tl-gm" style="color:' + meta.gmColor + '">+' + Math.abs(Math.round(gmNum)) + ' GM</div>';
        }
        var desc = rec.memo && rec.memo !== rec.title
          ? '<div class="tl-desc">' + escHtml(rec.memo) + '</div>'
          : '';
        var pb = idx === grp.items.length - 1 ? ' style="padding-bottom:0"' : '';
        html +=
          '<div class="tl-item"' + pb + '>' +
            '<div class="tl-dot" style="background:' + meta.dotBg + ';border:1.5px solid ' + meta.dotBorder + '"></div>' +
            '<div class="tl-body">' +
              '<div class="tl-head">' +
                '<span class="tl-action">' + escHtml(rec.title) + '</span>' +
                '<span class="tl-time">' + escHtml(fmtTime(rec.at, 'mdhm')) + '</span>' +
              '</div>' + desc + gmLine +
              '<div class="tl-tags"><span class="tl-tag ' + meta.tagClass + '">' + escHtml(meta.tag) + '</span></div>' +
            '</div></div>';
      });
      html += '</div>';
    });
    root.innerHTML = html;
  }

  W.buildAchieveTimelineEntries = buildAchieveTimelineEntries;
  W.bindAchieveActionTimeline = bindAchieveActionTimeline;

  W.hengaiBindTimelinesFromPayload = function hengaiBindTimelinesFromPayload(p) {
    if (!p) return;
    var ms = Object.assign({}, W.buildMilestonesFromState(p), p.milestones || {});
    var ledger = p.gmLedger || [];
    var activity = p.activityTimeline || [];
    var badges = p.badges || [];
    var reports = p.recentReports || [];

    bindByMilestoneKey(ms);
    bindGmLedgerRows(ledger);
    bindActivityLog(activity, p.compute);
    bindBadges(badges);
    bindGmEvents(ms, ledger);
    bindCustomsReports(reports);
    bindDldFromReports(reports);
    bindDiagDates(reports, ms);
    bindKnowledgeMacro(p.macro);
    bindAchieveActionTimeline(p);
    bindComputeActionLedger(p);
    bindComputeHeroMetrics(p);

    document.querySelectorAll('.dyn-timeline-time').forEach(function (el, i) {
      var rec = activity[i] || ledger[i];
      var at = rec && (rec.at || rec.createdAt);
      if (at) el.textContent = fmtTime(at, el.getAttribute('data-time-fmt') || 'mdhm');
    });
  };

  W.applyHubMilestonesToDom = function applyHubMilestonesToDom(state) {
    var s = state || W.AppState;
    if (!s) return;
    var payload = typeof W.buildHubPipelinePayload === 'function'
      ? W.buildHubPipelinePayload(s)
      : s;
    W.hengaiBindTimelinesFromPayload(payload);
  };
})(window);
