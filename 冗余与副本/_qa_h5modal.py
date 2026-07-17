# -*- coding: utf-8 -*-
"""H5 Modal & QR 客户端渲染 · 统一注入

在 4 个关键页面（全域中心、供应链协同、CBAM 测算工具、全域诊断报告）中：
 1. 清除任何已存在的 #h5-share-modal 及其脚本
 2. 注入全新的 H5 Modal（客户端 qr-lib.js 生成二维码，不再依赖外部 API）
 3. 确保 <script src="qr-lib.js"> 被引入
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent

TARGETS = [
    '全域中心.html',
    'HengAI_供应链协同.html',
    'HengAI_CBAM测算工具.html',
    'HengAI_全域诊断报告.html',
    'index.html',
]

# ─────────────────────────────────────────────────────────
# 新版 H5 Modal：客户端 qr-lib.js 生成 SVG 二维码
# ─────────────────────────────────────────────────────────
H5_MODAL_BLOCK = '''<!-- ═══════════════════════════════════════════
     H5 裂变二维码弹窗 · 客户端 qr-lib.js 渲染 · V2.0 QA
═══════════════════════════════════════════ -->
<div class="modal-overlay" id="h5-share-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.7); backdrop-filter:blur(5px); z-index:99999; align-items:center; justify-content:center;">
  <div style="background:#0f1320; border:1px solid #7f77dd; border-radius:16px; padding:24px; width:340px; text-align:center; position:relative; box-shadow:0 20px 60px rgba(0,0,0,0.6), 0 0 30px rgba(127,119,221,0.25); color:#e6e9f2; font-family:inherit;">
    <button onclick="document.getElementById('h5-share-modal').style.display='none'" style="position:absolute; top:12px; right:16px; background:none; border:none; color:#8a92a8; font-size:18px; cursor:pointer; line-height:1; font-family:inherit;">✕</button>
    <div style="font-size:14px; font-weight:bold; color:#e6e9f2; margin-bottom:8px;">邀请供应商完成 CL-IVC 极速填报</div>
    <div style="font-size:11px; color:#8a92a8; margin-bottom:16px; line-height:1.5;">对方扫码打开移动端安全页面，BOM 数据保留本地，仅向您反馈最终碳强度。</div>
    <div id="h5-qr-container" style="width:160px; height:160px; background:#fff; border-radius:12px; margin:0 auto 16px; display:flex; align-items:center; justify-content:center; border:4px solid #7f77dd; overflow:hidden; padding:4px;"><div style="font-size:10px;color:#444">加载中...</div></div>
    <div id="h5-invite-url" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:10px; font-size:11px; color:#93c5fd; word-break:break-all; margin-bottom:10px; font-family:ui-monospace,Consolas,monospace;">…</div>
    <div id="h5-invite-tip" style="font-size:10px; color:#f0c96b; margin-bottom:14px; line-height:1.5; display:none; text-align:left; background:rgba(240,201,107,0.08); border:1px solid rgba(240,201,107,0.25); border-radius:6px; padding:8px 10px;"></div>
    <button id="h5-copy-btn" style="width:100%; background:#7f77dd; color:#fff; border:none; border-radius:8px; padding:11px; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; transition:all .15s;" onmouseenter="this.style.transform='translateY(-1px)'" onmouseleave="this.style.transform='translateY(0)'" onclick="copyH5InviteLink()">复制专属邀请链接</button>
  </div>
</div>
<script src="qr-lib.js"></script>
<script>
(function(){
  function buildInviteUrl(){
    var loc = window.location;
    var base = loc.href;
    try {
      if (window.parent && window.parent !== window && window.parent.location && window.parent.location.origin === loc.origin) {
        base = window.parent.location.href;
      }
    } catch(e) {}
    var hashIdx = base.indexOf('#'); if (hashIdx >= 0) base = base.substring(0, hashIdx);
    var qIdx = base.indexOf('?'); if (qIdx >= 0) base = base.substring(0, qIdx);
    var slashIdx = base.lastIndexOf('/');
    if (slashIdx >= 0) base = base.substring(0, slashIdx + 1);
    var inviteId = 'WL' + Date.now().toString(36).slice(-5).toUpperCase();
    return { url: base + 'HengAI_Supplier_H5.html?invite_id=' + inviteId, isFile: loc.protocol === 'file:' };
  }
  function renderQR(container, url){
    container.innerHTML = '';
    if (typeof qrcode !== 'function') {
      container.innerHTML = '<div style="padding:12px;font-size:10px;color:#444;text-align:center;line-height:1.5;">QR 库未加载<br/>请用链接手动分享</div>';
      return;
    }
    try {
      var qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      // 使用 SVG 而非 img，完全本地化渲染
      var cellSize = 4, margin = 0;
      container.innerHTML = qr.createSvgTag({cellSize: cellSize, margin: margin, scalable: true});
      var svg = container.querySelector('svg');
      if (svg) { svg.setAttribute('width', '148'); svg.setAttribute('height', '148'); svg.style.display = 'block'; }
    } catch(e) {
      container.innerHTML = '<div style="padding:12px;font-size:10px;color:#b00;text-align:center;line-height:1.5;">二维码生成失败<br/>'+ (e && e.message ? e.message : '') +'</div>';
    }
  }
  window.openH5ShareModal = function(){
    var modal = document.getElementById('h5-share-modal');
    if (!modal) return;
    var info = buildInviteUrl();
    var container = document.getElementById('h5-qr-container');
    if (container) renderQR(container, info.url);
    var linkEl = document.getElementById('h5-invite-url');
    if (linkEl) linkEl.textContent = info.url;
    var tipEl = document.getElementById('h5-invite-tip');
    if (tipEl){
      if (info.isFile){
        tipEl.innerHTML = '⚠️ 当前为 <code style="color:#7f77dd">file://</code> 模式，手机扫码后无法访问本地文件。<br/>请在项目目录运行 <code style="color:#7f77dd;background:rgba(127,119,221,0.1);padding:1px 4px;border-radius:3px;">python -m http.server 8000</code>，再用 <code style="color:#7f77dd">http://局域网IP:8000</code> 访问本站。';
        tipEl.style.display = 'block';
      } else {
        tipEl.style.display = 'none';
      }
    }
    modal.style.display = 'flex';
  };
  window.copyH5InviteLink = function(){
    var linkEl = document.getElementById('h5-invite-url');
    var url = linkEl ? linkEl.textContent : '';
    if (!url || url === '…') return;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(
        function(){ alert('✓ 链接已复制！请发送给供应商。'); },
        function(){ window.prompt('请手动复制链接：', url); }
      );
    } else {
      window.prompt('请手动复制链接：', url);
    }
  };
})();
</script>
<!-- ═════════ END H5 MODAL ═════════ -->
'''

# 识别旧的 H5 Modal 块（从注释开始到 END H5 MODAL 或到下一个 <!-- 大节分隔 --> ）
OLD_MODAL_RE = re.compile(
    r'<!--[^\n]*H5[^\n]*-->[\s\S]*?<div[^>]*id="h5-share-modal"[\s\S]*?</div>\s*</div>\s*(?:<script[^>]*>[\s\S]*?</script>\s*){0,3}(?:<!--\s*═+\s*END\s+H5\s+MODAL\s*═+\s*-->\s*)?',
    re.IGNORECASE
)
# 兜底：如果没注释包裹，直接按 id 识别
BARE_MODAL_RE = re.compile(
    r'<div[^>]*id="h5-share-modal"[\s\S]*?</div>\s*</div>\s*(?:<script[^>]*>[\s\S]*?</script>\s*){0,3}',
    re.IGNORECASE
)

print("=" * 60)
print("H5 Modal 统一注入脚本")
print("=" * 60)

for fn in TARGETS:
    fp = ROOT / fn
    if not fp.exists():
        print(f"[MISS] {fn}")
        continue
    text = fp.read_text(encoding='utf-8')
    before = text

    removed_count = 0
    new_text = OLD_MODAL_RE.sub('', text)
    if new_text != text:
        removed_count = len(OLD_MODAL_RE.findall(text))
        text = new_text
    new_text = BARE_MODAL_RE.sub('', text)
    if new_text != text:
        removed_count += len(BARE_MODAL_RE.findall(text))
        text = new_text

    if '</body>' in text:
        text = text.replace('</body>', H5_MODAL_BLOCK + '\n</body>', 1)
        injected = True
    else:
        text = text + '\n' + H5_MODAL_BLOCK
        injected = True

    if text != before:
        fp.write_text(text, encoding='utf-8')
        print(f"[OK]   {fn}  removed_old={removed_count}  injected={injected}")
    else:
        print(f"[NOOP] {fn}")

print("=" * 60)
print("完成")
