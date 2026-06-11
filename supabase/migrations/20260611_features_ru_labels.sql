-- Перевод названий/описаний фич и модулей на русский (витрина пакетов + «Доступ к функциям»).
-- Бренд-имена модулей (AI CFO, HR Pro, Stock Pro, Recipes Pro) оставляем узнаваемыми,
-- остальное — по-русски.

-- ── features (каталог гранулярных фич) ──
update public.features set name = 'Дашборд владельца'              where code = 'dashboard.owner';
update public.features set name = 'P&L и кэшфлоу'                  where code = 'finance.pnl';
update public.features set name = 'Клуб: POS, смены, операторы'    where code = 'club.pos';
update public.features set name = 'Магазин: каталог, склад, приёмка' where code = 'shop.catalog';
update public.features set name = 'Ресторан: техкарты (базовые)'   where code = 'restaurant.recipes_lite';
update public.features set name = 'Сервис: заказы и работы'        where code = 'service.jobs';
update public.features set name = 'Telegram-отчёты'               where code = 'telegram.reports';
update public.features set name = 'Лояльность (CRM)'              where code = 'loyalty.crm';
update public.features set name = 'Открытый API и вебхуки'        where code = 'open.api';
update public.features set name = 'AI-анализы (по факту)'         where code = 'ai.analysis';
update public.features set name = 'OCR страниц (по факту)'        where code = 'ocr.page';

-- ── addons (витрина модулей) ──
update public.addons set description = 'Ежедневные разборы, прогнозы, поиск причин' where code = 'ai_cfo';
update public.addons set name = 'Telegram-отчёты',     description = 'Отчёты и алерты в Telegram'                where code = 'telegram';
update public.addons set                                description = 'Формулы зарплат, KPI, стоимость труда'    where code = 'hr_pro';
update public.addons set                                description = 'Точки дозаказа, ABC/XYZ, отклонения поставщиков' where code = 'stock_pro';
update public.addons set                                description = 'Полуфабрикаты, партии, выход/потери'      where code = 'recipes_pro';
update public.addons set name = 'Лояльность (CRM)',    description = 'Бонусы, сегменты, акции'                   where code = 'loyalty';
update public.addons set name = 'Открытый API и вебхуки', description = 'Интеграции и автоматизация'             where code = 'open_api';
