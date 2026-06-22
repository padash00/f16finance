'use client'

import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const initialState = {
  name: '',
  phone: '',
  niche: '',
  company: '',
  telegram: '',
  email: '',
  message: '',
  website: '',
}

export function ContactLeadForm() {
  const [form, setForm] = useState(initialState)
  const [status, setStatus] = useState<{ type: 'idle' | 'error' | 'success'; message: string }>({
    type: 'idle',
    message: '',
  })
  const [isPending, startTransition] = useTransition()

  const updateField = (field: keyof typeof initialState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus({ type: 'idle', message: '' })

    startTransition(async () => {
      const response = await fetch('/api/public/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...form,
          page: typeof window !== 'undefined' ? window.location.href : '/',
        }),
      }).catch(() => null)

      if (!response) {
        setStatus({ type: 'error', message: 'Не удалось отправить заявку. Проверьте интернет и попробуйте снова.' })
        return
      }

      const payload = (await response.json().catch(() => null)) as { error?: string; ok?: boolean } | null
      if (!response.ok || !payload?.ok) {
        setStatus({
          type: 'error',
          message: payload?.error || 'Не удалось отправить заявку. Попробуйте позже.',
        })
        return
      }

      setForm(initialState)
      setStatus({
        type: 'success',
        message: 'Заявка отправлена. Мы получили ее на почту и свяжемся с вами.',
      })
    })
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-[#475569]">Имя</label>
          <Input
            required
            value={form.name}
            onChange={(event) => updateField('name', event.target.value)}
            placeholder="Как к вам обращаться"
            className="h-11 border-[#c8d1de] bg-white text-[#0f2038] placeholder:text-[#94a3b8] focus-visible:ring-[#16a34a]/30"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-[#475569]">Телефон</label>
          <Input
            required
            value={form.phone}
            onChange={(event) => updateField('phone', event.target.value)}
            placeholder="+7 ..."
            className="h-11 border-[#c8d1de] bg-white text-[#0f2038] placeholder:text-[#94a3b8] focus-visible:ring-[#16a34a]/30"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-[#475569]">Ниша</label>
          <Input
            required
            value={form.niche}
            onChange={(event) => updateField('niche', event.target.value)}
            placeholder="Клуб, кофейня, сеть точек..."
            className="h-11 border-[#c8d1de] bg-white text-[#0f2038] placeholder:text-[#94a3b8] focus-visible:ring-[#16a34a]/30"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-[#475569]">Название бизнеса</label>
          <Input
            value={form.company}
            onChange={(event) => updateField('company', event.target.value)}
            placeholder="Если хотите, можно указать"
            className="h-11 border-[#c8d1de] bg-white text-[#0f2038] placeholder:text-[#94a3b8] focus-visible:ring-[#16a34a]/30"
          />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <label className="text-sm font-medium text-[#475569]">Telegram</label>
          <Input
            value={form.telegram}
            onChange={(event) => updateField('telegram', event.target.value)}
            placeholder="@username"
            className="h-11 border-[#c8d1de] bg-white text-[#0f2038] placeholder:text-[#94a3b8] focus-visible:ring-[#16a34a]/30"
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-[#475569]">Email</label>
          <Input
            type="email"
            value={form.email}
            onChange={(event) => updateField('email', event.target.value)}
            placeholder="email@company.com"
            className="h-11 border-[#c8d1de] bg-white text-[#0f2038] placeholder:text-[#94a3b8] focus-visible:ring-[#16a34a]/30"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-[#475569]">Что хотите автоматизировать</label>
        <Textarea
          value={form.message}
          onChange={(event) => updateField('message', event.target.value)}
          placeholder="Например: смены, точку, Telegram-отчеты, зарплату, ОПиУ..."
          className="min-h-32 border-[#c8d1de] bg-white text-[#0f2038] placeholder:text-[#94a3b8] focus-visible:ring-[#16a34a]/30"
        />
      </div>

      <div className="hidden">
        <label htmlFor="website">Website</label>
        <input id="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(event) => updateField('website', event.target.value)} />
      </div>

      {status.type !== 'idle' ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            status.type === 'success'
              ? 'border-[#16a34a]/30 bg-[#16a34a]/[0.08] text-[#15803d]'
              : 'border-red-300 bg-red-50 text-[#dc2626]'
          }`}
        >
          {status.message}
        </div>
      ) : null}

      <Button type="submit" disabled={isPending} size="lg" className="bg-gradient-to-br from-[#1db955] to-[#15803d] text-white shadow-[0_10px_26px_-8px_rgba(22,163,74,0.5)] hover:from-[#15803d] hover:to-[#15803d]">
        {isPending ? 'Отправляем...' : 'Оставить заявку'}
      </Button>
    </form>
  )
}
