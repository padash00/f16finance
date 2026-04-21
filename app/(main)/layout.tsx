import { Sidebar } from '@/components/sidebar'
import { TopNav } from '@/components/topnav'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell-layout">
      <TopNav />
      <Sidebar desktopEnabled={false} />
      <main className="app-main relative isolate min-h-0">
        <div
          className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(165deg,rgba(255,179,107,0.07)_0%,transparent_42%,transparent_100%)] opacity-90"
          aria-hidden
        />
        <div className="relative z-[1] min-h-0">{children}</div>
      </main>
    </div>
  )
}
