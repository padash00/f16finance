import { ClipboardList, Gamepad2, ReceiptText, RotateCcw, ScanBarcode, ShoppingBasket, UserCircle2, type LucideIcon } from 'lucide-react'

type WorkMode = 'shift' | 'sale' | 'return' | 'scanner' | 'request' | 'cabinet' | 'arena'

interface Props {
  active: WorkMode
  showSale?: boolean
  showReturn?: boolean
  showScanner?: boolean
  showRequest?: boolean
  showArena?: boolean
  onShift?: () => void
  onSale?: () => void
  onReturn?: () => void
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
}: {
  active: boolean
  label: string
  icon: LucideIcon
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={onClick}
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      className={`flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium transition disabled:cursor-default ${
        active
          ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
          : 'text-muted-foreground hover:bg-white/5 hover:text-foreground disabled:opacity-40'
      }`}
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span className="hidden whitespace-nowrap sm:inline">{label}</span>
    </button>
  )
}

export default function WorkModeSwitch({
  active,
  showSale,
  showReturn,
  showScanner,
  showRequest,
  showArena,
  onShift,
  onSale,
  onReturn,
  onScanner,
  onRequest,
  onCabinet,
  onArena,
}: Props) {
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
