'use client'

import { useState } from 'react'
import { Upload, FileText, X, Loader2, Check, Eye, Download, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { Button } from '@/components/ui/button'

interface Document {
  id: string
  operator_id: string
  document_type: string
  document_name: string
  document_url: string
  document_number?: string
  issue_date?: string
  expiry_date?: string
  is_verified: boolean
  notes?: string
}

interface DocumentUploadProps {
  operatorId: string
  onUploadComplete: (document: Document) => void
  onError: (error: string) => void
}

const DOCUMENT_TYPES = [
  { value: 'passport', label: 'Паспорт' },
  { value: 'id_card', label: 'Удостоверение личности' },
  { value: 'contract', label: 'Трудовой договор' },
  { value: 'diploma', label: 'Диплом' },
  { value: 'certificate', label: 'Сертификат' },
  { value: 'medical_book', label: 'Медицинская книжка' },
  { value: 'other', label: 'Другое' }
]

export default function DocumentUpload({ operatorId, onUploadComplete, onError }: DocumentUploadProps) {
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

    // Проверяем размер файла (макс 10MB)
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

      // Генерируем уникальное имя файла
      const fileExt = selectedFile.name.split('.').pop()
      const fileName = `${operatorId}/${documentType}-${Date.now()}.${fileExt}`
      const filePath = `documents/${fileName}`

      // Загружаем в Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('operator-files')
        .upload(filePath, selectedFile)

      if (uploadError) throw uploadError

      // Получаем публичный URL
      const { data: { publicUrl } } = supabase.storage
        .from('operator-files')
        .getPublicUrl(filePath)

      // Сохраняем информацию о документе в базу
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
      
      // Сбрасываем форму
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
    <div className="bg-gray-800/30 rounded-xl p-4 border border-white/5">
      <div className="flex justify-between items-center mb-3">
        <h4 className="text-sm font-medium">Новый документ</h4>
        <button
          onClick={() => setShowForm(false)}
          className="p-1 hover:bg-white/10 rounded-lg transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-3">
        {/* Тип документа */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Тип документа *</label>
          <select
            value={documentType}
            onChange={(e) => setDocumentType(e.target.value)}
            className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
          >
            <option value="">Выберите тип</option>
            {DOCUMENT_TYPES.map(type => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </div>

        {/* Выбор файла */}
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
              className="flex-1 px-3 py-2 bg-gray-800/50 border border-white/10 rounded-lg text-sm cursor-pointer hover:bg-gray-700/50 transition-colors"
            >
              {selectedFile ? selectedFile.name : 'Выберите файл'}
            </label>
          </div>
        </div>

        {/* Номер документа */}
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Номер документа</label>
          <input
            type="text"
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
            className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
            placeholder="Например: N 123456"
          />
        </div>

        {/* Даты */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Дата выдачи</label>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Действителен до</label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              className="w-full bg-gray-800/50 border border-white/10 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-violet-500/50"
            />
          </div>
        </div>

        {/* Кнопки */}
        <div className="flex justify-end gap-2 mt-4">
          <Button
            size="sm"
            onClick={() => setShowForm(false)}
            variant="outline"
            className="border-white/10"
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