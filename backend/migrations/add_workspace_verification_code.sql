-- GTCID 批次核验码 · 下游 CBAM 认领
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS verification_code VARCHAR(64);
CREATE UNIQUE INDEX IF NOT EXISTS uq_workspaces_verification_code
  ON workspaces (verification_code) WHERE verification_code IS NOT NULL;
