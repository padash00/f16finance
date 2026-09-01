import type { ReactNode } from 'react'

import { DebtHistoryPanel } from './debt-history-panel'

export default function PointDebtsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <DebtHistoryPanel />
    </>
  )
}
