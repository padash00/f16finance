'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ExternalLink, Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react'

import type { HelpImageRecord, HelpImageSlot } from '@/lib/core/help-images'

type SlotRow = HelpImageSlot & { image: HelpImageRecord | null }

/**
 * Иллюстрации руководства.
 *
 * Слоты приходят из lib/core/help-images.ts — здесь их не выдумываем: список
 * показывает ровно те места, куда страница /help умеет вставить картинку.
 */
export default function PlatformHelpImagesPage() {
  const [slots, setSlots] = useState<SlotRow[]>([])
  const [orphans, setOrphans] = useState<HelpImageRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busySlot, setBusySlot] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [captions, setCaptions] = useState<Record<string, string>>({})
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})

  const load = useCallback(async () => {
    setError(null)
    try {
      const response = await fetch('/api/admin/help-images', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'Не удалось загрузить список')
      setSlots(payload.slots || [])
      setOrphans(payload.orphans || [])
      const nextCaptions: Record<string, string> = {}
      for (const row of payload.slots || []) {
        nextCaptions[row.slot] = row.image?.caption || row.caption
      }
      setCaptions(nextCaptions)
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function upload(slot: string, file: File) {
    setBusySlot(slot)
    setError(null)
    try {
      const body = new FormData()
      body.append('slot', slot)
      body.append('file', file)
      body.append('caption', captions[slot] || '')
      const response = await fetch('/api/admin/help-images', { method: 'POST', body })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'Не удалось загрузить файл')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setBusySlot(null)
    }
  }

  async function saveCaption(slot: string) {
    setBusySlot(slot)
    setError(null)
    try {
      const body = new FormData()
      body.append('slot', slot)
      body.append('caption', captions[slot] || '')
      const response = await fetch('/api/admin/help-images', { method: 'POST', body })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'Не удалось сохранить подпись')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка сохранения')
    } finally {
      setBusySlot(null)
    }
  }

  async function remove(slot: string) {
    setBusySlot(slot)
    setError(null)
    try {
      const response = await fetch(`/api/admin/help-images?slot=${encodeURIComponent(slot)}`, {
        method: 'DELETE',
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error || 'Не удалось удалить картинку')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка удаления')
    } finally {
      setBusySlot(null)
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    )
  }

  const filled = slots.filter((s) => s.image).length

  return (
    <div className="mx-auto max-w-6xl p-6 text-slate-900 dark:text-white">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Иллюстрации руководства</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Скриншоты для публичной страницы /help. Загружены {filled} из {slots.length}.
            Пустые слоты на странице просто не показываются.
          </p>
        </div>
        <Link
          href="/help"
          target="_blank"
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium transition hover:border-violet-400/40 dark:border-white/10"
        >
          <ExternalLink className="h-4 w-4" /> Открыть /help
        </Link>
      </div>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {slots.map((row) => {
          const busy = busySlot === row.slot
          return (
            <div
              key={row.slot}
              className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-medium uppercase tracking-wider text-violet-500">
                    {row.section}
                  </div>
                  <h2 className="mt-1 text-sm font-semibold">{row.title}</h2>
                </div>
                <span
                  className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                    row.image
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300'
                      : 'bg-slate-200/70 text-slate-600 dark:bg-white/[0.06] dark:text-slate-400'
                  }`}
                >
                  {row.image ? 'загружено' : 'пусто'}
                </span>
              </div>

              <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {row.hint}
              </p>

              <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.02]">
                {row.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={row.image.url}
                    alt={row.image.alt || row.title}
                    className="max-h-56 w-full object-contain"
                  />
                ) : (
                  <div className="flex h-32 items-center justify-center gap-2 text-xs text-slate-400">
                    <ImageIcon className="h-4 w-4" /> Изображение не загружено
                  </div>
                )}
              </div>

              <label className="mt-3 block text-[11px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Подпись под картинкой
              </label>
              <input
                value={captions[row.slot] ?? ''}
                onChange={(e) => setCaptions((c) => ({ ...c, [row.slot]: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-violet-400 dark:border-white/10 dark:bg-slate-950/40"
                placeholder={row.caption}
              />

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  ref={(el) => {
                    inputs.current[row.slot] = el
                  }}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void upload(row.slot, file)
                    e.target.value = ''
                  }}
                />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => inputs.current[row.slot]?.click()}
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  {row.image ? 'Заменить' : 'Загрузить'}
                </button>
                {row.image ? (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void saveCaption(row.slot)}
                      className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-medium transition hover:border-violet-400/40 disabled:opacity-60 dark:border-white/10"
                    >
                      Сохранить подпись
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove(row.slot)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-rose-300 px-3 py-2 text-sm font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                    >
                      <Trash2 className="h-4 w-4" /> Убрать
                    </button>
                  </>
                ) : null}
              </div>

              <p className="mt-2 text-[11px] text-slate-400">
                PNG, JPG или WEBP, до 4 МБ. Ключ слота: <code>{row.slot}</code>
              </p>
            </div>
          )
        })}
      </div>

      {orphans.length > 0 ? (
        <div className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
          <h2 className="font-semibold text-amber-700 dark:text-amber-300">Картинки без места на странице</h2>
          <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-200/70">
            Эти слоты убрали из руководства — файлы висят в хранилище и нигде не показываются.
          </p>
          <div className="mt-3 space-y-2">
            {orphans.map((row) => (
              <div key={row.slot} className="flex items-center justify-between gap-3">
                <code className="text-xs">{row.slot}</code>
                <button
                  type="button"
                  onClick={() => void remove(row.slot)}
                  className="rounded-lg border border-amber-400/50 px-2.5 py-1 text-xs font-medium text-amber-700 transition hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-500/10"
                >
                  Удалить
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
