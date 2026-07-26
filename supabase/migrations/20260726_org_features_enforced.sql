-- Фаза 2: пер-организационный тумблер жёсткого энфорсмента страниц/фич.
-- По умолчанию false → поведение как раньше (SHADOW: не блокирует, только меню
-- скрывает). true → серверные guard'ы (requireOrgFeature) реально отдают 402 для
-- страниц/фич, которых нет в пакете орг. Супер-админ и billing_exempt — fail-open.
alter table public.organizations
  add column if not exists features_enforced boolean not null default false;
