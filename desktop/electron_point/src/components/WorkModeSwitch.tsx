import { ReceiptText, ScanBarcode, UserCircle2 } from 'lucide-react'

import { Button } from '@/components/ui/button'

type WorkMode = 'shift' | 'scanner' | 'cabinet'

interface Props {
  active: WorkMode
  showScanner?: boolean
  onShift?: () => void
  onScanner?: () => void
  onCabinet?: () => void
}

function itemClass(active: boolean) {
  return active
    ? 'bg-background text-foreground shadow-sm'
    : 'text-muted-foreground hover:text-foreground'
}

export default function WorkModeSwitch({
  active,
  showScanner,
  onShift,
  onScanner,
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

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onCabinet}
        disabled={!onCabinet || active === 'cabinet'}
        className={`gap-1.5 rounded-lg px-3 ${itemClass(active === 'cabinet')}`}
      >
        <UserCircle2 className="h-4 w-4" />
        Мое
      </Button>
    </div>
  )
}
