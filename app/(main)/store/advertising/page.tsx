'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Clapperboard,
  Film,
  GripVertical,
  ImageIcon,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { supabase } from '@/lib/supabaseClient'

const ADS_BUCKET = 'customer-display-ads'

type CompanyOption = { id: string; name: string; code?: string | null }

type Ad = {
  id: string
  company_id: string
  media_type: 'image' | 'video'
  url: string
  title: string | null
  duration_sec: number | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export default function AdvertisingPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [companyId, setCompanyId] = useState<string>('')
  const [ads, setAds] = useState<Ad[]>([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  // компании
  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/admin/companies', { cache: 'no-store' })
        const data = await res.json().catch(() => null)
        if (res.ok && Array.isArray(data?.data)) {
          setCompanies(data.data as CompanyOption[])
          if (data.data[0]?.id) setCompanyId(data.data[0].id)
        }
      } catch {
        setCompanies([])
      }
    })()
  }, [])

  const loadAds = async (cid: string) => {
    if (!cid) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/advertising?company_id=${encodeURIComponent(cid)}`, {
        cache: 'no-store',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Ошибка загрузки')
      setAds((data.data || []) as Ad[])
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (companyId) loadAds(companyId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId])

  const onPickFile = () => fileRef.current?.click()

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !companyId) return

    const mediaType: 'image' | 'video' = file.type.startsWith('video/')
      ? 'video'
      : file.type.startsWith('image/')
        ? 'image'
        : 'image'
    if (!file.type.startsWith('video/') && !file.type.startsWith('image/')) {
      setError('Допустимы только видео и картинки')
      if (fileRef.current) fileRef.current.value = ''
      return
    }

    setUploading(true)
    setError(null)
    try {
      // 1. Грузим файл НАПРЯМУЮ в Supabase Storage из браузера —
      //    минуя Next.js API (у Vercel лимит тела ~4.5 МБ, видео не пройдёт).
      const ext = (file.name.split('.').pop() || (mediaType === 'video' ? 'mp4' : 'jpg'))
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
      const suffix = Math.random().toString(36).slice(2, 10)
      const fileName = `ad_${Date.now()}_${suffix}.${ext || 'bin'}`

      const { error: upErr } = await supabase.storage
        .from(ADS_BUCKET)
        .upload(fileName, file, { contentType: file.type, upsert: false })
      if (upErr) throw new Error(upErr.message || 'Не удалось загрузить файл')

      const { data: pub } = supabase.storage.from(ADS_BUCKET).getPublicUrl(fileName)

      // 2. Создаём запись в БД (маленький JSON — лимита нет).
      const createRes = await fetch('/api/admin/advertising', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_id: companyId,
          media_type: mediaType,
          url: pub.publicUrl,
          title: file.name,
          duration_sec: mediaType === 'image' ? 8 : null,
        }),
      })
      const created = await createRes.json().catch(() => null)
      if (!createRes.ok) throw new Error(created?.error || 'Ошибка создания записи')
      setAds((prev) => [...prev, created.data as Ad])
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const toggleActive = async (ad: Ad) => {
    setAds((prev) => prev.map((a) => (a.id === ad.id ? { ...a, is_active: !a.is_active } : a)))
    try {
      await fetch('/api/admin/advertising', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ad.id, is_active: !ad.is_active }),
      })
    } catch {
      // откат при ошибке
      setAds((prev) => prev.map((a) => (a.id === ad.id ? { ...a, is_active: ad.is_active } : a)))
    }
  }

  const updateDuration = async (ad: Ad, value: number) => {
    setAds((prev) => prev.map((a) => (a.id === ad.id ? { ...a, duration_sec: value } : a)))
    try {
      await fetch('/api/admin/advertising', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: ad.id, duration_sec: value }),
      })
    } catch {
      /* noop */
    }
  }

  const removeAd = async (ad: Ad) => {
    if (!confirm('Удалить этот ролик/картинку?')) return
    const prev = ads
    setAds((p) => p.filter((a) => a.id !== ad.id))
    try {
      const res = await fetch(`/api/admin/advertising?id=${encodeURIComponent(ad.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error()
    } catch {
      setAds(prev)
      setError('Не удалось удалить')
    }
  }

  // drag-n-drop реордер
  const onDrop = async (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) {
      setDragIndex(null)
      return
    }
    const reordered = [...ads]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(targetIndex, 0, moved)
    setAds(reordered)
    setDragIndex(null)
    try {
      await fetch('/api/admin/advertising', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reorder: reordered.map((a) => a.id) }),
      })
    } catch {
      /* noop */
    }
  }

  const activeCount = ads.filter((a) => a.is_active).length

  return (
    <div className={embedded ? 'space-y-6' : 'space-y-6 p-4 md:p-6'}>
      {(() => {
        const hdrActions = (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="h-9 rounded-md border border-white/10 bg-white/[0.03] px-3 text-sm text-slate-200 outline-none focus:border-amber-500/40"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              ref={fileRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={onFileChange}
            />
            <Button onClick={onPickFile} disabled={uploading || !companyId} size="sm">
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              Загрузить
            </Button>
          </div>
        )
        return embedded ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {hdrActions}
          </div>
        ) : (
          <AdminPageHeader
            title="Реклама на экране клиента"
            description="Видео и картинки крутятся на втором мониторе, когда касса простаивает между клиентами"
            icon={<Clapperboard className="h-5 w-5" />}
            accent="amber"
            actions={hdrActions}
          />
        )
      })()}

      {error && (
        <Card className="border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</Card>
      )}

      <Card className="border-white/10 p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-300">
            Плейлист • {ads.length}{' '}
            <span className="text-slate-500">({activeCount} активных)</span>
          </span>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
        </div>
      </Card>

      {ads.length === 0 && !loading ? (
        <Card className="border-dashed border-white/15 p-10 text-center">
          <Clapperboard className="mx-auto mb-3 h-10 w-10 text-slate-600" />
          <p className="text-sm text-slate-400">
            Пусто. Загрузи видео (MP4, WEBM, MOV) или картинки (JPG, PNG, WEBP, GIF) — до 200 МБ.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Контент покажется на экране клиента в порядке этого списка, пока касса свободна.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ads.map((ad, index) => (
            <Card
              key={ad.id}
              draggable
              onDragStart={() => setDragIndex(index)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(index)}
              className={`overflow-hidden border-white/10 transition ${
                dragIndex === index ? 'opacity-50' : ''
              } ${ad.is_active ? '' : 'opacity-60'}`}
            >
              <div className="relative aspect-video bg-slate-950">
                {ad.media_type === 'video' ? (
                  <video
                    src={ad.url}
                    className="h-full w-full object-contain"
                    controls
                    muted
                    playsInline
                    preload="metadata"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={ad.url} alt={ad.title || ''} className="h-full w-full object-cover" />
                )}
                <div className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-[10px] text-white">
                  {ad.media_type === 'video' ? (
                    <>
                      <Film className="h-3 w-3" /> Видео
                    </>
                  ) : (
                    <>
                      <ImageIcon className="h-3 w-3" /> Картинка
                    </>
                  )}
                </div>
                <div className="absolute right-2 top-2 cursor-grab rounded-md bg-black/60 p-1 text-white/70">
                  <GripVertical className="h-3.5 w-3.5" />
                </div>
                <div className="absolute left-2 bottom-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] text-white/80">
                  #{index + 1}
                </div>
              </div>

              <div className="space-y-2 p-3">
                <div className="truncate text-xs text-slate-300" title={ad.title || ''}>
                  {ad.title || 'Без названия'}
                </div>

                <div className="flex items-center justify-between gap-2">
                  {ad.media_type === 'image' ? (
                    <label className="flex items-center gap-1 text-[11px] text-slate-400">
                      Показ:
                      <input
                        type="number"
                        min={2}
                        max={120}
                        value={ad.duration_sec || 8}
                        onChange={(e) => updateDuration(ad, Math.max(2, Number(e.target.value) || 8))}
                        className="h-7 w-16 rounded border border-white/10 bg-white/[0.03] px-2 text-xs text-slate-200 outline-none focus:border-amber-500/40"
                      />
                      сек
                    </label>
                  ) : (
                    <span className="text-[11px] text-slate-500">играет до конца</span>
                  )}

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggleActive(ad)}
                      className={`rounded-md px-2 py-1 text-[11px] ${
                        ad.is_active
                          ? 'bg-emerald-500/15 text-emerald-300'
                          : 'bg-slate-500/15 text-slate-400'
                      }`}
                    >
                      {ad.is_active ? 'Активно' : 'Выключено'}
                    </button>
                    <button
                      onClick={() => removeAd(ad)}
                      className="rounded-md bg-rose-500/10 p-1.5 text-rose-300 hover:bg-rose-500/20"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
