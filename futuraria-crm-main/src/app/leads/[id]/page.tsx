'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { EditableField } from '@/components/ui/EditableField'
import { supabase } from '@/lib/supabase'
import { cn, getStageColor, getStageLabel, getPriorityColor, formatDate, formatRelativeDate, getInitials } from '@/lib/utils'
import type { Lead, Activity, LeadStage, LeadPriority, LeadSource, ContactRole } from '@/types/database'
import { EmailCompose } from '@/components/ui/EmailCompose'
import { useToast } from '@/components/ui/Toast'

const STAGES: LeadStage[] = ['new', 'researching', 'contacted', 'qualified', 'demo_scheduled', 'proposal_sent', 'negotiation', 'won', 'lost', 'nurturing']
const PRIORITIES: { value: LeadPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]
const SOURCES: { value: LeadSource; label: string }[] = [
  { value: 'website', label: 'Website' },
  { value: 'linkedin', label: 'LinkedIn' },
  { value: 'referral', label: 'Referral' },
  { value: 'cold_outreach', label: 'Outreach' },
  { value: 'event', label: 'Event' },
  { value: 'social_media', label: 'Social' },
  { value: 'organic', label: 'Organic' },
  { value: 'partner', label: 'Partner' },
  { value: 'other', label: 'Other' },
]
const ROLES: { value: ContactRole; label: string }[] = [
  { value: 'decision_maker', label: 'Decision Maker' }, { value: 'influencer', label: 'Influencer' },
  { value: 'buyer', label: 'Buyer' }, { value: 'end_user', label: 'End User' },
  { value: 'champion', label: 'Champion' }, { value: 'gatekeeper', label: 'Gatekeeper' }, { value: 'other', label: 'Other' },
]
const ROLE_COLORS: Record<string, string> = {
  decision_maker: 'bg-purple-50 text-purple-700 border-purple-200',
  influencer: 'bg-blue-50 text-blue-700 border-blue-200',
  buyer: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  end_user: 'bg-amber-50 text-amber-700 border-amber-200',
  champion: 'bg-pink-50 text-pink-700 border-pink-200',
  gatekeeper: 'bg-gray-100 text-gray-600 border-gray-200',
  other: 'bg-gray-50 text-gray-500 border-gray-200',
}

const ACTIVITY_ICONS: Record<string, string> = {
  note: '📝', email: '📧', call: '📞', meeting: '📅', whatsapp: '💬',
  demo: '🖥️', proposal: '📄', follow_up: '🔔', status_change: '🔄', enrichment: '🔍',
}

const SOCIAL_PLATFORMS = [
  { value: 'instagram', label: 'Instagram', icon: '📸' },
  { value: 'tiktok', label: 'TikTok', icon: '🎵' },
  { value: 'linkedin', label: 'LinkedIn', icon: '💼' },
  { value: 'whatsapp', label: 'WhatsApp', icon: '💬' },
  { value: 'facebook', label: 'Facebook', icon: '👥' },
  { value: 'medium', label: 'Medium', icon: '✍️' },
  { value: 'pinterest', label: 'Pinterest', icon: '📌' },
  { value: 'twitter', label: 'Twitter/X', icon: '🐦' },
  { value: 'other', label: 'Otro', icon: '🔗' },
] as const

type SocialPlatform = typeof SOCIAL_PLATFORMS[number]['value']

interface SocialMediaItem {
  platform: SocialPlatform
  handle?: string
  url?: string
  followers?: number
  posts?: number
  is_active?: boolean
}

interface PressMention {
  title: string
  url?: string
  source?: string
  date?: string
  type?: 'formal' | 'digital'
}

function getPlatformIcon(platform: string) {
  return SOCIAL_PLATFORMS.find(p => p.value === platform)?.icon || '🔗'
}

function getPlatformLabel(platform: string) {
  return SOCIAL_PLATFORMS.find(p => p.value === platform)?.label || platform
}

function SocialMediaCard({
  item,
  index,
  onUpdate,
  onDelete,
  showWhatsapp = false,
}: {
  item: SocialMediaItem
  index: number
  onUpdate: (index: number, field: string, value: unknown) => void
  onDelete: (index: number) => void
  showWhatsapp?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const platforms = showWhatsapp
    ? SOCIAL_PLATFORMS
    : SOCIAL_PLATFORMS.filter(p => p.value !== 'whatsapp')

  if (editing) {
    return (
      <div className="p-3 rounded-md bg-gray-2 border border-gray-6 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-9">Editar red social</span>
          <button onClick={() => setEditing(false)} className="text-xs text-gray-9 hover:text-gray-12">✕</button>
        </div>
        <select
          value={item.platform}
          onChange={(e) => onUpdate(index, 'platform', e.target.value)}
          className="w-full px-2 py-1.5 bg-gray-1 border border-gray-5 rounded-md text-sm"
        >
          {platforms.map(p => (
            <option key={p.value} value={p.value}>{p.icon} {p.label}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="@handle"
          value={item.handle || ''}
          onChange={(e) => onUpdate(index, 'handle', e.target.value)}
          className="w-full px-2 py-1.5 bg-gray-1 border border-gray-5 rounded-md text-sm"
        />
        <input
          type="url"
          placeholder="https://..."
          value={item.url || ''}
          onChange={(e) => onUpdate(index, 'url', e.target.value)}
          className="w-full px-2 py-1.5 bg-gray-1 border border-gray-5 rounded-md text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="number"
            placeholder="Seguidores"
            value={item.followers ?? ''}
            onChange={(e) => onUpdate(index, 'followers', e.target.value ? Number(e.target.value) : undefined)}
            className="w-full px-2 py-1.5 bg-gray-1 border border-gray-5 rounded-md text-sm"
          />
          <input
            type="number"
            placeholder="Posts"
            value={item.posts ?? ''}
            onChange={(e) => onUpdate(index, 'posts', e.target.value ? Number(e.target.value) : undefined)}
            className="w-full px-2 py-1.5 bg-gray-1 border border-gray-5 rounded-md text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-gray-9">
          <input
            type="checkbox"
            checked={item.is_active ?? true}
            onChange={(e) => onUpdate(index, 'is_active', e.target.checked)}
            className="rounded"
          />
          Activo
        </label>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 p-3 rounded-md bg-gray-1 border border-gray-5 group">
      <span className="text-lg flex-shrink-0">{getPlatformIcon(item.platform)}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-9">{getPlatformLabel(item.platform)}</span>
          {item.is_active === false && (
            <span className="text-2xs px-1.5 py-0.5 rounded bg-gray-4 text-gray-8">Inactivo</span>
          )}
        </div>
        <p className="text-sm text-gray-12 truncate">
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {item.handle || item.url}
            </a>
          ) : (
            item.handle || '—'
          )}
        </p>
        <div className="flex items-center gap-3 mt-0.5">
          {item.followers != null && (
            <span className="text-2xs text-gray-9">{item.followers.toLocaleString()} seguidores</span>
          )}
          {item.posts != null && (
            <span className="text-2xs text-gray-9">{item.posts.toLocaleString()} posts</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-gray-4 text-gray-9 hover:text-gray-12" title="Editar">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
          </svg>
        </button>
        <button onClick={() => onDelete(index)} className="p-1 rounded hover:bg-red-50 text-gray-9 hover:text-red-600" title="Eliminar">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function PressMentionCard({
  item,
  index,
  onUpdate,
  onDelete,
}: {
  item: PressMention
  index: number
  onUpdate: (index: number, field: string, value: unknown) => void
  onDelete: (index: number) => void
}) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <div className="p-3 rounded-md bg-gray-2 border border-gray-6 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-9">Editar mención</span>
          <button onClick={() => setEditing(false)} className="text-xs text-gray-9 hover:text-gray-12">✕</button>
        </div>
        <input
          type="text"
          placeholder="Título"
          value={item.title}
          onChange={(e) => onUpdate(index, 'title', e.target.value)}
          className="w-full px-2 py-1.5 bg-gray-1 border border-gray-5 rounded-md text-sm"
        />
        <input
          type="url"
          placeholder="https://..."
          value={item.url || ''}
          onChange={(e) => onUpdate(index, 'url', e.target.value)}
          className="w-full px-2 py-1.5 bg-gray-1 border border-gray-5 rounded-md text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            placeholder="Fuente"
            value={item.source || ''}
            onChange={(e) => onUpdate(index, 'source', e.target.value)}
            className="w-full px-2 py-1.5 bg-gray-1 border border-gray-5 rounded-md text-sm"
          />
          <input
            type="text"
            placeholder="Fecha"
            value={item.date || ''}
            onChange={(e) => onUpdate(index, 'date', e.target.value)}
            className="w-full px-2 py-1.5 bg-gray-1 border border-gray-5 rounded-md text-sm"
          />
        </div>
        <select
          value={item.type || 'digital'}
          onChange={(e) => onUpdate(index, 'type', e.target.value)}
          className="w-full px-2 py-1.5 bg-gray-1 border border-gray-5 rounded-md text-sm"
        >
          <option value="formal">📰 Prensa formal</option>
          <option value="digital">🌐 Digital</option>
        </select>
      </div>
    )
  }

  return (
    <div className="flex items-start gap-3 p-3 rounded-md bg-gray-1 border border-gray-5 group">
      <span className="text-lg flex-shrink-0 mt-0.5">{item.type === 'formal' ? '📰' : '🌐'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-12">
          {item.url ? (
            <a href={item.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {item.source && <span className="text-2xs text-gray-9">{item.source}</span>}
          {item.source && item.date && <span className="text-2xs text-gray-8">·</span>}
          {item.date && <span className="text-2xs text-gray-9">{item.date}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => setEditing(true)} className="p-1 rounded hover:bg-gray-4 text-gray-9 hover:text-gray-12" title="Editar">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
          </svg>
        </button>
        <button onClick={() => onDelete(index)} className="p-1 rounded hover:bg-red-50 text-gray-9 hover:text-red-600" title="Eliminar">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  )
}

function CompanySelector({ lead, companies, onCompanyChange, onCreateCompany }: {
  lead: Lead; companies: { id: string; name: string }[]
  onCompanyChange: (companyId: string | null, companyName: string | null) => void
  onCreateCompany: (name: string) => Promise<string | null>
}) {
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState('')
  async function handleCreate() {
    if (!newName.trim()) return
    const id = await onCreateCompany(newName.trim())
    if (id) { onCompanyChange(id, newName.trim()); setNewName(''); setShowNew(false) }
  }
  return (
    <div className="space-y-2">
      <select value={lead.company_id || ''} onChange={(e) => {
        if (e.target.value === '__new__') { setShowNew(true) }
        else if (e.target.value === '') { onCompanyChange(null, null) }
        else { const co = companies.find(c => c.id === e.target.value); onCompanyChange(e.target.value, co?.name || null) }
      }} className="w-full px-3 py-2 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7">
        <option value="">No company</option>
        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        <option value="__new__">+ Add new company</option>
      </select>
      {showNew && (
        <div className="flex gap-2">
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Company name"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreate() } }}
            className="flex-1 px-3 py-2 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" />
          <button onClick={handleCreate} className="px-3 py-2 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 transition-colors">Create</button>
          <button onClick={() => { setShowNew(false); setNewName('') }} className="px-3 py-2 rounded-md bg-gray-4 text-gray-10 text-sm hover:bg-gray-5 transition-colors">Cancel</button>
        </div>
      )}
    </div>
  )
}

export default function LeadDetailPage() {
  const params = useParams()
  const router = useRouter()
  const leadId = params.id as string

  const [lead, setLead] = useState<Lead | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [editingStage, setEditingStage] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [savingNote, setSavingNote] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const { toast } = useToast()

  useEffect(() => { loadLead() }, [leadId])

  async function loadLead() {
    setLoading(true)
    const [leadRes, actRes, coRes] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).single(),
      supabase.from('activities').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(20),
      supabase.from('companies').select('id, name').order('name'),
    ])
    if (leadRes.data) setLead(leadRes.data)
    if (actRes.data) setActivities(actRes.data)
    if (coRes.data) setCompanies(coRes.data)
    setLoading(false)
  }

  async function updateField(field: string, value: unknown) {
    if (!lead) return
    const { error } = await supabase.from('leads').update({ [field]: value }).eq('id', lead.id)
    if (!error) {
      setLead({ ...lead, [field]: value })
    }
  }

  async function handleCompanyChange(companyId: string | null, companyName: string | null) {
    if (!lead) return
    const { error } = await supabase.from('leads').update({ company_id: companyId, company_name: companyName }).eq('id', lead.id)
    if (!error) setLead({ ...lead, company_id: companyId, company_name: companyName })
  }

  async function handleCreateCompany(name: string) {
    const { data, error } = await supabase.from('companies').insert({ name }).select('id, name').single()
    if (error || !data) { toast('Error creating company', 'error'); return null }
    setCompanies(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    return data.id
  }

  async function updateStage(newStage: LeadStage) {
    if (!lead) return
    const { error } = await supabase.from('leads').update({ stage: newStage }).eq('id', lead.id)
    if (!error) { setLead({ ...lead, stage: newStage }); setEditingStage(false); loadLead() }
  }

  async function addNote() {
    if (!noteText.trim() || !lead) return
    setSavingNote(true)
    await supabase.from('activities').insert({ lead_id: lead.id, type: 'note', title: 'Note added', description: noteText.trim() })
    setNoteText(''); loadLead(); setSavingNote(false)
  }

  async function deleteLead() {
    if (!confirm('Delete this lead? This cannot be undone.')) return
    await supabase.from('leads').delete().eq('id', leadId)
    router.push('/leads')
  }

  // Social media handlers
  function updateEnrichmentField(field: string, value: unknown) {
    if (!lead) return
    const newEnrichment = { ...lead.enrichment, [field]: value }
    updateField('enrichment', newEnrichment)
  }

  function addSocialMedia(field: 'personal_social_media' | 'business_social_media') {
    if (!lead) return
    const current = (lead.enrichment?.[field] as SocialMediaItem[]) || []
    const newItem: SocialMediaItem = { platform: 'instagram', handle: '', url: '', followers: undefined, posts: undefined, is_active: true }
    updateEnrichmentField(field, [...current, newItem])
  }

  function updateSocialMedia(field: 'personal_social_media' | 'business_social_media', index: number, key: string, value: unknown) {
    if (!lead) return
    const items = [...((lead.enrichment?.[field] as SocialMediaItem[]) || [])]
    items[index] = { ...items[index], [key]: value }
    updateEnrichmentField(field, items)
  }

  function deleteSocialMedia(field: 'personal_social_media' | 'business_social_media', index: number) {
    if (!lead) return
    const items = [...((lead.enrichment?.[field] as SocialMediaItem[]) || [])]
    items.splice(index, 1)
    updateEnrichmentField(field, items)
  }

  function addPressMention() {
    if (!lead) return
    const current = (lead.enrichment?.press_mentions as PressMention[]) || []
    const newItem: PressMention = { title: '', url: '', source: '', date: '', type: 'digital' }
    updateEnrichmentField('press_mentions', [...current, newItem])
  }

  function updatePressMention(index: number, key: string, value: unknown) {
    if (!lead) return
    const items = [...((lead.enrichment?.press_mentions as PressMention[]) || [])]
    items[index] = { ...items[index], [key]: value }
    updateEnrichmentField('press_mentions', items)
  }

  function deletePressMention(index: number) {
    if (!lead) return
    const items = [...((lead.enrichment?.press_mentions as PressMention[]) || [])]
    items.splice(index, 1)
    updateEnrichmentField('press_mentions', items)
  }

  if (loading) {
    return (
      <AppShell title="Lead">
        <div className="space-y-4">
          <div className="h-32 skeleton rounded-md" />
          <div className="h-20 skeleton rounded-md" />
          <div className="h-40 skeleton rounded-md" />
        </div>
      </AppShell>
    )
  }

  if (!lead) {
    return (
      <AppShell title="Lead">
        <div className="text-center py-12">
          <p className="text-gray-9">Lead not found</p>
        </div>
      </AppShell>
    )
  }

  const personalSocial = (lead.enrichment?.personal_social_media as SocialMediaItem[]) || []
  const businessSocial = (lead.enrichment?.business_social_media as SocialMediaItem[]) || []
  const pressMentions = (lead.enrichment?.press_mentions as PressMention[]) || []

  const action = (
    <button
      onClick={deleteLead}
      className="p-2 rounded-md hover:bg-red-50 text-gray-9 hover:text-red-600 transition-colors"
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
      </svg>
    </button>
  )

  return (
    <AppShell title={lead.full_name} subtitle={lead.company_name || lead.company_role || undefined} action={action}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — main info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Header card */}
          <div className="p-5 rounded-md bg-gray-1 border border-gray-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-gray-4 flex items-center justify-center flex-shrink-0">
                <span className="text-base font-semibold text-gray-9">{getInitials(lead.full_name)}</span>
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <EditableField
                  value={lead.full_name}
                  placeholder="Full name"
                  onSave={(v) => updateField('full_name', v)}
                  displayClassName="text-lg font-semibold"
                />
                <div className="flex items-center gap-2">
                  <EditableField
                    value={lead.company_role}
                    placeholder="Role"
                    onSave={(v) => updateField('company_role', v || null)}
                    displayClassName="text-sm text-gray-9"
                  />
                  {lead.company_name && <span className="text-sm text-gray-9">·</span>}
                  <EditableField
                    value={lead.company_name}
                    placeholder="Company"
                    onSave={(v) => updateField('company_name', v || null)}
                    displayClassName="text-sm text-gray-9"
                  />
                </div>
                <EditableField
                  value={lead.industry}
                  placeholder="Industry"
                  onSave={(v) => updateField('industry', v || null)}
                  displayClassName="text-xs text-gray-9"
                />
              </div>
              <ScoreBadge score={lead.score} size="md" />
            </div>

            {/* Contact grid — all editable */}
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-gray-9 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
                <EditableField
                  value={lead.email}
                  type="email"
                  placeholder="Email"
                  onSave={(v) => updateField('email', v || null)}
                  className="flex-1"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-gray-9 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
                </svg>
                <EditableField
                  value={lead.phone}
                  type="tel"
                  placeholder="Phone"
                  onSave={(v) => updateField('phone', v || null)}
                  className="flex-1"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 text-gray-9 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                <EditableField
                  value={lead.whatsapp}
                  type="tel"
                  placeholder="WhatsApp"
                  onSave={(v) => updateField('whatsapp', v || null)}
                  className="flex-1"
                />
              </div>
              <div className="flex items-center gap-1.5 text-xs text-gray-9">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {formatRelativeDate(lead.created_at)}
              </div>
            </div>
          </div>

          {/* Role + Priority + Source + Tags — all editable inline */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={lead.role || 'other'} onChange={(e) => updateField('role', e.target.value)}
              className={cn('px-2.5 py-1 rounded-md text-2xs font-medium border cursor-pointer', ROLE_COLORS[lead.role || 'other'] || ROLE_COLORS.other)}>
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <EditableField
              value={lead.priority}
              type="select"
              options={PRIORITIES}
              onSave={(v) => updateField('priority', v)}
              displayClassName={cn('text-2xs font-medium px-2 py-0.5 rounded-md border', getPriorityColor(lead.priority))}
            />
            <EditableField
              value={lead.source}
              type="select"
              options={SOURCES}
              onSave={(v) => updateField('source', v)}
              displayClassName="text-2xs font-medium px-2 py-0.5 rounded-md bg-gray-4 text-gray-9 border border-gray-5"
            />
            <EditableField
              value={lead.tags}
              type="tags"
              placeholder="tag1, tag2, tag3"
              onSave={(v) => updateField('tags', v)}
              label="Tags"
              className="flex-1 min-w-[200px]"
            />
          </div>

          {/* Company selector */}
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <h3 className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-3">Company</h3>
            <CompanySelector lead={lead} companies={companies} onCompanyChange={handleCompanyChange} onCreateCompany={handleCreateCompany} />
          </div>

          {/* Budget + Timeline */}
          <div className="grid grid-cols-2 gap-4">
            <EditableField
              value={lead.budget_range}
              placeholder="Budget range"
              onSave={(v) => updateField('budget_range', v || null)}
              label="Budget"
            />
            <EditableField
              value={lead.timeline}
              placeholder="Timeline"
              onSave={(v) => updateField('timeline', v || null)}
              label="Timeline"
            />
          </div>

          {/* Notes */}
          <div>
            <EditableField
              value={lead.notes}
              type="textarea"
              placeholder="Add notes..."
              onSave={(v) => updateField('notes', v || null)}
              label="Notes"
            />
          </div>

          {/* Redes Sociales — Personal */}
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-gray-9 uppercase tracking-wider">Redes Sociales — Personal</h3>
              <button
                onClick={() => addSocialMedia('personal_social_media')}
                className="flex items-center gap-1 text-xs text-gray-9 hover:text-gray-12 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Agregar
              </button>
            </div>
            {personalSocial.length === 0 ? (
              <p className="text-xs text-gray-8 text-center py-4">Sin redes sociales personales</p>
            ) : (
              <div className="space-y-2">
                {personalSocial.map((item, i) => (
                  <SocialMediaCard
                    key={i}
                    item={item}
                    index={i}
                    showWhatsapp
                    onUpdate={(idx, key, val) => updateSocialMedia('personal_social_media', idx, key, val)}
                    onDelete={(idx) => deleteSocialMedia('personal_social_media', idx)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Redes Sociales — Negocio */}
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-gray-9 uppercase tracking-wider">Redes Sociales — Negocio</h3>
              <button
                onClick={() => addSocialMedia('business_social_media')}
                className="flex items-center gap-1 text-xs text-gray-9 hover:text-gray-12 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Agregar
              </button>
            </div>
            {businessSocial.length === 0 ? (
              <p className="text-xs text-gray-8 text-center py-4">Sin redes sociales de negocio</p>
            ) : (
              <div className="space-y-2">
                {businessSocial.map((item, i) => (
                  <SocialMediaCard
                    key={i}
                    item={item}
                    index={i}
                    onUpdate={(idx, key, val) => updateSocialMedia('business_social_media', idx, key, val)}
                    onDelete={(idx) => deleteSocialMedia('business_social_media', idx)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Notas de Prensa */}
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-gray-9 uppercase tracking-wider">Notas de Prensa</h3>
              <button
                onClick={addPressMention}
                className="flex items-center gap-1 text-xs text-gray-9 hover:text-gray-12 transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Agregar
              </button>
            </div>
            {pressMentions.length === 0 ? (
              <p className="text-xs text-gray-8 text-center py-4">Sin menciones de prensa</p>
            ) : (
              <div className="space-y-2">
                {pressMentions.map((item, i) => (
                  <PressMentionCard
                    key={i}
                    item={item}
                    index={i}
                    onUpdate={(idx, key, val) => updatePressMention(idx, key, val)}
                    onDelete={(idx) => deletePressMention(idx)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Add activity note */}
          <div>
            <h3 className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-2">Add Note</h3>
            <div className="flex gap-2">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Write a note..."
                rows={2}
                className="flex-1 px-3 py-2 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7 resize-none"
              />
              <button
                onClick={addNote}
                disabled={!noteText.trim() || savingNote}
                className={cn(
                  'self-end px-4 py-2 rounded-md text-sm font-medium transition-colors',
                  noteText.trim()
                    ? 'bg-gray-12 text-white hover:bg-gray-11'
                    : 'bg-gray-4 text-gray-8'
                )}
              >
                {savingNote ? '...' : 'Add'}
              </button>
            </div>
          </div>

          {/* Activity timeline */}
          <div>
            <h3 className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-3">Activity</h3>
            {activities.length === 0 ? (
              <p className="text-xs text-gray-9 text-center py-6">No activity</p>
            ) : (
              <div className="bg-gray-1 rounded-md border border-gray-5 divide-y divide-gray-5">
                {activities.map((act) => (
                  <div key={act.id} className="flex gap-3 px-4 py-3">
                    <div className="w-6 h-6 rounded-full bg-gray-4 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <span className="text-2xs">{ACTIVITY_ICONS[act.type] || '•'}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-12">{act.title}</p>
                      {act.description && (
                        <p className="text-xs text-gray-9 mt-0.5 line-clamp-2">{act.description}</p>
                      )}
                      <p className="text-2xs text-gray-8 mt-1">{formatRelativeDate(act.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right column — stage + digital presence */}
        <div className="space-y-6">
          {/* Stage */}
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-medium text-gray-9 uppercase tracking-wider">Stage</h3>
              <button
                onClick={() => setEditingStage(!editingStage)}
                className="text-xs text-gray-9 hover:text-gray-12 transition-colors"
              >
                {editingStage ? 'Close' : 'Change'}
              </button>
            </div>
            {editingStage ? (
              <div className="flex flex-wrap gap-1.5">
                {STAGES.map((s) => (
                  <button
                    key={s}
                    onClick={() => updateStage(s)}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-2xs font-medium transition-all border',
                      lead.stage === s ? 'ring-2 ring-gray-12 ring-offset-1' : '',
                      getStageColor(s)
                    )}
                  >
                    {getStageLabel(s)}
                  </button>
                ))}
              </div>
            ) : (
              <span className={cn('inline-block px-2.5 py-1 rounded-md text-2xs font-medium border', getStageColor(lead.stage))}>
                {getStageLabel(lead.stage)}
              </span>
            )}
          </div>

          {/* Digital Presence */}
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <h3 className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-3">Digital Presence</h3>
            <div className="space-y-3">
              <EditableField
                value={lead.digital_presence?.website_type}
                type="select"
                options={[
                  { value: 'corporate', label: 'Corporate' },
                  { value: 'vsl', label: 'VSL' },
                  { value: 'both', label: 'Both' },
                  { value: 'none', label: 'None' },
                ]}
                onSave={(v) => updateField('digital_presence', { ...lead.digital_presence, website_type: v })}
                label="Website Type"
              />
              <EditableField
                value={lead.digital_presence?.perceived_digital_level}
                type="select"
                options={[
                  { value: 'beginner', label: 'Beginner' },
                  { value: 'intermediate', label: 'Intermediate' },
                  { value: 'advanced', label: 'Advanced' },
                ]}
                onSave={(v) => updateField('digital_presence', { ...lead.digital_presence, perceived_digital_level: v })}
                label="Digital Level"
              />
              <EditableField
                value={lead.digital_presence?.instagram_strategy}
                type="select"
                options={[
                  { value: 'educational', label: 'Educational' },
                  { value: 'promotional', label: 'Promotional' },
                  { value: 'mixed', label: 'Mixed' },
                  { value: 'none', label: 'None' },
                ]}
                onSave={(v) => updateField('digital_presence', { ...lead.digital_presence, instagram_strategy: v })}
                label="Instagram Strategy"
              />
              <EditableField
                value={lead.digital_presence?.content_strategy}
                type="select"
                options={[
                  { value: 'blog', label: 'Blog' },
                  { value: 'social', label: 'Social' },
                  { value: 'none', label: 'None' },
                  { value: 'testing', label: 'Testing' },
                ]}
                onSave={(v) => updateField('digital_presence', { ...lead.digital_presence, content_strategy: v })}
                label="Content Strategy"
              />
            </div>
          </div>

          {/* Análisis Web — Enrichment */}
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <h3 className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-3">🔍 Análisis Web</h3>
            <div className="space-y-3">
              <EditableField
                value={lead.website_url}
                placeholder="https://..."
                onSave={(v) => updateField('website_url', v || null)}
                label="Website"
              />
              <EditableField
                value={lead.website_tech}
                placeholder="WordPress, Elementor, código propio..."
                onSave={(v) => updateField('website_tech', v || null)}
                label="Tech Stack"
              />
              <div className="grid grid-cols-2 gap-3">
                <EditableField
                  value={lead.domain_age_year?.toString()}
                  placeholder="2020"
                  onSave={(v) => updateField('domain_age_year', v ? Number(v) : null)}
                  label="Dominio desde"
                />
                <EditableField
                  value={lead.footer_year?.toString()}
                  placeholder="2024"
                  onSave={(v) => updateField('footer_year', v ? Number(v) : null)}
                  label="Footer año"
                />
              </div>
              <EditableField
                value={lead.last_blog_date}
                placeholder="2024-01-15"
                onSave={(v) => updateField('last_blog_date', v || null)}
                label="Último blog"
              />
              <EditableField
                value={lead.instagram_type}
                type="select"
                options={[
                  { value: 'mural', label: 'Mural de servicios' },
                  { value: 'entretenimiento', label: 'Entretenimiento' },
                  { value: 'educativo', label: 'Educativo' },
                  { value: 'azar', label: 'Al azar' },
                  { value: 'none', label: 'No tiene' },
                ]}
                onSave={(v) => updateField('instagram_type', v || null)}
                label="Instagram tipo"
              />
              <EditableField
                value={lead.youtube_status}
                type="select"
                options={[
                  { value: 'activo', label: 'Activo' },
                  { value: 'dropeado', label: 'Lo intentó y lo dejó' },
                  { value: 'tutoriales', label: 'Tutoriales/Onboarding' },
                  { value: 'none', label: 'No tiene' },
                ]}
                onSave={(v) => updateField('youtube_status', v || null)}
                label="YouTube"
              />
              <EditableField
                value={lead.press_coverage}
                type="select"
                options={[
                  { value: 'formal', label: 'Prensa formal' },
                  { value: 'digital', label: 'Prensa digital' },
                  { value: 'ambas', label: 'Ambas' },
                  { value: 'ninguna', label: 'Ninguna' },
                ]}
                onSave={(v) => updateField('press_coverage', v || null)}
                label="Prensa"
              />
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-gray-9">
                  <input
                    type="checkbox"
                    checked={lead.has_linkedin_active ?? false}
                    onChange={(e) => updateField('has_linkedin_active', e.target.checked)}
                    className="rounded"
                  />
                  LinkedIn activo
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-9">
                  <input
                    type="checkbox"
                    checked={lead.has_hotmart ?? false}
                    onChange={(e) => updateField('has_hotmart', e.target.checked)}
                    className="rounded"
                  />
                  Hotmart
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-9">
                  <input
                    type="checkbox"
                    checked={lead.google_my_business ?? false}
                    onChange={(e) => updateField('google_my_business', e.target.checked)}
                    className="rounded"
                  />
                  Google My Business
                </label>
              </div>
              <EditableField
                value={lead.lead_stage_detail}
                type="textarea"
                placeholder="Notas sobre el estado del lead..."
                onSave={(v) => updateField('lead_stage_detail', v || null)}
                label="Detalle de etapa"
              />
            </div>
          </div>

          {/* Quick actions */}
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <h3 className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-3">Quick Actions</h3>
            <div className="space-y-2">
              {lead.email && (
                <button onClick={() => setShowEmail(true)} className="flex items-center gap-2 px-3 py-2 rounded-md bg-gray-3 hover:bg-gray-4 text-sm text-gray-12 transition-colors w-full text-left">
                  📧 Send Email
                </button>
              )}
              {lead.whatsapp && (
                <a href={`https://wa.me/${lead.whatsapp.replace(/\D/g, '')}`} target="_blank" className="flex items-center gap-2 px-3 py-2 rounded-md bg-gray-3 hover:bg-gray-4 text-sm text-gray-12 transition-colors">
                  💬 WhatsApp
                </a>
              )}
              {lead.phone && (
                <a href={`tel:${lead.phone}`} className="flex items-center gap-2 px-3 py-2 rounded-md bg-gray-3 hover:bg-gray-4 text-sm text-gray-12 transition-colors">
                  📞 Call
                </a>
              )}
              <button
                onClick={async () => {
                  try {
                    const res = await fetch(`/api/leads/${lead.id}/report`)
                    if (!res.ok) { toast('Error generating report', 'error'); return }
                    const blob = await res.blob()
                    const url = URL.createObjectURL(blob)
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `auditoria-${lead.full_name.replace(/\s+/g, '-').toLowerCase()}.md`
                    a.click()
                    URL.revokeObjectURL(url)
                  } catch (e) { toast('Error generating report', 'error') }
                }}
                className="flex items-center gap-2 px-3 py-2 rounded-md bg-gray-12 text-white hover:bg-gray-11 text-sm transition-colors w-full"
              >
                📄 Generate Audit Report
              </button>
            </div>
          </div>
        </div>
      </div>
      {/* Email compose modal */}
      {showEmail && lead.email && (
        <EmailCompose
          to={lead.email}
          leadName={lead.full_name}
          onClose={() => setShowEmail(false)}
        />
      )}
    </AppShell>
  )
}
