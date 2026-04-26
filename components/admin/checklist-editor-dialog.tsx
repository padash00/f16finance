'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Camera, CheckCircle2, CheckSquare, ClipboardList, Eye, Plus, Save, Trash2, X } from 'lucide-react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { RichTextEditor } from './rich-text-editor'

type ScheduleType = 'opening' | 'periodic' | 'closing' | 'onboarding' | 'handover'
type Severity = 'info' | 'normal' | 'warning' | 'critical'
type AnswerType = 'boolean' | 'text' | 'number' | 'photo' | 'choice'

export type ChecklistTemplateEditorValue = {
  id?: string
  company_id: string
  title: string
  description: string
  role_scope: string
  shift_scope: string
  schedule_type: ScheduleType
  recurrence_minutes: number | string
  blocks_shift: boolean
  sort_order: number | string
  is_active: boolean
}

export type ChecklistItemEditorValue = {
  id?: string
  template_id: string
  category_id: string
  knowledge_article_id: string
  title: string
  description: string
  answer_type: AnswerType
  severity: Severity
  fine_amount: number | string
  bonus_amount: number | string
  sort_order: number | string
  is_required: boolean
  requires_photo: boolean
}

type ChecklistTemplateOption = {
  id: string
  company_id: string | null
  title: string
  description: string | null
  role_scope: string
  shift_scope: string
  schedule_type: ScheduleType
  recurrence_minutes: number | null
  blocks_shift: boolean
  is_active: boolean
  sort_order: number
}

type ChecklistItemOption = {
  id: string
  template_id: string
  category_id: string | null
  knowledge_article_id: string | null
  title: string
  description: string | null
  answer_type: AnswerType
  is_required: boolean
  requires_photo: boolean
  severity: Severity
  fine_amount: number | null
  bonus_amount: number | null
  sort_order: number
}

type CompanyOption = { id: string; name: string }
type CategoryOption = { id: string; title: string; company_id: string | null; kind: string }
type ArticleOption = { id: string; title: string; company_id: string | null; category_id: string | null }

const SCHEDULE_TYPE_LABELS: Record<ScheduleType, string> = {
  opening: 'Открытие',
  periodic: 'Обход по расписанию',
  closing: 'Закрытие',
  onboarding: 'Онбординг',
  handover: 'Передача смены',
}

const ROLE_SCOPE_LABELS: Record<string, string> = {
  any: 'Любая роль',
  operator: 'Оператор',
  cashier: 'Кассир',
  senior_operator: 'Старший оператор',
  senior_cashier: 'Старший кассир',
}

const SHIFT_SCOPE_LABELS: Record<string, string> = {
  any: 'Любая смена',
  day: 'День',
  night: 'Ночь',
  opening: 'Открытие',
  closing: 'Закрытие',
  handover: 'Передача',
}

const ANSWER_TYPE_LABELS: Record<AnswerType, string> = {
  boolean: 'Галочка',
  text: 'Текст',
  number: 'Число',
  photo: 'Фото',
  choice: 'Выбор',
}

const SEVERITY_LABELS: Record<Severity, string> = {
  info: 'Информация',
  normal: 'Обычно',
  warning: 'Важно',
  critical: 'Критично',
}

export const emptyChecklistTemplateValue: ChecklistTemplateEditorValue = {
  company_id: '',
  title: '',
  description: '',
  role_scope: 'operator',
  shift_scope: 'any',
  schedule_type: 'opening',
  recurrence_minutes: '',
  blocks_shift: false,
  sort_order: 100,
  is_active: true,
}

export const emptyChecklistItemValue: ChecklistItemEditorValue = {
  template_id: '',
  category_id: '',
  knowledge_article_id: '',
  title: '',
  description: '',
  answer_type: 'boolean',
  severity: 'normal',
  fine_amount: '',
  bonus_amount: '',
  sort_order: 100,
  is_required: true,
  requires_photo: false,
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialTemplate?: ChecklistTemplateEditorValue
  initialItem?: ChecklistItemEditorValue
  initialMode?: 'template' | 'item'
  templates: ChecklistTemplateOption[]
  items: ChecklistItemOption[]
  categories: CategoryOption[]
  articles: ArticleOption[]
  companies: CompanyOption[]
  saving: boolean
  onSubmitTemplate: (value: ChecklistTemplateEditorValue) => Promise<void> | void
  onSubmitItem: (value: ChecklistItemEditorValue) => Promise<void> | void
  onDeleteItem: (item: ChecklistItemOption) => Promise<void> | void
}

export function ChecklistEditorDialog({
  open,
  onOpenChange,
  initialTemplate,
  initialItem,
  initialMode = 'template',
  templates,
  items,
  categories,
  articles,
  companies,
  saving,
  onSubmitTemplate,
  onSubmitItem,
  onDeleteItem,
}: Props) {
  const [activeTab, setActiveTab] = useState<'settings' | 'items' | 'preview'>(initialMode === 'item' ? 'items' : 'settings')
  const [templateValue, setTemplateValue] = useState<ChecklistTemplateEditorValue>(initialTemplate || emptyChecklistTemplateValue)
  const [itemValue, setItemValue] = useState<ChecklistItemEditorValue>(initialItem || emptyChecklistItemValue)

  useEffect(() => {
    if (!open) return
    setTemplateValue(initialTemplate || emptyChecklistTemplateValue)
    setItemValue(initialItem || { ...emptyChecklistItemValue, template_id: initialTemplate?.id || templates[0]?.id || '' })
    setActiveTab(initialMode === 'item' ? 'items' : 'settings')
  }, [open, initialTemplate, initialItem, initialMode, templates])

  const selectedTemplateId = itemValue.template_id || templateValue.id || ''
  const templateItems = useMemo(() => {
    return items
      .filter((item) => item.template_id === selectedTemplateId)
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title))
  }, [items, selectedTemplateId])

  const filteredCategories = categories.filter((category) => {
    return !templateValue.company_id || !category.company_id || category.company_id === templateValue.company_id
  })

  const filteredArticles = articles.filter((article) => {
    const companyAllowed = !templateValue.company_id || !article.company_id || article.company_id === templateValue.company_id
    const categoryAllowed = !itemValue.category_id || !article.category_id || article.category_id === itemValue.category_id
    return companyAllowed && categoryAllowed
  })

  const isEditingTemplate = Boolean(templateValue.id)
  const isEditingItem = Boolean(itemValue.id)
  const canEditItems = templates.length > 0 || Boolean(templateValue.id)

  const resetItemForTemplate = (templateId = selectedTemplateId) => {
    setItemValue({
      ...emptyChecklistItemValue,
      template_id: templateId,
      sort_order: templateItems.length * 10 + 100,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="!max-w-[1180px] flex h-[92vh] flex-col gap-0 overflow-hidden border-slate-800 bg-slate-950 p-0 text-slate-100"
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/80 px-6 py-4">
          <div className="min-w-0">
            <DialogTitle className="text-base font-black text-amber-100">
              {isEditingTemplate ? 'Редактор чек-листа' : 'Новый чек-лист'}
            </DialogTitle>
            <p className="mt-1 text-xs text-slate-500">Сценарий, пункты проверки и предпросмотр для оператора в одном окне.</p>
          </div>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="grid h-9 w-9 place-items-center rounded-xl border border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-slate-800 bg-slate-950/80 px-6 py-3">
          <TabButton active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} icon={<ClipboardList className="h-4 w-4" />}>
            Настройки
          </TabButton>
          <TabButton active={activeTab === 'items'} onClick={() => setActiveTab('items')} icon={<CheckSquare className="h-4 w-4" />}>
            Пункты ({templateItems.length})
          </TabButton>
          <TabButton active={activeTab === 'preview'} onClick={() => setActiveTab('preview')} icon={<Eye className="h-4 w-4" />}>
            Предпросмотр
          </TabButton>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {activeTab === 'settings' && (
            <form
              className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]"
              onSubmit={async (event) => {
                event.preventDefault()
                await onSubmitTemplate(templateValue)
              }}
            >
              <div className="space-y-5">
                <Section title="Основное" hint="Название, точка и описание, чтобы оператор понял контекст проверки.">
                  <div className="space-y-2">
                    <Label>Название чек-листа</Label>
                    <Input value={templateValue.title} onChange={(event) => setTemplateValue({ ...templateValue, title: event.target.value })} required />
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Точка</Label>
                      <Select value={templateValue.company_id} onChange={(event) => setTemplateValue({ ...templateValue, company_id: event.target.value })}>
                        <option value="">Для всех точек</option>
                        {companies.map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Порядок</Label>
                      <Input value={templateValue.sort_order} onChange={(event) => setTemplateValue({ ...templateValue, sort_order: event.target.value })} inputMode="numeric" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Описание для оператора</Label>
                    <textarea
                      value={templateValue.description}
                      onChange={(event) => setTemplateValue({ ...templateValue, description: event.target.value })}
                      className="min-h-24 w-full rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none focus:border-amber-400/80"
                      placeholder="Например: перед открытием смены проверь кассу, чистоту, технику и готовность точки."
                    />
                  </div>
                </Section>

                <Section title="Когда показывать" hint="Задаёт момент, смену и роль, для которых чек-лист должен появляться.">
                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Сценарий</Label>
                      <Select
                        value={templateValue.schedule_type}
                        onChange={(event) => setTemplateValue({ ...templateValue, schedule_type: event.target.value as ScheduleType })}
                      >
                        {Object.entries(SCHEDULE_TYPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Роль</Label>
                      <Select value={templateValue.role_scope} onChange={(event) => setTemplateValue({ ...templateValue, role_scope: event.target.value })}>
                        {Object.entries(ROLE_SCOPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Смена</Label>
                      <Select value={templateValue.shift_scope} onChange={(event) => setTemplateValue({ ...templateValue, shift_scope: event.target.value })}>
                        {Object.entries(SHIFT_SCOPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                  {templateValue.schedule_type === 'periodic' && (
                    <div className="space-y-2">
                      <Label>Повторять каждые N минут</Label>
                      <Input
                        value={templateValue.recurrence_minutes}
                        onChange={(event) => setTemplateValue({ ...templateValue, recurrence_minutes: event.target.value })}
                        inputMode="numeric"
                        placeholder="60"
                      />
                    </div>
                  )}
                </Section>
              </div>

              <div className="space-y-4">
                <div className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-4">
                  <p className="text-sm font-black text-amber-100">Умные флаги</p>
                  <div className="mt-3 space-y-3">
                    <Toggle checked={templateValue.blocks_shift} onChange={(checked) => setTemplateValue({ ...templateValue, blocks_shift: checked })}>
                      Блокировать смену, пока не выполнен
                    </Toggle>
                    <Toggle checked={templateValue.is_active} onChange={(checked) => setTemplateValue({ ...templateValue, is_active: checked })}>
                      Активен для операторов
                    </Toggle>
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-800 bg-slate-950/50 p-4">
                  <p className="text-sm font-black text-slate-100">Как это сработает</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-400">
                    <SmartLine ok={!!templateValue.title}>Оператор увидит понятное название сценария.</SmartLine>
                    <SmartLine ok={templateItems.length > 0}>Внутри есть пункты проверки.</SmartLine>
                    <SmartLine ok={templateItems.some((item) => item.requires_photo)}>Есть хотя бы один пункт с фото-подтверждением.</SmartLine>
                    <SmartLine ok={templateValue.blocks_shift}>Смена не пройдет дальше без выполнения.</SmartLine>
                  </div>
                </div>
              </div>
            </form>
          )}

          {activeTab === 'items' && (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
              <div className="space-y-3">
                <div className="rounded-3xl border border-slate-800 bg-slate-900/45 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-black text-slate-100">Пункты чек-листа</p>
                      <p className="mt-1 text-xs text-slate-500">Оператор проходит их сверху вниз. Важные пункты можно сделать обязательными и с фото.</p>
                    </div>
                    <button
                      type="button"
                      disabled={!canEditItems}
                      onClick={() => resetItemForTemplate()}
                      className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-black text-emerald-100 hover:bg-emerald-400/15 disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4" />
                      Новый пункт
                    </button>
                  </div>
                </div>

                {!canEditItems && (
                  <div className="rounded-3xl border border-amber-300/25 bg-amber-300/10 p-5 text-sm leading-6 text-amber-50">
                    Сначала сохраните чек-лист. После этого можно будет добавлять пункты проверки.
                  </div>
                )}

                {templateItems.map((item, index) => (
                  <button
                    type="button"
                    key={item.id}
                    onClick={() =>
                      setItemValue({
                        ...item,
                        category_id: item.category_id || '',
                        knowledge_article_id: item.knowledge_article_id || '',
                        description: item.description || '',
                        fine_amount: item.fine_amount ?? '',
                        bonus_amount: item.bonus_amount ?? '',
                      })
                    }
                    className={`w-full rounded-3xl border p-4 text-left transition ${
                      itemValue.id === item.id
                        ? 'border-amber-300/60 bg-amber-300/10'
                        : 'border-slate-800 bg-slate-950/45 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-black text-amber-100">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-black text-slate-100">{item.title}</p>
                        <RichDescription html={item.description} className="mt-1 text-xs leading-5 text-slate-500" empty="Описание не заполнено." />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge>{ANSWER_TYPE_LABELS[item.answer_type]}</Badge>
                          {item.is_required ? <Badge>обязательный</Badge> : null}
                          {item.requires_photo ? <Badge>фото</Badge> : null}
                          {item.fine_amount ? <Badge>штраф {formatMoney(item.fine_amount)}</Badge> : null}
                          {item.bonus_amount ? <Badge>бонус {formatMoney(item.bonus_amount)}</Badge> : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          void onDeleteItem(item)
                        }}
                        className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </button>
                ))}

                {!templateItems.length && canEditItems && (
                  <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-sm text-slate-500">
                    Пунктов пока нет. Нажмите “Новый пункт” и опишите первую проверку.
                  </div>
                )}
              </div>

              <form
                className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/45 p-4"
                onSubmit={async (event) => {
                  event.preventDefault()
                  await onSubmitItem(itemValue)
                }}
              >
                <div>
                  <p className="text-sm font-black text-slate-100">{isEditingItem ? 'Редактировать пункт' : 'Новый пункт'}</p>
                  <p className="mt-1 text-xs text-slate-500">Здесь настраивается конкретная проверка для оператора.</p>
                </div>

                <div className="space-y-2">
                  <Label>Чек-лист</Label>
                  <Select value={itemValue.template_id} onChange={(event) => setItemValue({ ...itemValue, template_id: event.target.value })} required>
                    <option value="">Выберите чек-лист</option>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.title}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Название пункта</Label>
                  <Input value={itemValue.title} onChange={(event) => setItemValue({ ...itemValue, title: event.target.value })} required disabled={!canEditItems} />
                </div>

                <div className="space-y-2">
                  <Label>Инструкция оператору</Label>
                  {canEditItems ? (
                    <RichTextEditor
                      value={itemValue.description}
                      onChange={(html) => setItemValue({ ...itemValue, description: html })}
                    />
                  ) : (
                    <div className="rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3 text-sm text-slate-500 opacity-50">
                      Сначала сохраните чек-лист, чтобы заполнить инструкцию.
                    </div>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Ответ</Label>
                    <Select value={itemValue.answer_type} onChange={(event) => setItemValue({ ...itemValue, answer_type: event.target.value as AnswerType })} disabled={!canEditItems}>
                      {Object.entries(ANSWER_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Важность</Label>
                    <Select value={itemValue.severity} onChange={(event) => setItemValue({ ...itemValue, severity: event.target.value as Severity })} disabled={!canEditItems}>
                      {Object.entries(SEVERITY_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Категория FAQ</Label>
                    <Select value={itemValue.category_id} onChange={(event) => setItemValue({ ...itemValue, category_id: event.target.value })} disabled={!canEditItems}>
                      <option value="">Без категории</option>
                      {filteredCategories.map((category) => (
                        <option key={category.id} value={category.id}>
                          {category.title}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Связанная статья</Label>
                    <Select value={itemValue.knowledge_article_id} onChange={(event) => setItemValue({ ...itemValue, knowledge_article_id: event.target.value })} disabled={!canEditItems}>
                      <option value="">Без статьи</option>
                      {filteredArticles.map((article) => (
                        <option key={article.id} value={article.id}>
                          {article.title}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Штраф ₸</Label>
                    <Input value={itemValue.fine_amount} onChange={(event) => setItemValue({ ...itemValue, fine_amount: event.target.value })} inputMode="numeric" disabled={!canEditItems} />
                  </div>
                  <div className="space-y-2">
                    <Label>Бонус ₸</Label>
                    <Input value={itemValue.bonus_amount} onChange={(event) => setItemValue({ ...itemValue, bonus_amount: event.target.value })} inputMode="numeric" disabled={!canEditItems} />
                  </div>
                  <div className="space-y-2">
                    <Label>Порядок</Label>
                    <Input value={itemValue.sort_order} onChange={(event) => setItemValue({ ...itemValue, sort_order: event.target.value })} inputMode="numeric" disabled={!canEditItems} />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Toggle checked={itemValue.is_required} onChange={(checked) => setItemValue({ ...itemValue, is_required: checked })} disabled={!canEditItems}>
                    Обязательный пункт
                  </Toggle>
                  <Toggle checked={itemValue.requires_photo} onChange={(checked) => setItemValue({ ...itemValue, requires_photo: checked })} disabled={!canEditItems}>
                    Требует фото
                  </Toggle>
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => resetItemForTemplate()}
                    className="rounded-2xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:border-slate-500"
                  >
                    Очистить
                  </button>
                  <button
                    type="submit"
                    disabled={saving || !canEditItems}
                    className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-cyan-500 px-5 py-2.5 text-sm font-black text-slate-950 transition hover:brightness-110 disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {isEditingItem ? 'Сохранить пункт' : 'Добавить пункт'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="mx-auto max-w-3xl rounded-[2rem] border border-slate-800 bg-slate-900/45 p-5">
              <div className="rounded-3xl border border-amber-300/20 bg-gradient-to-br from-slate-950 to-slate-900 p-5">
                <div className="flex items-start gap-4">
                  <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-amber-300/15 text-amber-100">
                    <ClipboardList className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap gap-2">
                      <Badge>{SCHEDULE_TYPE_LABELS[templateValue.schedule_type]}</Badge>
                      <Badge>{ROLE_SCOPE_LABELS[templateValue.role_scope] || templateValue.role_scope}</Badge>
                      <Badge>{templateValue.blocks_shift ? 'Блокирует смену' : 'Не блокирует'}</Badge>
                    </div>
                    <h3 className="mt-3 break-words text-2xl font-black text-white">{templateValue.title || 'Название чек-листа'}</h3>
                    <p className="mt-2 break-words text-sm leading-6 text-slate-400">
                      {templateValue.description || 'Описание увидит оператор перед прохождением чек-листа.'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {templateItems.map((item, index) => (
                  <div key={item.id} className="rounded-3xl border border-slate-800 bg-slate-950/50 p-4">
                    <div className="flex items-start gap-3">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-black text-amber-100">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-black text-slate-100">{item.title}</p>
                        <RichDescription html={item.description} className="mt-1 text-xs leading-5 text-slate-500" empty="Инструкция не заполнена." />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge>{ANSWER_TYPE_LABELS[item.answer_type]}</Badge>
                          {item.is_required ? <Badge>обязательно</Badge> : null}
                          {item.requires_photo ? <Badge>нужно фото</Badge> : null}
                        </div>
                      </div>
                      {item.requires_photo ? <Camera className="h-5 w-5 shrink-0 text-sky-300" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-300" />}
                    </div>
                  </div>
                ))}
                {!templateItems.length && (
                  <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-sm text-slate-500">
                    После добавления пунктов здесь будет видно, как чек-лист выглядит для оператора.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-800 bg-slate-900/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-500">
            Совет: сначала сохраните сценарий, потом добавляйте пункты и проверьте вкладку “Предпросмотр”.
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-2xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-300 hover:border-slate-500"
            >
              Закрыть
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                await onSubmitTemplate(templateValue)
              }}
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 px-5 py-2.5 text-sm font-black text-slate-950 transition hover:brightness-110 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isEditingTemplate ? 'Сохранить чек-лист' : 'Создать чек-лист'}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/45 p-5">
      <div>
        <p className="text-sm font-black text-slate-100">{title}</p>
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      </div>
      {children}
    </section>
  )
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-2xl border px-4 py-2 text-sm font-bold transition ${
        active ? 'border-amber-300/60 bg-amber-300/15 text-amber-100' : 'border-slate-800 bg-slate-950/50 text-slate-400 hover:border-slate-600'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function SmartLine({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />}
      <span>{children}</span>
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  children,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <label className={`flex items-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/50 px-4 py-3 text-sm text-slate-300 ${disabled ? 'opacity-50' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      {children}
    </label>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="max-w-full break-words rounded-full border border-amber-300/25 bg-amber-300/10 px-2.5 py-1 text-[11px] font-bold text-amber-100">
      {children}
    </span>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{children}</label>
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none focus:border-amber-400/80 disabled:opacity-50 ${props.className ?? ''}`}
    />
  )
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full rounded-2xl border border-slate-700/70 bg-slate-950/70 px-4 py-3 text-sm text-slate-100 outline-none focus:border-amber-400/80 disabled:opacity-50 ${props.className ?? ''}`}
    />
  )
}

function formatMoney(value: number | null | undefined) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount) || amount === 0) return ''
  return `${amount.toLocaleString('ru-RU')} ₸`
}

function RichDescription({ html, className, empty }: { html: string | null | undefined; className?: string; empty: string }) {
  const trimmed = (html || '').replace(/<p>\s*<\/p>/g, '').trim()
  if (!trimmed) return <p className={`break-words ${className ?? ''}`}>{empty}</p>
  return (
    <div
      className={`break-words [&_p]:my-1 [&_h1]:my-1.5 [&_h1]:text-sm [&_h1]:font-black [&_h2]:my-1.5 [&_h2]:text-sm [&_h2]:font-black [&_h3]:my-1 [&_h3]:font-bold [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_strong]:font-black [&_em]:italic [&_u]:underline [&_a]:text-amber-300 [&_a]:underline [&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-amber-300/50 [&_blockquote]:pl-3 [&_blockquote]:italic [&_code]:rounded [&_code]:bg-slate-800/80 [&_code]:px-1 [&_mark]:rounded [&_mark]:px-1 [&_img]:my-2 [&_img]:max-h-40 [&_img]:rounded [&_table]:my-2 [&_th]:border [&_th]:border-slate-700 [&_th]:bg-slate-800 [&_th]:px-2 [&_th]:py-1 [&_td]:border [&_td]:border-slate-700 [&_td]:px-2 [&_td]:py-1 ${className ?? ''}`}
      dangerouslySetInnerHTML={{ __html: trimmed }}
    />
  )
}
