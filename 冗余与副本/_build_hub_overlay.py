# -*- coding: utf-8 -*-
"""Prefix 全域中心.html <style> selectors with #co2lion-hub-overlay for embedding in index.html."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HUB = ROOT / "全域中心.html"
OUT_CSS = ROOT / "_co2lion_hub_scoped.css"
OUT_SNIP = ROOT / "_co2lion_hub_snippet.html"  # optional debug

PREFIX = "#co2lion-hub-overlay "


def strip_comments(css: str) -> str:
    return re.sub(r"/\*[\s\S]*?\*/", "", css)


def prefix_selector_list(sel: str) -> str:
    sel = sel.strip()
    if not sel:
        return sel
    parts = [p.strip() for p in re.split(r",(?![^(]*\))", sel) if p.strip()]
    out = []
    for p in parts:
        if p.startswith(":root"):
            rest = p[5:].lstrip()
            out.append("#co2lion-hub-overlay" + ((" " + rest) if rest else ""))
        elif p == "body":
            out.append("#co2lion-hub-overlay")
        elif p == "*":
            out.append("#co2lion-hub-overlay *")
        elif p.startswith("html"):
            out.append(PREFIX + p)
        else:
            out.append(PREFIX + p)
    return ", ".join(out)


def next_brace_block(s: str, start: int):
    """Find first '{' at or after start, return (selector_start, body_start, body_end_exclusive) where body_end points after closing }."""
    i = start
    while i < len(s) and s[i] != "{":
        i += 1
    if i >= len(s):
        return None
    sel = s[start:i]
    i += 1  # past {
    depth = 1
    j = i
    while j < len(s) and depth:
        c = s[j]
        if c == '"' or c == "'":
            q = c
            j += 1
            while j < len(s):
                if s[j] == "\\":
                    j += 2
                    continue
                if s[j] == q:
                    j += 1
                    break
                j += 1
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        j += 1
    return (start, i, j - 1)  # body s[i:j-1], closing } at j-1


def process_block(css: str, start: int, end: int) -> str:
    """Process css[start:end] (exclusive end) returning prefixed CSS."""
    parts = []
    pos = start
    while pos < end:
        while pos < end and css[pos] in " \t\n\r":
            parts.append(css[pos])
            pos += 1
        if pos >= end:
            break
        if css[pos] == "@":
            # @import must allow semicolons inside url() query string
            m = re.match(r"@import\s+url\([^)]+\)\s*;", css[pos:end], re.IGNORECASE)
            if m:
                parts.append(m.group(0))
                pos += len(m.group(0))
                continue
            m = re.match(r"@charset\s+[^;]+;", css[pos:end], re.IGNORECASE)
            if m:
                parts.append(m.group(0))
                pos += len(m.group(0))
                continue
            m2 = re.match(r"@(keyframes|media|supports)[^{]*\{", css[pos:end], re.IGNORECASE)
            if not m2:
                # unknown @rule — copy until next ; or {
                semi = css.find(";", pos, end)
                br = css.find("{", pos, end)
                if br == -1 or (semi != -1 and semi < br):
                    if semi != -1:
                        parts.append(css[pos : semi + 1])
                        pos = semi + 1
                    else:
                        parts.append(css[pos:end])
                        pos = end
                    continue
            name_end = css.find("{", pos, end)
            head = css[pos : name_end + 1]
            inner_start = name_end + 1
            depth = 1
            j = inner_start
            while j < end and depth:
                c = css[j]
                if c in "\"'":
                    q = c
                    j += 1
                    while j < end:
                        if css[j] == "\\":
                            j += 2
                            continue
                        if css[j] == q:
                            j += 1
                            break
                        j += 1
                    continue
                if c == "{":
                    depth += 1
                elif c == "}":
                    depth -= 1
                j += 1
            inner = css[inner_start : j - 1]
            at_name = head.strip().split()[0].lower()
            if at_name.startswith("@keyframes"):
                parts.append(head + inner + "}")
                pos = j
                continue
            # @media / @supports: prefix inner as a block
            parts.append(head + process_block(inner, 0, len(inner)) + "}")
            pos = j
            continue
        # normal rule
        blk = next_brace_block(css, pos)
        if not blk:
            parts.append(css[pos:end])
            break
        sel_start, body_start, close_brace = blk
        sel_raw = css[sel_start : body_start - 1]
        body = css[body_start:close_brace]
        parts.append(prefix_selector_list(sel_raw) + "{" + body + "}")
        pos = close_brace + 1
    return "".join(parts)


def main():
    raw = HUB.read_text(encoding="utf-8")
    m = re.search(r"<style>([\s\S]*?)</style>", raw)
    if not m:
        raise SystemExit("No <style> in hub file")
    css = strip_comments(m.group(1))
    scoped = process_block(css, 0, len(css))
    scoped = re.sub(r"^:root\s*\{", "#co2lion-hub-overlay {", scoped, count=1, flags=re.MULTILINE)
    OUT_CSS.write_text(scoped, encoding="utf-8")
    print("Wrote", OUT_CSS, "chars", len(scoped))


if __name__ == "__main__":
    main()
