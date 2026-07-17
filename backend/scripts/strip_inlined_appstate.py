"""Remove inlined AppState from factor-auth HTML modules."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "frontend"

REPLACEMENT = """<script>
/* embed=1：隐藏子页 chrome，由全域中心 iframe 承载 */
if(/[?&]embed=1/.test(location.search)) document.documentElement.setAttribute('data-embed','1');
</script>
<style>
html[data-embed="1"] .sidebar,
html[data-embed="1"] .topbar { display: none !important; }
html[data-embed="1"] .main-wrap { margin-left: 0 !important; width: 100% !important; }
html[data-embed="1"] .app { height: 100% !important; min-height: 0 !important; }
html[data-embed="1"] .main-scroll { flex: 1; min-height: 0 !important; overflow-y: auto !important; }
</style>
<script src="AppState.js"></script>
<script src="hengai-embed-boot.js"></script>
"""

PATTERN = re.compile(
    r"<script>\s*/\*\*?\s*\n\s*\* .*?AppState.*?</script>\s*(?=<style>)",
    re.DOTALL,
)


def main() -> None:
    for name in ("HengAI_工业原厂精算.html", "HengAI_核验.html"):
        path = ROOT / name
        text = path.read_text(encoding="utf-8")
        m = PATTERN.search(text)
        if not m:
            raise SystemExit(f"pattern not found: {name}")
        new_text = text[: m.start()] + REPLACEMENT + text[m.end() :]
        new_text = new_text.replace(
            "EventBus.emit(",
            "(typeof emitAppStateEvent==='function'?emitAppStateEvent:EventBus.emit)(",
        )
        path.write_text(new_text, encoding="utf-8")
        print(f"OK {name}: removed {m.end() - m.start()} chars")


if __name__ == "__main__":
    main()
