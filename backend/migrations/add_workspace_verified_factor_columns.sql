-- V3.3 工业原厂因子确权（脱敏系数仅存库，工序绝对能耗禁止入库）
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS verified_factor NUMERIC(20, 4);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS verified_factor_yoy_pct NUMERIC(8, 4);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS verified_factor_cert_id VARCHAR(32);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS verified_factor_meta_json TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_verified_factor_cert
  ON workspaces (verified_factor_cert_id) WHERE verified_factor_cert_id IS NOT NULL;
