'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

// Плавающая кнопка (десктоп, появляется при скролле) + липкий нижний CTA (мобайл).
export function FloatingCta() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 700)
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <>
      <Link
        href="#contact"
        aria-label="Попробовать Orda Control"
        className={`fixed bottom-6 right-6 z-40 hidden items-center gap-2 rounded-full bg-gradient-to-br from-[#1db955] to-[#15803d] px-6 py-3.5 text-[15px] font-semibold text-white shadow-[0_14px_34px_-8px_rgba(22,163,74,0.6)] transition-all duration-300 sm:inline-flex ${
          show ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-4 opacity-0'
        }`}
      >
        Попробовать <ArrowRight className="h-4 w-4" />
      </Link>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[#e2e8f0] bg-white/95 p-3 backdrop-blur sm:hidden">
        <Link
          href="#contact"
          className="flex items-center justify-center gap-2 rounded-[12px] bg-gradient-to-br from-[#1db955] to-[#15803d] py-3 text-[15px] font-semibold text-white"
        >
          Попробовать бесплатно <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </>
  )
}
