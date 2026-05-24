import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { SITE_NAME } from '@/lib/core/site'
import {
  LEGAL_ENTITY,
  LEGAL_EFFECTIVE_DATE,
  LEGAL_HISTORY,
  LEGAL_LAST_UPDATED,
  LEGAL_VERSION,
  PRODUCT_NAME,
  PRODUCT_SITE,
} from '@/lib/core/legal'

export const metadata: Metadata = {
  title: `Политика конфиденциальности — ${PRODUCT_NAME}`,
  description: `Политика обработки персональных данных в информационной системе ${PRODUCT_NAME} (${LEGAL_ENTITY.shortName}). Соответствие Закону Республики Казахстан «О персональных данных и их защите».`,
}

const sections = [
  { id: 'overview', title: '1. Общие положения' },
  { id: 'definitions', title: '2. Термины и определения' },
  { id: 'operator', title: '3. Кто обрабатывает данные' },
  { id: 'data-types', title: '4. Какие данные собираются' },
  { id: 'purposes', title: '5. Цели обработки' },
  { id: 'legal', title: '6. Правовые основания' },
  { id: 'storage', title: '7. Хранение и защита' },
  { id: 'processors', title: '8. Привлечённые обработчики' },
  { id: 'cross-border', title: '9. Трансграничная передача' },
  { id: 'cookies', title: '10. Cookies и аналитика' },
  { id: 'rights', title: '11. Права субъекта данных' },
  { id: 'children', title: '12. Данные несовершеннолетних' },
  { id: 'retention', title: '13. Сроки хранения' },
  { id: 'changes', title: '14. Изменения политики' },
  { id: 'contacts', title: '15. Контакты для запросов' },
  { id: 'history', title: '16. История редакций' },
]

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.08),transparent_25%),linear-gradient(180deg,#050816_0%,#0a1020_48%,#050816_100%)] text-white">
      <header className="border-b border-white/5 bg-black/30 backdrop-blur">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 py-4 sm:px-8 lg:px-10">
          <Link href="/" className="flex items-center gap-2.5 text-slate-200 hover:text-amber-200">
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm">К {SITE_NAME}</span>
          </Link>
          <span className="text-xs text-slate-500">
            Версия от {LEGAL_VERSION} · обновлено {LEGAL_LAST_UPDATED}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-screen-2xl px-6 py-12 sm:px-8 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[260px_1fr] lg:items-start">
          <aside className="lg:sticky lg:top-8">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs font-semibold uppercase tracking-wider text-amber-200">
                Содержание
              </div>
              <ul className="mt-3 space-y-1.5 text-sm">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="block rounded-lg px-2 py-1 text-slate-300 transition hover:bg-white/5 hover:text-white"
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
              <div className="mt-4 grid gap-1 text-xs text-slate-400">
                <Link href="/offer" className="hover:text-amber-200">→ Публичная оферта</Link>
                <Link href="/terms" className="hover:text-amber-200">→ Пользовательское соглашение</Link>
                <Link href="/sla" className="hover:text-amber-200">→ SLA</Link>
                <Link href="/cookies" className="hover:text-amber-200">→ Cookies</Link>
              </div>
            </div>
          </aside>

          <article className="max-w-3xl space-y-8 text-slate-200">
            <header>
              <h1 className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-white sm:text-4xl">
                Политика конфиденциальности
                <br />
                и обработки персональных данных
              </h1>
              <p className="mt-4 text-sm leading-7 text-slate-400">
                Настоящая Политика разработана в соответствии с Законом Республики
                Казахстан «О персональных данных и их защите» № 94-V от 21 мая
                2013 года, Законом Республики Казахстан «Об информатизации»
                № 418-V от 24 ноября 2015 года и иными нормативными правовыми
                актами Республики Казахстан.
              </p>
              <p className="mt-3 text-sm leading-7 text-slate-400">
                <strong>Дата вступления в силу:</strong> {LEGAL_EFFECTIVE_DATE}
                <br />
                <strong>Версия:</strong> {LEGAL_VERSION}
              </p>
            </header>

            <section id="overview">
              <h2 className="text-2xl font-semibold tracking-tight text-white">1. Общие положения</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>1.1.</strong> Настоящая Политика определяет порядок обработки и защиты персональных данных, получаемых при использовании Сервиса «{PRODUCT_NAME}» (далее — Сервис), доступного по адресу {PRODUCT_SITE} и в виде клиентских приложений Operator Desktop и Kiosk для Windows.</p>
                <p><strong>1.2.</strong> Использование Сервиса означает выражение согласия пользователя с условиями настоящей Политики.</p>
                <p><strong>1.3.</strong> Если пользователь не согласен с условиями настоящей Политики, ему следует прекратить использование Сервиса.</p>
              </div>
            </section>

            <section id="definitions">
              <h2 className="text-2xl font-semibold tracking-tight text-white">2. Термины и определения</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong className="text-white">Персональные данные</strong> — сведения, относящиеся к определённому или определяемому на их основании субъекту персональных данных, зафиксированные на электронном, бумажном и (или) ином материальном носителе.</p>
                <p><strong className="text-white">Субъект персональных данных</strong> — физическое лицо, к которому относятся персональные данные: сотрудник, оператор, клиент клуба, посетитель сайта и т.п.</p>
                <p><strong className="text-white">Собственник (оператор) персональных данных</strong> — лицо, определяющее цели и средства обработки персональных данных. В отношении сотрудников, операторов и клиентов клуба Заказчика собственником является сам Заказчик.</p>
                <p><strong className="text-white">Уполномоченное лицо (обработчик)</strong> — лицо, осуществляющее обработку персональных данных по поручению собственника. В отношении персональных данных сотрудников, операторов и клиентов клуба Заказчика {LEGAL_ENTITY.shortName} действует как уполномоченное лицо.</p>
                <p><strong className="text-white">Обработка персональных данных</strong> — действия, направленные на накопление, хранение, изменение, дополнение, использование, распространение, обезличивание, блокирование и уничтожение персональных данных.</p>
              </div>
            </section>

            <section id="operator">
              <h2 className="text-2xl font-semibold tracking-tight text-white">3. Кто обрабатывает данные</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>3.1.</strong> Оператором обработки персональных данных в Сервисе является {LEGAL_ENTITY.fullName} (БИН {LEGAL_ENTITY.bin}, адрес: {LEGAL_ENTITY.address}).</p>
                <p><strong>3.2.</strong> Контакты для обращений по вопросам обработки персональных данных:</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>email (общий): {LEGAL_ENTITY.emailInfo}</li>
                  <li>email (поддержка и запросы по персональным данным): {LEGAL_ENTITY.emailSupport}</li>
                  <li>телефон: {LEGAL_ENTITY.phone}</li>
                </ul>
                <p><strong>3.3.</strong> В отношении персональных данных сотрудников, операторов и клиентов клуба собственником (оператором) персональных данных является Заказчик, использующий Сервис. {LEGAL_ENTITY.shortName} действует как уполномоченное лицо (обработчик) в рамках поручения, оформленного акцептом публичной оферты.</p>
              </div>
            </section>

            <section id="data-types">
              <h2 className="text-2xl font-semibold tracking-tight text-white">4. Какие данные собираются</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>4.1. Данные учётной записи Заказчика и его сотрудников:</strong></p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>email, пароль (в захешированном виде, без возможности восстановления оригинала);</li>
                  <li>ФИО, краткое имя (отображаемое);</li>
                  <li>номер мобильного телефона;</li>
                  <li>должность, роль в организации (owner, manager, marketer, other);</li>
                  <li>идентификатор чата в Telegram (telegram_chat_id) для получения уведомлений — указывается добровольно;</li>
                  <li>фотография профиля (загружается добровольно);</li>
                  <li>дата найма, история мест работы внутри Сервиса.</li>
                </ul>
                <p><strong>4.2. Данные операторов точек продаж:</strong> ФИО, краткое имя, телефон, email, фотография, должность, дата найма, telegram_chat_id, документы оператора и сроки их действия (трудовой договор, медицинская книжка, лицензии — на усмотрение Заказчика).</p>
                <p><strong>4.3. Данные клиентов клуба (CRM):</strong> имя, телефон, email, номер карты лояльности (штрихкод), бонусные баллы, история визитов и покупок, общая сумма покупок, заметки менеджера.</p>
                <p><strong>4.4. Финансовые и операционные данные бизнеса Заказчика:</strong> продажи, возвраты, долги, доходы, расходы (по категориям и поставщикам), зарплатные правила и выплаты, склад и остатки, чеки, отчёты смен, Z-отчёты, реестры товаров и категорий.</p>
                <p><strong>4.5. Технические данные:</strong> IP-адрес, тип браузера и устройства, идентификаторы сессий Supabase Auth, токены устройств Operator Desktop и Kiosk, журналы запросов и событий, журналы аудита (audit log).</p>
                <p><strong>4.6. Cookies и локальное хранилище:</strong> файлы cookies, данные localStorage (настройки оператора, отложенные чеки), очереди операций Operator Desktop. Подробнее — на странице <Link href="/cookies" className="text-amber-200 hover:underline">/cookies</Link>.</p>
                <p><strong>4.7. Файлы:</strong> вложения чата команды, фотографии чеков, документы расходов и рекламных материалов, фотографии операторов — хранятся в Supabase Storage.</p>
                <p><strong>4.8.</strong> Сервис НЕ собирает: биометрические данные, специальные категории персональных данных (раса, политические убеждения, состояние здоровья, религиозные убеждения), реквизиты банковских карт пользователей, геолокацию в реальном времени.</p>
              </div>
            </section>

            <section id="purposes">
              <h2 className="text-2xl font-semibold tracking-tight text-white">5. Цели обработки</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Персональные данные обрабатываются для следующих целей:</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>предоставление доступа к Сервису и идентификация пользователей;</li>
                  <li>учёт смен, продаж, расходов, зарплат и иной операционной деятельности Заказчика;</li>
                  <li>ведение программы лояльности клиентов клуба Заказчика;</li>
                  <li>отправка отчётов и уведомлений через Telegram сотрудникам Заказчика;</li>
                  <li>отправка системных email-сообщений (подтверждение регистрации, сброс пароля, заявки с лендинга);</li>
                  <li>работа AI/OCR-функций (распознавание чеков, прогнозы, аналитика) — данные передаются обезличенно или в обезличиваемом виде поставщикам моделей;</li>
                  <li>обеспечение безопасности Сервиса (журналы аудита, обнаружение аномалий);</li>
                  <li>исполнение требований законодательства Республики Казахстан;</li>
                  <li>улучшение Сервиса на основе обезличенной аналитики использования.</li>
                </ul>
              </div>
            </section>

            <section id="legal">
              <h2 className="text-2xl font-semibold tracking-tight text-white">6. Правовые основания</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Обработка персональных данных осуществляется на следующих основаниях:</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>согласие субъекта персональных данных, выраженное при регистрации в Сервисе и/или при предоставлении данных сотрудникам Заказчика;</li>
                  <li>исполнение договора (публичной оферты), заключённого с Заказчиком;</li>
                  <li>законные интересы Исполнителя (обеспечение безопасности Сервиса, противодействие мошенничеству);</li>
                  <li>исполнение требований законодательства Республики Казахстан.</li>
                </ul>
              </div>
            </section>

            <section id="storage">
              <h2 className="text-2xl font-semibold tracking-tight text-white">7. Хранение и защита</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>7.1.</strong> Персональные данные хранятся в защищённой управляемой базе данных PostgreSQL на инфраструктуре Supabase, файлы — в Supabase Storage. Передача данных между клиентом и сервером осуществляется по защищённому протоколу HTTPS/TLS.</p>
                <p><strong>7.2.</strong> Доступ к данным каждой организации Заказчика изолирован на уровне базы данных (Row Level Security) и проверяется на каждом запросе к API.</p>
                <p><strong>7.3.</strong> Operator Desktop хранит локально (на устройстве оператора): настройки интерфейса, отложенные чеки и очередь операций (продажи, долги, заявки на инвентарь, отчёты смен), которые ожидают синхронизации с сервером. После успешной синхронизации эти данные передаются на сервер и могут быть удалены локально.</p>
                <p><strong>7.4.</strong> Резервное копирование баз данных осуществляется средствами Supabase в соответствии с политикой провайдера. Дополнительная backup-логика на стороне Исполнителя в настоящее время не реализована.</p>
                <p><strong>7.5.</strong> Пароли пользователей хранятся в виде криптографических хешей и не могут быть восстановлены в исходном виде — только сброшены.</p>
              </div>
            </section>

            <section id="processors">
              <h2 className="text-2xl font-semibold tracking-tight text-white">8. Привлечённые обработчики</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Для работы Сервиса {LEGAL_ENTITY.shortName} привлекает следующих обработчиков:</p>
                <div className="space-y-2">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="font-semibold text-white">Supabase Inc.</div>
                    <div className="text-xs text-slate-400">Управляемая база данных PostgreSQL, аутентификация, файловое хранилище. Передаётся: вся бизнес-логика и данные Заказчика.</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="font-semibold text-white">Vercel Inc.</div>
                    <div className="text-xs text-slate-400">Хостинг веб-приложения и веб-аналитика (Vercel Analytics). Передаётся: обезличенные метрики просмотров страниц, технические данные браузера.</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="font-semibold text-white">OpenAI, LLC</div>
                    <div className="text-xs text-slate-400">Модели искусственного интеллекта (GPT). Передаётся: тексты запросов AI-помощника, изображения чеков для распознавания, обезличенные финансовые данные для прогнозов.</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="font-semibold text-white">Google LLC (Google Gemini)</div>
                    <div className="text-xs text-slate-400">Резервный поставщик AI-моделей. Передаётся: те же данные, что и OpenAI, при недоступности основного поставщика.</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="font-semibold text-white">Telegram FZ-LLC (Telegram Bot API)</div>
                    <div className="text-xs text-slate-400">Отправка отчётов и уведомлений сотрудникам Заказчика. Передаётся: текст уведомлений, кассовые отчёты, идентификаторы чатов сотрудников.</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="font-semibold text-white">Поставщик SMTP-почты</div>
                    <div className="text-xs text-slate-400">Отправка системных email (подтверждение регистрации, сброс пароля, заявки с лендинга) через библиотеку nodemailer. Передаётся: email-адрес, текст сообщения.</div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="font-semibold text-white">АО «Kaspi Bank» и иные банки</div>
                    <div className="text-xs text-slate-400">Расчёты по выставленным счетам. Реквизиты банковских карт Заказчика в Сервисе не хранятся.</div>
                  </div>
                </div>
                <p>Каждый обработчик связан собственными политиками обработки данных и соответствующими договорами.</p>
              </div>
            </section>

            <section id="cross-border">
              <h2 className="text-2xl font-semibold tracking-tight text-white">9. Трансграничная передача</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>9.1.</strong> Часть привлечённых обработчиков (Supabase, Vercel, OpenAI, Google, Telegram) располагает инфраструктурой за пределами Республики Казахстан, в том числе в США и странах Европейского Союза.</p>
                <p><strong>9.2.</strong> Регистрируясь в Сервисе и продолжая его использование, пользователь даёт согласие на трансграничную передачу своих персональных данных в указанные страны в объёме, необходимом для оказания услуг Сервиса.</p>
                <p><strong>9.3.</strong> Трансграничная передача осуществляется в соответствии с требованиями Закона Республики Казахстан «О персональных данных и их защите».</p>
              </div>
            </section>

            <section id="cookies">
              <h2 className="text-2xl font-semibold tracking-tight text-white">10. Cookies и аналитика</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Сервис использует файлы cookies и аналогичные технологии для аутентификации, сохранения настроек пользователя и сбора обезличенной статистики посещений через Vercel Analytics. Подробный перечень cookies, их назначение и сроки хранения описаны на отдельной странице <Link href="/cookies" className="text-amber-200 hover:underline">/cookies</Link>.</p>
              </div>
            </section>

            <section id="rights">
              <h2 className="text-2xl font-semibold tracking-tight text-white">11. Права субъекта данных</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>В соответствии с Законом РК «О персональных данных и их защите» субъект персональных данных имеет право:</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>получать информацию об обработке своих персональных данных;</li>
                  <li>требовать изменения и дополнения своих персональных данных при наличии оснований;</li>
                  <li>требовать блокирования или уничтожения своих персональных данных, если они обрабатываются с нарушением требований законодательства;</li>
                  <li>отозвать согласие на обработку персональных данных;</li>
                  <li>обжаловать действия (бездействие) собственника или уполномоченного лица в уполномоченный государственный орган или в суд.</li>
                </ul>
                <p>Для реализации указанных прав необходимо направить запрос на {LEGAL_ENTITY.emailSupport}. Ответ предоставляется в срок не более 15 (пятнадцати) рабочих дней с момента получения запроса.</p>
                <p>В отношении данных сотрудников, операторов и клиентов клуба Заказчика запросы рассматриваются совместно с Заказчиком как собственником этих данных.</p>
              </div>
            </section>

            <section id="children">
              <h2 className="text-2xl font-semibold tracking-tight text-white">12. Данные несовершеннолетних</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Сервис не предназначен для прямого использования лицами, не достигшими 16 лет. Если Заказчик вносит в Сервис данные о несовершеннолетних клиентах клуба, Заказчик гарантирует наличие согласия их законных представителей в соответствии с законодательством Республики Казахстан.</p>
              </div>
            </section>

            <section id="retention">
              <h2 className="text-2xl font-semibold tracking-tight text-white">13. Сроки хранения</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>13.1.</strong> Персональные данные хранятся в течение срока действия подписки Заказчика и не менее 30 (тридцати) календарных дней после её прекращения для предоставления Заказчику возможности выгрузки данных.</p>
                <p><strong>13.2.</strong> После истечения этого срока данные могут быть удалены или обезличены, за исключением данных, обязательных к хранению в силу требований законодательства (журналы аудита, налоговые документы).</p>
                <p><strong>13.3.</strong> Журналы технических событий и аудита хранятся в течение 12 (двенадцати) месяцев.</p>
              </div>
            </section>

            <section id="changes">
              <h2 className="text-2xl font-semibold tracking-tight text-white">14. Изменения политики</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>{LEGAL_ENTITY.shortName} вправе в одностороннем порядке вносить изменения в настоящую Политику. Новая редакция вступает в силу с момента её публикации по адресу {PRODUCT_SITE}/privacy. О существенных изменениях пользователи уведомляются не менее чем за 30 (тридцать) календарных дней.</p>
              </div>
            </section>

            <section id="contacts">
              <h2 className="text-2xl font-semibold tracking-tight text-white">15. Контакты для запросов</h2>
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm leading-7">
                <div className="grid gap-2 text-slate-300">
                  <div><strong className="text-white">Оператор данных:</strong> {LEGAL_ENTITY.fullName}</div>
                  <div><strong className="text-white">БИН:</strong> {LEGAL_ENTITY.bin}</div>
                  <div><strong className="text-white">Адрес:</strong> {LEGAL_ENTITY.address}</div>
                  <div><strong className="text-white">Email для запросов:</strong> {LEGAL_ENTITY.emailSupport}</div>
                  <div><strong className="text-white">Телефон:</strong> {LEGAL_ENTITY.phone}</div>
                </div>
              </div>
            </section>

            <section id="history">
              <h2 className="text-2xl font-semibold tracking-tight text-white">16. История редакций</h2>
              <div className="mt-4 space-y-2 text-sm leading-7">
                {LEGAL_HISTORY.map((entry) => (
                  <div key={entry.date} className="flex gap-3">
                    <span className="shrink-0 font-mono text-xs text-amber-200">{entry.date}</span>
                    <span className="text-slate-300">{entry.note}</span>
                  </div>
                ))}
              </div>
            </section>

            <footer className="border-t border-white/10 pt-8 text-xs text-slate-500">
              <p>
                Настоящая Политика составлена в соответствии с Законом Республики
                Казахстан «О персональных данных и их защите» № 94-V от 21.05.2013,
                Законом Республики Казахстан «Об информатизации» № 418-V от
                24.11.2015 и иными нормативными правовыми актами Республики
                Казахстан.
              </p>
              <p className="mt-2">© 2026 {LEGAL_ENTITY.shortName}. Все права защищены.</p>
            </footer>
          </article>
        </div>
      </div>
    </main>
  )
}
