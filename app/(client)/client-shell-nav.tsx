'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

const clientLinks = [
  { href: '/client', label: 'Главная' },
  { href: '/client/bookings', label: 'Брони' },
  { href: '/client/points', label: 'Баллы' },
  { href: '/client/support', label: 'Поддержка' },
] as const

export function ClientShellNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const companyId = searchParams.get('companyId')?.trim()
  const suffix = companyId ? `?companyId=${encodeURIComponent(companyId)}` : ''

  return (
    <nav className="mt-4 flex flex-wrap gap-2">
      {clientLinks.map((item) => {
        const href = item.href === '/client' ? `/client${suffix}` : `${item.href}${suffix}`
        const active = pathname === item.href || (item.href !== '/client' && pathname.startsWith(item.href))
        return (
          <Link
            key={item.href}
            href={href}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              active
                ? 'border-foreground/40 bg-foreground text-background'
                : 'border-border/70 bg-background text-foreground/90 hover:bg-accent hover:text-accent-foreground'
            }`}
          >
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
