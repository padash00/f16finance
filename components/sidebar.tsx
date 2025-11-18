'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
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
  Wallet,
  PieChart,
  Briefcase
} from 'lucide-react'
import { Button } from './ui/button'

// Группируем пункты меню
const menuGroups = [
  {
    title: 'Обзор',
    items: [
      { icon: LayoutDashboard, label: 'Dashboard', href: '/' },
    ]
  },
  {
    title: 'Финансы',
    items: [
      { icon: TrendingUp, label: 'Доходы', href: '/income' },
      { icon: TrendingDown, label: 'Расходы', href: '/expenses' },
      { icon: CalendarClock, label: 'Смены', href: '/shifts' },
    ]
  },
  {
    title: 'Аналитика',
    items: [
      { icon: BarChart3, label: 'Общие отчёты', href: '/reports' },
      { icon: CalendarRange, label: 'Недельный отчёт', href: '/weekly-report' },
    ]
  },
  {
    title: 'Система',
    items: [
      { icon: Tags, label: 'Категории', href: '/categories' },
      { icon: Settings, label: 'Настройки', href: '/settings' },
    ]
  }
]

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 bg-[#09090b] border-r border-white/10 h-screen sticky top-0 flex flex-col">
      {/* Логотип */}
      <div className="p-6 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-gradient-to-br from-purple-600 to-blue-600 rounded-lg flex items-center justify-center text-white font-bold shadow-[0_0_15px_rgba(124,58,237,0.5)]">
            F
          </div>
          <span className="text-xl font-bold text-white tracking-tight">
            F16 <span className="text-purple-500">Finance</span>
          </span>
        </div>
      </div>

      {/* Навигация с скроллом */}
      <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-6">
        {menuGroups.map((group, idx) => (
          <div key={idx}>
            <h3 className="px-4 text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-2">
              {group.title}
            </h3>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon
                const active = pathname === item.href

                return (
                  <Link key={item.href} href={item.href} className="block">
                    <div
                      className={`flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 group
                        ${
                          active
                            ? 'bg-purple-600 text-white shadow-[0_4px_20px_rgba(147,51,234,0.3)] font-medium'
                            : 'text-muted-foreground hover:bg-white/5 hover:text-white'
                        }`}
                    >
                      <Icon className={`w-4 h-4 transition-colors ${active ? 'text-white' : 'text-muted-foreground group-hover:text-white'}`} />
                      <span className="text-sm">{item.label}</span>
                      {active && (
                         <div className="ml-auto w-1.5 h-1.5 bg-white rounded-full shadow-[0_0_5px_white]" />
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Профиль пользователя (Футер) */}
      <div className="p-4 border-t border-white/10">
        <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition-colors">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-500 to-cyan-500 flex items-center justify-center text-white shadow-lg">
                <User className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">Администратор</p>
                <p className="text-[10px] text-muted-foreground truncate">admin@f16.kz</p>
            </div>
            <button className="text-muted-foreground hover:text-red-400 transition-colors">
                <LogOut className="w-4 h-4" />
            </button>
        </div>
      </div>
    </aside>
  )
}