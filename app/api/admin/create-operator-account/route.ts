import { NextResponse } from 'next/server'

import { normalizeOperatorUsername, toOperatorAuthEmail } from '@/lib/core/auth'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

function generatePassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  const lower = 'abcdefghijkmnopqrstuvwxyz'
  const digits = '0123456789'
  const special = '!@#$%^&*'
  const all = upper + lower + digits + special
  const bytes = crypto.getRandomValues(new Uint8Array(20))
  let password = ''

  password += upper[bytes[0] % upper.length]
  password += lower[bytes[1] % lower.length]
  password += digits[bytes[2] % digits.length]
  password += special[bytes[3] % special.length]

  for (let i = 4; i < 20; i++) {
    password += all[bytes[i] % all.length]
  }

  const chars = password.split('')
  for (let i = chars.length - 1; i > 0; i--) {
    const j = bytes[i % bytes.length] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }

  return chars.join('')
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => null)
    const operatorId = typeof body?.operatorId === 'string' ? body.operatorId : ''
    const username = normalizeOperatorUsername(typeof body?.username === 'string' ? body.username : '')
    const email = typeof body?.email === 'string' ? body.email : ''
    const name = typeof body?.name === 'string' ? body.name : ''

    if (!operatorId || !username || !email) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (username.length < 3) {
      return NextResponse.json({ error: 'Username must be at least 3 characters' }, { status: 400 })
    }

    const authEmail = toOperatorAuthEmail(username)
    const password = generatePassword()
    const supabase = createAdminSupabaseClient()

    const { data: existingAuth, error: checkError } = await supabase
      .from('operator_auth')
      .select('id')
      .eq('operator_id', operatorId)
      .maybeSingle()

    if (checkError) {
      return NextResponse.json({ error: checkError.message }, { status: 500 })
    }

    if (existingAuth) {
      return NextResponse.json({ error: 'Account already exists for this operator' }, { status: 400 })
    }

    const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
      email: authEmail,
      password,
      email_confirm: true,
      user_metadata: {
        role: 'operator',
        operator_id: operatorId,
        name: name || username,
      },
    })

    if (createError) {
      if (!createError.message.includes('already registered')) {
        return NextResponse.json({ error: createError.message }, { status: 500 })
      }

      // Ищем через пагинацию — надёжнее чем perPage:1000
      let foundUser: { id: string; email?: string } | null = null
      let page = 1
      const MAX_PAGES = 20
      while (!foundUser && page <= MAX_PAGES) {
        const { data: pageData, error: usersError } = await supabase.auth.admin.listUsers({ page, perPage: 1000 })
        if (usersError) {
          return NextResponse.json({ error: usersError.message }, { status: 500 })
        }
        foundUser = pageData.users.find((u) => u.email?.toLowerCase() === authEmail.toLowerCase()) ?? null
        if (foundUser || pageData.users.length < 1000) break
        page++
      }
      if (!foundUser) {
        return NextResponse.json({ error: createError.message }, { status: 500 })
      }

      const { data: linkedAuth, error: linkedAuthError } = await supabase
        .from('operator_auth')
        .select('operator_id')
        .eq('user_id', foundUser.id)
        .maybeSingle()

      if (linkedAuthError) {
        return NextResponse.json({ error: linkedAuthError.message }, { status: 500 })
      }

      if (linkedAuth && linkedAuth.operator_id !== operatorId) {
        return NextResponse.json({ error: 'This auth account is already linked to another operator' }, { status: 400 })
      }

      const { error: updateError } = await supabase.auth.admin.updateUserById(foundUser.id, {
        password,
        email_confirm: true,
        user_metadata: {
          role: 'operator',
          operator_id: operatorId,
          name: name || username,
        },
      })

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      const { error: linkError } = await supabase
        .from('operator_auth')
        .insert({
          operator_id: operatorId,
          user_id: foundUser.id,
          username,
          role: 'operator',
          is_active: true,
        })

      if (linkError) {
        return NextResponse.json({ error: linkError.message }, { status: 500 })
      }

      return NextResponse.json({
        success: true,
        status: 'linked_existing_user',
        username,
        password,
        operatorId,
        userId: foundUser.id,
        authEmail,
      })
    }

    if (!authUser.user) {
      return NextResponse.json({ error: 'Failed to create user: No user returned' }, { status: 500 })
    }

    const { error: authError } = await supabase
      .from('operator_auth')
      .insert({
        operator_id: operatorId,
        user_id: authUser.user.id,
        username,
        role: 'operator',
        is_active: true,
      })

    if (authError) {
      await supabase.auth.admin.deleteUser(authUser.user.id).catch(() => null)
      return NextResponse.json({ error: authError.message }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      status: 'created',
      username,
      password,
      operatorId,
      userId: authUser.user.id,
      authEmail,
    })
  } catch (err: any) {
    console.error('Unexpected error in API:', err)
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'Operator account creation API',
    usage: 'POST with { operatorId, username, email, name }',
  })
}
