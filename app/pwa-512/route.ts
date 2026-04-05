import { ImageResponse } from 'next/og'
import { createElement } from 'react'

import { OgAppBrandIcon } from '@/components/og-app-brand-icon'

export const runtime = 'nodejs'

export async function GET() {
  return new ImageResponse(createElement(OgAppBrandIcon, { sizePx: 512 }), {
    width: 512,
    height: 512,
  })
}
