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
  title: `SLA — соглашение об уровне обслуживания — ${PRODUCT_NAME}`,
  description: `Условия технической поддержки и доступности информационной системы ${PRODUCT_NAME} (${LEGAL_ENTITY.shortName}).`,
}

const sections = [
  { id: 'overview', title: '1. Общие положения' },
  { id: 'availability', title: '2. Уровень доступности Сервиса' },
  { id: 'maintenance', title: '3. Плановые работы' },
  { id: 'support', title: '4. Техническая поддержка' },
  { id: 'response', title: '5. Время реакции и приоритеты' },
  { id: 'offline', title: '6. Работа Operator Desktop без интернета' },
  { id: 'exclusions', title: '7. Исключения и зависимости' },
  { id: 'backup', title: '8. Резервное копирование' },
  { id: 'export', title: '9. Выгрузка данных' },
  { id: 'compensation', title: '10. Компенсации' },
  { id: 'changes', title: '11. Изменения SLA' },
  { id: 'contacts', title: '12. Контакты' },
  { id: 'history', title: '13. История редакций' },
]

export default function SLAPage() {
  return (
    <main className="min-h-screen bg-white text-[#475569]">
      <header className="border-b border-[#eef1f6] bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 py-4 sm:px-8 lg:px-10">
          <Link href="/" className="flex items-center gap-2.5 text-[#56657d] hover:text-[#16a34a]">
            <ArrowLeft className="h-4 w-4" />
            <span className="text-sm">К {SITE_NAME}</span>
          </Link>
          <span className="text-xs text-[#8a97ad]">
            Версия от {LEGAL_VERSION} · обновлено {LEGAL_LAST_UPDATED}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-screen-2xl px-6 py-12 sm:px-8 lg:px-10">
        <div className="grid gap-10 lg:grid-cols-[260px_1fr] lg:items-start">
          <aside className="lg:sticky lg:top-8">
            <div className="rounded-2xl border border-[#e7ebf2] bg-[#f6f8fb] p-5 shadow-[0_12px_34px_-16px_rgba(15,32,56,0.18)]">
              <div className="text-xs font-semibold uppercase tracking-wider text-[#16a34a]">
                Содержание
              </div>
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
              <div className="mt-4 grid gap-1 text-xs text-[#7a8aa3]">
                <Link href="/offer" className="hover:text-[#16a34a]">→ Публичная оферта</Link>
                <Link href="/privacy" className="hover:text-[#16a34a]">→ Политика конфиденциальности</Link>
                <Link href="/terms" className="hover:text-[#16a34a]">→ Пользовательское соглашение</Link>
                <Link href="/cookies" className="hover:text-[#16a34a]">→ Cookies</Link>
              </div>
            </div>
          </aside>

          <article className="max-w-3xl space-y-8 text-[#475569]">
            <header>
              <h1 className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-[#0f2038] sm:text-4xl">
                SLA — соглашение об уровне обслуживания
              </h1>
              <p className="mt-4 text-sm leading-7 text-[#56657d]">
                Настоящее SLA описывает условия предоставления Сервиса «{PRODUCT_NAME}»,
                порядок технической поддержки и пределы ответственности
                {' '}{LEGAL_ENTITY.shortName}. SLA является неотъемлемой частью
                {' '}<Link href="/offer" className="text-[#16a34a] hover:underline">публичной оферты</Link>.
              </p>
              <p className="mt-3 text-sm leading-7 text-[#56657d]">
                <strong>Дата вступления в силу:</strong> {LEGAL_EFFECTIVE_DATE}
                <br />
                <strong>Версия:</strong> {LEGAL_VERSION}
              </p>
            </header>

            <section id="overview">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">1. Общие положения</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>1.1.</strong> Сервис «{PRODUCT_NAME}» — облачное программное обеспечение, предоставляемое по модели SaaS. Доступность Сервиса зависит от работоспособности привлечённых обработчиков (Supabase, Vercel) и каналов связи между Заказчиком и инфраструктурой Сервиса.</p>
                <p><strong>1.2.</strong> Настоящее SLA применяется к веб-приложению ({PRODUCT_SITE}) и серверной части (API). Клиентские приложения Operator Desktop и Kiosk работают на устройствах Заказчика; их доступность зависит от состояния этих устройств и каналов связи.</p>
              </div>
            </section>

            <section id="availability">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">2. Уровень доступности Сервиса</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>2.1.</strong> Целевой уровень доступности веб-приложения и API Сервиса — <strong className="text-[#0f2038]">99,0 % в течение календарного месяца</strong> (без учёта плановых работ и обстоятельств, перечисленных в разделе 7).</p>
                <p><strong>2.2.</strong> Доступность измеряется как отношение времени, в течение которого основные функции Сервиса (вход, чтение и запись данных) были доступны, к общему времени календарного месяца за вычетом плановых работ.</p>
                <p><strong>2.3.</strong> Заявленный уровень доступности применяется исключительно к компонентам, находящимся под прямым контролем {LEGAL_ENTITY.shortName}, и не распространяется на сервисы третьих лиц и каналы связи Заказчика.</p>
              </div>
            </section>

            <section id="maintenance">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">3. Плановые работы</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>3.1.</strong> Плановые технические работы выполняются преимущественно в часы наименьшей нагрузки (ночное время по часовому поясу UTC+5).</p>
                <p><strong>3.2.</strong> О плановых работах продолжительностью более 30 минут Исполнитель уведомляет Заказчика не менее чем за 24 часа путём публикации в Личном кабинете или направления уведомления на электронную почту Заказчика.</p>
                <p><strong>3.3.</strong> Аварийные технические работы могут выполняться без предварительного уведомления при наличии угрозы безопасности или стабильности Сервиса.</p>
              </div>
            </section>

            <section id="support">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">4. Техническая поддержка</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>4.1.</strong> Техническая поддержка Заказчиков осуществляется через email <strong className="text-[#0f2038]">{LEGAL_ENTITY.emailSupport}</strong>.</p>
                <p><strong>4.2.</strong> График работы поддержки: с 09:00 до 21:00 по часовому поясу UTC+5 (Алматы, Шымкент, Усть-Каменогорск), 7 дней в неделю, за исключением государственных праздников Республики Казахстан.</p>
                <p><strong>4.3.</strong> Обращения в нерабочее время фиксируются и обрабатываются с начала ближайшего рабочего интервала. Аварийные обращения по критическим инцидентам обрабатываются по возможности без ожидания начала рабочего интервала.</p>
              </div>
            </section>

            <section id="response">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">5. Время реакции и приоритеты</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>5.1.</strong> Обращения классифицируются по приоритету:</p>
                <div className="space-y-2">
                  <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                    <div className="font-semibold text-rose-700">Критический</div>
                    <div className="text-xs text-[#7a8aa3]">Сервис полностью недоступен или функция кассы Operator Desktop неработоспособна для всех точек Заказчика. Время первичной реакции — до 2 (двух) часов в рабочее время; время устранения зависит от причины и привлечённых обработчиков.</div>
                  </div>
                  <div className="rounded-xl border border-[#16a34a]/20 bg-[#16a34a]/[0.07] p-4">
                    <div className="font-semibold text-[#15803d]">Высокий</div>
                    <div className="text-xs text-[#7a8aa3]">Существенно нарушена работа отдельной функции или ограниченного числа точек. Время первичной реакции — до 8 (восьми) часов в рабочее время.</div>
                  </div>
                  <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                    <div className="font-semibold text-sky-700">Средний</div>
                    <div className="text-xs text-[#7a8aa3]">Незначительные ошибки, неудобства использования, вопросы по функциональности. Время первичной реакции — до 1 (одного) рабочего дня.</div>
                  </div>
                  <div className="rounded-xl border border-[#e7ebf2] bg-[#f6f8fb] p-4">
                    <div className="font-semibold text-[#0f2038]">Низкий</div>
                    <div className="text-xs text-[#7a8aa3]">Пожелания по развитию, косметические замечания, вопросы общего характера. Время первичной реакции — до 3 (трёх) рабочих дней.</div>
                  </div>
                </div>
                <p><strong>5.2.</strong> Указанные сроки относятся к времени первичной реакции (подтверждение получения, классификация, начало диагностики), а не к времени полного устранения проблемы.</p>
              </div>
            </section>

            <section id="offline">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">6. Работа Operator Desktop без интернета</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>6.1.</strong> Operator Desktop поддерживает <strong className="text-[#0f2038]">частичную</strong> работу без интернет-соединения. Локально на устройстве оператора сохраняются и выполняются:</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>оформление продаж, возвратов, долгов;</li>
                  <li>отложенные корзины (parked carts);</li>
                  <li>создание заявок на инвентарь;</li>
                  <li>прохождение чек-листов смен;</li>
                  <li>формирование отчётов о закрытии смены.</li>
                </ul>
                <p>При восстановлении интернет-соединения отложенные операции автоматически синхронизируются с сервером.</p>
                <p><strong>6.2.</strong> Без интернет-соединения <strong className="text-[#0f2038]">недоступны</strong>: загрузка документов и файлов, AI/OCR-функции, отправка Telegram-уведомлений, аналитические отчёты, синхронизация справочника товаров с сервера, обновление прав и ролей.</p>
                <p><strong>6.3.</strong> Длительная работа без интернет-соединения может приводить к расхождениям между локальными и серверными данными. Заказчик обязуется обеспечить достаточно стабильное интернет-соединение для штатной работы Сервиса.</p>
              </div>
            </section>

            <section id="exclusions">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">7. Исключения и зависимости</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Уровень доступности и сроки реакции, заявленные в настоящем SLA, не применяются и обязательства Исполнителя не считаются нарушенными в случае:</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>сбоев и недоступности привлечённых обработчиков: Supabase (БД, аутентификация, хранилище), Vercel (хостинг), Telegram (Bot API), OpenAI и Google Gemini (AI/OCR), SMTP-провайдер;</li>
                  <li>сбоев интернет-провайдеров Заказчика, отключения электроэнергии, неисправности оборудования Заказчика;</li>
                  <li>сбоев устройств, на которых установлены Operator Desktop и Kiosk;</li>
                  <li>массовых DDoS-атак, действий третьих лиц, направленных на нарушение работы Сервиса;</li>
                  <li>обстоятельств непреодолимой силы (раздел 10 публичной оферты);</li>
                  <li>нарушения Заказчиком условий публичной оферты, пользовательского соглашения, неоплаты Тарифного плана;</li>
                  <li>неправильной конфигурации или использования Сервиса Заказчиком, ошибок ввода данных операторами и сотрудниками Заказчика;</li>
                  <li>плановых технических работ, проводимых в порядке раздела 3.</li>
                </ul>
              </div>
            </section>

            <section id="backup">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">8. Резервное копирование</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>8.1.</strong> Резервное копирование баз данных Сервиса осуществляется средствами провайдера Supabase в соответствии с политикой провайдера. Дополнительная backup-инфраструктура на стороне {LEGAL_ENTITY.shortName} в настоящее время не реализована.</p>
                <p><strong>8.2.</strong> Восстановление данных из резервной копии возможно только в случае массового сбоя на стороне инфраструктуры и не гарантирует восстановление данных, утраченных по причине ошибочных действий пользователей Заказчика (удаление записей, перезапись данных и т.п.).</p>
                <p><strong>8.3.</strong> Для защиты от случайной потери данных Заказчику рекомендуется регулярно использовать функцию выгрузки данных (раздел 9).</p>
              </div>
            </section>

            <section id="export">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">9. Выгрузка данных</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Заказчик в любой момент действия подписки может выгрузить свои данные из Сервиса через интерфейс Личного кабинета в форматах Excel/CSV. После прекращения подписки выгрузка доступна в течение не менее 30 (тридцати) календарных дней.</p>
              </div>
            </section>

            <section id="compensation">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">10. Компенсации</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>10.1.</strong> В случае если фактический уровень доступности Сервиса в течение календарного месяца оказался ниже заявленного (раздел 2) по причинам, находящимся под прямым контролем Исполнителя, Заказчику по его письменному запросу на {LEGAL_ENTITY.emailSupport} предоставляется продление действующей подписки соразмерно времени простоя.</p>
                <p><strong>10.2.</strong> Запрос на компенсацию должен быть направлен не позднее 30 (тридцати) календарных дней с момента окончания месяца, в котором произошло снижение доступности.</p>
                <p><strong>10.3.</strong> Иные формы компенсации (денежные выплаты, неустойки) настоящим SLA не предусмотрены. Совокупная ответственность Исполнителя ограничена в соответствии с разделом 8 публичной оферты.</p>
              </div>
            </section>

            <section id="changes">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">11. Изменения SLA</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Исполнитель вправе в одностороннем порядке вносить изменения в настоящее SLA. Новая редакция вступает в силу с момента её публикации по адресу {PRODUCT_SITE}/sla. О существенных изменениях Исполнитель уведомляет Заказчика не менее чем за 30 (тридцать) календарных дней.</p>
              </div>
            </section>

            <section id="contacts">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">12. Контакты</h2>
              <div className="mt-4 rounded-2xl border border-[#e7ebf2] bg-[#f6f8fb] p-5 text-sm leading-7 shadow-[0_12px_34px_-16px_rgba(15,32,56,0.18)]">
                <div className="grid gap-2 text-[#56657d]">
                  <div><strong className="text-[#0f2038]">Исполнитель:</strong> {LEGAL_ENTITY.fullName}</div>
                  <div><strong className="text-[#0f2038]">Поддержка:</strong> {LEGAL_ENTITY.emailSupport}</div>
                  <div><strong className="text-[#0f2038]">Телефон:</strong> {LEGAL_ENTITY.phone}</div>
                </div>
              </div>
            </section>

            <section id="history">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">13. История редакций</h2>
              <div className="mt-4 space-y-2 text-sm leading-7">
                {LEGAL_HISTORY.map((entry) => (
                  <div key={entry.date} className="flex gap-3">
                    <span className="shrink-0 font-mono text-xs text-[#16a34a]">{entry.date}</span>
                    <span className="text-[#56657d]">{entry.note}</span>
                  </div>
                ))}
              </div>
            </section>

            <footer className="border-t border-[#eef1f6] pt-8 text-xs text-[#8a97ad]">
              <p>© 2026 {LEGAL_ENTITY.shortName}. Все права защищены.</p>
            </footer>
          </article>
        </div>
      </div>
    </main>
  )
}
