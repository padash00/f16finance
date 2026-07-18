/** @type {import('next').NextConfig} */
const nextConfig = {
  generateBuildId: async () => process.env.GITHUB_SHA ?? null,
  experimental: {
    // Плавные переходы между страницами (View Transitions API).
    // Используется в app/(main)/template.tsx; в браузерах без поддержки — фолбэк-фейд из globals.css.
    viewTransition: true,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Принудительный HTTPS на 2 года + поддомены (preload-ready).
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ]
  },
}

export default nextConfig
