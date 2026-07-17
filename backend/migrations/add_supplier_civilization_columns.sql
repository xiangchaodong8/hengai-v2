-- SupplierNode：代际追踪 + 商业文明策略锚点
ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS invited_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS is_insured BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE supplier_nodes ADD COLUMN IF NOT EXISTS is_white_listed BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS ix_supplier_nodes_invited_by ON supplier_nodes (invited_by_user_id);
