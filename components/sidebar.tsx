'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Tags,
  Settings,
  CalendarClock,
  CalendarRange,
  LogOut,
  User,
  Users,
  Menu,
  X,
  BrainCircuit,
  Landmark,
  ListChecks,
  Users2,
  ChevronRight,
  Sparkles,
  Wallet,
  PieChart,
  Target,
} from 'lucide-react'
import { Button } from './ui/button'

// --- Config ---
const menuGroups = [
  {
    title: 'Обзор',
    items: [
      { icon: LayoutDashboard, label: 'Дашборд', href: '/' },
      { icon: BrainCircuit, label: 'AI Аналитика', href: '/analysis', special: true },
    ],
  },
  {
    title: 'Финансы',
    items: [
      { icon: TrendingUp, label: 'Доходы', href: '/income' },
      { icon: TrendingDown, label: 'Расходы', href: '/expenses' },
      { icon: Landmark, label: 'Налоги 3%', href: '/tax' },
      { icon: CalendarClock, label: 'Зарплата', href: '/salary' },
    ],
  },
  {
    title: 'Аналитика',
    items: [
      { icon: PieChart, label: 'Общие отчёты', href: '/reports' },
      { icon: CalendarRange, label: 'Недельный отчёт', href: '/weekly-report' },
      { icon: Users2, label: 'Аналитика операторов', href: '/operator-analytics' },
    ],
  },
  {
    title: 'Система',
    items: [
      { icon: Tags, label: 'Категории', href: '/categories' },
      { icon: User, label: 'Операторы', href: '/operators' },
      { icon: Users, label: 'Сотрудники', href: '/staff' },
      { icon: ListChecks, label: 'Правила зарплаты', href: '/salary/rules' },
      { icon: Settings, label: 'Настройки', href: '/settings' },
    ],
  },
]

// --- Components ---

function Logo() {
  return (
    <div className="flex items-center gap-3 px-2">
      <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 shadow-lg shadow-purple-500/20">
        <Sparkles className="w-5 h-5 text-white" />
        <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/20" />
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-bold tracking-tight text-white">AI Finance</span>
        <span className="text-[10px] text-gray-500">Умная аналитика</span>
      </div>
    </div>
  )
}

function SidebarItem({ item, isActive, onClick }: { item: any; isActive: boolean; onClick?: () => void }) {
  const Icon = item.icon
  
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
        isActive 
          ? "bg-purple-500/20 text-white shadow-lg shadow-purple-500/10 border border-purple-500/30" 
          : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-100 border border-transparent",
        item.special && !isActive && "text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
      )}
    >
      <Icon 
        className={cn(
          "h-4 w-4 transition-colors",
          isActive ? "text-purple-400" : "text-gray-500 group-hover:text-gray-300",
          item.special && !isActive && "text-purple-500 group-hover:text-purple-400"
        )} 
      />
      <span className="flex-1">{item.label}</span>
      {isActive && <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
    </Link>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(href + '/')
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const NavContent = () => (
    <div className="flex flex-col h-full bg-gradient-to-b from-gray-900 to-gray-950">
      {/* Header */}
      <div className="flex h-16 items-center border-b border-gray-800 px-4">
        <Logo />
        <button 
          className="ml-auto md:hidden text-gray-400 hover:text-white transition-colors" 
          onClick={() => setIsOpen(false)}
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Menu Groups */}
      <div className="flex-1 overflow-y-auto py-6 px-3">
        <div className="space-y-6">
          {menuGroups.map((group, idx) => (
            <div key={idx}>
              <h3 className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                {group.title}
              </h3>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <SidebarItem 
                    key={item.href} 
                    item={item} 
                    isActive={isActive(item.href)} 
                    onClick={() => setIsOpen(false)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* User Footer */}
      <div className="border-t border-gray-800 p-4">
        <div className="flex items-center gap-3 rounded-xl bg-gray-800/30 border border-gray-700 p-3 transition-all hover:bg-gray-800/50 hover:border-gray-600">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-purple-500/20 to-indigo-500/20 border border-purple-500/30 text-purple-400">
            <User className="h-4 w-4" />
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-sm font-medium text-white">Администратор</p>
            <p className="truncate text-[10px] text-gray-500">admin@system.kz</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            className="h-8 w-8 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-all"
            title="Выйти"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Mobile Header */}
      <div className="fixed left-0 right-0 top-0 z-40 flex h-16 items-center justify-between border-b border-gray-800 bg-gray-900/80 px-4 backdrop-blur-md md:hidden">
        <Logo />
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={() => setIsOpen(true)} 
          className="text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg"
        >
          <Menu className="h-6 w-6" />
        </Button>
      </div>

      {/* Mobile Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div 
            className="absolute inset-0 bg-black/80 backdrop-blur-sm" 
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute bottom-0 left-0 top-0 w-[85%] max-w-xs border-r border-gray-800 bg-gradient-to-b from-gray-900 to-gray-950 shadow-2xl">
            <NavContent />
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden h-screen w-64 flex-col border-r border-gray-800 bg-gradient-to-b from-gray-900 to-gray-950 md:flex sticky top-0">
        <NavContent />
      </aside>
    </>
  )
}
