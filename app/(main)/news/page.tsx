'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Newspaper, Plus, RefreshCw, Trash2 } from 'lucide-react'

type Post = {
  id: string
  author_name: string
  title: string | null
  body: string
  image_url: string | null
  link_url: string | null
  link_label: string | null
  created_at: string
  viewed: boolean
}

const fmtTime = (iso: string) => {
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return 'сегодня · ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function NewsPage() {
  const [posts, setPosts] = useState<Post[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [canPublish, setCanPublish] = useState(false)
  const [composing, setComposing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [posting, setPosting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch('/api/news', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      setPosts(j.posts || [])
      setCanPublish(!!j.canPublish)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const publish = async () => {
    if (!draftBody.trim()) return
    setPosting(true)
    try {
      const r = await fetch('/api/news', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draftTitle.trim() || null, body: draftBody.trim() }),
      })
      if (!r.ok) {
        const err = await r.json().catch(() => null)
        alert(err?.error || 'Ошибка')
        return
      }
      setDraftTitle('')
      setDraftBody('')
      setComposing(false)
      load()
    } finally {
      setPosting(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Удалить пост?')) return
    const r = await fetch('/api/news', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (r.ok) setPosts(p => p.filter(x => x.id !== id))
  }

  return (
    <div className="app-page-tight space-y-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-orange-500/10 rounded-xl">
            <Newspaper className="w-7 h-7 text-orange-300" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Лента</h1>
            <p className="text-muted-foreground mt-0.5 text-sm">Новости и объявления компании</p>
          </div>
        </div>
        <div className="flex gap-2">
          {canPublish && (
            <Button onClick={() => setComposing(true)} className="bg-orange-600 hover:bg-orange-700">
              <Plus className="w-4 h-4 mr-1" /> Новый пост
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {composing && (
        <Card className="p-4 border-orange-500/40 bg-orange-500/[0.04]">
          <input
            value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            placeholder="Заголовок (необязательно)"
            className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm mb-2"
          />
          <textarea
            value={draftBody}
            onChange={e => setDraftBody(e.target.value)}
            rows={4}
            placeholder="Текст поста..."
            className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-orange-500 mb-3"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setComposing(false)}>Отмена</Button>
            <Button size="sm" className="bg-orange-600 hover:bg-orange-700" onClick={publish} disabled={posting || !draftBody.trim()}>
              Опубликовать
            </Button>
          </div>
        </Card>
      )}

      {error && (
        <Card className="p-4 border-red-500/30 bg-red-500/5 text-red-300 text-sm">{error}</Card>
      )}

      {loading && posts.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground text-sm">Загрузка...</div>
      ) : posts.length === 0 ? (
        <Card className="p-10 border-border bg-card text-center text-muted-foreground text-sm">
          Лента пуста — ещё нет постов
        </Card>
      ) : (
        <div className="space-y-3">
          {posts.map(post => (
            <Card key={post.id} className={`p-4 border-border bg-card ${!post.viewed ? 'ring-1 ring-orange-500/30' : ''}`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-orange-500/15 flex items-center justify-center text-orange-300 font-bold">
                    {post.author_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{post.author_name}</div>
                    <div className="text-xs text-muted-foreground">{fmtTime(post.created_at)}</div>
                  </div>
                </div>
                {canPublish && (
                  <button onClick={() => remove(post.id)} className="text-muted-foreground opacity-100 hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
              {post.title && (
                <h3 className="text-lg font-bold text-foreground mb-2">{post.title}</h3>
              )}
              {post.image_url && (
                <img src={post.image_url} className="w-full max-h-96 object-cover rounded-lg mb-3" alt="" />
              )}
              <p className="text-sm text-foreground whitespace-pre-wrap break-words">{post.body}</p>
              {post.link_url && (
                <a href={post.link_url} target="_blank" rel="noopener noreferrer"
                   className="inline-flex items-center gap-1 mt-2 text-xs text-blue-300 hover:underline">
                  🔗 {post.link_label || post.link_url}
                </a>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
