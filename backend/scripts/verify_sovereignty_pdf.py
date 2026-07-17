"""Verify sovereignty template renders to multi-page PDF without truncation."""
from __future__ import annotations

import sys
import urllib.request

from sovereignty_template import build_sovereignty_letter_html

PDF_CSS = """
.hi-tpl-pdf{font-family:SimSun,serif;font-size:12pt;line-height:1.75;color:#111;margin:0;padding:0}
.hi-tpl-pdf h1{text-align:center;font-size:18pt;margin:0 0 6px}
.hi-tpl-pdf .section{margin:14px 0 6px;font-weight:700}
.hi-tpl-pdf .block{margin:6px 0;text-indent:2em}
.hi-tpl-pdf .footer{margin-top:20px;padding:10px;border:1px dashed #666;font-size:9pt}
.hi-tpl-pdf table{width:100%;border-collapse:collapse;margin:10px 0}
.hi-tpl-pdf th,.hi-tpl-pdf td{border:1px solid #333;padding:6px 8px}
"""

MARKERS = [
    "产业链数据主权授权书",
    "四、效力声明",
    "范本说明",
    "HEGC 合规专员人工核验",
]


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("SKIP: playwright not installed")
        return 0

    body = build_sovereignty_letter_html("测试钢铁有限公司", "91110000MA01234567")
    start = body.find("<body>") + 6
    end = body.find("</body>")
    inner = body[start:end]
    html = f"""<!DOCTYPE html><html><head><meta charset="UTF-8"><style>{PDF_CSS}</style></head>
<body><div class="hi-tpl-pdf">{inner}</div></body></html>"""

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 794, "height": 1123})
        page.set_content(html, wait_until="networkidle")
        pdf_bytes = page.pdf(
            format="A4",
            margin={"top": "12mm", "bottom": "14mm", "left": "12mm", "right": "12mm"},
            print_background=True,
        )
        browser.close()

    try:
        import fitz  # PyMuPDF
    except ImportError:
        print(f"OK: generated PDF bytes={len(pdf_bytes)} (install pymupdf for text check)")
        return 0

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    text = "".join(doc.load_page(i).get_text() for i in range(doc.page_count))
    missing = [m for m in MARKERS if m not in text]
    print(f"pages={doc.page_count} bytes={len(pdf_bytes)}")
    if doc.page_count < 2:
        print("WARN: expected >=2 pages for full letter")
    if missing:
        print("FAIL: missing markers:", missing)
        return 1
    if text.strip().startswith("\n\n\n"):
        print("WARN: large leading whitespace in PDF text")
    print("OK: all content markers present")
    return 0


if __name__ == "__main__":
    sys.exit(main())
