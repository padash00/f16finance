import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'

import { supabase } from './supabase'
import { setActiveOrganization, setAccessToken } from './api'
import { loginToEmail } from './operator-auth'

export type RolePermissionOverride = { path: string; enabled: boolean }

export type SessionRole = {
  isSuperAdmin: boolean
  isStaff: boolean
  isOperator: boolean
  isCustomer: boolean
  persona: string | null
  displayName: string | null
  operatorId: string | null
  roleLabel: string | null
  staffRole: string | null
  rolePermissionOverrides: RolePermissionOverride[]
  orgFeatures: string[]
  featuresAllAccess: boolean
}

type AuthState = {
  session: Session | null
  role: SessionRole | null
  loading: boolean
  signIn: (login: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  setOrganization: (orgId: string | null) => void
}

const AuthContext = createContext<AuthState | undefined>(undefined)

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://www.ordaops.kz'

async function fetchRole(token: string): Promise<SessionRole | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/session-role`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    const j = await res.json()
    return {
      isSuperAdmin: !!j.isSuperAdmin,
      isStaff: !!j.isStaff,
      isOperator: !!j.isOperator,
      isCustomer: !!j.isCustomer,
      persona: j.persona ?? null,
      displayName: j.displayName ?? null,
      operatorId: j.operatorId ?? null,
      roleLabel: j.roleLabel ?? null,
      staffRole: j.staffRole ?? null,
      rolePermissionOverrides: Array.isArray(j.rolePermissionOverrides) ? j.rolePermissionOverrides : [],
      orgFeatures: Array.isArray(j.orgFeatures) ? j.orgFeatures : [],
      featuresAllAccess: !!j.featuresAllAccess,
    }
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [role, setRole] = useState<SessionRole | null>(null)
  const [loading, setLoading] = useState(true)

  async function applySession(s: Session | null) {
    setSession(s)
    setAccessToken(s?.access_token ?? null) // держим токен для apiFetch синхронно
    if (s?.access_token) setRole(await fetchRole(s.access_token))
    else setRole(null)
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      await applySession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { void applySession(s) })
    return () => sub.subscription.unsubscribe()
  }, [])

  const signIn = async (login: string, password: string) => {
    const { email } = loginToEmail(login)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw new Error(error.message)
  }

  const signOut = async () => {
    await supabase.auth.signOut()
    setActiveOrganization(null)
    setAccessToken(null)
    setRole(null)
  }

  const setOrganization = (orgId: string | null) => setActiveOrganization(orgId)

  return (
    <AuthContext.Provider value={{ session, role, loading, signIn, signOut, setOrganization }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth должен использоваться внутри <AuthProvider>')
  return ctx
}
