"""
此脚本在容器内执行，精准修复 models.py 中的 AmbiguousForeignKeysError
问题根源：User.workspace_links relationship 缺少 foreign_keys 参数
执行：docker exec hengai_backend python /app/fix_relationships.py
"""

with open("/app/models.py", "r", encoding="utf-8") as f:
    content = f.read()

# ── 修复 1：User.workspace_links ──────────────────────────────────────
# 原始（有问题）：
old1 = '''    workspace_links: Mapped[list["UserWorkspaceLink"]] = relationship(
        "UserWorkspaceLink",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select",
    )'''

# 修复后（明确指定 foreign_keys）：
new1 = '''    workspace_links: Mapped[list["UserWorkspaceLink"]] = relationship(
        "UserWorkspaceLink",
        foreign_keys="UserWorkspaceLink.user_id",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select",
    )'''

if old1 in content:
    content = content.replace(old1, new1)
    print("✅ 修复 User.workspace_links foreign_keys")
else:
    # 尝试不带 foreign_keys 的宽松匹配并报告
    if "workspace_links" in content and "foreign_keys" not in content[content.find("workspace_links"):content.find("workspace_links")+300]:
        print("⚠️  workspace_links 定义与预期不完全匹配，请手动检查")
    else:
        print("ℹ️  workspace_links 已有 foreign_keys 或结构不同，跳过")

# ── 修复 2：User.gm_ledger_entries（lazy=dynamic 在 async 中不支持）──
old2 = '''    gm_ledger_entries: Mapped[list["GMLedger"]] = relationship(
        "GMLedger",
        foreign_keys="GMLedger.user_id",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="dynamic",
        order_by="GMLedger.created_at.desc()",
    )'''

new2 = '''    gm_ledger_entries: Mapped[list["GMLedger"]] = relationship(
        "GMLedger",
        foreign_keys="GMLedger.user_id",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select",
    )'''

if old2 in content:
    content = content.replace(old2, new2)
    print("✅ 修复 gm_ledger_entries lazy=dynamic -> select")
else:
    print("ℹ️  gm_ledger_entries 结构不同，跳过（如有 dynamic 请手动改为 select）")

# ── 修复 3：ai_conversations lazy=dynamic ────────────────────────────
old3 = '''    ai_conversations: Mapped[list["AIConversation"]] = relationship(
        "AIConversation",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="dynamic",
    )'''

new3 = '''    ai_conversations: Mapped[list["AIConversation"]] = relationship(
        "AIConversation",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select",
    )'''

if old3 in content:
    content = content.replace(old3, new3)
    print("✅ 修复 ai_conversations lazy=dynamic -> select")
else:
    print("ℹ️  ai_conversations 结构不同，跳过")

# ── 修复 4：referrals lazy=dynamic ──────────────────────────────────
old4 = '''    referrals: Mapped[list["User"]] = relationship(
        "User",
        foreign_keys="User.referrer_user_id",
        back_populates="referrer",
        lazy="dynamic",
    )'''

new4 = '''    referrals: Mapped[list["User"]] = relationship(
        "User",
        foreign_keys="User.referrer_user_id",
        back_populates="referrer",
        lazy="select",
    )'''

if old4 in content:
    content = content.replace(old4, new4)
    print("✅ 修复 referrals lazy=dynamic -> select")
else:
    print("ℹ️  referrals 结构不同，跳过")

# ── 修复 5：invited_suppliers lazy=dynamic ───────────────────────────
old5 = '''    invited_suppliers: Mapped[list["SupplierData"]] = relationship(
        "SupplierData",
        foreign_keys="SupplierData.chain_master_id",
        back_populates="chain_master",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )'''

new5 = '''    invited_suppliers: Mapped[list["SupplierData"]] = relationship(
        "SupplierData",
        foreign_keys="SupplierData.chain_master_id",
        back_populates="chain_master",
        lazy="select",
        cascade="all, delete-orphan",
    )'''

if old5 in content:
    content = content.replace(old5, new5)
    print("✅ 修复 invited_suppliers lazy=dynamic -> select")
else:
    print("ℹ️  invited_suppliers 结构不同，跳过")

# ── 修复 6：cbam_reports lazy=dynamic ───────────────────────────────
old6 = '''    cbam_reports: Mapped[list["CBAMReport"]] = relationship(
        "CBAMReport",
        foreign_keys="CBAMReport.user_id",
        back_populates="user",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )'''

new6 = '''    cbam_reports: Mapped[list["CBAMReport"]] = relationship(
        "CBAMReport",
        foreign_keys="CBAMReport.user_id",
        back_populates="user",
        lazy="select",
        cascade="all, delete-orphan",
    )'''

if old6 in content:
    content = content.replace(old6, new6)
    print("✅ 修复 cbam_reports lazy=dynamic -> select")
else:
    print("ℹ️  cbam_reports 结构不同，跳过")

# ── 修复 7：invite_codes lazy=dynamic ───────────────────────────────
old7 = '''    invite_codes: Mapped[list["InviteCode"]] = relationship(
        "InviteCode",
        foreign_keys="InviteCode.user_id",
        back_populates="user",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )'''

new7 = '''    invite_codes: Mapped[list["InviteCode"]] = relationship(
        "InviteCode",
        foreign_keys="InviteCode.user_id",
        back_populates="user",
        lazy="select",
        cascade="all, delete-orphan",
    )'''

if old7 in content:
    content = content.replace(old7, new7)
    print("✅ 修复 invite_codes lazy=dynamic -> select")
else:
    print("ℹ️  invite_codes 结构不同，跳过")

# ── 写回文件 ─────────────────────────────────────────────────────────
with open("/app/models.py", "w", encoding="utf-8") as f:
    f.write(content)
print("\n✅ models.py 已写回")

# ── 验证：尝试导入模型，触发 relationship 解析 ────────────────────────
print("\n正在验证修复结果（导入所有模型）...")
import importlib, sys

# 清除所有相关模块缓存，强制重新加载
for mod in ["models", "database"]:
    if mod in sys.modules:
        del sys.modules[mod]

try:
    import models
    # 触发 mapper 配置
    from sqlalchemy.orm import configure_mappers
    configure_mappers()
    print("✅ 所有 relationship 解析通过，无 AmbiguousForeignKeysError！")
    print(f"   共 {len(models.Base.metadata.tables)} 张表已注册")
except Exception as e:
    print(f"❌ 仍有错误：{e}")
    print("   请把此输出截图发给我")
