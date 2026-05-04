-- Full snapshot versioning for operator salary rules.
--
-- Goal: when a manager changes ANY salary rule field (base, low_turnover_*,
-- senior_*_bonus, threshold*), past shifts must NOT be recalculated against
-- the new values. Only base_per_shift had partial versioning support before;
-- this migration extends operator_salary_rule_versions to a complete snapshot
-- and creates a historical anchor at '2020-01-01' so any pre-existing shift
-- finds a matching version.

ALTER TABLE operator_salary_rule_versions
  ADD COLUMN IF NOT EXISTS senior_operator_bonus numeric,
  ADD COLUMN IF NOT EXISTS senior_cashier_bonus  numeric,
  ADD COLUMN IF NOT EXISTS threshold1_turnover   numeric,
  ADD COLUMN IF NOT EXISTS threshold1_bonus      numeric,
  ADD COLUMN IF NOT EXISTS threshold2_turnover   numeric,
  ADD COLUMN IF NOT EXISTS threshold2_bonus      numeric;

COMMENT ON COLUMN operator_salary_rule_versions.senior_operator_bonus IS
  'Snapshot of senior_operator_bonus at this version effective_from.';
COMMENT ON COLUMN operator_salary_rule_versions.senior_cashier_bonus IS
  'Snapshot of senior_cashier_bonus at this version effective_from.';
COMMENT ON COLUMN operator_salary_rule_versions.threshold1_turnover IS
  'Snapshot of threshold1_turnover at this version effective_from.';
COMMENT ON COLUMN operator_salary_rule_versions.threshold1_bonus IS
  'Snapshot of threshold1_bonus at this version effective_from.';
COMMENT ON COLUMN operator_salary_rule_versions.threshold2_turnover IS
  'Snapshot of threshold2_turnover at this version effective_from.';
COMMENT ON COLUMN operator_salary_rule_versions.threshold2_bonus IS
  'Snapshot of threshold2_bonus at this version effective_from.';

-- 1. Backfill new columns on existing version rows (created by previous
--    migration) using current rule values. Best-effort: there is no historical
--    record of senior bonuses or thresholds, so we use today's snapshot.
UPDATE operator_salary_rule_versions v
SET
  senior_operator_bonus = r.senior_operator_bonus,
  senior_cashier_bonus  = r.senior_cashier_bonus,
  threshold1_turnover   = r.threshold1_turnover,
  threshold1_bonus      = r.threshold1_bonus,
  threshold2_turnover   = r.threshold2_turnover,
  threshold2_bonus      = r.threshold2_bonus
FROM operator_salary_rules r
WHERE v.rule_id = r.id
  AND v.senior_operator_bonus IS NULL
  AND v.senior_cashier_bonus IS NULL
  AND v.threshold1_turnover IS NULL
  AND v.threshold2_turnover IS NULL;

-- 2. Ensure every rule has a historical anchor at '2020-01-01' so any shift
--    dated before any explicit version still resolves to the pre-change snapshot.
--
--    base_per_shift: prefer base_per_shift_prev (user-marked old value),
--    fallback to current base_per_shift, fallback to 0.
--
--    low_turnover_*: when rule.effective_from is set we assume the condition
--    is a recent addition and store NULL on the historical anchor.
INSERT INTO operator_salary_rule_versions (
  rule_id,
  effective_from,
  base_per_shift,
  low_turnover_threshold,
  low_turnover_base,
  senior_operator_bonus,
  senior_cashier_bonus,
  threshold1_turnover,
  threshold1_bonus,
  threshold2_turnover,
  threshold2_bonus,
  comment
)
SELECT
  r.id,
  '2020-01-01'::date,
  COALESCE(r.base_per_shift_prev, r.base_per_shift, 0),
  CASE WHEN r.effective_from IS NOT NULL THEN NULL ELSE r.low_turnover_threshold END,
  CASE WHEN r.effective_from IS NOT NULL THEN NULL ELSE r.low_turnover_base END,
  r.senior_operator_bonus,
  r.senior_cashier_bonus,
  r.threshold1_turnover,
  r.threshold1_bonus,
  r.threshold2_turnover,
  r.threshold2_bonus,
  'Исторический якорь — значения до правки правила'
FROM operator_salary_rules r
WHERE r.base_per_shift IS NOT NULL
ON CONFLICT (rule_id, effective_from) DO NOTHING;
