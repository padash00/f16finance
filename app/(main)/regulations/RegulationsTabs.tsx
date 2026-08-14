'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, BookOpenCheck, GraduationCap, Sparkles, type LucideIcon } from 'lucide-react'

type Tab = {
  href: string
  label: string
  note: string
  icon: LucideIcon
}

/**
 * Переключатель вкладок раздела «Регламенты точки».
 *
 * Живёт внутри шапки страницы (слот toolbar у AdminPageHeader), а не отдельной
 * полосой сверху: иначе получается два разных ряда вкладок и пустая плашка над
 * содержимым.
 */
const TABS: Tab[] = [
  { href: '/regulations', label: 'Правила и чек-листы', note: 'Материалы, чек-листы, журнал', icon: BookOpen },
  { href: '/regulations/exams', label: 'Экзамены', note: 'Аттестация операторов', icon: GraduationCap },
  { href: '/regulations/setup', label: 'Настройка', note: 'Ниша, каркас тем, сбор через ИИ', icon: Sparkles },
  { href: '/regulations/guide', label: 'Инструкция', note: 'Что где заполнять и в каком порядке', icon: BookOpenCheck },
]

export default function RegulationsTabs() {
  const pathname = usePathname()

  return (
    <nav className="flex flex-wrap gap-2" aria-label="Разделы регламентов">
      {TABS.map((tab) => {
        // '/regulations' — точное совпадение, иначе он подсвечивался бы на вложенных.
        const active = tab.href === '/regulations' ? pathname === tab.href : pathname.startsWith(tab.href)
        const Icon = tab.icon
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            title={tab.note}
            className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-[13px] font-semibold transition ${
              active
                ? 'border-slate-900/10 bg-slate-900 text-white shadow-sm dark:border-white/20 dark:bg-white dark:text-slate-900'
                : 'border-slate-200 bg-white/70 text-slate-600 hover:border-slate-400 hover:text-slate-900 dark:border-white/10 dark:bg-slate-900/50 dark:text-slate-300 dark:hover:border-white/25 dark:hover:text-white'
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
