-- Salary rules: effective date for base salary change + revenue-based base condition
ALTER TABLE operator_salary_rules
  ADD COLUMN IF NOT EXISTS effective_from       date,
  ADD COLUMN IF NOT EXISTS base_per_shift_prev  numeric,
  ADD COLUMN IF NOT EXISTS low_turnover_threshold numeric,
  ADD COLUMN IF NOT EXISTS low_turnover_base     numeric;

COMMENT ON COLUMN operator_salary_rules.effective_from IS
  'When set, base_per_shift applies only to shifts on/after this date; older shifts use base_per_shift_prev';
COMMENT ON COLUMN operator_salary_rules.base_per_shift_prev IS
  'Previous base salary, used for shifts before effective_from';
COMMENT ON COLUMN operator_salary_rules.low_turnover_threshold IS
  'If shift turnover < this value, base salary becomes low_turnover_base instead of base_per_shift';
COMMENT ON COLUMN operator_salary_rules.low_turnover_base IS
  'Base salary to use when shift turnover is below low_turnover_threshold';

CREATE TABLE IF NOT EXISTS operator_salary_rule_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id bigint NOT NULL,
  effective_from date NOT NULL,
  base_per_shift numeric NOT NULL CHECK (base_per_shift >= 0),
  low_turnover_threshold numeric CHECK (low_turnover_threshold IS NULL OR low_turnover_threshold >= 0),
  low_turnover_base numeric CHECK (low_turnover_base IS NULL OR low_turnover_base >= 0),
  comment text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (rule_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_operator_salary_rule_versions_rule_date
  ON operator_salary_rule_versions(rule_id, effective_from DESC);

COMMENT ON TABLE operator_salary_rule_versions IS
  'Historical versions of operator salary rule base pay. Used so future salary changes do not rewrite old shifts.';
COMMENT ON COLUMN operator_salary_rule_versions.effective_from IS
  'Date from which this salary version applies.';

INSERT INTO operator_salary_rule_versions (
  rule_id,
  effective_from,
  base_per_shift,
  low_turnover_threshold,
  low_turnover_base,
  comment
)
SELECT
  id,
  COALESCE(effective_from, CURRENT_DATE),
  COALESCE(base_per_shift, 0),
  low_turnover_threshold,
  low_turnover_base,
  'Автоматически создано из текущего правила'
FROM operator_salary_rules
WHERE base_per_shift IS NOT NULL
ON CONFLICT (rule_id, effective_from) DO NOTHING;

CREATE TABLE IF NOT EXISTS operator_salary_seniority_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  min_months integer NOT NULL CHECK (min_months >= 0),
  bonus_percent numeric NOT NULL CHECK (bonus_percent >= 0 AND bonus_percent <= 15),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (min_months)
);

CREATE INDEX IF NOT EXISTS idx_operator_salary_seniority_tiers_active_months
  ON operator_salary_seniority_tiers(is_active, min_months);

COMMENT ON TABLE operator_salary_seniority_tiers IS
  'Configurable seniority bonus tiers for operator salary calculation.';
COMMENT ON COLUMN operator_salary_seniority_tiers.min_months IS
  'Full months worked from operator profile hire_date.';
COMMENT ON COLUMN operator_salary_seniority_tiers.bonus_percent IS
  'Percent added to base salary, capped by check constraint at 15.';
