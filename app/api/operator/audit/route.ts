import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestOperatorContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}
const UUID_RE = /^[0-9a-fA-F-]{36}$/
const num = (v: unknown) => {
  const n = Number(v || 0)
  return Number.isFinite(n) ? Math.round((n + Number.EPSILON) * 1000) / 1000 : 0
}

// Догрузка товаров чанками: один .in() на ~900 UUID превышает лимит длины URL
// у шлюза PostgREST → запрос молча падает и секция выглядит «пустой». Бьём по 200.
async function fetchItemsByIds(supabase: any, ids: string[], columns: string) {
  const out: any[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('inventory_items').select(columns).in('id', ids.slice(i, i + 200))
    if (error) throw error
    if (data) out.push(...(data as any[]))
  }
  return out
}

// Секции оператора в акте: набор category_id; null => вся локация.
function operatorSection(assignments: Array<{ category_id: string | null }>) {
  const cats = new Set<string>()
  let all = false
  for (const a of assignments) {
    if (!a.category_id) all = true
    else cats.add(String(a.category_id))
  }
  return { all, cats }
}

export async function GET(request: Request) {
  try {
    const context = await getRequestOperatorContext(request)
    if ('response' in context) return context.response
    const operatorId = context.operator.id
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : (context.supabase as any)

    const url = new URL(request.url)
    const actId = url.searchParams.get('act')

    // мои назначения на ОТКРЫТЫЕ акты
    const { data: myAssigns } = await supabase
      .from('inventory_audit_assignments')
      .select('act_id, category_id, label, inventory_audit_acts!inner(id, status, location_id, comment, opened_at, mode)')
      .eq('operator_id', operatorId)
      .eq('inventory_audit_acts.status', 'open')
    const assignRows = (myAssigns || []) as any[]

    if (actId && UUID_RE.test(actId)) {
      const forAct = assignRows.filter((a) => String(a.act_id) === actId)
      if (forAct.length === 0) return json({ error: 'not-assigned' }, 403)
      const section = operatorSection(forAct)

      const { data: snap } = await supabase.from('inventory_audit_snapshot').select('item_id').eq('act_id', actId)
      const snapIds = new Set(((snap as any[]) || []).map((r: any) => String(r.item_id)))
      if (snapIds.size === 0) return json({ ok: true, data: { act_id: actId, items: [] } })

      const items = await fetchItemsByIds(supabase, Array.from(snapIds), 'id, name, barcode, unit, category_id')
      const sectionItems = items.filter((it: any) => section.all || (it.category_id && section.cats.has(String(it.category_id))))

      // Видимость чужих подсчётов зависит от режима акта:
      //  • Обычный — СОВМЕСТНЫЙ счёт: показываем, что позицию уже посчитал другой кассир
      //    (и кто), чтобы не считать одну позицию дважды.
      //  • Двойной слепой — НЕЗАВИСИМЫЙ счёт: каждый видит только свой ввод, иначе
      //    второй кассир увидит цифру первого и смысл слепого счёта теряется.
      const act0 = (forAct[0] as any)?.inventory_audit_acts
      const actObj = Array.isArray(act0) ? act0[0] : act0
      const isDouble = String(actObj?.mode || 'single') === 'double'

      const { data: counts } = await supabase
        .from('inventory_audit_counts')
        .select('item_id, counted_qty, counted_by')
        .eq('act_id', actId)
      const myCount = new Map<string, number>()
      const otherCount = new Map<string, { qty: number; by: string | null }>()
      for (const c of ((counts as any[]) || [])) {
        const id = String(c.item_id)
        const by = c.counted_by ? String(c.counted_by) : null
        if (by === operatorId) myCount.set(id, num(c.counted_qty))
        else if (!isDouble) otherCount.set(id, { qty: num(c.counted_qty), by })
      }

      // имена кассиров, уже посчитавших позиции (для подписи «посчитал …»)
      const otherOpIds = Array.from(new Set(Array.from(otherCount.values()).map((v) => v.by).filter(Boolean))) as string[]
      const { data: opRows } = otherOpIds.length
        ? await supabase.from('operators').select('id, name, short_name').in('id', otherOpIds)
        : { data: [] as any[] }
      const opName = new Map(((opRows as any[]) || []).map((o: any) => [String(o.id), (o.name || o.short_name || 'кассир') as string]))

      // СЛЕПОЙ режим: системный остаток НЕ возвращаем.
      return json({
        ok: true,
        data: {
          act_id: actId,
          mode: isDouble ? 'double' : 'single',
          items: sectionItems
            .map((it: any) => {
              const id = String(it.id)
              const other = otherCount.get(id)
              return {
                item_id: id,
                name: it.name as string,
                barcode: it.barcode ? String(it.barcode) : null,
                unit: it.unit ? String(it.unit) : null,
                counted: myCount.has(id) ? myCount.get(id) : null,
                otherQty: other ? other.qty : null,
                otherBy: other ? (other.by ? opName.get(other.by) || 'другой кассир' : 'другой кассир') : null,
              }
            })
            .sort((a: any, b: any) => a.name.localeCompare(b.name)),
        },
      })
    }

    // список моих открытых актов
    const byAct = new Map<string, { act: any; assigns: any[] }>()
    for (const a of assignRows) {
      const act = a.inventory_audit_acts
      const id = String(a.act_id)
      const e = byAct.get(id) || { act, assigns: [] }
      e.assigns.push(a)
      byAct.set(id, e)
    }
    const acts = Array.from(byAct.values())
    const locIds = Array.from(new Set(acts.map((e) => String(e.act.location_id))))
    const { data: locs } = locIds.length
      ? await supabase.from('inventory_locations').select('id, name, location_type, companies(name)').in('id', locIds)
      : { data: [] as any[] }
    const locById = new Map(((locs as any[]) || []).map((l: any) => [String(l.id), l]))

    return json({
      ok: true,
      data: acts.map((e) => {
        const loc = locById.get(String(e.act.location_id)) as any
        const labels = e.assigns.map((a) => a.label || null).filter(Boolean)
        return {
          act_id: String(e.act.id),
          locationName: loc ? `${loc.companies?.name ? loc.companies.name + ' · ' : ''}${loc.location_type === 'point_display' ? 'Витрина' : loc.location_type === 'warehouse' ? 'Склад' : loc.name}` : '—',
          comment: e.act.comment || null,
          opened_at: e.act.opened_at,
          sectionLabel: labels.length ? labels.join(', ') : 'Вся локация',
        }
      }),
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/operator/audit.GET', message: error?.message || 'op audit GET' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const context = await getRequestOperatorContext(request)
    if ('response' in context) return context.response
    const operatorId = context.operator.id
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : (context.supabase as any)

    const body = (await request.json().catch(() => null)) as any
    const actId = String(body?.act_id || '').trim()
    if (!UUID_RE.test(actId)) return json({ error: 'act-required' }, 400)
    const incoming = Array.isArray(body?.counts) ? body.counts : []
    if (incoming.length === 0) return json({ error: 'counts-required' }, 400)

    // акт открыт и оператор назначен
    const { data: act } = await supabase.from('inventory_audit_acts').select('id, status').eq('id', actId).maybeSingle()
    if (!act || (act as any).status !== 'open') return json({ error: 'act-not-open' }, 409)
    const { data: assign } = await supabase.from('inventory_audit_assignments').select('category_id').eq('act_id', actId).eq('operator_id', operatorId)
    if (!assign || (assign as any[]).length === 0) return json({ error: 'not-assigned' }, 403)
    const section = operatorSection((assign as any[]).map((a) => ({ category_id: a.category_id ? String(a.category_id) : null })))

    // Разрешённые товары: только из снимка акта и (если не «вся локация») из своих категорий.
    const { data: snap } = await supabase.from('inventory_audit_snapshot').select('item_id').eq('act_id', actId)
    const snapIds = new Set(((snap as any[]) || []).map((r: any) => String(r.item_id)))
    let allowedItems: Set<string> = snapIds
    if (!section.all) {
      const catItems = snapIds.size ? await fetchItemsByIds(supabase, Array.from(snapIds), 'id, category_id') : []
      allowedItems = new Set(catItems.filter((it: any) => it.category_id && section.cats.has(String(it.category_id))).map((it: any) => String(it.id)))
    }

    const now = new Date().toISOString()
    const rows = incoming
      .map((c: any) => ({ act_id: actId, item_id: String(c.item_id || '').trim(), counted_qty: Math.max(0, num(c.counted_qty)), counted_by: operatorId, counted_at: now }))
      .filter((r: any) => UUID_RE.test(r.item_id) && allowedItems.has(r.item_id))
    if (rows.length === 0) return json({ error: 'counts-invalid' }, 400)

    const { error } = await supabase.from('inventory_audit_counts').upsert(rows, { onConflict: 'act_id,item_id,counted_by' })
    if (error) throw error
    return json({ ok: true, data: { saved: rows.length } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/operator/audit.POST', message: error?.message || 'op audit POST' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
