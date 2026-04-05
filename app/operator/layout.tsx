import type { ReactNode } from 'react'

import { OperatorAppShell } from '@/components/operator/operator-app-shell'

export default function OperatorLayout({ children }: { children: ReactNode }) {
  return <OperatorAppShell>{children}</OperatorAppShell>
}
