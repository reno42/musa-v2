'use client'

import { useEffect, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useSettings } from '@/lib/settings-context'
import { Webhook, Plus, Trash2, RefreshCw, Zap, ZapOff, ExternalLink, Send } from 'lucide-react'

interface Webhook {
  id: string
  name: string
  url: string
  events: string[]
  active: boolean
  secret: string | null
  created_at: string
  updated_at: string
}

const AVAILABLE_EVENTS = [
  'lead.created', 'lead.updated', 'lead.enriched', 'lead.qualified',
  'lead.advanced', 'lead.assigned', 'lead.scored', 'lead.contacted',
  'lead.deleted', 'lead.lost', 'lead.won',
  'deal.created', 'deal.updated', 'deal.stage_changed', 'deal.won', 'deal.lost', 'deal.deleted',
  'contact.created', 'contact.updated', 'contact.deleted',
  'task.created', 'task.completed', 'task.deleted',
]

export default function WebhooksPage() {
  const { locale } = useSettings()
  const t = (es: string, en: string) => locale === 'es' ? es : en
  
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', url: '', events: ['lead.created'] as string[], secret: '' })
  const [saving, setSaving] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)

  useEffect(() => { loadWebhooks() }, [])

  async function loadWebhooks() {
    setLoading(true)
    const { data } = await supabase.from('webhooks').select('*').order('created_at', { ascending: false })
    setWebhooks(data || [])
    setLoading(false)
  }

  async function handleSave() {
    if (!form.name || !form.url) return
    setSaving(true)
    
    if (editingId) {
      await supabase.from('webhooks').update({
        name: form.name, url: form.url, events: form.events, secret: form.secret || null
      }).eq('id', editingId)
    } else {
      await supabase.from('webhooks').insert({
        name: form.name, url: form.url, events: form.events, active: true, secret: form.secret || null
      })
    }
    
    setShowForm(false)
    setEditingId(null)
    setForm({ name: '', url: '', events: ['lead.created'], secret: '' })
    setSaving(false)
    loadWebhooks()
  }

  async function handleToggleActive(id: string, currentActive: boolean) {
    await supabase.from('webhooks').update({ active: !currentActive }).eq('id', id)
    loadWebhooks()
  }

  async function handleDelete(id: string) {
    if (!confirm(t('¿Eliminar este webhook?', 'Delete this webhook?'))) return
    await supabase.from('webhooks').delete().eq('id', id)
    loadWebhooks()
  }

  async function handleTest(webhook: Webhook) {
    setTestingId(webhook.id)
    try {
      const res = await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_id: webhook.id })
      })
      const result = await res.json()
      if (result.success) {
        alert(t('¡Webhook enviado!', 'Webhook sent!'))
      } else {
        alert(t('Error: ', 'Error: ') + (result.error || 'Unknown'))
      }
    } catch {
      alert(t('Error al enviar', 'Error sending'))
    }
    setTestingId(null)
  }

  function startEdit(webhook: Webhook) {
    setEditingId(webhook.id)
    setForm({ name: webhook.name, url: webhook.url, events: webhook.events, secret: webhook.secret || '' })
    setShowForm(true)
  }

  function toggleEvent(event: string) {
    setForm(prev => ({
      ...prev,
      events: prev.events.includes(event) ? prev.events.filter(e => e !== event) : [...prev.events, event]
    }))
  }

  const action = (
    <div className="flex gap-2">
      <button onClick={loadWebhooks} className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-1 border border-gray-5 text-sm text-gray-10 hover:bg-gray-3 transition-colors">
        <RefreshCw size={14} />
        <span className="hidden sm:inline">{t('Actualizar', 'Refresh')}</span>
      </button>
      <button onClick={() => { setShowForm(true); setEditingId(null); setForm({ name: '', url: '', events: ['lead.created'], secret: '' }) }}
        className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 transition-colors">
        <Plus size={14} />
        <span>{t('Nuevo Webhook', 'New Webhook')}</span>
      </button>
    </div>
  )

  return (
    <AppShell title={t('Webhooks', 'Webhooks')} icon={<Webhook size={20} />} action={action}>
      <div className="space-y-4">
        {/* Create/Edit Form */}
        {showForm && (
          <div className="bg-gray-1 border border-gray-5 rounded-lg p-4 space-y-4">
            <h3 className="text-sm font-medium text-gray-12">
              {editingId ? t('Editar Webhook', 'Edit Webhook') : t('Nuevo Webhook', 'New Webhook')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-gray-9 mb-1 block">{t('Nombre', 'Name')}</label>
                <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder={t('ej: Notificar Slack', 'e.g: Notify Slack')}
                  className="w-full px-3 py-2 rounded-md bg-gray-1 border border-gray-5 text-sm text-gray-12 focus:outline-none focus:ring-2 focus:ring-gray-8" />
              </div>
              <div>
                <label className="text-xs text-gray-9 mb-1 block">URL</label>
                <input value={form.url} onChange={e => setForm(p => ({ ...p, url: e.target.value }))}
                  placeholder="https://hooks.slack.com/..."
                  className="w-full px-3 py-2 rounded-md bg-gray-1 border border-gray-5 text-sm text-gray-12 focus:outline-none focus:ring-2 focus:ring-gray-8" />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-9 mb-2 block">{t('Eventos', 'Events')}</label>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_EVENTS.map(event => (
                  <button key={event} onClick={() => toggleEvent(event)}
                    className={cn('px-3 py-1.5 rounded-md text-xs font-mono border transition-colors',
                      form.events.includes(event) ? 'bg-gray-12 text-white border-gray-12' : 'bg-gray-1 text-gray-10 border-gray-5 hover:border-gray-8')}>
                    {event}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowForm(false); setEditingId(null) }}
                className="px-4 py-2 rounded-md text-sm text-gray-10 hover:bg-gray-3 transition-colors">
                {t('Cancelar', 'Cancel')}
              </button>
              <button onClick={handleSave} disabled={saving || !form.name || !form.url}
                className="px-4 py-2 rounded-md text-sm font-medium bg-gray-12 text-white hover:bg-gray-11 disabled:opacity-50 transition-colors">
                {saving ? t('Guardando...', 'Saving...') : t('Guardar', 'Save')}
              </button>
            </div>
          </div>
        )}

        {/* Webhooks list */}
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 skeleton rounded-md" />)}</div>
        ) : webhooks.length === 0 ? (
          <div className="text-center py-12">
            <Webhook size={40} className="text-gray-6 mx-auto mb-4" />
            <p className="text-sm text-gray-9">{t('Sin webhooks', 'No webhooks')}</p>
            <p className="text-xs text-gray-8 mt-1">{t('Crea uno para recibir notificaciones cuando cambian los leads', 'Create one to get notified when leads change')}</p>
          </div>
        ) : (
          <div className="bg-gray-1 rounded-md border border-gray-5 divide-y divide-gray-5">
            {webhooks.map(webhook => (
              <div key={webhook.id} className="flex items-center gap-4 px-4 py-3">
                <button onClick={() => handleToggleActive(webhook.id, webhook.active)}
                  className={cn('w-10 h-6 rounded-full transition-colors relative flex-shrink-0',
                    webhook.active ? 'bg-emerald-500' : 'bg-gray-6')}>
                  <div className={cn('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                    webhook.active ? 'left-[18px]' : 'left-0.5')} />
                </button>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-12">{webhook.name}</span>
                    {webhook.active ? <Zap size={12} className="text-emerald-500" /> : <ZapOff size={12} className="text-gray-6" />}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-8 truncate max-w-xs">{webhook.url || 'Sin URL'}</span>
                    {webhook.url && <ExternalLink size={10} className="text-gray-6 flex-shrink-0" />}
                  </div>
                  <div className="flex gap-1 mt-1">
                    {webhook.events.map(event => (
                      <span key={event} className="text-2xs px-1.5 py-0.5 rounded bg-gray-4 text-gray-10 font-mono">{event}</span>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <button onClick={() => handleTest(webhook)} disabled={testingId === webhook.id || !webhook.url}
                    title={t('Probar', 'Test')}
                    className="p-2 rounded-md text-gray-8 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-30 transition-colors">
                    <Send size={14} />
                  </button>
                  <button onClick={() => startEdit(webhook)}
                    className="p-2 rounded-md text-gray-8 hover:text-gray-12 hover:bg-gray-3 transition-colors">
                    <RefreshCw size={14} />
                  </button>
                  <button onClick={() => handleDelete(webhook.id)}
                    className="p-2 rounded-md text-gray-8 hover:text-red-600 hover:bg-red-50 transition-colors">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  )
}
