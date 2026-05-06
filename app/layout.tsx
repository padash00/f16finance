import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Mono, Inter, Manrope } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'

import { ClientErrorReporter } from '@/components/client-error-reporter'
import { GlobalAssistant } from '@/components/ai/global-assistant'
import { Toaster } from '@/components/ui/toaster'
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/core/site'
import './globals.css'

export const viewport: Viewport = {
  themeColor: '#f59e0b',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

// Основной шрифт UI/body — Inter. Cyrillic в обязательном subset для русского.
const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  variable: '--font-inter',
  display: 'swap',
})

// Заголовки — Manrope. Жирные веса для крупных H1.
const manrope = Manrope({
  subsets: ['latin', 'cyrillic'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-manrope',
  display: 'swap',
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-ibm-plex-mono',
})

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  generator: SITE_NAME,
  keywords: [
    'управление клубом',
    'учет смен',
    'зарплата операторов',
    'учет расходов',
    'учет доходов',
    'ОПиУ',
    'EBITDA',
    'кассовая программа для точки',
    'telegram отчеты для бизнеса',
    'калькулятор смен',
    'программа для клуба',
  ],
  alternates: {
    canonical: '/',
  },
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION,
  },
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: 'ru_RU',
    type: 'website',
    images: [
      {
        url: `${SITE_URL}/og-image`,
        width: 1200,
        height: 630,
        alt: SITE_NAME,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [`${SITE_URL}/og-image`],
  },
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [{ url: '/icon' }, { url: '/icon.svg', type: 'image/svg+xml' }],
    apple: '/apple-icon',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head />
      <body className={`${inter.variable} ${manrope.variable} ${ibmPlexMono.variable} app-shell font-sans antialiased dark`}>
        {children}
        <GlobalAssistant />
        <ClientErrorReporter />
        <Toaster />
        <Analytics />
      </body>
    </html>
  )
}
