export type CategoryKindValue = 'rules' | 'faq' | 'salary' | 'problem' | 'checklist'
export type SeverityValue = 'info' | 'normal' | 'warning' | 'critical'
export type AnswerTypeValue = 'boolean' | 'text' | 'number' | 'photo' | 'choice'
export type ScheduleTypeValue = 'opening' | 'periodic' | 'closing' | 'onboarding' | 'handover'

export type CategoryEditorValue = {
  id?: string
  company_id: string
  title: string
  description: string
  kind: CategoryKindValue
  sort_order: number | string
  is_active: boolean
}

export const emptyCategoryValue: CategoryEditorValue = {
  company_id: '',
  title: '',
  description: '',
  kind: 'faq',
  sort_order: 100,
  is_active: true,
}

export type ArticleEditorValue = {
  id?: string
  company_id: string
  category_id: string
  title: string
  summary: string
  content: string
  tags: string
  audience: string[]
  severity: SeverityValue
  related_fine_amount: number | string
  related_bonus_amount: number | string
  sort_order: number | string
  is_published: boolean
  requires_confirmation: boolean
}

export const emptyArticleValue: ArticleEditorValue = {
  company_id: '',
  category_id: '',
  title: '',
  summary: '',
  content: '',
  tags: '',
  audience: ['operator', 'cashier', 'manager'],
  severity: 'info',
  related_fine_amount: '',
  related_bonus_amount: '',
  sort_order: 100,
  is_published: true,
  requires_confirmation: false,
}

export type ChecklistTemplateEditorValue = {
  id?: string
  company_id: string
  title: string
  description: string
  role_scope: string
  shift_scope: string
  schedule_type: ScheduleTypeValue
  recurrence_minutes: number | string
  blocks_shift: boolean
  sort_order: number | string
  is_active: boolean
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

export type ChecklistItemEditorValue = {
  id?: string
  template_id: string
  category_id: string
  knowledge_article_id: string
  title: string
  description: string
  answer_type: AnswerTypeValue
  severity: SeverityValue
  fine_amount: number | string
  bonus_amount: number | string
  sort_order: number | string
  is_required: boolean
  requires_photo: boolean
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
