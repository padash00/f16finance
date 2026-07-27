-- Фаза 1, шаг 2: дропаем старый barcode-индекс (organization_id, barcode).
-- ПРИМЕНЯТЬ ТОЛЬКО ПОСЛЕ деплоя 20260728 (Фаза 1a): код addStock развязан от
-- onConflict:'organization_id,barcode', поэтому индекс больше не нужен. После
-- дропа одинаковый штрихкод в двух разных магазинах становится допустим
-- (уникальность держит inventory_items_company_barcode_uidx (company_id, barcode)).

drop index if exists public.inventory_items_org_barcode_uidx;

notify pgrst, 'reload schema';
