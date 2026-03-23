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
        onClick={onShift}
        disabled={!onShift || active === 'shift'}
        className={`gap-1.5 rounded-lg px-3 ${itemClass(active === 'shift')}`}
      >
        <ReceiptText className="h-4 w-4" />
        Смена
      </Button>

      {showSale ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onSale}
          disabled={!onSale || active === 'sale'}
          className={`gap-1.5 rounded-lg px-3 ${itemClass(active === 'sale')}`}
        >
          <ShoppingBasket className="h-4 w-4" />
          Продажа
        </Button>
      ) : null}

      {showReturn ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onReturn}
          disabled={!onReturn || active === 'return'}
          className={`gap-1.5 rounded-lg px-3 ${itemClass(active === 'return')}`}
        >
          <RotateCcw className="h-4 w-4" />
          Возврат
        </Button>
      ) : null}

      {showScanner ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onScanner}
          disabled={!onScanner || active === 'scanner'}
          className={`gap-1.5 rounded-lg px-3 ${itemClass(active === 'scanner')}`}
        >
          <ScanBarcode className="h-4 w-4" />
          Сканер
        </Button>
      ) : null}

      {showRequest ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRequest}
          disabled={!onRequest || active === 'request'}
          className={`gap-1.5 rounded-lg px-3 ${itemClass(active === 'request')}`}
        >
          <ClipboardList className="h-4 w-4" />
          Заявка
        </Button>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCabinet}
        disabled={!onCabinet || active === 'cabinet'}
        className={`gap-1.5 rounded-lg px-3 ${itemClass(active === 'cabinet')}`}
      >
        <UserCircle2 className="h-4 w-4" />
        Профиль
      </Button>
    </div>
  )
}
