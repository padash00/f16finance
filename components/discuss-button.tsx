'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { MessageSquare } from 'lucide-react'

/**
 * Универсальная кнопка «Обсудить» для встраивания на страницы задач, смен, долгов и т.д.
 * Открывает /team-chat с фильтром по контексту — увидишь только сообщения по этой сущности.
 */
export function DiscussButton({
  contextType,
  contextId,
  contextLabel,
  size = 'sm',
  variant = 'outline',
  className,
}: {
  contextType: 'task' | 'shift' | 'debt' | 'expense' | 'income' | string
  contextId: string
  contextLabel?: string
  size?: 'xs' | 'sm' | 'default' | 'lg'
  variant?: 'default' | 'outline' | 'ghost' | 'secondary'
  className?: string
}) {
  const url = `/team-chat?context_type=${encodeURIComponent(contextType)}&context_id=${encodeURIComponent(contextId)}${
    contextLabel ? `&context_label=${encodeURIComponent(contextLabel)}` : ''
  }`
  return (
    <Link href={url}>
      <Button variant={variant} size={size} className={className}>
        <MessageSquare className="w-4 h-4 mr-1.5" />
        Обсудить
      </Button>
    </Link>
  )
}
