-- 增量对齐：models.py Workspace「V3.2 企业档案」字段（与 hub/overview SELECT 一致）
-- 在已有 workspaces 表上执行；可重复执行（IF NOT EXISTS）。
-- 用法示例（按你的 DATABASE_URL 调整）：
--   psql "$DATABASE_URL" -f backend/migrations/add_workspace_v32_profile_columns.sql

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS main_product VARCHAR(128);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS hs_code VARCHAR(32);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS annual_capacity_tons NUMERIC(14, 2);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS annual_export_tons NUMERIC(14, 2);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS export_countries VARCHAR(512);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS annual_power_kwh NUMERIC(18, 2);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS power_grid VARCHAR(16);
