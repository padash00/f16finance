import { ImageResponse } from 'next/og'

import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/core/site'

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = 'image/png'

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background:
            'radial-gradient(circle at 20% 10%, rgba(255,244,184,0.2), transparent 22%), radial-gradient(circle at 82% 80%, rgba(245,158,11,0.16), transparent 24%), linear-gradient(180deg, #050816 0%, #0a1020 52%, #050816 100%)',
          color: '#fff',
          padding: '56px',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            width: '100%',
            borderRadius: '32px',
            border: '1px solid rgba(255,255,255,0.08)',
            background: 'linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))',
            boxShadow: '0 24px 70px rgba(0,0,0,0.34)',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flex: 1, padding: '56px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <div
                style={{
                  display: 'flex',
                  width: '70px',
                  height: '70px',
                  borderRadius: '22px',
                  background: 'linear-gradient(180deg, #f8d24d 0%, #d6a514 48%, #b8800d 100%)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    width: '48px',
                    height: '48px',
                    borderRadius: '999px',
                    border: '3px solid #fff1a6',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff1a6',
                    fontSize: 22,
                    fontWeight: 700,
                  }}
                >
                  OC
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ color: '#fcd34d', fontSize: 24, textTransform: 'uppercase', letterSpacing: '0.22em' }}>Orda Control</div>
                <div style={{ color: '#cbd5e1', fontSize: 18 }}>Собственная система для смен, точки и управленки</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div style={{ fontSize: 64, lineHeight: 1.02, fontWeight: 700, maxWidth: '720px' }}>
                Смены, Telegram, зарплата и ОПиУ в одной системе
              </div>
              <div style={{ fontSize: 28, lineHeight: 1.45, color: '#cbd5e1', maxWidth: '760px' }}>{SITE_DESCRIPTION}</div>
            </div>

            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              {['Point-программа', 'Telegram-отчеты', 'Калькулятор смен', 'ОПиУ и EBITDA'].map((item) => (
                <div
                  key={item}
                  style={{
                    display: 'flex',
                    padding: '12px 18px',
                    borderRadius: '999px',
                    border: '1px solid rgba(251,191,36,0.2)',
                    background: 'rgba(251,191,36,0.1)',
                    color: '#fde68a',
                    fontSize: 20,
                  }}
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  )
}
