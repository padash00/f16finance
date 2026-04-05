'use client'

import { useMemo } from 'react'
import { MessageSquareText } from 'lucide-react'
import { usePathname } from 'next/navigation'

import { AssistantPanel } from '@/components/ai/assistant-panel'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import type { PageSnapshot } from '@/lib/ai/types'

const HIDDEN_PATH_PREFIXES = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/set-password',
  '/auth',
  '/setup-required',
  '/unauthorized',
]

function isOperatorCabinetPath(pathname: string) {
  return pathname === '/operator' || pathname.startsWith('/operator/')
}

export function GlobalAssistant() {
  const pathname = usePathname()

  const shouldHide =
    isOperatorCabinetPath(pathname || '') ||
    HIDDEN_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix + '/'))

  const snapshot = useMemo<PageSnapshot>(
    () => ({
      page: 'global',
      title: 'Глобальный контекст',
      generatedAt: new Date().toISOString(),
      route: pathname || '/',
      summary: [`Пользователь сейчас находится на маршруте ${pathname || '/'}.`],
      sections: [],
    }),
    [pathname],
  )

  if (shouldHide) return null

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          className="fixed bottom-5 right-5 z-40 rounded-full bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-6 text-black shadow-[0_20px_45px_rgba(251,146,60,0.25)] hover:from-amber-400 hover:to-orange-400"
        >
          <MessageSquareText className="mr-2 h-4 w-4" />
          AI-консультант
        </Button>
      </SheetTrigger>
      <SheetContent
        side="right"
        className="w-full border-white/10 bg-slate-950 px-0 sm:max-w-[520px]"
      >
        <SheetHeader className="border-b border-white/8 pb-4">
          <SheetTitle className="text-white">Глобальный AI-консультант</SheetTitle>
          <SheetDescription className="text-slate-400">
            Понимает структуру сайта, использует безопасные срезы данных по страницам и помогает как финансовый советник.
          </SheetDescription>
        </SheetHeader>

        <div className="p-4">
          <AssistantPanel
            page="global"
            title="Консультант по сайту"
            subtitle="Можно спросить, где искать проблему, какую страницу открыть дальше и какие решения дадут эффект."
            snapshot={snapshot}
            suggestedPrompts={[
              'Что мне проверить на сайте в первую очередь?',
              'На какой странице искать главный финансовый риск?',
              'Составь маршрут проверки бизнеса по разделам сайта',
            ]}
            className="border-0 bg-transparent shadow-none"
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
