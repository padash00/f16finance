'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Camera, Loader2, X } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'

interface AvatarUploadProps {
  operatorId: string
  currentAvatarUrl: string | null
  onUploadComplete: (url: string) => void
  onError: (error: string) => void
}

export default function AvatarUpload({ 
  operatorId, 
  currentAvatarUrl, 
  onUploadComplete,
  onError 
}: AvatarUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentAvatarUrl)

  const uploadAvatar = async (event: React.ChangeEvent<HTMLInputElement>) => {
    try {
      setUploading(true)
      
      const file = event.target.files?.[0]
      if (!file) return

      // Проверяем тип файла
      if (!file.type.startsWith('image/')) {
        onError('Пожалуйста, выберите изображение')
        return
      }

      // Проверяем размер файла (макс 5MB)
      if (file.size > 5 * 1024 * 1024) {
        onError('Файл слишком большой. Максимальный размер 5MB')
        return
      }

      // Создаем превью
      const objectUrl = URL.createObjectURL(file)
      setPreviewUrl(objectUrl)

      // Генерируем уникальное имя файла
      const fileExt = file.name.split('.').pop()
      const fileName = `${operatorId}-${Date.now()}.${fileExt}`
      const filePath = `avatars/${fileName}`

      // Загружаем в Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from('operator-files')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      // Получаем публичный URL
      const { data: { publicUrl } } = supabase.storage
        .from('operator-files')
        .getPublicUrl(filePath)

      // Обновляем профиль оператора с новым URL фото
      const { error: updateError } = await supabase
        .from('operator_profiles')
        .upsert({
          operator_id: operatorId,
          photo_url: publicUrl,
          updated_at: new Date().toISOString()
        }, { onConflict: 'operator_id' })

      if (updateError) throw updateError

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

      // Обновляем профиль, убираем фото
      const { error: updateError } = await supabase
        .from('operator_profiles')
        .upsert({
          operator_id: operatorId,
          photo_url: null,
          updated_at: new Date().toISOString()
        }, { onConflict: 'operator_id' })

      if (updateError) throw updateError

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
          <Camera className="w-8 h-8 text-white" />
        )}
      </div>

      {/* Кнопка загрузки при наведении */}
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
    </div>
  )
}