# ТЗ: Смены, инциденты и база знаний как единая система

Дата: 2026-04-24
Статус: draft
Автор: padash00 + Claude

---

## 0. Контекст и проблема

Сейчас:
- В операторке нет понятия «смена» как объекта — продажи/возвраты/заявки просто падают с `shift: 'day' | 'night'` без привязки к конкретному экземпляру смены.
- Возможны две одновременные смены на одной точке (ничто не мешает).
- База знаний (`/knowledge-admin`) создана, но **не соединена ни с чем**: правила лежат, штрафы/бонусы в статьях и чек-листах не применяются автоматически.
- Чек-листы существуют, но:
  - нет расписания (`opening | periodic | closing`),
  - нет истории прохождения,
  - нет блокировки «не прошёл — не работай».
- Закрытие смены в операторке (калькулятор) не создаёт отчёта, который можно показать на сайте.
- Handover между сменами не формализован — виноватого за расхождения найти нельзя.

Нужно:
- Сделать смену единым объектом, к которому приклеены все операции, проверки, отчёты и финансы.
- Соединить базу знаний с реальностью: нарушение правила → автошраф, выполненный чек-лист → автобонус → зарплата.
- Добавить онбординг, handover, подтверждение критичных правил, квиз по знаниям, публичные правила для киоска.

---

## 1. Цели

| Цель | Почему |
|------|--------|
| Одна активная смена на точку | Невозможность «двойной продажи» и запутанной ответственности |
| Все операции смены авто-привязаны | Отчётность на уровне смены, а не на уровне дня |
| Чек-листы с расписанием + блокировкой | Opening-лист не пройден → касса не работает |
| Автошрафы/автобонусы | База знаний превращается в деньги |
| Handover двух подписей | Расхождение → виноват тот, кто не зафиксировал |
| Публичные правила на киоске | Клиенты видят правила клуба, режим работы, запреты |
| Квиз по статьям | Оператор действительно знает правила, а не «читал» |
| AI-ассистент | Claude читает контекст + базу знаний → подсказывает действия в проблемной ситуации |

---

## 2. Сущности и модель данных

### 2.1 Смена (`point_shifts`)

```sql
create table public.point_shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  operator_id uuid null references public.staff(id) on delete set null,
  point_device_id uuid null references public.point_devices(id) on delete set null,
  status text not null default 'open',           -- open | closed | voided
  shift_type text not null default 'day',        -- day | night | custom
  opened_at timestamptz not null default now(),
  closed_at timestamptz null,

  -- Финансы открытия
  opening_cash numeric(12,2) not null default 0,
  opening_notes text null,

  -- Финансы закрытия (заполняет калькулятор)
  closing_cash numeric(12,2) null,
  closing_kaspi numeric(12,2) null,
  closing_kaspi_before_midnight numeric(12,2) null,
  closing_kaspi_after_midnight numeric(12,2) null,

  -- Z/X отчёты (ссылки на Supabase Storage)
  z_report_url text null,
  x_report_url text null,

  -- Итоги: {sales_total, returns_total, fines_total, bonuses_total, ...}
  totals_json jsonb null,

  handover_from_shift_id uuid null references public.point_shifts(id) on delete set null,
  closed_by uuid null references public.staff(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint point_shifts_status_check check (status in ('open', 'closed', 'voided')),
  constraint point_shifts_shift_type_check check (shift_type in ('day', 'night', 'custom'))
);

-- Физический запрет двух открытых смен на одну точку
create unique index idx_point_shifts_one_open_per_company
  on public.point_shifts(company_id) where status = 'open';

create index idx_point_shifts_company_closed_at
  on public.point_shifts(company_id, closed_at desc);
```

### 2.2 Привязка операций к смене

Во все существующие таблицы добавить `shift_id uuid null references public.point_shifts(id) on delete set null`:
- `point_sales`
- `point_returns`
- `inventory_requests` (если создана с точки)
- `inventory_movements` (тип `sale`, `return`, `transfer_to_point`)
- `incidents` (см. ниже)

Проставляется сервером в API-роуте: берётся текущая открытая смена для `device.company_id`. Если открытой нет — `point-no-active-shift` (403/409).

### 2.3 Чек-листы: расписание и прохождение

Расширить `checklist_templates`:
```sql
alter table public.checklist_templates
  add column schedule_type text not null default 'opening',    -- opening | periodic | closing | onboarding | handover
  add column recurrence_minutes integer null,                  -- для periodic
  add column blocks_shift boolean not null default false,      -- opening: пока не пройден — касса в режиме read-only
  add constraint checklist_templates_schedule_check
    check (schedule_type in ('opening', 'periodic', 'closing', 'onboarding', 'handover'));
```

Новая таблица — история прохождения:
```sql
create table public.checklist_runs (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid null references public.point_shifts(id) on delete cascade,  -- null для onboarding
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  run_by uuid not null references public.staff(id) on delete restrict,
  co_signed_by uuid null references public.staff(id) on delete set null,    -- handover: вторая подпись
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  status text not null default 'in_progress',   -- in_progress | completed | skipped | failed
  scheduled_at timestamptz null,                 -- для periodic: когда должен был сработать
  responses jsonb not null default '{}'::jsonb,  -- { item_id: { value, photo_url, comment, answered_at } }
  fines_total numeric(10,2) not null default 0,
  bonuses_total numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),

  constraint checklist_runs_status_check check (status in ('in_progress', 'completed', 'skipped', 'failed'))
);

create index idx_checklist_runs_shift on public.checklist_runs(shift_id, created_at desc);
create index idx_checklist_runs_template on public.checklist_runs(template_id, status);
```

### 2.4 Инциденты (авто-штрафы/бонусы)

```sql
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  shift_id uuid null references public.point_shifts(id) on delete set null,
  article_id uuid null references public.knowledge_articles(id) on delete set null,
  kind text not null default 'violation',       -- violation | bonus | note
  subject_staff_id uuid null references public.staff(id) on delete set null,   -- кого касается
  reported_by uuid null references public.staff(id) on delete set null,        -- кто зарегистрировал
  title text not null,
  description text null,
  photo_urls text[] not null default '{}',
  fine_amount numeric(10,2) not null default 0,
  bonus_amount numeric(10,2) not null default 0,
  severity text not null default 'normal',
  status text not null default 'confirmed',     -- draft | confirmed | disputed | voided
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint incidents_kind_check check (kind in ('violation', 'bonus', 'note')),
  constraint incidents_severity_check check (severity in ('info', 'normal', 'warning', 'critical')),
  constraint incidents_status_check check (status in ('draft', 'confirmed', 'disputed', 'voided'))
);

create index idx_incidents_company_occurred on public.incidents(company_id, occurred_at desc);
create index idx_incidents_subject_staff on public.incidents(subject_staff_id, occurred_at desc);
create index idx_incidents_shift on public.incidents(shift_id);
```

### 2.5 Подтверждения правил

```sql
create table public.knowledge_article_confirmations (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.knowledge_articles(id) on delete cascade,
  article_version integer not null default 1,
  staff_id uuid not null references public.staff(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  shift_id uuid null references public.point_shifts(id) on delete set null,
  constraint knowledge_article_confirmations_unique unique (article_id, article_version, staff_id)
);

alter table public.knowledge_articles
  add column version integer not null default 1,
  add column requires_confirmation boolean not null default false;
```

При `UPDATE` critical-статьи (триггер): `version = version + 1`, и всем операторам с `audience` совпадающим — в следующей смене оверлей.

### 2.6 Квиз

```sql
create table public.knowledge_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz null,
  score integer null,                     -- 0..100
  questions jsonb not null,               -- [{ article_id, q, choices, correct }]
  answers jsonb null                      -- { q_idx: answer_idx }
);

create index idx_knowledge_quiz_staff on public.knowledge_quiz_attempts(staff_id, started_at desc);
```

Вопросы генерирует Claude из `content` статей (кэшируется на 30 дней).

### 2.7 Handover

`point_shifts.handover_from_shift_id` + `checklist_runs.co_signed_by`. Отдельную таблицу не делаем — handover-чек-лист это `checklist_template.schedule_type='handover'`, а сам факт смены фиксируется в `point_shifts`.

### 2.8 Онбординг

`staff` → добавить колонку:
```sql
alter table public.staff add column onboarded_at timestamptz null;
```
Открытие смены блокируется если `onboarded_at is null` и есть `checklist_templates` с `schedule_type='onboarding'` для этой организации. Оператор проходит лист → `onboarded_at = now()`.

---

## 3. Миграции (порядок)

1. `20260425_point_shifts_entity.sql` — создать `point_shifts`, индексы, CHECK.
2. `20260425_shift_id_on_operations.sql` — добавить `shift_id` во все операции + бэкфилл по `created_at + company_id + time-window` (best-effort).
3. `20260425_checklist_runs_and_schedule.sql` — расширение templates, таблица runs.
4. `20260425_incidents.sql` — инциденты.
5. `20260425_knowledge_confirmations_and_versions.sql` — версии + подтверждения + триггер.
6. `20260425_knowledge_quiz.sql` — квизы.
7. `20260425_staff_onboarded.sql` — онбординг.

### SQL-функции

- `point_shift_open(p_company_id, p_operator_id, p_device_id, p_opening_cash, p_notes, p_handover_from?)` → возвращает `shift_id`. Атомарно: проверка нет открытой, проверка онбординга, INSERT, возврат id.
- `point_shift_close(p_shift_id, p_closing_cash, p_closing_kaspi, p_kaspi_before, p_kaspi_after, p_z_url, p_x_url, p_closing_notes)` → считает `totals_json` из `point_sales + point_returns + incidents + checklist_runs`, UPDATE, return отчёт.
- `incidents_create(p_company_id, p_article_id, p_subject_staff_id, p_kind, p_title, p_description, p_photos, p_fine?, p_bonus?)` — если `article_id` задан, берёт `fine_amount`/`bonus_amount` из статьи как default; ссылается на текущую открытую смену.

---

## 4. API контракты

### 4.1 Операторка (`/api/point/*`, заголовок `x-point-device-token`)

| Метод | Путь | Что делает |
|-------|------|-----------|
| POST | `/api/point/shift/open` | Открывает смену; 409 если уже есть открытая или не пройден онбординг |
| GET | `/api/point/shift/current` | Возвращает активную смену + её runs + pending оверлеи (critical confirms, pending periodic) |
| POST | `/api/point/shift/close` | Закрывает смену: финансы + closing checklist responses + Z/X urls |
| POST | `/api/point/shift/handover` | Создаёт новую смену с `handover_from_shift_id`, запускает handover-чек-лист с двумя подписями |
| POST | `/api/point/checklist/run` | Стартует run для шаблона (или возвращает in_progress если есть) |
| PATCH | `/api/point/checklist/run/:id` | Обновляет responses |
| POST | `/api/point/checklist/run/:id/complete` | Завершает run, считает fines/bonuses, создаёт incidents если нужно |
| POST | `/api/point/incidents` | Оператор регистрирует bonus/note себе или напарнику (штрафы — только менеджер) |
| GET | `/api/point/knowledge` | Статьи для `audience in ('operator', role)` + pending-подтверждения |
| POST | `/api/point/knowledge/confirm` | Подпись под critical-статьей |
| POST | `/api/point/ai/ask` | Claude: вопрос оператора + контекст смены → совет + ссылки на статьи |

Все эти роуты ставят `shift_id` = `current_open_shift(device.company_id)`. Если смены нет — 409.

### 4.2 Сайт (`/api/admin/*`, Supabase Auth)

| Метод | Путь | Что |
|-------|------|-----|
| GET | `/api/admin/shifts` | Список смен (фильтры: company, operator, dates, status) |
| GET | `/api/admin/shifts/:id` | Полный отчёт смены: финансы + runs + incidents + операции |
| POST | `/api/admin/shifts/:id/void` | Аннулировать смену (только owner) |
| GET | `/api/admin/incidents` | Лента инцидентов (фильтры: subject, severity, date) |
| POST | `/api/admin/incidents` | Менеджер создаёт инцидент (штраф) |
| PATCH | `/api/admin/incidents/:id` | Изменение статуса (dispute, voided, confirmed) |
| GET | `/api/admin/knowledge/quiz/generate` | Сгенерировать 5 вопросов Claude по `audience` статьям |
| POST | `/api/admin/knowledge/quiz/submit` | Принять ответы, посчитать score |
| GET | `/api/admin/salary/shift/:id` | Начисления оператору за смену (зарплата + бонусы − штрафы) |

### 4.3 Kiosk (`/api/kiosk/*`)

| Метод | Путь | Что |
|-------|------|-----|
| GET | `/api/kiosk/public-rules` | Статьи с `audience='client'` для отображения на экране клиента |

---

## 5. UI: Сайт (`app/(main)/*`)

### 5.1 `/shifts/reports` — лента закрытых смен

Компактная таблица: точка, оператор, `opened_at → closed_at`, длительность, продажи, kaspi/cash, штрафы/бонусы (итог), статус. Клик → карточка.

### 5.2 `/shifts/reports/[id]` — карточка смены

Блоки:
1. **Шапка**: точка, оператор, время, handover-предыдущая смена (ссылка).
2. **Финансы**: opening/closing cash/kaspi, Z/X превью (кликабельны).
3. **Чек-листы**: opening, все periodic (с временем), closing, handover. Каждый пункт: статус, значение, фото.
4. **Инциденты**: штрафы/бонусы с привязкой к правилу (ссылка на статью).
5. **Операции**: продажи, возвраты, заявки — сгруппированные (уже есть таблицы, просто фильтр по shift_id).
6. **Зарплата**: предварительный расчёт (см. 7).

### 5.3 `/incidents` — журнал нарушений и достижений

Таблица: дата, точка, кто, правило (ссылка), сумма, статус. Фильтры по оператору и severity. Менеджер может добавить инцидент вручную (форма + выбор статьи → автосумма).

### 5.4 `/knowledge-admin` — дополнения к существующему

- Поле `requires_confirmation` на статьях.
- Вкладка «Квиз» — preview вопросов, статистика прохождения по оператору.
- Вкладка «Подтверждения» — кто когда какую версию правила подписал.

---

## 6. UI: Операторка (`desktop/operator/`)

### 6.1 Открытие смены

Экран логина → после успеха:
- Если `staff.onboarded_at is null` + есть onboarding-лист → **экран онбординга** (нельзя пропустить).
- Иначе → форма «Открыть смену»: `opening_cash`, note, handover (если выбрал — предыдущая смена подтягивается, запускается handover-лист с co-signer).

### 6.2 Во время смены

Постоянные элементы:
- **Шапка**: индикатор активной смены, таймер.
- **Оверлеи** (блокируют UI пока не закрыты):
  - opening-checklist сразу после открытия (если `blocks_shift=true`).
  - pending critical-статья → «прочитал и согласен».
  - просроченный periodic-checklist > N минут.
- **Фоновый таймер**: за 5 мин до `recurrence_minutes` — тост «скоро обход зала», в X:00 — мягкий оверлей.
- **Боковая панель «База знаний»**: свёрнута, открывается по F1 или кнопке. Поиск + фильтр по тегам, список статей `audience='operator'`.
- **Кнопка «AI-помощь»**: оператор описывает проблему → Claude отвечает со ссылками на статьи.

### 6.3 Закрытие смены (калькулятор)

Форма-wizard:
1. Финансы: `closing_cash`, `closing_kaspi` (+ split до/после полуночи если shift_type='night').
2. Closing-checklist: обязательные пункты, фото Z/X.
3. Сводка: что поменялось, штрафы/бонусы за смену, итог к выплате.
4. «Закрыть смену» → POST `/api/point/shift/close` → возврат `shift_report` → оффлайн-сохранение копии + печать если нужно.

### 6.4 Handover

Кнопка «Передать смену»:
- Приходящий оператор логинится на том же терминале.
- Запускается `handover` checklist run с двумя подписями (совпадает ли касса, что не решено и т. д.).
- При завершении: старая смена → `closed`, новая → `open`, `handover_from_shift_id` проставлен.

---

## 7. Связка с зарплатой (`lib/domain/salary.ts`)

Расчёт зарплаты за смену:
```
gross = shift_base_rate + sum(incidents.bonus_amount) + sum(checklist_runs.bonuses_total)
fines = sum(incidents.fine_amount) + sum(checklist_runs.fines_total)
net = gross − fines
```

Уже существующая salary-логика расширяется:
- Источник: `point_shifts.totals_json.salary_preview` (посчитано в `point_shift_close`) — кэш.
- Пересчёт на лету на `/salary/[operator_id]` по запросу.

---

## 8. AI-ассистент (операторка)

Эндпойнт `/api/point/ai/ask`:
```ts
input: { question: string, shift_id: uuid }
→
system_prompt: "Ты помощник оператора клуба Orda..."
context:
  - current shift snapshot (sales, active bookings, inventory low items)
  - all knowledge_articles with audience overlap
response:
  - answer text
  - cited article_ids (оператор видит «источник: Правила kaspi» как кликабельный чип)
```

Модель: `claude-haiku-4-5-20251001` (быстро + дёшево, достаточно для справочных задач).

---

## 9. Kiosk: публичные правила

На киоске (`desktop/kiosk/`) — новый экран «Правила клуба»:
- GET `/api/kiosk/public-rules` → статьи с `audience='client'`.
- Рендерится как карточки по категориям (`kind`).
- Появляется в idle-режиме или кнопкой в WelcomeScreen.

---

## 10. Порядок работ (фазы)

### Фаза 1 — Смена как объект
1. Миграция `point_shifts` + `shift_id` на все операции + бэкфилл.
2. SQL-функции `point_shift_open` / `point_shift_close`.
3. API `/api/point/shift/*`.
4. Страница `/shifts/reports` + `[id]` (чтение только, без чек-листов).
5. В операторке: кнопки «Открыть смену» / «Закрыть смену» с простой формой (без чек-листов).

### Фаза 2 — Чек-листы с расписанием и блокировкой
1. Миграция schedule_type + `checklist_runs`.
2. Оверлей opening/periodic/closing в операторке.
3. Handover-флоу.
4. В карточке смены на сайте — секция чек-листов.

### Фаза 3 — Инциденты и связка с зарплатой
1. Миграция `incidents`.
2. API + UI `/incidents`.
3. Связка: пройденный чек-лист → auto-incident bonus/fine.
4. Расширение `salary.ts` + страница зарплаты.

### Фаза 4 — Знания активные
1. Версии статей + триггер.
2. Pending-confirmations в операторке.
3. Квиз (генерация через Claude, preview на сайте).
4. Онбординг-лист + блок открытия смены.

### Фаза 5 — AI + Kiosk
1. `/api/point/ai/ask` (Claude Haiku).
2. UI «AI-помощь» в операторке.
3. Kiosk public-rules экран.

---

## 11. Открытые решения

| Вопрос | Предложение |
|--------|-------------|
| Z/X отчёт: фото или парсинг POS? | Фото в Supabase Storage. Парсинг — отдельный модуль позже. |
| Handover: кто считается «ответственным» за расхождение? | Если расхождение зафиксировано в handover checklist — отвечает уходящий. Если не зафиксировано — приходящий. |
| Штраф: может ли оператор сам себя оштрафовать? | Нет. Только менеджер/owner. Операторы регистрируют только `kind='bonus'` и `kind='note'`. |
| Periodic-лист не пройден — что происходит? | Мягкая эскалация: оверлей → через X минут просрочки → автошраф из `fine_amount` самого пункта. |
| Онбординг — обязательный? | Да, для роли `operator`. Менеджер может принудительно выставить `onboarded_at`. |
| Квиз: раз в месяц всем? | Да, каждому оператору. Менеджер видит последний score. |
| Смена открыта в одной точке = «точке магазина» или «клуб + магазин»? | В одной `company_id`. У нас одна company = одна точка, но в будущем может быть company = клуб, а магазин — sub-entity; пока игнорируем. |

---

## 12. Out of scope (не делаем сейчас)

- Автоматический OCR Z/X-отчётов.
- Биометрия/подпись через планшет для handover.
- Несколько операторов одновременно в одной смене (будет через handover → split).
- Мобильное приложение оператора (всё через desktop).
- Публичный API для внешних систем.

---

## 13. Acceptance

Фаза 1 считается готовой, когда:
- На открытой точке невозможно создать вторую смену (API возвращает 409).
- Все продажи/возвраты за смену видны на карточке смены.
- Закрытие смены без чек-листов работает — финансы сохраняются, `totals_json` считается.
- `/shifts/reports` показывает закрытые смены с правильными суммами.

Фаза 2 — когда:
- Opening-лист блокирует работу оператора (нельзя продать пока не закрыл).
- Periodic-лист всплывает по расписанию и фиксируется в runs.
- Handover завершает старую и открывает новую смену с подписями.

Фаза 3 — когда:
- Штраф из правила автоматически попадает в зарплату оператора за смену.
- Менеджер может оспорить/аннулировать инцидент.

Фаза 4 — когда:
- После изменения critical-статьи все операторы в следующей смене обязаны подписаться.
- Ежемесячный квиз генерируется и проходится.
- Онбординг блокирует открытие первой смены.

Фаза 5 — когда:
- Оператор задаёт вопрос в операторке — получает ответ со ссылкой на статью.
- На киоске есть экран с публичными правилами.

---
