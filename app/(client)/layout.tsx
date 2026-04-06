import Link from 'next/link'

const clientLinks = [
  { href: '/client', label: 'Главная' },
  { href: '/client/bookings', label: 'Брони' },
  { href: '/client/points', label: 'Баллы' },
  { href: '/client/support', label: 'Поддержка' },
] as const

export default function ClientShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-8">
        <header className="rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm backdrop-blur">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Orda Client</p>
          <h1 className="mt-1 text-lg font-semibold">Личный кабинет гостя</h1>
          <nav className="mt-4 flex flex-wrap gap-2">
            {clientLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full border border-border/70 bg-background px-3 py-1.5 text-sm text-foreground/90 transition hover:bg-accent hover:text-accent-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </header>

        <main className="mt-4 flex-1 rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
