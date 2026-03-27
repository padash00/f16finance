import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { validateAdminToken } from '@/lib/server/admin-tokens'
import { requirePointDevice } from '@/lib/server/point-devices'

type ProductPayload = {
  name?: string | null
  barcode?: string | null
  price?: number | null
  is_active?: boolean | null
}

type Body =
  | {
      action: 'createProduct'
      token?: string
      payload?: ProductPayload | null
    }
  | {
      action: 'updateProduct'
      token?: string
      productId?: string
      payload?: ProductPayload | null
    }
  | {
      action: 'deleteProduct'
      token?: string
      productId?: string
    }
  | {
      action: 'importProducts'
      token?: string
      products?: ProductPayload[]
    }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeMoney(value: unknown) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Math.max(0, Math.round(amount))
}

function normalizeBarcode(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, '')
}

async function ensureCompanyPointProductsFromInventory(params: {
  supabase: any
  companyId: string
}) {
  const [{ data: existing, error: existingError }, { data: inventoryItems, error: inventoryError }] = await Promise.all([
    params.supabase
      .from('point_products')
      .select('barcode')
      .eq('company_id', params.companyId),
    params.supabase
      .from('inventory_items')
      .select('name, barcode, sale_price, is_active, item_type')
      .eq('is_active', true)
      .neq('item_type', 'consumable')
      .order('name', { ascending: true }),
  ])

  if (existingError) throw existingError
  if (inventoryError) throw inventoryError

  const existingBarcodes = new Set((existing || []).map((row: any) => normalizeBarcode(row.barcode)))
  const missingRows = (inventoryItems || [])
    .map((row: any) => ({
      company_id: params.companyId,
      name: String(row.name || '').trim(),
      barcode: normalizeBarcode(row.barcode),
      price: normalizeMoney(row.sale_price),
      is_active: row.is_active !== false,
    }))
    .filter((row: any) => row.name && row.barcode && !existingBarcodes.has(row.barcode))

  if (missingRows.length === 0) return

  const { error } = await params.supabase.from('point_products').upsert(missingRows, {
    onConflict: 'company_id,barcode',
  })
  if (error) throw error
}

function requireSuperAdmin(token: string): void {
  const email = validateAdminToken(token)
  if (!email) throw new Error('invalid-or-expired-token')
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    await ensureCompanyPointProductsFromInventory({ supabase, companyId: device.company_id })
    const { data, error } = await supabase
      .from('point_products')
      .select('id, company_id, name, barcode, price, is_active, created_at, updated_at')
      .eq('company_id', device.company_id)
      .order('name', { ascending: true })

    if (error) throw error

    return json({
      ok: true,
      data: {
        products: (data || []).map((row: any) => ({
          ...row,
          price: normalizeMoney(row.price),
          barcode: normalizeBarcode(row.barcode),
        })),
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-products:get',
      message: error?.message || 'Point products GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить товары точки' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    const body = (await request.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ error: 'invalid-action' }, 400)

    const token = String((body as any).token || '').trim()
    if (!token) return json({ error: 'token-required' }, 400)

    requireSuperAdmin(token)
    const email = validateAdminToken(token) || 'unknown'

    if (body.action === 'createProduct') {
      const name = String(body.payload?.name || '').trim()
      const barcode = normalizeBarcode(body.payload?.barcode)
      const price = normalizeMoney(body.payload?.price)
      const isActive = body.payload?.is_active !== false

      if (!name) return json({ error: 'product-name-required' }, 400)
      if (!barcode) return json({ error: 'barcode-required' }, 400)
      if (price <= 0) return json({ error: 'price-required' }, 400)

      const { data, error } = await supabase
        .from('point_products')
        .insert([
          {
            company_id: device.company_id,
            name,
            barcode,
            price,
            is_active: isActive,
          },
        ])
        .select('id, company_id, name, barcode, price, is_active, created_at, updated_at')
        .single()

      if (error) {
        // Нарушение уникального ключа (штрихкод уже существует)
        if (error.code === '23505') return json({ error: 'barcode-already-exists' }, 409)
        throw error
      }

      await writeAuditLog(supabase, {
        entityType: 'point-product',
        entityId: String(data.id),
        action: 'create',
        payload: {
          point_device_id: device.id,
          company_id: device.company_id,
          name,
          barcode,
          price,
          is_active: isActive,
          admin_email: email,
        },
      })

      return json({ ok: true, data })
    }

    // ─── Пакетный импорт (один auth на всё) ──────────────────────────────────
    if (body.action === 'importProducts') {
      const products = Array.isArray((body as any).products) ? (body as any).products : []
      if (products.length === 0) return json({ error: 'products-required' }, 400)
      if (products.length > 2000) return json({ error: 'too-many-products' }, 400)

      let imported = 0
      let skipped = 0
      let failed = 0

      for (const p of products) {
        const name = String(p.name || '').trim()
        const barcode = normalizeBarcode(p.barcode)
        const price = normalizeMoney(p.price)

        if (!name || !barcode || price <= 0) { failed++; continue }

        const { error: insertError } = await supabase
          .from('point_products')
          .insert([{ company_id: device.company_id, name, barcode, price, is_active: true }])

        if (insertError) {
          if (insertError.code === '23505') { skipped++; continue }
          failed++
        } else {
          imported++
        }
      }

      return json({ ok: true, data: { imported, skipped, failed } })
    }

    const productId = String((body as any).productId || '').trim()
    if (!productId) return json({ error: 'product-id-required' }, 400)

    if (body.action === 'updateProduct') {
      const name = String(body.payload?.name || '').trim()
      const barcode = normalizeBarcode(body.payload?.barcode)
      const price = normalizeMoney(body.payload?.price)
      const isActive = body.payload?.is_active !== false

      if (!name) return json({ error: 'product-name-required' }, 400)
      if (!barcode) return json({ error: 'barcode-required' }, 400)
      if (price <= 0) return json({ error: 'price-required' }, 400)

      const { data, error } = await supabase
        .from('point_products')
        .update({
          name,
          barcode,
          price,
          is_active: isActive,
        })
        .eq('id', productId)
        .eq('company_id', device.company_id)
        .select('id, company_id, name, barcode, price, is_active, created_at, updated_at')
        .single()

      if (error) throw error

      await writeAuditLog(supabase, {
        entityType: 'point-product',
        entityId: String(data.id),
        action: 'update',
        payload: {
          point_device_id: device.id,
          company_id: device.company_id,
          name,
          barcode,
          price,
          is_active: isActive,
          admin_email: email,
        },
      })

      return json({ ok: true, data })
    }

    const { error } = await supabase
      .from('point_products')
      .delete()
      .eq('id', productId)
      .eq('company_id', device.company_id)

    if (error) throw error

    await writeAuditLog(supabase, {
      entityType: 'point-product',
      entityId: productId,
      action: 'delete',
      payload: {
        point_device_id: device.id,
        company_id: device.company_id,
        admin_email: email,
      },
    })

    return json({ ok: true })
  } catch (error: any) {
    const message = error?.message || 'Point products POST error'
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-products:post',
      message,
    })
    if (message === 'invalid-credentials') return json({ error: message }, 401)
    if (message === 'super-admin-only') return json({ error: message }, 403)
    if (message === 'barcode-already-exists') return json({ error: message }, 409)
    return json({ error: message || 'Не удалось сохранить товар точки' }, 500)
  }
}
