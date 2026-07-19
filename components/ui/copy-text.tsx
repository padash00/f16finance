'use client'

/**
 * Клик-копирование: обёртка вокруг текста (штрихкод, телефон, код карты).
 * Клик → значение в буфере + тост «Скопировано».
 *
 *   <CopyText value={item.barcode} className="font-mono text-xs" />
 *   <CopyText value={phone}>{formattedPhone}</CopyText>
 */

import { useToast } from '@/hooks/use-toast'

export function CopyText({
  value,
  children,
  className = '',
  title = 'Нажмите, чтобы скопировать',
}: {
  value: string | null | undefined
  children?: React.ReactNode
  className?: string
  title?: string
}) {
  const { toast } = useToast()
  if (!value) return <>{children ?? '—'}</>
  return (
    <button
      type="button"
      title={title}
      className={`cursor-copy select-text text-left transition hover:opacity-70 active:opacity-50 ${className}`}
      onClick={async (e) => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(String(value))
          toast({ description: `Скопировано: ${value}`, duration: 1800 })
        } catch {
          toast({ description: 'Не удалось скопировать', duration: 1800 })
        }
      }}
    >
      {children ?? value}
    </button>
  )
}
