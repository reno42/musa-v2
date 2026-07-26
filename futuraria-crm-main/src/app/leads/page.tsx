'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { SearchBar } from '@/components/ui/SearchBar'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { EmptyState } from '@/components/ui/EmptyState'
import { DataTable } from '@/components/ui/DataTable'
import { SavedViews, type ViewFilter } from '@/components/ui/SavedViews'
import { BulkActions } from '@/components/ui/BulkActions'
import { supabase } from '@/lib/supabase'
import { cn, getStageColor, getStageLabel, getPriorityColor, formatRelativeDate, getInitials } from '@/lib/utils'
import { useT } from '@/lib/settings-context'
import { Users, Plus, Download } from 'lucide-react'
import type { Lead, LeadStage, LeadPriority, LeadSource, ContactRole } from '@/types/database'
import { exportToCSV } from '@/lib/export-csv'

const STAGES: { value: LeadStage; labelKey: string }[] = [
  { value: 'new', labelKey: 'stage.new' },
  { value: 'researching', labelKey: 'stage.researching' },
  { value: 'contacted', labelKey: 'stage.contacted' },
  { value: 'qualified', labelKey: 'stage.qualified' },
  { value: 'demo_scheduled', labelKey: 'stage.demo_scheduled' },
  { value: 'proposal_sent', labelKey: 'stage.proposal_sent' },
  { value: 'negotiation', labelKey: 'stage.negotiation' },
  { value: 'nurturing', labelKey: 'stage.nurturing' },
  { value: 'discarded', labelKey: 'stage.discarded' },
]

const PRIORITIES: { value: LeadPriority; labelKey: string }[] = [
  { value: 'low', labelKey: 'priority.low' },
  { value: 'medium', labelKey: 'priority.medium' },
  { value: 'high', labelKey: 'priority.high' },
  { value: 'urgent', labelKey: 'priority.urgent' },
]

const SOURCES: { value: LeadSource; labelKey: string }[] = [
  { value: 'website', labelKey: 'source.website' },
  { value: 'linkedin', labelKey: 'source.linkedin' },
  { value: 'referral', labelKey: 'source.referral' },
  { value: 'cold_outreach', labelKey: 'source.cold_outreach' },
  { value: 'event', labelKey: 'source.event' },
  { value: 'social_media', labelKey: 'source.social_media' },
  { value: 'organic', labelKey: 'source.organic' },
  { value: 'partner', labelKey: 'source.partner' },
  { value: 'other', labelKey: 'source.other' },
]

const ROLES: { value: ContactRole; label: string }[] = [
  { value: 'decision_maker', label: 'Decision Maker' },
  { value: 'influencer', label: 'Influencer' },
  { value: 'buyer', label: 'Buyer' },
  { value: 'end_user', label: 'End User' },
  { value: 'champion', label: 'Champion' },
  { value: 'gatekeeper', label: 'Gatekeeper' },
  { value: 'other', label: 'Other' },
]

function LeadsContent() {
  const router = useRouter()
  const t = useT()

  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<LeadStage | 'all'>('all')
  const [priorityFilter, setPriorityFilter] = useState<LeadPriority | 'all'>('all')
  const [sourceFilter, setSourceFilter] = useState<LeadSource | 'all'>('all')
  const [roleFilter, setRoleFilter] = useState<ContactRole | 'all'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [viewFilters, setViewFilters] = useState<ViewFilter[]>([])

  useEffect(() => {
    loadLeads()
  }, [stageFilter, priorityFilter, sourceFilter, roleFilter])

  async function loadLeads() {
    setLoading(true)
    let query = supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })

    if (stageFilter !== 'all') query = query.eq('stage', stageFilter)
    if (priorityFilter !== 'all') query = query.eq('priority', priorityFilter)
    if (sourceFilter !== 'all') query = query.eq('source', sourceFilter)
    if (roleFilter !== 'all') query = query.eq('role', roleFilter)

    const { data } = await query
    setLeads(data || [])
    setLoading(false)
  }

  const filteredLeads = leads.filter((lead) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      lead.full_name.toLowerCase().includes(q) ||
      lead.company_name?.toLowerCase().includes(q) ||
      lead.email?.toLowerCase().includes(q)
    )
  })

  const currentViewFilters: ViewFilter[] = []
  if (stageFilter !== 'all') currentViewFilters.push({ key: 'stage', value: stageFilter, label: `Stage: ${stageFilter}` })
  if (priorityFilter !== 'all') currentViewFilters.push({ key: 'priority', value: priorityFilter, label: `Priority: ${priorityFilter}` })
  if (roleFilter !== 'all') currentViewFilters.push({ key: 'role', value: roleFilter, label: `Role: ${roleFilter.replace('_', ' ')}` })
  if (sourceFilter !== 'all') currentViewFilters.push({ key: 'source', value: sourceFilter, label: `Source: ${sourceFilter}` })

  function applyViewFilters(filters: ViewFilter[]) {
    setViewFilters(filters)
    const stage = filters.find(f => f.key === 'stage')
    const priority = filters.find(f => f.key === 'priority')
    const source = filters.find(f => f.key === 'source')
    const role = filters.find(f => f.key === 'role')
    setStageFilter((stage?.value as LeadStage) || 'all')
    setPriorityFilter((priority?.value as LeadPriority) || 'all')
    setSourceFilter((source?.value as LeadSource) || 'all')
    setRoleFilter((role?.value as ContactRole) || 'all')
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selectedIds.size} leads?`)) return
    await supabase.from('leads').delete().in('id', Array.from(selectedIds))
    setSelectedIds(new Set())
    loadLeads()
  }

  async function bulkStageChange(newStage: string) {
    await supabase.from('leads').update({ stage: newStage }).in('id', Array.from(selectedIds))
    setSelectedIds(new Set())
    loadLeads()
  }

  const filters = (
    <div className="space-y-2">
      <SavedViews entity="leads" currentFilters={currentViewFilters} onViewSelect={applyViewFilters} />
      <div className="flex gap-2 overflow-x-auto pipeline-scroll flex-wrap">
        <select value={stageFilter} onChange={e => setStageFilter(e.target.value as LeadStage | 'all')}
          className="flex-shrink-0 px-2 py-1.5 rounded-md text-xs font-medium border border-gray-5 bg-gray-1 text-gray-10 focus:outline-none focus:border-gray-7">
          <option value="all">{t('stage.all')}</option>
          {STAGES.map(s => <option key={s.value} value={s.value}>{t(s.labelKey as any)}</option>)}
        </select>
        <select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value as LeadPriority | 'all')}
          className="flex-shrink-0 px-2 py-1.5 rounded-md text-xs font-medium border border-gray-5 bg-gray-1 text-gray-10 focus:outline-none focus:border-gray-7">
          <option value="all">{t('leads.priority')}: All</option>
          {PRIORITIES.map(p => <option key={p.value} value={p.value}>{t(p.labelKey as any)}</option>)}
        </select>
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value === 'all' ? 'all' : (e.target.value as ContactRole))}
          className="flex-shrink-0 px-2 py-1.5 rounded-md text-xs font-medium border border-gray-5 bg-gray-1 text-gray-10 focus:outline-none focus:border-gray-7">
          <option value="all">Role: All</option>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value as LeadSource | 'all')}
          className="flex-shrink-0 px-2 py-1.5 rounded-md text-xs font-medium border border-gray-5 bg-gray-1 text-gray-10 focus:outline-none focus:border-gray-7">
          <option value="all">{t('leads.source')}: All</option>
          {SOURCES.map(s => <option key={s.value} value={s.value}>{t(s.labelKey as any)}</option>)}
        </select>
        {(stageFilter !== 'all' || priorityFilter !== 'all' || sourceFilter !== 'all' || roleFilter !== 'all') && (
          <button onClick={() => { setStageFilter('all'); setPriorityFilter('all'); setSourceFilter('all'); setRoleFilter('all') }}
            className="flex-shrink-0 px-2 py-1.5 rounded-md text-2xs font-medium text-red-600 hover:bg-red-50 border border-red-200 transition-colors">
            Clear filters
          </button>
        )}
      </div>
    </div>
  )

  function handleExport() {
    exportToCSV(filteredLeads, [
      { key: 'full_name', label: 'Name' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Phone' },
      { key: 'company_name', label: 'Company' },
      { key: 'role', label: 'Role' },
      { key: 'stage', label: 'Stage' },
      { key: 'priority', label: 'Priority' },
      { key: 'score', label: 'Score' },
      { key: 'source', label: 'Source' },
      { key: 'created_at', label: 'Created' },
    ], 'futuraria-leads')
  }

  const action = (
    <div className="flex items-center gap-1.5">
      <button onClick={handleExport}
        className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-1 border border-gray-5 text-sm text-gray-10 hover:bg-gray-3 transition-colors" title="Export CSV">
        <Download size={14} />
        <span className="hidden sm:inline">{t('common.exportCSV')}</span>
      </button>
      <Link href="/leads/new"
        className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 transition-colors">
        <Plus size={14} strokeWidth={2} />
        <span className="hidden sm:inline">{t('leads.new')}</span>
      </Link>
    </div>
  )

  const stageOptionsForBulk = STAGES.map(s => ({ value: s.value, label: t(s.labelKey as any) }))

  return (
    <AppShell title={t('leads.title')} icon={<Users size={20} />} count={filteredLeads.length} action={action} filters={filters}>
      <div className="space-y-4">
        {selectedIds.size > 0 && (
          <BulkActions selectedCount={selectedIds.size} onClear={() => setSelectedIds(new Set())} onDelete={bulkDelete} onStageChange={bulkStageChange} stageOptions={stageOptionsForBulk} />
        )}
        <div className="flex items-center gap-3">
          <SearchBar value={search} onChange={setSearch} placeholder={t('leads.searchPlaceholder')} className="flex-1" />
          <span className="text-xs text-gray-9 whitespace-nowrap">{filteredLeads.length} {t('leads.title').toLowerCase()}</span>
        </div>
        <div className="hidden md:block">
          <DataTable
            data={filteredLeads} loading={loading} emptyMessage={t('leads.noLeads')}
            onRowClick={(lead) => router.push(`/leads/${lead.id}`)}
            selectedIds={selectedIds} onSelectionChange={setSelectedIds}
            columns={[
              { key: 'full_name', label: t('leads.name'), render: (lead) => (
                <div className="flex items-center gap-2.5">
                  <div className="avatar-circle bg-gray-4 text-gray-9">{getInitials(lead.full_name)}</div>
                  <div>
                    <p className="text-sm font-medium text-gray-12">{lead.full_name}</p>
                    <p className="text-xs text-gray-9 truncate max-w-[200px]">{lead.company_name || lead.email || '\u2014'}</p>
                  </div>
                </div>
              )},
              { key: 'role', label: 'Role', render: (lead) => (
                lead.role && lead.role !== 'other'
                  ? <span className="inline-block px-2 py-0.5 rounded-md text-2xs font-medium border border-gray-5 bg-gray-4 text-gray-9 capitalize">{lead.role.replace('_', ' ')}</span>
                  : <span className="text-xs text-gray-8">{'\u2014'}</span>
              )},
              { key: 'stage', label: t('leads.stage'), render: (lead) => (
                <span className={cn('inline-block px-2 py-0.5 rounded-md text-2xs font-medium border', getStageColor(lead.stage))}>{getStageLabel(lead.stage)}</span>
              )},
              { key: 'priority', label: t('leads.priority'), render: (lead) => (
                <span className={cn('inline-block px-2 py-0.5 rounded-md text-2xs font-medium', getPriorityColor(lead.priority))}>{lead.priority}</span>
              )},
              { key: 'score', label: t('leads.score'), render: (lead) => (
                <div className="flex items-center gap-1.5">
                  <div className="w-8 h-1.5 rounded-full bg-gray-4 overflow-hidden">
                    <div className={cn('h-full rounded-full', lead.score >= 60 ? 'bg-emerald-500' : lead.score >= 30 ? 'bg-amber-500' : 'bg-red-500')} style={{ width: `${lead.score}%` }} />
                  </div>
                  <span className="text-xs text-gray-9 tabular-nums">{lead.score}</span>
                </div>
              )},
              { key: 'source', label: t('leads.source'), render: (lead) => (
                <span className="text-xs text-gray-9 capitalize">{lead.source.replace('_', ' ')}</span>
              )},
              { key: 'created_at', label: t('leads.created'), render: (lead) => (
                <span className="text-xs text-gray-9">{formatRelativeDate(lead.created_at)}</span>
              )},
            ]}
          />
        </div>
        <div className="md:hidden">
          {loading ? (
            <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 skeleton rounded-md" />)}</div>
          ) : filteredLeads.length === 0 ? (
            <EmptyState title={t('leads.noLeads')} description={search ? t('leads.tryDifferent') : t('leads.createFirst')} action={!search ? { label: `+ ${t('leads.new')}`, href: '/leads/new' } : undefined} />
          ) : (
            <div className="space-y-1">
              {filteredLeads.map((lead) => (
                <Link key={lead.id} href={`/leads/${lead.id}`} className="flex items-center gap-3 px-4 py-3 bg-gray-1 border-b border-gray-5 hover:bg-gray-3 transition-colors">
                  <div className="avatar-circle bg-gray-4 text-gray-9">{getInitials(lead.full_name)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-12 truncate">{lead.full_name}</p>
                      {lead.priority === 'urgent' && <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />}
                      {lead.role && lead.role !== 'other' && <span className="text-2xs px-1.5 py-0.5 rounded-md border border-gray-5 bg-gray-4 text-gray-9 capitalize flex-shrink-0">{lead.role.replace('_', ' ')}</span>}
                    </div>
                    <p className="text-xs text-gray-9 truncate">{lead.company_name || lead.email || 'No contact info'}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <ScoreBadge score={lead.score} />
                    <span className={cn('text-2xs font-medium px-1.5 py-0.5 rounded-md border', getStageColor(lead.stage))}>{getStageLabel(lead.stage)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}

export default function LeadsPage() {
  return <LeadsContent />
}
