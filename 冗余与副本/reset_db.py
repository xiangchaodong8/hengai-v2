from sqlalchemy import create_engine
from models import Base 

# 这里的地址与您之前 init_db.py 保持一致
SQLALCHEMY_DATABASE_URL = "postgresql://postgres:postgres@hengai_db:5432/postgres"

print("⚠️ 正在强行拆除旧数据库表...")
try:
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
    # 这一句是核心：强行删掉旧的、有冲突的物理表
    Base.metadata.drop_all(bind=engine)
    print("✅ 旧表清理完毕！")
    
    # 重新按照最新的 models.py 浇筑新表
    Base.metadata.create_all(bind=engine)
    print("✅ 完美！新表已按双活认证标准重建完毕！")
except Exception as e:
    print("❌ 重建失败:", e)