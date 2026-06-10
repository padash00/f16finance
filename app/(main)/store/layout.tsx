import { StoreShell } from '@/components/store/store-shell'
import { StoreScope } from '@/components/store/store-scope'

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <StoreShell>
      <StoreScope>{children}</StoreScope>
    </StoreShell>
  )
}
