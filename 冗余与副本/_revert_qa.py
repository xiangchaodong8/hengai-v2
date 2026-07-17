# -*- coding: utf-8 -*-
"""QA 回滚脚本：针对 4 个"越改越乱"的文件，剥离所有 QA 期注入物
恢复手段：
  1. 移除 <style id="qa-sidebar-css">...</style>
  2. 移除 <script id="qa-sidebar-active-script">...</script>
  3. 移除 CANONICAL SIDEBAR 注释头
保留：
  - 侧栏 HTML 本身（无法从 transcript 恢复原始 DOM）
  - H5 Modal（hidden 默认不影响版式）
  - onclick 逻辑（前一步已对 hub 特判回滚）
这样页面自己的原生 CSS (.sidebar / .sb / .sb-brand / .logo-area / ...) 会重新主导渲染
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent

TARGETS = [
    '全域中心.html',
    'HengAI_企业数字档案.html',
    'HengAI_供应链协同.html',
    'HengAI_荣誉体系.html',
]

for fn in TARGETS:
    fp = ROOT / fn
    if not fp.exists():
        print(f"[MISS] {fn}")
        continue
    text = fp.read_text(encoding='utf-8')
    before = len(text)
    removed = []

    # 1. 剥离 QA 注入的 CSS 块
    new_text, n = re.subn(r'<style id="qa-sidebar-css">[\s\S]*?</style>\s*', '', text)
    if n:
        removed.append(f'qa-css×{n}')
        text = new_text

    # 2. 剥离 QA 注入的 active-script 块
    new_text, n = re.subn(r'<script id="qa-sidebar-active-script">[\s\S]*?</script>\s*', '', text)
    if n:
        removed.append(f'qa-js×{n}')
        text = new_text

    # 3. 剥离 CANONICAL SIDEBAR 头/脚注释
    new_text, n = re.subn(r'<!--[^\n]*CANONICAL SIDEBAR[\s\S]*?-->\s*', '', text)
    if n:
        removed.append(f'qa-comment×{n}')
        text = new_text

    after = len(text)
    if text != fp.read_text(encoding='utf-8'):
        fp.write_text(text, encoding='utf-8')
        print(f"[REVERTED] {fn}  bytes: {before} -> {after} ({after-before:+d})  removed: {', '.join(removed) or '(none)'}")
    else:
        print(f"[NOOP]     {fn}  (already clean)")
