import { ImageResponse } from 'next/og'

export const size = {
  width: 180,
  height: 180,
}

export const contentType = 'image/png'

export default function AppleIcon() {
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
            'radial-gradient(circle at 30% 20%, rgba(255,244,184,0.35), transparent 28%), linear-gradient(180deg, #f8d24d 0%, #d6a514 48%, #b8800d 100%)',
        }}
      >
        <svg width="180" height="180" viewBox="0 0 180 180" fill="none">
          <defs>
            <linearGradient id="strokeGoldApple" x1="23" y1="16" x2="150" y2="161" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FFF1A6" />
              <stop offset="0.48" stopColor="#EAC13E" />
              <stop offset="1" stopColor="#845A00" />
            </linearGradient>
            <linearGradient id="fillGoldApple" x1="58" y1="74" x2="121" y2="130" gradientUnits="userSpaceOnUse">
              <stop stopColor="#FCE27A" />
              <stop offset="1" stopColor="#D39E10" />
            </linearGradient>
          </defs>

          <circle cx="90" cy="92" r="67" stroke="url(#strokeGoldApple)" strokeWidth="6.5" />

          <path d="M45 37C57.6 27.4 72.4 22 89 22C105.6 22 120.4 27.4 133 37" stroke="url(#strokeGoldApple)" strokeWidth="5.4" strokeLinecap="round" />
          <path d="M59 38.5L80 29.5L69.5 46.5" stroke="url(#strokeGoldApple)" strokeWidth="4.6" strokeLinejoin="round" />
          <path d="M121 38.5L100 29.5L110.5 46.5" stroke="url(#strokeGoldApple)" strokeWidth="4.6" strokeLinejoin="round" />

          <rect x="58" y="100" width="12" height="28" rx="2.5" fill="url(#fillGoldApple)" />
          <rect x="79" y="86" width="12" height="42" rx="2.5" fill="url(#fillGoldApple)" />
          <rect x="100" y="70" width="12" height="58" rx="2.5" fill="url(#fillGoldApple)" />

          <path d="M47 95C63.3 90.2 79.2 83.6 94.5 74.2C103.8 68.5 112 62.2 120 54" stroke="url(#strokeGoldApple)" strokeWidth="6.5" strokeLinecap="round" />
          <path d="M119.5 44L131 53.8L118 65" stroke="url(#strokeGoldApple)" strokeWidth="6.2" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    size,
  )
}
