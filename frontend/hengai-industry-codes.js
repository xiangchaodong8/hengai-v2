/**
 * HengAI · 工业行业 code 单一真理源
 * 蓝图/后端 canonical：petro ceramic idc …
 * 因子精算 UI key：petrochem ceramics datacenter …
 */
(function (W) {
  'use strict';

  var CANONICAL_ORIGIN = [
    'steel', 'aluminum', 'cement', 'petro', 'paper', 'ceramic', 'port', 'idc',
  ];

  var UI_TO_CANONICAL = {
    steel: 'steel',
    aluminum: 'aluminum',
    aluminium: 'aluminum',
    cement: 'cement',
    petro: 'petro',
    petrochem: 'petro',
    petrochemical: 'petro',
    petrochemicals: 'petro',
    paper: 'paper',
    ceramic: 'ceramic',
    ceramics: 'ceramic',
    port: 'port',
    idc: 'idc',
    datacenter: 'idc',
    data_center: 'idc',
  };

  var CANONICAL_TO_FACTOR_UI = {
    steel: 'steel',
    aluminum: 'aluminum',
    aluminium: 'aluminum',
    cement: 'cement',
    petro: 'petrochem',
    paper: 'paper',
    ceramic: 'ceramics',
    port: 'port',
    idc: 'datacenter',
  };

  function toCanonicalIndustryCode(raw) {
    var s = String(raw || '').trim().toLowerCase();
    if (!s) return 'steel';
    if (UI_TO_CANONICAL[s]) return UI_TO_CANONICAL[s];
    if (CANONICAL_ORIGIN.indexOf(s) >= 0) return s === 'aluminium' ? 'aluminum' : s;
    return 'steel';
  }

  function toFactorUiIndustryKey(raw) {
    var canon = toCanonicalIndustryCode(raw);
    return CANONICAL_TO_FACTOR_UI[canon] || canon;
  }

  function hengaiIsOriginIndustryCode(code) {
    var s = String(code || '').trim().toLowerCase();
    if (!s) return false;
    if (UI_TO_CANONICAL[s]) return CANONICAL_ORIGIN.indexOf(UI_TO_CANONICAL[s]) >= 0;
    if (s === 'aluminium') return true;
    return CANONICAL_ORIGIN.indexOf(s) >= 0;
  }

  W.HENGAI_CANONICAL_ORIGIN_INDUSTRIES = CANONICAL_ORIGIN.slice();
  W.toCanonicalIndustryCode = toCanonicalIndustryCode;
  W.toFactorUiIndustryKey = toFactorUiIndustryKey;
  W.hengaiIsOriginIndustryCode = hengaiIsOriginIndustryCode;
}(typeof window !== 'undefined' ? window : globalThis));
