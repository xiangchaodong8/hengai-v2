"""CL-COP 产业链数据主权授权书 · 正式范本（Word / HTML / PDF 渲染源）。"""
from __future__ import annotations

import html
from datetime import datetime, timezone


def _esc(v: str) -> str:
    return html.escape(str(v or "").strip())


def build_sovereignty_letter_html(
    company_name: str = "",
    credit_code: str = "",
) -> str:
    """完整 HTML 文档：Word 可直接打开，浏览器可预览。"""
    name = _esc(company_name) or "________________（请填写企业全称，与营业执照一致）"
    code = _esc(credit_code) or "________________（请填写 18 位统一社会信用代码）"
    today = datetime.now(timezone.utc).strftime("%Y年%m月%d日")

    return f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<title>CL-COP 产业链数据主权授权书</title>
<style>
  body {{ font-family: "SimSun", "宋体", "STSong", serif; font-size: 14pt; line-height: 1.9; color: #111; margin: 2.2cm 2.4cm; background: #fff; }}
  h1 {{ text-align: center; font-size: 22pt; letter-spacing: 6px; margin: 0 0 8px; font-weight: 700; }}
  .subtitle {{ text-align: center; font-size: 11pt; color: #444; margin-bottom: 28px; }}
  .meta {{ text-align: right; font-size: 11pt; color: #444; margin-bottom: 20px; }}
  .section {{ margin: 18px 0 10px; font-weight: 700; font-size: 13pt; }}
  .block {{ margin: 10px 0; text-indent: 2em; }}
  .clause {{ margin: 6px 0 6px 2em; text-indent: 0; }}
  .field {{ border-bottom: 1px solid #333; padding: 0 6px 2px; }}
  .sign {{ margin-top: 40px; line-height: 2.4; }}
  .sign-line {{ border-bottom: 1px solid #333; display: inline-block; min-width: 200px; }}
  .footer {{ margin-top: 32px; padding: 14px 16px; border: 1px dashed #666; font-size: 10.5pt; color: #444; line-height: 1.7; background: #fafafa; }}
  table {{ width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 12pt; }}
  th, td {{ border: 1px solid #333; padding: 8px 10px; text-align: left; vertical-align: top; }}
  th {{ background: #f0f0f0; width: 28%; }}
</style>
</head>
<body>
  <div class="meta">CL-COP 协议编号：（提交审核后分配）</div>
  <h1>产业链数据主权授权书</h1>
  <div class="subtitle">Industrial Origin · Data Sovereignty Authorization · HengAI Platform</div>

  <p class="block"><strong>授权方（企业）：</strong><span class="field">{name}</span></p>
  <p class="block"><strong>统一社会信用代码：</strong><span class="field">{code}</span></p>
  <p class="block"><strong>法定代表人：</strong><span class="field">________________</span></p>
  <p class="block"><strong>被授权人：</strong><span class="field">________________</span>　<strong>职务：</strong><span class="field">________________</span></p>
  <p class="block"><strong>被授权人身份证号：</strong><span class="field">________________</span></p>

  <div class="section">鉴于</div>
  <p class="block">授权方拟在 HengAI（Co2Lion）平台认领「工业原厂 · 因子精算」主权节点，开展单位产品碳强度因子本地精算、CL-IVC 官方确权及产业链下游核验服务。授权方确认已阅读《重工业核心数据保密承诺书》及平台数据主权规则，兹出具本授权书。</p>

  <div class="section">一、授权事项</div>
  <p class="block">授权方授权被授权人代表本企业办理下列事项（缺一不可）：</p>
  <p class="clause">1. 在 HengAI 平台完成企业身份关联、主权认领及「工业原厂 · 因子精算」战情室启用；</p>
  <p class="clause">2. 在本地终端开展工序矩阵精算，并申请 CL-IVC 官方因子确权及核验池存证；</p>
  <p class="clause">3. 向产业链下游配套企业提供经脱敏处理的单位产品碳强度及同比增减率摘要；</p>
  <p class="clause">4. 接收平台审核结论、补正通知及合规专员联系事项，并转达授权方决策层。</p>

  <div class="section">二、数据主权与保密</div>
  <p class="block">1. 工序级原始能耗绝对值、设备级明细数据<strong>仅保存在授权方本地终端（LOCAL_VAULT）</strong>，不上传至 HengAI 云端；</p>
  <p class="block">2. 本授权书及上传扫描件<strong>不包含</strong>任何工序能耗明细或商业秘密；</p>
  <p class="block">3. 被授权人不得超出本授权范围对外提供数据或签署文件。</p>

  <div class="section">三、授权期限</div>
  <p class="block">自 <span class="field">____年__月__日</span> 起至 <span class="field">____年__月__日</span> 止；期满前 30 日可申请续期。</p>

  <div class="section">四、效力声明</div>
  <p class="block">本授权书经授权方法定代表人或授权代理人签字并加盖企业公章（或合同专用章）后生效。平台接受的电子文件限于<strong>盖章扫描件 PDF 或高清照片</strong>，不接受未盖章 Word/txt 原稿作为最终凭证。</p>

  <table>
    <tr><th>提交核验要素</th><th>要求</th></tr>
    <tr><td>企业名称</td><td>须与营业执照及本授权书、平台表单填写完全一致</td></tr>
    <tr><td>信用代码</td><td>18 位统一社会信用代码，须清晰可辨</td></tr>
    <tr><td>签章</td><td>企业公章或合同专用章 + 法人/授权代理人签字</td></tr>
    <tr><td>文件形式</td><td>PDF 或 JPG/PNG 扫描件，四角完整、文字清晰</td></tr>
  </table>

  <div class="sign">
    <p>授权方（公章）：<span class="sign-line">&nbsp;</span></p>
    <p>法定代表人/授权代理人（签字）：<span class="sign-line">&nbsp;</span></p>
    <p>签署日期：{today}</p>
  </div>

  <div class="footer">
    <strong>【范本说明 · 请法务部门必读】</strong><br>
    1. 本文件为 CL-COP 标准<strong>完整范本</strong>（非要点摘要），可直接交法务审定、打印、签字盖章；<br>
    2. 审定后请打印纸质版或由法定代表人/授权代理人签字并<strong>加盖企业公章</strong>，再扫描为 PDF 上传；<br>
    3. 平台智能预审仅辅助比对名称/代码/签章，<strong>不能替代 HEGC 人工审核</strong>；<br>
    4. 信息涂改、缺章或与表单不一致的文件将被驳回；<br>
    5. 审核结论与合规责任以 HengAI HEGC 合规专员人工核验为准。
  </div>
</body>
</html>"""
