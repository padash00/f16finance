'use client'

import { useState } from 'react'
import { FileText, Eye, Download, Check, X, AlertCircle, Loader2 } from 'lucide-react'
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

interface DocumentListProps {
  documents: Document[]
  onVerify?: (documentId: string) => void
  onDelete?: (documentId: string) => void
  formatDate: (date: string | null) => string
}

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  passport: 'Паспорт',
  id_card: 'Удостоверение личности',
  contract: 'Трудовой договор',
  diploma: 'Диплом',
  certificate: 'Сертификат',
  medical_book: 'Медицинская книжка',
  other: 'Другое'
}

export default function DocumentList({ documents, onVerify, onDelete, formatDate }: DocumentListProps) {
  const [verifying, setVerifying] = useState<string | null>(null)

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
      const { error } = await supabase
        .from('operator_documents')
        .delete()
        .eq('id', documentId)

      if (error) throw error

      if (onDelete) onDelete(documentId)
    } catch (error) {
      console.error('Error deleting document:', error)
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
          <div key={doc.id} className="bg-gray-800/30 rounded-xl p-4 border border-white/5 hover:bg-gray-800/50 transition-colors">
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-400" />
                <div>
                  <span className="font-medium text-white">{doc.document_name}</span>
                  <p className="text-xs text-gray-500">
                    {DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
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
              <p className="text-xs text-gray-400 mb-1">Номер: {doc.document_number}</p>
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
                className="border-white/10 text-xs h-7"
              >
                <Eye className="w-3 h-3 mr-1" />
                Просмотр
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleDownload(doc.document_url, doc.document_name)}
                className="border-white/10 text-xs h-7"
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
                  className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-xs h-7"
                >
                  <X className="w-3 h-3 mr-1" />
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