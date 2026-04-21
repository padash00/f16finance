# Orda — Roadmap улучшений

Последнее обновление: 2026-04-21

Формат записи для каждой задачи: **Зачем** · **Где** · **Как** · **Готово когда**.

---

## Сделано (апрель 2026)

- Горизонтальный top-nav с мега-меню вместо сайдбара (десктоп), мобильный drawer сохранён
- `Cmd+K` командная палитра с фаззи-поиском по страницам
- Хлебные крошки над контентом (авто из `navSections`)
- Колокольчик уведомлений: заявки, дни рождения, долги точек
- Journal заявок отдельной страницей
- Имена операторов в журнале заявок (через `operator_auth` → `operators`)
- Salary preview tab: предпросмотр зарплаты по сменам с matched rules
- Менеджер может одобрить больше запрошенного (миграция `20260421_inventory_decide_request_allow_overapproval.sql`)

---

## 1. URL-фильтры на страницах-списках

**Статус:** ✅ Закрыто (2026-04-21)

**Зачем.** Сейчас при `F5` на `/store/requests`, `/store/requests-journal`, `/shifts` и т. д. слетают фильтры, поиск и страница пагинации. Ссылку с отобранными данными коллеге отправить нельзя.

**Где.** Для v1 взять пять страниц:
- `app/(main)/store/requests/page.tsx`
- `app/(main)/store/requests-journal/page.tsx`
- `app/(main)/shifts/page.tsx`
- `app/(main)/pos-receipts/page.tsx`
- `app/(main)/store/movements/page.tsx`

**Сделано.**
- Добавлен общий хук `lib/hooks/use-url-state.ts` (`useUrlState` + `useDebouncedValue`)
- На всех 5 страницах фильтры синхронизированы с URL через `router.replace` без reload
- Для полей поиска добавлен debounce 300мс
- Для `pos-receipts` в URL вынесена также пагинация (`page`)
- Для `shifts` в URL вынесены `weekStart`, поиск по точке и фильтр по оператору

**Как.**
1. Вынести утилиту `lib/hooks/use-url-state.ts`:
   ```ts
   export function useUrlState<T extends Record<string, string>>(
     defaults: T,
   ): [T, (patch: Partial<T>) => void] {
     const router = useRouter()
     const pathname = usePathname()
     const params = useSearchParams()
     const state = useMemo(() => {
       const out = { ...defaults }
       for (const key of Object.keys(defaults)) {
         const v = params.get(key)
         if (v != null) (out as any)[key] = v
       }
       return out
     }, [params, defaults])
     const setState = useCallback((patch: Partial<T>) => {
       const sp = new URLSearchParams(params.toString())
       for (const [k, v] of Object.entries(patch)) {
         if (!v || v === (defaults as any)[k]) sp.delete(k)
         else sp.set(k, String(v))
       }
       router.replace(`${pathname}?${sp.toString()}`, { scroll: false })
     }, [params, pathname, router, defaults])
     return [state, setState]
   }
   ```
2. В каждой странице заменить локальный `useState` на `useUrlState` для фильтров. Пример для `/store/requests`:
   ```ts
   const [filters, setFilters] = useUrlState({ status: 'all', q: '', company: 'all' })
   ```
3. На `<input>`/`<select>` вместо `onChange={setX}` делать `onChange={(e) => setFilters({ q: e.target.value })}`.
4. Для инпутов поиска — debounce 300мс, чтобы не засыпать `replace` на каждое нажатие (использовать существующий `useDebounce` или написать inline).

**Готово когда.** Включаешь фильтры → видишь их в URL → `F5` → фильтры сохранились → копируешь ссылку → у коллеги те же данные.

**Оценка.** ~1 час на страницу × 5 = 5 часов.

---

## 2. Низкие остатки в колокольчике

**Статус:** ✅ Закрыто (2026-04-21)

**Зачем.** Сейчас если на витрине товар закончился, никто не узнает пока оператор не заметит. Хотим видеть это в общих уведомлениях.

**Сделано.**
- В `app/api/admin/notifications/route.ts` добавлена секция `low-stock` в колокольчик.
- Используется уже существующий порог товара `low_stock_threshold` (эквивалент `min_stock`) из каталога.
- Логика учитывает только активные локации `warehouse` и `point_display` в рамках доступного company scope.
- Уведомление показывается, если `showcaseQty <= 0` или `warehouseQty < low_stock_threshold`.
- Добавлен переход в `/store/showcase?company_id=...` для быстрого разбора.
- В `components/notifications-bell.tsx` добавлена иконка `AlertTriangle` для группы low-stock.

**Где.**
- `app/api/admin/notifications/route.ts`
- `components/notifications-bell.tsx`
- `app/(main)/inventory/catalog/page.tsx` (порог уже был реализован как `low_stock_threshold`)

**Как.**
1. Миграция:
   ```sql
   alter table inventory_items add column if not exists min_stock numeric(12,3) default 0;
   ```
2. В каталоге добавить столбец «мин. остаток» (редактируемый для менеджера/владельца).
3. В `/api/admin/notifications/route.ts` добавить блок:
   ```ts
   // Low stock: balance < min_stock (only где min_stock > 0)
   const { data: lowStock } = await supabase
     .from('inventory_balances')
     .select('quantity, location_id, item_id, item:inventory_items(name, min_stock), location:inventory_locations(name, company_id)')
     .gt('inventory_items.min_stock', 0)
     // фильтр по companyScope → join через location.company_id
   ```
   Отфильтровать в JS где `quantity < item.min_stock`. Вернуть top-5 с именем товара и точкой.
4. В колокольчике добавить иконку `AlertTriangle` для `low-stock`.

**Готово когда.** Если на витрине меньше `min_stock` — в колокольчике появляется секция «Низкие остатки» с товаром и точкой; клик ведёт в `/store/showcase`.

**Оценка.** ~1-2 часа.

---

## 3. Keyboard shortcuts для навигации

**Статус:** ✅ Закрыто (2026-04-21)

**Зачем.** Power-user хочет переходить по клавиатуре без мышки. Экономит 1-2 секунды на каждом переходе — в день это заметно.

**Где.**
- `components/keyboard-shortcuts.tsx` — новый клиентский компонент, рендерится в `app/(main)/layout.tsx`
- Использует `navSections` как источник sequence → href

**Сделано.**
- Добавлен `components/keyboard-shortcuts.tsx` c глобальным listener на `keydown`.
- Реализован двухшаговый сценарий `g` + вторая клавиша (таймаут 1.5 сек) и переход через `router.push`.
- Подключены шорткаты: `g d`, `g s`, `g w`, `g r`, `g j`, `g o`, `g t`, `g k`, `g p`.
- Добавлена модалка-подсказка по `?` и закрытие по `Esc`/клику вне окна.
- Игнорируется ввод внутри `input`/`textarea`/`select`/`contenteditable`.
- Компонент подключён в `app/(main)/layout.tsx`.

**Как.**
1. Карта префиксов `g` (go to) + одна клавиша → href. Пример:
   ```ts
   const SHORTCUTS = {
     'g d': '/dashboard',
     'g s': '/store/warehouse',
     'g w': '/store/showcase',
     'g r': '/store/requests',
     'g j': '/store/requests-journal',
     'g o': '/operators',
     'g t': '/tasks',
     'g k': '/kpi',
     'g p': '/pos',
   }
   ```
2. Слушатель `keydown` на `window`:
   - Если нажат `g` — запомнить в state, ждать вторую клавишу 1.5 секунды.
   - Вторая клавиша — если есть в карте, `router.push(href)`.
   - `?` — открыть модалку с подсказками (список всех shortcut'ов).
   - Игнорировать если `document.activeElement` — `<input>`/`<textarea>`/`contenteditable`.
3. Модалка подсказок — простая: сетка клавиш + лейблов, `Esc` закрывает.

**Готово когда.** Нажимаешь `g d` вне инпута → попадаешь на дашборд. `?` → открывается справочник клавиш.

**Оценка.** ~30 мин.

---

## 4. Bulk-действия на заявках

**Статус:** ✅ Закрыто (2026-04-21)

**Зачем.** Менеджер открывает `/store/requests`, видит 15 заявок от 3 точек. Хочет одобрить все от точки А одним кликом, а не по одной.

**Где.**
- `app/(main)/store/requests/page.tsx` — UI с чекбоксами
- `app/api/admin/inventory/requests/bulk/route.ts` — новый batch-endpoint
- Возможно переиспользовать `decideInventoryRequest` в цикле

**Сделано.**
- Добавлен новый endpoint `POST /api/admin/inventory/requests/bulk` в `app/api/admin/inventory/requests/bulk/route.ts`.
- Endpoint принимает `{ requestIds, action }`, проверяет доступ, обрабатывает заявки циклом через `decideInventoryRequest`.
- Для `approve-full` автоматически ставится `approved_qty = requested_qty`; для `reject` передаётся пустой список позиций.
- Возвращается результат батча `{ succeeded, failed }` и пишется единый `writeAuditLog` по массовой операции.
- На `app/(main)/store/requests/page.tsx` добавлены чекбоксы у заявок и чекбокс “выбрать все” в блоке очереди.
- Добавлена sticky action bar снизу: “Одобрить полностью”, “Отклонить”, “Снять выбор”.
- После массового действия показывается итоговый тост “N из M, не удалось K”, затем список перезагружается.

**Как.**
1. В таблице заявок добавить колонку с чекбоксом слева; заголовок — «select all».
2. Состояние `selectedIds: Set<string>` в странице.
3. Когда `selectedIds.size > 0`, показать sticky action bar снизу:
   - «Одобрить полностью» (каждой заявке все позиции)
   - «Отклонить»
   - «Снять выбор»
4. Новый endpoint `POST /api/admin/inventory/requests/bulk` принимает `{ requestIds: string[], action: 'approve-full' | 'reject' }`:
   - Для каждой заявки: загрузить её позиции, вызвать `decideInventoryRequest` с `approved_qty = requested_qty` (или `0` для reject).
   - Обернуть в один `writeAuditLog` с payload всех id.
   - Вернуть `{ succeeded: [...], failed: [...] }`.
5. На фронте: показывать тост «Одобрено N из M, не удалось K».

**Готово когда.** Выбрал 5 заявок → нажал «одобрить» → все 5 ушли в статус `approved_full`, уведомления отправились, UI обновился.

**Оценка.** ~2-3 часа.

---

## 5. Loading skeletons вместо спиннеров

**Статус:** ✅ Закрыто (2026-04-21)

**Зачем.** На каталоге или аналитике загрузка 2-4 сек. Сейчас показывается спиннер на пустой странице — приложение кажется «пустым». Скелетоны создают ощущение, что данные уже почти тут.

**Где.** Страницы с заметной загрузкой:
- `/store/catalog`
- `/store/analytics`
- `/store/abc`
- `/store/forecast`
- `/salary`
- `/analysis`

**Сделано.**
- Добавлен общий компонент `components/ui/skeleton.tsx`.
- На `/store/analytics` заменены два состояния загрузки (сводка по витринам и риск-блок) на карточки-скелетоны.
- На `/store/forecast` заменён спиннер таблицы на скелетон-строки.
- На `/store/abc` унифицированы существующие placeholder-блоки на `Skeleton` компонент.
- На `/salary` заменены загрузочные спиннеры в таблице операторов и в блоке staff на наборы скелетонов.
- На `/analysis` вместо центрального спиннера добавлен полноценный скелетон-лейаут графиков и виджетов.
- `/store/catalog` уже использовал skeleton-like placeholders в `CatalogPageContent`, оставлен без деградации UX.

**Как.**
1. Завести общий компонент `components/ui/skeleton.tsx` (если ещё нет):
   ```tsx
   export function Skeleton({ className }: { className?: string }) {
     return <div className={cn('animate-pulse rounded-md bg-white/5', className)} />
   }
   ```
2. Для таблиц — `<SkeletonRow />` имитирует высоту строки + несколько блоков разной ширины:
   ```tsx
   <Skeleton className="h-4 w-32" />
   <Skeleton className="h-4 w-24" />
   ```
3. На странице: пока `loading && !data`, рендерить 5-10 скелетон-строк вместо `<Spinner />`.
4. На карточках-виджетах — скелетон той же высоты/ширины.

**Готово когда.** Обновляешь каталог → вместо «крутящегося колеса» сразу видишь серые плейсхолдеры в форме таблицы, потом они плавно заменяются данными.

**Оценка.** ~15 мин per page × 6 = ~1.5 часа.

---

## 6. Dashboard-виджеты

**Статус:** ✅ Закрыто (2026-04-21)

**Зачем.** `/dashboard` — самая посещаемая страница. Если там «ничего важного» — каждый раз отсюда уходят в другие разделы. Хочется одним взглядом понимать статус бизнеса.

**Где.** `app/(main)/dashboard/page.tsx` (сначала глянь что там сейчас — может уже частично сделано).

**Сделано.**
- На `app/(main)/dashboard/page.tsx` добавлен блок KPI-виджетов: заявки, открытые смены, низкие остатки, неоплаченные долги, активные операторы.
- Добавлен график “Выручка за 14 дней” (line chart).
- Добавлен график “Топ-5 точек по выручке за 14 дней” (bar chart).
- Добавлен блок “Сегодня / ближайшие дни рождения”.
- Виджеты собирают данные из существующих API: `/api/admin/dashboard`, `/api/admin/notifications`, `/api/admin/shifts`.
- Оставлена текущая детализация дашборда (overview/details/forecast), сверху добавлен краткий управленческий слой.

**Как.** План:
1. Ряд KPI-карточек вверху (4-6 карточек, адаптивная сетка):
   - Выручка сегодня / вчера / неделя (с Δ%)
   - Заявок ожидают решения (число + кнопка «перейти»)
   - Открытых смен
   - Товаров с низким остатком
   - Сумма неоплаченных долгов
   - Активных операторов сейчас
2. Ряд графиков (2 колонки):
   - Выручка за 14 дней (line chart)
   - Топ-5 точек по выручке за неделю (bar chart)
3. Виджет «Сегодня»:
   - Предстоящие дни рождения
   - Задачи на сегодня с дедлайном
4. Каждый виджет — отдельный компонент `components/dashboard/widget-*.tsx`, грузит данные независимо.
5. Серверный endpoint для каждого виджета или один агрегирующий `/api/admin/dashboard/summary`.

**Готово когда.** Зашёл на `/dashboard` → за 2 секунды вижу 6 KPI, 2 графика, список дел. Не нужно ходить в другие разделы чтобы понять, что происходит.

**Оценка.** 1-2 дня (зависит от текущего состояния страницы).

---

## Бэклог (без подробного плана)

### Операционные
- **Action palette в `Cmd+K`** — команды: «создать приход», «одобрить все от точки X», «зарплата за неделю 12». Каждая команда описана как объект с хендлером + параметрами. Дорого (~1 день), но меняет способ работы.
- **Экспорт CSV/Excel** на смены, чеки, движения, ABC. Шаблон: кнопка «Экспорт» → клиентская генерация через `Blob` (как уже сделано в `requests-journal`).
- **Фильтры на `/logs`** — по area, scope, датам, actor.

### Качество
- **Optimistic updates** — при удалении/редактировании сразу обновлять UI, откат на ошибке через toast.
- **Error boundaries** per page — `error.tsx` в каждом `app/(main)/*/` сегменте.
- **Тёмная/светлая тема** — toggle в user menu, CSS custom properties уже готовы.
- **Performance audit** — найти медленные страницы через React DevTools Profiler, вынести тяжёлые вычисления в `useMemo`/workers.

### Мобильный
- Страницы `/store/requests`, `/shifts`, `/operator-dashboard` — пройти с телефона, переверстать проблемные таблицы в карточки.

### AI-driven
- **Контекстный AI** — кнопка «спросить про эту страницу» с текущим состоянием таблицы в контексте.
- **Умные подсказки** — AI смотрит историю приходов/продаж и предлагает: «пора делать приход сигарет — последний был 22 дня назад».

### TODO из CLAUDE.md
- QR-логин в киоске (заглушка на `WelcomeScreen`)
- Загрузка обложек файлом (сейчас только URL)
- Автозапуск `setup-windows.ps1` при NSIS-инсталле киоска
