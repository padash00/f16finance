-- Seniority tiers: effective_from date.
--
-- Goal: when a new seniority bonus tier is created, it must apply only to
-- shifts on or after a chosen date. Past shifts (before this date) must NOT
-- retroactively gain a seniority bonus, even if the operator has worked long
-- enough to qualify for the tier.

ALTER TABLE operator_salary_seniority_tiers
  ADD COLUMN IF NOT EXISTS effective_from date;

COMMENT ON COLUMN operator_salary_seniority_tiers.effective_from IS
  'Date from which this tier applies. Shifts dated before this are computed without the tier.';

-- Backfill all existing tiers with this week's Monday (2026-05-04) so that
-- past payouts stop including the seniority bonus retroactively.
UPDATE operator_salary_seniority_tiers
SET effective_from = '2026-05-04'
WHERE effective_from IS NULL;

ALTER TABLE operator_salary_seniority_tiers
  ALTER COLUMN effective_from SET DEFAULT CURRENT_DATE;
