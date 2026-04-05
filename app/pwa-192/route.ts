import { ImageResponse } from 'next/og'
import { createElement } from 'react'

import { OgAppBrandIcon } from '@/components/og-app-brand-icon'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(createElement(OgAppBrandIcon, { sizePx: 168 }), {
    width: 192,
    height: 192,
  })
}
