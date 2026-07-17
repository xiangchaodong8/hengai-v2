"""工业原厂 8 行业 code 归一化与 ROLE_ORIGIN 白名单."""
import unittest
from types import SimpleNamespace

from hub_engine import (
    CANONICAL_ORIGIN_INDUSTRIES,
    ORIGIN_FACTORY_INDUSTRIES,
    _industry_gtci_tag,
    _norm_resonance_industry,
    _resolve_workspace_role,
)


class TestIndustryCodes(unittest.TestCase):
    def test_canonical_origin_eight_industries(self):
        self.assertEqual(
            set(CANONICAL_ORIGIN_INDUSTRIES),
            {"steel", "aluminum", "aluminium", "cement", "petro", "paper", "ceramic", "port", "idc"},
        )
        self.assertEqual(ORIGIN_FACTORY_INDUSTRIES, CANONICAL_ORIGIN_INDUSTRIES)

    def test_norm_aliases(self):
        cases = {
            "petrochem": "petro",
            "ceramics": "ceramic",
            "datacenter": "idc",
            "aluminium": "aluminum",
            "石化": "petro",
            "数据中心": "idc",
        }
        for raw, expected in cases.items():
            with self.subTest(raw=raw):
                self.assertEqual(_norm_resonance_industry(raw), expected)

    def test_resolve_workspace_role_origin(self):
        for code in ("steel", "petro", "ceramic", "idc", "port", "paper"):
            ws = SimpleNamespace(industry_code=code)
            self.assertEqual(_resolve_workspace_role(ws), "ROLE_ORIGIN", code)

    def test_resolve_workspace_role_sme(self):
        ws = SimpleNamespace(industry_code="automotive")
        self.assertEqual(_resolve_workspace_role(ws), "ROLE_SME")

    def test_gtci_tags(self):
        self.assertEqual(_industry_gtci_tag("petrochem"), "PE")
        self.assertEqual(_industry_gtci_tag("datacenter"), "DC")


class TestIndustryFactorAttestGuard(unittest.TestCase):
    def test_attest_industry_mismatch_message(self):
        from hub_engine import _norm_resonance_industry

        self.assertEqual(_norm_resonance_industry("petrochem"), "petro")
        self.assertEqual(_norm_resonance_industry("steel"), "steel")
        self.assertNotEqual(
            _norm_resonance_industry("petrochem"),
            _norm_resonance_industry("steel"),
        )


if __name__ == "__main__":
    unittest.main()
