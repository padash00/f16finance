import { StoreShell } from '@/components/store/store-shell'

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return <StoreShell>{children}</StoreShell>
}
