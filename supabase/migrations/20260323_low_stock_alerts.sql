-- Add low stock threshold to inventory items
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS low_stock_threshold numeric(14, 3) NULL;
  -- NULL means no alert configured

-- Table to track sent alerts (avoid spam - max 1 alert per item per 24h)
CREATE TABLE IF NOT EXISTS public.low_stock_alert_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.inventory_locations(id) ON DELETE CASCADE,
  current_qty numeric(14, 3) NOT NULL,
  threshold numeric(14, 3) NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS low_stock_alert_log_item_sent_idx
  ON public.low_stock_alert_log (item_id, location_id, sent_at DESC);
