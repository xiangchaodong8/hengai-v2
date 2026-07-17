# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent
INDEX = ROOT / "index.html"
HUB = ROOT / "全域中心.html"
CSS = ROOT / "_co2lion_hub_scoped.css"

CLOSE_BTN = (
    '<button type="button" onclick="closeHubOverlay()" style="display:flex; align-items:center; gap:6px; padding:6px 14px; '
    'background:rgba(226,75,74,0.1); border:1px solid rgba(226,75,74,0.3); color:#e24b4a; border-radius:8px; font-weight:600; '
    'cursor:pointer; transition:all 0.2s;">'
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">'
    '<path d="M18 6L6 18M6 6l12 12"/></svg>'
    "退出全域中心，返回对话"
    "</button>"
)

OVERLAY_STYLE = (
    "display:none; position:fixed; inset:0; z-index:9999; background:#06080f; overflow:hidden; opacity:0; transition:opacity 0.3s ease;"
)

HUB_JS_EXTRA = """
// --- HengAI index.html bridge ---
function openHubOverlay() {
    var hub = document.getElementById('co2lion-hub-overlay');
    if (!hub) return;
    hub.style.display = 'block';
    document.body.style.overflow = 'hidden';
    setTimeout(function () { hub.style.opacity = '1'; }, 10);
}
function closeHubOverlay() {
    var hub = document.getElementById('co2lion-hub-overlay');
    if (!hub) return;
    hub.style.opacity = '0';
    document.body.style.overflow = '';
    setTimeout(function () { hub.style.display = 'none'; }, 300);
}
function cyclePhaseSidebar() {
    if (typeof setPhase !== 'function' || typeof PHASE === 'undefined') return;
    setPhase(PHASE >= 3 ? 1 : PHASE + 1);
}
"""


def main():
    index = INDEX.read_text(encoding="utf-8")
    if 'id="co2lion-hub-overlay"' in index:
        print("Already merged; skipping")
        return

    hub = HUB.read_text(encoding="utf-8")
    m = re.search(r"<body[^>]*>([\s\S]*?)<script>", hub)
    if not m:
        raise SystemExit("hub body not found")
    inner = m.group(1).strip()
    inner = inner.replace('<div class="topbar-right">', '<div class="topbar-right">' + CLOSE_BTN, 1)
    inner = inner.replace('onclick="toast(', 'onclick="showToast(')

    sm = re.search(r"<script>([\s\S]*?)</script>\s*</body>", hub)
    if not sm:
        raise SystemExit("hub script not found")
    hub_js = sm.group(1).rstrip()
    hub_js = re.sub(r"\nfunction toast\(m\)\s*\{\s*showToast\(m\);\s*\}\s*", "\n", hub_js)

    css = CSS.read_text(encoding="utf-8") + "\n#co2lion-hub-overlay { isolation: isolate; }\n"

    overlay = (
        f'<div id="co2lion-hub-overlay" style="{OVERLAY_STYLE}">\n'
        f"{inner}\n"
        f"<script>\n{HUB_JS_EXTRA}\n{hub_js}\n</script>\n"
        f"</div>\n"
    )

    if 'id="co2lion-hub-overlay-styles"' not in index:
        index = index.replace(
            "</head>",
            f'<style id="co2lion-hub-overlay-styles">\n{css}\n</style>\n</head>',
            1,
        )

    index = index.replace("</body>", overlay + "</body>", 1)

    # Header: open full hub instead of drawer modal
    index = index.replace(
        'onclick="toggleMemberDrawer()"',
        'onclick="openHubOverlay()"',
        1,
    )
    index = index.replace(
        '<span style="font-size:13px; font-weight:500;">全域中心</span>',
        '<span style="font-size:13px; font-weight:500;">进入全域中心</span>',
        1,
    )

    INDEX.write_text(index, encoding="utf-8")
    print("Merged hub overlay into index.html")


if __name__ == "__main__":
    main()
