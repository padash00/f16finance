# iOS API Bridge — ответы на вопросы веб-команды

**Связано с:** `iOS_API_IMPLEMENTATION_PLAN.md`
**От:** iOS team (Orda Control mobile)
**Кому:** веб-команда f16finance-main
**Дата:** 2026-05-04

---

## Общая реакция на план реализации

✅ **План одобрен** — он лучше моего исходного запроса в нескольких местах:

1. **Использование существующего `getRequestOperatorContext()`** — я не знал о его существовании. Helper становится тоньше.
2. **Правильное название таблицы** — `checklist_items` (а не `checklist_template_items` как я ошибочно написал).
3. **Маппинг `staff_id` через `operator_staff_links`** — корректно, RPC `point_shift_open/close` принимает именно `staff.id`.
4. **Конверсия `answers` → `responses`** в PATCH checklist — backend принимает оба формата. iOS оставит `answers` для совместимости.
5. **Arena через резолв `point_projects` по `company_id`** — единственное правильное решение для iOS без device token.

---

## Ответы на 3 открытых вопроса

### Q1: Arena multi-project — как iOS выбирает project?

**Ответ:** Для Phase 1 — **первый активный** `point_project` по `company_id`. Phase 2 добавим выбор зала на iOS.

**Обоснование:**
- F16 (наш текущий single-tenant клиент) имеет один зал на каждой компании. Multi-project — теоретическая возможность которая пока не используется.
- Если в будущем у клиента появится несколько залов в одной компании — iOS добавит селектор `OperatorArenaLiveView` с переключением.
- В Phase 2 backend может принимать опциональный `?project_id=` query param. Если передан и `project_id` принадлежит `companyId` оператора — использовать его. Иначе — fallback на первый активный.

**Действие:** Никаких изменений плана. `maybeSingle()` или `.limit(1).order('created_at')` подойдёт.

**Если ничего не найдено:** возвращайте `404 no-point-project` как и предложено. iOS отрендерит EmptyState с текстом «На вашей точке не настроен arena project, обратитесь к администратору».

---

### Q2: Incidents scope — `subject_staff_id` или по текущей смене?

**Ответ:** **`subject_staff_id`** оператора, БЕЗ фильтра по смене.

**Обоснование:**
- iOS показывает экран «Мои инциденты» — это **личная история** нарушений/бонусов оператора. Он должен видеть все свои инциденты за весь период работы (не только за смену сегодня).
- В web super-admin видит инциденты через свою админку (`/api/admin/incidents`) — там может фильтровать по сменам, операторам и т.д.
- iOS-вьюшка `IncidentsListView` имеет фильтр по статусу (`open / acknowledged / closed / all`), но не по смене. Так что фильтр по смене нам не нужен.

**Параметры запроса от iOS:**
- `?status=all` (по умолчанию)
- `?status=open|acknowledged|closed`
- `?limit=50` (можно увеличить до 200)

**Что НЕ нужно от iOS Phase 1:**
- Фильтр по смене
- Фильтр по дате диапазона (если потребуется в Phase 2 — добавим `?from=&to=`)
- Pagination через offset (если будет много инцидентов — добавим в Phase 2)

**Если у оператора `staffId = null`:** возвращайте `{ "incidents": [] }` (пустой массив, не ошибка). iOS покажет EmptyStateView «Инцидентов не найдено».

---

### Q3: Knowledge confirm без `staffId` — блокировать или разрешить?

**Ответ:** **Блокировать** с понятной ошибкой.

**Обоснование:**
- Подтверждение прочтения статьи — это **формальное действие compliance**. Оно записывает в `knowledge_article_confirmations` ссылку на конкретного `staff_id`. Без `staff_id` запись невозможна.
- Если разрешить «подтверждение» без записи — оператор увидит "Прочитано", но фактически в БД ничего нет. При проверке аудитом будет конфликт между UI и БД.
- Если оператор без `operator_staff_links` записи — это **управленческая проблема**. Super-admin должен создать связку через `/admin/staff` или `/admin/operators` форму.

**Конкретный response:**
```json
{
  "ok": false,
  "error": "no-staff-link",
  "message": "Ваш профиль оператора не связан с профилем сотрудника. Обратитесь к администратору, чтобы привязать ваш аккаунт."
}
```
Status: `400`

**iOS обработает это так:**
- В `KnowledgeArticleView` кнопка «Подтвердить прочтение» будет дисейблиться с подсказкой
- В `KnowledgeCenterView` — banner с предупреждением «Свяжитесь с админом для подтверждения статей»

**В `GET /api/operator/knowledge`** — `pending_confirmations` всё равно возвращайте (даже без staff_id). Оператор должен видеть какие статьи ему нужно подтвердить, даже если кнопка пока недоступна.

---

## Что iOS НЕ будет менять (важно для веб-команды)

iOS уже задеплоен в Phase 1 и шлёт следующие body-форматы. Backend `/api/operator/*` должен **принимать их as-is**:

### Shift Open
```json
{ "opening_cash": 50000, "shift_type": "day", "point_id": null }
```
**Действие backend:** игнорировать `point_id`. Принять `opening_cash` + `shift_type`.

### Shift Close
```json
{
  "closing_cash": 75000,
  "closing_kaspi": 25000,
  "closing_online": 15000,
  "closing_card": 8000,
  "closing_notes": "..."
}
```
**Действие backend:** игнорировать `closing_online`, `closing_card`. Передавать в RPC только то что он понимает (`closing_cash`, `closing_kaspi`, опционально `kaspi_before/after_midnight` если iOS их добавит).

### Shift Handover
```json
{ "to_operator_id": "uuid", "notes": "..." }
```
**Действие backend:** маппить `to_operator_id → next_operator_id`, `notes → closing_notes ИЛИ next_opening_notes`. `closing_cash`, `closing_kaspi`, `next_opening_cash` — **дефолтить в 0**. iOS Phase 2 расширит форму до полной модели.

### Knowledge Confirm
```json
{ "article_id": "uuid", "version": 3 }
```
✅ **Совпадает** с предложенным форматом.

### Checklist Update (PATCH)
```json
{
  "answers": [
    { "item_id": "uuid", "answer": "yes", "comment": "...", "photo_base64": "data:image/jpeg;base64,..." }
  ]
}
```
**Действие backend:** конвертировать `answers` (массив) → `responses` (объект где ключ — `item_id`). Поле `photo_base64` — сохранять в `responses[item_id].photo_data_url`.

### Checklist Run Start
```json
{ "template_id": "uuid" }
```
✅ **Совпадает.**

### Arena POST
```json
{ "action": "extend", "station_id": "uuid", "minutes": 30 }
{ "action": "techLog", "station_id": "uuid", "message": "..." }
```
✅ **Совпадает** с point-форматом.

---

## Что iOS **будет** менять после деплоя backend (планируется ~1 день работы)

После того как `/api/operator/*` задеплоен на проде:

### iOS-файлы для правки:

1. **`Features/Operator/Shift/PointShiftEntityModule.swift`**
   - Endpoint `/api/point/shift/current` → `/api/operator/shift/current`
   - Endpoint `/api/point/shift/open` → `/api/operator/shift/open`
   - Endpoint `/api/point/shift/close` → `/api/operator/shift/close`
   - Endpoint `/api/point/shift/handover` → `/api/operator/shift/handover`
   - Удалить лишнее поле `point_id` из `OpenShiftBodyEntity`
   - Удалить `closing_online`, `closing_card` из `CloseShiftBodyEntity`
   - **Phase 2:** Добавить `kaspi_before_midnight`, `kaspi_after_midnight` для ночных смен
   - **Phase 2:** Добавить полную форму closing-данных в `ShiftHandoverSheet`

2. **`Features/Operator/Knowledge/KnowledgeCenterModule.swift`**
   - Endpoint `/api/point/knowledge` → `/api/operator/knowledge`
   - Endpoint `/api/point/knowledge/confirm` → `/api/operator/knowledge/confirm`
   - **Удалить** quiz endpoints полностью (`KnowledgeQuiz*` модели + UI) — backend их не имеет
   - В `KnowledgeArticle` обработать новый response формат: `pending_confirmations`, `articles`, `confirmed_at`, `confirmed_version`
   - Если `confirm` возвращает `400 no-staff-link` — показать banner со ссылкой на админа

3. **`Features/Operator/Checklists/ChecklistsModule.swift`**
   - Endpoint `/api/point/checklist/templates` → `/api/operator/checklist/templates`
   - Endpoint `/api/point/checklist/run` → `/api/operator/checklist/run`
   - Endpoint `/api/point/checklist/run/[id]` → `/api/operator/checklist/run/[id]`
   - Endpoint `/api/point/checklist/run/[id]/complete` → `/api/operator/checklist/run/[id]/complete`
   - **Изменить** `ChecklistItem.answerKind` на `answer_type` (backend использует это поле)
   - **Изменить** наполнение `requires_photo`, `severity`, `fine_amount`, `bonus_amount` (вместо моих `finePerFail`, `bonusPerSuccess`)
   - **Удалить** `choiceOptions` если backend не возвращает (или сделать опциональным)

4. **`Features/Operator/Incidents/IncidentsModule.swift`**
   - Endpoint `/api/operator/incidents` уже правильный (только GET для оператора)
   - Изменить decode: `subject_staff_id` вместо `operator_id` (но iOS видит как «свой» инцидент)
   - Поля `photo_urls` (массив) вместо одиночного `photo_url`
   - Поле `occurred_at` есть в backend — добавить в модель если нужно для UI

5. **`Features/Operator/OperatorArenaLiveModule.swift`**
   - Endpoint `/api/point/arena` → `/api/operator/arena`
   - Body для actions `extend`/`techLog` — те же

6. **`Models/GeneratedContractDTOs.swift`** (если есть)
   - Перегенерировать через `scripts/generate_contracts_swift.py` после обновления `contracts.json`

### Тестирование на iPhone после deploy:

```
1. Открыть смену через PointShiftEntityView → видим в /api/operator/shift/current
2. Прочитать статью → подтвердить → она исчезает из pending
3. Запустить чек-лист → ответить на пункты с фото → завершить → видим штраф/бонус
4. Закрыть смену → проверить блокировку если есть незавершённый blocking чек-лист
5. Создать инцидент через admin (/api/admin/incidents) → видим его в /api/operator/incidents
6. Запустить arena сессию → продлить → завершить с tech log
```

---

## Тайминг

**Веб-команда:**
- Реализация: 2 дня (День 1 — shift, День 2 — knowledge/checklist/incidents/arena)
- Тестирование backend через curl: 0.5 дня
- Деплой в Vercel: пропуск через main branch

**iOS-команда (после backend deploy):**
- Поправить пути endpoints + DTOs: 0.5 дня
- Тестирование на реальном F16 операторе: 0.5 дня
- Релиз в TestFlight для оператора: 1 день

**Итого:** ~5 рабочих дней от старта до полностью рабочей iOS-Phase 1 на боевом backend.

---

## Уведомление веб-команды

Когда backend выложите в production — отметьте в этом файле в разделе «Status» (или просто скажите iOS-команде через любой канал). Я переключу endpoints за полдня.

```
## Status

- [x] План одобрен — 2026-05-04
- [x] Helper `lib/server/operator-context.ts` готов
- [x] Shift routes (4) готовы
- [x] Knowledge routes (2) готовы
- [x] Checklist routes (5) готовы
- [x] Incidents route готов
- [x] Arena route готов
- [ ] Production deploy
- [ ] iOS endpoints переключены
```

---

## Спасибо

План реализации очень подробный — я ценю что веб-команда:
- Не стала писать с нуля, а нашла существующий helper
- Указала на конкретные файлы-источники для копирования логики
- Заметила несоответствия названий таблиц и поправила
- Предусмотрела backward compat для `answers`/`responses` форматов

Это сильно облегчит iOS-сторону. Ждём deploy.
