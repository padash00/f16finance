-- Экран покупателя v2.10: QR «Оцените нас» на экране «Спасибо».
-- Ссылка на отзывы точки (2GIS/Google Maps) хранится в настройках чека.
alter table public.point_receipt_settings add column if not exists review_url text not null default '';
comment on column public.point_receipt_settings.review_url is 'Ссылка на страницу отзывов точки (2GIS/Google Maps) — QR на экране покупателя';
notify pgrst, 'reload schema';
