import {
  ArchiveX,
  BarChart3,
  BookOpen,
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
  ClipboardCheck,
  ClipboardList,
  FolderKanban,
  Gauge,
  KeyRound,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Logs,
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
  Settings2,
  Shield,
  Store,
  Target,
  Tags,
  Warehouse,
  TrendingDown,
  TrendingUp,
  Trophy,
  User,
  UserMinus,
  Users,
  Users2,
  Wallet,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  icon: any
  note?: string
  badge?: string
  badgeColor?: 'purple' | 'blue' | 'green' | 'red' | 'orange' | 'default'
  isNew?: boolean
}

export type NavSection = {
  id: string
  title: string
  subtitle: string
  accentColor: 'amber' | 'emerald' | 'yellow' | 'blue' | 'fuchsia' | 'slate'
  icon: any
  items: NavItem[]
}

export const navSections: NavSection[] = [
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
      { href: '/expenses/pending', label: 'Ожидают одобрения', icon: ClipboardList, note: 'Расходы без чека на проверке', badgeColor: 'orange', isNew: true },
      { href: '/expense-whitelist', label: 'Доверенные поставщики', icon: Shield, note: 'Вендоры без чеков' },
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
      { href: '/store/warehouse', label: 'Склад', icon: Warehouse, note: 'Остатки на складе точки, добавление товара' },
      { href: '/store/showcase', label: 'Витрина', icon: Store, note: 'Остатки на витрине, заявки на пополнение' },
      { href: '/store/catalog', label: 'Каталог', icon: Tags, note: 'Товары, категории и поставщики' },
      { href: '/store/receipts', label: 'Приемка', icon: PackagePlus, note: 'Документы прихода на склад' },
      { href: '/store/requests', label: 'Заявки', icon: ClipboardList, note: 'Заявки точек и одобрение' },
      { href: '/store/requests-journal', label: 'Журнал заявок', icon: History, note: 'История всех заявок с переходами' },
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
      { href: '/hr', label: 'Кадры', icon: UserMinus, note: 'Увольнения и восстановление', isNew: true },
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
      { href: '/shifts/reports', label: 'Отчёты смен', icon: CalendarClock, note: 'Закрытые смены точек', badge: 'new', badgeColor: 'green' },
      { href: '/incidents', label: 'Инциденты', icon: ClipboardCheck, note: 'Штрафы, бонусы, заметки', badge: 'new', badgeColor: 'green' },
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
      { href: '/knowledge-admin', label: 'База знаний', icon: BookOpen, note: 'FAQ, правила и чек-листы', badge: 'new', badgeColor: 'green' },
      { href: '/telegram', label: 'Telegram Bot', icon: MessageSquareText, note: 'Уведомления и команды', badge: 'new', badgeColor: 'blue' },
      { href: '/point-devices', label: 'Точки и устройства', icon: Building2, note: 'Токены и программы точек' },
      { href: '/logs', label: 'Логирование', icon: Logs, note: 'Аудит, уведомления и события' },
      { href: '/debug', label: 'Диагностика', icon: Wrench, note: 'Проверки и отладка' },
    ],
  },
]

export function getSectionById(sectionId: string) {
  return navSections.find((section) => section.id === sectionId)
}

export function getSectionItem(sectionId: string, href: string) {
  return getSectionById(sectionId)?.items.find((item) => item.href === href)
}

export function buildOwnerNavSections(): NavSection[] {
  const commandSection = getSectionById('command')
  const financeSection = getSectionById('finance')
  const teamSection = getSectionById('team')
  const opsSection = getSectionById('ops')
  const pointDevicesItem = getSectionItem('system', '/point-devices')
  const operatorAnalyticsItem = getSectionItem('operator-space', '/operator-analytics')

  const sections: NavSection[] = []

  if (commandSection) sections.push(commandSection)
  if (financeSection) sections.push(financeSection)

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

export const badgeColors: Record<NonNullable<NavItem['badgeColor']>, string> = {
  purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  green: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  red: 'bg-red-500/10 text-red-400 border-red-500/20',
  orange: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  default: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
}

export const sectionStyles: Record<
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
