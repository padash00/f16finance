'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

const GRID = 20

type ClientMeResponse = {
  customers?: { id: string; company_id: string | null; name: string; loyalty_points?: number; visits_count?: number }[]
  activeCustomer?: {
    id: string
    name: string
    loyalty_points: number
    visits_count: number
  } | null
}

type VenueCompany = { id: string; name: string }

type VenueProject = {
  id: string
  name: string
  companyIds: string[]
  zones: {
    id: string
    name?: string | null
    grid_x?: number | null
    grid_y?: number | null
    grid_w?: number | null
    grid_h?: number | null
    color?: string | null
    company_id?: string | null
  }[]
  stations: {
    id: string
    name?: string | null
    grid_x?: number | null
    grid_y?: number | null
    is_active?: boolean | null
    company_id?: string | null
  }[]
  decorations: {
    id: string
    type?: string | null
    grid_x?: number | null
    grid_y?: number | null
    grid_w?: number | null
    grid_h?: number | null
    label?: string | null
  }[]
}

type VenuePayload = {
  ok?: boolean
  companies?: VenueCompany[]
  projects?: VenueProject[]
  multiCompany?: boolean
  chooseCompany?: boolean
  error?: string
}

function inGrid(v: number | null | undefined) {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < GRID
}

export function ClientHomePage() {
  const searchParams = useSearchParams()
  const companyIdFromUrl = searchParams.get('companyId')?.trim() || ''

  const [me, setMe] = useState<ClientMeResponse | null>(null)
  const [venue, setVenue] = useState<VenuePayload | null>(null)
  const [venueError, setVenueError] = useState<string | null>(null)

  const linkedCompanyIds = useMemo(() => {
    const rows = me?.customers || []
    const ids = rows.map((r) => r.company_id?.trim()).filter((v): v is string => Boolean(v))
    return [...new Set(ids)]
  }, [me])

  const effectiveCompanyId =
    companyIdFromUrl && linkedCompanyIds.includes(companyIdFromUrl)
      ? companyIdFromUrl
      : linkedCompanyIds.length === 1
        ? linkedCompanyIds[0]
        : ''

  const bookingsHref = effectiveCompanyId
    ? `/client/bookings?companyId=${encodeURIComponent(effectiveCompanyId)}`
    : '/client/bookings'
  const pointsHref = effectiveCompanyId
    ? `/client/points?companyId=${encodeURIComponent(effectiveCompanyId)}`
    : '/client/points'
  const supportHref = effectiveCompanyId
    ? `/client/support?companyId=${encodeURIComponent(effectiveCompanyId)}`
    : '/client/support'
  const storeHref = effectiveCompanyId
    ? `/client/store?companyId=${encodeURIComponent(effectiveCompanyId)}`
    : '/client/store'

  useEffect(() => {
    fetch('/api/client/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((payload: ClientMeResponse | null) => setMe(payload))
      .catch(() => null)
  }, [])

  useEffect(() => {
    const q = effectiveCompanyId ? `?companyId=${encodeURIComponent(effectiveCompanyId)}` : ''
    fetch(`/api/client/venue-preview${q}`)
      .then(async (r) => {
        const payload = (await r.json().catch(() => null)) as VenuePayload | null
        if (!r.ok) {
          setVenue(null)
          setVenueError(payload?.error || 'Не удалось загрузить схему зала.')
          return
        }
        setVenueError(null)
        setVenue(payload)
      })
      .catch(() => {
        setVenue(null)
        setVenueError('Не удалось загрузить схему зала.')
      })
  }, [effectiveCompanyId])

  const active = me?.activeCustomer
  const noCompanyOnProfile = Boolean(me && linkedCompanyIds.length === 0)

  const displayProjects = venue?.projects || []
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">Добро пожаловать</h2>
        <p className="text-sm text-muted-foreground">
          Выберите точку клуба, посмотрите схему зала и перейдите к брони, баллам или поддержке — всё в контексте выбранной
          станции.
        </p>
        {active ? (
          <p className="text-sm text-foreground/90">
            Профиль: <span className="font-medium">{active.name}</span> · Баллы: {active.loyalty_points} · Визиты:{' '}
            {active.visits_count}
          </p>
        ) : null}
      </section>

      {noCompanyOnProfile ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          Профиль гостя ещё не привязан к точке клуба. Обратитесь к администратору — после привязки появятся брони, баллы и
          поддержка.
        </div>
      ) : null}

      {!noCompanyOnProfile && linkedCompanyIds.length > 1 && !companyIdFromUrl ? (
        <div className="rounded-xl border border-border/70 bg-background/60 p-4">
          <p className="text-sm font-medium text-foreground">Выберите точку</p>
          <p className="mt-1 text-xs text-muted-foreground">
            У вас несколько клубов в одном аккаунте. Выберите точку — ссылка обновится в адресе и сохранится в навигации.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {linkedCompanyIds.map((id) => {
              const name = venue?.companies?.find((x) => x.id === id)?.name || 'Точка клуба'
              return (
                <Link
                  key={id}
                  href={`/client?companyId=${encodeURIComponent(id)}`}
                  className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:bg-accent/40"
                >
                  {name}
                </Link>
              )
            })}
          </div>
        </div>
      ) : null}

      {!noCompanyOnProfile && linkedCompanyIds.length > 1 && companyIdFromUrl ? (
        <p className="text-xs text-muted-foreground">
          Точка:{' '}
          <span className="font-medium text-foreground">
            {venue?.companies?.find((c) => c.id === effectiveCompanyId)?.name || 'выбрана'}
          </span>
          .{' '}
          <Link href="/client" className="text-sky-400 underline-offset-2 hover:underline">
            Сменить точку
          </Link>
        </p>
      ) : null}

      {venueError ? <p className="text-sm text-amber-200/90">{venueError}</p> : null}

      {!noCompanyOnProfile && effectiveCompanyId && !venueError && displayProjects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Для этой точки пока нет карты арены в системе. Ниже всё равно можно перейти к брони — администратор увидит запрос.
        </p>
      ) : null}

      {!noCompanyOnProfile && displayProjects.length > 0 ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Схема зала</h3>
          {displayProjects.map((project) => {
            const zones = project.zones || []
            const stations = project.stations || []
            const decorations = project.decorations || []
            const mapped = stations.filter((s) => inGrid(s.grid_x) && inGrid(s.grid_y))
            return (
              <div key={project.id} className="space-y-2 rounded-xl border border-border/70 bg-background/50 p-3">
                <p className="text-sm font-medium">{project.name}</p>
                {mapped.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Карта не размечена — откройте список станций ниже.</p>
                ) : (
                  <div
                    className="mx-auto aspect-square w-full max-w-md overflow-hidden rounded-lg border border-border/60 bg-muted/15"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: `repeat(${GRID}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${GRID}, minmax(0, 1fr))`,
                    }}
                  >
                    {zones
                      .filter((z) => inGrid(z.grid_x) && inGrid(z.grid_y))
                      .map((z) => {
                        const w = Math.min(GRID - (z.grid_x as number), Math.max(1, z.grid_w || 4))
                        const h = Math.min(GRID - (z.grid_y as number), Math.max(1, z.grid_h || 4))
                        const bg = z.color && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(z.color) ? z.color : 'rgba(56,189,248,0.12)'
                        return (
                          <div
                            key={z.id}
                            title={z.name || 'Зона'}
                            className="border border-white/5"
                            style={{
                              gridColumn: `${(z.grid_x as number) + 1} / span ${w}`,
                              gridRow: `${(z.grid_y as number) + 1} / span ${h}`,
                              backgroundColor: bg,
                            }}
                          />
                        )
                      })}
                    {decorations
                      .filter((d) => inGrid(d.grid_x) && inGrid(d.grid_y))
                      .map((d) => {
                        const w = Math.min(GRID - (d.grid_x as number), Math.max(1, d.grid_w || 1))
                        const h = Math.min(GRID - (d.grid_y as number), Math.max(1, d.grid_h || 1))
                        return (
                          <div
                            key={d.id}
                            className="flex items-center justify-center border border-dashed border-white/10 text-[8px] text-muted-foreground"
                            style={{
                              gridColumn: `${(d.grid_x as number) + 1} / span ${w}`,
                              gridRow: `${(d.grid_y as number) + 1} / span ${h}`,
                            }}
                          >
                            {d.label || (d.type === 'entrance' ? 'Вход' : '')}
                          </div>
                        )
                      })}
                    {mapped.map((s) => (
                      <div
                        key={s.id}
                        title={s.name || 'Станция'}
                        className={`m-0.5 flex items-center justify-center rounded border text-[9px] font-medium leading-tight ${
                          s.is_active === false ? 'border-white/10 bg-white/5 text-muted-foreground' : 'border-sky-400/50 bg-sky-500/20 text-sky-100'
                        }`}
                        style={{
                          gridColumn: `${(s.grid_x as number) + 1}`,
                          gridRow: `${(s.grid_y as number) + 1}`,
                        }}
                      >
                        <span className="block max-w-full truncate px-0.5 text-center">{s.name || 'ПК'}</span>
                      </div>
                    ))}
                  </div>
                )}
                <ul className="max-h-40 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                  {stations.map((s) => (
                    <li key={s.id} className="flex justify-between gap-2 border-b border-border/30 py-1 last:border-0">
                      <span className="text-foreground/90">{s.name || 'Станция'}</span>
                      <span>{s.is_active === false ? 'выкл.' : 'активна'}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href={storeHref}
          className={`rounded-xl border p-3 transition hover:bg-accent/30 ${
            !effectiveCompanyId && linkedCompanyIds.length > 1 ? 'pointer-events-none opacity-50' : 'border-border/70 bg-background/70'
          }`}
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Магазин</p>
          <p className="mt-1 text-sm text-foreground">Витрина цен и наличия на точке.</p>
        </Link>
        <Link
          href={bookingsHref}
          className={`rounded-xl border p-3 transition hover:bg-accent/30 ${
            !effectiveCompanyId && linkedCompanyIds.length > 1 ? 'pointer-events-none opacity-50' : 'border-border/70 bg-background/70'
          }`}
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Брони</p>
          <p className="mt-1 text-sm text-foreground">Запросить визит в выбранную точку.</p>
        </Link>
        <Link href={pointsHref} className="rounded-xl border border-border/70 bg-background/70 p-3 transition hover:bg-accent/30">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Баллы</p>
          <p className="mt-1 text-sm text-foreground">Баланс и история по вашему профилю.</p>
        </Link>
        <Link
          href={supportHref}
          className={`rounded-xl border p-3 transition hover:bg-accent/30 ${
            !effectiveCompanyId && linkedCompanyIds.length > 1 ? 'pointer-events-none opacity-50' : 'border-border/70 bg-background/70'
          }`}
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Поддержка</p>
          <p className="mt-1 text-sm text-foreground">Сообщение администратору клуба.</p>
        </Link>
      </section>
    </div>
  )
}
