'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Рендерит модалку в document.body — вне любых предков страницы.
 *
 * Зачем: `position: fixed` ломается, если у какого-то предка есть
 * transform/filter/contain/will-change/backdrop-filter — тогда fixed считается
 * от этого предка, а не от экрана, и модалку «срезает» сверху/снизу (особенно
 * на вложенных/embedded страницах). Портал в body это исключает.
 *
 * Использование:
 *   {open ? (
 *     <ModalPortal>
 *       <div className="fixed inset-0 z-50 flex items-center justify-center ...">...</div>
 *     </ModalPortal>
 *   ) : null}
 */
export function ModalPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])
  if (!mounted || typeof document === 'undefined') return null
  return createPortal(children, document.body)
}
