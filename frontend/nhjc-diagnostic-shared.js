(function (global) {
  'use strict';

  var LOOKUP = {
    acrel: { label: '安科瑞', tier: 'tier0', estimatedWeeks: 2 },
    '安科瑞': { label: '安科瑞', tier: 'tier0', estimatedWeeks: 2 },
    compere: { label: '康派智能 (T@Energy-AIO)', tier: 'tier0', estimatedWeeks: 2 },
    '康派': { label: '康派智能 (T@Energy-AIO)', tier: 'tier0', estimatedWeeks: 2 },
    '许继': { label: '许继电气/康派智能', tier: 'tier0', estimatedWeeks: 2 },
    inspur: { label: '浪潮', tier: 'tier0', estimatedWeeks: 3 },
    '浪潮': { label: '浪潮', tier: 'tier0', estimatedWeeks: 3 },
    '群智合': { label: '群智合信息科技', tier: 'tier0', estimatedWeeks: 3 },
  };

  var DEFAULT_VENDOR = {
    label: '未识别厂商',
    tier: 'tier1',
    estimatedWeeks: 8,
  };

  function normalizeNhjcStatus(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    return {
      diagnosed: !!src.diagnosed,
      deployed: src.deployed == null ? null : !!src.deployed,
      vendorInput: src.vendorInput || null,
      matchedVendor: src.matchedVendor || null,
      tier: src.tier || null,
      estimatedWeeks: Number.isFinite(Number(src.estimatedWeeks)) ? Number(src.estimatedWeeks) : null,
      diagnosedAt: src.diagnosedAt || null,
      visibilityOptIn: !!src.visibilityOptIn,
    };
  }

  function matchNhjcVendor(inputText) {
    if (!inputText || !String(inputText).trim()) return null;
    var normalized = String(inputText).trim().toLowerCase();
    for (var key in LOOKUP) {
      if (!Object.prototype.hasOwnProperty.call(LOOKUP, key)) continue;
      if (normalized.indexOf(String(key).toLowerCase()) >= 0) {
        return {
          matchedKey: key,
          label: LOOKUP[key].label,
          tier: LOOKUP[key].tier,
          estimatedWeeks: LOOKUP[key].estimatedWeeks,
        };
      }
    }
    return {
      matchedKey: null,
      label: DEFAULT_VENDOR.label,
      tier: DEFAULT_VENDOR.tier,
      estimatedWeeks: DEFAULT_VENDOR.estimatedWeeks,
    };
  }

  function getNhjcStatusDisplay(nhjcStatus) {
    var st = normalizeNhjcStatus(nhjcStatus);
    if (!st.diagnosed || !st.visibilityOptIn) return null;
    if (st.tier === 'tier0') {
      return {
        text: '已具备NHJC合规基础 · 预计' + (st.estimatedWeeks || 2) + '周内可完成接入',
        color: 'var(--green-l)',
        pillClass: 'p-g',
      };
    }
    return {
      text: '正在筹备电表直连方案 · 预计' + (st.estimatedWeeks || 8) + '周内可完成接入',
      color: 'var(--orange-l)',
      pillClass: 'p-o',
    };
  }

  global.NHJC_VENDOR_LOOKUP = LOOKUP;
  global.NHJC_VENDOR_DEFAULT = DEFAULT_VENDOR;
  global.matchNhjcVendor = matchNhjcVendor;
  global.getNhjcStatusDisplay = getNhjcStatusDisplay;
  global.normalizeNhjcStatus = normalizeNhjcStatus;
})(typeof window !== 'undefined' ? window : this);
