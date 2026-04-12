import { Suspense } from 'react'

import { ClientShellNav } from '@/app/(client)/client-shell-nav'

export default function ClientShellLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-4 py-6 sm:px-6 sm:py-8">
        <header className="rounded-2xl border border-border/60 bg-card/60 p-4 shadow-sm backdrop-blur">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Orda Client</p>
          <h1 className="mt-1 text-lg font-semibold">Личный кабинет гостя</h1>
          <Suspense fallback={<nav className="mt-4 h-9" aria-hidden />}>
            <ClientShellNav />
          </Suspense>
        </header>

        <main className="mt-4 flex-1 rounded-2xl border border-border/60 bg-card/40 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
