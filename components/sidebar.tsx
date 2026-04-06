'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { canAccessPath, type StaffRole, type SubscriptionFeature } from '@/lib/core/access'
import type { SessionRoleInfo } from '@/lib/core/types'
import { cn } from '@/lib/utils'
import {
  ArchiveX,
  BarChart3,
  BrainCircuit,
  Briefcase,
  Building2,
  Boxes,
  CreditCard,
  CalendarClock,
  CalendarDays,
  CalendarRange,
  History,
  Calculator,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  Command,
  FolderKanban,
  Gauge,
  KeyRound,
  Landmark,
  LayoutDashboard,
  LifeBuoy,
  ListChecks,
  Logs,
  LogOut,
  Menu,
  MessageSquareText,
  Monitor,
  Network,
  Receipt,
  FileSpreadsheet,
  Package2,
  PackagePlus,
  PackageSearch,
  PieChart,
  Radar,
  RotateCcw,
  ScanSearch,
  Search,
  Settings2,
  Shield,
  Store,
  Target,
  Tags,
  TrendingDown,
  TrendingUp,
  Trophy,
  User,
  Users,
  Users2,
  Wallet,
  Workflow,
  Wrench,
  X,
  Zap,
} from 'lucide-react'

import { AppLogoMark } from '@/components/app-brand-mark'
import { Button } from '@/components/ui/button'
import { SITE_NAME } from '@/lib/core/site'

type NavItem = {
  href: string
  label: string
  icon: any
  note?: string
  badge?: string
  badgeColor?: 'purple' | 'blue' | 'green' | 'red' | 'orange' | 'default'
  isNew?: boolean
}

type NavSection = {
  id: string
  title: string
  subtitle: string
  accentColor: 'amber' | 'emerald' | 'yellow' | 'blue' | 'fuchsia' | 'slate'
  icon: any
  items: NavItem[]
}

const SIDEBAR_SCROLL_KEY = 'f16.sidebar.scrollTop'
const SIDEBAR_SECTIONS_KEY = 'f16.sidebar.sections'

const navSections: NavSection[] = [
  {
    id: 'command',
    title: 'Центр управления',
    subtitle: 'Главные экраны и сводка',
    accentColor: 'amber',
    icon: Gauge,
    items: [
      { href: '/dashboard', label: 'Главная панель', icon: LayoutDashboard, note: 'Общий статус бизнеса' },
      { href: '/analysis', label: 'AI Разбор', icon: BrainCircuit, note: 'Диагностика и выводы', badge: 'AI', badgeColor: 'purple', isNew: true },
      { href: '/forecast', label: 'AI Прогноз', icon: Radar, note: 'Прогноз 30/60/90 дней', badge: 'AI', badgeColor: 'purple', isNew: true },
      { href: '/goals', label: 'Цели и план', icon: Target, note: 'Плановые показатели', badge: 'new', badgeColor: 'blue' },
      { href: '/reports', label: 'Отчеты', icon: BarChart3, note: 'Сводные метрики' },
      { href: '/reports/monthly', label: 'Ежемесячный отчёт', icon: FileSpreadsheet, note: 'Бухгалтерия и налоги' },
      { href: '/weekly-report', label: 'Недельный отчет', icon: CalendarRange, note: 'Ритм недели' },
    ],
  },
  {
    id: 'finance',
    title: 'Деньги',
    subtitle: 'Потоки, расходы и налоги',
    accentColor: 'emerald',
    icon: PieChart,
    items: [
      { href: '/income', label: 'Доходы', icon: TrendingUp, note: 'Оборот и выручка', badge: '↑23%', badgeColor: 'green' },
      { href: '/kaspi-terminal', label: 'Kaspi терминал', icon: CreditCard, note: 'Суточные итоги с POS' },
      { href: '/analytics', label: 'Аналитика доходов', icon: BarChart3, note: 'Сравнение точек и тренды' },
      { href: '/expenses', label: 'Расходы', icon: TrendingDown, note: 'Списания и статьи' },
      { href: '/cashflow', label: 'Cash Flow', icon: Wallet, note: 'Движение денег и баланс', badge: 'AI', badgeColor: 'blue', isNew: true },
      { href: '/categories', label: 'Категории', icon: Tags, note: 'Структура расходов' },
      { href: '/tax', label: 'Налоги', icon: Landmark, note: '3% и контроль базы' },
      { href: '/profitability', label: 'ОПиУ и EBITDA', icon: Calculator, note: 'Полная прибыль и комиссии POS' },
    ],
  },
  {
    id: 'store',
    title: 'Магазин',
    subtitle: 'Склад, витрины и движение товара',
    accentColor: 'emerald',
    icon: Boxes,
    items: [
      { href: '/store', label: 'Обзор магазина', icon: Boxes, note: 'Общая сводка по складу и витринам' },
      { href: '/store/catalog', label: 'Каталог', icon: Tags, note: 'Товары, категории и поставщики' },
      { href: '/store/receipts', label: 'Приемка', icon: PackagePlus, note: 'Документы прихода на склад' },
      { href: '/store/requests', label: 'Заявки', icon: ClipboardList, note: 'Заявки точек и одобрение' },
      { href: '/store/analytics', label: 'Аналитика точек', icon: Store, note: 'Остатки и движение по витринам' },
      { href: '/store/consumables', label: 'Расходники', icon: Package2, note: 'Нормы и контроль остатков' },
      { href: '/store/writeoffs', label: 'Списания', icon: ArchiveX, note: 'Брак и служебные расходы' },
      { href: '/store/revisions', label: 'Ревизия', icon: ScanSearch, note: 'Полная проверка склада и витрин' },
      { href: '/store/movements', label: 'Движения', icon: History, note: 'Журнал товарных операций' },
      { href: '/store/abc', label: 'ABC-анализ', icon: PieChart, note: 'Классификация товаров по выручке' },
      { href: '/store/forecast', label: 'Прогноз остатков', icon: PackageSearch, note: 'Прогноз по скорости продаж' },
      { href: '/pos', label: 'Касса (Web POS)', icon: Monitor, note: 'Веб-касса для планшета и браузера' },
      { href: '/pos-receipts', label: 'История чеков', icon: Receipt, note: 'Просмотр и печать чеков POS' },
      { href: '/pos-returns', label: 'Возврат товара', icon: RotateCcw, note: 'Оформление возврата по чеку' },
    ],
  },
  {
    id: 'team',
    title: 'Команда и зарплаты',
    subtitle: 'Люди, структура и начисления',
    accentColor: 'yellow',
    icon: Users,
    items: [
      { href: '/salary', label: 'Зарплата', icon: Wallet, note: 'Расчеты и выплаты' },
      { href: '/salary/rules', label: 'Правила зарплаты', icon: ListChecks, note: 'Ставки и бонусы' },
      { href: '/point-debts', label: 'Долги с точки', icon: Receipt, note: 'Позиции по неделям и списание' },
      { href: '/operators', label: 'Операторы', icon: Users2, note: 'Профили и состояние', badge: '8', badgeColor: 'blue' },
      { href: '/structure', label: 'Структура', icon: Network, note: 'Иерархия команды и точек' },
      { href: '/staff', label: 'Сотрудники', icon: Users, note: 'Админкоманда' },
      { href: '/pass', label: 'Доступы', icon: KeyRound, note: 'Учетные записи' },
    ],
  },
  {
    id: 'ops',
    title: 'Операционная работа',
    subtitle: 'Планы, задачи и ритм',
    accentColor: 'blue',
    icon: Workflow,
    items: [
      { href: '/kpi', label: 'KPI', icon: Target, note: 'Контроль выполнения' },
      { href: '/kpi/plans', label: 'Планы KPI', icon: Radar, note: 'План-факт', badge: 'new', badgeColor: 'green' },
      { href: '/tasks', label: 'Задачи', icon: FolderKanban, note: 'Текущая работа', badge: '12', badgeColor: 'red' },
      { href: '/shifts', label: 'Смены', icon: CalendarClock, note: 'График и сменность' },
      { href: '/birthdays', label: 'Дни рождения', icon: CalendarDays, note: 'Кто скоро отмечает' },
    ],
  },
  {
    id: 'operator-space',
    title: 'Операторское пространство',
    subtitle: 'Коммуникация и мотивация',
    accentColor: 'fuchsia',
    icon: Zap,
    items: [
      { href: '/operator-dashboard', label: 'Мой кабинет', icon: User, note: 'Сводка оператора' },
      { href: '/operator-lead', label: 'Моя точка', icon: Building2, note: 'Команда и спорные смены точки', badge: 'lead', badgeColor: 'orange' },
      { href: '/operator-tasks', label: 'Мои задачи', icon: ClipboardCheck, note: 'Личный контур задач', badge: '3', badgeColor: 'orange' },
      { href: '/ratings', label: 'Рейтинг операторов', icon: Trophy, note: 'Лидерборд по выручке', badge: 'new', badgeColor: 'orange', isNew: true },
      { href: '/operator-analytics', label: 'Аналитика операторов', icon: Zap, note: 'Эффективность по людям' },
      { href: '/operator-chat', label: 'Чат операторов', icon: MessageSquareText, note: 'Коммуникация', badge: 'live', badgeColor: 'green' },
      { href: '/operator-achievements', label: 'Достижения', icon: Trophy, note: 'Мотивация и XP', badge: 'XP', badgeColor: 'purple' },
      { href: '/operator-settings', label: 'Настройки операторов', icon: Briefcase, note: 'Профильный контур' },
    ],
  },
  {
    id: 'system',
    title: 'Система',
    subtitle: 'Настройка и обслуживание',
    accentColor: 'slate',
    icon: Shield,
    items: [
      { href: '/settings', label: 'Настройки системы', icon: Settings2, note: 'Компании и справочники' },
      { href: '/access', label: 'Права и пароли', icon: Shield, note: 'Доступ ролей и аккаунты' },
      { href: '/telegram', label: 'Telegram Bot', icon: MessageSquareText, note: 'Уведомления и команды', badge: 'new', badgeColor: 'blue' },
      { href: '/point-devices', label: 'Точки и устройства', icon: Building2, note: 'Токены и программы точек' },
      { href: '/logs', label: 'Логирование', icon: Logs, note: 'Аудит, уведомления и события' },
      { href: '/debug', label: 'Диагностика', icon: Wrench, note: 'Проверки и отладка' },
    ],
  },
]

function getSectionById(sectionId: string) {
  return navSections.find((section) => section.id === sectionId)
}

function getSectionItem(sectionId: string, href: string) {
  return getSectionById(sectionId)?.items.find((item) => item.href === href)
}

function buildOwnerNavSections(): NavSection[] {
  const commandSection = getSectionById('command')
  const financeSection = getSectionById('finance')
  const teamSection = getSectionById('team')
  const opsSection = getSectionById('ops')
  const pointDevicesItem = getSectionItem('system', '/point-devices')
  const operatorAnalyticsItem = getSectionItem('operator-space', '/operator-analytics')

  const sections: NavSection[] = []

  if (commandSection) {
    sections.push(commandSection)
  }

  if (financeSection) {
    sections.push(financeSection)
  }

  if (teamSection) {
    sections.push({
      ...teamSection,
      items: teamSection.items.filter((item) => item.href !== '/pass'),
    })
  }

  if (opsSection) {
    sections.push({
      ...opsSection,
      items: pointDevicesItem ? [...opsSection.items, pointDevicesItem] : opsSection.items,
    })
  }

  if (operatorAnalyticsItem) {
    sections.push({
      id: 'owner-operator-analytics',
      title: 'Аналитика операторов',
      subtitle: 'Эффективность, качество и динамика по людям',
      accentColor: 'fuchsia',
      icon: Zap,
      items: [operatorAnalyticsItem],
    })
  }

  return sections
}

const badgeColors: Record<NonNullable<NavItem['badgeColor']>, string> = {
  purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  red: 'bg-red-500/10 text-red-400 border-red-500/20',
  orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  default: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
}

const sectionStyles: Record<
  NavSection['accentColor'],
  {
    bg: string
    text: string
    border: string
    gradient: string
    activeRing: string
  }
> = {
  amber: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    border: 'border-amber-500/20',
    gradient: 'from-amber-500/20 to-orange-500/20',
    activeRing: 'ring-amber-500/50',
  },
  emerald: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    border: 'border-emerald-500/20',
    gradient: 'from-emerald-500/20 to-cyan-500/20',
    activeRing: 'ring-emerald-500/50',
  },
  yellow: {
    bg: 'bg-yellow-500/10',
    text: 'text-yellow-400',
    border: 'border-yellow-500/20',
    gradient: 'from-yellow-500/20 to-amber-500/20',
    activeRing: 'ring-yellow-500/50',
  },
  blue: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    border: 'border-blue-500/20',
    gradient: 'from-blue-500/20 to-indigo-500/20',
    activeRing: 'ring-blue-500/50',
  },
  fuchsia: {
    bg: 'bg-fuchsia-500/10',
    text: 'text-fuchsia-400',
    border: 'border-fuchsia-500/20',
    gradient: 'from-fuchsia-500/20 to-pink-500/20',
    activeRing: 'ring-fuchsia-500/50',
  },
  slate: {
    bg: 'bg-slate-500/10',
    text: 'text-slate-400',
    border: 'border-slate-500/20',
    gradient: 'from-slate-500/20 to-slate-600/20',
    activeRing: 'ring-slate-500/40',
  },
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
        'group relative flex items-start gap-3 rounded-xl px-3 py-2.5 transition-all duration-300',
        active
          ? 'bg-gradient-to-r from-amber-500/10 to-orange-500/10 text-white shadow-lg shadow-amber-500/5'
          : 'text-slate-400 hover:bg-white/5 hover:text-white',
      )}
    >
      {active ? (
        <div className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-gradient-to-b from-amber-400 to-orange-500" />
      ) : null}

      <div
        className={cn(
          'relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-300',
          active
            ? 'bg-gradient-to-br from-amber-500/20 to-orange-500/20 text-amber-400'
            : 'bg-slate-800/50 text-slate-500 group-hover:bg-slate-800 group-hover:text-slate-300',
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('truncate text-sm font-medium', active ? 'text-white' : 'text-slate-300 group-hover:text-white')}>
            {item.label}
          </span>
          {item.badge ? (
            <span className={cn('rounded-md border px-1.5 py-0.5 text-xs font-medium', badgeColors[item.badgeColor || 'default'])}>
              {item.badge}
            </span>
          ) : null}
          {item.isNew ? (
            <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-xs font-medium text-amber-400 animate-pulse">
              new
            </span>
          ) : null}
        </div>
        {item.note ? (
          <p className={cn('mt-0.5 text-xs', active ? 'text-slate-400' : 'text-slate-500 group-hover:text-slate-400')}>
            {item.note}
          </p>
        ) : null}
      </div>
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
  const SectionIcon = section.icon
  const style = sectionStyles[section.accentColor]

  return (
    <div className="relative group">
      <div className={cn('absolute -inset-1 rounded-2xl blur-md opacity-0 transition-opacity duration-500 group-hover:opacity-100 bg-gradient-to-r', style.gradient)} />

      <div className="relative rounded-xl border border-white/5 bg-slate-900/50 p-3 backdrop-blur-sm transition-all duration-300 hover:border-white/10">
        <button type="button" onClick={onToggle} className="flex w-full items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-xl border transition-all duration-300',
              style.bg,
              style.border,
              hasActiveItem && 'ring-2 ring-offset-2 ring-offset-slate-900',
              hasActiveItem && style.activeRing,
            )}
          >
            <SectionIcon className={cn('h-5 w-5', style.text)} />
          </div>

          <div className="min-w-0 flex-1 text-left">
            <div className="flex items-center gap-2">
              <p className="text-base font-semibold text-white">{section.title}</p>
              {hasActiveItem ? (
                <span className={cn('rounded-full border px-2 py-0.5 text-xs font-medium', style.bg, style.border, style.text)}>
                  active
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-slate-500">{section.subtitle}</p>
          </div>

          <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-300', open ? style.bg : 'bg-slate-800/50')}>
            <ChevronDown className={cn('h-4 w-4 transition-transform duration-300', open ? cn('rotate-180', style.text) : 'text-slate-500')} />
          </div>
        </button>

        <div
          className={cn(
            'grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none',
            open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          )}
        >
          <div className="min-h-0">
            <div className="space-y-1 pt-3">
              {section.items.map((item) => {
                const active =
                  item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/')
                return <SidebarItem key={item.href} item={item} active={active} onClick={onNavigate} />
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function UserCard({
  onLogout,
  email,
  displayName,
  roleLabel,
}: {
  onLogout: () => Promise<void>
  email: string | null
  displayName: string | null
  roleLabel: string | null
}) {
  return (
    <div className="relative group">
      <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 blur opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <div className="relative rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/90 to-slate-800/90 p-4 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 blur opacity-50" />
            <div className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-br from-slate-800 to-slate-700">
              <User className="h-5 w-5 text-amber-300" />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">{displayName || 'Панель управления'}</p>
            <p className="truncate text-xs text-slate-500">{email || 'admin@system.local'}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1">
            <LifeBuoy className="h-3 w-3 text-emerald-400" />
            <span className="text-xs font-medium text-emerald-400">online</span>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-white/5 bg-slate-800 px-2 py-1">
            <Shield className="h-3 w-3 text-slate-400" />
            <span className="text-xs font-medium text-slate-300">{roleLabel || 'control'}</span>
          </div>
        </div>

        <Button
          variant="ghost"
          onClick={onLogout}
          className="mt-3 w-full justify-between rounded-xl border border-white/5 bg-slate-800/50 px-3 py-2 text-slate-300 transition-all duration-300 hover:border-red-500/20 hover:bg-red-500/10 hover:text-red-400"
        >
          <span className="flex items-center gap-2 text-sm">
            <LogOut className="h-4 w-4" />
            Выйти
          </span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

function OrganizationSwitcher({
  organizations,
  activeOrganization,
  onSelect,
  disabled,
}: {
  organizations: NonNullable<SessionRoleInfo['organizations']>
  activeOrganization: SessionRoleInfo['activeOrganization']
  onSelect: (organizationId: string) => Promise<void>
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)

  if (!organizations.length) return null

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-slate-900/70 px-3 py-3 text-left transition hover:border-amber-500/20 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-70"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10">
          <Building2 className="h-4 w-4 text-amber-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Организация</p>
          <p className="truncate text-sm font-semibold text-white">
            {activeOrganization?.name || organizations[0]?.name || 'Не выбрана'}
          </p>
          <p className="truncate text-xs text-slate-500">
            {disabled ? 'Переключаем контекст...' : `${organizations.length} ${organizations.length === 1 ? 'организация' : 'организации'}`}
          </p>
        </div>
        <ChevronDown className={cn('h-4 w-4 text-slate-500 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <div className="absolute inset-x-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border border-white/10 bg-slate-950/95 p-2 shadow-2xl backdrop-blur-xl">
          <div className="mb-1 px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">Доступные организации</div>
          <div className="space-y-1">
            {organizations.map((organization) => {
              const isActive = activeOrganization?.id === organization.id
              return (
                <button
                  key={organization.id}
                  type="button"
                  disabled={disabled || isActive}
                  onClick={async () => {
                    await onSelect(organization.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition',
                    isActive
                      ? 'border-emerald-500/20 bg-emerald-500/10'
                      : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]',
                    (disabled || isActive) && 'cursor-default',
                  )}
                >
                  <div className={cn('mt-0.5 h-2.5 w-2.5 rounded-full', isActive ? 'bg-emerald-400' : 'bg-slate-600')} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-white">{organization.name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {organization.slug} · {organization.accessRole}
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ActiveOrganizationCard({
  activeOrganization,
}: {
  activeOrganization: SessionRoleInfo['activeOrganization']
}) {
  if (!activeOrganization) return null

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 px-3 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
          <Building2 className="h-4 w-4 text-emerald-300" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Ваша организация</p>
          <p className="truncate text-sm font-semibold text-white">{activeOrganization.name}</p>
          <p className="truncate text-xs text-slate-500">
            {activeOrganization.slug} · {activeOrganization.accessRole}
          </p>
        </div>
      </div>
    </div>
  )
}

function SearchBar({
  value,
  onChange,
  inputRef,
}: {
  value: string
  onChange: (value: string) => void
  inputRef: React.RefObject<HTMLInputElement | null>
}) {
  return (
    <div className="group relative w-full">
      <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-amber-500/20 to-orange-500/20 blur opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
      <div className="relative flex items-center gap-2 rounded-xl border border-white/5 bg-slate-800/50 px-3 py-2.5 text-left text-sm text-slate-400 transition-all duration-300 group-hover:bg-slate-800/70 focus-within:border-amber-500/30 focus-within:bg-slate-800/80">
        <Search className="h-4 w-4 text-slate-500" />
        <input
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Поиск по меню..."
          className="flex-1 bg-transparent text-sm text-slate-200 placeholder:text-slate-500 outline-none"
        />
        <div className="flex items-center gap-1 rounded-md border border-white/5 bg-slate-700 px-1.5 py-0.5">
          <Command className="h-3 w-3 text-slate-400" />
          <span className="text-xs text-slate-400">K</span>
        </div>
      </div>
    </div>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const hasRestoredScrollRef = useRef(false)
  const [isOpen, setIsOpen] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null)
  const [roleLabel, setRoleLabel] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [isTenantContext, setIsTenantContext] = useState(false)
  const [isStaff, setIsStaff] = useState(false)
  const [isOperator, setIsOperator] = useState(false)
  const [isLeadOperator, setIsLeadOperator] = useState(false)
  const [organizations, setOrganizations] = useState<NonNullable<SessionRoleInfo['organizations']>>([])
  const [activeOrganization, setActiveOrganization] = useState<SessionRoleInfo['activeOrganization']>(null)
  const [subscriptionFeatures, setSubscriptionFeatures] = useState<Partial<Record<SubscriptionFeature, boolean>>>({})
  const [rolePermissionOverrides, setRolePermissionOverrides] = useState<
  Array<{ path: string; enabled: boolean }>
>([])
  const [isSwitchingOrganization, setIsSwitchingOrganization] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    if (typeof window !== 'undefined') {
      const raw = window.localStorage.getItem(SIDEBAR_SECTIONS_KEY)
      if (raw) {
        try {
          return JSON.parse(raw) as Record<string, boolean>
        } catch {}
      }
    }

    return Object.fromEntries(navSections.map((section, index) => [section.id, index < 3]))
  })

  const baseSections = useMemo(() => {
    if (!isSuperAdmin && staffRole === 'owner') {
      return buildOwnerNavSections()
    }

    return navSections
  }, [isSuperAdmin, staffRole])

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
        const superAdmin = !!json?.isSuperAdmin
        setIsSuperAdmin(superAdmin)
        setIsTenantContext(!!json?.isTenantContext)
        setIsStaff(!!json?.isStaff)
        setIsOperator(!!json?.isOperator)
        setIsLeadOperator(!!json?.isLeadOperator)
        setStaffRole((json?.staffRole as StaffRole | null) || null)
        setDisplayName((json?.displayName as string | null) || null)
        setRoleLabel((json?.roleLabel as string | null) || null)
        setOrganizations(Array.isArray(json?.organizations) ? json.organizations : [])
        setActiveOrganization((json?.activeOrganization as SessionRoleInfo['activeOrganization']) || null)
        setSubscriptionFeatures(
          ((json?.activeSubscription as SessionRoleInfo['activeSubscription'] | null)?.plan?.features as Partial<Record<SubscriptionFeature, boolean>> | undefined) || {},
        )
        setRolePermissionOverrides(Array.isArray(json?.rolePermissionOverrides) ? json.rolePermissionOverrides : [])
        // Super admin sees all sections expanded
        if (superAdmin) {
          setOpenSections(Object.fromEntries(navSections.map((s) => [s.id, true])))
        }
      }
    }

    loadUser()
    return () => {
      ignore = true
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(openSections))
  }, [openSections])

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || !scrollRef.current || hasRestoredScrollRef.current) return
    const saved = window.sessionStorage.getItem(SIDEBAR_SCROLL_KEY)
    if (saved) {
      scrollRef.current.scrollTop = Number(saved) || 0
    }
    hasRestoredScrollRef.current = true
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const visibleSections = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return baseSections
      .map((section) => ({
        ...section,
        items: section.items
          .filter((item) => {
            if (item.href === '/operator-lead' && !isLeadOperator) {
              return false
            }
            return canAccessPath({
              pathname: item.href,
              isStaff,
              isOperator,
              staffRole,
              isSuperAdmin,
              subscriptionFeatures,
              rolePermissionOverrides,
            })
          })
          .filter((item) => {
            if (!query) return true
            const haystack = `${item.label} ${item.note || ''} ${section.title} ${section.subtitle}`.toLowerCase()
            return haystack.includes(query)
          }),
      }))
      .filter((section) => {
        if (section.items.length > 0) return true
        if (!query) return false
        const sectionText = `${section.title} ${section.subtitle}`.toLowerCase()
        return sectionText.includes(query)
      })
  }, [baseSections, isLeadOperator, isOperator, isStaff, isSuperAdmin, searchQuery, staffRole, subscriptionFeatures, rolePermissionOverrides])

  useEffect(() => {
    if (!searchQuery.trim()) return
    setOpenSections((prev) => {
      const next = { ...prev }
      for (const section of visibleSections) {
        next[section.id] = true
      }
      return next
    })
  }, [searchQuery, visibleSections])

  useEffect(() => {
    const activeSection = visibleSections.find((section) =>
      section.items.some((item) =>
        item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/'),
      ),
    )

    if (!activeSection) return

    setOpenSections((prev) => ({
      ...prev,
      [activeSection.id]: true,
    }))
  }, [pathname, visibleSections])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const handleSwitchOrganization = async (organizationId: string) => {
    if (!organizationId || activeOrganization?.id === organizationId) return

    try {
      setIsSwitchingOrganization(true)
      const response = await fetch('/api/auth/active-organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${response.status}`)
      }

      const body = await response.json().catch(() => null)
      setActiveOrganization(body?.activeOrganization || null)
      router.refresh()
      window.location.reload()
    } finally {
      setIsSwitchingOrganization(false)
    }
  }

  const toggleSection = (sectionId: string) => {
    setOpenSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }))
  }

  const navContent = (
    <div className="flex h-full flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <AppLogoMark />
          <div>
            <h1 className="bg-gradient-to-r from-white to-slate-300 bg-clip-text text-lg font-bold text-transparent">
              {SITE_NAME}
            </h1>
            <p className="text-xs text-slate-500">v2.0.1</p>
          </div>
        </div>
        <button
          className="rounded-xl border border-white/5 bg-white/5 p-2 text-slate-400 transition-all duration-300 hover:bg-white/10 hover:text-white md:hidden"
          onClick={() => setIsOpen(false)}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={(event) => {
          if (typeof window === 'undefined') return
          window.sessionStorage.setItem(SIDEBAR_SCROLL_KEY, String(event.currentTarget.scrollTop))
        }}
        className="flex-1 overflow-y-auto px-4 py-4"
      >
        <div className="sticky top-0 z-10 -mx-1 bg-gradient-to-b from-slate-950 via-slate-950/95 to-transparent px-1 pb-4 pt-1 backdrop-blur-xl">
          {isSuperAdmin && !isTenantContext ? (
            <OrganizationSwitcher
              organizations={organizations}
              activeOrganization={activeOrganization}
              onSelect={handleSwitchOrganization}
              disabled={isSwitchingOrganization}
            />
          ) : (
            <ActiveOrganizationCard activeOrganization={activeOrganization} />
          )}
          <div className="mt-3">
            <SearchBar value={searchQuery} onChange={setSearchQuery} inputRef={searchInputRef} />
          </div>
        </div>

        <div className="mt-4 space-y-3">
          {visibleSections.length > 0 ? (
            visibleSections.map((section) => (
              <SidebarSection
                key={section.id}
                section={section}
                pathname={pathname}
                open={!!openSections[section.id]}
                onToggle={() => toggleSection(section.id)}
                onNavigate={() => setIsOpen(false)}
              />
            ))
          ) : (
            <div className="rounded-2xl border border-white/10 bg-slate-900/50 px-4 py-5 text-sm text-slate-400">
              По запросу ничего не найдено.
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-white/5 bg-gradient-to-t from-slate-950 to-transparent px-4 py-4">
        <UserCard onLogout={handleLogout} email={userEmail} displayName={displayName} roleLabel={roleLabel} />
      </div>
    </div>
  )

  return (
    <>
      <div className="fixed left-0 right-0 top-0 z-40 flex h-16 items-center justify-between border-b border-white/5 bg-slate-950/80 px-4 backdrop-blur-xl md:hidden">
        <div className="flex items-center gap-3">
          <AppLogoMark />
          <div>
            <p className="text-sm font-semibold text-white">{SITE_NAME}</p>
            <p className="text-xs text-slate-500">workspace</p>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsOpen(true)}
          className="rounded-xl border border-white/5 bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      {isOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm orda-drawer-backdrop"
            onClick={() => setIsOpen(false)}
            aria-hidden
          />
          <div className="absolute inset-y-0 left-0 w-[84%] max-w-[20rem] border-r border-white/5 shadow-2xl orda-drawer-panel">
            {navContent}
          </div>
        </div>
      ) : null}

      <aside className="sticky top-0 hidden h-screen w-[300px] shrink-0 border-r border-white/5 bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 md:block xl:w-[320px]">
        {navContent}
      </aside>
    </>
  )
}
