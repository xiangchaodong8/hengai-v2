from sqlalchemy import create_engine
# 导入刚刚生成的模型中的 Base 基类
from models import Base 

# ⚠️ 注意：这里是数据库的连接地址
# 'hengai_db' 是您 Docker 截图里的数据库容器名
# 如果您的密码或库名不是 postgres，请自行修改为您 docker-compose.yml 里的配置
SQLALCHEMY_DATABASE_URL = "postgresql://postgres:postgres@hengai_db:5432/postgres"

print("🚀 引擎点火中... 正在连接 PostgreSQL 数据库 [hengai_db]")

try:
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
    # 这行代码是核心：它会让 SQLAlchemy 读取 models.py 里的所有类，并在数据库里真实建表！
    Base.metadata.create_all(bind=engine)
    print("✅ 轰隆！建表指令执行完毕！请前往 DBeaver 查收您的数字帝国！")
except Exception as e:
    print("❌ 点火失败，请检查数据库连接配置：", e)