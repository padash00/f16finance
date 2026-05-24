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
  title: `Политика Cookies — ${PRODUCT_NAME}`,
  description: `Использование файлов cookies и аналогичных технологий в информационной системе ${PRODUCT_NAME}.`,
}

const sections = [
  { id: 'overview', title: '1. Что такое cookies' },
  { id: 'list', title: '2. Какие cookies использует Сервис' },
  { id: 'localstorage', title: '3. Локальное хранилище браузера' },
  { id: 'desktop', title: '4. Локальное хранилище Operator Desktop' },
  { id: 'analytics', title: '5. Аналитика' },
  { id: 'manage', title: '6. Как управлять cookies' },
  { id: 'consequences', title: '7. Последствия отключения' },
  { id: 'changes', title: '8. Изменения политики' },
  { id: 'contacts', title: '9. Контакты' },
  { id: 'history', title: '10. История редакций' },
]

type CookieRow = {
  name: string
  type: string
  purpose: string
  retention: string
}

const cookieTable: CookieRow[] = [
  {
    name: 'sb-access-token, sb-refresh-token, sb-<project>-auth-token',
    type: 'Технические · Supabase Auth',
    purpose:
      'Аутентификация пользователя, поддержание сессии в Личном кабинете, защита от CSRF.',
    retention: 'До выхода пользователя из системы или истечения срока сессии (≈1 час для access-токена, до 30 дней для refresh-токена).',
  },
  {
    name: '_vercel_jwt, _vercel_*',
    type: 'Технические · Vercel',
    purpose: 'Маршрутизация запросов, защита защищённых превью, корректная работа платформы хостинга.',
    retention: 'До 1 года, в зависимости от назначения.',
  },
  {
    name: 'orda.theme, orda.fontSize, orda.soundEnabled, orda.customerDisplay',
    type: 'Функциональные · localStorage',
    purpose: 'Сохранение пользовательских настроек интерфейса (тема, размер шрифта, звуки, режим клиентского дисплея).',
    retention: 'Бессрочно, до очистки данных браузера пользователем.',
  },
  {
    name: 'parked-carts:*',
    type: 'Функциональные · localStorage',
    purpose: 'Отложенные кассовые чеки в Operator Desktop, ожидающие возврата к покупке или завершения смены.',
    retention: 'До закрытия смены или восстановления чеков в активную корзину.',
  },
  {
    name: 'Vercel Analytics (без идентификаторов пользователя)',
    type: 'Аналитические',
    purpose: 'Обезличенный сбор статистики посещений (просмотры страниц, тип браузера, страна) для оценки нагрузки и развития Сервиса.',
    retention: 'Согласно политике Vercel Inc.',
  },
]

export default function CookiesPage() {
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
                <Link href="/privacy" className="hover:text-amber-200">→ Политика конфиденциальности</Link>
                <Link href="/terms" className="hover:text-amber-200">→ Пользовательское соглашение</Link>
                <Link href="/sla" className="hover:text-amber-200">→ SLA</Link>
              </div>
            </div>
          </aside>

          <article className="max-w-3xl space-y-8 text-slate-200">
            <header>
              <h1 className="text-3xl font-semibold leading-tight tracking-[-0.02em] text-white sm:text-4xl">
                Политика Cookies
              </h1>
              <p className="mt-4 text-sm leading-7 text-slate-400">
                Настоящая Политика описывает использование файлов cookies, локального
                хранилища браузера и аналогичных технологий в Сервисе «{PRODUCT_NAME}»,
                предоставляемом {LEGAL_ENTITY.shortName}. Настоящая Политика дополняет
                {' '}<Link href="/privacy" className="text-amber-200 hover:underline">Политику конфиденциальности</Link>.
              </p>
              <p className="mt-3 text-sm leading-7 text-slate-400">
                <strong>Дата вступления в силу:</strong> {LEGAL_EFFECTIVE_DATE}
                <br />
                <strong>Версия:</strong> {LEGAL_VERSION}
              </p>
            </header>

            <section id="overview">
              <h2 className="text-2xl font-semibold tracking-tight text-white">1. Что такое cookies</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Cookies — это небольшие текстовые файлы, сохраняемые в браузере пользователя при посещении сайта. Они позволяют сайту «запоминать» пользователя между сессиями: например, держать его авторизованным в Личном кабинете или сохранять выбранные настройки интерфейса.</p>
                <p>Помимо cookies Сервис использует <strong className="text-white">localStorage</strong> и аналогичные технологии локального хранения, которые работают по схожему принципу, но не передаются на сервер автоматически с каждым запросом.</p>
              </div>
            </section>

            <section id="list">
              <h2 className="text-2xl font-semibold tracking-tight text-white">2. Какие cookies использует Сервис</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wider text-amber-200">
                      <th className="py-2 pr-4">Имя / шаблон</th>
                      <th className="py-2 pr-4">Тип</th>
                      <th className="py-2 pr-4">Назначение</th>
                      <th className="py-2">Срок хранения</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cookieTable.map((row) => (
                      <tr key={row.name} className="border-b border-white/5 align-top">
                        <td className="py-3 pr-4 font-mono text-xs text-slate-200">{row.name}</td>
                        <td className="py-3 pr-4 text-slate-300">{row.type}</td>
                        <td className="py-3 pr-4 text-slate-300">{row.purpose}</td>
                        <td className="py-3 text-slate-300">{row.retention}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-slate-500">Состав конкретных cookies может незначительно меняться при обновлениях библиотек Supabase Auth и Vercel.</p>
            </section>

            <section id="localstorage">
              <h2 className="text-2xl font-semibold tracking-tight text-white">3. Локальное хранилище браузера</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Сервис использует localStorage браузера для:</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>сохранения настроек интерфейса пользователя (тема, размер шрифта, звуки, режим клиентского дисплея);</li>
                  <li>хранения отложенных кассовых чеков (parked carts) в Operator Desktop до их восстановления или закрытия смены.</li>
                </ul>
                <p>Данные localStorage не передаются на сервер автоматически и хранятся исключительно на устройстве пользователя.</p>
              </div>
            </section>

            <section id="desktop">
              <h2 className="text-2xl font-semibold tracking-tight text-white">4. Локальное хранилище Operator Desktop</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Клиентское приложение Operator Desktop дополнительно использует встроенное в Electron локальное хранилище для:</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>очереди операций, ожидающих синхронизации с сервером (продажи, возвраты, долги, заявки на инвентарь, отчёты смен);</li>
                  <li>кэширования справочников (товары, операторы) для работы при кратковременном отсутствии интернет-соединения.</li>
                </ul>
                <p>Содержимое локального хранилища Operator Desktop удаляется при штатной деинсталляции приложения.</p>
              </div>
            </section>

            <section id="analytics">
              <h2 className="text-2xl font-semibold tracking-tight text-white">5. Аналитика</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>На веб-сайте {PRODUCT_SITE} используется сервис <strong className="text-white">Vercel Analytics</strong> для сбора обезличенной статистики посещений: количество просмотров, тип браузера, общая страна, среднее время загрузки страниц. Данные собираются без присвоения уникальных идентификаторов пользователю и без использования сторонних рекламных cookies.</p>
                <p>Сторонние рекламные и трекинговые cookies (Google Analytics, Facebook Pixel, рекламные сети) в Сервисе не используются.</p>
              </div>
            </section>

            <section id="manage">
              <h2 className="text-2xl font-semibold tracking-tight text-white">6. Как управлять cookies</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>Пользователь может управлять cookies через настройки браузера:</p>
                <ul className="list-disc space-y-1 pl-6">
                  <li>Chrome — Настройки → Конфиденциальность и безопасность → Файлы cookie;</li>
                  <li>Safari — Настройки → Конфиденциальность → Файлы cookie и данные веб-сайтов;</li>
                  <li>Firefox — Настройки → Приватность и защита;</li>
                  <li>Edge — Настройки → Конфиденциальность, поиск и службы.</li>
                </ul>
                <p>Содержимое localStorage очищается через тот же раздел настроек браузера.</p>
              </div>
            </section>

            <section id="consequences">
              <h2 className="text-2xl font-semibold tracking-tight text-white">7. Последствия отключения</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>При отключении технических cookies (Supabase Auth) аутентификация в Личном кабинете будет невозможна — вход в Сервис прекратится. При отключении функциональных хранилищ настройки интерфейса и отложенные кассовые чеки не будут сохраняться между сессиями.</p>
                <p>Отключение аналитических cookies не влияет на работоспособность Сервиса.</p>
              </div>
            </section>

            <section id="changes">
              <h2 className="text-2xl font-semibold tracking-tight text-white">8. Изменения политики</h2>
              <div className="mt-4 space-y-3 text-sm leading-7">
                <p>{LEGAL_ENTITY.shortName} вправе в одностороннем порядке вносить изменения в настоящую Политику. Новая редакция вступает в силу с момента её публикации по адресу {PRODUCT_SITE}/cookies.</p>
              </div>
            </section>

            <section id="contacts">
              <h2 className="text-2xl font-semibold tracking-tight text-white">9. Контакты</h2>
              <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-5 text-sm leading-7">
                <div className="grid gap-2 text-slate-300">
                  <div><strong className="text-white">Оператор данных:</strong> {LEGAL_ENTITY.fullName}</div>
                  <div><strong className="text-white">Email:</strong> {LEGAL_ENTITY.emailSupport}</div>
                  <div><strong className="text-white">Телефон:</strong> {LEGAL_ENTITY.phone}</div>
                </div>
              </div>
            </section>

            <section id="history">
              <h2 className="text-2xl font-semibold tracking-tight text-white">10. История редакций</h2>
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
              <p>© 2026 {LEGAL_ENTITY.shortName}. Все права защищены.</p>
            </footer>
          </article>
        </div>
      </div>
    </main>
  )
}
