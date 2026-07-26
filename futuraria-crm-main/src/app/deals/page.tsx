'use client'

import { useEffect, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { EditableField } from '@/components/ui/EditableField'
import { supabase } from '@/lib/supabase'
import { cn, formatCurrency } from '@/lib/utils'
import type { Deal, DealStage, Lead } from '@/types/database'
import { EmptyState } from '@/components/ui/EmptyState'

const DEAL_STAGES: { value: DealStage; label: string; color: string }[] = [
  { value: 'discovery', label: 'Discovery', color: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  { value: 'proposal', label: 'Proposal', color: 'bg-pink-50 text-pink-700 border-pink-200' },
  { value: 'negotiation', label: 'Negotiation', color: 'bg-orange-50 text-orange-700 border-orange-200' },
  { value: 'closed_won', label: 'Won', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { value: 'closed_lost', label: 'Lost', color: 'bg-red-50 text-red-700 border-red-200' },
]

const STAGE_OPTIONS = DEAL_STAGES.map(s => ({ value: s.value, label: s.label }))

export default function DealsPage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewForm, setShowNewForm] = useState(false)
  const [newDeal, setNewDeal] = useState({ title: '', description: '', lead_id: '', value: '', probability: '10', expected_close_date: '' })
  const [creating, setCreating] = useState(false)

  useEffect(() => { loadData() }, [])

  async function loadData() {
    const [dealsRes, leadsRes] = await Promise.all([
      supabase.from('deals').select('*').order('created_at', { ascending: false }),
      supabase.from('leads').select('*').order('full_name'),
    ])
    setDeals(dealsRes.data || [])
    setLeads(leadsRes.data || [])
    setLoading(false)
  }

  async function createDeal() {
    if (!newDeal.title.trim()) return
    setCreating(true)
    const { error } = await supabase.from('deals').insert({
      title: newDeal.title.trim(),
      description: newDeal.description.trim() || null,
      lead_id: newDeal.lead_id || null,
      value: newDeal.value ? parseFloat(newDeal.value) : null,
      probability: parseInt(newDeal.probability) || 10,
      expected_close_date: newDeal.expected_close_date || null,
      stage: 'discovery',
    })
    if (!error) {
      setNewDeal({ title: '', description: '', lead_id: '', value: '', probability: '10', expected_close_date: '' })
      setShowNewForm(false)
      loadData()
    }
    setCreating(false)
  }

  async function updateDealField(dealId: string, field: string, value: unknown) {
    const { error } = await supabase.from('deals').update({ [field]: value }).eq('id', dealId)
    if (!error) {
      setDeals(prev => prev.map(d => d.id === dealId ? { ...d, [field]: value } : d))
    }
  }

  async function moveDealStage(dealId: string, newStage: DealStage) {
    await updateDealField(dealId, 'stage', newStage)
  }

  async function deleteDeal(dealId: string) {
    if (!confirm('Delete this deal?')) return
    await supabase.from('deals').delete().eq('id', dealId)
    loadData()
  }

  const pipelineDeals = deals.filter((d) => !['closed_won', 'closed_lost'].includes(d.stage))
  const totalPipeline = pipelineDeals.reduce((sum, d) => sum + (d.value || 0), 0)
  const weightedPipeline = pipelineDeals.reduce((sum, d) => sum + ((d.value || 0) * d.probability / 100), 0)

  const action = (
    <button
      onClick={() => setShowNewForm(!showNewForm)}
      className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 transition-colors"
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      <span className="hidden sm:inline">New Deal</span>
    </button>
  )

  return (
    <AppShell title="Pipeline" action={action}>
      <div className="space-y-6">
        {/* Summary */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <p className="text-xl font-semibold text-gray-12 tabular-nums">{formatCurrency(totalPipeline)}</p>
            <p className="text-xs text-gray-9">Total Pipeline</p>
          </div>
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <p className="text-xl font-semibold text-gray-12 tabular-nums">{formatCurrency(weightedPipeline)}</p>
            <p className="text-xs text-gray-9">Weighted</p>
          </div>
        </div>

        {/* New deal form */}
        {showNewForm && (
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={newDeal.title}
                onChange={(e) => setNewDeal({ ...newDeal, title: e.target.value })}
                placeholder="Deal title *"
                className="px-3 py-2 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7"
                autoFocus
              />
              <select
                value={newDeal.lead_id}
                onChange={(e) => setNewDeal({ ...newDeal, lead_id: e.target.value })}
                className="px-3 py-2 border border-gray-5 rounded-md text-sm bg-white"
              >
                <option value="">Link to lead (optional)</option>
                {leads.map(l => <option key={l.id} value={l.id}>{l.full_name}</option>)}
              </select>
            </div>
            <textarea
              value={newDeal.description}
              onChange={(e) => setNewDeal({ ...newDeal, description: e.target.value })}
              placeholder="Description..."
              rows={2}
              className="w-full px-3 py-2 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7 resize-none"
            />
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="text-2xs text-gray-9">Value (USD)</label>
                <input
                  type="number"
                  value={newDeal.value}
                  onChange={(e) => setNewDeal({ ...newDeal, value: e.target.value })}
                  placeholder="0"
                  className="w-32 px-3 py-2 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7"
                />
              </div>
              <div>
                <label className="text-2xs text-gray-9">Probability %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={newDeal.probability}
                  onChange={(e) => setNewDeal({ ...newDeal, probability: e.target.value })}
                  className="w-24 px-3 py-2 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7"
                />
              </div>
              <div>
                <label className="text-2xs text-gray-9">Expected close</label>
                <input
                  type="date"
                  value={newDeal.expected_close_date}
                  onChange={(e) => setNewDeal({ ...newDeal, expected_close_date: e.target.value })}
                  className="px-3 py-2 border border-gray-5 rounded-md text-sm"
                />
              </div>
              <button
                onClick={createDeal}
                disabled={!newDeal.title.trim() || creating}
                className={cn(
                  'px-4 py-2 rounded-md text-sm font-medium',
                  newDeal.title.trim() ? 'bg-gray-12 text-white hover:bg-gray-11' : 'bg-gray-4 text-gray-8'
                )}
              >
                {creating ? '...' : 'Create'}
              </button>
            </div>
          </div>
        )}

        {/* Pipeline columns */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 skeleton rounded-md" />)}
          </div>
        ) : deals.length === 0 ? (
          <EmptyState title="No deals" description="Create your first deal to start tracking your pipeline" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {DEAL_STAGES.filter(s => s.value !== 'closed_lost').map((stageDef) => {
              const stageDeals = deals.filter((d) => d.stage === stageDef.value)
              const stageTotal = stageDeals.reduce((sum, d) => sum + (d.value || 0), 0)

              return (
                <div key={stageDef.value}>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-medium text-gray-9 uppercase tracking-wider">{stageDef.label}</h3>
                    <span className="text-xs text-gray-9 tabular-nums">{formatCurrency(stageTotal)}</span>
                  </div>
                  <div className="space-y-2">
                    {stageDeals.length === 0 ? (
                      <div className="p-4 rounded-md bg-gray-1 border border-gray-5 border-dashed text-center">
                        <p className="text-xs text-gray-8">No deals</p>
                      </div>
                    ) : (
                      stageDeals.map((deal) => (
                        <DealCard
                          key={deal.id}
                          deal={deal}
                          onUpdate={updateDealField}
                          onMoveStage={moveDealStage}
                          onDelete={deleteDeal}
                        />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Closed deals (collapsed) */}
        {deals.filter(d => d.stage === 'closed_lost').length > 0 && (
          <details className="mt-6">
            <summary className="text-xs font-medium text-gray-9 uppercase tracking-wider cursor-pointer hover:text-gray-12">
              Lost deals ({deals.filter(d => d.stage === 'closed_lost').length})
            </summary>
            <div className="mt-2 space-y-2">
              {deals.filter(d => d.stage === 'closed_lost').map((deal) => (
                <DealCard
                  key={deal.id}
                  deal={deal}
                  onUpdate={updateDealField}
                  onMoveStage={moveDealStage}
                  onDelete={deleteDeal}
                />
              ))}
            </div>
          </details>
        )}
      </div>
    </AppShell>
  )
}

function DealCard({
  deal,
  onUpdate,
  onMoveStage,
  onDelete,
}: {
  deal: Deal
  onUpdate: (id: string, field: string, value: unknown) => Promise<void>
  onMoveStage: (id: string, stage: DealStage) => Promise<void>
  onDelete: (id: string) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="p-3 rounded-md bg-gray-1 border border-gray-5 hover:border-gray-7 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <EditableField
            value={deal.title}
            placeholder="Deal title"
            onSave={(v) => onUpdate(deal.id, 'title', v)}
            displayClassName="text-sm font-medium"
          />
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded hover:bg-gray-3 text-gray-8 hover:text-gray-12 transition-colors"
            title="Edit"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(deal.id)}
            className="p-1 rounded hover:bg-red-50 text-gray-8 hover:text-red-600 transition-colors"
            title="Delete"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {deal.description && !expanded && (
        <p className="text-xs text-gray-9 mt-0.5 line-clamp-1">{deal.description}</p>
      )}

      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-gray-9">{deal.probability}%</span>
        <span className="text-sm font-semibold text-gray-12 tabular-nums">
          {deal.value ? formatCurrency(deal.value) : '—'}
        </span>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-5 space-y-2">
          <EditableField
            value={deal.description}
            type="textarea"
            placeholder="Description..."
            onSave={(v) => onUpdate(deal.id, 'description', v || null)}
            label="Description"
          />
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-2xs text-gray-9">Value</label>
              <input
                type="number"
                defaultValue={deal.value ?? ''}
                onBlur={(e) => { const v = e.target.value; onUpdate(deal.id, 'value', v ? parseFloat(v) : null) }}
                className="w-full px-2 py-1 border border-gray-5 rounded-md text-xs focus:outline-none focus:border-gray-7"
                placeholder="0"
              />
            </div>
            <div>
              <label className="text-2xs text-gray-9">Probability %</label>
              <input
                type="number"
                min="0"
                max="100"
                defaultValue={deal.probability}
                onBlur={(e) => onUpdate(deal.id, 'probability', parseInt(e.target.value) || 0)}
                className="w-full px-2 py-1 border border-gray-5 rounded-md text-xs focus:outline-none focus:border-gray-7"
              />
            </div>
          </div>
          <div>
            <label className="text-2xs text-gray-9">Expected close</label>
            <input
              type="date"
              defaultValue={deal.expected_close_date ?? ''}
              onBlur={(e) => onUpdate(deal.id, 'expected_close_date', e.target.value || null)}
              className="w-full px-2 py-1 border border-gray-5 rounded-md text-xs"
            />
          </div>

          {/* Move to stage */}
          <div>
            <label className="text-2xs text-gray-9">Move to stage</label>
            <div className="flex flex-wrap gap-1 mt-1">
              {STAGE_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  onClick={() => onMoveStage(deal.id, s.value as DealStage)}
                  disabled={deal.stage === s.value}
                  className={cn(
                    'px-2 py-0.5 rounded-md text-2xs font-medium border transition-colors',
                    deal.stage === s.value
                      ? 'bg-gray-12 text-white border-gray-12'
                      : 'bg-gray-1 text-gray-9 border-gray-5 hover:border-gray-7'
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          <EditableField
            value={deal.notes}
            type="textarea"
            placeholder="Notes..."
            onSave={(v) => onUpdate(deal.id, 'notes', v || null)}
            label="Notes"
          />
        </div>
      )}
    </div>
  )
}
