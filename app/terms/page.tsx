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
  title: `Пользовательское соглашение — ${PRODUCT_NAME}`,
  description: `Правила использования информационной системы ${PRODUCT_NAME}: регистрация, роли и доступы, ограничения, ответственность пользователя.`,
}

const sections = [
  { id: 'overview', title: '1. Общие положения' },
  { id: 'signup', title: '2. Регистрация и учётные записи' },
  { id: 'roles', title: '3. Роли и доступы' },
  { id: 'usage', title: '4. Допустимое использование' },
  { id: 'restrictions', title: '5. Ограничения и запреты' },
  { id: 'content', title: '6. Контент Заказчика' },
  { id: 'thirdparty', title: '7. Сервисы третьих лиц' },
  { id: 'suspension', title: '8. Ограничение и блокировка доступа' },
  { id: 'ip', title: '9. Интеллектуальная собственность' },
  { id: 'feedback', title: '10. Обратная связь и идеи' },
  { id: 'changes', title: '11. Изменения соглашения' },
  { id: 'contacts', title: '12. Контакты' },
  { id: 'history', title: '13. История редакций' },
]

export default function TermsPage() {
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
                <Link href="/sla" className="hover:text-[#16a34a]">→ SLA</Link>
                <Link href="/cookies" className="hover:text-[#16a34a]">→ Cookies</Link>
              </div>
            </div>
          </aside>

          <article className="max-w-3xl space-y-8 text-[#475569]">
            <header>
              <h1 className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-[#0f2038] sm:text-4xl">
                Пользовательское соглашение
              </h1>
              <p className="mt-4 text-sm leading-7 text-[#56657d]">
                Настоящее Пользовательское соглашение определяет правила использования
                Сервиса «{PRODUCT_NAME}», предоставляемого {LEGAL_ENTITY.shortName}.
                Соглашение является неотъемлемой частью <Link href="/offer" className="text-[#16a34a] hover:underline">публичной оферты</Link>.
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
                <p><strong>1.1.</strong> Настоящее соглашение регулирует отношения между {LEGAL_ENTITY.shortName} (далее — Исполнитель) и пользователем Сервиса «{PRODUCT_NAME}» (далее — Пользователь) при использовании веб-приложения {PRODUCT_SITE}, клиентских приложений Operator Desktop и Kiosk и связанных API.</p>
                <p><strong>1.2.</strong> Используя Сервис, Пользователь подтверждает, что прочёл, понял и согласен соблюдать настоящее соглашение, публичную оферту, Политику конфиденциальности, SLA и Политику Cookies.</p>
              </div>
            </section>

            <section id="signup">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">2. Регистрация и учётные записи</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>2.1. Самостоятельная регистрация (self-signup)</strong> доступна только Заказчикам — лицам, регистрирующим организацию для управления собственным бизнесом. Регистрация осуществляется по email с подтверждением через Supabase Auth.</p>
                <p><strong>2.2.</strong> Сотрудники Заказчика добавляются администратором организации через раздел Личного кабинета. Сотрудник получает доступ к Сервису по приглашению. Самостоятельная регистрация сотрудника в чужую организацию не допускается.</p>
                <p><strong>2.3.</strong> Операторы точек продаж создаются администратором Заказчика и получают доступ к клиентскому приложению Operator Desktop через токен устройства (x-point-device-token), выдаваемый Заказчиком. Самостоятельная регистрация оператора не предусмотрена.</p>
                <p><strong>2.4.</strong> Клиенты клуба Заказчика регистрируются самостоятельно через клиентский портал по коду компании, предоставленному Заказчиком.</p>
                <p><strong>2.5.</strong> Пользователь обязуется указывать достоверные данные при регистрации и поддерживать их в актуальном состоянии.</p>
                <p><strong>2.6.</strong> Пользователь несёт ответственность за конфиденциальность своих логина, пароля и токенов устройств. Все действия, совершённые с использованием его учётной записи, считаются совершёнными им лично. О любой компрометации учётной записи следует незамедлительно сообщить на {LEGAL_ENTITY.emailSupport}.</p>
              </div>
            </section>

            <section id="roles">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">3. Роли и доступы</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>3.1.</strong> В рамках одной организации Сервис поддерживает следующие роли:</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li><strong>owner</strong> — владелец организации, имеет полный доступ ко всем функциям и данным организации;</li>
                  <li><strong>manager</strong> — менеджер, имеет доступ к управлению компаниями, сотрудниками и операционной деятельностью в пределах назначенных прав;</li>
                  <li><strong>marketer</strong> — маркетолог, доступ к данным клиентов, программе лояльности и рекламным материалам;</li>
                  <li><strong>other</strong> — иная роль с ограниченным набором прав;</li>
                  <li><strong>operator</strong> — оператор точки продаж, доступ к кассовым операциям через Operator Desktop;</li>
                  <li><strong>customer</strong> — клиент клуба, доступ к клиентскому порталу.</li>
                </ul>
                <p><strong>3.2.</strong> Распределение ролей и прав внутри организации определяется владельцем (owner) и администраторами (manager).</p>
                <p><strong>3.3.</strong> Пользователь не вправе использовать функции и данные, к которым ему не предоставлен доступ, в т.ч. путём обхода средств контроля доступа.</p>
              </div>
            </section>

            <section id="usage">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">4. Допустимое использование</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Пользователь обязуется использовать Сервис исключительно:</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>для целей управления собственным бизнесом Заказчика;</li>
                  <li>в соответствии с законодательством Республики Казахстан и страны фактического присутствия Пользователя;</li>
                  <li>с соблюдением прав третьих лиц, включая права на персональные данные сотрудников, операторов и клиентов клуба;</li>
                  <li>в пределах лимитов выбранного Тарифного плана.</li>
                </ul>
              </div>
            </section>

            <section id="restrictions">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">5. Ограничения и запреты</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>При использовании Сервиса запрещается:</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>загружать в Сервис незаконные материалы, данные третьих лиц без правовых оснований, материалы, нарушающие права интеллектуальной собственности;</li>
                  <li>использовать Сервис для рассылки спама, противоправной рекламы, мошеннических схем;</li>
                  <li>предпринимать попытки несанкционированного доступа к данным других Заказчиков, обходить средства контроля доступа, использовать уязвимости Сервиса;</li>
                  <li>осуществлять автоматизированные запросы (скрейпинг, парсинг) в обход публичного API в объёмах, выходящих за рамки разумного использования;</li>
                  <li>осуществлять реверс-инжиниринг, декомпиляцию или модификацию клиентских приложений Operator Desktop и Kiosk сверх объёма, прямо разрешённого законодательством;</li>
                  <li>передавать доступ к учётной записи третьим лицам, не являющимся сотрудниками или подрядчиками Заказчика;</li>
                  <li>использовать Сервис для деятельности, запрещённой законодательством Республики Казахстан.</li>
                </ul>
              </div>
            </section>

            <section id="content">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">6. Контент Заказчика</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>6.1.</strong> Все данные, тексты, изображения, документы, фотографии, чеки и иные материалы, загружаемые Пользователем в Сервис (далее — Контент Заказчика), принадлежат Заказчику или лицам, передавшим Заказчику соответствующие права.</p>
                <p><strong>6.2.</strong> Заказчик гарантирует, что обладает необходимыми правами на размещение Контента Заказчика в Сервисе и его обработку Исполнителем как уполномоченным лицом.</p>
                <p><strong>6.3.</strong> Заказчик несёт полную ответственность за содержание Контента Заказчика, его соответствие законодательству и за наличие согласий субъектов персональных данных, упоминаемых в Контенте.</p>
                <p><strong>6.4.</strong> Исполнитель не осуществляет предварительной модерации Контента Заказчика. Исполнитель вправе ограничить доступ к Контенту, нарушающему настоящее соглашение или законодательство, по собственной инициативе или по обоснованному запросу уполномоченных органов либо правообладателей.</p>
                <p><strong>6.5.</strong> Заказчик предоставляет Исполнителю неисключительную, безвозмездную, ограниченную лицензию на хранение, копирование и обработку Контента Заказчика исключительно в объёме, необходимом для оказания услуг Сервиса.</p>
              </div>
            </section>

            <section id="thirdparty">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">7. Сервисы третьих лиц</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Для работы Сервиса используются следующие сервисы третьих лиц: Supabase (БД, аутентификация, файловое хранилище), Vercel (хостинг и аналитика), OpenAI и Google Gemini (AI/OCR), Telegram Bot API (уведомления), SMTP-провайдер (email-рассылки). Перечень и описание — в <Link href="/privacy#processors" className="text-[#16a34a] hover:underline">Политике конфиденциальности</Link>. Использование Сервиса означает согласие с привлечением указанных обработчиков.</p>
              </div>
            </section>

            <section id="suspension">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">8. Ограничение и блокировка доступа</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Исполнитель вправе ограничить или полностью прекратить доступ Пользователя к Сервису в следующих случаях:</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>нарушение Пользователем настоящего соглашения или публичной оферты;</li>
                  <li>неоплата Тарифного плана сверх 30 (тридцати) календарных дней с даты выставления счёта;</li>
                  <li>угроза безопасности Сервиса, его инфраструктуры или данных других Заказчиков;</li>
                  <li>обоснованный запрос уполномоченного государственного органа;</li>
                  <li>обоснованная жалоба правообладателя на размещённый Пользователем Контент.</li>
                </ul>
                <p>О планируемом ограничении доступа (за исключением случаев аварийной угрозы безопасности) Исполнитель уведомляет Пользователя за разумный срок до его введения.</p>
              </div>
            </section>

            <section id="ip">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">9. Интеллектуальная собственность</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p><strong>9.1.</strong> Исключительные права на Сервис «{PRODUCT_NAME}» в целом, его исходный код, дизайн, логотипы, товарные знаки, документацию и иные результаты интеллектуальной деятельности принадлежат {LEGAL_ENTITY.shortName} и/или его лицензиарам.</p>
                <p><strong>9.2.</strong> Использование Сервиса по настоящему соглашению предоставляет Пользователю исключительно право использования Сервиса по его прямому назначению. Никакие иные права, включая права на исходный код, дизайн, бренд, Пользователю не передаются.</p>
                <p><strong>9.3.</strong> Воспроизведение, копирование, распространение элементов Сервиса без письменного согласия Исполнителя не допускается, за исключением случаев, прямо разрешённых законодательством.</p>
              </div>
            </section>

            <section id="feedback">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">10. Обратная связь и идеи</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Любые предложения, идеи, замечания, отзывы и иная обратная связь, добровольно направляемые Пользователем в адрес Исполнителя, могут использоваться Исполнителем для развития Сервиса без выплаты вознаграждения Пользователю.</p>
              </div>
            </section>

            <section id="changes">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">11. Изменения соглашения</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Исполнитель вправе в одностороннем порядке вносить изменения в настоящее соглашение. Новая редакция вступает в силу с момента её публикации по адресу {PRODUCT_SITE}/terms. Продолжение использования Сервиса после публикации новой редакции означает согласие Пользователя с её условиями.</p>
              </div>
            </section>

            <section id="contacts">
              <h2 className="text-2xl font-semibold tracking-tight text-[#0f2038]">12. Контакты</h2>
              <div className="mt-4 rounded-2xl border border-[#e7ebf2] bg-[#f6f8fb] p-5 text-sm leading-7 shadow-[0_12px_34px_-16px_rgba(15,32,56,0.18)]">
                <div className="grid gap-2 text-[#56657d]">
                  <div><strong className="text-[#0f2038]">Исполнитель:</strong> {LEGAL_ENTITY.fullName}</div>
                  <div><strong className="text-[#0f2038]">БИН:</strong> {LEGAL_ENTITY.bin}</div>
                  <div><strong className="text-[#0f2038]">Email (общий):</strong> {LEGAL_ENTITY.emailInfo}</div>
                  <div><strong className="text-[#0f2038]">Email (поддержка):</strong> {LEGAL_ENTITY.emailSupport}</div>
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
