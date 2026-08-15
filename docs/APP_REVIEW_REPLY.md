# Ответ Apple на Guideline 2.1 — Information Needed

Текст ниже вставляется в **App Store Connect → App Review Information →
Notes** и отправляется ответом в разделе разрешения проблемы. Апелляции здесь
не нужно: Apple просит сведения, а не оспаривает отказ.

Пункт 1 (видеозапись) — единственное, что нужно снять руками; сценарий съёмки
в конце файла.

---

## Текст для поля Notes (на английском)

```
ABOUT THE APP

Orda Point is a business management app for owners and staff of small offline
points of sale in Kazakhstan: gaming clubs, shops and coffee shops. It is the
mobile client of the ordaops.kz service.

The problem it solves: a point owner cannot be at the counter all day, and the
person at the counter has no tools beyond a paper notebook. The app gives the
owner the day's revenue, profit and loss, stock and payroll from wherever they
are, and gives the operator on shift everything the shift needs: opening the
till, selling, stocktaking, checklists, tasks and their own salary.

Target audience: owners, managers and shift operators of an organization that
already uses the ordaops.kz service. The app is not a consumer product and has
no public sign-up: an account is issued by the owner of the organization.

There are no purchases, subscriptions or paid content inside the app. The
organization's subscription is managed on the website; the app contains no
purchase or payment flows and no links to them.

TEST ACCOUNTS

Owner / management account (sees money, stock, payroll, tasks, team):
  login: <e-mail владельца>
  password: <пароль>

Operator account (shift, point of sale, stocktaking, tasks, own salary):
  login: <логин оператора>
  password: <пароль>

Note: an operator signs in with a login name, not an e-mail address. Both
accounts belong to a real organization filled with sample data.

HOW TO REACH THE MAIN FEATURES

Owner account:
  • Overview — revenue since the start of the day, open shifts, what needs a
    decision.
  • Sections → Income / Expenses — add an income or an expense with a photo of
    the receipt.
  • Sections → Profitability (ОПиУ) — profit and loss by month: revenue, cost
    of goods, EBITDA, net profit.
  • Sections → Warehouse, Salary, Tasks, Team chat, Messages.

Operator account (five tabs at the bottom):
  • Смена (Shift) — open a shift, see revenue, close the shift with a full
    cash count.
  • Продажа (Sale) — sell goods, attach a loyalty customer, take payment.
  • Ревизия (Stocktaking) — count stock, with or without the barcode scanner.
  • Задачи (Tasks) — respond to tasks from the manager.
  • Профиль (Profile) — schedule, salary, knowledge base, exams, chat,
    messages, account settings.

ACCOUNT DELETION

Profile tab (or the person icon in the top bar on iPad) → Аккаунт (Account) →
Удалить аккаунт (Delete account) → confirm. Sign-in stops working immediately
and personal contact data is erased. Business records (shifts, revenue, payroll
sheets) remain with the organization: they belong to the point's accounting and
to other people's payroll, not to the account. This is stated in the app before
confirmation and in the privacy policy, section 11.

USER-GENERATED CONTENT: REPORTING AND BLOCKING

The app has an internal team chat and one-to-one messages between employees of
the same organization. Content is not public and is not visible outside the
organization.

  • Filtering: every message is checked server-side before it is stored; a
    nightly AI pass flags suspicious messages for the owner.
  • Reporting: long-press any message from another person → Пожаловаться
    (Report). The report goes to the organization owner's moderation screen.
    The sender is not notified.
  • Blocking: in a one-to-one conversation → "⋯" → Заблокировать (Block).
    Messages stop being delivered in both directions; the block is silent and
    can be removed in the same place.
  • Published contact: support@turanix.kz, also shown in the app under
    Account → Documents.

PERMISSION PROMPTS

  • Camera — barcode scanning during a sale or stocktaking, and taking a photo
    of a receipt when adding an expense.
  • Microphone — recording a voice message in the team chat.
  • Face ID — optional quick sign-in and optional app lock.
  • Notifications — news, direct messages, mentions, assigned exams, expenses
    awaiting approval.

The app does not request location, contacts, photos library access or App
Tracking Transparency, and does no tracking at all.

EXTERNAL SERVICES

The app itself talks only to our own API at https://www.ordaops.kz. Behind that
API we use:

  • Supabase (PostgreSQL database, authentication, file storage) — EU region.
  • Vercel — hosting of the API and the web application.
  • Apple Push Notification service — push notifications.
  • OpenAI (gpt-4o-mini) — three server-side features only: moderation of chat
    messages, grading of free-text exam answers (the final decision always
    stays with the manager), and business report summaries. No user data is
    used for model training.
  • Telegram Bot API — optional duplicate of notifications for staff who use
    Telegram.
  • Google Wallet API — optional loyalty cards, off by default.

There are no analytics SDKs, no advertising networks and no third-party
trackers in the app.

DEVICES AND OS USED FOR TESTING

  • iPhone <модель>, iOS <версия>
  • iPad <модель>, iPadOS <версия>
  (плюс симуляторы iPhone 17 Pro Max и iPad Pro 13" на iOS 26.5 при разработке)

REGIONAL DIFFERENCES

The app behaves identically in every region. Its interface is Russian only and
amounts are shown in Kazakhstani tenge, because the service is sold in
Kazakhstan; no feature is enabled or disabled based on the user's country.

REGULATED INDUSTRY AND THIRD-PARTY MATERIAL

The app does not operate in a regulated industry. It is not a bank, a payment
service or a medical product: it does not process payments, does not hold
customer funds and does not handle health data. Cash and card amounts are
recorded as accounting entries typed in by the organization's own staff.

All content in the app belongs to the organization using it: its own goods,
regulations, employees and messages. The app contains no third-party protected
material.

The operator of the service is Turanix LLP (ТОО «Turanix»), Ust-Kamenogorsk,
Kazakhstan. Privacy policy: https://www.ordaops.kz/privacy
User guide: https://www.ordaops.kz/help
```

---

## Сценарий видеозаписи (пункт 1)

Снимать **на живом устройстве**, не на симуляторе — Apple это проверяет по
метаданным. Экранная запись iOS: «Настройки» → «Пункт управления» → добавить
«Запись экрана», затем свайп вниз и красная кнопка.

Одна запись, 3–5 минут, без монтажа. Порядок:

1. **Запуск с нуля.** Начать с домашнего экрана, нажать значок Orda. Показать
   экран входа.
2. **Вход владельцем.** Ввести почту и пароль. Дождаться загрузки сводки.
3. **Обзор** — прокрутить: выручка, смены, что требует внимания.
4. **Расход с фотографией.** «Разделы» → «Расходы» → плюс → сумма, категория →
   «Снять чек» → **показать системный запрос доступа к камере** → снять →
   сохранить.
5. **ОПиУ** — открыть, показать отчёт за период и разбор по месяцам.
6. **Командный чат.** Написать сообщение. Записать голосовое — **показать
   запрос доступа к микрофону**. Долгим нажатием на чужое сообщение открыть
   меню и показать **«Пожаловаться»**.
7. **Личные сообщения.** Открыть переписку → «⋯» → показать
   **«Заблокировать»** и подтверждение.
8. **Выход и вход оператором.** Профиль → «Выйти» → войти логином оператора.
9. **Смена и продажа.** Открыть смену (старт кассы) → «Продажа» → сканер →
   **показать запрос доступа к камере**, если он ещё не выдавался → добавить
   товар → выбрать клиента по карте → провести оплату.
10. **Закрытие смены** — показать форму с купюрами, мелочью, Kaspi и итогом.
11. **Удаление аккаунта.** Профиль → «Аккаунт» → «Удалить аккаунт» → показать
    предупреждение и подтверждение. **Не подтверждать** на боевой учётке —
    достаточно показать экран; если хотите показать целиком, заведите отдельную
    учётку для съёмки.

Если запись выходит длиннее пяти минут, разбейте на две: «владелец» и
«оператор». Загружаются они в App Store Connect как вложение в ответе
рецензенту.

## Что заполнить перед отправкой

- логины и пароли двух демо-учёток в тексте выше и в полях App Review
  Information;
- модели устройств и версии iOS, на которых проверяли;
- ссылку на видео (вложением или ссылкой на облако с открытым доступом).
