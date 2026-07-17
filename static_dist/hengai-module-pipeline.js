/**
 * HengAI 模块管道标准层（批次 5）
 * 统一：merge AppState · 注册/会员 · 企业名 · 财务 dyn-rep-* / dyn-sup-*
 */
(function (W) {
  'use strict';
  if (W.__hengaiModulePipeline) return;
  W.__hengaiModulePipeline = true;

  function parentWin() {
    try {
      if (W.parent && W.parent !== W) return W.parent;
    } catch (_) {}
    return null;
  }

  function rootApi() {
    return parentWin() || W;
  }

  W.mergePipelineIntoAppState = function mergePipelineIntoAppState(p) {
    if (!p || !W.AppState) return;
    if (p.user) Object.assign(W.AppState.user || (W.AppState.user = {}), p.user);
    if (p.company) {
      var cur = W.AppState.company || (W.AppState.company = {});
      var incoming = p.company;
      var curSt = String(cur.sovereigntyClaimStatus || cur.sovereignty_claim_status || '').toLowerCase();
      var incSt = String(incoming.sovereigntyClaimStatus || incoming.sovereignty_claim_status || '').toLowerCase();
      if ((curSt === 'pending' || curSt === 'approved') && (!incSt || incSt === 'none')) {
        var keep = {
          sovereigntyClaimStatus: cur.sovereigntyClaimStatus || cur.sovereignty_claim_status,
          sovereignty_claim_status: cur.sovereignty_claim_status || cur.sovereigntyClaimStatus,
          sovereigntyClaimSubmittedAt: cur.sovereigntyClaimSubmittedAt || cur.sovereignty_claim_submitted_at,
          sovereigntyAuthLetterFilename: cur.sovereigntyAuthLetterFilename || cur.sovereignty_auth_letter_filename,
        };
        Object.assign(cur, incoming, keep);
      } else {
        Object.assign(cur, incoming);
      }
    }
    if (p.metrics) Object.assign(W.AppState.metrics || (W.AppState.metrics = {}), p.metrics);
    if (p.impact) W.AppState.impact = Object.assign(W.AppState.impact || {}, p.impact);
    if (p.wallet) Object.assign(W.AppState.wallet || (W.AppState.wallet = {}), p.wallet);
    if (p.flags) Object.assign(W.AppState.flags || (W.AppState.flags = {}), p.flags);
    if (p.resonance) Object.assign(W.AppState.resonance || (W.AppState.resonance = {}), p.resonance);
    if (p.industryAudit) Object.assign(W.AppState.industryAudit || (W.AppState.industryAudit = {}), p.industryAudit);
    if (p.factorAuth && typeof p.factorAuth === 'object') {
      var fa = W.AppState.factorAuth || (W.AppState.factorAuth = {});
      var incoming = p.factorAuth;
      var pooled = incoming.pooledByIndustry && typeof incoming.pooledByIndustry === 'object'
        ? Object.assign({}, fa.pooledByIndustry || {}, incoming.pooledByIndustry)
        : fa.pooledByIndustry;
      Object.assign(fa, incoming);
      if (pooled) fa.pooledByIndustry = pooled;
    }
    if (typeof W.syncFactorAuthResonanceFromMetrics === 'function') {
      try { W.syncFactorAuthResonanceFromMetrics(W.AppState); } catch (_) {}
    }
  };

  W.hengaiApplyStandardPipeline = function hengaiApplyStandardPipeline(p) {
    if (!p) return null;
    const root = rootApi();
    if (W.AppState) W.mergePipelineIntoAppState(p);

    const u = p.user || (W.AppState && W.AppState.user) || {};
    const co = p.company || (W.AppState && W.AppState.company) || {};
    let ident = null;
    if (typeof root.formatHubUserIdentity === 'function') {
      ident = root.formatHubUserIdentity(u);
      if (W.AppState && W.AppState.user) {
        Object.assign(W.AppState.user, {
          tier_code: ident.tierCode,
          tier: ident.tierLabel,
          tierLabel: ident.tierLabel,
          regDate: ident.regDate || W.AppState.user.regDate,
          regLabel: ident.regLabel,
        });
      }
    }

    const regMatch = u.regLabel ? String(u.regLabel).match(/\d{4}-\d{2}-\d{2}/) : null;
    const regDisplay = (ident && ident.regDate)
      || u.regDate
      || (regMatch ? regMatch[0] : null)
      || '—';
    const tierDisplay = (ident && ident.tierLabel) || u.tierLabel || u.tier || u.tier_code || '—';
    const userName = u.name || '';

    if (userName) {
      document.querySelectorAll('.dyn-user-name').forEach((el) => { el.textContent = userName; });
    }
    document.querySelectorAll('.dyn-user-reg-date').forEach((el) => { el.textContent = regDisplay; });
    document.querySelectorAll('.dyn-user-tier').forEach((el) => { el.textContent = tierDisplay; });
    const sbRole = document.getElementById('sb-urole');
    if (sbRole && tierDisplay !== '—') sbRole.textContent = tierDisplay;

    const coName = String(co.name || '').trim();
    if (coName) {
      document.querySelectorAll('.dyn-ent-name, .dyn-company-name').forEach((el) => {
        el.textContent = coName;
      });
      const fc = document.getElementById('f-company');
      if (fc && !fc.dataset.userEdited) fc.value = coName;
    }
    const metrics = p.metrics || (W.AppState && W.AppState.metrics) || {};
    const stageLbl = typeof root.resolveCompanyStageLabel === 'function'
      ? root.resolveCompanyStageLabel(co, metrics, p.cbam || (W.AppState && W.AppState.cbam))
      : (co.stageLabel || co.stage_label || '待激活');
    document.querySelectorAll('.dyn-ent-stage-label').forEach((el) => { el.textContent = stageLbl; });

    let fin = null;
    const st = typeof root.stateFromHubPipeline === 'function'
      ? root.stateFromHubPipeline(p, root.AppState || W.AppState)
      : (W.AppState || p);
    if (typeof root.computeRepFinancials === 'function' && st) {
      try {
        fin = root.computeRepFinancials(st);
        document.querySelectorAll('.dyn-rep-tax').forEach((el) => { el.textContent = fin.riskDisplay; });
        document.querySelectorAll('.dyn-rep-roi').forEach((el) => { el.textContent = fin.roiDisplay; });
        document.querySelectorAll('.dyn-rep-save').forEach((el) => { el.textContent = fin.netSavingsDisplay; });
        const m = st.metrics || {};
        const tot = Number(m.supplierCount != null ? m.supplierCount : 0);
        const covRaw = m.supplyChainCoverage != null ? m.supplyChainCoverage : m.scope3Coverage;
        let cov = Number(covRaw);
        if (!Number.isFinite(cov)) cov = 0;
        const pct = cov <= 1 && cov >= 0 ? cov * 100 : cov;
        const covStr = tot > 0 || pct > 0 ? pct.toFixed(1) + '%' : '—';
        document.querySelectorAll('.dyn-sup-pct, .dyn-supply-coverage').forEach((el) => {
          el.textContent = covStr;
        });
      } catch (e) {
        console.warn('[hengai-module-pipeline] computeRepFinancials', e);
      }
    }
    if (typeof W.applyFinancialsInDocument === 'function') {
      try { W.applyFinancialsInDocument(st); } catch (_) {}
    } else if (typeof root.applyRepFinancialsToDom === 'function') {
      try { root.applyRepFinancialsToDom(st); } catch (_) {}
    }
    if (document.getElementById('ent-cbam-risk') || document.getElementById('ent-forecast-2026-val')) {
      if (typeof root.applyEnterpriseFinancialsToDom === 'function') {
        try { root.applyEnterpriseFinancialsToDom(st, fin, document); } catch (e) {
          console.warn('[hengai-module-pipeline] applyEnterpriseFinancialsToDom', e);
        }
      }
    }
    if (document.getElementById('f-company') && typeof root.hydrateCbamFormFromCompany === 'function') {
      try { root.hydrateCbamFormFromCompany(st, document); } catch (e) {
        console.warn('[hengai-module-pipeline] hydrateCbamFormFromCompany', e);
      }
    }
    if (typeof W.hengaiBindTimelinesFromPayload === 'function') {
      try { W.hengaiBindTimelinesFromPayload(p); } catch (e) {
        console.warn('[hengai-module-pipeline] timeline bind', e);
      }
    }
    if (typeof W.refreshGmChip === 'function') {
      try { W.refreshGmChip(); } catch (_) {}
    }
    return fin;
  };

  W.applyHeavyIndustryPipeline = function applyHeavyIndustryPipeline(p) {
    if (!p || !document.getElementById('hi-suite')) return;
    if (p.industryAudit && W.AppState) {
      W.AppState.industryAudit = Object.assign(W.AppState.industryAudit || {}, p.industryAudit);
    }
    if (p.resonance && W.AppState) {
      W.AppState.resonance = Object.assign(W.AppState.resonance || {}, p.resonance);
    }
    if (p.company) {
      var vc = p.company.verificationCode || p.company.verification_code;
      if (vc) {
        var codeEl = document.getElementById('hi-verification-code');
        if (codeEl) codeEl.textContent = vc;
      }
    }
    if (typeof W.paintSupplyResonancePanel === 'function') {
      try { W.paintSupplyResonancePanel(W.AppState); } catch (_) {}
    }
    if (typeof W.refreshResonanceHeader === 'function') {
      try { W.refreshResonanceHeader(); } catch (_) {}
    } else if (typeof W.updateResonanceDashboard === 'function') {
      try { W.updateResonanceDashboard(); } catch (_) {}
    }
    if (typeof W.guardOriginFactoryPage === 'function') {
      try { W.guardOriginFactoryPage(); } catch (_) {}
    }
  };

  W.HENGAI_MODULE_PIPELINE_HANDLERS = W.HENGAI_MODULE_PIPELINE_HANDLERS || [
    'applyReportPipeline',
    'applyEnterprisePipeline',
    'applyDecisionPipeline',
    'applySupplyPipeline',
    'applyKnowledgePipeline',
    'applyHonorPipeline',
    'applyAchievePipeline',
    'applyComputePipeline',
    'applyGovPipeline',
    'applyWalletPipeline',
    'applyEuPipeline',
    'applyDldPipeline',
    'applyAcfPipeline',
    'applySupplierH5Pipeline',
    'applyHeavyIndustryPipeline',
    'applyFactorAuthPipeline',
  ];

  W.dispatchHengaiModulePipelines = function dispatchHengaiModulePipelines(p) {
    if (!p) return;
    W.hengaiApplyStandardPipeline(p);
    (W.HENGAI_MODULE_PIPELINE_HANDLERS || []).forEach((name) => {
      if (typeof W[name] !== 'function') return;
      try {
        W[name](p);
      } catch (e) {
        console.warn('[hengai-pipeline]', name, e);
      }
    });
  };

  /** iframe 内安全刷新 GM 芯片（算力页等未加载完整脚本时静默跳过） */
  W.refreshGmChip = W.refreshGmChip || function refreshGmChipFallback() {
    try {
      const p = parentWin();
      const st = (p && p.AppState) || W.AppState;
      const gm = st && st.user
        ? Number(st.user.gmBalance != null ? st.user.gmBalance : st.user.gm_balance)
        : NaN;
      if (!Number.isFinite(gm)) return;
      const el = document.getElementById('gm-val');
      if (el) el.textContent = String(Math.max(0, Math.round(gm)));
      document.querySelectorAll('.gm-chip-val').forEach((node) => {
        node.textContent = gm.toLocaleString();
      });
    } catch (_) {}
  };
})(window);
