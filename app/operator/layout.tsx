import type { ReactNode } from 'react'

import { OperatorAppShell } from '@/components/operator/operator-app-shell'
import { OperatorPwaInstall } from '@/components/operator/operator-pwa-install'

export default function OperatorLayout({ children }: { children: ReactNode }) {
  return (
    <OperatorAppShell>
      {children}
      <OperatorPwaInstall />
    </OperatorAppShell>
  )
}
