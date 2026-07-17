from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from models import User
from security import get_password_hash

# 数据库连接
SQLALCHEMY_DATABASE_URL = "postgresql://postgres:postgres@hengai_db:5432/postgres"
engine = create_engine(SQLALCHEMY_DATABASE_URL)
SessionLocal = sessionmaker(bind=engine)

print("🚁 正在启动上帝救援程序...")

# 任务 1：热更新表结构（无损增加备用邮箱字段）
try:
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN backup_email VARCHAR(255);"))
        conn.commit()
        print("✅ 成功为 users 表热追加 backup_email 字段！")
except Exception as e:
    print("⚠️ backup_email 字段可能已存在，跳过追加。")

# 任务 2：无损强制重置 Boss 密码
db = SessionLocal()
try:
    boss = db.query(User).filter(User.email == "boss@co2lion.com").first()
    if boss:
        # 强行将密码重置为 88888888
        boss.hashed_password = get_password_hash("88888888")
        # 绑定备用邮箱
        boss.backup_email = "admin@co2lion.com" 
        db.commit()
        print("🎉 救援成功！boss@co2lion.com 资产完好无损！")
        print("🔑 您的新密码已强制修改为: 88888888")
        print("📧 您的备用邮箱已绑定为: admin@co2lion.com")
    else:
        print("❌ 数据库中未找到 boss@co2lion.com，请检查之前是否拼写错误。")
except Exception as e:
    print("❌ 救援发生异常:", e)
finally:
    db.close()