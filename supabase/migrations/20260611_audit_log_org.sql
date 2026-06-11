-- audit_log не имел колонки организации → его читатели (store/audit-timeline,
-- copilot get-audit-log/recent-actions/who-changed) не могли изолировать данные.
-- Добавляем organization_id; writeAuditLog заполняет его (из company_id в payload),
-- читатели фильтруют по нему. Старые строки бэкфиллим по company_id из payload.

alter table public.audit_log add column if not exists organization_id uuid;

create index if not exists audit_log_org_created_idx
  on public.audit_log (organization_id, created_at desc);

-- Бэкфилл: организация = организация компании из payload.company_id (безопасное
-- текстовое сравнение, без cast — payload->>'company_id' может быть не-uuid/пустым).
update public.audit_log a
set organization_id = c.organization_id
from public.companies c
where a.organization_id is null
  and c.id::text = nullif(a.payload->>'company_id', '');
