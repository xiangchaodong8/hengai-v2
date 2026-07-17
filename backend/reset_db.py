import asyncio
from database import engine
from models import Base

async def reset_database():
    print("🔄 正在连接高并发异步数据库，准备物理重置...")
    async with engine.begin() as conn:
        # 强制删除所有旧表
        await conn.run_sync(Base.metadata.drop_all)
        print("🗑️ 旧的残缺表结构已全部摧毁！")
        
        # 按照最新的 models.py 重新建表
        await conn.run_sync(Base.metadata.create_all)
        print("✨ 新表已根据最新模型重建完成！")
        
    print("✅ 数据库洗髓换血大功告成！")

if __name__ == "__main__":
    # 启动异步事件循环
    asyncio.run(reset_database())