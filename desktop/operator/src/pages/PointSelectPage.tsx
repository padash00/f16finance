import { MapPin, ArrowRight, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import type { CompanyOption, OperatorSession } from '@/types'

interface Props {
  session: OperatorSession
  allCompanies: CompanyOption[]
  onSelect: (company: CompanyOption) => void
  onLogout: () => void
}

export default function PointSelectPage({ session, allCompanies, onSelect, onLogout }: Props) {
  const operatorName = session.operator.short_name || session.operator.name || session.operator.username

  return (
    <div className="relative flex h-screen flex-col bg-gradient-to-br from-slate-50 to-slate-100 text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
      <div className="pointer-events-none absolute -top-40 -right-40 h-80 w-80 rounded-full bg-emerald-500/5 blur-3xl dark:bg-emerald-500/10" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-blue-500/5 blur-3xl dark:bg-blue-500/10" />
      <div className="h-9 drag-region" />
      <div className="relative z-10 flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4">
          <div className="text-center space-y-1">
            <MapPin className="mx-auto h-10 w-10 text-slate-500 dark:text-slate-400" />
            <h1 className="text-lg font-semibold">Выберите точку</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {operatorName}, вы прикреплены к нескольким точкам
            </p>
          </div>

          <div className="space-y-2">
            {allCompanies.map((company) => (
              <Card
                key={company.id}
                className="cursor-pointer hover:bg-accent/50 transition-colors no-drag"
                onClick={() => onSelect(company)}
              >
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="text-sm font-medium">{company.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {company.role_in_company}
                      {company.code && ` · ${company.code}`}
                    </p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center no-drag">
            <Button
              variant="ghost"
              size="sm"
              onClick={onLogout}
              className="gap-1.5 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:text-slate-100 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              Выйти
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
