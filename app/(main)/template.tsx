'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'

// ViewTransition доступен из React-канала, который Next подключает при
// experimental.viewTransition. Если экспорта нет (флаг выключен/другая сборка) —
// рендерим детей как есть, работает фолбэк-фейд .orda-main-enter из globals.css.
const ViewTransition: React.ComponentType<{ children: React.ReactNode }> =
  (React as any).ViewTransition ?? (({ children }: { children: React.ReactNode }) => <>{children}</>)

export default function MainTemplate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <ViewTransition>
      <div key={pathname} className="min-h-0 orda-main-enter">
        {children}
      </div>
    </ViewTransition>
  )
}
