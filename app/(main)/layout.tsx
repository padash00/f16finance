import { Sidebar } from '@/components/sidebar'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell-layout">
      <Sidebar />
      <main className="app-main">
        {children}
      </main>
    </div>
  )
}
