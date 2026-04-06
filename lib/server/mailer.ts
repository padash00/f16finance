import nodemailer from 'nodemailer'

export type LeadRequestPayload = {
  name: string
  phone: string
  niche: string
  company?: string
  telegram?: string
  email?: string
  message?: string
  page?: string
  submittedAt: string
}

let cachedTransporter: nodemailer.Transporter | null = null

function getMailerConfig() {
  const user =
    process.env.SMTP_USER ||
    process.env.GMAIL_USER ||
    process.env.EMAIL_USER ||
    process.env.MAIL_USER ||
    ''
  const pass =
    process.env.SMTP_PASS ||
    process.env.GMAIL_APP_PASSWORD ||
    process.env.GMAIL_PASS ||
    process.env.EMAIL_PASS ||
    process.env.MAIL_PASS ||
    ''
  const host = process.env.SMTP_HOST || process.env.MAIL_HOST || (user && pass ? 'smtp.gmail.com' : '')
  const port = Number(process.env.SMTP_PORT || 465)
  const from = process.env.SMTP_FROM || user
  const to = process.env.CONTACT_LEAD_TO || 'padash00@gmail.com'
  const secure = (process.env.SMTP_SECURE || 'true').toLowerCase() !== 'false'

  return { host, port, user, pass, from, to, secure }
}

export function isMailerConfigured() {
  const { host, port, user, pass, from, to } = getMailerConfig()
  return Boolean(host && port && user && pass && from && to)
}

function getTransporter() {
  if (cachedTransporter) return cachedTransporter

  const { host, port, user, pass, secure } = getMailerConfig()
  if (!host || !user || !pass) {
    throw new Error('SMTP is not configured')
  }

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  })

  return cachedTransporter
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export async function sendLeadRequestEmail(payload: LeadRequestPayload) {
  const transporter = getTransporter()
  const { from, to } = getMailerConfig()

  if (!from || !to) {
    throw new Error('SMTP recipients are not configured')
  }

  const rows = [
    ['Имя', payload.name],
    ['Телефон', payload.phone],
    ['Ниша', payload.niche],
    ['Компания', payload.company || 'Не указано'],
    ['Telegram', payload.telegram || 'Не указано'],
    ['Email', payload.email || 'Не указано'],
    ['Страница', payload.page || 'Не указано'],
    ['Время', payload.submittedAt],
    ['Комментарий', payload.message || 'Без комментария'],
  ] as const

  const text = rows.map(([label, value]) => `${label}: ${value}`).join('\n')

  const html = `
    <div style="font-family:Arial,sans-serif;background:#0b1120;color:#fff;padding:24px">
      <div style="max-width:640px;margin:0 auto;border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:24px;background:#111827">
        <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#fbbf24;margin-bottom:12px">Новая заявка с сайта</div>
        <h1 style="margin:0 0 18px;font-size:28px;line-height:1.2">Orda Control</h1>
        <table style="width:100%;border-collapse:collapse">
          ${rows
            .map(
              ([label, value]) => `
                <tr>
                  <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,0.08);color:#94a3b8;width:180px;vertical-align:top">${escapeHtml(label)}</td>
                  <td style="padding:10px 0;border-top:1px solid rgba(255,255,255,0.08);color:#fff;vertical-align:top">${escapeHtml(value)}</td>
                </tr>
              `,
            )
            .join('')}
        </table>
      </div>
    </div>
  `

  await transporter.sendMail({
    from,
    to,
    replyTo: payload.email || undefined,
    subject: `Новая заявка с сайта — ${payload.name}`,
    text,
    html,
  })
}

export async function sendSystemEmail(params: {
  to: string
  subject: string
  text: string
  html?: string
  replyTo?: string | null
}) {
  const transporter = getTransporter()
  const { from } = getMailerConfig()
  if (!from) {
    throw new Error('SMTP sender is not configured')
  }

  await transporter.sendMail({
    from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html || undefined,
    replyTo: params.replyTo || undefined,
  })
}
