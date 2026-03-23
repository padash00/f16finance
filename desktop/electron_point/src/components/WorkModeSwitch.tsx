import { ClipboardList, ReceiptText, RotateCcw, ScanBarcode, ShoppingBasket, UserCircle2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

type WorkMode = 'shift' | 'sale' | 'return' | 'scanner' | 'request' | 'cabinet'

interface Props {
  active: WorkMode
  showSale?: boolean
  showReturn?: boolean
  showScanner?: boolean
  showRequest?: boolean
  onShift?: () => void
  onSale?: () => void
  onReturn?: () => void
  onScanner?: () => void
  onRequest?: () => void
  onCabinet?: () => void
}

function itemClass(active: boolean) {
  return active
    ? 'bg-background text-foreground shadow-sm'
    : 'text-muted-foreground hover:text-foreground'
}

export default function WorkModeSwitch({
  active,
  showSale,
  showReturn,
  showScanner,
  showRequest,
  onShift,
  onSale,
  onReturn,
  onScanner,
  onRequest,
  onCabinet,
}: Props) {
  return (
    <div className="inline-flex items-center rounded-xl border border-white/10 bg-muted/40 p-1 no-drag">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        title="Смена"
        onClick={onShift}
        disabled={!onShift || active === 'shift'}
        className={`rounded-lg px-2.5 ${itemClass(active === 'shift')}`}
      >
        <ReceiptText className="h-4 w-4" />
      </Button>

      {showSale ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title="Продажа"
          onClick={onSale}
          disabled={!onSale || active === 'sale'}
          className={`rounded-lg px-2.5 ${itemClass(active === 'sale')}`}
        >
          <ShoppingBasket className="h-4 w-4" />
        </Button>
      ) : null}

      {showReturn ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title="Возврат"
          onClick={onReturn}
          disabled={!onReturn || active === 'return'}
          className={`rounded-lg px-2.5 ${itemClass(active === 'return')}`}
        >
          <RotateCcw className="h-4 w-4" />
        </Button>
      ) : null}

      {showScanner ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title="Сканер / Долги"
          onClick={onScanner}
          disabled={!onScanner || active === 'scanner'}
          className={`rounded-lg px-2.5 ${itemClass(active === 'scanner')}`}
        >
          <ScanBarcode className="h-4 w-4" />
        </Button>
      ) : null}

      {showRequest ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          title="Заявка на склад"
          onClick={onRequest}
          disabled={!onRequest || active === 'request'}
          className={`rounded-lg px-2.5 ${itemClass(active === 'request')}`}
        >
          <ClipboardList className="h-4 w-4" />
        </Button>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        title="Мой профиль"
        onClick={onCabinet}
        disabled={!onCabinet || active === 'cabinet'}
        className={`rounded-lg px-2.5 ${itemClass(active === 'cabinet')}`}
      >
        <UserCircle2 className="h-4 w-4" />
      </Button>
    </div>
  )
}
