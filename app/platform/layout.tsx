import PlatformShell from './PlatformShell'

// Доступ к /platform ограничен middleware (только суперадмин). Здесь — оболочка панели.
export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <PlatformShell>{children}</PlatformShell>
}
