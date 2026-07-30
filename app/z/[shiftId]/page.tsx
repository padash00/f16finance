import { computeShiftReport } from '@/lib/server/shift-report'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

// Публичная страница онлайн-чека смены (Z). Доступ по UUID смены — не угадать.
// Рендерится на поддомене организации: https://<slug>.ordaops.kz/z/<shiftId>
export const dynamic = 'force-dynamic'

function money(n: number) {
  return `${Math.round(Number(n || 0)).toLocaleString('ru-RU')} ₸`
}
function dts(s: string | null) {
  return s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
}

export default async function ZReceiptPage({ params }: { params: Promise<{ shiftId: string }> }) {
  const { shiftId } = await params

  let report: Awaited<ReturnType<typeof computeShiftReport>> = null
  try {
    const supabase = createAdminSupabaseClient()
    report = await computeShiftReport(supabase, shiftId)
  } catch {
    report = null
  }

  if (!report) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0b0c0f', color: '#e5e7eb', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🧾</div>
          <p style={{ fontSize: 16 }}>Чек не найден</p>
        </div>
      </main>
    )
  }

  const r = report
  const req = r.requisites
  const income = Number(r.total || 0) - Number(r.returns || 0)
  const cashBalance = Number(r.openingCash || 0) + Number(r.cashSales || 0)
  const row = (label: string, value: string, bold = false) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: bold ? 700 : 400, fontSize: bold ? 16 : 14, padding: '3px 0' }}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  )
  const line = <div style={{ borderTop: '1px dashed #cbd5e1', margin: '10px 0' }} />
  const sec = (t: string) => <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: 0.4, marginTop: 6, marginBottom: 2, color: '#334155' }}>{t}</div>

  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'start center', background: '#0b0c0f', padding: '24px 12px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ width: '100%', maxWidth: 380, background: '#fff', color: '#0f172a', borderRadius: 16, padding: 20, boxShadow: '0 10px 40px rgba(0,0,0,0.4)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{req.name || r.pointName || 'ORDA POINT'}</div>
          {req.bin ? <div style={{ fontSize: 12, color: '#64748b' }}>БИН/ИИН {req.bin}</div> : null}
          {req.address ? <div style={{ fontSize: 12, color: '#64748b' }}>{req.address}</div> : null}
          {r.pointName ? <div style={{ fontSize: 12, color: '#64748b' }}>Точка: {r.pointName}</div> : null}
          <div style={{ fontWeight: 800, marginTop: 8 }}>СМЕННЫЙ ОТЧЁТ</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Сменный Z-отчёт (онлайн)</div>
        </div>
        {line}
        {row('Смена №', String(r.shiftNumber))}
        {row('Кассир', r.cashier || '—')}
        {row('Открыта', dts(r.openedAt))}
        {row('Закрыта', dts(r.closedAt))}
        {line}
        {sec('ПРОДАЖА')}
        {row('Количество', String(r.checkCount))}
        {row('Наличные', money(r.cashSales))}
        {row('Карта', money(r.kaspiSales))}
        {row('Сумма', money(r.total))}
        {line}
        {sec('ВОЗВРАТ ПРОДАЖИ')}
        {row('Сумма', money(r.returns))}
        {line}
        {row('Доход', money(income))}
        {row('Баланс кассы (нал)', money(cashBalance))}
        {line}
        {row('ИТОГО ВЫРУЧКА', money(r.total), true)}
        {line}
        <div style={{ textAlign: 'center', fontSize: 11, color: '#94a3b8' }}>
          Управленческий отчёт, не является фискальным чеком
        </div>
      </div>
    </main>
  )
}
