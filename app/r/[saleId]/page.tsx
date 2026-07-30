import { computeSaleReceipt } from '@/lib/server/sale-receipt'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

// Публичный онлайн-чек продажи (QR на печатном чеке ведёт сюда). Доступ по UUID продажи.
export const dynamic = 'force-dynamic'

function money(n: number) {
  return `${Number(n || 0).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`
}
function dt(s: string | null) {
  return s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
}

export default async function SaleReceiptPage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params

  let r: Awaited<ReturnType<typeof computeSaleReceipt>> = null
  try {
    r = await computeSaleReceipt(createAdminSupabaseClient(), saleId)
  } catch {
    r = null
  }

  if (!r) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f1f5f9', color: '#334155', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🧾</div>
          <p>Чек не найден</p>
        </div>
      </main>
    )
  }

  const req = r.requisites
  const payLabel = r.paymentMethod === 'cash' ? 'Наличные' : r.paymentMethod === 'kaspi' ? 'Карта' : r.paymentMethod === 'mixed' ? 'Смешанная' : 'Оплата'
  const hr = <div style={{ borderTop: '1px solid #e2e8f0', margin: '14px 0' }} />

  return (
    <main style={{ minHeight: '100vh', background: '#f1f5f9', padding: '24px 12px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 420, margin: '0 auto', background: '#fff', borderRadius: 14, padding: 24, boxShadow: '0 6px 24px rgba(2,6,23,0.08)', color: '#0f172a' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{req.name || r.pointName || 'ORDA POINT'}</div>
          {req.bin ? <div style={{ color: '#64748b', fontSize: 13 }}>БИН/ИИН {req.bin}</div> : null}
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 10 }}>Продажа</div>
        </div>
        {hr}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, textAlign: 'center', fontSize: 12, color: '#64748b' }}>
          <div>
            <div>Чек № · Время</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>№{r.saleNumber}</div>
            <div>{dt(r.soldAt)}</div>
          </div>
          <div>
            <div>Смена · Кассир</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>№{r.shiftNumber || '—'}</div>
            <div>{r.cashier || '—'}</div>
          </div>
        </div>
        {hr}
        <div style={{ textAlign: 'center', fontSize: 12, color: '#64748b', letterSpacing: 0.4 }}>СПИСОК ТОВАРОВ / УСЛУГ</div>
        <div style={{ marginTop: 10 }}>
          {r.items.map((it, i) => (
            <div key={i} style={{ padding: '8px 0', borderBottom: '1px dashed #e2e8f0' }}>
              <div style={{ fontWeight: 600 }}>{i + 1}. {it.name}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#475569' }}>
                <span>{Number(it.quantity).toLocaleString('ru-RU', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} × {money(it.unitPrice)}</span>
                <span>= {money(it.total)}</span>
              </div>
            </div>
          ))}
        </div>
        {hr}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, fontWeight: 800 }}>
          <span>ИТОГО:</span><span>{money(r.total)}</span>
        </div>
        {r.cash > 0 ? <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#475569', marginTop: 6 }}><span>Наличные:</span><span>{money(r.cash)}</span></div> : null}
        {r.kaspi > 0 ? <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#475569', marginTop: 2 }}><span>{r.cash > 0 ? 'Карта' : payLabel}:</span><span>{money(r.kaspi)}</span></div> : null}
        {req.address ? (<>{hr}<div style={{ fontSize: 12, color: '#475569' }}><b>Адрес:</b> {req.address}</div></>) : null}
      </div>
    </main>
  )
}
