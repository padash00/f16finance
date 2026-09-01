import type { ReactNode } from 'react'

import { DebtHistoryPanel } from './debt-history-panel'
import './history-button.css'

export default function PointDebtsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="point-debt-history-host">
        <DebtHistoryPanel />
      </div>
      {children}
    </>
  )
}
