"""Fix broken sidebar HTML: sovereignty item was inserted inside knowledge item."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "frontend"

# Broken: knowledge div opened, sovereignty nested, label outside
BROKEN = re.compile(
    r'(<div class="sb-item"[^>]*data-page="knowledge"[^>]*>\s*<div class="sb-dot"[^>]*></div>)\s*'
    r'(<div class="sb-item locked"[^>]*id="n-sovereignty-resonance"[^>]*>.*?</div>)\s*'
    r'企业法规库</div>',
    re.DOTALL,
)

FIXED = r'\1企业法规库</div>\n  \2'

HUB_BROKEN = re.compile(
    r'(<div class="sb-item"\s+data-page="knowledge" id="nav-knowledge" onclick="navTo\(\'knowledge\', this\)">'
    r'<div class="sb-dot" style="background:#c4b5fd"></div>)\s*'
    r'(<div class="sb-item locked" data-page="industry-audit" id="n-sovereignty-resonance"[^>]*>.*?</div>)\s*'
    r'企业法规库</div>\s*'
    r'(<div class="sb-item locked" data-page="industry-audit" id="n-industry-audit"[^>]*>.*?</div>\s*)',
    re.DOTALL,
)

HUB_FIXED = (
    r'\1企业法规库</div>\n'
    r'  \2\n\n'
    r'  <div class="sb-group-title">企业工作台</div>'
)

# Move n-industry-audit to 大国重器 (after honor) in hub file
INDUSTRY_AUDIT_LINE = (
    '  <div class="sb-item locked" data-page="industry-audit" id="n-industry-audit" '
    'onclick="navLocked(\'industry-audit\', this)">'
    '<div class="sb-dot" id="dot-industry-audit" style="background:var(--ink3)"></div>'
    '工业原厂 · 因子精算</div>\n'
)


def fix_standalone(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    if "n-sovereignty-resonance" not in text:
        return False
    new_text, n = BROKEN.subn(FIXED, text)
    if n == 0 and "企业法规库</div>" in text:
        # already fixed?
        if re.search(
            r'data-page="knowledge"[^>]*>.*?企业法规库</div>\s*\n\s*<div class="sb-item locked"[^>]*n-sovereignty',
            text,
            re.DOTALL,
        ):
            return False
    if n == 0:
        print("SKIP (pattern not matched):", path.name)
        return False
    path.write_text(new_text, encoding="utf-8")
    print("FIXED:", path.name)
    return True


def fix_hub(path: Path) -> bool:
    text = path.read_text(encoding="utf-8")
    # Remove misplaced industry-audit from personal section if present
    text = re.sub(
        r'\n  <div class="sb-item locked" data-page="industry-audit" id="n-industry-audit"[^>]*>.*?</div>\s*'
        r'(?=\n  <div class="sb-group-title">企业工作台</div>)',
        "\n",
        text,
        count=1,
        flags=re.DOTALL,
    )
    new_text, n = HUB_BROKEN.subn(HUB_FIXED, text)
    if n == 0:
        # try knowledge fix only
        new_text, n2 = BROKEN.subn(FIXED, text)
        if n2 == 0:
            print("SKIP hub (no match)")
            return False
        text = new_text
    else:
        text = new_text
    # Ensure industry-audit under 大国重器 after honor
    if 'id="n-industry-audit"' not in text:
        text = text.replace(
            '<div class="sb-item" data-page="honor" id="nav-honor" onclick="navTo(\'honor\', this)">'
            '<div class="sb-dot" style="background:#c4b5fd"></div>荣誉体系</div>\n',
            '<div class="sb-item" data-page="honor" id="nav-honor" onclick="navTo(\'honor\', this)">'
            '<div class="sb-dot" style="background:#c4b5fd"></div>荣誉体系</div>\n'
            + INDUSTRY_AUDIT_LINE,
            1,
        )
    path.write_text(text, encoding="utf-8")
    print("FIXED hub:", path.name)
    return True


def main() -> None:
    count = 0
    for path in sorted(ROOT.glob("HengAI_*.html")):
        if path.name.endswith(".bak"):
            continue
        if fix_standalone(path):
            count += 1
    hub = ROOT / "全域中心.html"
    if hub.is_file() and fix_hub(hub):
        count += 1
    print(f"Done. {count} files fixed.")


if __name__ == "__main__":
    main()
