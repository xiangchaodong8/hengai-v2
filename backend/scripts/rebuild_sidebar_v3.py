"""Rebuild sidebars from frontend/all_sidebar_html.html (V3 三权分立)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONTEND = ROOT / "frontend"
CANON = FRONTEND / "all_sidebar_html.html"

MPA_START = "<!-- BEGIN:MPA_SIDEBAR -->"
MPA_END = "<!-- END:MPA_SIDEBAR -->"
HUB_START = "<!-- BEGIN:HUB_SIDEBAR_NAV -->"
HUB_END = "<!-- END:HUB_SIDEBAR_NAV -->"


def extract_block(text: str, start: str, end: str) -> str:
    i = text.index(start) + len(start)
    j = text.index(end, i)
    return text[i:j].strip() + "\n"


def patch_mpa(path: Path, mpa_block: str) -> bool:
    raw = path.read_text(encoding="utf-8")
    if "data-qa-version=\"3.5\"" in raw and "原厂资产确权" in raw and "星火成就档案" in raw:
        return False

    # Replace from CANONICAL comment or sidebar open through qa script (if any) or sidebar close
    patterns = [
        r"<!-- CANONICAL SIDEBAR[\s\S]*?<script id=\"qa-sidebar-active-script\">[\s\S]*?</script>\s*",
        r"<div class=\"sidebar\" id=\"sidebar\"[\s\S]*?</div>\s*(?=<div class=\"main)",
        r"<div class=\"sidebar\" id=\"sidebar\"[\s\S]*?</div>\s*(?=<div class=\"main-wrap)",
    ]
    for pat in patterns:
        if re.search(pat, raw):
            new_raw = re.sub(pat, mpa_block, raw, count=1)
            if new_raw != raw:
                path.write_text(new_raw, encoding="utf-8")
                return True
    return False


def patch_hub(path: Path, hub_nav: str) -> bool:
    raw = path.read_text(encoding="utf-8")
    if "id=\"g-personal\"" in raw and "原厂资产确权" in raw and "data-qa-version=\"3.5\"" in raw:
        return False
    pat = r'<div class="sb-group-title">个人工作台</div>[\s\S]*?<div class="sb-group-title">深潜模块</div>[\s\S]*?ACF 大湾区认证</div>\s*'
    if not re.search(pat, raw):
        pat = r'<div class="sb-group-title">个人工作台</div>[\s\S]*?<div class="sb-item locked" data-page="acf"[\s\S]*?ACF 大湾区认证</div>\s*'
    if not re.search(pat, raw):
        pat = r'<div class="sb-group-title" id="g-personal">[\s\S]*?生态共治委员会</div>\s*'
    new_raw = re.sub(pat, hub_nav, raw, count=1)
    if new_raw == raw:
        return False
    new_raw = new_raw.replace('data-qa-version="2.0"', 'data-qa-version="3.0"')
    new_raw = new_raw.replace("id=\"page-industry-audit\"", "id=\"page-origin-audit\"")
    path.write_text(new_raw, encoding="utf-8")
    return True


def main() -> None:
    canon = CANON.read_text(encoding="utf-8")
    mpa = extract_block(canon, MPA_START, MPA_END)
    hub_nav = extract_block(canon, HUB_START, HUB_END)

    n = 0
    for path in sorted(FRONTEND.glob("HengAI_*.html")):
        if path.name in ("HengAI_CBAM测算工具.html", "HengAI_Supplier_H5.html", "HengAI_SPA_Part1.html"):
            continue
        if patch_mpa(path, mpa):
            print("mpa:", path.name)
            n += 1

    hub = FRONTEND / "全域中心.html"
    if patch_hub(hub, hub_nav):
        print("hub:", hub.name)
        n += 1

    print(f"Rebuilt {n} files")


if __name__ == "__main__":
    main()
