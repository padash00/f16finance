-- Create point_sale_returns table if it doesn't exist
CREATE TABLE IF NOT EXISTS point_sale_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES point_sales(id),
  company_id UUID NOT NULL,
  location_id UUID NOT NULL,
  operator_id UUID,
  return_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  reason TEXT,
  return_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_point_sale_returns_sale_id ON point_sale_returns(sale_id);
CREATE INDEX IF NOT EXISTS idx_point_sale_returns_date ON point_sale_returns(return_date);
CREATE INDEX IF NOT EXISTS idx_point_sale_returns_company ON point_sale_returns(company_id);
