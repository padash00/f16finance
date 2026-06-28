-- barcode_cache: включить RLS (Supabase linter: rls_disabled_in_public 0013).
--
-- Таблица читается/пишется ТОЛЬКО через service-role (Next.js API barcode-lookup),
-- который RLS обходит. Поэтому включение RLS без публичных политик НЕ ломает
-- приложение (общий кэш по-прежнему работает через service-role), но закрывает
-- прямой доступ к таблице по публичному anon-ключу. Данные тут низкочувствительные
-- (названия товаров из открытых баз), но предупреждение безопасности устраняем.

alter table public.barcode_cache enable row level security;

-- Политик намеренно нет: anon/authenticated к таблице напрямую не обращаются,
-- весь доступ — через service-role (минует RLS).
