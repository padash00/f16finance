-- ============================================================================
-- Мультитенантная RLS (часть 2): закрываем оставшиеся using(true) на чатах,
-- зарплатных периодах, долгах поставщиков и copilot-таблицах.
--
-- Принцип тот же: сервер ходит через service_role (RLS обходит) — API/крон не
-- затрагиваются. Ограничивается ТОЛЬКО прямой доступ из браузера по anon-ключу.
-- Хелперы: can_access_organization(uuid) (20260401_*).
--
-- Идемпотентно. Откат: вернуть `using (true) with check (true)` для таблицы.
--
-- Замечание про NULL organization_id: глобальные (null) строки оставлены видимыми
-- всем авторизованным (сохраняем текущее поведение общих чатов/новостей).
-- Строки С организацией другого арендатора скрываются — это и есть изоляция.
-- salary_calculation_runs/items НЕ трогаем здесь: у них нет organization_id
-- (только company_code text) — нужна отдельная проработка.
-- ============================================================================

-- ---------- team_chat_messages (organization_id, читается клиентом) ----------
alter table public.team_chat_messages enable row level security;
drop policy if exists team_chat_messages_all on public.team_chat_messages;
drop policy if exists team_chat_messages_tenant on public.team_chat_messages;
create policy team_chat_messages_tenant on public.team_chat_messages
  for all
  using (organization_id is null or public.can_access_organization(organization_id))
  with check (organization_id is null or public.can_access_organization(organization_id));

-- ---------- direct_messages (по отправителю/получателю) ----------------------
alter table public.direct_messages enable row level security;
drop policy if exists direct_messages_all on public.direct_messages;
drop policy if exists direct_messages_tenant on public.direct_messages;
create policy direct_messages_tenant on public.direct_messages
  for all
  using (auth.uid() = sender_user_id or auth.uid() = recipient_user_id)
  with check (auth.uid() = sender_user_id);

-- ---------- news_posts (organization_id, читается клиентом) ------------------
alter table public.news_posts enable row level security;
drop policy if exists news_posts_all on public.news_posts;
drop policy if exists news_posts_tenant on public.news_posts;
create policy news_posts_tenant on public.news_posts
  for all
  using (organization_id is null or public.can_access_organization(organization_id))
  with check (organization_id is null or public.can_access_organization(organization_id));

-- ---------- supplier_debts (organization_id) --------------------------------
alter table public.supplier_debts enable row level security;
drop policy if exists supplier_debts_select on public.supplier_debts;
drop policy if exists supplier_debts_write on public.supplier_debts;
drop policy if exists supplier_debts_delete on public.supplier_debts;
drop policy if exists supplier_debts_all on public.supplier_debts;
drop policy if exists supplier_debts_tenant on public.supplier_debts;
create policy supplier_debts_tenant on public.supplier_debts
  for all
  using (organization_id is null or public.can_access_organization(organization_id))
  with check (organization_id is null or public.can_access_organization(organization_id));

-- ---------- reminders (organization_id) -------------------------------------
alter table public.reminders enable row level security;
drop policy if exists reminders_all on public.reminders;
drop policy if exists reminders_tenant on public.reminders;
create policy reminders_tenant on public.reminders
  for all
  using (organization_id is null or public.can_access_organization(organization_id))
  with check (organization_id is null or public.can_access_organization(organization_id));

-- ---------- goals (organization_id) -----------------------------------------
alter table public.goals enable row level security;
drop policy if exists goals_all on public.goals;
drop policy if exists goals_tenant on public.goals;
create policy goals_tenant on public.goals
  for all
  using (organization_id is null or public.can_access_organization(organization_id))
  with check (organization_id is null or public.can_access_organization(organization_id));

-- ---------- payroll_periods (organization_id) -------------------------------
alter table public.payroll_periods enable row level security;
drop policy if exists payroll_periods_all on public.payroll_periods;
drop policy if exists payroll_periods_tenant on public.payroll_periods;
create policy payroll_periods_tenant on public.payroll_periods
  for all
  using (organization_id is null or public.can_access_organization(organization_id))
  with check (organization_id is null or public.can_access_organization(organization_id));
