'use client'

import { useEffect, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { supabase } from '@/lib/supabase'
import { cn, formatRelativeDate } from '@/lib/utils'
import { StickyNote, Plus, Pin, X } from 'lucide-react'

interface Note {
  id: string
  title: string
  body: string | null
  pinned: boolean
  color: string
  tags: string[]
  lead_id: string | null
  created_at: string
  updated_at: string
}

const COLORS: Record<string, string> = {
  default: 'bg-gray-1 border-gray-5',
  blue: 'bg-blue-50 border-blue-200',
  green: 'bg-emerald-50 border-emerald-200',
  yellow: 'bg-amber-50 border-amber-200',
  pink: 'bg-pink-50 border-pink-200',
}

const COLOR_OPTIONS = [
  { value: 'default', label: 'Default', dot: 'bg-gray-4' },
  { value: 'blue', label: 'Blue', dot: 'bg-blue-400' },
  { value: 'green', label: 'Green', dot: 'bg-emerald-400' },
  { value: 'yellow', label: 'Yellow', dot: 'bg-amber-400' },
  { value: 'pink', label: 'Pink', dot: 'bg-pink-400' },
]

export default function NotesPage() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [editingNote, setEditingNote] = useState<Note | null>(null)
  const [form, setForm] = useState({ title: '', body: '', color: 'default', tags: '' })

  useEffect(() => { loadNotes() }, [])

  async function loadNotes() {
    setLoading(true)
    const { data } = await supabase.from('notes').select('*').order('pinned', { ascending: false }).order('updated_at', { ascending: false })
    setNotes(data || [])
    setLoading(false)
  }

  const filtered = notes.filter(n => {
    if (!search) return true
    const q = search.toLowerCase()
    return n.title.toLowerCase().includes(q) || n.body?.toLowerCase().includes(q) || n.tags.some(t => t.toLowerCase().includes(q))
  })

  async function saveNote() {
    if (!form.title.trim()) return
    const payload = {
      title: form.title.trim(),
      body: form.body.trim() || null,
      color: form.color,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
    }
    if (editingNote) {
      await supabase.from('notes').update(payload).eq('id', editingNote.id)
    } else {
      await supabase.from('notes').insert(payload)
    }
    setForm({ title: '', body: '', color: 'default', tags: '' })
    setShowNew(false)
    setEditingNote(null)
    loadNotes()
  }

  async function togglePin(note: Note) {
    await supabase.from('notes').update({ pinned: !note.pinned }).eq('id', note.id)
    loadNotes()
  }

  async function deleteNote(id: string) {
    if (!confirm('Delete this note?')) return
    await supabase.from('notes').delete().eq('id', id)
    loadNotes()
  }

  function startEdit(note: Note) {
    setEditingNote(note)
    setForm({ title: note.title, body: note.body || '', color: note.color, tags: note.tags.join(', ') })
    setShowNew(true)
  }

  function cancelForm() {
    setForm({ title: '', body: '', color: 'default', tags: '' })
    setShowNew(false)
    setEditingNote(null)
  }

  const action = (
    <button
      onClick={() => { cancelForm(); setShowNew(true) }}
      className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 transition-colors"
    >
      <Plus size={14} strokeWidth={2} />
      <span className="hidden sm:inline">New Note</span>
    </button>
  )

  return (
    <AppShell title="Notes" icon={<StickyNote size={20} />} count={filtered.length} action={action}>
      <div className="space-y-4">
        {/* Search */}
        <div className="flex items-center gap-3">
          <SearchBar value={search} onChange={setSearch} placeholder="Search notes..." className="flex-1" />
          <span className="text-xs text-gray-9 whitespace-nowrap">{filtered.length} notes</span>
        </div>

        {/* New/Edit form */}
        {showNew && (
          <div className="p-4 rounded-lg bg-gray-1 border border-gray-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-gray-12">{editingNote ? 'Edit Note' : 'New Note'}</h3>
              <button onClick={cancelForm} className="p-1 rounded hover:bg-gray-3 text-gray-9"><X size={14} /></button>
            </div>
            <input
              type="text" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
              placeholder="Title" autoFocus
              className="w-full px-3 py-2 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7"
            />
            <textarea
              value={form.body} onChange={e => setForm({ ...form, body: e.target.value })}
              placeholder="Write your note..." rows={4}
              className="w-full px-3 py-2 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7 resize-y"
            />
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                {COLOR_OPTIONS.map(c => (
                  <button key={c.value} onClick={() => setForm({ ...form, color: c.value })}
                    className={cn('w-6 h-6 rounded-full border-2 transition-all', c.dot, form.color === c.value ? 'border-gray-12 scale-110' : 'border-transparent')}
                    title={c.label}
                  />
                ))}
              </div>
              <input
                type="text" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })}
                placeholder="Tags (comma separated)"
                className="flex-1 px-3 py-1.5 border border-gray-5 rounded-md text-xs focus:outline-none focus:border-gray-7"
              />
              <button onClick={saveNote} disabled={!form.title.trim()}
                className={cn('px-4 py-2 rounded-md text-sm font-medium', form.title.trim() ? 'bg-gray-12 text-white hover:bg-gray-11' : 'bg-gray-4 text-gray-8')}>
                {editingNote ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {/* Notes grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-32 skeleton rounded-md" />)}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState title="No notes" description={search ? 'Try a different search' : 'Create your first note'} action={!search ? { label: '+ New Note', href: '#' } : undefined} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(note => (
              <div
                key={note.id}
                onClick={() => startEdit(note)}
                className={cn(
                  'group p-4 rounded-lg border cursor-pointer transition-all hover:shadow-sm',
                  COLORS[note.color] || COLORS.default,
                )}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="text-sm font-medium text-gray-12 line-clamp-1">{note.title}</h3>
                  <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={e => { e.stopPropagation(); togglePin(note) }}
                      className={cn('p-1 rounded transition-colors', note.pinned ? 'text-amber-500' : 'text-gray-8 hover:text-gray-12')}>
                      <Pin size={12} fill={note.pinned ? 'currentColor' : 'none'} />
                    </button>
                    <button onClick={e => { e.stopPropagation(); deleteNote(note.id) }}
                      className="p-1 rounded text-gray-8 hover:text-red-500 transition-colors">
                      <X size={12} />
                    </button>
                  </div>
                </div>
                {note.body && <p className="text-xs text-gray-11 line-clamp-4 whitespace-pre-wrap">{note.body}</p>}
                <div className="flex items-center gap-2 mt-3">
                  {note.pinned && <Pin size={10} className="text-amber-500" fill="currentColor" />}
                  {note.tags.map(tag => (
                    <span key={tag} className="text-2xs px-1.5 py-0.5 rounded bg-black/5 text-gray-9">{tag}</span>
                  ))}
                  <span className="text-2xs text-gray-8 ml-auto">{formatRelativeDate(note.updated_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
