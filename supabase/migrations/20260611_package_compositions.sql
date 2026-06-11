-- Обогащаем составы отраслевых пакетов (feature_codes) по отчёту, чтобы назначение
-- пакета давало осмысленный набор модулей, а гейтинг сайдбара работал по вертикалям.
-- База (не гейтится): dashboard.owner, finance.base. Premium/вертикаль — в пакете.
--
-- Состав:
--   Finance     = Core + Finance
--   Club        = + People + POS + Stock
--   Restaurant  = + Production basic
--   Shop        = Core + Finance + Stock + POS
--   Service     = + job-flow + Stock

update public.packages set feature_codes =
  array['dashboard.owner','finance.base','finance.pnl']
  where code = 'finance';

update public.packages set feature_codes =
  array['dashboard.owner','finance.base','finance.pnl','club.pos','shop.catalog']
  where code = 'club';

update public.packages set feature_codes =
  array['dashboard.owner','finance.base','finance.pnl','club.pos','shop.catalog','restaurant.recipes_lite']
  where code = 'restaurant';

update public.packages set feature_codes =
  array['dashboard.owner','finance.base','finance.pnl','shop.catalog','club.pos']
  where code = 'shop';

update public.packages set feature_codes =
  array['dashboard.owner','finance.base','finance.pnl','service.jobs','shop.catalog']
  where code = 'service';
