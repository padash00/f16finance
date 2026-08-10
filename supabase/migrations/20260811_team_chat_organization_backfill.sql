-- Командный чат: сообщения без организации.
--
-- Чтение чата фильтровалось как «моя организация ИЛИ ничья», а запись клала
-- `null`, если активная организация не выбрана. То есть такое сообщение видели
-- все клиенты сразу. Роут теперь пишет организацию всегда и читает строго по
-- ней, но накопленные строки с `null` иначе просто исчезли бы из всех чатов.
--
-- Привязываем их к организации отправителя. Сотрудник связан с учётной записью
-- не напрямую — в `staff` нет `user_id`, — а через `organization_members`.

-- 1. По автору-сотруднику: организация берётся из его членства.
update public.team_chat_messages m
set organization_id = om.organization_id
from public.organization_members om
where m.organization_id is null
  and m.sender_user_id is not null
  and om.user_id = m.sender_user_id
  and om.organization_id is not null;

-- 2. По автору-оператору: организация берётся с его точки.
update public.team_chat_messages m
set organization_id = c.organization_id
from public.operator_company_assignments a
join public.companies c on c.id = a.company_id
where m.organization_id is null
  and m.sender_operator_id is not null
  and a.operator_id = m.sender_operator_id
  and a.is_active
  and c.organization_id is not null;

-- 3. Остаток — первой организации. Так же поступила миграция ручных вводов
--    ОПиУ (20260331): при одной организации это ровно она и есть.
with first_org as (
  select id from public.organizations order by created_at asc, id asc limit 1
)
update public.team_chat_messages m
set organization_id = first_org.id
from first_org
where m.organization_id is null;

-- 4. Впредь — только с организацией.
--
-- Ограничение ставим после заполнения: иначе миграция упала бы на первой же
-- старой строке. Если что-то осталось незаполненным, ограничение не ставим —
-- изоляцию уже держит роут, а страховку можно добавить позже.
do $$
begin
  if not exists (select 1 from public.team_chat_messages where organization_id is null) then
    alter table public.team_chat_messages
      alter column organization_id set not null;
  end if;
end $$;

create index if not exists idx_team_chat_messages_organization
  on public.team_chat_messages (organization_id, created_at desc);
