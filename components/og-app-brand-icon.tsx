/**
 * Общая картинка для /icon, PWA 192/512 (ImageResponse / next/og).
 */
export function OgAppBrandIcon({ sizePx }: { sizePx: number }) {
  return (
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
      <svg width={sizePx} height={sizePx} viewBox="0 0 64 64" fill="none">
        <defs>
          <linearGradient id="strokeGoldPwa" x1="8" y1="4" x2="54" y2="60" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFF2AA" />
            <stop offset="0.45" stopColor="#EEC94A" />
            <stop offset="1" stopColor="#8D6200" />
          </linearGradient>
          <linearGradient id="fillGoldPwa" x1="20" y1="22" x2="45" y2="46" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FCE27A" />
            <stop offset="1" stopColor="#D39E10" />
          </linearGradient>
        </defs>

        <circle cx="32" cy="32" r="24.5" stroke="url(#strokeGoldPwa)" strokeWidth="2.2" />

        <path
          d="M16 14.5C20.6 11.1 26 9.2 32 9.2C38 9.2 43.4 11.1 48 14.5"
          stroke="url(#strokeGoldPwa)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M21 15.1L28.6 11.8L24.8 17.9"
          stroke="url(#strokeGoldPwa)"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M43 15.1L35.4 11.8L39.2 17.9"
          stroke="url(#strokeGoldPwa)"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />

        <rect x="21" y="36" width="4.2" height="9" rx="1" fill="url(#fillGoldPwa)" />
        <rect x="28.6" y="31.5" width="4.2" height="13.5" rx="1" fill="url(#fillGoldPwa)" />
        <rect x="36.2" y="26.5" width="4.2" height="18.5" rx="1" fill="url(#fillGoldPwa)" />

        <path
          d="M18.5 34.5C24.4 32.8 30.2 30.4 35.7 26.9C39 24.8 41.8 22.5 44.7 19.5"
          stroke="url(#strokeGoldPwa)"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M44.5 15.8L48.6 19.3L44 23.3"
          stroke="url(#strokeGoldPwa)"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  )
}
