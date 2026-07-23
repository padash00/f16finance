import { useEffect, useState } from 'react'
import { ClipboardList, Gamepad2, History, ReceiptText, RotateCcw, ScanBarcode, ShoppingBasket, UserCircle2, type LucideIcon } from 'lucide-react'

import { hasAnyDraft, REQUEST_DRAFT_EVENT } from '@/lib/request-draft'

type WorkMode = 'shift' | 'sale' | 'return' | 'history' | 'scanner' | 'request' | 'cabinet' | 'arena'

interface Props {
  active: WorkMode
  showSale?: boolean
  showReturn?: boolean
  showHistory?: boolean
  showScanner?: boolean
  showRequest?: boolean
  showArena?: boolean
  /**
   * Точка-индикатор на вкладке «Заявка»: лежит несданный черновик заявки.
   * Если проп не передан — компонент сам читает наличие черновика из
   * localStorage (lib/request-draft) и обновляется по событию.
   */
  requestBadge?: boolean
  onShift?: () => void
  onSale?: () => void
  onReturn?: () => void
  onHistory?: () => void
  onScanner?: () => void
  onRequest?: () => void
  onCabinet?: () => void
  onArena?: () => void
}

function ModeButton({
  active,
  label,
  icon: Icon,
  onClick,
  disabled,
  badge,
}: {
  active: boolean
  label: string
  icon: LucideIcon
  onClick?: () => void
  disabled?: boolean
  badge?: boolean
}) {
  return (
    <button
      type="button"
      title={badge ? `${label} — есть несохранённый черновик` : label}
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      className={`relative flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition disabled:cursor-default ${
        active
          ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
          : 'text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:opacity-40'
      }`}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="hidden whitespace-nowrap sm:inline">{label}</span>
      {badge ? (
        <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-background" />
      ) : null}
    </button>
  )
}

/** Наличие черновика заявки: слушаем событие модуля и storage (другие окна). */
function useRequestDraftBadge(override: boolean | undefined): boolean {
  const [autoBadge, setAutoBadge] = useState(() => (override === undefined ? hasAnyDraft() : false))

  useEffect(() => {
    if (override !== undefined) return
    const refresh = () => setAutoBadge(hasAnyDraft())
    refresh()
    window.addEventListener(REQUEST_DRAFT_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(REQUEST_DRAFT_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [override])

  return override === undefined ? autoBadge : override
}

export default function WorkModeSwitch({
  active,
  showSale,
  showReturn,
  showHistory,
  showScanner,
  showRequest,
  showArena,
  requestBadge,
  onShift,
  onSale,
  onReturn,
  onHistory,
  onScanner,
  onRequest,
  onCabinet,
  onArena,
}: Props) {
  const draftBadge = useRequestDraftBadge(requestBadge)

  return (
    <div className="inline-flex items-center gap-0.5 rounded-xl border border-white/10 bg-muted/40 p-1 no-drag">
      <ModeButton
        active={active === 'shift'}
        label="Смена"
        icon={ReceiptText}
        onClick={onShift}
        disabled={!onShift || active === 'shift'}
      />

      {showSale ? (
        <ModeButton
          active={active === 'sale'}
          label="Продажа"
          icon={ShoppingBasket}
          onClick={onSale}
          disabled={!onSale || active === 'sale'}
        />
      ) : null}

      {showReturn ? (
        <ModeButton
          active={active === 'return'}
          label="Возврат"
          icon={RotateCcw}
          onClick={onReturn}
          disabled={!onReturn || active === 'return'}
        />
      ) : null}

      {showHistory ? (
        <ModeButton
          active={active === 'history'}
          label="История"
          icon={History}
          onClick={onHistory}
          disabled={!onHistory || active === 'history'}
        />
      ) : null}

      {showScanner ? (
        <ModeButton
          active={active === 'scanner'}
          label="Долги"
          icon={ScanBarcode}
          onClick={onScanner}
          disabled={!onScanner || active === 'scanner'}
        />
      ) : null}

      {showRequest ? (
        <ModeButton
          active={active === 'request'}
          label="Заявка"
          icon={ClipboardList}
          onClick={onRequest}
          disabled={!onRequest || active === 'request'}
          badge={draftBadge}
        />
      ) : null}

      {showArena ? (
        <ModeButton
          active={active === 'arena'}
          label="Зал"
          icon={Gamepad2}
          onClick={onArena}
          disabled={!onArena || active === 'arena'}
        />
      ) : null}

      <ModeButton
        active={active === 'cabinet'}
        label="Профиль"
        icon={UserCircle2}
        onClick={onCabinet}
        disabled={!onCabinet || active === 'cabinet'}
      />
    </div>
  )
}
