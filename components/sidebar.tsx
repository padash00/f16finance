'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { canAccessPath, type StaffRole } from '@/lib/core/access'
import { cn } from '@/lib/utils'
import {
  BarChart3,
  BrainCircuit,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarRange,
  ChevronDown,
  CreditCard,
  FolderKanban,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  LogOut,
  Menu,
  MessageSquareText,
  Radar,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Tags,
  TrendingDown,
  TrendingUp,
  Trophy,
  User,
  Users,
  Users2,
  Wallet,
  Wrench,
  X,
  Zap,
} from 'lucide-react'

import { Button } from '@/components/ui/button'

type NavItem = {
  href: string
  label: string
  icon: any
  note?: string
  badge?: string
}

type NavSection = {
  id: string
  title: string
  subtitle: string
  accent: string
  items: NavItem[]
}

const navSections: NavSection[] = [
  {
    id: 'command',
    title: 'Центр управления',
    subtitle: 'Главные экраны и сводка',
    accent: 'from-[#ffb36b] to-[#ff7b54]',
    items: [
      { href: '/', label: 'Главная панель', icon: LayoutDashboard, note: 'Общий статус бизнеса' },
      { href: '/analysis', label: 'AI Разбор', icon: BrainCircuit, note: 'Диагностика и выводы', badge: 'AI' },
      { href: '/reports', label: 'Отчёты', icon: BarChart3, note: 'Сводные метрики' },
      { href: '/weekly-report', label: 'Недельный отчёт', icon: CalendarRange, note: 'Ритм недели' },
    ],
  },
  {
    id: 'finance',
    title: 'Деньги',
    subtitle: 'Потоки, расходы и налоги',
    accent: 'from-[#70e1c8] to-[#2db7f5]',
    items: [
      { href: '/income', label: 'Доходы', icon: TrendingUp, note: 'Оборот и выручка' },
      { href: '/expenses', label: 'Расходы', icon: TrendingDown, note: 'Списания и статьи' },
      { href: '/categories', label: 'Категории', icon: Tags, note: 'Структура расходов' },
      { href: '/tax', label: 'Налоги', icon: Landmark, note: '3% и контроль базы' },
    ],
  },
  {
    id: 'team',
    title: 'Команда и зарплаты',
    subtitle: 'Люди, доступы и начисления',
    accent: 'from-[#f8d66d] to-[#f39f4f]',
    items: [
      { href: '/salary', label: 'Зарплата', icon: Wallet, note: 'Расчёты и выплаты' },
      { href: '/salary/rules', label: 'Правила зарплаты', icon: ListChecks, note: 'Ставки и бонусы' },
      { href: '/operators', label: 'Операторы', icon: Users2, note: 'Профили и состояние' },
      { href: '/staff', label: 'Сотрудники', icon: Users, note: 'Админкоманда' },
      { href: '/pass', label: 'Доступы', icon: KeyRound, note: 'Учётные записи' },
    ],
  },
  {
    id: 'ops',
    title: 'Операционная работа',
    subtitle: 'Планы, задачи и ритм',
    accent: 'from-[#8fc4ff] to-[#5b87ff]',
    items: [
      { href: '/kpi', label: 'KPI', icon: Target, note: 'Контроль выполнения' },
      { href: '/kpi/plans', label: 'Планы KPI', icon: Radar, note: 'План-факт' },
      { href: '/tasks', label: 'Задачи', icon: FolderKanban, note: 'Текущая работа' },
      { href: '/shifts', label: 'Смены', icon: CalendarClock, note: 'График и сменность' },
    ],
  },
  {
    id: 'operator-space',
    title: 'Операторское пространство',
    subtitle: 'Коммуникация и мотивация',
    accent: 'from-[#ee9ae5] to-[#5961f9]',
    items: [
      { href: '/operator-analytics', label: 'Аналитика операторов', icon: Zap, note: 'Эффективность по людям' },
      { href: '/operator-chat', label: 'Чат операторов', icon: MessageSquareText, note: 'Коммуникация', badge: 'live' },
      { href: '/operator-achievements', label: 'Достижения', icon: Trophy, note: 'Мотивация и XP' },
      { href: '/operator-settings', label: 'Настройки операторов', icon: Briefcase, note: 'Профильный контур' },
    ],
  },
  {
    id: 'system',
    title: 'Система',
    subtitle: 'Настройка и обслуживание',
    accent: 'from-[#8f9bb3] to-[#596780]',
    items: [
      { href: '/settings', label: 'Настройки системы', icon: Settings2, note: 'Компании и справочники' },
      { href: '/debug', label: 'Диагностика', icon: Wrench, note: 'Проверки и отладка' },
    ],
  },
]

function LogoMark() {
  return (
    <div className="relative flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(255,180,107,0.35),rgba(87,130,255,0.28))] shadow-[0_18px_40px_rgba(0,0,0,0.28)]">
      <div className="absolute inset-[1px] rounded-[15px] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.24),transparent_58%),linear-gradient(180deg,rgba(13,18,28,0.96),rgba(8,12,20,0.98))]" />
      <Sparkles className="relative z-10 h-5 w-5 text-[#ffd27b]" />
    </div>
  )
}

function BrandHeader() {
  return (
    <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.02))] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
      <div className="flex items-start gap-3">
        <LogoMark />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate text-[15px] font-semibold tracking-[-0.03em] text-white">F16 Finance OS</h1>
            <span className="rounded-full border border-[#ffd27b]/25 bg-[#ffd27b]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.24em] text-[#ffd27b]">
              Core
            </span>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            Единая панель для денег, команды и операционного ритма.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Flow</p>
          <p className="mt-1 text-sm font-semibold text-white">Cash</p>
        </div>
        <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Ops</p>
          <p className="mt-1 text-sm font-semibold text-white">Team</p>
        </div>
        <div className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2">
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Mode</p>
          <p className="mt-1 text-sm font-semibold text-white">Live</p>
        </div>
      </div>
    </div>
  )
}

function SidebarItem({
  item,
  active,
  onClick,
}: {
  item: NavItem
  active: boolean
  onClick?: () => void
}) {
  const Icon = item.icon

  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        'group relative flex items-start gap-3 overflow-hidden rounded-2xl border pl-4 pr-3 py-3 transition-all duration-200',
        active
          ? 'border-white/15 bg-[linear-gradient(135deg,rgba(255,179,107,0.18),rgba(97,122,255,0.14))] text-white shadow-[0_16px_35px_rgba(0,0,0,0.22)]'
          : 'border-transparent bg-white/[0.03] text-slate-300 hover:border-white/8 hover:bg-white/[0.06] hover:text-white',
      )}
    >
      <div
        className={cn(
          'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border transition-all',
          active
            ? 'border-white/15 bg-white/10 text-[#ffd27b]'
            : 'border-white/8 bg-black/15 text-slate-400 group-hover:text-[#ffd27b]',
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium tracking-[-0.02em]">{item.label}</span>
          {item.badge ? (
            <span className="rounded-full border border-[#7ef0cf]/20 bg-[#7ef0cf]/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#7ef0cf]">
              {item.badge}
            </span>
          ) : null}
        </div>
        {item.note ? <p className="mt-1 text-xs leading-4 text-slate-500 group-hover:text-slate-400">{item.note}</p> : null}
      </div>

      {active ? <div className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-[#ffd27b]" /> : null}
    </Link>
  )
}

function SidebarSection({
  section,
  pathname,
  open,
  onToggle,
  onNavigate,
}: {
  section: NavSection
  pathname: string
  open: boolean
  onToggle: () => void
  onNavigate?: () => void
}) {
  const hasActiveItem = section.items.some((item) =>
    item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/'),
  )

  return (
    <section className="rounded-[26px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] p-2 shadow-[0_14px_28px_rgba(0,0,0,0.18)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-[20px] py-3 pl-4 pr-3 text-left transition-colors hover:bg-white/[0.04]"
      >
        <div className={cn('h-10 w-1 rounded-full bg-gradient-to-b', section.accent)} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-[-0.02em] text-white">{section.title}</p>
          <p className="text-[11px] text-slate-500">{section.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasActiveItem ? (
            <span className="rounded-full border border-[#ffd27b]/20 bg-[#ffd27b]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-[#ffd27b]">
              active
            </span>
          ) : null}
          <ChevronDown className={cn('h-4 w-4 text-slate-500 transition-transform', open && 'rotate-180 text-slate-200')} />
        </div>
      </button>

      {open ? (
        <div className="space-y-2 pb-1 pl-4 pr-1 pt-2">
          {section.items.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/')
            return <SidebarItem key={item.href} item={item} active={active} onClick={onNavigate} />
          })}
        </div>
      ) : null}
    </section>
  )
}

function UserCard({
  onLogout,
  email,
}: {
  onLogout: () => Promise<void>
  email: string | null
}) {
  return (
    <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.02))] p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-[linear-gradient(145deg,rgba(255,255,255,0.12),rgba(255,255,255,0.04))] text-white">
          <ShieldCheck className="h-5 w-5 text-[#ffd27b]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-white">Панель управления</p>
          <p className="truncate text-xs text-slate-500">{email || 'admin@system.local'}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-[#7ef0cf]/20 bg-[#7ef0cf]/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7ef0cf]">
          <LifeBuoy className="h-3 w-3" />
          online
        </div>
        <div className="flex items-center gap-1 rounded-full border border-white/8 bg-white/[0.04] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          <Building2 className="h-3 w-3" />
          control
        </div>
      </div>

      <Button
        variant="ghost"
        onClick={onLogout}
        className="mt-4 h-11 w-full justify-between rounded-2xl border border-white/8 bg-white/[0.04] px-4 text-slate-300 hover:border-[#ff8f70]/20 hover:bg-[#ff8f70]/10 hover:text-white"
      >
        <span className="flex items-center gap-2">
          <LogOut className="h-4 w-4" />
          Выйти
        </span>
        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">exit</span>
      </Button>
    </div>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [isStaff, setIsStaff] = useState(false)
  const [isOperator, setIsOperator] = useState(false)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(navSections.map((section, index) => [section.id, index < 3])),
  )

  useEffect(() => {
    let ignore = false

    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!ignore) {
        setUserEmail(user?.email || null)
      }

      const response = await fetch('/api/auth/session-role').catch(() => null)
      const json = await response?.json().catch(() => null)

      if (!ignore && response?.ok) {
        setIsSuperAdmin(!!json?.isSuperAdmin)
        setIsStaff(!!json?.isStaff)
        setIsOperator(!!json?.isOperator)
        setStaffRole((json?.staffRole as StaffRole | null) || null)
      }
    }

    loadUser()
    return () => {
      ignore = true
    }
  }, [])

  const visibleSections = useMemo(() => {
    return navSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => {
          return canAccessPath({
            pathname: item.href,
            isStaff,
            isOperator,
            staffRole,
            isSuperAdmin,
          })
        }),
      }))
      .filter((section) => section.items.length > 0)
  }, [isOperator, isStaff, isSuperAdmin, staffRole])

  useEffect(() => {
    const activeSection = visibleSections.find((section) =>
      section.items.some((item) => (item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/'))),
    )

    if (!activeSection) return

    setOpenSections((prev) => ({
      ...prev,
      [activeSection.id]: true,
    }))
  }, [pathname, visibleSections])

  const stats = useMemo(
    () => [
      { label: 'Модулей', value: String(visibleSections.reduce((sum, section) => sum + section.items.length, 0)).padStart(2, '0'), icon: Sparkles },
      { label: 'Групп', value: String(visibleSections.length).padStart(2, '0'), icon: FolderKanban },
      { label: 'Фокус', value: 'OS', icon: CreditCard },
    ],
    [visibleSections],
  )

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const toggleSection = (sectionId: string) => {
    setOpenSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }))
  }

  const navContent = (
    <div className="flex h-full flex-col bg-[linear-gradient(180deg,#0a1019_0%,#08111d_48%,#09131f_100%)] text-white">
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-4 md:px-5">
        <LogoMark />
        <button
          className="rounded-2xl border border-white/8 bg-white/[0.04] p-2 text-slate-400 transition-colors hover:text-white md:hidden"
          onClick={() => setIsOpen(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 md:px-5">
        <BrandHeader />

        <div className="mt-4 grid grid-cols-3 gap-2">
          {stats.map((stat) => {
            const Icon = stat.icon
            return (
              <div
                key={stat.label}
                className="rounded-[22px] border border-white/8 bg-white/[0.04] px-3 py-3 text-center shadow-[0_10px_24px_rgba(0,0,0,0.14)]"
              >
                <Icon className="mx-auto h-3.5 w-3.5 text-slate-500" />
                <p className="mt-2 text-sm font-semibold text-white">{stat.value}</p>
                <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{stat.label}</p>
              </div>
            )
          })}
        </div>

        <div className="mt-5 space-y-3 pl-2">
          {visibleSections.map((section) => (
            <SidebarSection
              key={section.id}
              section={section}
              pathname={pathname}
              open={!!openSections[section.id]}
              onToggle={() => toggleSection(section.id)}
              onNavigate={() => setIsOpen(false)}
            />
          ))}
        </div>
      </div>

      <div className="border-t border-white/6 px-4 py-4 md:px-5">
        <UserCard onLogout={handleLogout} email={userEmail} />
      </div>
    </div>
  )

  return (
    <>
      <div className="fixed left-0 right-0 top-0 z-40 flex h-16 items-center justify-between border-b border-white/8 bg-[rgba(7,12,20,0.82)] px-4 backdrop-blur-xl md:hidden">
        <div className="flex items-center gap-3">
          <LogoMark />
          <div>
            <p className="text-sm font-semibold tracking-[-0.02em] text-white">F16 Finance OS</p>
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">navigation</p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(true)}
          className="rounded-2xl border border-white/8 bg-white/[0.04] text-slate-300 hover:bg-white/[0.08] hover:text-white"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {isOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button className="absolute inset-0 bg-[rgba(3,6,12,0.75)] backdrop-blur-sm" onClick={() => setIsOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[92%] max-w-md border-r border-white/8 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
            {navContent}
          </div>
        </div>
      ) : null}

      <aside className="sticky top-0 hidden h-screen w-[368px] shrink-0 border-r border-white/6 bg-[linear-gradient(180deg,#07101a_0%,#08111d_40%,#09131f_100%)] md:block xl:w-[392px]">
        {navContent}
      </aside>
    </>
  )
}
