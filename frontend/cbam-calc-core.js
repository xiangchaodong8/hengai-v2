/**
 * HengAI CBAM 粗测 · 唯一测算内核（所有入口必须加载本文件）
 * 含：Scope3 原料联动、敏感性预览、runCalc、AppState 同步与落库
 */
(function (global) {
  'use strict';

  var SCOPE3_MATERIAL_MAP = {
    aluminum: [
      { label: '中铝集团 · 河南产铝锭 (碳因子 11.2)', value: 11.2 },
      { label: '云南水电铝 (碳因子 4.1) ★ 低碳', value: 4.1 },
      { label: '再生铝 (碳因子 1.5 - 3.5)', value: 2.2 },
      { label: 'LME 进口铝锭均值', value: 6.8 },
    ],
    steel: [
      { label: '高炉生铁 (河北/唐山主流 碳因子 2.1)', value: 2.1 },
      { label: '电炉废钢 (低碳工艺 碳因子 0.4 - 0.8)', value: 0.6 },
      { label: '进口铁矿石初加工 (碳因子 1.8)', value: 1.8 },
    ],
    cement: [
      { label: '普通熟料 (碳因子 0.85)', value: 0.85 },
      { label: '低碳环保熟料 (添加剂比例高 碳因子 0.6)', value: 0.6 },
    ],
    fertilizer: [
      { label: '天然气制氨 (碳因子 2.1)', value: 2.1 },
      { label: '煤制氨 (高碳 碳因子 3.8)', value: 3.8 },
    ],
  };

  var SCOPE3_MATERIAL_HINT = {
    aluminum: '铝冶炼上游以电解铝/铝锭为主，因子差异大。优先选用水电铝或再生铝可显著压低 Scope 3。',
    steel: '钢铁上游以生铁、废钢与矿石路线为主；电炉废钢路线通常显著低于高炉路线。',
    cement: '水泥上游以熟料为主；低碳熟料或替代组分可降低熟料因子。',
    fertilizer: '化肥上游以合成氨为主；天然气制氨通常低于煤制氨。',
    automotive: '汽车组装：车身钢 / 压铸铝 / LFP 电池 / 工程塑料为主要 Scope 3 来源；切换原料可模拟不同供应链路径。',
    machinery: '机械装备：铸铁件、特种合金钢与锻件为典型上游；因子随冶炼路线差异显著。',
    electronics: '电子电器：PCB（按㎡）、铜材（按吨）与芯片组件（按件）为常见采购口径。',
  };

  var CHINA_DEFAULT_SAFETY_MARGIN = 1.2;
  var MAT_UNIT_LABELS = {
    t: '吨 / 年',
    kWh: 'kWh / 年',
    sqm: '㎡ / 年',
    unit: '件 / 年',
  };
  var MAT_INTENSITY_UNIT = {
    t: 'tCO2e/t',
    kWh: 'tCO2e/kWh',
    sqm: 'tCO2e/sqm',
    unit: 'tCO2e/unit',
  };
  var PRODUCT_TO_INDUSTRY = {
    steel: 'steel',
    aluminum: 'aluminum',
    cement: 'cement',
    fertilizer: 'fertilizer',
    automotive: 'steel',
    machinery: 'steel',
    electronics: 'aluminum',
  };

  function getAssemblyIndustryMap() {
    return global.ASSEMBLY_INDUSTRY_MAP || {};
  }

  function getChinaDefaultSafetyMargin() {
    var m = global.CHINA_DEFAULT_FACTOR_SAFETY_MARGIN;
    return Number.isFinite(m) && m > 0 ? m : CHINA_DEFAULT_SAFETY_MARGIN;
  }

  function getMaterialListForProduct(pv) {
    if (!pv) return null;
    var assembly = getAssemblyIndustryMap()[pv];
    if (assembly && assembly.length) return assembly;
    var base = SCOPE3_MATERIAL_MAP[pv];
    if (!base || !base.length) return null;
    return base.map(function (item) {
      return { label: item.label, value: item.value, unit: item.unit || 't' };
    });
  }

  function inferIndustryFromProduct(pv) {
    var key = (pv || '').trim().toLowerCase();
    return PRODUCT_TO_INDUSTRY[key] || 'steel';
  }

  function isUsingVerifiedMaterialFactor() {
    if (typeof global.getCbamVerifiedMaterialFactor === 'function') {
      var vf = global.getCbamVerifiedMaterialFactor();
      if (vf != null && Number.isFinite(vf)) return true;
    }
    return false;
  }

  function getSelectedMaterialOption() {
    var sel = el('f-material');
    if (!sel || sel.selectedIndex < 0) return null;
    return sel.options[sel.selectedIndex];
  }

  function resolveMaterialFactorFromSelect() {
    if (isUsingVerifiedMaterialFactor()) {
      return global.getCbamVerifiedMaterialFactor();
    }
    var opt = getSelectedMaterialOption();
    if (!opt) return 0;
    var base = parseFloat(opt.getAttribute('data-factor') || opt.value);
    if (!Number.isFinite(base)) base = 0;
    if (opt.getAttribute('data-china-default') === '1') {
      base *= getChinaDefaultSafetyMargin();
    }
    return base;
  }

  function applyMaterialUnitFromSelect() {
    var opt = getSelectedMaterialOption();
    var unitEl = el('f-mat-vol-unit');
    var unit = (opt && opt.getAttribute('data-unit')) || 't';
    if (unitEl) unitEl.textContent = MAT_UNIT_LABELS[unit] || MAT_UNIT_LABELS.t;
    var volInp = el('f-mat-vol');
    if (volInp) {
      if (unit === 'kWh') volInp.placeholder = '例：120000';
      else if (unit === 'sqm') volInp.placeholder = '例：8500';
      else if (unit === 'unit') volInp.placeholder = '例：50000';
      else volInp.placeholder = '例：480';
    }
  }

  function triggerFactorRequestFromCbam() {
    var st = (typeof global.resolveWritableAppState === 'function' && global.resolveWritableAppState()) || global.AppState || {};
    var co = st.company || {};
    var productSel = el('f-product-type') || el('cbam-product-type');
    var industry = (productSel && productSel.value) || st.cbam && st.cbam.productType || 'steel';
    var companyName = co.name || (st.user && st.user.name) || '未知企业';
    var taxRisk = Number((st.metrics && st.metrics.riskExposureEur) || (st.impact && st.impact.riskExposureEur) || 0);
    var payload = {
      industry: industry,
      companyName: companyName,
      taxRisk: taxRisk,
      region: co.region || co.regionTag || '未知',
    };
    if (typeof global.emitAppStateEvent === 'function') global.emitAppStateEvent('FACTOR_REQUEST_SENT', payload);
    else if (global.EventBus && global.EventBus.emit) global.EventBus.emit('FACTOR_REQUEST_SENT', payload);
    if (st && typeof st.update === 'function') {
      var demands = (st.factorAuth && st.factorAuth.demands ? st.factorAuth.demands.slice() : []);
      demands.push({ name: companyName, industry: industry, region: payload.region, taxRisk: taxRisk });
      st.update('factorAuth.demands', demands);
      if (typeof st.save === 'function') st.save();
    }
    if (typeof global.navigateToHub === 'function') global.navigateToHub('factor-auth');
    else if (typeof global.navTo === 'function') {
      var nav = global.document && global.document.getElementById('nav-factor-auth');
      try { global.navTo('factor-auth', nav); } catch (_) {}
    }
    if (typeof global.showToast === 'function') {
      global.showToast('已向工业原厂因子池发起请求');
    }
  }

  function hideCbamPostCalcHints() {
    var banner = el('cbam-default-factor-warn');
    if (banner) banner.hidden = true;
    var note = el('cbam-result-scope-note');
    if (note) note.hidden = true;
    var cta = el('cbam-factor-request-cta');
    if (cta) cta.style.display = 'none';
    if (cta) cta.hidden = true;
    var footnotes = el('cbam-scope-data-footnotes');
    if (footnotes) footnotes.hidden = true;
  }

  function styleFactorRequestCta(cta) {
    if (!cta) return;
    cta.className = 'cbam-factor-request-link';
    cta.style.cssText = '';
  }

  function ensureFactorRequestCta() {
    var banner = el('cbam-default-factor-warn');
    if (!banner) return null;
    var host = el('cbam-scope-data-footnotes') || banner.parentNode;
    var cta = el('cbam-factor-request-cta');
    if (!cta) {
      cta = document.createElement('button');
      cta.id = 'cbam-factor-request-cta';
      cta.type = 'button';
      cta.textContent = '向工业原厂发起因子请求 →';
      cta.addEventListener('click', triggerFactorRequestFromCbam);
      host.appendChild(cta);
    }
    styleFactorRequestCta(cta);
    return cta;
  }

  /**
   * Step 4 脚注布局（① 功能层，与 funnel 无关）：
   * · cbam-result-scope-note → KPI Hero 下（报告定性）
   * · cbam-scope-data-footnotes → 紧接粗测声明、key-insight 上（Scope 3 单行说明 + 文字链，不侵入 Scope 双栏卡片）
   */
  function updateCbamDefaultFactorWarning(result) {
    var note = el('cbam-result-scope-note');
    if (!result) {
      hideCbamPostCalcHints();
      return;
    }
    if (note) note.hidden = false;

    var showDefault = false;
    if (result.usesChinaDefaultLibrary) showDefault = true;
    else if (!isUsingVerifiedMaterialFactor()) {
      var snap = getScope3MaterialSnapshot();
      showDefault = !!(snap && snap.usesChinaDefaultLibrary);
    }
    var footnotes = el('cbam-scope-data-footnotes');
    if (footnotes) footnotes.hidden = !showDefault;
    var banner = el('cbam-default-factor-warn');
    if (banner) banner.hidden = !showDefault;
    var cta = ensureFactorRequestCta();
    if (cta) {
      cta.hidden = !showDefault;
      cta.style.display = showDefault ? 'inline' : 'none';
      if (showDefault && banner && cta.previousSibling !== banner) {
        banner.parentNode.appendChild(cta);
      }
    }
  }

  /** 行业单位产品用电基准 (SEC) · kWh/t — 快速估算辅助卡片 */
  var INDUSTRY_ENERGY_BENCHMARKS = {
    aluminum: [
      { title: '铝压铸工艺参考', range: '250 – 350 kWh / 吨产品' },
      { title: '铝型材挤压参考', range: '180 – 250 kWh / 吨产品' },
    ],
    steel: [
      { title: '电弧炉(EAF)炼钢参考', range: '400 – 600 kWh / 吨产品' },
      { title: '热轧/冷轧精加工参考', range: '80 – 150 kWh / 吨产品' },
    ],
    cement: [
      { title: '水泥粉磨工序参考', range: '90 – 120 kWh / 吨产品' },
      { title: '熟料烧成综合电耗', range: '50 – 70 kWh / 吨产品' },
    ],
    fertilizer: [
      { title: '合成氨电耗参考', range: '500 – 800 kWh / 吨产品' },
      { title: '尿素造粒工序参考', range: '150 – 200 kWh / 吨产品' },
    ],
    automotive: [
      { title: '整车组装电耗参考', range: '800 – 1,200 kWh / 辆（折合吨当量）' },
      { title: '压铸工序参考', range: '250 – 350 kWh / 吨铝件' },
    ],
    machinery: [
      { title: '通用机械加工参考', range: '200 – 450 kWh / 吨产品' },
      { title: '重型锻件精加工', range: '120 – 280 kWh / 吨产品' },
    ],
    electronics: [
      { title: 'SMT 贴装线参考', range: '35 – 55 kWh / ㎡ PCB' },
      { title: '整机组装参考', range: '180 – 320 kWh / 吨成品' },
    ],
    electricity: [
      { title: '出口电力品类', range: '以出口 MWh 与电网排放因子核算为主' },
      { title: '绿电抵扣', range: '在「绿电证书(GEC)」栏填报抵扣电量' },
    ],
    hydrogen: [
      { title: '电解制氢电耗参考', range: '48 – 55 kWh / kg H₂（折合出口氢量）' },
      { title: '重整/副产氢', range: '按装置实测强度或行业缺省值' },
    ],
    default: [
      { title: '通用制造业参考', range: '200 – 400 kWh / 吨产品' },
      { title: '精加工工序参考', range: '100 – 300 kWh / 吨产品' },
    ],
  };

  function el(id) {
    return document.getElementById(id);
  }

  function num(id, fallback) {
    var node = el(id);
    var v = node ? parseFloat(node.value) : NaN;
    return Number.isFinite(v) ? v : fallback != null ? fallback : 0;
  }

  function fmtK(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return Math.round(n).toString();
  }

  function getMacroOracle() {
    if (typeof global.getMacroOracle === 'function') return global.getMacroOracle();
    var fb = { cbam_current_price: 75.36, eur_cny_rate: 7.85, last_updated: '2026-04-20' };
    if (!global.AppState) global.AppState = {};
    if (!global.AppState.macro) global.AppState.macro = Object.assign({}, fb);
    return global.AppState.macro;
  }

  function isScope3UpstreamExemptProduct(productValue) {
    return productValue === 'electricity' || productValue === 'hydrogen';
  }

  function renderEnergyHelperCard(item) {
    var card = document.createElement('div');
    card.style.cssText =
      'padding:9px 12px;background:rgba(0,0,0,0.25);border-radius:8px;border:1px solid rgba(255,255,255,0.07)';
    var titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:11px;color:rgba(138,149,168,0.95);margin-bottom:3px';
    titleEl.textContent = item.title;
    var rangeEl = document.createElement('div');
    rangeEl.style.cssText = 'font-size:12.5px;color:#e8edf5';
    rangeEl.innerHTML =
      '约 <strong style="color:var(--blue-l,#93c5fd)">' + item.range + '</strong>';
    card.appendChild(titleEl);
    card.appendChild(rangeEl);
    return card;
  }

  function updateEnergyHelper() {
    var container = el('energy-helper-container');
    if (!container) return;
    var pv = (el('f-product') || {}).value || '';
    var items;
    if (!pv) {
      items = [
        { title: '请先选择产品类别', range: '选定行业后将展示对应用电强度参考' },
        INDUSTRY_ENERGY_BENCHMARKS.default[0],
      ];
    } else {
      items = INDUSTRY_ENERGY_BENCHMARKS[pv] || INDUSTRY_ENERGY_BENCHMARKS.default;
    }
    container.innerHTML = '';
    items.forEach(function (item) {
      container.appendChild(renderEnergyHelperCard(item));
    });
    var formula = el('energy-helper-formula');
    if (formula) {
      formula.innerHTML =
        '年产量(t) × <strong style="color:var(--blue-l,#93c5fd)">行业参考值</strong> ≈ 年用电量';
    }
  }

  function getScope3MaterialSnapshot() {
    var pv = (el('f-product') || {}).value || '';
    var prodSel = el('f-product');
    var productLabel =
      prodSel && prodSel.selectedOptions && prodSel.selectedOptions[0]
        ? String(prodSel.selectedOptions[0].textContent || '').trim()
        : '';

    if (isScope3UpstreamExemptProduct(pv)) {
      return {
        exempt: true,
        matVol: 0,
        matFactor: 0,
        scope3MaterialLabel: '本项不适用（免核算）',
        scope3UpstreamExempt: true,
        mainProduct: pv,
        mainProductLabel: productLabel,
      };
    }

    var sel = el('f-material');
    var matVol = num('f-mat-vol', 0);
    var matFactor = 0;
    var scope3MaterialLabel = '';
    var materialUnit = 't';
    var opt = getSelectedMaterialOption();
    if (opt) materialUnit = opt.getAttribute('data-unit') || 't';
    var usesChinaDefault = !isUsingVerifiedMaterialFactor() && opt && opt.getAttribute('data-china-default') === '1';

    if (typeof global.getCbamVerifiedMaterialFactor === 'function') {
      var vf = global.getCbamVerifiedMaterialFactor();
      if (vf != null && Number.isFinite(vf)) {
        matFactor = vf;
        var vm = global.getCbamVerifiedPoolMatch && global.getCbamVerifiedPoolMatch();
        scope3MaterialLabel = vm && vm.originName
          ? '🟢 ' + vm.originName + ' · 官方确权 ' + vf.toFixed(4) + ' t/t'
          : '🟢 原厂官方确权因子 ' + vf.toFixed(4) + ' t/t';
        usesChinaDefault = false;
      }
    }
    if (!matFactor) {
      matFactor = resolveMaterialFactorFromSelect();
    }
    if (!scope3MaterialLabel && opt) {
      scope3MaterialLabel = String(opt.textContent || '').trim();
    }
    if (!matFactor) {
      var list = getMaterialListForProduct(pv);
      if (list && list.length) {
        usesChinaDefault = !isUsingVerifiedMaterialFactor();
        matFactor = list[0].value * (usesChinaDefault ? getChinaDefaultSafetyMargin() : 1);
        scope3MaterialLabel = list[0].label;
        materialUnit = list[0].unit || 't';
      }
    }

    return {
      exempt: false,
      matVol: matVol,
      matFactor: matFactor,
      scope3MaterialLabel: scope3MaterialLabel,
      scope3UpstreamExempt: false,
      scope3MaterialVolumeT: matVol,
      scope3MaterialVolume: matVol,
      scope3MaterialUnit: materialUnit,
      scope3MaterialVolumeUnit: materialUnit,
      scope3MaterialIntensityUnit: MAT_INTENSITY_UNIT[materialUnit] || 'tCO2e/t',
      usesChinaDefaultLibrary: usesChinaDefault,
      chinaDefaultSafetyMargin: usesChinaDefault ? getChinaDefaultSafetyMargin() : 1,
      mainProduct: pv,
      mainProductLabel: productLabel,
    };
  }

  function rebuildMaterialOptionsForProduct() {
    var pv = (el('f-product') || {}).value || '';
    var sel = el('f-material');
    var hint = el('h-mat');
    var na = el('scope3-na-notice');
    var ctr = el('scope3-material-controls');
    var matVol = el('f-mat-vol');
    if (!sel) return;

    if (isScope3UpstreamExemptProduct(pv)) {
      if (na) na.style.display = 'block';
      if (ctr) {
        ctr.style.opacity = '0.55';
        ctr.style.pointerEvents = 'none';
      }
      sel.innerHTML = '';
      var optEx = document.createElement('option');
      optEx.value = '0';
      optEx.textContent = '本项不适用（免核算）';
      sel.appendChild(optEx);
      sel.disabled = true;
      if (matVol) {
        matVol.value = '0';
        matVol.disabled = true;
      }
      if (hint) {
        hint.textContent =
          '电力 / 氢等产品在粗测中不强制拆分大宗上游原料采购口径，本步 Scope 3 原料项免核算（因子按 0 处理）。';
      }
      updateEnergyHelper();
      previewSensitivity();
      return;
    }

    if (na) na.style.display = 'none';
    if (ctr) {
      ctr.style.opacity = '1';
      ctr.style.pointerEvents = 'auto';
    }
    sel.disabled = false;
    if (matVol) matVol.disabled = false;

    var list = getMaterialListForProduct(pv);
    sel.innerHTML = '';
    if (!list || !list.length) {
      var optEmpty = document.createElement('option');
      optEmpty.value = '0';
      optEmpty.textContent = '请先选择带原料对照的产品类别';
      sel.appendChild(optEmpty);
      if (hint) {
        hint.textContent = '请选择汽车/机械/电子或钢铁、铝、水泥、化肥等类别以加载上游原料选项。';
      }
      applyMaterialUnitFromSelect();
      updateEnergyHelper();
      previewSensitivity();
      return;
    }

    list.forEach(function (item, idx) {
      var o = document.createElement('option');
      var unit = item.unit || 't';
      o.value = String(item.value);
      o.textContent = item.label + ' (碳因子 ' + item.value + ' tCO₂e/' + unit + ')';
      o.setAttribute('data-factor', String(item.value));
      o.setAttribute('data-unit', unit);
      o.setAttribute('data-china-default', '1');
      o.setAttribute('data-industry', inferIndustryFromProduct(pv));
      if (idx === 0) o.selected = true;
      sel.appendChild(o);
    });
    if (hint) {
      hint.textContent = (SCOPE3_MATERIAL_HINT[pv] || hint.textContent) +
        ' · 缺省库含 ' + Math.round((getChinaDefaultSafetyMargin() - 1) * 100) + '% 安全边际';
    }
    applyMaterialUnitFromSelect();
    updateEnergyHelper();
    previewSensitivity();
  }

  function initCbamScope3MaterialLinkage() {
    if (!el('f-material')) return;
    var fp = el('f-product');
    var fm = el('f-material');
    var fv = el('f-mat-vol');
    if (fp && !fp.__hengaiScope3Bound) {
      fp.__hengaiScope3Bound = true;
      fp.addEventListener('change', rebuildMaterialOptionsForProduct);
    }
    if (fm && !fm.__hengaiScope3Bound) {
      fm.__hengaiScope3Bound = true;
      fm.addEventListener('change', function () {
        applyMaterialUnitFromSelect();
        previewSensitivity();
      });
    }
    if (fv && !fv.__hengaiScope3Bound) {
      fv.__hengaiScope3Bound = true;
      fv.addEventListener('input', previewSensitivity);
    }
    rebuildMaterialOptionsForProduct();
  }

  function readCbamInputs() {
    var macro = getMacroOracle();
    var matSnap = getScope3MaterialSnapshot();
    var mode = (el('f-mode') || {}).value || 'manual';
    var vol = num('f-volume', 0);
    return {
      vol: vol,
      price: num('f-price', Number(macro.cbam_current_price) || 75.36),
      fx: num('f-fx', Number(macro.eur_cny_rate) || 7.85),
      mode: mode,
      penalty: mode === 'mat' ? 1.0 : mode === 'third' ? 1.15 : 1.35,
      gridFactor: num('f-grid', 0.581),
      elec: num('f-elec', 0),
      gec: num('f-gec', 0),
      gas: num('f-gas', 0),
      coal: num('f-coal', 0),
      oil: num('f-oil', 0),
      matSnap: matSnap,
      matVol: matSnap.exempt ? 0 : matSnap.matVol,
      matFactor: matSnap.exempt ? 0 : matSnap.matFactor,
      supTotal: num('f-sup-total', 0),
      supDone: num('f-sup-done', 0),
      companyName: ((el('f-company') || {}).value || '').trim(),
    };
  }

  function computeCbamRough(inp) {
    inp = inp || readCbamInputs();
    var vol = Math.max(0, inp.vol);
    var s1 = inp.gas * 0.00202 + inp.coal * 2.66 + inp.oil * 0.00268;
    var s2 = Math.max(0, (inp.elec - inp.gec) * inp.gridFactor / 1000);
    var s3 = inp.matVol * inp.matFactor;
    var totalEmit = s1 + s2 + s3;
    var ci = vol > 0 ? totalEmit / vol : 0;
    var baseTax = ci * vol * inp.price;
    var totalTax = baseTax * inp.penalty;
    var coverage = inp.supTotal > 0 ? inp.supDone / inp.supTotal : 0;
    var matSnap = inp.matSnap || {};

    return {
      vol: vol,
      price: inp.price,
      fx: inp.fx,
      penalty: inp.penalty,
      s1: s1,
      s2: s2,
      s3: s3,
      totalEmit: totalEmit,
      ci: ci,
      baseTax: baseTax,
      totalTax: totalTax,
      totalTaxCNY: totalTax * inp.fx,
      coverage: coverage,
      supDone: inp.supDone,
      supTotal: inp.supTotal,
      t27: ci * vol * inp.penalty * 80,
      t28: ci * vol * inp.penalty * 95,
      mode: inp.mode,
      mainProduct: matSnap.mainProduct,
      mainProductLabel: matSnap.mainProductLabel,
      scope3MaterialLabel: matSnap.scope3MaterialLabel,
      scope3MaterialFactor: inp.matFactor,
      scope3MaterialUnit: matSnap.scope3MaterialUnit,
      scope3MaterialVolumeUnit: matSnap.scope3MaterialVolumeUnit,
      scope3MaterialIntensityUnit: matSnap.scope3MaterialIntensityUnit,
      scope3MaterialVolume: inp.matVol,
      usesChinaDefaultLibrary: !!matSnap.usesChinaDefaultLibrary,
      chinaDefaultSafetyMargin: matSnap.chinaDefaultSafetyMargin,
      scope3UpstreamExempt: !!matSnap.exempt,
      scope3MaterialVolumeT: inp.matVol,
    };
  }

  function previewSensitivity() {
    var inp = readCbamInputs();
    var vol = inp.vol;
    if (!vol || vol <= 0) return;

    var s2 = Math.max(0, (inp.elec - inp.gec) * inp.gridFactor / 1000);
    var s3 = inp.matVol * inp.matFactor;
    var totalEmit = (s2 + s3) / vol;
    var macroPrice = inp.price;
    var prices = [40, macroPrice, 80, 100];
    var ids = ['sv-40', 'sv-65', 'sv-80', 'sv-100'];
    var cnyIds = ['sv-40-cny', 'sv-65-cny', 'sv-80-cny', 'sv-100-cny'];

    prices.forEach(function (p, i) {
      var tax = totalEmit * vol * inp.penalty * p;
      var node = el(ids[i]);
      var cel = el(cnyIds[i]);
      if (node) node.textContent = fmtK(tax) + '€';
      if (cel) cel.textContent = fmtK(tax * inp.fx) + '¥';
    });

    var curLbl = el('sv-cur-label');
    if (curLbl) curLbl.textContent = '€' + macroPrice.toFixed(2);
    var slider = el('slider-price');
    var dispEl = el('slider-display');
    if (slider) slider.value = String(Math.round(macroPrice));
    if (dispEl) dispEl.textContent = '€' + macroPrice.toFixed(2) + '（当前）';
  }

  function updateSensitivity(v) {
    var macro = getMacroOracle();
    var cur = Number(v);
    if (!Number.isFinite(cur)) cur = Number(macro.cbam_current_price) || 75.36;
    var priceInp = el('f-price');
    if (priceInp) priceInp.value = String(cur);
    if (typeof global.publishMacroSync === 'function') {
      global.publishMacroSync({ cbam_current_price: cur });
    }
    var disp = el('slider-display');
    if (disp) disp.textContent = '€' + cur + (disp.textContent.indexOf('滑动') >= 0 ? '（滑动预览）' : '（当前）');
    previewSensitivity();
  }

  function renderResultsMinimal(r) {
    var main = el('r-main');
    if (main) main.textContent = '€ ' + fmtK(r.totalTax);
    var total = el('rb-total');
    if (total) total.textContent = '€ ' + fmtK(r.totalTax);
    var base = el('rb-base');
    if (base) base.textContent = '€ ' + fmtK(r.baseTax);
    var ciNode = el('rb-ci');
    if (ciNode) ciNode.textContent = r.ci.toFixed(3) + ' t/t';
    updateCbamDefaultFactorWarning(r);
    updateResultSensitivity(r.price);
    renderCbamKeyInsight(r);
  }

  function updateResultSensitivity(v) {
    var cr = global.cbamCalcResult || global.calcResult;
    if (!cr) return;
    var cur = Number(v);
    if (!Number.isFinite(cur)) cur = cr.price;
    var curEl = el('sens-current');
    if (curEl) curEl.textContent = '当前碳价 €' + cur;
    var rsDisp = el('rs-display');
    if (rsDisp) rsDisp.textContent = '€' + cur;
    [40, 65, 80, 100].forEach(function (p) {
      var node = el('rs-' + p);
      if (node) node.textContent = '€' + fmtK(cr.ci * cr.vol * cr.penalty * p);
    });
  }

  function syncCalcToAppState(calcResult, inp) {
    inp = inp || readCbamInputs();
    var delta = {
      cbam: {
        calcResult: calcResult,
        carbonIntensity: calcResult.ci,
        exportVolume: calcResult.vol,
        productType: calcResult.mainProductLabel || inp.matSnap.mainProductLabel,
        paidCarbonPrice: calcResult.price,
        step: 4,
      },
      metrics: (function () {
        var investCny = 58000;
        var netSaveCny = Math.round(calcResult.totalTax * calcResult.fx) - investCny;
        var roiMult = investCny > 0 && netSaveCny > 0 ? netSaveCny / investCny : 0;
        return {
          cbamTaxEstimate: Math.round(calcResult.totalTax),
          riskExposureEur: Math.round(calcResult.totalTax),
          carbonIntensity: parseFloat(calcResult.ci.toFixed(4)),
          tCO2eTotal: Math.round(calcResult.totalEmit),
          supplyChainCoverage: calcResult.coverage,
          supplierSubmitted: Math.round(calcResult.supDone),
          supplierCount: Math.round(calcResult.supTotal),
          scope1: calcResult.s1,
          scope2: calcResult.s2,
          scope3: calcResult.s3,
          roiMultiple: roiMult > 0 ? roiMult : null,
          taxSavingsWan: netSaveCny > 0 ? netSaveCny / 10000 : null,
        };
      })(),
    };
    var investCny = 58000;
    var netSaveCny = Math.round(calcResult.totalTax * calcResult.fx) - investCny;
    var roiMult = investCny > 0 && netSaveCny > 0 ? netSaveCny / investCny : 0;
    delta.company = Object.assign({}, (global.AppState && global.AppState.company) || {}, {
      name: inp.companyName || ((global.AppState && global.AppState.company && global.AppState.company.name) || ''),
      exportTons: calcResult.vol,
      cbamRiskRaw: Math.round(calcResult.totalTax),
      productLine: calcResult.mainProductLabel || undefined,
      roiRatio: roiMult > 0 ? '1 : ' + roiMult.toFixed(1) : '—',
      netSavings: netSaveCny > 0 ? '¥' + Math.round(netSaveCny).toLocaleString() : '—',
    });
    if (!inp.companyName) {
      delete delta.company.name;
    }
    if (typeof global.syncEvidenceFromSimulation === 'function') {
      try {
        global.syncEvidenceFromSimulation(calcResult, global.AppState);
        if (global.AppState && global.AppState.cbam && global.AppState.cbam.evidence) {
          delta.cbam = delta.cbam || {};
          delta.cbam.evidence = Object.assign({}, global.AppState.cbam.evidence);
        }
      } catch (_evErr) {}
    }
    if (global.AppState && typeof global.AppState.update === 'function') {
      global.AppState.update(delta);
    } else if (typeof global.patchAppState === 'function') {
      global.patchAppState(delta, { emitStateSynced: true });
    } else if (global.AppState) {
      global.AppState.cbam = global.AppState.cbam || {};
      global.AppState.cbam.calcResult = calcResult;
      global.AppState.metrics = Object.assign(global.AppState.metrics || {}, delta.metrics);
      if (typeof global.syncAppState === 'function') global.syncAppState(undefined, { emitStateSynced: true });
    }
    if (typeof global.renderCbamEvidenceBar === 'function') {
      try {
        global.renderCbamEvidenceBar({ calcResult: calcResult, syncCiDisplay: true });
      } catch (_uiErr) {}
    }
  }

  function persistCbamCommit(calcResult) {
    if (typeof global.notifyCbamCommercialBlock === 'function' &&
        global.notifyCbamCommercialBlock('commit_cbam')) {
      return Promise.resolve();
    }
    if (!global.AppState || typeof global.AppState.commit !== 'function') {
      return Promise.resolve();
    }
    var period = new Date().getFullYear() + '-Q' + (Math.floor(new Date().getMonth() / 3) + 1);
    return global.AppState.commit('cbam', {
      reportingPeriod: period,
      riskExposureEur: calcResult.totalTax,
      tco2eTotal: calcResult.totalEmit,
      payloadJson: JSON.stringify(calcResult),
    });
  }

  function goStep(n) {
    if (n === 2) {
      var vol = num('f-volume', 0);
      var prod = el('f-product');
      if (!vol || vol <= 0) {
        if (typeof global.showToast === 'function') global.showToast('请填写年出口欧盟数量');
        return;
      }
      if (prod && !prod.value) {
        if (typeof global.showToast === 'function') global.showToast('请选择产品类别');
        return;
      }
      rebuildMaterialOptionsForProduct();
    }
    var sections = document.querySelectorAll('#page-calc .step-section, #H-pg-cbam .step-section');
    if (!sections.length) {
      sections = document.querySelectorAll('.step-section');
    }
    sections.forEach(function (s, i) {
      s.classList.toggle('active', i + 1 === n);
    });
    if (n === 3) previewSensitivity();
    updateStepIndicator(n);
    global.currentStep = n;
    if (n === 4 && typeof global.renderCbamEvidenceBar === 'function') {
      try {
        global.renderCbamEvidenceBar({
          calcResult: global.calcResult || global.cbamCalcResult,
          syncCiDisplay: true,
        });
      } catch (_evStep) {}
    }
    if (typeof global.syncCbamFunnelChrome === 'function') global.syncCbamFunnelChrome();
    if (typeof global.scrollCbamTop === 'function') global.scrollCbamTop();
    else global.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function updateStepIndicator(n) {
    for (var i = 1; i <= 4; i++) {
      var dot = el('sd' + i);
      var lbl = el('sl' + i);
      var line = el('sline' + i);
      if (!dot) continue;
      if (i < n) {
        dot.className = dot.className.replace(/\b(sh-active|sh-lock|sh-done|active|done)\b/g, '').trim();
        if (dot.classList.contains('sd')) dot.className = 'sd done';
        else dot.className = 'sh-dot sh-done';
        dot.innerHTML =
          '<svg width="11" height="9" viewBox="0 0 11 9" fill="none"><polyline points="1,4.5 4,7.5 10,1.5" stroke="#7dd98a" stroke-width="1.3" stroke-linecap="round"/></svg>';
        if (lbl) lbl.className = (lbl.className.indexOf('sh-label') >= 0 ? 'sh-label done' : 'sh-label done');
      } else if (i === n) {
        if (dot.classList.contains('sd')) dot.className = 'sd' + (i === 4 ? ' result active' : ' active');
        else dot.className = 'sh-dot sh-active';
        dot.textContent = i === 4 ? '★' : String(i);
        if (lbl) lbl.className = (lbl.className.indexOf('sh-label') >= 0 ? 'sh-label active' : 'sh-label active');
      } else {
        if (dot.classList.contains('sd')) dot.className = i === 4 ? 'sd result' : 'sd';
        else dot.className = 'sh-dot sh-lock';
        dot.textContent = i === 4 ? '★' : String(i);
        if (lbl) lbl.className = lbl.className.indexOf('sh-label') >= 0 ? 'sh-label' : 'sh-label';
      }
      if (line) line.className = (line.className.indexOf('sline') >= 0 ? 'sline' : 'sh-line') + (i < n ? ' done' : '');
    }
  }

  var KEY_INSIGHT_ICON_SVG =
    '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="flex-shrink:0;margin-top:1px"><path d="M7 1L13 4V10L7 13L1 10V4L7 1Z" stroke="var(--red-l)" stroke-width="1"/><line x1="7" y1="4.5" x2="7" y2="8" stroke="var(--red-l)" stroke-width="1.2" stroke-linecap="round"/><circle cx="7" cy="9.5" r=".7" fill="var(--red-l)"/></svg>';

  function fmtEurInsight(v) {
    return v >= 1e6 ? '€' + (v / 1e6).toFixed(2) + 'M' : '€' + Math.round(v).toLocaleString();
  }

  function fmtCnyInsight(v) {
    return v >= 1e4 ? '¥' + (v / 10000).toFixed(1) + '万' : '¥' + Math.round(v).toLocaleString();
  }

  /** ② 功能导航：MAT / 全域诊断报告（非 ④ 商业闸门） */
  function navigateCbamMatGateway() {
    var doc = global.document;
    if (typeof global.navTo === 'function') {
      var nav = doc && doc.getElementById('nav-report');
      try {
        global.navTo('report', nav);
        return;
      } catch (_) {}
    }
    if (typeof global.navigateToHub === 'function') {
      global.navigateToHub('report');
      return;
    }
    try {
      if (global.parent !== global && typeof global.parent.navTo === 'function') {
        global.parent.navTo('report', global.parent.document.getElementById('nav-report'));
        return;
      }
    } catch (_) {}
    var base =
      typeof global.hengaiPage === 'function'
        ? global.hengaiPage('全域中心.html').split('#')[0]
        : '全域中心.html';
    global.location.href = base + '#report';
  }

  function matGatewayLink(label) {
    return (
      '<a href="#" class="cbam-mat-link" data-cbam-mat-link="1" style="color:var(--teal-l);font-weight:700;text-decoration:underline">' +
      (label || '升级至 MAT 物理传感器（Lv.4）') +
      '</a>'
    );
  }

  function bindCbamNavLinks(root) {
    root = root || global.document;
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-cbam-mat-link],[data-cbam-report-link]').forEach(function (a) {
      if (a.__cbamNavBound) return;
      a.__cbamNavBound = true;
      a.addEventListener('click', function (e) {
        e.preventDefault();
        navigateCbamMatGateway();
      });
    });
  }

  function buildCbamKeyInsightHtml(r) {
    var mode = r.mode || 'manual';
    var penalty = r.penalty || (mode === 'mat' ? 1.0 : mode === 'third' ? 1.15 : 1.35);
    var baseTax = r.baseTax || 0;
    var fx = r.fx || 7.85;
    if (mode === 'mat') {
      return (
        '测算按 <strong style="color:var(--green-l)">Lv.4 · MAT 物理传感器</strong> 情景，惩罚系数 ×1.00。' +
        '要在产线启用 CL-MAT 网关，请查看 ' +
        matGatewayLink('全域诊断报告 · MAT 接入路径') +
        '。'
      );
    }
    var premium = (penalty - 1) * baseTax;
    var modeLabel = mode === 'third' ? 'Lv.3 第三方审计' : 'Lv.2 人工凭证';
    var modeColor = mode === 'third' ? 'var(--gold-l)' : 'var(--amber)';
    return (
      '当前 <strong style="color:' +
      modeColor +
      '">' +
      modeLabel +
      '</strong> 下，惩罚溢价约 <strong style="color:var(--red-l)">' +
      fmtEurInsight(premium) +
      '</strong>（' +
      fmtCnyInsight(premium * fx) +
      '）。' +
      matGatewayLink('升级至 MAT 物理传感器（Lv.4）') +
      ' 可消除溢价，预计节税 <strong style="color:var(--green-l)">' +
      fmtCnyInsight(premium * fx) +
      '</strong> · ' +
      '<a href="#" data-cbam-report-link="1" style="color:var(--gold-l);font-weight:700;text-decoration:underline">查看全域诊断报告 →</a>'
    );
  }

  function renderCbamKeyInsight(r) {
    var insEl = el('key-insight');
    if (!insEl || !r) return;
    var body = buildCbamKeyInsightHtml(r);
    var host =
      insEl.classList && insEl.classList.contains('insight')
        ? insEl
        : insEl.parentElement && insEl.parentElement.classList && insEl.parentElement.classList.contains('insight')
          ? insEl.parentElement
          : insEl;
    if (insEl === host) {
      insEl.innerHTML = KEY_INSIGHT_ICON_SVG + '<span>' + body + '</span>';
    } else {
      insEl.innerHTML = body;
    }
    if (host && host.classList && host.classList.contains('insight')) {
      host.classList.remove('ins-red', 'ins-gold');
      if ((r.mode || 'manual') === 'mat') host.classList.add('ins-gold');
      else host.classList.add('ins-red');
      if (host.style) host.style.display = '';
    }
    bindCbamNavLinks(insEl);
  }

  function ensureConfMatCta() {
    var cta = el('conf-mat-cta');
    if (cta) return cta;
    var strip = el('conf4') || (global.document && global.document.querySelector('.conf-strip'));
    var host = strip && (strip.parentElement || strip.closest('div'));
    if (!host) return null;
    cta = global.document.createElement('div');
    cta.id = 'conf-mat-cta';
    cta.style.cssText = 'font-size:11px;margin-top:8px;line-height:1.65;color:var(--ink2)';
    host.appendChild(cta);
    return cta;
  }

  function syncModeHint() {
    var hint = el('h-mode');
    if (!hint) return;
    var modeEl = el('f-mode');
    var mode = modeEl ? modeEl.value : 'manual';
    var base = '欧盟海关对不同申报路径的数据可信度分级不同。';
    if (mode === 'mat') {
      hint.innerHTML =
        base +
        ' 当前为 <strong style="color:var(--green-l)">Lv.4 · MAT 物理传感器</strong>（惩罚 ×1.00）。产线真实启用请查看 ' +
        matGatewayLink('全域诊断报告') +
        '。';
    } else if (mode === 'third') {
      hint.innerHTML =
        base +
        ' <strong style="color:var(--gold-l)">Lv.3 第三方审计</strong> 惩罚 ×1.15；' +
        matGatewayLink('升级至 MAT 物理传感器（Lv.4）') +
        ' 可进一步降至 ×1.00。';
    } else {
      hint.innerHTML =
        base +
        ' <strong style="color:var(--amber)">Lv.2 人工凭证</strong> 惩罚 ×1.35；' +
        matGatewayLink('升级至 MAT 物理传感器（Lv.4）') +
        ' 可消除溢价。';
    }
    bindCbamNavLinks(hint);
  }

  function syncConfMatCta(mode) {
    var cta = ensureConfMatCta();
    if (!cta) return;
    if (mode === 'mat') {
      cta.style.display = 'block';
      cta.innerHTML =
        '已按 Lv.4 情景模拟。产线启用 CL-MAT 网关 → ' + matGatewayLink('全域诊断报告 · MAT 接入方案');
    } else if (mode === 'third') {
      cta.style.display = 'block';
      cta.innerHTML = '仍有 ×0.15 溢价空间 · ' + matGatewayLink('升级至 MAT 物理传感器（Lv.4）');
    } else {
      cta.style.display = 'block';
      cta.innerHTML = '消除 ×1.35 惩罚溢价 → ' + matGatewayLink('升级至 MAT 物理传感器（Lv.4）');
    }
    bindCbamNavLinks(cta);
  }

  function updateConfidence() {
    var modeEl = el('f-mode');
    if (!modeEl) return;
    var mode = modeEl.value;
    var txt = el('conf-text');
    var c3 = el('conf3');
    var c4 = el('conf4');
    if (!txt) return;
    if (mode === 'mat') {
      if (c3) {
        c3.className = 'conf-step active';
        if (c3.style) c3.style.background = 'var(--teal)';
      }
      if (c4) {
        c4.className = 'conf-step active';
        if (c4.style) c4.style.background = 'var(--teal)';
      }
      txt.style.color = 'var(--green-l)';
      txt.textContent = 'Lv.4 · MAT 物理传感器 · 惩罚系数 ×1.00';
    } else if (mode === 'third') {
      if (c3) {
        c3.className = 'conf-step active';
        if (c3.style) c3.style.background = 'var(--blue-l)';
      }
      if (c4) {
        c4.className = 'conf-step';
        if (c4.style) c4.style.background = 'rgba(255,255,255,0.07)';
      }
      txt.style.color = 'var(--gold-l)';
      txt.textContent = 'Lv.3 · 第三方审计 · 惩罚系数 ×1.15';
    } else {
      if (c3) {
        c3.className = 'conf-step';
        if (c3.style) c3.style.background = 'rgba(255,255,255,0.07)';
      }
      if (c4) {
        c4.className = 'conf-step';
        if (c4.style) c4.style.background = 'rgba(255,255,255,0.07)';
      }
      txt.style.color = 'var(--amber)';
      txt.textContent = 'Lv.2 · 人工凭证 · 惩罚系数 ×1.35';
    }
    syncModeHint();
    syncConfMatCta(mode);
  }

  function toggleHint(id) {
    var node = el(id);
    if (!node) return;
    node.classList.toggle('open');
    node.classList.toggle('show');
  }

  /** SPA 多品类申报 · DOM 行与 SCOPE3 产品键映射（与粗测共用因子表） */
  var SPA_SKU_DOM = [
    { dom: 'alum', product: 'aluminum', label: '铝及铝制品' },
    { dom: 'steel', product: 'steel', label: '钢铁及钢铁制品' },
    { dom: 'cement', product: 'cement', label: '水泥及熟料' },
  ];

  function defaultMaterialFactor(productKey) {
    if (isScope3UpstreamExemptProduct(productKey)) return 0;
    var list = getMaterialListForProduct(productKey);
    if (!list || !list.length) return 0;
    return list[0].value * getChinaDefaultSafetyMargin();
  }

  function readCbamMultiSkuFromDom() {
    var macro = getMacroOracle();
    var mode = 'manual';
    var prior = global.AppState && global.AppState.cbam && global.AppState.cbam.calcResult;
    if (prior && prior.mode) mode = prior.mode;
    var lines = [];
    SPA_SKU_DOM.forEach(function (sku) {
      var qty = num('qty-' + sku.dom, 0);
      if (qty <= 0) return;
      var eiNode = el('ei-' + sku.dom);
      var defFac = defaultMaterialFactor(sku.product);
      var matFactor = defFac;
      if (eiNode && eiNode.value !== '') {
        matFactor = parseFloat(eiNode.value);
        if (!Number.isFinite(matFactor)) matFactor = defFac;
      }
      var list = getMaterialListForProduct(sku.product);
      var materialLabel = list && list.length ? list[0].label : sku.label;
      lines.push({
        dom: sku.dom,
        product: sku.product,
        label: sku.label,
        qty: qty,
        matFactor: matFactor,
        materialLabel: materialLabel,
      });
    });
    return {
      lines: lines,
      price: Number(macro.cbam_current_price) || 75.36,
      fx: Number(macro.eur_cny_rate) || 7.85,
      mode: mode,
      penalty: mode === 'mat' ? 1.0 : mode === 'third' ? 1.15 : 1.35,
      companyName:
        ((global.AppState && global.AppState.company && global.AppState.company.name) || '').trim() ||
        ((el('f-company') || {}).value || '').trim(),
    };
  }

  /**
   * 多品类出口量汇总 → 与粗测相同的税额公式（碳价/惩罚系数/落库结构一致）
   * Scope1/2 若 AppState 中已有粗测结果则叠加，否则为 0
   */
  function computeCbamMultiSku(opts) {
    opts = opts || readCbamMultiSkuFromDom();
    var lines = opts.lines || [];
    var vol = 0;
    var s3 = 0;
    var dominant = null;
    lines.forEach(function (line) {
      vol += line.qty;
      s3 += line.qty * line.matFactor;
      if (!dominant || line.qty > dominant.qty) dominant = line;
    });
    var prior = global.AppState && global.AppState.cbam && global.AppState.cbam.calcResult;
    var s1 = prior && Number.isFinite(prior.s1) ? prior.s1 : 0;
    var s2 = prior && Number.isFinite(prior.s2) ? prior.s2 : 0;
    var supTotal =
      (prior && prior.supTotal) ||
      (global.AppState && global.AppState.metrics && global.AppState.metrics.supplierCount) ||
      0;
    var supDone =
      (prior && prior.supDone) ||
      (global.AppState && global.AppState.metrics && global.AppState.metrics.supplierSubmitted) ||
      0;
    var totalEmit = s1 + s2 + s3;
    var ci = vol > 0 ? totalEmit / vol : 0;
    var baseTax = ci * vol * opts.price;
    var totalTax = baseTax * opts.penalty;
    var coverage = supTotal > 0 ? supDone / supTotal : 0;
    var mainProduct = dominant ? dominant.product : '';
    var mainProductLabel = dominant ? dominant.label : '';
    var scope3MaterialLabel = dominant ? dominant.materialLabel : '';

    return {
      vol: vol,
      price: opts.price,
      fx: opts.fx,
      penalty: opts.penalty,
      s1: s1,
      s2: s2,
      s3: s3,
      totalEmit: totalEmit,
      ci: ci,
      baseTax: baseTax,
      totalTax: totalTax,
      totalTaxCNY: totalTax * opts.fx,
      coverage: coverage,
      supDone: supDone,
      supTotal: supTotal,
      t27: ci * vol * opts.penalty * 80,
      t28: ci * vol * opts.penalty * 95,
      mode: opts.mode,
      mainProduct: mainProduct,
      mainProductLabel: mainProductLabel,
      scope3MaterialLabel: scope3MaterialLabel,
      scope3MaterialFactor: dominant ? dominant.matFactor : 0,
      scope3UpstreamExempt: dominant ? isScope3UpstreamExemptProduct(dominant.product) : false,
      scope3MaterialVolumeT: vol,
      calcSource: 'multi_sku',
      skuLines: lines,
    };
  }

  /** SPA 面板实时预览 DOM（calc-tco2e / calc-tax / calc-price） */
  function applyCbamResultToSpaPanel(result) {
    if (!result) return;
    var ct = el('calc-tco2e');
    var cx = el('calc-tax');
    var cp = el('calc-price');
    var rp = el('rpt-tax-display');
    var period = el('rpt-period-display');
    var fmtT = function (v) {
      if (!v && v !== 0) return '0.00 tCO₂e';
      if (v >= 10000) return (v / 1000).toFixed(2) + 'k tCO₂e';
      return Number(v).toFixed(2) + ' tCO₂e';
    };
    var fmtEur = function (v) {
      if (!v && v !== 0) return '€0';
      if (v >= 1e6) return '€' + (v / 1e6).toFixed(2) + 'M';
      return '€' + Math.round(v).toLocaleString();
    };
    if (ct) ct.textContent = fmtT(result.totalEmit);
    if (cx) cx.textContent = fmtEur(result.totalTax);
    if (cp) cp.textContent = '€' + Number(result.price).toFixed(2);
    if (rp) rp.textContent = fmtEur(result.totalTax);
    if (period) {
      var per = el('cbam-period');
      period.textContent = per && per.value ? per.value : new Date().getFullYear() + '-FY';
    }
  }

  function initSpaCbamDefaults() {
    if (!el('qty-alum')) return;
    SPA_SKU_DOM.forEach(function (sku) {
      var ei = el('ei-' + sku.dom);
      var def = defaultMaterialFactor(sku.product);
      if (ei && (!ei.value || ei.value === '')) ei.placeholder = '默认 ' + def;
    });
    var cp = el('calc-price');
    if (cp) {
      var macro = getMacroOracle();
      cp.textContent = '€' + (Number(macro.cbam_current_price) || 75.36).toFixed(2);
    }
  }

  function runCbamUnifiedForSpa(options) {
    options = options || {};
    var result = computeCbamMultiSku();
    global.cbamCalcResult = result;
    global.calcResult = result;
    syncCalcToAppState(result, readCbamMultiSkuFromDom());
    applyCbamResultToSpaPanel(result);
    if (typeof options.afterSync === 'function') options.afterSync(result);
    if (options.persist) {
      return persistCbamCommit(result);
    }
    return Promise.resolve(result);
  }

  function runCalc(options) {
    options = options || {};
    var btn = el('final-btn');
    var delay = options.delayMs != null ? options.delayMs : 520;
    var btnIdle = options.btnIdleText || '立即测算 → 生成碳税诊断';

    if (btn) {
      btn.disabled = true;
      btn.textContent = '计算中...';
    }

    setTimeout(function () {
      var inp = readCbamInputs();
      if (!inp.vol || inp.vol <= 0) {
        if (typeof global.showToast === 'function') global.showToast('请填写年出口欧盟数量');
        if (btn) {
          btn.disabled = false;
          btn.textContent = btnIdle;
        }
        return;
      }

      var macro = getMacroOracle();
      macro.cbam_current_price = inp.price;
      macro.eur_cny_rate = inp.fx;
      if (typeof global.publishMacroSync === 'function') {
        global.publishMacroSync({ cbam_current_price: inp.price, eur_cny_rate: inp.fx });
      }

      var result = computeCbamRough(inp);
      global.cbamCalcResult = result;
      global.calcResult = result;

      syncCalcToAppState(result, inp);

      if (typeof options.onComputed === 'function') {
        options.onComputed(result, inp);
      } else {
        if (typeof global.goStep === 'function') global.goStep(4);
        var renderFn =
          typeof global.renderCbamHubResults === 'function'
            ? global.renderCbamHubResults
            : typeof global.renderResults === 'function'
              ? global.renderResults
              : renderResultsMinimal;
        if (renderFn) renderFn(result);
        updateCbamDefaultFactorWarning(result);
        if (typeof global.renderHubDiagnosticReport === 'function' && global.AppState) {
          try {
            global.renderHubDiagnosticReport(global.AppState);
          } catch (_e) {}
        }
        if (typeof global.hubPulseFromAppState === 'function') {
          try {
            global.hubPulseFromAppState();
          } catch (_e2) {}
        }
      }

      persistCbamCommit(result).then(
        function () {
          if (typeof global.showToast === 'function') global.showToast('测算已落库 · 全域诊断已同步');
        },
        function () {
          if (typeof global.showToast === 'function') global.showToast('测算完成 · 落库失败（可稍后重试）');
        }
      );

      if (btn) {
        btn.disabled = false;
        btn.textContent = btnIdle;
      }
    }, delay);
  }

  var api = {
    SCOPE3_MATERIAL_MAP: SCOPE3_MATERIAL_MAP,
    ASSEMBLY_INDUSTRY_MAP: getAssemblyIndustryMap,
    getMaterialListForProduct: getMaterialListForProduct,
    resolveMaterialFactorFromSelect: resolveMaterialFactorFromSelect,
    applyMaterialUnitFromSelect: applyMaterialUnitFromSelect,
    updateCbamDefaultFactorWarning: updateCbamDefaultFactorWarning,
    MAT_UNIT_LABELS: MAT_UNIT_LABELS,
    SCOPE3_MATERIAL_HINT: SCOPE3_MATERIAL_HINT,
    fmtK: fmtK,
    readCbamInputs: readCbamInputs,
    computeCbamRough: computeCbamRough,
    computeCbamMultiSku: computeCbamMultiSku,
    readCbamMultiSkuFromDom: readCbamMultiSkuFromDom,
    applyCbamResultToSpaPanel: applyCbamResultToSpaPanel,
    initSpaCbamDefaults: initSpaCbamDefaults,
    runCbamUnifiedForSpa: runCbamUnifiedForSpa,
    defaultMaterialFactor: defaultMaterialFactor,
    getScope3MaterialSnapshot: getScope3MaterialSnapshot,
    isScope3UpstreamExemptProduct: isScope3UpstreamExemptProduct,
    rebuildMaterialOptionsForProduct: rebuildMaterialOptionsForProduct,
    updateEnergyHelper: updateEnergyHelper,
    INDUSTRY_ENERGY_BENCHMARKS: INDUSTRY_ENERGY_BENCHMARKS,
    initCbamScope3MaterialLinkage: initCbamScope3MaterialLinkage,
    renderResultsMinimal: renderResultsMinimal,
    previewSensitivity: previewSensitivity,
    updateSensitivity: updateSensitivity,
    updateResultSensitivity: updateResultSensitivity,
    syncCalcToAppState: syncCalcToAppState,
    persistCbamCommit: persistCbamCommit,
    runCalc: runCalc,
    goStep: goStep,
    updateStepIndicator: updateStepIndicator,
    updateConfidence: updateConfidence,
    toggleHint: toggleHint,
    navigateCbamMatGateway: navigateCbamMatGateway,
    renderCbamKeyInsight: renderCbamKeyInsight,
    syncModeHint: syncModeHint,
  };

  global.HengAICbamRough = api;
  global.goStep = goStep;
  global.updateConfidence = updateConfidence;
  global.toggleHint = toggleHint;
  global.SCOPE3_MATERIAL_MAP = SCOPE3_MATERIAL_MAP;
  global.getMaterialListForProduct = getMaterialListForProduct;
  global.resolveMaterialFactorFromSelect = resolveMaterialFactorFromSelect;
  global.applyMaterialUnitFromSelect = applyMaterialUnitFromSelect;
  global.updateCbamDefaultFactorWarning = updateCbamDefaultFactorWarning;
  global.triggerFactorRequestFromCbam = triggerFactorRequestFromCbam;
  global.SCOPE3_MATERIAL_HINT = SCOPE3_MATERIAL_HINT;
  global.getScope3MaterialSnapshot = getScope3MaterialSnapshot;
  global.isScope3UpstreamExemptProduct = isScope3UpstreamExemptProduct;
  global.rebuildMaterialOptionsForProduct = rebuildMaterialOptionsForProduct;
  global.initCbamScope3MaterialLinkage = initCbamScope3MaterialLinkage;
  global.updateEnergyHelper = updateEnergyHelper;
  global.INDUSTRY_ENERGY_BENCHMARKS = INDUSTRY_ENERGY_BENCHMARKS;
  global.previewSensitivity = previewSensitivity;
  global.updateSensitivity = updateSensitivity;
  global.updateResultSensitivity = updateResultSensitivity;
  global.runCalc = runCalc;
  global.hideCbamPostCalcHints = hideCbamPostCalcHints;
  global.navigateCbamMatGateway = navigateCbamMatGateway;
  global.renderCbamKeyInsight = renderCbamKeyInsight;
  global.syncModeHint = syncModeHint;

  function boot() {
    hideCbamPostCalcHints();
    initCbamScope3MaterialLinkage();
    if (typeof global.initCbamVerifiedFactorUi === 'function') global.initCbamVerifiedFactorUi();
    if (el('f-mode')) updateConfidence();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);
