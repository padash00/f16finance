'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { cn } from '@/lib/utils' // Убедитесь, что у вас есть clsx и tailwind-merge
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
} from 'lucide-react'
import { Button } from './ui/button'

// --- Config ---
const menuGroups = [
  {
    title: 'Обзор',
    items: [
      { icon: LayoutDashboard, label: 'Dashboard', href: '/' },
      { icon: BrainCircuit, label: 'AI Советник', href: '/analysis', special: true },
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
      { icon: BarChart3, label: 'Общие отчёты', href: '/reports' },
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
      <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 shadow-lg shadow-emerald-500/20">
        <span className="font-bold text-white">F</span>
        <div className="absolute inset-0 rounded-lg ring-1 ring-inset ring-white/10" />
      </div>
      <div className="flex flex-col">
        <span className="text-sm font-bold tracking-tight text-white">F16 Finance</span>
        <span className="text-[10px] text-zinc-500">Система учета</span>
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
        "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200",
        isActive 
          ? "bg-zinc-800 text-white shadow-sm" 
          : "text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-100",
        item.special && !isActive && "text-purple-400 hover:text-purple-300"
      )}
    >
      <Icon 
        className={cn(
          "h-4 w-4 transition-colors",
          isActive ? "text-emerald-400" : "text-zinc-500 group-hover:text-zinc-300",
          item.special && "text-purple-500 group-hover:text-purple-400"
        )} 
      />
      <span className="flex-1">{item.label}</span>
      {isActive && <ChevronRight className="h-3 w-3 text-zinc-600 opacity-50" />}
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
    <div className="flex flex-col h-full bg-[#09090b]">
      {/* Header */}
      <div className="flex h-16 items-center border-b border-zinc-800 px-4">
        <Logo />
        <button 
          className="ml-auto md:hidden text-zinc-400" 
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
              <h3 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                {group.title}
              </h3>
              <div className="space-y-0.5">
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
      <div className="border-t border-zinc-800 p-4">
        <div className="flex items-center gap-3 rounded-xl bg-zinc-900/50 border border-zinc-800 p-3 transition-colors hover:bg-zinc-900">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 text-zinc-400">
            <User className="h-4 w-4" />
          </div>
          <div className="flex-1 overflow-hidden">
            <p className="truncate text-sm font-medium text-white">Администратор</p>
            <p className="truncate text-[10px] text-zinc-500">admin@f16.kz</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            className="h-8 w-8 text-zinc-500 hover:text-red-400 hover:bg-red-950/20"
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
      <div className="fixed left-0 right-0 top-0 z-40 flex h-16 items-center justify-between border-b border-zinc-800 bg-[#09090b]/80 px-4 backdrop-blur-md md:hidden">
        <Logo />
        <Button variant="ghost" size="icon" onClick={() => setIsOpen(true)} className="text-zinc-400 hover:text-white hover:bg-zinc-800">
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
          <div className="absolute bottom-0 left-0 top-0 w-[80%] max-w-xs border-r border-zinc-800 bg-[#09090b] shadow-2xl transition-transform duration-300">
            <NavContent />
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden h-screen w-64 flex-col border-r border-zinc-800 bg-[#09090b] md:flex sticky top-0">
        <NavContent />
      </aside>
    </>
  )
}
