import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { SITE_NAME } from '@/lib/core/site'
import { LEGAL_ENTITY, PRODUCT_SITE } from '@/lib/core/legal'

export const metadata: Metadata = {
  title: 'Руководство пользователя — Orda',
  description:
    'Полная инструкция по Orda: что это за система, как установить сайт, мобильное приложение, программу точки и киоск, как войти, раздать права, вести смену, кассу, склад, зарплату и аттестацию.',
}

const sections = [
  { id: 'about', title: '1. Что такое Orda' },
  { id: 'start', title: '2. Организация, точки и права' },
  { id: 'web', title: '3. Сайт ordaops.kz' },
  { id: 'mobile', title: '4. Приложение для iPhone и iPad' },
  { id: 'point', title: '5. Программа точки (Windows)' },
  { id: 'kiosk', title: '6. Киоск самообслуживания' },
  { id: 'howto', title: '7. Как делать основное' },
  { id: 'faq', title: '8. Частые вопросы' },
  { id: 'support', title: '9. Поддержка' },
]

/**
 * Руководство пользователя.
 *
 * Публичная страница: её читают до покупки и присылают новому сотруднику
 * вместо получасового объяснения по телефону. Поэтому она устроена по ходу
 * работы — от «что это вообще» к «как открыть смену», — а не по разделам меню.
 *
 * Оформление то же, что у правовых страниц: одна вёрстка на все документы
 * сайта, чтобы они читались как один свод, а не как разные сайты.
 */
export default function HelpPage() {
  return (
    <main className="min-h-screen bg-white text-[#475569]">
      <header className="border-b border-[#e2e8f0] bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 py-4 sm:px-8 lg:px-10">
          <Link href="/" className="flex items-center gap-2.5 text-[#56657d] hover:text-[#16a34a]">
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm">К {SITE_NAME}</span>
          </Link>
          <span className="text-xs text-[#64748b]">Руководство пользователя</span>
        </div>
      </header>

      <div className="mx-auto max-w-screen-2xl px-6 py-12 sm:px-8 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[260px_1fr] lg:items-start">
          <aside className="lg:sticky lg:top-8">
            <div className="rounded-2xl border border-[#d6dde8] bg-[#eef2f8] p-5 shadow-[0_12px_34px_-16px_rgba(15,32,56,0.18)]">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#16a34a]">Содержание</div>
              <ul className="mt-3 space-y-1.5 text-sm">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="block rounded-lg px-2 py-1 text-[#56657d] transition hover:bg-[#16a34a]/[0.07] hover:text-[#16a34a]"
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-4 grid gap-1 text-xs text-[#5b6b82]">
                <Link href="/privacy" className="hover:text-[#16a34a]">→ Политика конфиденциальности</Link>
                <Link href="/terms" className="hover:text-[#16a34a]">→ Пользовательское соглашение</Link>
                <Link href="/offer" className="hover:text-[#16a34a]">→ Публичная оферта</Link>
                <Link href="/sla" className="hover:text-[#16a34a]">→ SLA</Link>
              </div>
            </div>
          </aside>

          <article className="max-w-3xl space-y-10 text-[#475569]">
            <header>
              <h1 className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-[#0f2038] sm:text-4xl">
                Руководство пользователя
              </h1>
              <p className="mt-4 text-sm leading-7 text-[#56657d]">
                Как установить, войти и работать: сайт, приложение для iPhone и
                iPad, программа точки и киоск самообслуживания. Инструкцию можно
                отправить новому сотруднику вместо объяснения по телефону.
              </p>
            </header>

            {/* ── 1 ─────────────────────────────────────────────────────── */}
            <section id="about">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">1. Что такое Orda</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>
                  Orda — система управления точкой продаж: компьютерным клубом,
                  магазином, кофейней. Она закрывает четыре области.
                </p>
                <ul className="list-disc space-y-1 pl-6">
                  <li><strong>Деньги</strong> — выручка, доходы и расходы, отчёт о прибылях и убытках, долги, налоги.</li>
                  <li><strong>Смены и касса</strong> — открытие смены, продажи, пересчёт кассы, сменный отчёт.</li>
                  <li><strong>Склад</strong> — приёмка, списания, ревизия, перемещения на витрину.</li>
                  <li><strong>Люди</strong> — операторы, зарплата, задачи, чек-листы, регламенты, аттестация, общение.</li>
                </ul>
                <p>Система состоит из четырёх программ, работающих с одной базой:</p>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-[#e2e8f0] text-left text-[#0f2038]">
                        <th className="py-2 pr-4 font-semibold">Программа</th>
                        <th className="py-2 pr-4 font-semibold">Где работает</th>
                        <th className="py-2 font-semibold">Для кого</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-[#eef2f8]">
                        <td className="py-2 pr-4">Сайт {PRODUCT_SITE}</td>
                        <td className="py-2 pr-4">любой браузер</td>
                        <td className="py-2">владелец, управляющий, бухгалтер</td>
                      </tr>
                      <tr className="border-b border-[#eef2f8]">
                        <td className="py-2 pr-4">Orda для iPhone и iPad</td>
                        <td className="py-2 pr-4">App Store</td>
                        <td className="py-2">владелец и оператор</td>
                      </tr>
                      <tr className="border-b border-[#eef2f8]">
                        <td className="py-2 pr-4">Orda Point</td>
                        <td className="py-2 pr-4">Windows</td>
                        <td className="py-2">касса на точке</td>
                      </tr>
                      <tr>
                        <td className="py-2 pr-4">Orda Kiosk</td>
                        <td className="py-2 pr-4">Windows</td>
                        <td className="py-2">самообслуживание клиентов</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p>
                  Начинать нужно с сайта: там заводятся точки, люди и права.
                  Остальные программы без этого работать не будут.
                </p>
              </div>
            </section>

            {/* ── 2 ─────────────────────────────────────────────────────── */}
            <section id="start">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">2. Организация, точки и права</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <ol className="list-decimal space-y-1 pl-6">
                  <li>Владелец получает доступ к сайту после оформления подписки. Первый вход — по адресу почты и паролю из письма.</li>
                  <li><strong>«Общие настройки» → «Компании»</strong> — заведите точки. Одна организация может держать несколько.</li>
                  <li><strong>«Сотрудники»</strong> — люди офиса: управляющий, бухгалтер, маркетолог.</li>
                  <li><strong>«Операторы»</strong> — те, кто стоит на смене.</li>
                  <li><strong>«Управление доступом»</strong> — раздайте права.</li>
                </ol>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Права</h3>
                <p>
                  Права — не «должности», а список из 397 разрешений,
                  сгруппированных по страницам. Из них собираются роли:
                  «управляющий», «кассир», «бухгалтер» — любые, какие нужны вашей
                  точке.
                </p>
                <p>
                  Правило простое: человек видит только то, на что ему выдано
                  право. Это действует и на сайте, и в приложении — меню
                  собирается из выданных прав, а не из названия должности.
                </p>
                <p>
                  Отдельно стоит владелец: он видит всё и раздаёт права. Передать
                  владение можно на странице управления доступом.
                </p>
              </div>
            </section>

            {/* ── 3 ─────────────────────────────────────────────────────── */}
            <section id="web">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">3. Сайт {PRODUCT_SITE}</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <h3 className="text-base font-semibold text-[#0f2038]">Вход</h3>
                <p>
                  Адрес: <strong>https://www.ordaops.kz</strong>. Логин — рабочая
                  почта, пароль задаётся при первом входе по ссылке из письма.
                  Забыли — «Восстановить пароль» на экране входа.
                </p>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Что где лежит</h3>
                <ul className="list-disc space-y-1 pl-6">
                  <li><strong>Обзор</strong> — выручка дня, смены, что требует внимания.</li>
                  <li><strong>Доходы</strong> и <strong>Расходы</strong> — журналы; расход заводится с фотографией чека.</li>
                  <li><strong>Рентабельность (ОПиУ)</strong> — прибыль по месяцам: выручка, себестоимость, валовая прибыль, EBITDA, чистая. ФОТ, налоги, амортизация и комиссии эквайринга вносятся вручную — из журналов они не выводятся.</li>
                  <li><strong>Склад</strong> — остатки, приёмки, списания, ревизии, заявки, поставщики.</li>
                  <li><strong>Зарплата</strong> — недельные ведомости, авансы, штрафы и премии.</li>
                  <li><strong>Задачи</strong>, <strong>Чек-листы</strong>, <strong>База знаний</strong>, <strong>Экзамены</strong> — работа команды.</li>
                  <li><strong>Командный чат</strong>, <strong>Сообщения</strong>, <strong>Новости</strong> — общение.</li>
                  <li><strong>Устройства точки</strong> — привязка касс и киосков.</li>
                  <li><strong>Журнал событий</strong> — кто что сделал.</li>
                </ul>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Порядок первого месяца</h3>
                <ol className="list-decimal space-y-1 pl-6">
                  <li>Точки, сотрудники, операторы.</li>
                  <li>Зарплатные правила: ставка, процент от выручки, надбавка за стаж.</li>
                  <li>База знаний — из неё же собираются вопросы аттестации.</li>
                  <li>Чек-листы приёма и закрытия смены.</li>
                  <li>Каталог товаров и остатки склада.</li>
                  <li>Привязка программы точки к устройству.</li>
                </ol>
              </div>
            </section>

            {/* ── 4 ─────────────────────────────────────────────────────── */}
            <section id="mobile">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">4. Приложение для iPhone и iPad</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <h3 className="text-base font-semibold text-[#0f2038]">Установка</h3>
                <p>App Store → поиск «Orda Point» → «Загрузить». Нужен iPhone или iPad с iOS 17 и новее.</p>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Вход</h3>
                <p>
                  Логин и пароль те же, что на сайте: сотрудник входит по почте,
                  оператор — по логину, который выдал владелец.
                </p>
                <p>
                  После первого входа доступен <strong>вход по Face ID</strong>:
                  на экране входа появится соответствующая кнопка. Устройство
                  помнит не пароль, а токен доступа; отключить — «Аккаунт» →
                  «Забыть это устройство».
                </p>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Что видит владелец</h3>
                <p>
                  Разделы собираются из выданных прав: обзор, доходы и расходы,
                  ОПиУ, склад, зарплата, задачи, отчёты, команда, чат.
                </p>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Что видит оператор</h3>
                <p>Пять вкладок: «Смена», «Продажа», «Ревизия», «Задачи», «Профиль».</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li><strong>Смена</strong> — открыть смену с указанием старта кассы, видеть выручку, закрыть смену. Если смену открыл сменщик, видно только его имя: выручку и закрытие видит тот, кто открыл.</li>
                  <li><strong>Продажа</strong> — поиск товара, сканер штрихкодов, оплата наличными или Kaspi, карта лояльности клиента.</li>
                  <li><strong>Ревизия</strong> — пересчёт товара со сканером.</li>
                  <li><strong>Задачи</strong> — принять, уточнить, отказаться с причиной, отправить на проверку.</li>
                  <li><strong>Профиль</strong> — график, деньги, база знаний, экзамены, чат, сообщения, вход на терминал по QR.</li>
                </ul>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Закрытие смены</h3>
                <p>
                  Форма повторяет то, что заполняют на точке: купюры и мелочь
                  отдельно, Kaspi на терминале и онлайн, у ночной смены — сколько
                  прошло до полуночи, долги за смену, старт кассы, wipon. Итог
                  считается на глазах, расхождение с системой видно до отправки.
                </p>
                <p>
                  Закрытие смены создаёт <strong>сменный отчёт</strong> — именно
                  он попадает в выручку дня, в ОПиУ и в зарплату.
                </p>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Уведомления</h3>
                <p>
                  Приходят: новости, личные сообщения, упоминания в чате,
                  объявления, дни рождения операторов, назначенные экзамены и
                  напоминания об их сроке.
                </p>
              </div>
            </section>

            {/* ── 5 ─────────────────────────────────────────────────────── */}
            <section id="point">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">5. Программа точки (Windows)</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Это касса на точке: продажи, смены, ревизия, чек-листы.</p>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Установка</h3>
                <ol className="list-decimal space-y-1 pl-6">
                  <li>Скачайте установщик <code className="rounded bg-[#eef2f8] px-1">Orda-Point-Setup-&lt;версия&gt;.exe</code> со страницы релизов.</li>
                  <li>Запустите. Windows может предупредить о неизвестном издателе — «Подробнее» → «Выполнить в любом случае».</li>
                  <li>После установки программа запросит настройку.</li>
                </ol>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Привязка к точке</h3>
                <p>
                  Программа привязывается не к человеку, а к устройству — так
                  выручка попадает на нужную точку, даже когда за кассой меняются
                  люди.
                </p>
                <ol className="list-decimal space-y-1 pl-6">
                  <li>На сайте: «Устройства точки» → «Добавить устройство» → выберите точку.</li>
                  <li>Скопируйте токен устройства.</li>
                  <li>В программе укажите адрес сервера <code className="rounded bg-[#eef2f8] px-1">https://www.ordaops.kz</code> и вставьте токен.</li>
                  <li>Сохраните. Устройство появится на сайте как активное.</li>
                </ol>
                <p>
                  Токен можно сменить в любой момент: «Устройства точки» →
                  «Обновить токен». Старый перестаёт работать сразу — так
                  закрывают доступ потерянному компьютеру.
                </p>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Вход оператора</h3>
                <p>
                  На привязанном устройстве оператор входит своим логином и
                  паролем. Если пароль временный, программа сразу попросит
                  сменить его.
                </p>
                <p>
                  <strong>Вход по QR.</strong> На экране входа есть кнопка «Войти
                  по QR»: программа показывает код, оператор наводит камеру
                  телефона в приложении Orda («Профиль» → «Вход на точке по QR»)
                  и подтверждает. Пароль при этом нигде не набирается — удобно,
                  когда за спиной очередь. Код живёт несколько минут.
                </p>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Работа за кассой</h3>
                <ul className="list-disc space-y-1 pl-6">
                  <li><strong>Смена</strong> — открытие с указанием старта кассы, закрытие с пересчётом и сменным отчётом.</li>
                  <li><strong>Продажа</strong> — сканер или поиск, наличные и Kaspi, долг клиента, карта лояльности.</li>
                  <li><strong>Возвраты</strong> — из истории чеков.</li>
                  <li><strong>Ревизия</strong> — пересчёт по местам хранения.</li>
                  <li><strong>Чек-листы</strong> — обязательные не дают закрыть смену, пока не пройдены.</li>
                  <li><strong>Заявки на склад</strong> — запрос товара со склада на витрину.</li>
                </ul>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Без интернета</h3>
                <p>
                  Чеки не теряются: они складываются в очередь на устройстве и
                  уходят на сервер, как только появится связь. Пока очередь не
                  пуста, программа предупреждает об этом и не даёт закрыть
                  смену — иначе суммы в отчёте не сойдутся.
                </p>
              </div>
            </section>

            {/* ── 6 ─────────────────────────────────────────────────────── */}
            <section id="kiosk">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">6. Киоск самообслуживания</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Киоск для клиентов: выбор услуги и оплата без оператора.</p>
                <ol className="list-decimal space-y-1 pl-6">
                  <li>Установите <code className="rounded bg-[#eef2f8] px-1">Orda-Kiosk-Setup-&lt;версия&gt;.exe</code>.</li>
                  <li>На сайте создайте станцию и получите ключ подготовки.</li>
                  <li>При первом запуске укажите код станции, адрес сайта и ключ подготовки.</li>
                  <li>Программа зарегистрируется и перейдёт в режим киоска на весь экран.</li>
                </ol>
                <p>
                  Настройки хранятся локально; выход из режима киоска — по
                  служебной комбинации, заданной при установке.
                </p>
              </div>
            </section>

            {/* ── 7 ─────────────────────────────────────────────────────── */}
            <section id="howto">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">7. Как делать основное</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <h3 className="text-base font-semibold text-[#0f2038]">Завести оператора</h3>
                <p>
                  Сайт → «Операторы» → «Добавить», либо в приложении: «Команда» →
                  «плюс». Имя, телефон, точка. Тут же создаётся вход в программу
                  точки — логин и временный пароль показываются один раз, их
                  нужно передать человеку сразу (можно отправить в Telegram, если
                  он привязан).
                </p>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Провести расход</h3>
                <p>
                  Приложение: «Расходы» → «плюс» → сумма, категория, точка,
                  комментарий, фото чека. Расходы сверх лимита уходят на
                  подтверждение владельцу — он видит их в «Ожидающих расходах».
                </p>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Посмотреть прибыль</h3>
                <p>
                  «Рентабельность (ОПиУ)»: выберите период. Отчёт за период и
                  разбор по месяцам, у каждой строки доля в выручке. Если ФОТ за
                  месяц не заполнен, приложение предупредит: EBITDA завышена
                  ровно на него.
                </p>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Назначить аттестацию</h3>
                <p>
                  Сайт → «Экзамены»: выберите точки и операторов, число вопросов
                  и порог сдачи. Вопросы собираются из базы знаний вашей точки —
                  списать со стороны нельзя. Оператор сдаёт в приложении или в
                  Telegram; развёрнутые ответы оценивает ИИ, но последнее слово
                  за руководителем. Не сдал — можно назначить пересдачу, билет
                  соберётся новый.
                </p>

                <h3 className="pt-2 text-base font-semibold text-[#0f2038]">Разобрать жалобу на сообщение</h3>
                <p>
                  Любой сотрудник может пожаловаться на сообщение в чате (долгое
                  нажатие → «Пожаловаться») и заблокировать собеседника в личной
                  переписке. Жалобы видны владельцу в разделе «Модерация» вместе
                  с находками ночной проверки.
                </p>
              </div>
            </section>

            {/* ── 8 ─────────────────────────────────────────────────────── */}
            <section id="faq">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">8. Частые вопросы</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>Не могу войти в приложение.</strong> Проверьте, что учётную запись выдал владелец и она активна. Оператор входит по логину, а не по почте. Если пароль временный, войдите сначала в программе на точке — она попросит его сменить.</p>
                <p><strong>В приложении нет раздела, который есть на сайте.</strong> Значит, право на него не выдано: меню строится из прав. Попросите владельца открыть «Управление доступом».</p>
                <p><strong>Смена открыта, но выручки не видно.</strong> Смену видит тот, кто её открыл. Сменщик видит только имя и время.</p>
                <p><strong>Цифры в приложении и на сайте разные.</strong> Проверьте период и выбранную точку. Если расхождение осталось — напишите в поддержку, приложив обе цифры и даты.</p>
                <p><strong>Чеки не уходят.</strong> Нет связи. Программа держит их в очереди; как появится интернет, нажмите «Отправить сейчас» или дождитесь автоматической отправки.</p>
                <p><strong>Пропал доступ к чату.</strong> Чат привязан к организации. Если вы работаете с несколькими организациями, выберите нужную в переключателе сверху.</p>
              </div>
            </section>

            {/* ── 9 ─────────────────────────────────────────────────────── */}
            <section id="support">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">9. Поддержка</h2>
              <div className="mt-4 space-y-2 text-sm leading-7">
                <p>Почта: <strong>{LEGAL_ENTITY.emailSupport}</strong></p>
                <p>Телефон: <strong>{LEGAL_ENTITY.phone}</strong></p>
                <p>Сайт: <strong>https://www.ordaops.kz</strong></p>
                <p className="pt-2">
                  Правовые документы: <Link href="/privacy" className="text-[#16a34a] hover:underline">политика конфиденциальности</Link>,{' '}
                  <Link href="/terms" className="text-[#16a34a] hover:underline">пользовательское соглашение</Link>,{' '}
                  <Link href="/offer" className="text-[#16a34a] hover:underline">оферта</Link>,{' '}
                  <Link href="/sla" className="text-[#16a34a] hover:underline">SLA</Link>.
                </p>
              </div>
            </section>

            <footer className="border-t border-[#e2e8f0] pt-8 text-xs text-[#64748b]">
              <p>© 2026 {LEGAL_ENTITY.shortName}. Все права защищены.</p>
            </footer>
          </article>
        </div>
      </div>
    </main>
  )
}
