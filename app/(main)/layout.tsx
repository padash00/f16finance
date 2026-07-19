import { Breadcrumbs } from '@/components/breadcrumbs'
import { ConfirmDialogHost } from '@/components/ui/confirm-dialog'
import { DocumentTitle } from '@/components/document-title'
import { ScrollToTop } from '@/components/scroll-to-top'
import { KeyboardShortcuts } from '@/components/keyboard-shortcuts'
import { PageEntitlementGuard } from '@/components/page-entitlement-guard'
import { Sidebar } from '@/components/sidebar'
import { TopNav } from '@/components/topnav'
import { CashlessProvider } from '@/lib/client/use-cashless-labels'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <CashlessProvider>
      <div className="app-shell-layout">
        <PageEntitlementGuard />
        <DocumentTitle />
        <TopNav />
        <KeyboardShortcuts />
        <Sidebar desktopEnabled={false} />
        <main className="app-main relative isolate min-h-0">
          <div
            className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(165deg,rgba(255,179,107,0.07)_0%,transparent_42%,transparent_100%)] opacity-90"
            aria-hidden
          />
          <div className="relative z-[1] min-h-0">
            <Breadcrumbs />
            {children}
          </div>
        </main>
        <ConfirmDialogHost />
        <ScrollToTop />
      </div>
    </CashlessProvider>
  )
}
