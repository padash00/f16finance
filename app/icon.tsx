import { ImageResponse } from 'next/og'
import { createElement } from 'react'

import { OgAppBrandIcon } from '@/components/og-app-brand-icon'

export const size = {
  width: 64,
  height: 64,
}

export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(createElement(OgAppBrandIcon, { sizePx: 64 }), size)
}
