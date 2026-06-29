'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { AppModal } from '@/components/ui/app-modal'
import { getPublicAppUrl } from '@/lib/core/app-url'
import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { supabase } from '@/lib/supabaseClient'
import { useCapabilities } from '@/lib/client/use-capabilities'
import {
  ArrowLeft,
  User,
  Calendar,
  Phone,
  Mail,
  MapPin,
  Briefcase,
  Building2,
  CreditCard,
  FileText,
  Award,
  AlertCircle,
  Edit,
  Save,
  X,
  Plus,
  Upload,
  Clock,
  Heart,
  BookOpen,
  Languages,
  Shield,
  Download,
  Printer,
  MoreVertical,
  Check,
  AlertTriangle,
  Info,
  Camera,
  Github,
  Linkedin,
  Facebook,
  Twitter,
  Instagram,
  Globe,
  Cake,
  Users,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Activity,
  FileSignature,
  ShieldCheck,
  HeartPulse,
  Stethoscope,
  Syringe,
  Pill,
  Baby,
  Accessibility,
  Eye,
  EyeOff,
  Loader2,
  Building,
  CalendarDays,
  BriefcaseBusiness,
  Network,
  Link as LinkIcon,
  Unlink,
  RefreshCw,
  UserPlus,
  Key,
  Copy,
  Send,
} from 'lucide-react'

// Типы данных
type Operator = {
  id: string
  name: string
  role: string | null
  is_active: boolean
  created_at: string
  short_name: string | null
  telegram_chat_id: string | null
}

type Company = {
  id: string
  name: string
  code: string
}

type OperatorProfile = {
  id: string
  operator_id: string
  full_name: string | null
  birth_date: string | null
  phone: string | null
  email: string | null
  address: string | null
  photo_url: string | null
  hire_date: string | null
  employment_type: string | null
  position: string | null
  department: string | null
  emergency_contact_name: string | null
  emergency_contact_phone: string | null
  emergency_contact_relation: string | null
  id_number: string | null
  id_expiry_date: string | null
  tax_number: string | null
  bank_name: string | null
  bank_account: string | null
  bank_card_number: string | null
  notes: string | null
  education: string | null
  skills: string[] | null
  languages: string[] | null
  blood_type: string | null
  allergies: string | null
  medical_conditions: string | null
  created_at: string
  updated_at: string
}

type WorkHistory = {
  id: string
  operator_id: string
  company_id: string | null
  company_name?: string
  company_code?: string
  position: string
  start_date: string
  end_date: string | null
  is_current: boolean
  salary: number | null
  salary_type: string | null
  responsibilities: string | null
  achievements: string | null
  reason_for_leaving: string | null
}

type Document = {
  id: string
  operator_id: string
  document_type: string
  document_name: string
  document_url: string
  document_number: string | null
  issue_date: string | null
  expiry_date: string | null
  is_verified: boolean
  notes: string | null
  created_at: string
}

type Note = {
  id: string
  operator_id: string
  note: string
  note_type: string
  created_by: string | null
  created_at: string
  created_by_name?: string
}

type OperatorAccount = {
  id: string
  operator_id: string
  user_id: string
  username: string
  role: string
  created_at: string
  last_login: string | null
  is_active: boolean
}

type CareerRole = string
type CompanyOperatorRole = 'operator' | 'senior_operator' | 'senior_cashier'

type SessionRoleInfo = {
  isSuperAdmin?: boolean
  staffRole?: CareerRole
}

type OperatorCompanyAssignment = {
  id: string
  operator_id: string
  company_id: string
  role_in_company: CompanyOperatorRole
  is_primary: boolean
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
  company: {
    id: string
    name: string
    code: string | null
  } | null
}

type OperatorCareerLink = {
  id: string
  assigned_role: CareerRole
  assigned_at: string
  updated_at: string
  staff: {
    id: string
    full_name: string | null
    short_name: string | null
    role: CareerRole | null
    monthly_salary: number | null
    email: string | null
    phone: string | null
    hire_date: string | null
    is_active: boolean
  } | null
}

const CAREER_ROLE_LABEL: Record<CareerRole, string> = {
  manager: 'Руководитель',
  marketer: 'Маркетолог',
  owner: 'Владелец',
  other: 'Без роли',
}

const COMPANY_ROLE_LABEL: Record<CompanyOperatorRole, string> = {
  operator: 'Оператор',
  senior_operator: 'Старший оператор',
  senior_cashier: 'Старший кассир',
}

// Компонент загрузки
function ProfileLoading() {
  return (
    <>
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
            <User className="w-8 h-8 text-white" />
          </div>
          <p className="text-slate-500 dark:text-gray-400">Загрузка профиля оператора...</p>
        </div>
    </>
  )
}

// Компонент для отображения созданного аккаунта
function AccountInfo({ account, onCopyUsername, onCopyPassword, onClose }: { 
  account: { username: string; password: string } | null
  onCopyUsername: () => void
  onCopyPassword: () => void
  onClose: () => void
}) {
  if (!account) return null
  const publicAppUrl =
    typeof window !== 'undefined' ? getPublicAppUrl(window.location.origin) : getPublicAppUrl()

  return (
    <AppModal
      open={!!account}
      onClose={onClose}
      maxWidth="max-w-md"
      title={
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/20"><Key className="w-5 h-5 text-emerald-400" /></div>
          <span>Аккаунт создан!</span>
        </div>
      }
      footer={
        <div className="flex justify-end">
          <Button onClick={onClose} className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white">
            <Check className="w-4 h-4 mr-2" />Понятно
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
          <p className="text-sm text-emerald-400 mb-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            Сохраните данные! Они показываются только один раз.
          </p>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Логин</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-slate-100 dark:bg-gray-800 rounded-lg text-sm font-mono text-foreground">{account.username}</code>
                <button onClick={onCopyUsername} className="p-2 bg-slate-100 dark:bg-gray-800 hover:bg-slate-200 dark:hover:bg-gray-700 rounded-lg transition-colors" title="Копировать логин"><Copy className="w-4 h-4 text-slate-500 dark:text-gray-400" /></button>
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Пароль</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 p-2 bg-slate-100 dark:bg-gray-800 rounded-lg text-sm font-mono text-foreground">{account.password}</code>
                <button onClick={onCopyPassword} className="p-2 bg-slate-100 dark:bg-gray-800 hover:bg-slate-200 dark:hover:bg-gray-700 rounded-lg transition-colors" title="Копировать пароль"><Copy className="w-4 h-4 text-slate-500 dark:text-gray-400" /></button>
              </div>
            </div>
          </div>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
          <p className="text-sm text-blue-400 mb-2">Ссылка для входа:</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 p-2 bg-slate-100 dark:bg-gray-800 rounded-lg text-xs text-foreground truncate">{`${publicAppUrl}/operator-login`}</code>
            <button
              onClick={() => { if (typeof window !== 'undefined') navigator.clipboard.writeText(`${publicAppUrl}/operator-login`) }}
              className="p-2 bg-slate-100 dark:bg-gray-800 hover:bg-slate-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
              title="Копировать ссылку"
            ><Copy className="w-4 h-4 text-slate-500 dark:text-gray-400" /></button>
          </div>
        </div>
      </div>
    </AppModal>
  )
}

// Компонент загрузки аватара
function AvatarUpload({
  operatorId,
  currentAvatarUrl,
  onUploadComplete,
  onError,
  canUpload = true,
}: {
  operatorId: string
  currentAvatarUrl: string | null
  onUploadComplete: (url: string) => void
  onError: (error: string) => void
  canUpload?: boolean
}) {
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentAvatarUrl)

  const uploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true)
      
      const file = event.target.files?.[0]
      if (!file) return

      if (!file.type.startsWith('image/')) {
        onError('Пожалуйста, выберите изображение')
        return
      }

      if (file.size > 5 * 1024 * 1024) {
        onError('Файл слишком большой. Максимальный размер 5MB')
        return
      }

      const objectUrl = URL.createObjectURL(file)
      setPreviewUrl(objectUrl)

      const fileExt = file.name.split('.').pop()
      const fileName = `${operatorId}-${Date.now()}.${fileExt}`
      const filePath = `avatars/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('operator-files')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('operator-files')
        .getPublicUrl(filePath)

      const patchRes = await fetch('/api/admin/operators/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator_id: operatorId, photo_url: publicUrl }),
      })
      if (!patchRes.ok) {
        const errJson = await patchRes.json().catch(() => ({}))
        throw new Error(errJson?.error || 'Ошибка обновления фото')
      }

      onUploadComplete(publicUrl)
      
    } catch (error: any) {
      console.error('Error uploading avatar:', error)
      onError(error.message || 'Ошибка при загрузке фото')
      setPreviewUrl(currentAvatarUrl)
    } finally {
      setUploading(false)
    }
  }

  const removeAvatar = async () => {
    if (!currentAvatarUrl) return

    try {
      setUploading(true)

      const patchRes = await fetch('/api/admin/operators/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operator_id: operatorId, photo_url: null }),
      })
      if (!patchRes.ok) {
        const errJson = await patchRes.json().catch(() => ({}))
        throw new Error(errJson?.error || 'Ошибка удаления фото')
      }

      setPreviewUrl(null)
      onUploadComplete('')

    } catch (error: any) {
      console.error('Error removing avatar:', error)
      onError(error.message || 'Ошибка при удалении фото')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="relative group">
      <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center overflow-hidden">
        {previewUrl ? (
          <Image
            src={previewUrl}
            alt="Avatar"
            width={80}
            height={80}
            className="object-cover w-full h-full"
          />
        ) : (
          <User className="w-8 h-8 text-white" />
        )}
      </div>

      {canUpload && (
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 rounded-2xl">
          <label className="cursor-pointer p-2 hover:bg-white/20 rounded-lg transition-colors">
            {uploading ? (
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            ) : (
              <>
                <Camera className="w-5 h-5 text-white" />
                <input
                  type="file"
                  accept="image/*"
                  onChange={uploadAvatar}
                  className="hidden"
                  disabled={uploading}
                />
              </>
            )}
          </label>
          {previewUrl && !uploading && (
            <button
              onClick={removeAvatar}
              className="p-2 hover:bg-white/20 rounded-lg transition-colors ml-1"
              title="Удалить фото"
            >
              <X className="w-5 h-5 text-white" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Компонент загрузки документов
const DOCUMENT_TYPES = [
  { value: 'passport', label: 'Паспорт' },
  { value: 'id_card', label: 'Удостоверение личности' },
  { value: 'contract', label: 'Трудовой договор' },
  { value: 'diploma', label: 'Диплом' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'medical_book', label: 'Медицинская книжка' },
  { value: 'other', label: 'Другое' }
]

function DocumentUpload({ 
  operatorId, 
  onUploadComplete, 
  onError 
}: { 
  operatorId: string
  onUploadComplete: (document: Document) => void
  onError: (error: string) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [documentType, setDocumentType] = useState('')
  const [documentName, setDocumentName] = useState('')
  const [documentNumber, setDocumentNumber] = useState('')
  const [issueDate, setIssueDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (file.size > 10 * 1024 * 1024) {
      onError('Файл слишком большой. Максимальный размер 10MB')
      return
    }

    setSelectedFile(file)
    setDocumentName(file.name)
  }

  const uploadDocument = async () => {
    if (!selectedFile || !documentType) {
      onError('Выберите файл и тип документа')
      return
    }

    try {
      setUploading(true)

      const fileExt = selectedFile.name.split('.').pop()
      const fileName = `${operatorId}/${documentType}-${Date.now()}.${fileExt}`
      const filePath = `documents/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('operator-files')
        .upload(filePath, selectedFile)

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('operator-files')
        .getPublicUrl(filePath)

      const { data, error: dbError } = await supabase
        .from('operator_documents')
        .insert({
          operator_id: operatorId,
          document_type: documentType,
          document_name: documentName || selectedFile.name,
          document_url: publicUrl,
          document_number: documentNumber || null,
          issue_date: issueDate || null,
          expiry_date: expiryDate || null,
          is_verified: false
        })
        .select()
        .single()

      if (dbError) throw dbError

      onUploadComplete(data)
      
      setShowForm(false)
      setSelectedFile(null)
      setDocumentType('')
      setDocumentName('')
      setDocumentNumber('')
      setIssueDate('')
      setExpiryDate('')

    } catch (error: any) {
      console.error('Error uploading document:', error)
      onError(error.message || 'Ошибка при загрузке документа')
    } finally {
      setUploading(false)
    }
  }

  if (!showForm) {
    return (
      <Button
        onClick={() => setShowForm(true)}
        size="sm"
        className="bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 border border-violet-500/30"
      >
        <Upload className="w-4 h-4 mr-2" />
        Загрузить документ
      </Button>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800/30 rounded-xl p-4 border border-slate-200 dark:border-white/5">
      <div className="flex justify-between items-center mb-3">
        <h4 className="text-sm font-medium">Новый документ</h4>
        <button
          onClick={() => setShowForm(false)}
          className="p-1 hover:bg-surface-hover rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Тип документа *</label>
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
          >
            <option value="">Выберите тип</option>
            {DOCUMENT_TYPES.map(type => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Файл *</label>
          <div className="flex items-center gap-2">
            <input
              type="file"
              onChange={handleFileSelect}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="flex-1 px-3 py-2 bg-white dark:bg-gray-800/50 border border-border rounded-lg text-sm cursor-pointer hover:bg-slate-50 dark:hover:bg-gray-700/50 transition-colors truncate"
            >
              {selectedFile ? selectedFile.name : 'Выберите файл'}
            </label>
          </div>
        </div>

        <div>
          <label className="text-xs text-gray-500 mb-1 block">Номер документа</label>
          <input
            type="text"
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
            className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
            placeholder="Например: N 123456"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Дата выдачи</label>
            <DatePicker value={issueDate} onChange={setIssueDate} className="w-full" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Действителен до</label>
            <DatePicker value={expiryDate} onChange={setExpiryDate} className="w-full" />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button
            size="sm"
            onClick={() => setShowForm(false)}
            variant="outline"
            className="border-border"
          >
            Отмена
          </Button>
          <Button
            size="sm"
            onClick={uploadDocument}
            disabled={uploading || !selectedFile || !documentType}
            className="bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            {uploading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            Загрузить
          </Button>
        </div>
      </div>
    </div>
  )
}

// Компонент списка документов
function DocumentList({ 
  documents, 
  onVerify, 
  onDelete, 
  formatDate 
}: { 
  documents: Document[]
  onVerify?: (documentId: string) => void
  onDelete?: (documentId: string) => void
  formatDate: (date: string | null) => string
}) {
  const [verifying, setVerifying] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const handleVerify = async (documentId: string) => {
    try {
      setVerifying(documentId)
      
      const { error } = await supabase
        .from('operator_documents')
        .update({
          is_verified: true,
          verified_at: new Date().toISOString()
        })
        .eq('id', documentId)

      if (error) throw error

      if (onVerify) onVerify(documentId)
    } catch (error) {
      console.error('Error verifying document:', error)
    } finally {
      setVerifying(null)
    }
  }

  const handleDelete = async (documentId: string) => {
    if (!confirm('Вы уверены, что хотите удалить этот документ?')) return

    try {
      setDeleting(documentId)

      const { error } = await supabase
        .from('operator_documents')
        .delete()
        .eq('id', documentId)

      if (error) throw error

      if (onDelete) onDelete(documentId)
    } catch (error) {
      console.error('Error deleting document:', error)
    } finally {
      setDeleting(null)
    }
  }

  const handleView = (url: string) => {
    window.open(url, '_blank')
  }

  const handleDownload = async (url: string, fileName: string) => {
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(downloadUrl)
    } catch (error) {
      console.error('Error downloading file:', error)
    }
  }

  const getDocumentTypeLabel = (type: string) => {
    const found = DOCUMENT_TYPES.find(t => t.value === type)
    return found?.label || type
  }

  if (documents.length === 0) {
    return (
      <div className="col-span-2 text-center py-8 text-gray-500">
        <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
        <p className="text-lg font-medium mb-1">Нет загруженных документов</p>
        <p className="text-sm text-gray-600">Загрузите первый документ</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {documents.map((doc) => {
        const isExpired = doc.expiry_date && new Date(doc.expiry_date) < new Date()
        
        return (
          <div key={doc.id} className="bg-white dark:bg-gray-800/30 rounded-xl p-4 border border-slate-200 dark:border-white/5 hover:bg-slate-50 dark:hover:bg-gray-800/50 transition-colors">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <div className="min-w-0">
                  <span className="font-medium text-foreground block truncate">{doc.document_name}</span>
                  <p className="text-xs text-gray-500 truncate">
                    {getDocumentTypeLabel(doc.document_type)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {doc.is_verified ? (
                  <span className="text-xs px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30 flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Верифицирован
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    Не верифицирован
                  </span>
                )}
                {isExpired && (
                  <span className="text-xs px-2 py-0.5 bg-rose-500/20 text-rose-400 rounded-full border border-rose-500/30 flex items-center gap-1">
                    <X className="w-3 h-3" />
                    Просрочен
                  </span>
                )}
              </div>
            </div>

            {doc.document_number && (
              <p className="text-xs text-slate-500 dark:text-gray-400 mb-1">Номер: {doc.document_number}</p>
            )}

            {(doc.issue_date || doc.expiry_date) && (
              <div className="flex flex-wrap gap-3 text-xs text-gray-500 mb-3">
                {doc.issue_date && <span>Выдан: {formatDate(doc.issue_date)}</span>}
                {doc.expiry_date && <span>Действ. до: {formatDate(doc.expiry_date)}</span>}
              </div>
            )}

            <div className="flex gap-2 mt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleView(doc.document_url)}
                className="border-border text-xs h-7"
              >
                <Eye className="w-3 h-3 mr-1" />
                Просмотр
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleDownload(doc.document_url, doc.document_name)}
                className="border-border text-xs h-7"
              >
                <Download className="w-3 h-3 mr-1" />
                Скачать
              </Button>
              {!doc.is_verified && onVerify && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleVerify(doc.id)}
                  disabled={verifying === doc.id}
                  className="border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 text-xs h-7"
                >
                  {verifying === doc.id ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3 mr-1" />
                  )}
                  Верифицировать
                </Button>
              )}
              {onDelete && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDelete(doc.id)}
                  disabled={deleting === doc.id}
                  className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-xs h-7"
                >
                  {deleting === doc.id ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <X className="w-3 h-3 mr-1" />
                  )}
                  Удалить
                </Button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Основной компонент
export default function OperatorProfilePage() {
  const params = useParams()
  const router = useRouter()
  const operatorId = params.id as string

  const { can } = useCapabilities()
  const canEditOperator = can('operators.edit')
  const canPromote = can('operators.promote')
  const canSaveAssignments = can('operators.save_assignments')
  const canAvatarUpload = can('operators.avatar_upload')
  const canDocumentUpload = can('operators.document_upload')
  const canCreateAccount = can('operators.create_account')

  const [operator, setOperator] = useState<Operator | null>(null)
  const [profile, setProfile] = useState<OperatorProfile | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [workHistory, setWorkHistory] = useState<WorkHistory[]>([])
  const [documents, setDocuments] = useState<Document[]>([])
  const [notes, setNotes] = useState<Note[]>([])
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [sessionRole, setSessionRole] = useState<SessionRoleInfo | null>(null)
  const [operatorAccount, setOperatorAccount] = useState<OperatorAccount | null>(null)
  const [careerLink, setCareerLink] = useState<OperatorCareerLink | null>(null)
  const [careerLoading, setCareerLoading] = useState(true)
  const [careerSaving, setCareerSaving] = useState(false)
  const [careerForm, setCareerForm] = useState<{ role: CareerRole; monthly_salary: string }>({
    role: 'manager',
    monthly_salary: '',
  })
  const [companyAssignments, setCompanyAssignments] = useState<OperatorCompanyAssignment[]>([])
  const [assignmentLoading, setAssignmentLoading] = useState(true)
  const [assignmentSaving, setAssignmentSaving] = useState(false)
  const [showAccountModal, setShowAccountModal] = useState(false)
  const [newAccount, setNewAccount] = useState<{ username: string; password: string } | null>(null)
  
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [activeTab, setActiveTab] = useState<'info' | 'work' | 'docs' | 'notes'>('info')
  const [saving, setSaving] = useState(false)
  const [creatingAccount, setCreatingAccount] = useState(false)

  const [editedProfile, setEditedProfile] = useState<Partial<OperatorProfile>>({})
  const [editedTelegramChatId, setEditedTelegramChatId] = useState<string>('')
  const [newNote, setNewNote] = useState('')
  const [newNoteType, setNewNoteType] = useState('general')

  // Состояния для добавления записи о работе
  const [showWorkForm, setShowWorkForm] = useState(false)
  const [newWork, setNewWork] = useState({
    company_id: '',
    position: '',
    start_date: '',
    end_date: '',
    is_current: false,
    salary: '',
    salary_type: 'monthly',
    responsibilities: '',
    achievements: ''
  })

  const canManageOperatorStructure =
    !!sessionRole?.isSuperAdmin || sessionRole?.staffRole === 'owner' || sessionRole?.staffRole === 'manager'
  const canManageCareerGrowth = !!sessionRole?.isSuperAdmin

  // Загрузка данных
  useEffect(() => {
    const loadOperatorData = async () => {
      try {
        setLoading(true)
        setError(null)

        if (!operatorId) throw new Error('ID оператора не указан')

        const [{ data: { user } }, profileResp] = await Promise.all([
          supabase.auth.getUser(),
          fetch(`/api/admin/operators/profile?operator_id=${encodeURIComponent(operatorId)}`),
        ])

        const profileJson = await profileResp.json()
        if (!profileResp.ok) throw new Error(profileJson?.error || 'Ошибка загрузки профиля')

        const { operator: operatorData, profile: profileData, workHistory: workData, documents: docsData, notes: notesData, account: accountData, companies: companiesData } = profileJson.data

        setCurrentUser(user)
        setCompanies(companiesData || [])
        setOperator(operatorData)
        setEditedTelegramChatId(operatorData.telegram_chat_id || '')
        if (profileData) { setProfile(profileData); setEditedProfile(profileData) }
        if (workData) setWorkHistory(workData)
        if (docsData) setDocuments(docsData)
        if (notesData) setNotes(notesData.map((n: any) => ({ ...n, created_by_name: 'Система' })))
        if (accountData) setOperatorAccount(accountData)

      } catch (err: any) {
        let errorMessage = 'Ошибка загрузки'
        if (err.code === 'PGRST116') errorMessage = 'Оператор не найден'
        else if (err.message) errorMessage = err.message
        setError(errorMessage)
      } finally {
        setLoading(false)
      }
    }

    loadOperatorData()
  }, [operatorId])

  useEffect(() => {
    let ignore = false

    const loadSessionRole = async () => {
      const response = await fetch('/api/auth/session-role', { cache: 'no-store' }).catch(() => null)
      const json = await response?.json().catch(() => null)
      if (!response?.ok || ignore) return

      setSessionRole({
        isSuperAdmin: json?.isSuperAdmin,
        staffRole: json?.staffRole,
      })
    }

    const loadCareerLink = async () => {
      try {
        setCareerLoading(true)
        const response = await fetch(`/api/admin/operator-career?operatorId=${encodeURIComponent(operatorId)}`).catch(() => null)
        const json = await response?.json().catch(() => null)

        if (ignore) return

        if (response?.ok) {
          const data = (json?.data || null) as OperatorCareerLink | null
          setCareerLink(data)
          setCareerForm({
            role: (data?.staff?.role as CareerRole | null) || (data?.assigned_role as CareerRole | null) || 'manager',
            monthly_salary: data?.staff?.monthly_salary != null ? String(data.staff.monthly_salary) : '',
          })
        } else {
          setCareerLink(null)
        }
      } catch (error) {
        console.error('Error loading operator career:', error)
      } finally {
        if (!ignore) setCareerLoading(false)
      }
    }

    loadSessionRole()
    loadCareerLink()
    return () => {
      ignore = true
    }
  }, [operatorId])

  useEffect(() => {
    let ignore = false

    const loadAssignments = async () => {
      try {
        setAssignmentLoading(true)
        const response = await fetch(
          `/api/admin/operator-company-assignments?operatorId=${encodeURIComponent(operatorId)}`,
          { cache: 'no-store' },
        ).catch(() => null)
        const json = await response?.json().catch(() => null)

        if (ignore) return

        if (response?.ok) {
          setCompanyAssignments((json?.data || []) as OperatorCompanyAssignment[])
        } else {
          setCompanyAssignments([])
        }
      } catch (assignmentError) {
        console.error('Error loading operator company assignments:', assignmentError)
      } finally {
        if (!ignore) setAssignmentLoading(false)
      }
    }

    loadAssignments()
    return () => {
      ignore = true
    }
  }, [operatorId])

  // Сохранение профиля
  const handleSaveProfile = async () => {
    if (!operator) return

    try {
      setSaving(true)
      setError(null)

      const response = await fetch('/api/admin/operators/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operator_id: operatorId,
          telegram_chat_id: editedTelegramChatId || null,
          profile: editedProfile,
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || 'Ошибка при сохранении')
      }

      setOperator(prev => prev ? { ...prev, telegram_chat_id: editedTelegramChatId || null } : prev)
      setProfile((prev) => ({ ...(prev || { operator_id: operatorId }), ...editedProfile } as OperatorProfile))

      setIsEditing(false)
      setUploadSuccess('Профиль сохранен')
      setTimeout(() => setUploadSuccess(null), 3000)
    } catch (err: any) {
      console.error('Error saving profile:', err)
      setError(err.message || 'Ошибка при сохранении')
    } finally {
      setSaving(false)
    }
  }

  // Создание аккаунта оператора - ИСПРАВЛЕННАЯ ФУНКЦИЯ
  const handleCreateAccount = async () => {
    if (!operator) return

    try {
      setCreatingAccount(true)
      setError(null)

      // Генерируем логин из имени (только латиница)
      const baseUsername = operator.name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '') // удаляем все кроме латинских букв и цифр
        .substring(0, 15) // ограничиваем длину
      
      // Если имя было на русском и ничего не осталось, используем "operator"
      const finalBaseUsername = baseUsername || 'operator'
      
      const username = finalBaseUsername + '_' + Math.floor(Math.random() * 10000)
      
      // Функция генерации пароля
      const generatePassword = () => {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz0123456789'
        let password = ''
        for (let i = 0; i < 10; i++) {
          password += chars[Math.floor(Math.random() * chars.length)]
        }
        // Добавляем спецсимвол и цифру для надежности
        return password + '1!'
      }

      const password = generatePassword()

      // Формируем email (обязательно валидный формат)
      const email = `${username}@operator.local`.toLowerCase()

      // Создаем пользователя в auth.users через API
      const response = await fetch('/api/admin/create-operator-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatorId: operator.id,
          username,
          email,
          name: operator.name
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Ошибка создания аккаунта')
      }

      // Сохраняем данные аккаунта для отображения
      setNewAccount({
        username: data.username,
        password: data.password
      })
      setShowAccountModal(true)

      // Перезагружаем данные, чтобы показать, что аккаунт создан
      setTimeout(async () => {
        try {
          const { data: accountData } = await supabase
            .from('operator_auth')
            .select('*')
            .eq('operator_id', operatorId)
            .maybeSingle()

          if (accountData) {
            setOperatorAccount(accountData)
          }
        } catch (err) {
          console.error('Error reloading account data:', err)
        }
      }, 1000)

      setUploadSuccess('Аккаунт оператора создан! Данные показаны в окне.')
      setTimeout(() => setUploadSuccess(null), 5000)

    } catch (err: any) {
      console.error('Error creating account:', err)
      setError(err.message || 'Ошибка создания аккаунта')
    } finally {
      setCreatingAccount(false)
    }
  }

  const handlePromoteOperator = async () => {
    if (!operator) return

    try {
      setCareerSaving(true)
      setError(null)

      const monthlySalaryValue = careerForm.monthly_salary.trim()
      const monthlySalary = monthlySalaryValue === '' ? null : Number(monthlySalaryValue)

      if (monthlySalaryValue !== '' && !Number.isFinite(monthlySalary)) {
        throw new Error('Оклад должен быть числом')
      }

      const response = await fetch('/api/admin/operator-career', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'promoteOperator',
          payload: {
            operatorId: operator.id,
            role: careerForm.role,
            monthly_salary: monthlySalary,
          },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || 'Не удалось сохранить карьерный рост')
      }

      setCareerLink((prev) => ({
        id: prev?.id || `career-${operator.id}`,
        assigned_role: careerForm.role,
        assigned_at: prev?.assigned_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        staff: json?.data?.staff || null,
      }))
      setUploadSuccess('Карьерная роль сохранена. Оператор получил staff-доступ.')
      setTimeout(() => setUploadSuccess(null), 4000)
    } catch (err: any) {
      console.error('Error promoting operator:', err)
      setError(err.message || 'Ошибка сохранения карьерной роли')
    } finally {
      setCareerSaving(false)
    }
  }

  const handleAddCompanyAssignment = () => {
    if (companyAssignments.length >= 2) return

    const availableCompany = companies.find(
      (company) => !companyAssignments.some((assignment) => assignment.company_id === company.id),
    )

    setCompanyAssignments((prev) => [
      ...prev,
      {
        id: `draft-${Date.now()}`,
        operator_id: operatorId,
        company_id: availableCompany?.id || '',
        role_in_company: 'operator',
        is_primary: prev.filter((item) => item.is_active).length === 0,
        is_active: true,
        notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        company: availableCompany
          ? {
              id: availableCompany.id,
              name: availableCompany.name,
              code: availableCompany.code || null,
            }
          : null,
      },
    ])
  }

  const handleAssignmentChange = (
    assignmentId: string,
    field: 'company_id' | 'role_in_company' | 'is_primary' | 'is_active' | 'notes',
    value: string | boolean | null,
  ) => {
    setCompanyAssignments((prev) =>
      prev.map((assignment) => {
        if (assignment.id !== assignmentId) return assignment

        if (field === 'company_id') {
          const company = companies.find((item) => item.id === value)
          return {
            ...assignment,
            company_id: String(value || ''),
            company: company
              ? {
                  id: company.id,
                  name: company.name,
                  code: company.code || null,
                }
              : null,
          }
        }

        if (field === 'is_primary' && value) {
          return {
            ...assignment,
            is_primary: true,
          }
        }

        return {
          ...assignment,
          [field]: value,
        }
      }).map((assignment) => {
        if (field !== 'is_primary' || !value) return assignment
        if (assignment.id === assignmentId) return assignment
        return { ...assignment, is_primary: false }
      }),
    )
  }

  const handleRemoveCompanyAssignment = (assignmentId: string) => {
    setCompanyAssignments((prev) => {
      const next = prev.filter((assignment) => assignment.id !== assignmentId)
      const activeAssignments = next.filter((assignment) => assignment.is_active)
      if (activeAssignments.length > 0 && !activeAssignments.some((assignment) => assignment.is_primary)) {
        const firstActiveId = activeAssignments[0].id
        return next.map((assignment) =>
          assignment.id === firstActiveId ? { ...assignment, is_primary: true } : assignment,
        )
      }
      return next
    })
  }

  const handleSaveCompanyAssignments = async () => {
    if (!operator) return

    try {
      setAssignmentSaving(true)
      setError(null)

      const activeAssignments = companyAssignments.filter((assignment) => assignment.is_active)
      if (activeAssignments.length > 2) {
        throw new Error('Оператор может быть назначен максимум на 2 активные компании')
      }

      const usedCompanyIds = new Set<string>()
      for (const assignment of companyAssignments) {
        if (!assignment.company_id.trim()) {
          throw new Error('Выберите компанию для каждого назначения')
        }
        if (usedCompanyIds.has(assignment.company_id)) {
          throw new Error('Одна и та же компания указана дважды')
        }
        usedCompanyIds.add(assignment.company_id)
      }

      const response = await fetch('/api/admin/operator-company-assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveAssignments',
          operatorId: operator.id,
          assignments: companyAssignments.map((assignment) => ({
            id: assignment.id.startsWith('draft-') ? undefined : assignment.id,
            company_id: assignment.company_id,
            role_in_company: assignment.role_in_company,
            is_primary: assignment.is_primary,
            is_active: assignment.is_active,
            notes: assignment.notes,
          })),
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || 'Не удалось сохранить роли по компаниям')
      }

      setCompanyAssignments((json?.data || []) as OperatorCompanyAssignment[])
      setUploadSuccess('Привязка к компаниям сохранена')
      setTimeout(() => setUploadSuccess(null), 3500)
    } catch (assignmentError: any) {
      console.error('Error saving operator company assignments:', assignmentError)
      setError(assignmentError?.message || 'Ошибка сохранения ролей по компаниям')
    } finally {
      setAssignmentSaving(false)
    }
  }

  // Добавление заметки
  const handleAddNote = async () => {
    if (!operator || !newNote.trim()) return

    try {
      setSaving(true)
      setError(null)

      const insertData: any = {
        operator_id: operatorId,
        note: newNote.trim(),
        note_type: newNoteType
      }

      if (currentUser?.id) {
        insertData.created_by = currentUser.id
      }

      const { data, error } = await supabase
        .from('operator_notes')
        .insert(insertData)
        .select()
        .single()

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      if (!data) {
        throw new Error('No data returned after insert')
      }

      const newNoteWithName = {
        ...data,
        created_by_name: currentUser?.email || 'Система'
      }

      setNotes(prevNotes => [newNoteWithName, ...prevNotes])
      
      setNewNote('')
      setNewNoteType('general')
      setUploadSuccess('Заметка добавлена')
      setTimeout(() => setUploadSuccess(null), 3000)

    } catch (err: any) {
      console.error('Error adding note:', err)
      
      if (err.code === '42P01') {
        setError('Таблица "operator_notes" не существует. Создайте её в Supabase.')
      } else {
        setError(`Не удалось добавить заметку: ${err.message || 'Неизвестная ошибка'}`)
      }
    } finally {
      setSaving(false)
    }
  }

  // Добавление записи о работе
  const handleAddWork = async () => {
    if (!operator || !newWork.position || !newWork.start_date) return

    try {
      setSaving(true)
      setError(null)

      const workData: any = {
        operator_id: operatorId,
        company_id: newWork.company_id || null,
        position: newWork.position.trim(),
        start_date: newWork.start_date,
        is_current: newWork.is_current,
        salary: newWork.salary ? parseFloat(newWork.salary) : null,
        salary_type: newWork.salary_type,
        responsibilities: newWork.responsibilities?.trim() || null,
        achievements: newWork.achievements?.trim() || null
      }

      if (!newWork.is_current && newWork.end_date) {
        workData.end_date = newWork.end_date
      }

      const { data, error } = await supabase
        .from('operator_work_history')
        .insert(workData)
        .select(`
          *,
          companies:company_id (
            name,
            code
          )
        `)
        .single()

      if (error) throw error

      const newWorkWithCompany = {
        ...data,
        company_name: data.companies?.name,
        company_code: data.companies?.code
      }

      setWorkHistory(prev => [newWorkWithCompany, ...prev])

      setNewWork({
        company_id: '',
        position: '',
        start_date: '',
        end_date: '',
        is_current: false,
        salary: '',
        salary_type: 'monthly',
        responsibilities: '',
        achievements: ''
      })
      setShowWorkForm(false)
      setUploadSuccess('Запись о работе добавлена')
      setTimeout(() => setUploadSuccess(null), 3000)

    } catch (err: any) {
      console.error('Error adding work:', err)
      setError(err.message || 'Не удалось добавить запись о работе')
    } finally {
      setSaving(false)
    }
  }

  // Завершение текущей работы
  const handleEndCurrentWork = async (workId: string) => {
    try {
      setError(null)
      
      const { error } = await supabase
        .from('operator_work_history')
        .update({
          is_current: false,
          end_date: new Date().toISOString().split('T')[0]
        })
        .eq('id', workId)

      if (error) throw error

      setWorkHistory(prev => prev.map(w => 
        w.id === workId 
          ? { ...w, is_current: false, end_date: new Date().toISOString().split('T')[0] }
          : w
      ))
      setUploadSuccess('Период работы завершен')
      setTimeout(() => setUploadSuccess(null), 3000)

    } catch (err: any) {
      console.error('Error ending work:', err)
      setError(err.message || 'Не удалось завершить период работы')
    }
  }

  // Обработчики для документов
  const handleDocumentUpload = (document: Document) => {
    setDocuments(prev => [document, ...prev])
    setUploadSuccess('Документ загружен')
    setTimeout(() => setUploadSuccess(null), 3000)
  }

  const handleDocumentVerify = (documentId: string) => {
    setDocuments(prev => prev.map(doc => 
      doc.id === documentId ? { ...doc, is_verified: true } : doc
    ))
    setUploadSuccess('Документ верифицирован')
    setTimeout(() => setUploadSuccess(null), 3000)
  }

  const handleDocumentDelete = (documentId: string) => {
    setDocuments(prev => prev.filter(doc => doc.id !== documentId))
    setUploadSuccess('Документ удален')
    setTimeout(() => setUploadSuccess(null), 3000)
  }

  // Обработчик для аватара
  const handleAvatarUpload = (url: string) => {
    setProfile(prev => prev ? { ...prev, photo_url: url } : {
      operator_id: operatorId,
      photo_url: url,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    } as OperatorProfile)
    setUploadSuccess('Фото профиля обновлено')
    setTimeout(() => setUploadSuccess(null), 3000)
  }

  // Форматирование даты
  const formatDate = (date: string | null) => {
    if (!date) return 'Не указано'
    try {
      return new Date(date).toLocaleDateString('ru-RU')
    } catch {
      return 'Не указано'
    }
  }

  // Расчет стажа работы в компании
  const calculateTenure = useCallback((startDate: string | null, endDate: string | null = null) => {
    if (!startDate) return null
    
    try {
      const start = new Date(startDate)
      const end = endDate ? new Date(endDate) : new Date()
      
      const years = end.getFullYear() - start.getFullYear()
      const months = end.getMonth() - start.getMonth()
      const days = end.getDate() - start.getDate()
      
      let totalMonths = years * 12 + months
      if (days < 0) totalMonths -= 1
      
      if (totalMonths < 0) return '0 месяцев'
      
      const yearsText = Math.floor(totalMonths / 12)
      const monthsText = totalMonths % 12
      
      if (yearsText > 0 && monthsText > 0) {
        return `${yearsText} ${getYearWord(yearsText)} ${monthsText} ${getMonthWord(monthsText)}`
      } else if (yearsText > 0) {
        return `${yearsText} ${getYearWord(yearsText)}`
      } else {
        return `${monthsText} ${getMonthWord(monthsText)}`
      }
    } catch {
      return null
    }
  }, [])

  const getYearWord = (years: number) => {
    if (years % 10 === 1 && years % 100 !== 11) return 'год'
    if ([2, 3, 4].includes(years % 10) && ![12, 13, 14].includes(years % 100)) return 'года'
    return 'лет'
  }

  const getMonthWord = (months: number) => {
    if (months % 10 === 1 && months % 100 !== 11) return 'месяц'
    if ([2, 3, 4].includes(months % 10) && ![12, 13, 14].includes(months % 100)) return 'месяца'
    return 'месяцев'
  }

  // Получение текущего места работы
  const currentWork = useMemo(() => {
    return workHistory.find(w => w.is_current)
  }, [workHistory])

  // Общий стаж работы
  const totalTenure = useMemo(() => {
    if (!profile?.hire_date) return null
    return calculateTenure(profile.hire_date)
  }, [profile?.hire_date, calculateTenure])

  if (loading) return <ProfileLoading />

  if (error || !operator) {
    return (
      <>
          <div className="text-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-rose-500/20 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-8 h-8 text-rose-400" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">Ошибка</h2>
            <p className="text-slate-500 dark:text-gray-400 max-w-md">{error || 'Оператор не найден'}</p>
            <Button onClick={() => router.back()} variant="outline" className="border-border">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Вернуться назад
            </Button>
          </div>
      </>
    )
  }

  return (
    <>
      {/* Модальное окно с данными нового аккаунта */}
      {showAccountModal && newAccount && (
        <AccountInfo
          account={newAccount}
          onCopyUsername={() => {
            navigator.clipboard.writeText(newAccount.username)
            setUploadSuccess('Логин скопирован')
            setTimeout(() => setUploadSuccess(null), 2000)
          }}
          onCopyPassword={() => {
            navigator.clipboard.writeText(newAccount.password)
            setUploadSuccess('Пароль скопирован')
            setTimeout(() => setUploadSuccess(null), 2000)
          }}
          onClose={() => setShowAccountModal(false)}
        />
      )}

      <main className="flex-1 overflow-auto">
        <div className="app-page-wide space-y-6">
          {/* Уведомления */}
          {uploadError && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
              <p className="text-sm text-rose-200">{uploadError}</p>
              <button onClick={() => setUploadError(null)} className="ml-auto text-rose-400/50 hover:text-rose-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {uploadSuccess && (
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4 flex items-center gap-3">
              <Check className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              <p className="text-sm text-emerald-200">{uploadSuccess}</p>
              <button onClick={() => setUploadSuccess(null)} className="ml-auto text-emerald-400/50 hover:text-emerald-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-rose-500/10 border border-rose-500/20 p-4 flex items-center gap-3">
              <AlertCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
              <p className="text-sm text-rose-200">{error}</p>
              <button onClick={() => setError(null)} className="ml-auto text-rose-400/50 hover:text-rose-400">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Header */}
          <AdminPageHeader
            title={getOperatorDisplayName({ ...operator, full_name: profile?.full_name })}
            description={operator.short_name || operator.name || 'Профиль оператора'}
            icon={<User className="h-5 w-5" />}
            accent="amber"
            backHref="/operators"
            actions={
              <>
                {canCreateAccount && !isEditing && !operatorAccount && (
                  <Button
                    onClick={handleCreateAccount}
                    disabled={creatingAccount}
                    className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white border-0"
                  >
                    {creatingAccount ? (
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    ) : (
                      <UserPlus className="w-4 h-4 mr-2" />
                    )}
                    Создать аккаунт
                  </Button>
                )}

                {!isEditing ? (
                  canEditOperator && (
                    <Button
                      onClick={() => setIsEditing(true)}
                      className="bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 text-white border-0"
                    >
                      <Edit className="w-4 h-4 mr-2" />
                      Редактировать
                    </Button>
                  )
                ) : (
                  <>
                    {canEditOperator && (
                      <Button
                        onClick={handleSaveProfile}
                        disabled={saving}
                        className="bg-emerald-500 hover:bg-emerald-600 text-white"
                      >
                        {saving ? (
                          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <Save className="w-4 h-4 mr-2" />
                        )}
                        Сохранить
                      </Button>
                    )}
                    <Button
                      onClick={() => {
                        setIsEditing(false)
                        setEditedProfile(profile || {})
                        setEditedTelegramChatId(operator?.telegram_chat_id || '')
                      }}
                      variant="outline"
                      className="border-border"
                    >
                      <X className="w-4 h-4 mr-2" />
                      Отмена
                    </Button>
                  </>
                )}
              </>
            }
            toolbar={
              <div className="flex flex-wrap items-center gap-4">
                {/* Avatar с загрузкой */}
                <AvatarUpload
                  operatorId={operatorId}
                  currentAvatarUrl={profile?.photo_url || null}
                  onUploadComplete={handleAvatarUpload}
                  onError={setUploadError}
                  canUpload={canAvatarUpload}
                />
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    operator.is_active
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'bg-slate-100 dark:bg-gray-500/20 text-slate-500 dark:text-gray-400 border border-slate-200 dark:border-gray-500/30'
                  }`}>
                    {operator.is_active ? 'Активен' : 'Неактивен'}
                  </span>
                  {operatorAccount && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                      <Key className="w-3 h-3" />
                      Аккаунт создан
                    </span>
                  )}
                  {currentWork && (
                    <span className="text-sm text-violet-400 flex items-center gap-1">
                      <Briefcase className="w-3 h-3" />
                      {currentWork.position} в {currentWork.company_name || 'компании'}
                    </span>
                  )}
                </div>
              </div>
            }
          />

          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card className="p-4 bg-white dark:bg-gray-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/20">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Устроился</p>
                  <p className="text-sm font-medium">{formatDate(profile?.hire_date || operator.created_at)}</p>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-white dark:bg-gray-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/20">
                  <Clock className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Общий стаж</p>
                  <p className="text-sm font-medium">{totalTenure || 'Не указано'}</p>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-white dark:bg-gray-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20">
                  <Briefcase className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Тип занятости</p>
                  <p className="text-sm font-medium">
                    {profile?.employment_type === 'full_time' ? 'Полный день' :
                     profile?.employment_type === 'part_time' ? 'Частичная' :
                     profile?.employment_type === 'contract' ? 'Контракт' : 'Не указано'}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-4 bg-white dark:bg-gray-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-violet-500/20">
                  <Building2 className="w-4 h-4 text-violet-400" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Отдел</p>
                  <p className="text-sm font-medium">{profile?.department || 'Не указано'}</p>
                  {companyAssignments.filter(a => a.is_active).length > 0 && (
                    <p className="text-xs text-violet-400 mt-0.5">
                      {companyAssignments.filter(a => a.is_active).map((a: any) => {
                        const co = companies.find((c: any) => c.id === a.company_id)
                        return co?.name || co?.code || a.company_id
                      }).join(', ')}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-slate-200 dark:border-white/5 pb-1 overflow-x-auto">
            <button
              onClick={() => setActiveTab('info')}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-all whitespace-nowrap ${
                activeTab === 'info'
                  ? 'text-violet-400 border-b-2 border-violet-500 bg-gradient-to-t from-violet-500/10 to-transparent'
                  : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Основная информация
            </button>
            <button
              onClick={() => setActiveTab('work')}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-all whitespace-nowrap ${
                activeTab === 'work'
                  ? 'text-violet-400 border-b-2 border-violet-500 bg-gradient-to-t from-violet-500/10 to-transparent'
                  : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              История работы
            </button>
            <button
              onClick={() => setActiveTab('docs')}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-all whitespace-nowrap ${
                activeTab === 'docs'
                  ? 'text-violet-400 border-b-2 border-violet-500 bg-gradient-to-t from-violet-500/10 to-transparent'
                  : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Документы
            </button>
            <button
              onClick={() => setActiveTab('notes')}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-all whitespace-nowrap ${
                activeTab === 'notes'
                  ? 'text-violet-400 border-b-2 border-violet-500 bg-gradient-to-t from-violet-500/10 to-transparent'
                  : 'text-slate-500 dark:text-gray-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Заметки
            </button>
          </div>

          {/* Основная информация */}
          {activeTab === 'info' && (
            <div className="space-y-6">

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="lg:col-span-2 p-6 bg-white dark:bg-gray-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <User className="w-5 h-5 text-violet-400" />
                  Личная информация
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-2">
                    <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                      <FileSignature className="w-3 h-3" />
                      Полное ФИО
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedProfile.full_name || ''}
                        onChange={(e) => setEditedProfile({ ...editedProfile, full_name: e.target.value })}
                        placeholder="Фамилия Имя Отчество"
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    ) : (
                      <p className="text-sm">{profile?.full_name || operator.name || 'Не указано'}</p>
                    )}
                  </div>

                  {/* Дата рождения */}
                  <div>
                    <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                      <Cake className="w-3 h-3" />
                      Дата рождения
                    </label>
                    {isEditing ? (
                      <DatePicker
                        value={editedProfile.birth_date || ''}
                        onChange={(v) => setEditedProfile({ ...editedProfile, birth_date: v })}
                        className="w-full"
                      />
                    ) : (
                      <p className="text-sm">{formatDate(profile?.birth_date || null)}</p>
                    )}
                  </div>

                  {/* Телефон */}
                  <div>
                    <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                      <Phone className="w-3 h-3" />
                      Телефон
                    </label>
                    {isEditing ? (
                      <input
                        type="tel"
                        value={editedProfile.phone || ''}
                        onChange={(e) => setEditedProfile({ ...editedProfile, phone: e.target.value })}
                        placeholder="+7 (XXX) XXX-XX-XX"
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    ) : (
                      <p className="text-sm">{profile?.phone || 'Не указано'}</p>
                    )}
                  </div>

                  {/* Email */}
                  <div>
                    <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                      <Mail className="w-3 h-3" />
                      Email
                    </label>
                    {isEditing ? (
                      <input
                        type="email"
                        value={editedProfile.email || ''}
                        onChange={(e) => setEditedProfile({ ...editedProfile, email: e.target.value })}
                        placeholder="email@example.com"
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    ) : (
                      <p className="text-sm">{profile?.email || 'Не указано'}</p>
                    )}
                  </div>

                  {/* Telegram Chat ID */}
                  <div>
                    <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                      <Send className="w-3 h-3" />
                      Telegram Chat ID
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedTelegramChatId}
                        onChange={(e) => setEditedTelegramChatId(e.target.value)}
                        placeholder="-1001234567890"
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    ) : (
                      <p className="text-sm font-mono">{operator?.telegram_chat_id || 'Не указано'}</p>
                    )}
                  </div>

                  {/* Адрес */}
                  <div className="md:col-span-2">
                    <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                      <MapPin className="w-3 h-3" />
                      Адрес проживания
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedProfile.address || ''}
                        onChange={(e) => setEditedProfile({ ...editedProfile, address: e.target.value })}
                        placeholder="Город, улица, дом"
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    ) : (
                      <p className="text-sm">{profile?.address || 'Не указано'}</p>
                    )}
                  </div>

                  {/* Дата найма */}
                  <div>
                    <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                      <CalendarDays className="w-3 h-3" />
                      Дата найма
                    </label>
                    {isEditing ? (
                      <DatePicker
                        value={editedProfile.hire_date || ''}
                        onChange={(v) => setEditedProfile({ ...editedProfile, hire_date: v })}
                        className="w-full"
                      />
                    ) : (
                      <p className="text-sm">{formatDate(profile?.hire_date || null)}</p>
                    )}
                  </div>

                  {/* Должность */}
                  <div>
                    <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                      <BriefcaseBusiness className="w-3 h-3" />
                      Должность
                    </label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedProfile.position || ''}
                        onChange={(e) => setEditedProfile({ ...editedProfile, position: e.target.value })}
                        placeholder="Должность"
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    ) : (
                      <p className="text-sm">{profile?.position || 'Не указано'}</p>
                    )}
                  </div>
                </div>

                <h3 className="text-lg font-semibold mt-6 mb-4 flex items-center gap-2">
                  <Heart className="w-5 h-5 text-rose-400" />
                  Экстренный контакт
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500 mb-1">Имя</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedProfile.emergency_contact_name || ''}
                        onChange={(e) => setEditedProfile({ ...editedProfile, emergency_contact_name: e.target.value })}
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    ) : (
                      <p className="text-sm">{profile?.emergency_contact_name || 'Не указано'}</p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 mb-1">Телефон</label>
                    {isEditing ? (
                      <input
                        type="tel"
                        value={editedProfile.emergency_contact_phone || ''}
                        onChange={(e) => setEditedProfile({ ...editedProfile, emergency_contact_phone: e.target.value })}
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    ) : (
                      <p className="text-sm">{profile?.emergency_contact_phone || 'Не указано'}</p>
                    )}
                  </div>

                  <div>
                    <label className="text-xs text-gray-500 mb-1">Отношение</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedProfile.emergency_contact_relation || ''}
                        onChange={(e) => setEditedProfile({ ...editedProfile, emergency_contact_relation: e.target.value })}
                        placeholder="Супруг(а), родитель, друг"
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    ) : (
                      <p className="text-sm">{profile?.emergency_contact_relation || 'Не указано'}</p>
                    )}
                  </div>
                </div>
              </Card>

              {/* Правая колонка - дополнительная информация */}
              <Card className="p-6 bg-white dark:bg-gray-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
                <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Info className="w-5 h-5 text-blue-400" />
                  Дополнительно
                </h3>

                <div className="space-y-4">
                  {/* ИИН */}
                  <div>
                    <label className="text-xs text-gray-500 mb-1">ИИН</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedProfile.tax_number || ''}
                        onChange={(e) => setEditedProfile({ ...editedProfile, tax_number: e.target.value })}
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    ) : (
                      <p className="text-sm font-mono">{profile?.tax_number || 'Не указано'}</p>
                    )}
                  </div>

                  {/* Номер удостоверения */}
                  <div>
                    <label className="text-xs text-gray-500 mb-1">Номер удостоверения</label>
                    {isEditing ? (
                      <input
                        type="text"
                        value={editedProfile.id_number || ''}
                        onChange={(e) => setEditedProfile({ ...editedProfile, id_number: e.target.value })}
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    ) : (
                      <p className="text-sm">{profile?.id_number || 'Не указано'}</p>
                    )}
                  </div>

                  {/* Срок действия удостоверения */}
                  <div>
                    <label className="text-xs text-gray-500 mb-1">Срок действия</label>
                    {isEditing ? (
                      <DatePicker
                        value={editedProfile.id_expiry_date || ''}
                        onChange={(v) => setEditedProfile({ ...editedProfile, id_expiry_date: v })}
                        className="w-full"
                      />
                    ) : (
                      <p className="text-sm">{formatDate(profile?.id_expiry_date || null)}</p>
                    )}
                  </div>

                  {/* Группа крови */}
                  <div>
                    <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                      <HeartPulse className="w-3 h-3" />
                      Группа крови
                    </label>
                    {isEditing ? (
                      <select
                        value={editedProfile.blood_type || ''}
                        onChange={(e) => setEditedProfile({ ...editedProfile, blood_type: e.target.value })}
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      >
                        <option value="">Не указано</option>
                        <option value="A+">A+</option>
                        <option value="A-">A-</option>
                        <option value="B+">B+</option>
                        <option value="B-">B-</option>
                        <option value="AB+">AB+</option>
                        <option value="AB-">AB-</option>
                        <option value="O+">O+</option>
                        <option value="O-">O-</option>
                      </select>
                    ) : (
                      <p className="text-sm">{profile?.blood_type || 'Не указано'}</p>
                    )}
                  </div>

                  {/* Аллергии */}
                  <div>
                    <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                      <Stethoscope className="w-3 h-3" />
                      Аллергии
                    </label>
                    {isEditing ? (
                      <textarea
                        value={editedProfile.allergies || ''}
                        onChange={(e) => setEditedProfile({ ...editedProfile, allergies: e.target.value })}
                        rows={2}
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                        placeholder="Нет аллергий"
                      />
                    ) : (
                      <p className="text-sm">{profile?.allergies || 'Нет аллергий'}</p>
                    )}
                  </div>

                  {/* Медицинские показания */}
                  <div>
                    <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                      <Pill className="w-3 h-3" />
                      Медицинские показания
                    </label>
                    {isEditing ? (
                      <textarea
                        value={editedProfile.medical_conditions || ''}
                        onChange={(e) => setEditedProfile({ ...editedProfile, medical_conditions: e.target.value })}
                        rows={2}
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                        placeholder="Нет противопоказаний"
                      />
                    ) : (
                      <p className="text-sm">{profile?.medical_conditions || 'Нет противопоказаний'}</p>
                    )}
                  </div>

                  {/* Образование */}
                  <div>
                    <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
                      <BookOpen className="w-3 h-3" />
                      Образование
                    </label>
                    {isEditing ? (
                      <textarea
                        value={editedProfile.education || ''}
                        onChange={(e) => setEditedProfile({ ...editedProfile, education: e.target.value })}
                        rows={2}
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                        placeholder="Высшее, Среднее специальное..."
                      />
                    ) : (
                      <p className="text-sm">{profile?.education || 'Не указано'}</p>
                    )}
                  </div>
                </div>
              </Card>
              </div>
            </div>
          )}

          {/* История работы */}
          {activeTab === 'work' && (
            <Card className="p-6 bg-white dark:bg-gray-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Briefcase className="w-5 h-5 text-amber-400" />
                  История работы
                </h3>
                {canEditOperator && (
                  <Button
                    size="sm"
                    onClick={() => setShowWorkForm(!showWorkForm)}
                    className="bg-violet-500/20 hover:bg-violet-500/30 text-violet-400 border border-violet-500/30"
                  >
                    {showWorkForm ? (
                      <X className="w-4 h-4 mr-2" />
                    ) : (
                      <Plus className="w-4 h-4 mr-2" />
                    )}
                    {showWorkForm ? 'Отмена' : 'Добавить запись'}
                  </Button>
                )}
              </div>

              {showWorkForm && (
                <div className="mb-6 p-4 bg-slate-50 dark:bg-gray-800/30 rounded-xl border border-slate-200 dark:border-white/5">
                  <h4 className="text-sm font-medium mb-3">Новая запись о работе</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="md:col-span-2">
                      <label className="text-xs text-gray-500 mb-1 block">Компания</label>
                      <select
                        value={newWork.company_id}
                        onChange={(e) => setNewWork({ ...newWork, company_id: e.target.value })}
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      >
                        <option value="">Выберите компанию</option>
                        {companies.map(company => (
                          <option key={company.id} value={company.id}>
                            {company.name} ({company.code})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="text-xs text-gray-500 mb-1 block">Должность *</label>
                      <input
                        type="text"
                        value={newWork.position}
                        onChange={(e) => setNewWork({ ...newWork, position: e.target.value })}
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                        required
                      />
                    </div>

                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Дата начала *</label>
                      <DatePicker
                        value={newWork.start_date}
                        onChange={(v) => setNewWork({ ...newWork, start_date: v })}
                        className="w-full"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Дата окончания</label>
                      <DatePicker
                        value={newWork.end_date}
                        onChange={(v) => setNewWork({ ...newWork, end_date: v })}
                        disabled={newWork.is_current}
                        className="w-full"
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={newWork.is_current}
                        onChange={(e) => setNewWork({ ...newWork, is_current: e.target.checked })}
                        id="is_current"
                        className="rounded border-border bg-white dark:bg-gray-800/50 text-violet-500 focus:ring-violet-500/20"
                      />
                      <label htmlFor="is_current" className="text-sm text-slate-500 dark:text-gray-400">
                        Текущее место работы
                      </label>
                    </div>

                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Зарплата</label>
                      <input
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        value={newWork.salary}
                        onChange={(e) => setNewWork({ ...newWork, salary: e.target.value })}
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                        placeholder="0"
                      />
                    </div>

                    <div>
                      <label className="text-xs text-gray-500 mb-1 block">Тип зарплаты</label>
                      <select
                        value={newWork.salary_type}
                        onChange={(e) => setNewWork({ ...newWork, salary_type: e.target.value })}
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      >
                        <option value="monthly">В месяц</option>
                        <option value="hourly">Почасово</option>
                        <option value="shift">За смену</option>
                      </select>
                    </div>

                    <div className="md:col-span-2">
                      <label className="text-xs text-gray-500 mb-1 block">Обязанности</label>
                      <textarea
                        value={newWork.responsibilities}
                        onChange={(e) => setNewWork({ ...newWork, responsibilities: e.target.value })}
                        rows={2}
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="text-xs text-gray-500 mb-1 block">Достижения</label>
                      <textarea
                        value={newWork.achievements}
                        onChange={(e) => setNewWork({ ...newWork, achievements: e.target.value })}
                        rows={2}
                        className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 mt-3">
                    <Button
                      size="sm"
                      onClick={() => setShowWorkForm(false)}
                      variant="outline"
                      className="border-border"
                    >
                      Отмена
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleAddWork}
                      disabled={saving || !newWork.position || !newWork.start_date}
                      className="bg-emerald-500 hover:bg-emerald-600 text-white"
                    >
                      {saving ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4 mr-2" />
                      )}
                      Добавить
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                {workHistory.length > 0 ? (
                  workHistory.map((work) => {
                    const tenure = calculateTenure(work.start_date, work.end_date)
                    
                    return (
                      <div key={work.id} className="relative pl-6 pb-4 border-l-2 border-violet-500/30 last:pb-0">
                        <div className="absolute left-[-9px] top-0 w-4 h-4 rounded-full bg-violet-500 border-4 border-white dark:border-gray-900" />
                        
                        <div className="bg-white dark:bg-gray-800/30 rounded-xl p-4 border border-slate-100 dark:border-transparent">
                          <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
                            <div>
                              <h4 className="font-semibold text-foreground flex items-center gap-2">
                                {work.position}
                                {work.company_name && (
                                  <span className="text-sm font-normal text-slate-500 dark:text-gray-400">
                                    в {work.company_name}
                                  </span>
                                )}
                              </h4>
                              {work.company_code && (
                                <p className="text-xs text-gray-500 mt-1">
                                  Код компании: {work.company_code}
                                </p>
                              )}
                            </div>
                            {work.is_current && (
                              <span className="text-xs px-2 py-1 bg-emerald-500/20 text-emerald-400 rounded-full border border-emerald-500/30 whitespace-nowrap">
                                Текущее место
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 mb-3">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              {formatDate(work.start_date)} — {work.is_current ? 'настоящее время' : formatDate(work.end_date)}
                            </span>
                            {tenure && (
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {tenure}
                              </span>
                            )}
                            {work.salary && (
                              <span className="flex items-center gap-1">
                                <DollarSign className="w-3 h-3" />
                                {work.salary.toLocaleString()} ₸/
                                {work.salary_type === 'hourly' ? 'час' : 
                                 work.salary_type === 'monthly' ? 'мес' : 'смена'}
                              </span>
                            )}
                          </div>

                          {work.responsibilities && (
                            <div className="mb-2">
                              <p className="text-xs text-gray-500 mb-1">Обязанности:</p>
                              <p className="text-sm text-slate-700 dark:text-gray-300">{work.responsibilities}</p>
                            </div>
                          )}

                          {work.achievements && (
                            <div className="mb-3">
                              <p className="text-xs text-gray-500 mb-1">Достижения:</p>
                              <p className="text-sm text-slate-700 dark:text-gray-300">{work.achievements}</p>
                            </div>
                          )}

                          {work.is_current && canEditOperator && (
                            <div className="flex justify-end mt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleEndCurrentWork(work.id)}
                                className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-xs h-7"
                              >
                                <X className="w-3 h-3 mr-1" />
                                Завершить период
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <Briefcase className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="text-lg font-medium mb-1">Нет записей об истории работы</p>
                    <p className="text-sm text-gray-600">Добавьте первую запись, нажав кнопку выше</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Документы */}
          {activeTab === 'docs' && (
            <Card className="p-6 bg-white dark:bg-gray-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <FileText className="w-5 h-5 text-blue-400" />
                  Документы
                </h3>
                
                {canDocumentUpload && (
                  <DocumentUpload
                    operatorId={operatorId}
                    onUploadComplete={handleDocumentUpload}
                    onError={setUploadError}
                  />
                )}
              </div>

              <DocumentList
                documents={documents}
                onVerify={canDocumentUpload ? handleDocumentVerify : undefined}
                onDelete={canDocumentUpload ? handleDocumentDelete : undefined}
                formatDate={formatDate}
              />
            </Card>
          )}

          {/* Заметки */}
          {activeTab === 'notes' && (
            <Card className="p-6 bg-white dark:bg-gray-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <FileSignature className="w-5 h-5 text-amber-400" />
                Заметки
              </h3>

              {/* Форма добавления заметки */}
              <div className="mb-6 bg-slate-50 dark:bg-gray-800/30 rounded-xl p-4 border border-slate-200 dark:border-white/5">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Напишите заметку..."
                  rows={3}
                  className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50 mb-3"
                />
                
                <div className="flex flex-wrap gap-2">
                  <select
                    value={newNoteType}
                    onChange={(e) => setNewNoteType(e.target.value)}
                    className="bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                  >
                    <option value="general">Обычная</option>
                    <option value="warning">Важное</option>
                    <option value="achievement">Достижение</option>
                    <option value="issue">Проблема</option>
                  </select>

                  {canEditOperator && (
                    <Button
                      onClick={handleAddNote}
                      disabled={!newNote.trim() || saving}
                      className="bg-violet-500 hover:bg-violet-600 text-white"
                    >
                      {saving ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4 mr-2" />
                      )}
                      Добавить заметку
                    </Button>
                  )}
                </div>
              </div>

              {/* Список заметок */}
              <div className="space-y-3">
                {notes.length > 0 ? (
                  notes.map((note) => (
                    <div
                      key={note.id}
                      className={`p-4 rounded-xl border ${
                        note.note_type === 'warning'
                          ? 'bg-amber-500/5 border-amber-500/20'
                          : note.note_type === 'achievement'
                          ? 'bg-emerald-500/5 border-emerald-500/20'
                          : note.note_type === 'issue'
                          ? 'bg-rose-500/5 border-rose-500/20'
                          : 'bg-white dark:bg-gray-800/30 border-slate-200 dark:border-white/5'
                      }`}
                    >
                      <div className="flex flex-wrap justify-between items-start gap-2 mb-2">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          note.note_type === 'warning'
                            ? 'bg-amber-500/20 text-amber-400'
                            : note.note_type === 'achievement'
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : note.note_type === 'issue'
                            ? 'bg-rose-500/20 text-rose-400'
                            : 'bg-slate-100 dark:bg-gray-500/20 text-slate-500 dark:text-gray-400'
                        }`}>
                          {note.note_type === 'warning' ? 'Важное' :
                           note.note_type === 'achievement' ? 'Достижение' :
                           note.note_type === 'issue' ? 'Проблема' : 'Обычная'}
                        </span>
                        <span className="text-xs text-gray-500">
                          {new Date(note.created_at).toLocaleString('ru-RU')}
                        </span>
                      </div>

                      <p className="text-sm text-slate-700 dark:text-gray-300 mb-2">{note.note}</p>

                      {note.created_by_name && (
                        <p className="text-xs text-gray-500">
                          Автор: {note.created_by_name}
                        </p>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <FileSignature className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="text-lg font-medium mb-1">Нет заметок</p>
                    <p className="text-sm text-gray-600">Добавьте первую заметку</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Банковские реквизиты */}
          {(profile?.bank_name || profile?.bank_account || profile?.bank_card_number || isEditing) && (
            <Card className="p-6 bg-white dark:bg-gray-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-emerald-400" />
                Банковские реквизиты
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-gray-500 mb-1">Банк</label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedProfile.bank_name || ''}
                      onChange={(e) => setEditedProfile({ ...editedProfile, bank_name: e.target.value })}
                      placeholder="Название банка"
                      className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                    />
                  ) : (
                    <p className="text-sm">{profile?.bank_name || 'Не указано'}</p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1">Номер счета</label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedProfile.bank_account || ''}
                      onChange={(e) => setEditedProfile({ ...editedProfile, bank_account: e.target.value })}
                      placeholder="Номер счета"
                      className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                    />
                  ) : (
                    <p className="text-sm font-mono">{profile?.bank_account || 'Не указано'}</p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-500 mb-1">Номер карты</label>
                  {isEditing ? (
                    <input
                      type="text"
                      value={editedProfile.bank_card_number || ''}
                      onChange={(e) => setEditedProfile({ ...editedProfile, bank_card_number: e.target.value })}
                      placeholder="XXXX XXXX XXXX XXXX"
                      className="w-full bg-white dark:bg-gray-800/50 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
                    />
                  ) : (
                    <p className="text-sm font-mono">
                      {profile?.bank_card_number 
                        ? `**** ${profile.bank_card_number.slice(-4)}`
                        : 'Не указано'}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          )}
        </div>
      </main>
    </>
  )
}
