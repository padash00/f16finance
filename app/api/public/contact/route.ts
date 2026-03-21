import { NextResponse } from 'next/server'
import { z } from 'zod'

import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { isMailerConfigured, sendLeadRequestEmail } from '@/lib/server/mailer'

const leadSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(5).max(40),
  niche: z.string().trim().min(2).max(120),
  company: z.string().trim().max(160).optional().or(z.literal('')),
  telegram: z.string().trim().max(80).optional().or(z.literal('')),
  email: z.string().trim().email().max(160).optional().or(z.literal('')),
  message: z.string().trim().max(2000).optional().or(z.literal('')),
  website: z.string().trim().max(200).optional().or(z.literal('')),
  page: z.string().trim().max(200).optional().or(z.literal('')),
})

export async function POST(request: Request) {
  const ip = getClientIp(request)
  const rate = checkRateLimit(`public-contact:${ip}`, 5, 60 * 60 * 1000)

  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Слишком много попыток. Попробуйте позже.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rate.resetAt - Date.now()) / 1000)) } },
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос.' }, { status: 400 })
  }

  const parsed = leadSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Проверьте заполнение формы.' }, { status: 400 })
  }

  const data = parsed.data

  // Honeypot for simple bot traffic. Pretend success to avoid feedback loops.
  if (data.website) {
    return NextResponse.json({ ok: true })
  }

  if (!isMailerConfigured()) {
    return NextResponse.json(
      { error: 'Почтовая интеграция ещё не настроена на сервере.' },
      { status: 503 },
    )
  }

  try {
    await sendLeadRequestEmail({
      name: data.name,
      phone: data.phone,
      niche: data.niche,
      company: data.company || undefined,
      telegram: data.telegram || undefined,
      email: data.email || undefined,
      message: data.message || undefined,
      page: data.page || undefined,
      submittedAt: new Date().toISOString(),
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Failed to send contact lead', error)
    return NextResponse.json(
      { error: 'Не удалось отправить заявку. Попробуйте позже.' },
      { status: 500 },
    )
  }
}
