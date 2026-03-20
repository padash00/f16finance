import { MapPin, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { BootstrapData, OperatorSession } from '@/types'

interface Props {
  sessions: OperatorSession[]  // sessions для разных точек
  onSelect: (session: OperatorSession) => void
}

// Используется когда оператор прикреплён к нескольким точкам
// В текущей архитектуре — один device_token = одна точка,
// поэтому страница используется редко, но готова к расширению.
export default function PointSelectPage({ sessions, onSelect }: Props) {
  return (
    <div className="flex h-screen flex-col bg-background">
      <div className="h-9 drag-region" />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4">
          <div className="text-center space-y-1">
            <MapPin className="mx-auto h-10 w-10 text-muted-foreground" />
            <h1 className="text-lg font-semibold">Выберите точку</h1>
            <p className="text-sm text-muted-foreground">
              Вы прикреплены к нескольким точкам
            </p>
          </div>

          <div className="space-y-2">
            {sessions.map((s, i) => (
              <Card
                key={i}
                className="cursor-pointer hover:bg-accent/50 transition-colors no-drag"
                onClick={() => onSelect(s)}
              >
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium">{s.company.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.operator.role_in_company}
                      {s.operator.is_primary && ' · Основная'}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
