'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'
import { usePathname } from 'next/navigation'

import { CopilotPanel } from '@/components/ai/copilot-panel'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

const HIDDEN_PATH_PREFIXES = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/set-password',
  '/auth',
  '/setup-required',
  '/unauthorized',
  // Print/PDF-страницы — ассистент не должен попадать в выгрузку
  '/profitability/print',
  '/weekly-report/act-print',
  // Публичные маркетинговые страницы — AI-консультант там не нужен
  '/club-management-system',
  '/operator-salary-system',
  '/profit-and-loss-ebitda',
  '/point-terminal',
  '/offer',
  '/privacy',
  '/terms',
  '/sla',
  '/cookies',
]

// Главная (landing) страница тоже публичная — точное совпадение
const HIDDEN_EXACT_PATHS = new Set<string>(['/'])

function isOperatorCabinetPath(pathname: string) {
  return pathname === '/operator' || pathname.startsWith('/operator/')
}

export function GlobalAssistant() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)

  const shouldHide =
    isOperatorCabinetPath(pathname || '') ||
    HIDDEN_EXACT_PATHS.has(pathname || '') ||
    HIDDEN_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'))

  if (shouldHide) return null

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          className="fixed bottom-5 right-5 z-40 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-6 text-black shadow-[0_20px_45px_rgba(251,146,60,0.25)] hover:from-amber-400 hover:to-orange-400 group"
        >
          <Sparkles className="mr-2 h-4 w-4 transition group-hover:rotate-12" />
          AI Copilot
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full border-white/10 bg-slate-950 p-0 sm:max-w-[520px] flex flex-col"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>AI Copilot</SheetTitle>
        </SheetHeader>
        <CopilotPanel currentPath={pathname || '/'} className="h-full" />
      </SheetContent>
    </Sheet>
  )
}
