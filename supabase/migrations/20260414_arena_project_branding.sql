-- Arena project-level branding fields
-- Stored on point_projects so the website page header is editable

alter table public.point_projects
  add column if not exists arena_logo_url   text null,
  add column if not exists arena_cover_url  text null,
  add column if not exists arena_accent     text null,
  add column if not exists arena_description text null;

comment on column public.point_projects.arena_logo_url    is 'URL логотипа проекта (арена)';
comment on column public.point_projects.arena_cover_url   is 'URL обложки/баннера страницы проекта (арена)';
comment on column public.point_projects.arena_accent      is 'Акцентный цвет страницы проекта (арена), hex';
comment on column public.point_projects.arena_description is 'Краткое описание / tagline проекта (арена)';
