import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { SITE_NAME } from '@/lib/core/site'

export const metadata: Metadata = {
  title: 'Политика конфиденциальности — OrdaOps',
  description:
    'Политика обработки персональных данных в информационной системе OrdaOps. Соответствие Закону Республики Казахстан «О персональных данных и их защите».',
}

const sections = [
  { id: 'overview', title: '1. Общие положения' },
  { id: 'definitions', title: '2. Термины и определения' },
  { id: 'operator', title: '3. Кто обрабатывает данные' },
  { id: 'data-types', title: '4. Какие данные собираются' },
  { id: 'purposes', title: '5. Цели обработки' },
  { id: 'legal', title: '6. Правовые основания' },
  { id: 'storage', title: '7. Хранение и защита' },
  { id: 'transfer', title: '8. Передача третьим лицам' },
  { id: 'cross-border', title: '9. Трансграничная передача' },
  { id: 'cookies', title: '10. Файлы cookie и аналитика' },
  { id: 'rights', title: '11. Права субъекта данных' },
  { id: 'children', title: '12. Данные несовершеннолетних' },
  { id: 'changes', title: '13. Изменения политики' },
  { id: 'contacts', title: '14. Контакты для запросов' },
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
          <span className="text-xs text-slate-500">Версия от 06.05.2026</span>
        </div>
      </header>

      <div className="mx-auto max-w-screen-2xl px-6 py-12 sm:px-8 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[260px_1fr] lg:items-start">
          {/* TOC */}
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
                Казахстан № 94-V от 21 мая 2013 года «О персональных данных и их
                защите», Законом РК № 418-V от 24 ноября 2015 года «Об
                информатизации» и иными нормативными правовыми актами РК.
              </p>
              <p className="mt-3 text-sm leading-7 text-slate-400">
                <strong>Дата вступления в силу:</strong> 06 мая 2026 года
              </p>
            </header>

            {/* 1. Общие положения */}
            <section id="overview">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                1. Общие положения
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>
                  <strong>1.1.</strong> Настоящая Политика определяет порядок
                  обработки и защиты персональных данных, получаемых при
                  использовании Сервиса «{SITE_NAME}» (далее — Сервис), доступного
                  по адресу ordaops.kz и в виде клиентских программ для Windows.
                </p>
                <p>
                  <strong>1.2.</strong> Использование Сервиса означает выражение
                  согласия пользователя с условиями настоящей Политики.
                </p>
                <p>
                  <strong>1.3.</strong> Если пользователь не согласен с условиями
                  Политики, он должен прекратить использование Сервиса.
                </p>
                <p>
                  <strong>1.4.</strong> Настоящая Политика применяется только к
                  Сервису «{SITE_NAME}» и не распространяется на сторонние сайты,
                  ссылки на которые могут содержаться в Сервисе.
                </p>
              </div>
            </section>

            {/* 2. Термины */}
            <section id="definitions">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                2. Термины и определения
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>
                  <strong className="text-white">Персональные данные</strong> —
                  сведения, относящиеся к определённому или определяемому на их
                  основании субъекту персональных данных, зафиксированные на
                  электронном, бумажном и (или) ином материальном носителе.
                </p>
                <p>
                  <strong className="text-white">Субъект персональных данных</strong>
                  {' '}— физическое лицо, к которому относятся персональные данные.
                </p>
                <p>
                  <strong className="text-white">Обработка персональных данных</strong>
                  {' '}— действия, направленные на накопление, хранение, изменение,
                  дополнение, использование, распространение, обезличивание,
                  блокирование и уничтожение персональных данных.
                </p>
                <p>
                  <strong className="text-white">Оператор</strong> — лицо,
                  осуществляющее сбор, обработку и защиту персональных данных
                  (Исполнитель).
                </p>
                <p>
                  <strong className="text-white">Уполномоченный обработчик</strong>
                  {' '}— лицо, обрабатывающее персональные данные по поручению
                  Оператора.
                </p>
                <p>
                  <strong className="text-white">Согласие</strong> — добровольное
                  волеизъявление субъекта персональных данных или его законного
                  представителя, выраженное в свободной форме, на сбор, обработку и
                  иные действия с персональными данными.
                </p>
              </div>
            </section>

            {/* 3. Кто обрабатывает */}
            <section id="operator">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                3. Кто обрабатывает данные
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>
                  <strong>3.1.</strong> Оператором обработки персональных данных
                  является:
                </p>
                <div className="mt-2 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-sm">
                  <p className="text-amber-100">
                    <strong>Внимание:</strong> заполните реквизиты Оператора перед
                    публикацией.
                  </p>
                  <div className="mt-3 grid gap-1.5 text-slate-300">
                    <div><strong className="text-white">Наименование:</strong> _____________________________</div>
                    <div><strong className="text-white">БИН/ИИН:</strong> _____________________________</div>
                    <div><strong className="text-white">Адрес:</strong> _____________________________</div>
                    <div><strong className="text-white">Email:</strong> privacy@ordaops.kz</div>
                  </div>
                </div>
                <p>
                  <strong>3.2.</strong> При использовании Сервиса в качестве
                  оператора собственных данных (о сотрудниках, клиентах и т.д.)
                  выступает Заказчик (клиент Сервиса). Исполнитель в отношении
                  таких данных является Уполномоченным обработчиком.
                </p>
                <p>
                  <strong>3.3.</strong> Заказчик самостоятельно получает согласие
                  субъектов персональных данных (своих сотрудников, клиентов и
                  иных лиц) на обработку их данных в Сервисе и несёт
                  ответственность за соблюдение законодательства РК о персональных
                  данных в отношении передаваемой им информации.
                </p>
              </div>
            </section>

            {/* 4. Какие данные */}
            <section id="data-types">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                4. Какие данные собираются
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <h3 className="text-base font-semibold text-amber-200">4.1. Регистрационные данные:</h3>
                <ul className="ml-6 list-disc space-y-1.5 text-slate-300">
                  <li>фамилия, имя, отчество (при наличии);</li>
                  <li>контактный телефон;</li>
                  <li>адрес электронной почты;</li>
                  <li>наименование и реквизиты компании (для юридических лиц и ИП);</li>
                  <li>должность.</li>
                </ul>

                <h3 className="text-base font-semibold text-amber-200">4.2. Данные использования Сервиса:</h3>
                <ul className="ml-6 list-disc space-y-1.5 text-slate-300">
                  <li>IP-адрес устройства;</li>
                  <li>сведения о браузере и операционной системе;</li>
                  <li>история действий в Сервисе (журнал аудита);</li>
                  <li>дата и время посещений;</li>
                  <li>идентификаторы кассовых терминалов и иных устройств.</li>
                </ul>

                <h3 className="text-base font-semibold text-amber-200">4.3. Финансовые и операционные данные Заказчика:</h3>
                <ul className="ml-6 list-disc space-y-1.5 text-slate-300">
                  <li>сведения о выручке, расходах, остатках товаров, инвентаризациях;</li>
                  <li>информация о продажах и возвратах;</li>
                  <li>данные о сотрудниках Заказчика (операторах) — ФИО, контакты, расчёты по зарплате;</li>
                  <li>данные о клиентах Заказчика, добавленные в Сервис (имя, телефон, история покупок, бонусы лояльности);</li>
                  <li>данные о поставщиках, накладных, платежах.</li>
                </ul>

                <h3 className="text-base font-semibold text-amber-200">4.4. Данные платежей:</h3>
                <ul className="ml-6 list-disc space-y-1.5 text-slate-300">
                  <li>сумма, дата и реквизиты платежа за Сервис;</li>
                  <li>номер банковского счёта или платёжной карты — обрабатываются исключительно платёжной системой, в Сервисе не хранятся.</li>
                </ul>

                <p className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-rose-200">
                  <strong>Что НЕ собираем:</strong> Сервис не собирает биометрические
                  данные, специальные категории персональных данных (расовая
                  принадлежность, политические убеждения, состояние здоровья и
                  т.п.), данные о геолокации в реальном времени.
                </p>
              </div>
            </section>

            {/* 5. Цели обработки */}
            <section id="purposes">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                5. Цели обработки данных
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>
                  <strong>5.1.</strong> Персональные данные обрабатываются для следующих целей:
                </p>
                <ul className="ml-6 list-disc space-y-1.5 text-slate-300">
                  <li>идентификация Заказчика для предоставления доступа к Сервису;</li>
                  <li>заключение и исполнение договора оказания услуг;</li>
                  <li>оказание услуг Сервиса и техническая поддержка;</li>
                  <li>обработка платежей и выставление закрывающих документов;</li>
                  <li>информирование о работе Сервиса, изменениях в нём и тарифах;</li>
                  <li>обеспечение информационной безопасности и предотвращение мошенничества;</li>
                  <li>исполнение обязательств перед государственными органами (налоговая отчётность и т.п.);</li>
                  <li>анализ использования Сервиса в обезличенном виде с целью его улучшения.</li>
                </ul>
              </div>
            </section>

            {/* 6. Правовые основания */}
            <section id="legal">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                6. Правовые основания обработки
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>
                  Обработка персональных данных осуществляется на следующих правовых основаниях:
                </p>
                <ul className="ml-6 list-disc space-y-1.5 text-slate-300">
                  <li>согласие субъекта персональных данных, выраженное в формах регистрации, оплаты и при использовании Сервиса;</li>
                  <li>исполнение договора оказания услуг (Публичной оферты);</li>
                  <li>исполнение обязательств, предусмотренных законодательством Республики Казахстан;</li>
                  <li>защита законных интересов Оператора и (или) третьих лиц.</li>
                </ul>
              </div>
            </section>

            {/* 7. Хранение */}
            <section id="storage">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                7. Хранение и защита данных
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>
                  <strong>7.1.</strong> Оператор обеспечивает защиту персональных
                  данных от неправомерного или случайного доступа, уничтожения,
                  изменения, блокирования, копирования, распространения и иных
                  неправомерных действий следующими мерами:
                </p>
                <ul className="ml-6 list-disc space-y-1.5 text-slate-300">
                  <li>шифрование данных при передаче по сетям связи (TLS/HTTPS);</li>
                  <li>шифрование данных в местах хранения;</li>
                  <li>разграничение доступа к данным по ролям пользователей;</li>
                  <li>ведение журнала действий пользователей (аудит);</li>
                  <li>регулярное резервное копирование данных;</li>
                  <li>защита от несанкционированного доступа на уровне инфраструктуры (брандмауэры, защита от DDoS-атак);</li>
                  <li>обучение персонала Оператора правилам обработки персональных данных.</li>
                </ul>
                <p>
                  <strong>7.2.</strong> Срок хранения персональных данных:
                </p>
                <ul className="ml-6 list-disc space-y-1.5 text-slate-300">
                  <li>в течение всего срока действия договора оказания услуг;</li>
                  <li>после расторжения договора — в течение 3 (трёх) лет в соответствии с требованиями законодательства о бухгалтерском и налоговом учёте;</li>
                  <li>данные о платежах — в течение 5 (пяти) лет после операции;</li>
                  <li>иные данные удаляются по запросу субъекта персональных данных или по истечении установленных сроков хранения.</li>
                </ul>
                <p>
                  <strong>7.3.</strong> По истечении сроков хранения или при
                  достижении целей обработки персональные данные подлежат
                  уничтожению или обезличиванию.
                </p>
              </div>
            </section>

            {/* 8. Передача третьим лицам */}
            <section id="transfer">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                8. Передача данных третьим лицам
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>
                  <strong>8.1.</strong> Оператор не передаёт персональные данные
                  третьим лицам без согласия субъекта данных, за исключением
                  случаев, прямо предусмотренных законодательством Республики
                  Казахстан или необходимых для оказания услуг Сервиса.
                </p>
                <p>
                  <strong>8.2.</strong> Для оказания услуг Сервиса данные могут
                  передаваться следующим уполномоченным обработчикам:
                </p>
                <div className="mt-3 grid gap-3">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-sm font-semibold text-white">Поставщик облачной инфраструктуры</div>
                    <div className="mt-1 text-xs text-slate-400">
                      Supabase Inc. (США) — хостинг базы данных, аутентификация, файловое хранилище, синхронизация в реальном времени.
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-sm font-semibold text-white">Поставщик облачного хостинга приложения</div>
                    <div className="mt-1 text-xs text-slate-400">
                      Vercel Inc. (США) — хостинг веб-приложения, доставка контента.
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-sm font-semibold text-white">Поставщики AI-сервисов</div>
                    <div className="mt-1 text-xs text-slate-400">
                      OpenAI L.L.C. (США), Google LLC (США) — обработка запросов AI-помощника, прогнозы, OCR накладных. Передаются обезличенные финансовые показатели и тексты, без передачи персональных данных конкретных лиц.
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-sm font-semibold text-white">Платёжные системы</div>
                    <div className="mt-1 text-xs text-slate-400">
                      АО «Kaspi Bank», иные платёжные провайдеры — обработка оплаты услуг.
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <div className="text-sm font-semibold text-white">Сервисы коммуникации</div>
                    <div className="mt-1 text-xs text-slate-400">
                      Telegram FZ-LLC (ОАЭ) — отправка отчётов и уведомлений в мессенджер по запросу Заказчика.
                    </div>
                  </div>
                </div>
                <p>
                  <strong>8.3.</strong> Передача данных в государственные органы
                  Республики Казахстан осуществляется на основании
                  соответствующего запроса в рамках действующего законодательства.
                </p>
              </div>
            </section>

            {/* 9. Трансграничная передача */}
            <section id="cross-border">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                9. Трансграничная передача персональных данных
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>
                  <strong>9.1.</strong> В целях оказания услуг персональные данные
                  могут передаваться на территорию иностранных государств, в
                  которых обеспечивается адекватный уровень защиты прав субъектов
                  персональных данных в соответствии с законодательством РК.
                </p>
                <p>
                  <strong>9.2.</strong> Используя Сервис, субъект персональных
                  данных подтверждает своё информированное согласие на
                  трансграничную передачу его данных в страны, в которых находятся
                  серверы уполномоченных обработчиков (раздел 8.2), включая, но не
                  ограничиваясь: США, ОАЭ, страны Европейского союза.
                </p>
                <p>
                  <strong>9.3.</strong> С уполномоченными обработчиками заключены
                  соглашения, предусматривающие обязательства по защите
                  персональных данных на уровне не ниже, чем требует
                  законодательство Республики Казахстан.
                </p>
              </div>
            </section>

            {/* 10. Cookies */}
            <section id="cookies">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                10. Файлы cookie и аналитика
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>
                  <strong>10.1.</strong> Сервис использует файлы cookie — небольшие
                  текстовые файлы, сохраняемые в браузере пользователя, для
                  следующих целей:
                </p>
                <ul className="ml-6 list-disc space-y-1.5 text-slate-300">
                  <li>идентификация пользовательской сессии (необходимо для авторизации);</li>
                  <li>сохранение предпочтений пользователя (язык, настройки интерфейса);</li>
                  <li>анализ использования Сервиса в обезличенном виде (Vercel Analytics).</li>
                </ul>
                <p>
                  <strong>10.2.</strong> Пользователь вправе отключить файлы cookie
                  в настройках браузера. При этом некоторые функции Сервиса могут
                  стать недоступными (в частности, авторизация).
                </p>
                <p>
                  <strong>10.3.</strong> Сервис не использует cookie третьих лиц
                  для рекламного ретаргетинга.
                </p>
              </div>
            </section>

            {/* 11. Права субъекта */}
            <section id="rights">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                11. Права субъекта персональных данных
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>
                  Субъект персональных данных в соответствии с Законом РК «О
                  персональных данных и их защите» имеет право:
                </p>
                <ul className="ml-6 list-disc space-y-1.5 text-slate-300">
                  <li>получать информацию о факте обработки его персональных данных, а также об операторе и условиях обработки;</li>
                  <li>требовать изменения, дополнения, блокирования или уничтожения своих персональных данных, если они являются неполными, устаревшими, недостоверными, неправомерно полученными или не являются необходимыми для цели обработки;</li>
                  <li>отозвать согласие на обработку персональных данных в любой момент;</li>
                  <li>получать копию своих персональных данных в Сервисе в машиночитаемом формате;</li>
                  <li>обжаловать действия или бездействие Оператора в уполномоченный орган в области защиты персональных данных Республики Казахстан или в суд.</li>
                </ul>
                <p>
                  <strong>11.2.</strong> Запросы и обращения по реализации прав
                  направляются на адрес электронной почты Оператора (раздел 14)
                  или иными доступными способами связи.
                </p>
                <p>
                  <strong>11.3.</strong> Срок ответа на запрос субъекта
                  персональных данных — не более 15 рабочих дней с момента его
                  получения, если иной срок не установлен законодательством.
                </p>
              </div>
            </section>

            {/* 12. Несовершеннолетние */}
            <section id="children">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                12. Данные несовершеннолетних
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>
                  <strong>12.1.</strong> Сервис не предназначен для использования
                  лицами, не достигшими 18 (восемнадцати) лет. Оператор не
                  собирает преднамеренно персональные данные несовершеннолетних.
                </p>
                <p>
                  <strong>12.2.</strong> Если Заказчик передаёт в Сервис данные
                  несовершеннолетних в качестве своих клиентов или иных лиц,
                  Заказчик самостоятельно несёт ответственность за получение
                  соответствующего согласия законных представителей в
                  соответствии с законодательством РК.
                </p>
              </div>
            </section>

            {/* 13. Изменения */}
            <section id="changes">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                13. Изменения политики
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>
                  <strong>13.1.</strong> Оператор оставляет за собой право
                  вносить изменения в настоящую Политику. Новая редакция
                  вступает в силу с момента её публикации на сайте ordaops.kz/privacy,
                  если иное не указано в новой редакции.
                </p>
                <p>
                  <strong>13.2.</strong> О существенных изменениях Политики
                  пользователи уведомляются дополнительно через электронную
                  почту, личный кабинет или иной канал связи.
                </p>
                <p>
                  <strong>13.3.</strong> Рекомендуется периодически проверять
                  актуальную версию Политики на сайте.
                </p>
              </div>
            </section>

            {/* 14. Контакты */}
            <section id="contacts">
              <h2 className="text-2xl font-semibold tracking-tight text-white">
                14. Контакты для запросов о персональных данных
              </h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>
                  По всем вопросам, связанным с обработкой персональных данных,
                  включая реализацию прав субъекта данных, обращайтесь:
                </p>
                <div className="rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 text-sm">
                  <div className="grid gap-2 text-slate-300">
                    <div><strong className="text-white">Email для запросов:</strong> privacy@ordaops.kz</div>
                    <div><strong className="text-white">Общий email:</strong> info@ordaops.kz</div>
                    <div><strong className="text-white">Telegram:</strong> @ordaops_support</div>
                    <div><strong className="text-white">Сайт:</strong> https://ordaops.kz</div>
                  </div>
                  <p className="mt-3 text-amber-100">
                    <strong>Внимание:</strong> при необходимости заполните точные
                    реквизиты Оператора и контактные данные перед публикацией.
                  </p>
                </div>
                <p>
                  <strong>14.2.</strong> Уполномоченный орган в области защиты
                  персональных данных Республики Казахстан:
                </p>
                <p className="text-slate-300">
                  Министерство цифрового развития, инноваций и аэрокосмической
                  промышленности Республики Казахстан или иной уполномоченный орган
                  в соответствии с действующим законодательством РК.
                </p>
              </div>
            </section>

            <footer className="border-t border-white/10 pt-8 text-xs text-slate-500">
              <p>
                Настоящая Политика составлена в соответствии с Законом РК «О
                персональных данных и их защите» № 94-V от 21.05.2013, Законом РК
                «Об информатизации» № 418-V от 24.11.2015 и иными нормативными
                правовыми актами РК.
              </p>
              <p className="mt-2">© 2026 OrdaOps. Все права защищены.</p>
            </footer>
          </article>
        </div>
      </div>
    </main>
  )
}
