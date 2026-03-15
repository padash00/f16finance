import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { isAdminEmail } from '@/lib/server/admin'
import { requiredEnv } from '@/lib/server/env'
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
      email?: string
      password?: string
      payload?: ProductPayload | null
    }
  | {
      action: 'updateProduct'
      email?: string
      password?: string
      productId?: string
      payload?: ProductPayload | null
    }
  | {
      action: 'deleteProduct'
      email?: string
      password?: string
      productId?: string
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

async function requireSuperAdmin(email: string, password: string) {
  const authClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || requiredEnv('SUPABASE_URL'),
    requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )

  const { data, error } = await authClient.auth.signInWithPassword({
    email,
    password,
  })

  if (error || !data.user) {
    throw new Error('invalid-credentials')
  }

  if (!isAdminEmail(data.user.email)) {
    await authClient.auth.signOut().catch(() => null)
    throw new Error('super-admin-only')
  }

  await authClient.auth.signOut().catch(() => null)
}

export async function GET(request: Request) {
  try {
    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
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

    const email = String((body as any).email || '')
      .trim()
      .toLowerCase()
    const password = String((body as any).password || '').trim()
    if (!email) return json({ error: 'email-required' }, 400)
    if (!password) return json({ error: 'password-required' }, 400)

    await requireSuperAdmin(email, password)

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

      if (error) throw error

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
    return json({ error: message || 'Не удалось сохранить товар точки' }, 500)
  }
}
