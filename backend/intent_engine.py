# intent_engine.py — HengAI V3.1 意图识别与动作指令引擎
# 将用户自然语言转化为结构化的数据库操作指令
# 架构原则：对话即录入，语言即动作

from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from enum import Enum
from typing import Any, Dict, List, Optional


# ---------------------------------------------------------------------------
# 动作指令类型枚举
# ---------------------------------------------------------------------------

class ActionType(str, Enum):
    """每一个动作对应一次精确的数据库写操作。"""
    UPDATE_WORKSPACE_INFO    = "update_workspace_info"     # 更新企业基础信息
    UPDATE_ENERGY_DATA       = "update_energy_data"        # 录入用电/用能数据
    UPDATE_SUPPLIER_COUNT    = "update_supplier_count"     # 更新供应商数量声明
    CREATE_CBAM_DRAFT        = "create_cbam_draft"         # 自动创建 CBAM 草稿
    AWARD_GM                 = "award_gm"                  # 奖励 GM（录入数据奖励）
    UPGRADE_WORKSPACE_STAGE  = "upgrade_workspace_stage"   # 触发阶段升级
    UPDATE_SCOPE3_COVERAGE   = "update_scope3_coverage"    # 更新 Scope3 覆盖率声明
    RECORD_CARBON_FOOTPRINT  = "record_carbon_footprint"   # 录入碳足迹数据


# ---------------------------------------------------------------------------
# 动作指令数据结构
# ---------------------------------------------------------------------------

@dataclass
class ActionInstruction:
    """
    一条可执行的数据库动作指令。
    由意图识别器生成，由 ActionExecutor 执行，执行后写入 ActionLog。
    """
    action_type : ActionType
    payload     : Dict[str, Any]
    confidence  : float           = 1.0    # 0.0~1.0，低于 0.6 仅记录不执行
    source_text : str             = ""     # 触发此动作的原始用户文本片段
    gm_reward   : Decimal         = Decimal("0")   # 此动作触发的 GM 奖励


@dataclass
class IntentParseResult:
    """意图解析结果——一句话可能触发多个动作。"""
    actions          : List[ActionInstruction] = field(default_factory=list)
    extracted_facts  : Dict[str, Any]          = field(default_factory=dict)
    requires_confirm : bool                    = False   # 高风险操作需前端二次确认
    clarify_question : Optional[str]           = None    # 需要追问时返回问题


# ---------------------------------------------------------------------------
# GM 奖励配置（可后台配置化，当前写为常量）
# ---------------------------------------------------------------------------

GM_REWARDS = {
    ActionType.UPDATE_WORKSPACE_INFO   : Decimal("20"),
    ActionType.UPDATE_ENERGY_DATA      : Decimal("30"),
    ActionType.UPDATE_SUPPLIER_COUNT   : Decimal("15"),
    ActionType.CREATE_CBAM_DRAFT       : Decimal("50"),
    ActionType.RECORD_CARBON_FOOTPRINT : Decimal("25"),
    ActionType.UPDATE_SCOPE3_COVERAGE  : Decimal("10"),
}


# ---------------------------------------------------------------------------
# 正则提取工具函数
# ---------------------------------------------------------------------------

# 严格数字字面量：1234 / 1,234 / 1234.5 / .5 / 1，234.56（中文逗号也接受）
# 关键是 fullmatch 校验：必须由数字 + 至多一个小数点 + 千分位逗号 构成，
# 杜绝旧版 r"[\d,\.]+" 把 "."、",,"、"1.2.3"、"v1.2" 等垃圾串塞给 Decimal() 引发崩溃。
_NUMBER_LITERAL_RE = re.compile(
    r"(?<![\w.])"                              # 左侧不能紧贴字母/下划线/点（避开 v1.2 / IPv4）
    r"(\d{1,3}(?:[,，]\d{3})+(?:\.\d+)?"        # 含千分位的写法：1,234 / 1,234.5
    r"|\d+\.\d+"                                # 普通小数：12.5
    r"|\.\d+"                                   # .5
    r"|\d+)"                                    # 纯整数：100
    r"(?![\w.])"                               # 右侧也不能紧贴字母/下划线/点
)

_STRICT_NUMBER_RE = re.compile(r"\d+(?:\.\d+)?|\.\d+")


def _safe_decimal(raw: Optional[str]) -> Optional[Decimal]:
    """把字符串安全地转 Decimal；失败返回 None，绝不抛异常。"""
    if raw is None:
        return None
    s = raw.replace(",", "").replace("，", "").strip()
    if not s or not _STRICT_NUMBER_RE.fullmatch(s):
        return None
    try:
        return Decimal(s)
    except (InvalidOperation, ValueError):
        return None


def _extract_number(text: str) -> Optional[Decimal]:
    """从自然语言中提取第一个数值（支持中文万、亿单位、千分位逗号）。

    硬化要求：
        - 任何不合法字符串都返回 None，不再抛 decimal.InvalidOperation；
        - 单字符 "."、孤立逗号、"1.2.3" 之类垃圾串一律剔除；
        - 中文逗号 "，"、中文顿号 "、" 视作千分位 / 分隔符进行归一化。
    """
    if not text:
        return None
    normalized = text.replace("，", ",").replace("、", " ")

    wan_match = re.search(_NUMBER_LITERAL_RE.pattern + r"\s*万", normalized)
    yi_match  = re.search(_NUMBER_LITERAL_RE.pattern + r"\s*亿", normalized)

    if wan_match:
        d = _safe_decimal(wan_match.group(1))
        if d is not None:
            return d * Decimal("10000")
    if yi_match:
        d = _safe_decimal(yi_match.group(1))
        if d is not None:
            return d * Decimal("100000000")

    plain_match = _NUMBER_LITERAL_RE.search(normalized)
    if plain_match:
        return _safe_decimal(plain_match.group(1))
    return None


def _extract_company_name(text: str) -> Optional[str]:
    """尝试从文本中提取企业名称（含'公司'/'集团'/'有限'的字符串）。"""
    match = re.search(
        r"[\u4e00-\u9fa5a-zA-Z0-9（()）\-·]{2,30}(?:公司|集团|有限|股份|科技|能源|工业|制造|化工|钢铁|铝业|水泥)",
        text,
    )
    return match.group(0) if match else None


def _extract_credit_code(text: str) -> Optional[str]:
    """提取统一社会信用代码（18位）。"""
    match = re.search(r"[0-9A-HJ-NP-RT-UW-Y]{18}", text)
    return match.group(0) if match else None


def _extract_industry(text: str) -> Optional[str]:
    """从关键词中推断行业类型。"""
    mapping = {
        "钢铁": "ferrous_metals",
        "钢": "ferrous_metals",
        "铝": "aluminium",
        "水泥": "cement",
        "化工": "chemicals",
        "电力": "electricity",
        "制造": "manufacturing",
        "能源": "energy",
        "汽车": "automotive",
    }
    for keyword, code in mapping.items():
        if keyword in text:
            return code
    return None


# ---------------------------------------------------------------------------
# 核心意图识别器
# ---------------------------------------------------------------------------

class IntentRecognizer:
    """
    规则优先 + 关键词驱动的意图识别器。
    V3.1 阶段采用确定性规则；V4.0 可替换为 Claude function_calling 工具调用。
    """

    # 意图触发关键词组
    _ENERGY_KEYWORDS   = {"用电", "电耗", "电量", "千瓦时", "kwh", "kWh",
                          "度电", "用能", "天然气", "煤炭", "燃气", "能耗"}
    _SUPPLIER_KEYWORDS = {"供应商", "上游", "协作方", "合作商", "供货商", "链主", "供应链"}
    _COMPANY_KEYWORDS  = {"公司名", "企业名", "叫做", "名称是", "我们是", "我司是",
                          "公司是", "集团", "有限公司", "股份"}
    _CARBON_KEYWORDS   = {"碳排", "排放", "tco2e", "tCO2e", "二氧化碳",
                          "碳足迹", "温室气体", "ghg", "scope"}
    _CBAM_KEYWORDS     = {"cbam", "CBAM", "碳关税", "欧盟", "出口", "进口申报"}
    _CREDIT_CODE_RE    = re.compile(r"[0-9A-HJ-NP-RT-UW-Y]{18}")

    def parse(self, user_text: str, current_app_state: Dict[str, Any]) -> IntentParseResult:
        """
        主解析入口。
        current_app_state: 前端传入的 window.AppState 快照（已包含最新数据库状态）。
        """
        result = IntentParseResult()
        text_lower = user_text.lower()

        # ── 1. 企业信息录入意图 ────────────────────────────────────────────
        self._detect_company_info(user_text, text_lower, current_app_state, result)

        # ── 2. 用能数据录入意图 ────────────────────────────────────────────
        self._detect_energy_data(user_text, text_lower, current_app_state, result)

        # ── 3. 供应商相关意图 ──────────────────────────────────────────────
        self._detect_supplier_intent(user_text, text_lower, current_app_state, result)

        # ── 4. 碳排放/碳足迹录入意图 ──────────────────────────────────────
        self._detect_carbon_data(user_text, text_lower, current_app_state, result)

        # ── 5. CBAM 报告意图 ───────────────────────────────────────────────
        self._detect_cbam_intent(user_text, text_lower, current_app_state, result)

        return result

    # ── 子检测器 ──────────────────────────────────────────────────────────

    def _detect_company_info(
        self, text: str, text_lower: str,
        state: Dict, result: IntentParseResult
    ) -> None:
        company_name  = _extract_company_name(text)
        credit_code   = _extract_credit_code(text)
        industry      = _extract_industry(text)

        if not any([company_name, credit_code, industry]):
            return
        if not any(kw in text for kw in self._COMPANY_KEYWORDS | {"信用代码", "注册号", "行业"}):
            # 没有企业信息录入意图的上下文词，不触发
            if not credit_code:   # 信用代码是强信号，无需上下文词
                return

        payload: Dict[str, Any] = {}
        facts:   Dict[str, Any] = {}

        if company_name:
            payload["name"]    = company_name
            facts["企业名称"]  = company_name
        if credit_code:
            payload["credit_code"] = credit_code
            facts["统一社会信用代码"] = credit_code
        if industry:
            payload["industry_code"] = industry
            facts["行业类型"] = industry

        if payload:
            result.actions.append(ActionInstruction(
                action_type=ActionType.UPDATE_WORKSPACE_INFO,
                payload=payload,
                confidence=0.85,
                source_text=text[:100],
                gm_reward=GM_REWARDS[ActionType.UPDATE_WORKSPACE_INFO],
            ))
            result.extracted_facts.update(facts)

    def _detect_energy_data(
        self, text: str, text_lower: str,
        state: Dict, result: IntentParseResult
    ) -> None:
        if not any(kw in text_lower for kw in {kw.lower() for kw in self._ENERGY_KEYWORDS}):
            return

        number = _extract_number(text)
        if number is None:
            result.clarify_question = "请告诉我具体的用电量数值（单位：千瓦时/度），我来帮你换算成碳当量。"
            return

        # 单位推断
        unit = "kWh"
        if "天然气" in text or "立方" in text:
            unit = "m³_gas"
        elif "煤" in text or "吨" in text:
            unit = "ton_coal"

        # 换算碳排放（CBAM v3.0 因子）
        emission_factors = {
            "kWh"      : Decimal("0.581"),   # 全国电网平均因子 kgCO2e/kWh
            "m³_gas"   : Decimal("2.162"),   # 天然气 kgCO2e/m³
            "ton_coal" : Decimal("2564"),     # 原煤 kgCO2e/ton
        }
        factor = emission_factors.get(unit, Decimal("0.581"))
        tco2e  = (number * factor / 1000).quantize(Decimal("0.0001"))

        result.actions.append(ActionInstruction(
            action_type=ActionType.UPDATE_ENERGY_DATA,
            payload={
                "energy_value" : float(number),
                "energy_unit"  : unit,
                "tco2e_calc"   : float(tco2e),
                "period"       : _infer_period(text),
            },
            confidence=0.9,
            source_text=text[:100],
            gm_reward=GM_REWARDS[ActionType.UPDATE_ENERGY_DATA],
        ))
        result.extracted_facts["用能数据"] = f"{number} {unit} ≈ {tco2e} tCO2e"

    def _detect_supplier_intent(
        self, text: str, text_lower: str,
        state: Dict, result: IntentParseResult
    ) -> None:
        if not any(kw in text for kw in self._SUPPLIER_KEYWORDS):
            return

        number = _extract_number(text)
        if number and number < 10000:   # 供应商数量通常不超过万家
            current_count = (
                state.get("supplierNodes") and len(state["supplierNodes"])
            ) or 0
            result.actions.append(ActionInstruction(
                action_type=ActionType.UPDATE_SUPPLIER_COUNT,
                payload={
                    "declared_count" : int(number),
                    "current_db_count": current_count,
                },
                confidence=0.8,
                source_text=text[:100],
                gm_reward=GM_REWARDS[ActionType.UPDATE_SUPPLIER_COUNT],
            ))
            result.extracted_facts["供应商数量声明"] = int(number)

            # 如果声明数量 > 已录入数量，计算 scope3 覆盖率
            if current_count > 0 and number > 0:
                coverage = min(Decimal(current_count) / Decimal(number), Decimal("1"))
                result.actions.append(ActionInstruction(
                    action_type=ActionType.UPDATE_SCOPE3_COVERAGE,
                    payload={"scope3_coverage": float(coverage)},
                    confidence=0.75,
                    source_text=text[:100],
                    gm_reward=GM_REWARDS[ActionType.UPDATE_SCOPE3_COVERAGE],
                ))
                result.extracted_facts["Scope3覆盖率"] = f"{coverage:.1%}"

    def _detect_carbon_data(
        self, text: str, text_lower: str,
        state: Dict, result: IntentParseResult
    ) -> None:
        if not any(kw in text_lower for kw in {kw.lower() for kw in self._CARBON_KEYWORDS}):
            return

        number = _extract_number(text)
        if number is None:
            return

        # 单位归一化为 tCO2e
        tco2e = number
        if "万吨" in text or "万tco2" in text_lower:
            tco2e = number * 10000
        elif "kg" in text_lower or "千克" in text:
            tco2e = number / 1000

        result.actions.append(ActionInstruction(
            action_type=ActionType.RECORD_CARBON_FOOTPRINT,
            payload={
                "tco2e_total" : float(tco2e),
                "period"      : _infer_period(text),
                "scope"       : _infer_scope(text),
            },
            confidence=0.85,
            source_text=text[:100],
            gm_reward=GM_REWARDS[ActionType.RECORD_CARBON_FOOTPRINT],
        ))
        result.extracted_facts["碳排放量"] = f"{tco2e} tCO2e"

    def _detect_cbam_intent(
        self, text: str, text_lower: str,
        state: Dict, result: IntentParseResult
    ) -> None:
        if not any(kw in text_lower for kw in {kw.lower() for kw in self._CBAM_KEYWORDS}):
            return

        # 提取商品类别
        cbam_goods = {
            "铝"  : {"factor": 11.2,  "code": "aluminium"},
            "钢"  : {"factor": 2.2,   "code": "steel"},
            "水泥": {"factor": 0.85,  "code": "cement"},
            "化肥": {"factor": 1.6,   "code": "fertilizers"},
            "电力": {"factor": None,  "code": "electricity"},
        }
        detected_goods = {
            name: info
            for name, info in cbam_goods.items()
            if name in text
        }

        if detected_goods:
            period = _infer_period(text) or "current_year"
            result.actions.append(ActionInstruction(
                action_type=ActionType.CREATE_CBAM_DRAFT,
                payload={
                    "goods"           : detected_goods,
                    "reporting_period": period,
                },
                confidence=0.8,
                source_text=text[:100],
                gm_reward=GM_REWARDS[ActionType.CREATE_CBAM_DRAFT],
            ))
            result.extracted_facts["CBAM商品类别"] = list(detected_goods.keys())


# ---------------------------------------------------------------------------
# 辅助推断函数
# ---------------------------------------------------------------------------

def _infer_period(text: str) -> Optional[str]:
    """从文本推断统计周期。"""
    year_match = re.search(r"20\d{2}", text)
    quarter_match = re.search(r"[第Q]?([1-4一二三四])[季度Qq]", text)
    if year_match and quarter_match:
        q = quarter_match.group(1)
        q_map = {"一": "1", "二": "2", "三": "3", "四": "4"}
        qn = q_map.get(q, q)
        return f"{year_match.group(0)}-Q{qn}"
    if year_match:
        return f"{year_match.group(0)}-FY"
    return None


def _infer_scope(text: str) -> str:
    """推断 Scope 范围。"""
    if "scope3" in text.lower() or "上游" in text or "供应链" in text:
        return "scope3"
    if "scope2" in text.lower() or "外购电" in text:
        return "scope2"
    return "scope1"
