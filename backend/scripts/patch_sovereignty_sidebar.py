"""Insert 产业链主权共振 sidebar item after 企业法规库 / 法规库 across frontend HTML."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "frontend"

SB_ITEM = (
    '  <div class="sb-item locked" data-page="industry-audit" id="n-sovereignty-resonance" '
    'onclick="window.location.href=\'HengAI_HeavyIndustry_Suite.html\'">'
    '<div class="sb-dot" id="dot-sovereignty-resonance" style="background:var(--ink3)"></div>'
    "产业链主权共振</div>\n"
)

HUB_SB_ITEM = (
    '  <div class="sb-item locked" data-page="industry-audit" id="n-sovereignty-resonance" '
    "onclick=\"navLocked('industry-audit', this)\">"
    '<div class="sb-dot" id="dot-sovereignty-resonance" style="background:var(--ink3)"></div>'
    "产业链主权共振</div>\n"
)

HG_NAV = (
    '    <div class="hg-nav locked" data-slug="sovereignty-resonance" id="n-sovereignty-resonance"\n'
    "         onclick=\"window.location.href='HengAI_HeavyIndustry_Suite.html'\">\n"
    '      <span class="hg-nav-ico">🛰️</span>\n'
    '      <span class="hg-nav-lbl">产业链主权共振</span>\n'
    "    </div>\n"
)

MARKER = "n-sovereignty-resonance"


def patch_file(path: Path, insert: str, pattern: str) -> bool:
    text = path.read_text(encoding="utf-8")
    if MARKER in text:
        return False
    m = re.search(pattern, text)
    if not m:
        return False
    pos = m.end(0)
    text = text[:pos] + "\n" + insert + text[pos:]
    path.write_text(text, encoding="utf-8")
    return True


def main() -> None:
    n = 0
    for path in ROOT.glob("HengAI_*.html"):
        if path.name.endswith(".bak"):
            continue
        if path.name == "全域中心.html":
            continue
        if patch_file(
            path,
            SB_ITEM,
            r'data-page="knowledge"[^>]*><div class="sb-dot"[^>]*></div>企业法规库</div>\s*',
        ):
            print("sb-item:", path.name)
            n += 1
    hub = ROOT / "全域中心.html"
    if patch_file(
        hub,
        HUB_SB_ITEM,
        r'id="nav-knowledge"[^>]*onclick="navTo\(\'knowledge\', this\)"><div class="sb-dot" style="background:#c4b5fd"></div>企业法规库</div>\s*',
    ):
        print("hub:", hub.name)
        n += 1
    cbam = ROOT / "HengAI_CBAM测算工具.html"
    if patch_file(
        cbam,
        HG_NAV,
        r'data-slug="regulation"[^>]*>[\s\S]*?</div>\s*',
    ):
        print("cbam hg-nav")
        n += 1
    print(f"Patched {n} files")


if __name__ == "__main__":
    main()
