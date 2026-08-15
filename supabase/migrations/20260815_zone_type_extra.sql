-- Тип зоны «extra» для отчёта смены.
--
-- Отчёты смены с точки Extra падали 144 раза (последний — 3 августа):
-- resolveIncomeZone в app/api/point/shift-report/route.ts возвращает 'extra'
-- для точки с кодом extra, а в enum zone_type такого значения нет — Postgres
-- отклоняет вставку дохода целиком, и смена не закрывается.
--
-- Пишем одной строкой, без do-блока: ALTER TYPE ... ADD VALUE нельзя выполнять
-- изнутри функции, а do-блок ею и является («cannot be executed from a
-- function»). IF NOT EXISTS делает повторный запуск безопасным.
--
-- Если Postgres ответит «type zone_type does not exist» — значит тип лежит в
-- другой схеме; тогда подставьте её имя вместо public.

alter type public.zone_type add value if not exists 'extra';
