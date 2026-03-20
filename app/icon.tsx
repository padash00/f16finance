import { ImageResponse } from 'next/og'

export const size = {
  width: 32,
  height: 32,
}

export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(circle at top, rgba(245,158,11,0.35), transparent 55%), linear-gradient(180deg, #0f172a 0%, #020617 100%)',
          borderRadius: '8px',
          color: '#fbbf24',
          fontSize: 18,
          fontWeight: 700,
        }}
      >
        OC
      </div>
    ),
    size,
  )
}
