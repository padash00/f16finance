'use client'

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import { Sidebar } from '@/components/sidebar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { supabase } from '@/lib/supabaseClient'
import { 
  ChevronLeft, 
  ChevronRight, 
  CalendarDays, 
  Users, 
  Briefcase,
  RefreshCw, 
  Loader2
} from 'lucide-react'
import {
  startOfWeek,
  endOfWeek,
  addDays,
  format,
  addWeeks,
  subWeeks,
  isSameDay
} from 'date-fns'
import { ru } from 'date-fns/locale/ru'

// --- Типы данных ---
type Company = {
  id: string
  name: string
  code?: string
}

type Shift = {
  id: string
  date: string 
  operator_name: string
  shift_type: 'day' | 'night'
  company_id: string
}

type ShiftCellData = {
  id: string
  name: string
}

// Карта смен
type ShiftsMap = {
  [companyId: string]: {
    [date: string]: {
      day?: ShiftCellData
      night?: ShiftCellData
    }
  }
}

type WeekDay = {
  dateISO: string
  dayName: string
  dayShort: string
  dateObj: Date
}

// --- Хелперы ---
const getWeekDetails = (date: Date): { range: string; days: WeekDay[] } => {
  const start = startOfWeek(date, { weekStartsOn: 1 }) 
  const end = endOfWeek(date, { weekStartsOn: 1 })
  
  const days: WeekDay[] = []
  for (let i = 0; i < 7; i++) {
    const day = addDays(start, i)
    days.push({
      dateISO: format(day, 'yyyy-MM-dd'),
      dayName: format(day, 'eeee', { locale: ru }),
      dayShort: format(day, 'dd.MM'),
      dateObj: day
    })
  }
  
  const range = `${format(start, 'd MMM', { locale: ru })} — ${format(end, 'd MMM', { locale: ru })}`
  return { range, days }
}

// --- ГЛАВНЫЙ КОМПОНЕНТ СТРАНИЦЫ ---
export default function ShiftsPage() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [companies, setCompanies] = useState<Company[]>([])
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const { range: weekRange, days: weekDays } = useMemo(
    () => getWeekDetails(currentDate),
    [currentDate]
  )

  // --- ЗАГРУЗКА ДАННЫХ ---
  const fetchScheduleData = useCallback(async () => {
    console.log('🔄 Обновление данных...')
    
    const weekStart = weekDays[0].dateISO
    const weekEnd = weekDays[6].dateISO

    try {
      const [companiesRes, shiftsRes] = await Promise.all([
        supabase.from('companies').select('id, name, code').order('name'),
        supabase
          .from('shifts')
          .select('id, date, operator_name, shift_type, company_id')
          .gte('date', weekStart)
          .lte('date', weekEnd),
      ])

      if (companiesRes.error) throw companiesRes.error
      if (shiftsRes.error) throw shiftsRes.error

      setCompanies(companiesRes.data || [])
      setShifts(shiftsRes.data || [])
      setError(null)
    } catch (err: any) {
      console.error('❌ Ошибка загрузки:', err)
      setError('Ошибка загрузки: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [weekDays])

  useEffect(() => {
    setLoading(true)
    fetchScheduleData()
  }, [fetchScheduleData])

  // Преобразование в Map для быстрого доступа
  const shiftsMap: ShiftsMap = useMemo(() => {
    return shifts.reduce<ShiftsMap>((acc, shift) => {
      const { company_id, date, shift_type, operator_name, id } = shift
      if (!acc[company_id]) acc[company_id] = {}
      if (!acc[company_id][date]) acc[company_id][date] = {}

      acc[company_id][date][shift_type] = { id, name: operator_name }
      return acc
    }, {})
  }, [shifts])

  const goToPrevWeek = () => setCurrentDate(subWeeks(currentDate, 1))
  const goToNextWeek = () => setCurrentDate(addWeeks(currentDate, 1))
  const goToToday = () => setCurrentDate(new Date())

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto p-4 md:p-8">
        
        {/* Шапка */}
        <div className="flex flex-col md:flex-row justify-between md:items-center mb-8 gap-4">
          <div>
             <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
                <Users className="w-8 h-8 text-purple-500" /> График смен
             </h1>
             <p className="text-muted-foreground text-sm mt-1">
                Управление расписанием операторов
             </p>
          </div>
          
          <Card className="flex items-center p-1 border-border bg-card neon-glow">
             <Button variant="ghost" size="icon" onClick={goToPrevWeek}><ChevronLeft className="w-5 h-5" /></Button>
             
             <div className="px-4 text-center min-w-[160px]">
                <div className="text-sm font-bold flex items-center justify-center gap-2">
                    <CalendarDays className="w-4 h-4 text-accent" />
                    {weekRange}
                </div>
             </div>

             <Button variant="ghost" size="icon" onClick={goToNextWeek}><ChevronRight className="w-5 h-5" /></Button>
             
             <div className="w-px h-6 bg-border mx-1" />
             
             <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => { setLoading(true); fetchScheduleData(); }} 
                title="Обновить данные"
             >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
             </Button>
             
             <Button variant="secondary" size="sm" className="text-xs ml-1" onClick={goToToday}>Сегодня</Button>
          </Card>
        </div>

        <div className="space-y-6">
          {error && (
              <div className="p-4 border border-red-500/30 bg-red-500/10 text-red-400 rounded-lg">
                  {error}
              </div>
          )}

          <ScheduleGrid
            companies={companies}
            weekDays={weekDays}
            shiftsMap={shiftsMap}
            refetchData={fetchScheduleData}
            loading={loading}
          />
        </div>
      </main>
    </div>
  )
}

// --- КОМПОНЕНТ: СЕТКА ГРАФИКА ---
function ScheduleGrid({ companies, weekDays, shiftsMap, refetchData, loading }: any) {
  
  // Фильтрация "General"
  const visibleCompanies = useMemo(() => {
      return companies.filter((c: Company) => {
        const code = (c.code || '').toLowerCase()
        const name = (c.name || '').toLowerCase()
        return code !== 'general' && name !== 'general'
      })
  }, [companies])

  if (loading && companies.length === 0) {
     return <div className="p-12 text-center text-muted-foreground animate-pulse">Загрузка структуры...</div>
  }

  if (visibleCompanies.length === 0) {
    return <p className="text-center text-muted-foreground">Нет активных точек для отображения.</p>
  }
  
  return (
    <div className="grid grid-cols-1 gap-8">
      {visibleCompanies.map((company: Company) => (
        <Card key={company.id} className="p-0 overflow-hidden border-border bg-card neon-glow">
            <div className="p-3 border-b border-border bg-muted/30 flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-accent" />
                <span className="font-bold text-foreground">{company.name}</span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                    <thead>
                        <tr>
                            <th className="p-3 text-left w-24 bg-muted/10 text-muted-foreground font-medium border-b border-border">
                                Смена
                            </th>
                            {weekDays.map((day: WeekDay) => {
                                const isToday = isSameDay(day.dateObj, new Date());
                                return (
                                    <th key={day.dateISO} className={`p-2 text-center border-b border-l border-border min-w-[100px] ${isToday ? 'bg-accent/10' : ''}`}>
                                        <div className={`text-xs uppercase font-bold ${isToday ? 'text-accent' : 'text-muted-foreground'}`}>
                                            {day.dayName}
                                        </div>
                                        <div className={`text-xs ${isToday ? 'text-foreground font-bold' : 'text-muted-foreground/70'}`}>
                                            {day.dayShort}
                                        </div>
                                    </th>
                                )
                            })}
                        </tr>
                    </thead>
                    <tbody>
                        {/* День */}
                        <tr>
                            <td className="p-3 font-semibold text-yellow-500 border-r border-border bg-yellow-500/5">День ☀️</td>
                            {weekDays.map((day: WeekDay) => (
                                <EditableShiftCell
                                    key={`day-${day.dateISO}`}
                                    companyId={company.id}
                                    date={day.dateISO}
                                    shiftType="day"
                                    shiftData={shiftsMap[company.id]?.[day.dateISO]?.['day']}
                                    refetchData={refetchData}
                                />
                            ))}
                        </tr>
                        {/* Ночь */}
                        {(company.code || '').toLowerCase() !== 'extra' && (
                            <tr>
                                <td className="p-3 font-semibold text-blue-400 border-r border-border bg-blue-500/5">Ночь 🌙</td>
                                {weekDays.map((day: WeekDay) => (
                                    <EditableShiftCell
                                        key={`night-${day.dateISO}`}
                                        companyId={company.id}
                                        date={day.dateISO}
                                        shiftType="night"
                                        shiftData={shiftsMap[company.id]?.[day.dateISO]?.['night']}
                                        refetchData={refetchData}
                                    />
                                ))}
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </Card>
      ))}
    </div>
  )
}

// --- КОМПОНЕНТ: УМНАЯ РЕДАКТИРУЕМАЯ ЯЧЕЙКА ---
type EditableCellProps = {
  companyId: string
  date: string
  shiftType: 'day' | 'night'
  shiftData?: ShiftCellData
  refetchData: () => Promise<void>
}

function EditableShiftCell({ companyId, date, shiftType, shiftData, refetchData }: EditableCellProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [val, setVal] = useState(shiftData?.name || '')
  
  // Статусы: idle (обычный), saving (сохраняем), success (готово), error (ошибка)
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle')
  
  const inputRef = useRef<HTMLInputElement>(null)

  // Синхронизация с пропсами (если данные обновились извне)
  useEffect(() => {
      if (!isEditing) {
          setVal(shiftData?.name || '')
      }
  }, [shiftData, isEditing])

  // Фокус при клике
  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isEditing])

  const handleSave = async () => {
    const newName = val.trim()
    const oldName = shiftData?.name || ''

    // Если ничего не изменилось, просто выходим
    if (newName === oldName) {
        setIsEditing(false)
        return
    }

    // Начало сохранения
    setStatus('saving')
    console.log(`💾 Сохранение: ${date} | ${shiftType} | "${oldName}" -> "${newName}"`)

    try {
        let error = null;

        // 1. Если было имя, а стало пусто -> УДАЛЯЕМ
        if (shiftData?.id && !newName) {
            const res = await supabase.from('shifts').delete().eq('id', shiftData.id)
            error = res.error
        } 
        // 2. Если было имя, и новое имя есть -> ОБНОВЛЯЕМ
        else if (shiftData?.id && newName) {
            const res = await supabase.from('shifts').update({ operator_name: newName }).eq('id', shiftData.id)
            error = res.error
        } 
        // 3. Если не было имени, и новое есть -> СОЗДАЕМ
        else if (!shiftData?.id && newName) {
            const res = await supabase.from('shifts').insert({
                company_id: companyId,
                date: date,
                shift_type: shiftType,
                operator_name: newName,
                cash_amount: 0, kaspi_amount: 0, card_amount: 0, debt_amount: 0 // Дефолтные значения
            })
            error = res.error
        }

        if (error) throw error;

        setStatus('success')
        // 🔥 Ждем, пока родитель получит свежие данные из БД
        await refetchData()
        
        setTimeout(() => setStatus('idle'), 1000)

    } catch (e: any) {
        console.error("❌ Ошибка при сохранении:", e)
        setStatus('error')
        alert(`Ошибка: ${e.message}`)
        setVal(oldName) // Возвращаем старое значение
    } finally {
        setIsEditing(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
          e.preventDefault()
          handleSave()
      }
      if (e.key === 'Escape') {
          setVal(shiftData?.name || '')
          setIsEditing(false)
      }
  }

  // Цвет границы в зависимости от статуса
  const getBorderClass = () => {
      if (status === 'saving') return 'bg-blue-500/20 shadow-[inset_0_0_10px_rgba(59,130,246,0.5)]'
      if (status === 'success') return 'bg-green-500/20 shadow-[inset_0_0_10px_rgba(34,197,94,0.5)]'
      if (status === 'error') return 'bg-red-500/20'
      return 'hover:bg-white/5'
  }

  return (
      <td 
        className={`border-l border-border p-0 h-12 relative group transition-all cursor-pointer ${getBorderClass()}`}
        onDoubleClick={() => {
            if (status !== 'saving') setIsEditing(true)
        }}
      >
          {isEditing ? (
              <input 
                 ref={inputRef}
                 value={val}
                 onChange={e => setVal(e.target.value)}
                 onBlur={handleSave}
                 onKeyDown={handleKeyDown}
                 disabled={status === 'saving'}
                 className="w-full h-full bg-background text-center text-sm focus:outline-none focus:ring-2 focus:ring-inset focus:ring-accent font-medium"
              />
          ) : (
              <div className="w-full h-full flex items-center justify-center text-sm">
                  {status === 'saving' ? (
                      <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                  ) : (
                      <span className={val ? "text-foreground font-medium" : "text-muted-foreground/20 group-hover:text-muted-foreground/50 text-xs"}>
                          {val || '—'}
                      </span>
                  )}
              </div>
          )}
      </td>
  )
}