# -*- coding: utf-8 -*-
"""One-off: strip demo 王磊 / 浙江星辰 / #0412 MOCK blocks from delivery_modules HTML."""
from __future__ import annotations

import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1] / "delivery_modules"

SUBS: list[tuple[str, str]] = [
    ("name:           '王磊',", "name:           '---',"),
    ("name:                   '浙江星辰汽配制造有限公司',", "name:                   '---',"),
    ("seatRegion:       '浙江',", "seatRegion:       '---',"),
    (
        "proposer:'王磊（Lv.5 #0412）', initDate:'2026-04-14', deadline:'2026-05-10',",
        "proposer:'---', initDate:'---', deadline:'---',",
    ),
    (
        "{ name:'王磊', id:'#0412', region:'浙江', level:'Lv.5', contribution:2840, voteRate:'100%', isMe:true },",
        "{ name:'---', id:'---', region:'---', level:'---', contribution:0, voteRate:'---', isMe:true },",
    ),
    ('placeholder="例：浙江星辰汽配制造有限公司"', 'placeholder="---"'),
]


def main() -> None:
    for p in sorted(ROOT.rglob("*.html")):
        raw = p.read_text(encoding="utf-8", errors="replace")
        out = raw
        for a, b in SUBS:
            out = out.replace(a, b)
        if out != raw:
            p.write_text(out, encoding="utf-8")
            print("updated", p.relative_to(ROOT.parent))


if __name__ == "__main__":
    main()
