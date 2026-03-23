'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export function InventoryLegacyRedirect({ href }: { href: string }) {
  const router = useRouter()

  useEffect(() => {
    router.replace(href)
  }, [href, router])

  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-card/80 px-4 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Перенаправляем в новый раздел магазина...
      </div>
    </div>
  )
}
