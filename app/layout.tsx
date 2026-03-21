import type { Metadata } from 'next'
import { IBM_Plex_Mono, Space_Grotesk } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'

import { ClientErrorReporter } from '@/components/client-error-reporter'
import { GlobalAssistant } from '@/components/ai/global-assistant'
import { Toaster } from '@/components/ui/toaster'
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/core/site'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-space-grotesk',
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
  ],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: 'ru_RU',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
  },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
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
      <body className={`${spaceGrotesk.variable} ${ibmPlexMono.variable} app-shell font-sans antialiased dark`}>
        {children}
        <GlobalAssistant />
        <ClientErrorReporter />
        <Toaster />
        <Analytics />
      </body>
    </html>
  )
}
