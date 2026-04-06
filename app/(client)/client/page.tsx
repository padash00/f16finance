'use client'

import { useEffect, useState } from 'react'

type ClientMeResponse = {
  activeCustomer: {
    id: string
    name: string
    loyalty_points: number
    visits_count: number
  } | null
}

export default function ClientHomePage() {
  const [customer, setCustomer] = useState<ClientMeResponse['activeCustomer']>(null)

  useEffect(() => {
    fetch('/api/client/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: ClientMeResponse | null) => setCustomer(payload?.activeCustomer || null))
      .catch(() => null)
  }, [])

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Добро пожаловать</h2>
        <p className="text-sm text-muted-foreground">
          Это клиентский контур. Здесь вы можете управлять бронями, отслеживать баллы и отправлять
          обращения в поддержку.
        </p>
        {customer ? (
          <p className="text-sm text-foreground/90">
            Профиль: <span className="font-medium">{customer.name}</span> · Баллы: {customer.loyalty_points} · Визиты:{' '}
            {customer.visits_count}
          </p>
        ) : null}
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border/70 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Брони</p>
          <p className="mt-1 text-sm text-foreground">Просмотр и подтверждение своих визитов.</p>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Баллы</p>
          <p className="mt-1 text-sm text-foreground">Текущий баланс и история начислений.</p>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/70 p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Поддержка</p>
          <p className="mt-1 text-sm text-foreground">Канал связи с администратором клуба.</p>
        </div>
      </section>
    </div>
  )
}
