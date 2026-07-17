"""批次 7 · AppState DNA 前端契约单测（无数据库，stdlib unittest）。"""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from hub_engine import (  # noqa: E402
    build_guest_app_state,
    normalize_app_state_for_frontend,
)


class NormalizeAppStateTests(unittest.TestCase):
    def test_guest_state_has_pipeline_identity_fields(self):
        dna = build_guest_app_state()
        user = dna["user"]
        self.assertEqual(user["tier_code"], "GUEST")
        self.assertEqual(user["tierLabel"], "访客")
        self.assertIn("regDate", user)

    def test_guardian_maps_to_pro_personal(self):
        raw = {
            "user": {"tier": "Guardian", "regDate": "2025-01-15T08:00:00+00:00"},
            "metrics": {"supplyChainCoverage": 0.42},
            "company": {"name": "测试厂"},
        }
        out = normalize_app_state_for_frontend(raw)
        self.assertEqual(out["user"]["tier_code"], "PRO_PERSONAL")
        self.assertEqual(out["user"]["tierLabel"], "个人专业版")
        self.assertEqual(out["user"]["regLabel"], "注册于 2025-01-15")
        self.assertAlmostEqual(out["company"]["scope3Rate"], 42.0)

    def test_explicit_tier_code_preserved(self):
        raw = {"user": {"tier_code": "ENT_VERIFIED", "tier": "Seed"}}
        out = normalize_app_state_for_frontend(raw)
        self.assertEqual(out["user"]["tier_code"], "ENT_VERIFIED")
        self.assertEqual(out["user"]["tierLabel"], "企业共治版")


if __name__ == "__main__":
    unittest.main()
