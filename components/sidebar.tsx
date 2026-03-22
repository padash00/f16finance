'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { canAccessPath, type StaffRole } from '@/lib/core/access'
import { cn } from '@/lib/utils'
import {
  ArchiveX,
  BarChart3,
  BrainCircuit,
  Briefcase,
  Building2,
  Boxes,
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
  Network,
  Package2,
  PackagePlus,
  PieChart,
  Radar,
  ScanSearch,
  Search,
  Settings2,
  Shield,
  Sparkles,
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

import { Button } from '@/components/ui/button'

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
    title: 'Р¦РµРЅС‚СЂ СѓРїСЂР°РІР»РµРЅРёСЏ',
    subtitle: 'Р“Р»Р°РІРЅС‹Рµ СЌРєСЂР°РЅС‹ Рё СЃРІРѕРґРєР°',
    accentColor: 'amber',
    icon: Gauge,
    items: [
      { href: '/dashboard', label: 'Р“Р»Р°РІРЅР°СЏ РїР°РЅРµР»СЊ', icon: LayoutDashboard, note: 'РћР±С‰РёР№ СЃС‚Р°С‚СѓСЃ Р±РёР·РЅРµСЃР°' },
      { href: '/analysis', label: 'AI Р Р°Р·Р±РѕСЂ', icon: BrainCircuit, note: 'Р”РёР°РіРЅРѕСЃС‚РёРєР° Рё РІС‹РІРѕРґС‹', badge: 'AI', badgeColor: 'purple', isNew: true },
      { href: '/forecast', label: 'AI РџСЂРѕРіРЅРѕР·', icon: Radar, note: 'РџСЂРѕРіРЅРѕР· 30/60/90 РґРЅРµР№', badge: 'AI', badgeColor: 'purple', isNew: true },
      { href: '/goals', label: 'Р¦РµР»Рё Рё РїР»Р°РЅ', icon: Target, note: 'РџР»Р°РЅРѕРІС‹Рµ РїРѕРєР°Р·Р°С‚РµР»Рё', badge: 'new', badgeColor: 'blue' },
      { href: '/reports', label: 'РћС‚С‡С‘С‚С‹', icon: BarChart3, note: 'РЎРІРѕРґРЅС‹Рµ РјРµС‚СЂРёРєРё' },
      { href: '/weekly-report', label: 'РќРµРґРµР»СЊРЅС‹Р№ РѕС‚С‡С‘С‚', icon: CalendarRange, note: 'Р РёС‚Рј РЅРµРґРµР»Рё' },
    ],
  },
  {
    id: 'finance',
    title: 'Р”РµРЅСЊРіРё',
    subtitle: 'РџРѕС‚РѕРєРё, СЂР°СЃС…РѕРґС‹ Рё РЅР°Р»РѕРіРё',
    accentColor: 'emerald',
    icon: PieChart,
    items: [
      { href: '/income', label: 'Р”РѕС…РѕРґС‹', icon: TrendingUp, note: 'РћР±РѕСЂРѕС‚ Рё РІС‹СЂСѓС‡РєР°', badge: 'в†‘23%', badgeColor: 'green' },
      { href: '/analytics', label: 'РђРЅР°Р»РёС‚РёРєР° РґРѕС…РѕРґРѕРІ', icon: BarChart3, note: 'РЎСЂР°РІРЅРµРЅРёРµ С‚РѕС‡РµРє Рё С‚СЂРµРЅРґС‹' },
      { href: '/expenses', label: 'Р Р°СЃС…РѕРґС‹', icon: TrendingDown, note: 'РЎРїРёСЃР°РЅРёСЏ Рё СЃС‚Р°С‚СЊРё' },
      { href: '/inventory', label: 'РЎРєР»Р°Рґ', icon: Boxes, note: 'РџСЂРёРµРјРєР°, Р·Р°СЏРІРєРё Рё РѕСЃС‚Р°С‚РєРё' },
      { href: '/cashflow', label: 'Cash Flow', icon: Wallet, note: 'Р”РІРёР¶РµРЅРёРµ РґРµРЅРµРі Рё Р±Р°Р»Р°РЅСЃ', badge: 'AI', badgeColor: 'blue', isNew: true },
      { href: '/categories', label: 'РљР°С‚РµРіРѕСЂРёРё', icon: Tags, note: 'РЎС‚СЂСѓРєС‚СѓСЂР° СЂР°СЃС…РѕРґРѕРІ' },
      { href: '/tax', label: 'РќР°Р»РѕРіРё', icon: Landmark, note: '3% Рё РєРѕРЅС‚СЂРѕР»СЊ Р±Р°Р·С‹' },
      { href: '/profitability', label: 'РћРџРёРЈ Рё EBITDA', icon: Calculator, note: 'РџРѕР»РЅР°СЏ РїСЂРёР±С‹Р»СЊ Рё РєРѕРјРёСЃСЃРёРё POS' },
    ],
  },
  {
    id: 'store',
    title: 'РњР°РіР°Р·РёРЅ',
    subtitle: 'РЎРєР»Р°Рґ, РІРёС‚СЂРёРЅС‹ Рё РґРІРёР¶РµРЅРёРµ С‚РѕРІР°СЂР°',
    accentColor: 'emerald',
    icon: Boxes,
    items: [
      { href: '/inventory', label: 'РћР±Р·РѕСЂ РјР°РіР°Р·РёРЅР°', icon: Boxes, note: 'РћР±С‰Р°СЏ СЃРІРѕРґРєР° РїРѕ СЃРєР»Р°РґСѓ Рё РІРёС‚СЂРёРЅР°Рј' },
      { href: '/store/catalog', label: 'РљР°С‚Р°Р»РѕРі', icon: Tags, note: 'РўРѕРІР°СЂС‹, РєР°С‚РµРіРѕСЂРёРё Рё РїРѕСЃС‚Р°РІС‰РёРєРё' },
      { href: '/store/receipts', label: 'РџСЂРёРµРјРєР°', icon: PackagePlus, note: 'Р”РѕРєСѓРјРµРЅС‚С‹ РїСЂРёС…РѕРґР° РЅР° СЃРєР»Р°Рґ' },
      { href: '/store/requests', label: 'Р—Р°СЏРІРєРё', icon: ClipboardList, note: 'Р—Р°СЏРІРєРё С‚РѕС‡РµРє Рё РѕРґРѕР±СЂРµРЅРёРµ' },
      { href: '/store/analytics', label: 'РђРЅР°Р»РёС‚РёРєР° С‚РѕС‡РµРє', icon: Store, note: 'РћСЃС‚Р°С‚РєРё Рё РґРІРёР¶РµРЅРёРµ РїРѕ РІРёС‚СЂРёРЅР°Рј' },
      { href: '/store/consumables', label: 'Р Р°СЃС…РѕРґРЅРёРєРё', icon: Package2, note: 'РќРѕСЂРјС‹ Рё РєРѕРЅС‚СЂРѕР»СЊ РѕСЃС‚Р°С‚РєРѕРІ' },
      { href: '/store/writeoffs', label: 'РЎРїРёСЃР°РЅРёСЏ', icon: ArchiveX, note: 'Р‘СЂР°Рє Рё СЃР»СѓР¶РµР±РЅС‹Рµ СЂР°СЃС…РѕРґС‹' },
      { href: '/store/revisions', label: 'РРЅРІРµРЅС‚Р°СЂРёР·Р°С†РёСЏ', icon: ScanSearch, note: 'РџРµСЂРµСЃС‡РµС‚ Рё РєРѕСЂСЂРµРєС‚РёСЂРѕРІРєРё' },
      { href: '/store/movements', label: 'Р”РІРёР¶РµРЅРёСЏ', icon: History, note: 'Р–СѓСЂРЅР°Р» С‚РѕРІР°СЂРЅС‹С… РѕРїРµСЂР°С†РёР№' },
    ],
  },
  {
    id: 'team',
    title: 'РљРѕРјР°РЅРґР° Рё Р·Р°СЂРїР»Р°С‚С‹',
    subtitle: 'Р›СЋРґРё, СЃС‚СЂСѓРєС‚СѓСЂР° Рё РЅР°С‡РёСЃР»РµРЅРёСЏ',
    accentColor: 'yellow',
    icon: Users,
    items: [
      { href: '/salary', label: 'Р—Р°СЂРїР»Р°С‚Р°', icon: Wallet, note: 'Р Р°СЃС‡С‘С‚С‹ Рё РІС‹РїР»Р°С‚С‹' },
      { href: '/salary/rules', label: 'РџСЂР°РІРёР»Р° Р·Р°СЂРїР»Р°С‚С‹', icon: ListChecks, note: 'РЎС‚Р°РІРєРё Рё Р±РѕРЅСѓСЃС‹' },
      { href: '/operators', label: 'РћРїРµСЂР°С‚РѕСЂС‹', icon: Users2, note: 'РџСЂРѕС„РёР»Рё Рё СЃРѕСЃС‚РѕСЏРЅРёРµ', badge: '8', badgeColor: 'blue' },
      { href: '/structure', label: 'РЎС‚СЂСѓРєС‚СѓСЂР°', icon: Network, note: 'РРµСЂР°СЂС…РёСЏ РєРѕРјР°РЅРґС‹ Рё С‚РѕС‡РµРє' },
      { href: '/staff', label: 'РЎРѕС‚СЂСѓРґРЅРёРєРё', icon: Users, note: 'РђРґРјРёРЅРєРѕРјР°РЅРґР°' },
      { href: '/pass', label: 'Р”РѕСЃС‚СѓРїС‹', icon: KeyRound, note: 'РЈС‡С‘С‚РЅС‹Рµ Р·Р°РїРёСЃРё' },
    ],
  },
  {
    id: 'ops',
    title: 'РћРїРµСЂР°С†РёРѕРЅРЅР°СЏ СЂР°Р±РѕС‚Р°',
    subtitle: 'РџР»Р°РЅС‹, Р·Р°РґР°С‡Рё Рё СЂРёС‚Рј',
    accentColor: 'blue',
    icon: Workflow,
    items: [
      { href: '/kpi', label: 'KPI', icon: Target, note: 'РљРѕРЅС‚СЂРѕР»СЊ РІС‹РїРѕР»РЅРµРЅРёСЏ' },
      { href: '/kpi/plans', label: 'РџР»Р°РЅС‹ KPI', icon: Radar, note: 'РџР»Р°РЅ-С„Р°РєС‚', badge: 'new', badgeColor: 'green' },
      { href: '/tasks', label: 'Р—Р°РґР°С‡Рё', icon: FolderKanban, note: 'РўРµРєСѓС‰Р°СЏ СЂР°Р±РѕС‚Р°', badge: '12', badgeColor: 'red' },
      { href: '/shifts', label: 'РЎРјРµРЅС‹', icon: CalendarClock, note: 'Р“СЂР°С„РёРє Рё СЃРјРµРЅРЅРѕСЃС‚СЊ' },
      { href: '/birthdays', label: 'Р”РЅРё СЂРѕР¶РґРµРЅРёСЏ', icon: CalendarDays, note: 'РљС‚Рѕ СЃРєРѕСЂРѕ РѕС‚РјРµС‡Р°РµС‚' },
    ],
  },
  {
    id: 'operator-space',
    title: 'РћРїРµСЂР°С‚РѕСЂСЃРєРѕРµ РїСЂРѕСЃС‚СЂР°РЅСЃС‚РІРѕ',
    subtitle: 'РљРѕРјРјСѓРЅРёРєР°С†РёСЏ Рё РјРѕС‚РёРІР°С†РёСЏ',
    accentColor: 'fuchsia',
    icon: Zap,
    items: [
      { href: '/operator-dashboard', label: 'РњРѕР№ РєР°Р±РёРЅРµС‚', icon: User, note: 'РЎРІРѕРґРєР° РѕРїРµСЂР°С‚РѕСЂР°' },
      { href: '/operator-lead', label: 'РњРѕСЏ С‚РѕС‡РєР°', icon: Building2, note: 'РљРѕРјР°РЅРґР° Рё СЃРїРѕСЂРЅС‹Рµ СЃРјРµРЅС‹ С‚РѕС‡РєРё', badge: 'lead', badgeColor: 'orange' },
      { href: '/operator-tasks', label: 'РњРѕРё Р·Р°РґР°С‡Рё', icon: ClipboardCheck, note: 'Р›РёС‡РЅС‹Р№ РєРѕРЅС‚СѓСЂ Р·Р°РґР°С‡', badge: '3', badgeColor: 'orange' },
      { href: '/ratings', label: 'Р РµР№С‚РёРЅРі РѕРїРµСЂР°С‚РѕСЂРѕРІ', icon: Trophy, note: 'Р›РёРґРµСЂР±РѕСЂРґ РїРѕ РІС‹СЂСѓС‡РєРµ', badge: 'new', badgeColor: 'orange', isNew: true },
      { href: '/operator-analytics', label: 'РђРЅР°Р»РёС‚РёРєР° РѕРїРµСЂР°С‚РѕСЂРѕРІ', icon: Zap, note: 'Р­С„С„РµРєС‚РёРІРЅРѕСЃС‚СЊ РїРѕ Р»СЋРґСЏРј' },
      { href: '/operator-chat', label: 'Р§Р°С‚ РѕРїРµСЂР°С‚РѕСЂРѕРІ', icon: MessageSquareText, note: 'РљРѕРјРјСѓРЅРёРєР°С†РёСЏ', badge: 'live', badgeColor: 'green' },
      { href: '/operator-achievements', label: 'Р”РѕСЃС‚РёР¶РµРЅРёСЏ', icon: Trophy, note: 'РњРѕС‚РёРІР°С†РёСЏ Рё XP', badge: 'XP', badgeColor: 'purple' },
      { href: '/operator-settings', label: 'РќР°СЃС‚СЂРѕР№РєРё РѕРїРµСЂР°С‚РѕСЂРѕРІ', icon: Briefcase, note: 'РџСЂРѕС„РёР»СЊРЅС‹Р№ РєРѕРЅС‚СѓСЂ' },
    ],
  },
  {
    id: 'system',
    title: 'РЎРёСЃС‚РµРјР°',
    subtitle: 'РќР°СЃС‚СЂРѕР№РєР° Рё РѕР±СЃР»СѓР¶РёРІР°РЅРёРµ',
    accentColor: 'slate',
    icon: Shield,
    items: [
      { href: '/settings', label: 'РќР°СЃС‚СЂРѕР№РєРё СЃРёСЃС‚РµРјС‹', icon: Settings2, note: 'РљРѕРјРїР°РЅРёРё Рё СЃРїСЂР°РІРѕС‡РЅРёРєРё' },
      { href: '/access', label: 'РџСЂР°РІР° Рё РїР°СЂРѕР»Рё', icon: Shield, note: 'Р”РѕСЃС‚СѓРї СЂРѕР»РµР№ Рё Р°РєРєР°СѓРЅС‚С‹' },
      { href: '/telegram', label: 'Telegram Bot', icon: MessageSquareText, note: 'РЈРІРµРґРѕРјР»РµРЅРёСЏ Рё РєРѕРјР°РЅРґС‹', badge: 'new', badgeColor: 'blue' },
      { href: '/point-devices', label: 'РўРѕС‡РєРё Рё СѓСЃС‚СЂРѕР№СЃС‚РІР°', icon: Building2, note: 'РўРѕРєРµРЅС‹ Рё РїСЂРѕРіСЂР°РјРјС‹ С‚РѕС‡РµРє' },
      { href: '/logs', label: 'Р›РѕРіРёСЂРѕРІР°РЅРёРµ', icon: Logs, note: 'РђСѓРґРёС‚, СѓРІРµРґРѕРјР»РµРЅРёСЏ Рё СЃРѕР±С‹С‚РёСЏ' },
      { href: '/debug', label: 'Р”РёР°РіРЅРѕСЃС‚РёРєР°', icon: Wrench, note: 'РџСЂРѕРІРµСЂРєРё Рё РѕС‚Р»Р°РґРєР°' },
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
      title: 'РђРЅР°Р»РёС‚РёРєР° РѕРїРµСЂР°С‚РѕСЂРѕРІ',
      subtitle: 'Р­С„С„РµРєС‚РёРІРЅРѕСЃС‚СЊ, РєР°С‡РµСЃС‚РІРѕ Рё РґРёРЅР°РјРёРєР° РїРѕ Р»СЋРґСЏРј',
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

function LogoMark() {
  return (
    <div className="relative group">
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 blur-lg opacity-50 transition-opacity duration-500 group-hover:opacity-80" />
      <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-800 shadow-2xl">
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-white/10 to-transparent" />
        <Sparkles className="relative z-10 h-5 w-5 text-amber-300" />
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

        <div className={cn('mt-3 space-y-1 overflow-hidden transition-all duration-300', open ? 'max-h-[48rem] opacity-100' : 'max-h-0 opacity-0')}>
          {section.items.map((item) => {
            const active =
              item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(item.href + '/')
            return <SidebarItem key={item.href} item={item} active={active} onClick={onNavigate} />
          })}
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
            <p className="truncate text-sm font-semibold text-white">{displayName || 'РџР°РЅРµР»СЊ СѓРїСЂР°РІР»РµРЅРёСЏ'}</p>
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
            Р’С‹Р№С‚Рё
          </span>
          <ChevronRight className="h-4 w-4" />
        </Button>
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
          placeholder="РџРѕРёСЃРє РїРѕ РјРµРЅСЋ..."
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
  const [isStaff, setIsStaff] = useState(false)
  const [isOperator, setIsOperator] = useState(false)
  const [isLeadOperator, setIsLeadOperator] = useState(false)
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
        setIsStaff(!!json?.isStaff)
        setIsOperator(!!json?.isOperator)
        setIsLeadOperator(!!json?.isLeadOperator)
        setStaffRole((json?.staffRole as StaffRole | null) || null)
        setDisplayName((json?.displayName as string | null) || null)
        setRoleLabel((json?.roleLabel as string | null) || null)
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
          .map((item) => {
            if (section.id === 'store') {
              const hrefMap: Record<string, string> = {
                '/inventory': '/store',
                '/inventory/catalog': '/store/catalog',
                '/inventory/receipts': '/store/receipts',
                '/inventory/requests': '/store/requests',
                '/inventory/analytics': '/store/analytics',
                '/inventory/consumables': '/store/consumables',
                '/inventory/writeoffs': '/store/writeoffs',
                '/inventory/stocktakes': '/store/revisions',
                '/inventory/movements': '/store/movements',
                '/inventory/revisions': '/store/revisions',
              }

              if (item.href === '/inventory/stocktakes' || item.href === '/inventory/revisions') {
                return {
                  ...item,
                  href: '/store/revisions',
                  label: 'Ревизия',
                  note: 'Полная проверка склада и витрин',
                }
              }

              if (hrefMap[item.href]) {
                return {
                  ...item,
                  href: hrefMap[item.href],
                }
              }
            }
            return item
          })
          .filter((item) => {
            if (section.id === 'finance' && item.href === '/inventory') {
              return false
            }
            if (item.href === '/operator-lead' && !isLeadOperator) {
              return false
            }
            return canAccessPath({
              pathname: item.href,
              isStaff,
              isOperator,
              staffRole,
              isSuperAdmin,
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
  }, [baseSections, isLeadOperator, isOperator, isStaff, isSuperAdmin, searchQuery, staffRole])

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

  const toggleSection = (sectionId: string) => {
    setOpenSections((prev) => ({ ...prev, [sectionId]: !prev[sectionId] }))
  }

  const navContent = (
    <div className="flex h-full flex-col bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 text-white">
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
        <div className="flex items-center gap-3">
          <LogoMark />
          <div>
            <h1 className="bg-gradient-to-r from-white to-slate-300 bg-clip-text text-lg font-bold text-transparent">
              Orda Control
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
          <SearchBar value={searchQuery} onChange={setSearchQuery} inputRef={searchInputRef} />
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
              РџРѕ Р·Р°РїСЂРѕСЃСѓ РЅРёС‡РµРіРѕ РЅРµ РЅР°Р№РґРµРЅРѕ.
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
          <LogoMark />
          <div>
            <p className="text-sm font-semibold text-white">Orda Control</p>
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
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={() => setIsOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[84%] max-w-[20rem] border-r border-white/5 shadow-2xl">
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

