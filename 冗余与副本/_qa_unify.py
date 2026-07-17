# -*- coding: utf-8 -*-
"""HengAI 全域中心 V2.0 终极 QA 脚本
====================================
任务 1 · 清剿死链：onclick 中残留的 navTo / navLocked / loadInFrame → MPA window.location.href
任务 2 · 侧栏统一：所有目标文件的 .sidebar 块强制覆盖为正典版（含返回对话按钮 + 4 版块 14 项 + 自动 active）
任务辅助 · 基线 CSS：通过 <style id="qa-sidebar-css"> 注入，保障老版页面渲染不翻车

Idempotent：重复执行不会二次注入（通过标记 id 检测）
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent

# ─────────────────────────────────────────────────────────
# 1. 菜单项 pageId → 实体文件路径
# ─────────────────────────────────────────────────────────
NAV_MAP = {
    'overview'  : '全域中心.html',
    'achieve'   : 'HengAI_星火成就档案.html',
    'calc'      : 'HengAI_CBAM测算工具.html',
    'resource'  : 'HengAI_算力资源.html',
    'knowledge' : 'HengAI_法规知识库.html',
    'enterprise': 'HengAI_企业数字档案.html',
    'supply'    : 'HengAI_供应链协同.html',
    'report'    : 'HengAI_全域诊断报告.html',
    'decision'  : 'HengAI_决策层呈送包生成器.html',
    'honor'     : 'HengAI_荣誉体系.html',
    'gov'       : 'HengAI_Governance.html',
    'wallet'    : 'HengAI_GM_Wallet.html',
    'eu'        : 'HengAI_EU_Customs.html',
    'dld'       : 'HengAI_DLD_Credit.html',
    'acf'       : 'HengAI_ACF_Cert.html',
}

TARGETS = list(NAV_MAP.values())

# ─────────────────────────────────────────────────────────
# 2. 正典基线 CSS（作用域限定在 .sidebar 内，避免污染主区）
# ─────────────────────────────────────────────────────────
CANONICAL_CSS = """<style id="qa-sidebar-css">
/* HengAI V2.0 QA · 全站统一侧栏基线
   设计原则：
   1. 容器级规则使用 :where() 零特异性 —— 页面自己的 .sidebar{} 原生规则优先
   2. 内部元素 (.sb-brand/.sb-item/...) 使用普通选择器 —— 提供基线视觉
   3. 不动 .main —— 每页主区偏移由自家 CSS 决定（不污染 flex 布局）
*/
:where(.sidebar#sidebar[data-qa-version="2.0"]){width:200px;background:#0b0f19;border-right:1px solid rgba(255,255,255,0.06);display:flex;flex-direction:column;position:fixed;left:0;top:0;bottom:0;z-index:50;overflow-y:auto;font-family:inherit}
.sidebar .sb-brand{padding:17px 15px 13px;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;align-items:center;gap:10px;flex-shrink:0}
.sidebar .sb-brand-ic{width:32px;height:32px;border-radius:9px;background:rgba(16,185,129,0.12);border:1px solid rgba(16,185,129,0.3);display:flex;align-items:center;justify-content:center;flex-shrink:0}
.sidebar .sb-brand-name{font-size:14px;font-weight:700;letter-spacing:.2px;color:#e6e9f2}
.sidebar .sb-brand-sub{font-size:9.5px;color:#8a92a8;margin-top:1px}
.sidebar .sb-group-title{font-size:9.5px;text-transform:uppercase;color:#8a92a8;letter-spacing:.6px;padding:14px 18px 6px;font-weight:600}
.sidebar .sb-item{padding:9px 18px;font-size:12.5px;color:#c3cbdc;cursor:pointer;display:flex;align-items:center;gap:9px;transition:all .12s;border-left:2px solid transparent;font-family:inherit;line-height:1.3}
.sidebar .sb-item:hover{background:rgba(255,255,255,0.03);color:#e6e9f2}
.sidebar .sb-item.active{background:rgba(16,185,129,0.08);border-left-color:#10b981;color:#e6e9f2;font-weight:600}
.sidebar .sb-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
/* 嵌入模式（?embed=1）：只露内容，侧栏/顶栏/老 .sb 全部隐藏，主区 margin 归零 */
html[data-embed="1"] .sidebar,html[data-embed="1"] .sb,html[data-embed="1"] .topbar{display:none !important}
html[data-embed="1"] body{padding-left:0 !important}
html[data-embed="1"] .main,html[data-embed="1"] .main-wrap,html[data-embed="1"] .main-content{margin-left:0 !important}
</style>"""

# ─────────────────────────────────────────────────────────
# 3. 正典侧栏 HTML（全站 100% 一致）
# ─────────────────────────────────────────────────────────
CANONICAL_SIDEBAR = '''<!-- CANONICAL SIDEBAR — HengAI V2.0 QA 统一版 -->
<div class="sidebar" id="sidebar" data-qa-version="2.0">
  <div class="sb-brand">
    <div class="sb-brand-ic">
      <img src="logo.png" alt="HengAI" style="width:22px;height:22px;object-fit:contain;" onerror="this.outerHTML='<svg width=\\'16\\' height=\\'16\\' viewBox=\\'0 0 16 16\\' fill=\\'none\\'><path d=\\'M8 1.5L14 5V11L8 14.5L2 11V5L8 1.5Z\\' stroke=\\'%2310b981\\' stroke-width=\\'1.2\\' fill=\\'rgba(16,185,129,.15)\\'/><polyline points=\\'5,8 7.5,10.5 11.5,6.5\\' stroke=\\'%236ee7b7\\' stroke-width=\\'1.4\\' stroke-linecap=\\'round\\'/></svg>'">
    </div>
    <div>
      <div class="sb-brand-name">HengAI</div>
      <div class="sb-brand-sub">Co2Lion 全域合规中心</div>
    </div>
  </div>

  <!-- 逃生舱：返回 HengAI 对话大厅 -->
  <div style="padding:12px 14px 4px;">
    <div onclick="window.location.href='index.html'" style="cursor:pointer;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;padding:9px 12px;color:#10b981;font-weight:600;font-size:12px;display:flex;align-items:center;justify-content:center;gap:8px;box-shadow:0 0 10px rgba(16,185,129,0.1);transition:all .15s;" onmouseenter="this.style.background='rgba(16,185,129,0.18)'" onmouseleave="this.style.background='rgba(16,185,129,0.1)'">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 7H13M1 7L5 3M1 7L5 11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
      返回 HengAI 对话
    </div>
  </div>

  <div class="sb-group-title">个人工作台</div>
  <div class="sb-item" data-page="overview"   onclick="window.location.href='全域中心.html'"><div class="sb-dot" style="background:#10b981"></div>全域总览</div>
  <div class="sb-item" data-page="achieve"    onclick="window.location.href='HengAI_星火成就档案.html'"><div class="sb-dot" style="background:#c9a84c"></div>星火成就档案</div>
  <div class="sb-item" data-page="calc"       onclick="window.location.href='HengAI_CBAM测算工具.html'"><div class="sb-dot" style="background:#c9a84c"></div>CBAM 测算工具</div>
  <div class="sb-item" data-page="resource"   onclick="window.location.href='HengAI_算力资源.html'"><div class="sb-dot" style="background:#93c5fd"></div>算力资源</div>
  <div class="sb-item" data-page="knowledge"  onclick="window.location.href='HengAI_法规知识库.html'"><div class="sb-dot" style="background:#c4b5fd"></div>企业法规库</div>

  <div class="sb-group-title">企业工作台</div>
  <div class="sb-item" data-page="enterprise" onclick="window.location.href='HengAI_企业数字档案.html'"><div class="sb-dot" style="background:#6dd5b0"></div>企业数字档案</div>
  <div class="sb-item" data-page="supply"     onclick="window.location.href='HengAI_供应链协同.html'"><div class="sb-dot" style="background:#6dd5b0"></div>供应链协同</div>
  <div class="sb-item" data-page="report"     onclick="window.location.href='HengAI_全域诊断报告.html'"><div class="sb-dot" style="background:#93c5fd"></div>全域诊断报告</div>
  <div class="sb-item" data-page="decision"   onclick="window.location.href='HengAI_决策层呈送包生成器.html'"><div class="sb-dot" style="background:#c9a84c"></div>决策层呈送包</div>

  <div class="sb-group-title">大国重器</div>
  <div class="sb-item" data-page="honor"      onclick="window.location.href='HengAI_荣誉体系.html'"><div class="sb-dot" style="background:#c4b5fd"></div>荣誉体系</div>
  <div class="sb-item" data-page="gov"        onclick="window.location.href='HengAI_Governance.html'"><div class="sb-dot" style="background:#6dd5b0"></div>生态共治委员会</div>

  <div class="sb-group-title">深潜模块</div>
  <div class="sb-item" data-page="wallet"     onclick="window.location.href='HengAI_GM_Wallet.html'"><div class="sb-dot" style="background:#c9a84c"></div>GM 绿印钱包</div>
  <div class="sb-item" data-page="eu"         onclick="window.location.href='HengAI_EU_Customs.html'"><div class="sb-dot" style="background:#93c5fd"></div>欧盟海关直连</div>
  <div class="sb-item" data-page="dld"        onclick="window.location.href='HengAI_DLD_Credit.html'"><div class="sb-dot" style="background:#10b981"></div>DLD 绿色信贷</div>
  <div class="sb-item" data-page="acf"        onclick="window.location.href='HengAI_ACF_Cert.html'"><div class="sb-dot" style="background:#6dd5b0"></div>ACF 大湾区认证</div>
</div>
<script id="qa-sidebar-active-script">
/* 基于当前文件名自动高亮对应菜单项（全站共用） */
(function(){
  var map = {"全域中心.html":"overview","index.html":"overview","HengAI_星火成就档案.html":"achieve","HengAI_CBAM测算工具.html":"calc","HengAI_算力资源.html":"resource","HengAI_法规知识库.html":"knowledge","HengAI_企业数字档案.html":"enterprise","HengAI_供应链协同.html":"supply","HengAI_全域诊断报告.html":"report","HengAI_决策层呈送包生成器.html":"decision","HengAI_荣誉体系.html":"honor","HengAI_Governance.html":"gov","HengAI_GM_Wallet.html":"wallet","HengAI_EU_Customs.html":"eu","HengAI_DLD_Credit.html":"dld","HengAI_ACF_Cert.html":"acf"};
  try {
    var fn = decodeURIComponent((location.pathname.split("/").pop() || "").split("?")[0]);
    var id = map[fn]; if (!id) return;
    document.querySelectorAll(".sidebar .sb-item[data-page]").forEach(function(el){
      if (el.getAttribute("data-page") === id) el.classList.add("active");
    });
  } catch(e){}
})();
</script>
'''

# ─────────────────────────────────────────────────────────
# 4. 工具：平衡 div 匹配 .sidebar 起止位置
# ─────────────────────────────────────────────────────────
DIV_TOKEN_RE = re.compile(r'<(/?)div\b[^>]*>', re.IGNORECASE)

def find_sidebar_span(text):
    """同时识别 .sidebar / .sb / .sb-xxx 根节点（老模板常用）"""
    comment_prefix_re = re.compile(r'<!--[^\n]*\b(SIDEBAR|侧栏|侧边栏)\b[\s\S]*?-->\s*', re.IGNORECASE)
    # 候选起点：兼容 sidebar / sb 作为独立 class
    candidates = []
    for m in re.finditer(r'<div\s+class="(sidebar|sb)(?:\s[^"]*)?"', text, re.IGNORECASE):
        candidates.append(m.start())
    if not candidates:
        return None
    start = min(candidates)
    lookback = max(0, start - 600)
    pre_hits = list(comment_prefix_re.finditer(text, lookback, start + 50))
    extended_start = start
    for m in pre_hits:
        if m.end() <= start + 50 and m.end() >= start - 4:
            extended_start = m.start()
            break

    depth = 0
    for m in DIV_TOKEN_RE.finditer(text, start):
        if m.group(1) == '/':
            depth -= 1
            if depth == 0:
                return (extended_start, m.end())
        else:
            depth += 1
    return None


# ─────────────────────────────────────────────────────────
# 5. 死链清剿：navTo / navLocked / loadInFrame 在 onclick 中
# ─────────────────────────────────────────────────────────
# onclick="navTo('xxx', <任意嵌套表达式>)"  —— 匹配到 onclick 结束双引号
ONCLICK_NAVTO_RE      = re.compile(r'''onclick\s*=\s*"(nav(?:To|Locked))\(\s*['"]([a-zA-Z_][\w\-]*)['"][^"]*"''')
# onclick="navTo(\'xxx\', …)"   —— JS 字符串拼接中转义写法（\' 代替 '）
ONCLICK_NAVTO_ESC_RE  = re.compile(r'''onclick\s*=\s*"(nav(?:To|Locked))\(\s*\\['"]([a-zA-Z_][\w\-]*)\\['"][^"]*"''')
ONCLICK_LIF_RE        = re.compile(r'''onclick\s*=\s*"loadInFrame\(\s*['"]([^'"]+)['"][^"]*"''')
ONCLICK_LIF_ESC_RE    = re.compile(r'''onclick\s*=\s*"loadInFrame\(\s*\\['"]([^'"\\]+)\\['"][^"]*"''')


def rewire_dead_links(text, file_stats):
    def navto_sub(m):
        arg = m.group(2)
        target = NAV_MAP.get(arg)
        if target:
            file_stats['navto'] += 1
            return f'onclick="window.location.href=\'{target}\'"'
        return m.group(0)

    def navto_esc_sub(m):
        arg = m.group(2)
        target = NAV_MAP.get(arg)
        if target:
            file_stats['navto'] += 1
            # 嵌在 JS 字符串里，外层 HTML 仍用 "…"，内层用转义 \'…\'
            return f"onclick=\"window.location.href=\\'{target}\\'\""
        return m.group(0)

    text = ONCLICK_NAVTO_RE.sub(navto_sub, text)
    text = ONCLICK_NAVTO_ESC_RE.sub(navto_esc_sub, text)

    def lif_sub(m):
        file_stats['loadInFrame'] += 1
        return f'onclick="window.location.href=\'{m.group(1)}\'"'

    def lif_esc_sub(m):
        file_stats['loadInFrame'] += 1
        return f"onclick=\"window.location.href=\\'{m.group(1)}\\'\""

    text = ONCLICK_LIF_RE.sub(lif_sub, text)
    text = ONCLICK_LIF_ESC_RE.sub(lif_esc_sub, text)

    return text


# ─────────────────────────────────────────────────────────
# 6. 主流程：遍历所有目标文件
# ─────────────────────────────────────────────────────────
print("=" * 60)
print("HengAI V2.0 QA 统一脚本启动")
print("=" * 60)

for fn in TARGETS:
    fp = ROOT / fn
    if not fp.exists():
        print(f"[MISS] {fn}")
        continue
    text = fp.read_text(encoding='utf-8')
    original_len = len(text)
    stats = {'navto': 0, 'loadInFrame': 0, 'sidebar_replaced': False, 'css_injected': False}

    # 1a) 先清除之前运行留下的重复 canonical 注释 + 重复 active-script
    text = re.sub(r'(<!--[^\n]*CANONICAL SIDEBAR[\s\S]*?-->\s*)', '', text)
    text = re.sub(r'(<!--\s*═+\s*\n\s*CANONICAL SIDEBAR[\s\S]*?═+\s*-->\s*)', '', text)
    text = re.sub(r'<script id="qa-sidebar-active-script">[\s\S]*?</script>\s*', '', text)

    # 1b) 替换 .sidebar 块
    span = find_sidebar_span(text)
    if span:
        text = text[:span[0]] + CANONICAL_SIDEBAR + text[span[1]:]
        stats['sidebar_replaced'] = True
    else:
        print(f"[WARN] {fn} no .sidebar block found")

    # 2) 注入基线 CSS（先删旧版，再注入最新版——版本化处理）
    text = re.sub(r'<style id="qa-sidebar-css">[\s\S]*?</style>\s*', '', text)
    if '</head>' in text:
        text = text.replace('</head>', CANONICAL_CSS + '\n</head>', 1)
        stats['css_injected'] = True

    # 3) 死链清剿
    text = rewire_dead_links(text, stats)

    # 3b) 全域中心.html 特殊处理：overview/enterprise/supply/honor 保留 SPA 面板切换
    #     （这 4 个模块在本页有 iframe 嵌入面板，SPA 切换才有 "?embed=1" 无边框全幅体验）
    if fn == '全域中心.html':
        HUB_SPA_MAP = {
            'overview'  : ('navTo',      'overview'),
            'enterprise': ('navLocked',  'enterprise'),
            'supply'    : ('navLocked',  'supply'),
            'honor'     : ('navTo',      'honor'),
        }
        for page_id, (fn_name, arg) in HUB_SPA_MAP.items():
            pat = re.compile(
                r'(<div class="sb-item" data-page="' + page_id + r'"\s+)onclick="window\.location\.href=\'[^\']+\'"',
            )
            repl = r'\1onclick="' + fn_name + '(\'' + arg + '\', this)"'
            text, n = pat.subn(repl, text)
            if n:
                stats[f'hub_spa_{page_id}'] = n

    # 4) 写回
    if text != fp.read_text(encoding='utf-8'):
        fp.write_text(text, encoding='utf-8')
        print(f"[OK]   {fn}  sidebar={stats['sidebar_replaced']}  css={stats['css_injected']}  navTo×{stats['navto']}  LIF×{stats['loadInFrame']}")
    else:
        print(f"[NOOP] {fn}")

print("=" * 60)
print("完成")
