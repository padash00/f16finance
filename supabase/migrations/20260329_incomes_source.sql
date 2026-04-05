-- Add source column to incomes table for tracking income origin
alter table incomes add column if not exists source text;

-- Index for filtering by source (used in arena shift view)
create index if not exists incomes_source_idx on incomes (source, date);
