import {
  ArchiveX,
  Award,
  BarChart3,
  BookOpen,
  Brain,
  BrainCircuit,
  Briefcase,
  Building2,
  Boxes,
  Clapperboard,
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
  Activity,
  KeyRound,
  Landmark,
  LayoutDashboard,
  ListChecks,
  Logs,
  MessageSquareText,
  MessageSquare,
  Monitor,
  Network,
  Newspaper,
  Receipt,
  ShieldAlert,
  FileText,
  Package2,
  PackagePlus,
  PackageSearch,
  PieChart,
  Radar,
  RotateCcw,
  Settings2,
  Shield,
  ShoppingCart,
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
  ChefHat,
} from 'lucide-react'

export type NavItem = {
  href: string
  label: string
  icon: any
  note?: string
  badge?: string
  badgeColor?: 'purple' | 'blue' | 'green' | 'red' | 'orange' | 'default'
  isNew?: boolean
  /** Код фичи (company_features). Если задан и у орг его нет — пункт скрыт
   *  (кроме allAccess: супер-админ / F16-legacy / орг без entitlements). */
  feature?: string
}

export type NavSection = {
  id: string
  title: string
  subtitle: string
  accentColor: 'amber' | 'emerald' | 'yellow' | 'blue' | 'fuchsia' | 'slate'
  icon: any
  items: NavItem[]
  /** Если задано — клик по заголовку секции в верхнем меню сразу переходит сюда (а не только открывает дропдаун). */
  homeHref?: string
  /** Код фичи (company_features). Если задан и у орг его нет — секция скрыта целиком. */
  feature?: string
  /** Любая из фич (any-of). Если задано и у орг нет НИ ОДНОЙ — секция скрыта. */
  featuresAny?: string[]
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
      { href: '/business-intelligence', label: 'Бизнес-аналитика', icon: Brain, note: 'Формулы Amazon/Six Sigma на твоих данных', badge: 'new', badgeColor: 'purple', isNew: true },
      { href: '/ai-cfo', label: 'AI Финдиректор', icon: Briefcase, note: 'Карточки: вывод → причина → действие', badge: 'AI', badgeColor: 'purple', isNew: true, feature: 'ai.cfo' },
      { href: '/goals', label: 'Цели и план', icon: Target, note: 'Плановые показатели', badge: 'new', badgeColor: 'blue' },
      { href: '/reports', label: 'Отчеты', icon: BarChart3, note: 'Сводные метрики' },
      { href: '/weekly-report', label: 'Недельный отчет', icon: CalendarRange, note: 'Ритм недели' },
      { href: '/cashflow', label: 'Cash Flow', icon: Wallet, note: 'Движение денег и баланс', badge: 'AI', badgeColor: 'blue', isNew: true },
      { href: '/profitability', label: 'ОПиУ и EBITDA', icon: Calculator, note: 'Полная прибыль и комиссии POS' },
      { href: '/valuation', label: 'Оценка бизнеса', icon: Landmark, note: 'EBITDA × мультипликатор для инвестора', badge: 'new', badgeColor: 'blue', isNew: true },
      { href: '/branch-plan', label: 'Финмодель новой точки', icon: Building2, note: 'CAPEX, OPEX, выручка, окупаемость', badge: 'new', badgeColor: 'blue', isNew: true },
      { href: '/tax', label: 'Налоги', icon: Landmark, note: '3% и контроль базы' },
      { href: '/analytics', label: 'Аналитика доходов', icon: BarChart3, note: 'Сравнение точек и тренды' },
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
      { href: '/expenses', label: 'Расходы', icon: TrendingDown, note: 'Списания и статьи' },
      { href: '/expense-analysis', label: 'AI Разбор расходов', icon: Wallet, note: 'Где утекают деньги', badge: 'AI', badgeColor: 'purple', isNew: true },
      { href: '/expenses/pending', label: 'Ожидают одобрения', icon: ClipboardList, note: 'Расходы без чека на проверке', badgeColor: 'orange', isNew: true },
      { href: '/expense-whitelist', label: 'Доверенные поставщики', icon: Shield, note: 'Вендоры без чеков' },
      { href: '/categories', label: 'Категории', icon: Tags, note: 'Структура расходов' },
    ],
  },
  {
    id: 'store',
    title: 'Магазин',
    subtitle: 'Склад, витрины и движение товара',
    accentColor: 'emerald',
    icon: Boxes,
    homeHref: '/store/sales',
    feature: 'shop.catalog',
    items: [
      { href: '/store', label: 'Обзор магазина', icon: Boxes, note: 'Общая сводка по складу и витринам' },
      { href: '/store/stock', label: 'Склад', icon: Warehouse, note: 'Склад, витрина, движения, каталог' },
      { href: '/store/documents', label: 'Документы', icon: FileText, note: 'Приёмка, оприходование, списания, ревизия' },
      { href: '/store/orders', label: 'Заявки', icon: ClipboardList, note: 'Заявки точек, журнал, заказы поставщикам' },
      { href: '/store/purchase-plan', label: 'План закупа', icon: ShoppingCart, note: 'Сколько закупить на след. неделю — по продажам и остаткам', badge: 'new', badgeColor: 'green', isNew: true },
      { href: '/store/vendors', label: 'Поставщики', icon: Building2, note: 'Поставщики, долги, накладные, расходники' },
      { href: '/store/sales', label: 'Аналитика', icon: Activity, note: 'Монитор продаж, товары, ABC, прогноз', badge: 'live', badgeColor: 'green', isNew: true },
      { href: '/store/cashbox', label: 'Касса', icon: Receipt, note: 'Чеки, возвраты, реклама на экране' },
      { href: '/pos', label: 'Web POS', icon: Monitor, note: 'Веб-касса для планшета и браузера' },
      { href: '/store/clients', label: 'Клиенты', icon: Users2, note: 'Клиенты, лояльность, скидки и промокоды' },
      { href: '/store/receipt-settings', label: 'Реквизиты чека ККМ', icon: Receipt, note: 'Налогоплательщик, ККМ, ОФД, НДС — приказ МФ РК №626' },
    ],
  },
  {
    id: 'team',
    title: 'Команда и зарплаты',
    subtitle: 'Люди, структура и начисления',
    accentColor: 'yellow',
    icon: Users,
    featuresAny: ['club.pos', 'shop.catalog', 'service.jobs', 'restaurant.recipes_lite'],
    items: [
      { href: '/team-analysis', label: 'AI Разбор команды', icon: Users, note: 'Кто звезда, кто проседает', badge: 'AI', badgeColor: 'purple', isNew: true },
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
    featuresAny: ['club.pos', 'shop.catalog', 'service.jobs', 'restaurant.recipes_lite'],
    items: [
      { href: '/production', label: 'Техкарты', icon: ChefHat, note: 'Рецептуры и food cost (ресторан)', feature: 'restaurant.recipes_lite', badge: 'new', badgeColor: 'green', isNew: true },
      { href: '/simulation', label: 'Симуляция выручки', icon: Calculator, note: 'Потенциал по зонам vs факт', badge: 'new', badgeColor: 'blue', isNew: true },
      { href: '/tasks', label: 'Задачи', icon: FolderKanban, note: 'Текущая работа', badge: '12', badgeColor: 'red' },
      { href: '/shifts', label: 'Смены', icon: CalendarClock, note: 'График и сменность' },
      { href: '/shifts/reports', label: 'Отчёты смен', icon: CalendarClock, note: 'Закрытые смены точек', badge: 'new', badgeColor: 'green' },
      { href: '/incidents', label: 'Инциденты', icon: ClipboardCheck, note: 'Штрафы, бонусы, заметки', badge: 'new', badgeColor: 'green' },
      { href: '/birthdays', label: 'Дни рождения', icon: CalendarDays, note: 'Кто скоро отмечает' },
    ],
  },
  {
    id: 'team-space',
    title: 'Команда',
    subtitle: 'Чат, лента, календарь, аналитика',
    accentColor: 'fuchsia',
    icon: MessageSquare,
    items: [
      // Коммуникация
      { href: '/news', label: 'Лента', icon: Newspaper, note: 'Объявления и новости компании', isNew: true },
      { href: '/team-chat', label: 'Командный чат', icon: MessageSquare, note: 'Общий чат + закрепления + опросы', isNew: true },
      { href: '/messages', label: 'Личные сообщения', icon: MessageSquareText, note: 'DM с коллегами', isNew: true },
      { href: '/calendar', label: 'Календарь', icon: CalendarDays, note: 'Смены, ДР, праздники РК', isNew: true },
      { href: '/moderation', label: 'Модерация ИИ', icon: ShieldAlert, note: 'Флаги нарушений в чате', isNew: true },
      // Аналитика операторов
      { href: '/operator-analytics', label: 'Аналитика операторов', icon: Zap, note: 'Эффективность по людям' },
      { href: '/performance', label: 'Эффективность (PI)', icon: TrendingUp, note: 'Справедливый рейтинг с поправкой на слот', badge: 'new', badgeColor: 'green' },
      { href: '/ratings', label: 'Рейтинг операторов', icon: Trophy, note: 'Лидерборд по выручке' },
      { href: '/operator-achievements', label: 'Достижения операторов', icon: Award, note: 'Кто что получил, прогресс' },
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
      { href: '/subscription', label: 'Подписка', icon: CreditCard, note: 'Тариф, модули и счета' },
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

// Базовые страницы — всегда доступны в ЛЮБОМ пакете (не гейтятся, не продаются).
// Ядро, без которого кабинет бессмысленен.
export const BASE_FREE_PATHS = new Set<string>([
  '/dashboard',
  '/welcome',
  '/profile',
  '/settings',
  '/access',
  '/subscription',
  '/notifications',
  '/workspace',
  '/pass',
])

// Модель «1 фича = 1 страница»: код фичи страницы = явный feature ИЛИ derived `page:<href>`.
function pageFeatureCode(item: NavItem, section: NavSection): string {
  return item.feature || section.feature || `page:${item.href}`
}

/** Код фичи (тариф), требуемый для пути. null = страница базовая/не гейтится. */
export function getPathFeature(pathname: string): string | null {
  const clean = pathname.split('?')[0]
  for (const section of navSections) {
    for (const item of section.items) {
      if (clean === item.href || clean.startsWith(item.href + '/')) {
        if (BASE_FREE_PATHS.has(item.href)) return null
        return pageFeatureCode(item, section)
      }
    }
  }
  if (clean === '/store' || clean.startsWith('/store/')) {
    return navSections.find((s) => s.id === 'store')?.feature || 'page:/store'
  }
  return null
}

export type PageFeatureEntry = { path: string; label: string; feature: string; group: string; base: boolean }

/**
 * Каталог «страница → фича» для конструктора пакетов: ВСЕ страницы навигации
 * с их фичами, сгруппированы по разделу. base=true — всегда бесплатна.
 */
export function getAllPageFeatures(): PageFeatureEntry[] {
  const out: PageFeatureEntry[] = []
  const seen = new Set<string>()
  for (const section of navSections) {
    for (const item of section.items) {
      if (seen.has(item.href)) continue
      seen.add(item.href)
      out.push({
        path: item.href,
        label: item.label,
        feature: pageFeatureCode(item, section),
        group: section.title,
        base: BASE_FREE_PATHS.has(item.href),
      })
    }
  }
  return out
}

export function buildOwnerNavSections(): NavSection[] {
  const commandSection = getSectionById('command')
  const financeSection = getSectionById('finance')
  const storeSection = getSectionById('store')
  const teamSection = getSectionById('team')
  const opsSection = getSectionById('ops')
  const pointDevicesItem = getSectionItem('system', '/point-devices')
  const operatorAnalyticsItem = getSectionItem('operator-space', '/operator-analytics')
  const subscriptionItem = getSectionItem('system', '/subscription')
  const settingsItem = getSectionItem('system', '/settings')

  const sections: NavSection[] = []

  if (commandSection) sections.push(commandSection)
  if (financeSection) sections.push(financeSection)
  // «Магазин» — гейтится по shop.catalog (виден только если пакет/орг его даёт).
  if (storeSection) sections.push(storeSection)

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

  if (settingsItem) {
    sections.push({
      id: 'owner-system',
      title: 'Настройки',
      subtitle: 'Точки, компании и справочники',
      accentColor: 'slate',
      icon: Settings2,
      items: settingsItem ? [settingsItem] : [],
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

  if (subscriptionItem) {
    sections.push({
      id: 'owner-billing',
      title: 'Подписка',
      subtitle: 'Тариф, модули и счета',
      accentColor: 'slate',
      icon: CreditCard,
      items: [subscriptionItem],
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
