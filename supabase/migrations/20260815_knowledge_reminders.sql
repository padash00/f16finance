-- Когда оператору последний раз напоминали о непрочитанных правилах.
--
-- Без отметки напоминание уходило бы каждый день и превращалось в фон, который
-- перестают открывать. Крон /api/cron/knowledge-confirmations пишет сюда дату и
-- пропускает человека три дня.

alter table public.operators
  add column if not exists knowledge_reminded_at timestamptz;

comment on column public.operators.knowledge_reminded_at is
  'Последнее напоминание о неподтверждённых правилах базы знаний';
