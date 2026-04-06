'use client'

import { usePathname } from 'next/navigation'

export default function MainTemplate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  return (
    <div key={pathname} className="min-h-0 orda-main-enter">
      {children}
    </div>
  )
}
