import { ImageResponse } from 'next/og'
import { createElement } from 'react'

import { OgAppBrandIcon } from '@/components/og-app-brand-icon'

export const runtime = 'edge'

export async function GET() {
  return new ImageResponse(createElement(OgAppBrandIcon, { sizePx: 448 }), {
    width: 512,
    height: 512,
  })
}
