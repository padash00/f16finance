'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, GraduationCap, Sparkles, type LucideIcon } from 'lucide-react'

type Tab = {
  href: string
  label: string
  note: string
  icon: LucideIcon
}

/**
 * Вкладки раздела «Регламенты точки».
 *
 * Три бывшие страницы (база знаний, экзамены, мастер настройки) — один цикл:
 * написали правило → проверили чек-листом → спросили на экзамене. Раньше они
 * жили в разных местах меню, и связь между ними приходилось держать в голове.
 */
const TABS: Tab[] = [
  { href: '/regulations', label: 'Правила и чек-листы', note: 'Материалы, чек-листы, журнал', icon: BookOpen },
  { href: '/regulations/exams', label: 'Экзамены', note: 'Аттестация операторов', icon: GraduationCap },
  { href: '/regulations/setup', label: 'Настройка', note: 'Ниша, каркас тем, сбор через ИИ', icon: Sparkles },
]

export default function RegulationsTabs() {
  const pathname = usePathname()

  return (
    <nav className="app-page-wide flex flex-wrap gap-2 px-4 pt-6 sm:px-6" aria-label="Разделы регламентов">
      {TABS.map((tab) => {
        // '/regulations' — точное совпадение, иначе он подсвечивался бы на всех вложенных.
        const active = tab.href === '/regulations' ? pathname === tab.href : pathname.startsWith(tab.href)
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            title={tab.note}
            className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-sm font-semibold transition ${
              active
                ? 'border-emerald-400/70 bg-emerald-400/15 text-emerald-700 dark:text-emerald-100'
                : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-100'
            }`}
          >
            <Icon className="h-4 w-4" />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
