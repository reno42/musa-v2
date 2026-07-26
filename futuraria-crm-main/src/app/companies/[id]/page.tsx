'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppShell } from '@/components/layout/AppShell'
import { EditableField } from '@/components/ui/EditableField'
import { supabase } from '@/lib/supabase'
import { cn, getInitials, formatDate, getStageColor, getStageLabel, formatCurrency } from '@/lib/utils'
import type { Company, Lead, Deal, Task } from '@/types/database'

const SIZE_OPTIONS = [
  { value: '', label: 'Select size...' },
  { value: '1-10', label: '1-10' },
  { value: '11-50', label: '11-50' },
  { value: '51-200', label: '51-200' },
  { value: '201-500', label: '201-500' },
  { value: '500+', label: '500+' },
]

const REVENUE_OPTIONS = [
  { value: '', label: 'Select range...' },
  { value: '<$1M', label: '<$1M' },
  { value: '$1M-$10M', label: '$1M-$10M' },
  { value: '$10M-$50M', label: '$10M-$50M' },
  { value: '$50M+', label: '$50M+' },
]

export default function CompanyDetailPage() {
  const params = useParams()
  const router = useRouter()
  const companyId = params.id as string

  const [company, setCompany] = useState<Company | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [deals, setDeals] = useState<Deal[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'leads' | 'deals' | 'tasks'>('leads')

  useEffect(() => { loadCompany() }, [companyId])

  async function loadCompany() {
    setLoading(true)
    const [companyRes, leadsRes, tasksRes] = await Promise.all([
      supabase.from('companies').select('*').eq('id', companyId).single(),
      supabase.from('leads').select('*').eq('company_id', companyId).order('created_at', { ascending: false }),
      supabase.from('tasks').select('*').eq('company_id', companyId).order('due_date', { ascending: true }),
    ])
    if (companyRes.data) setCompany(companyRes.data)
    if (leadsRes.data) {
      setLeads(leadsRes.data)
      if (leadsRes.data.length > 0) {
        const { data: dealsData } = await supabase.from('deals').select('*').in('lead_id', leadsRes.data.map(l => l.id))
        if (dealsData) setDeals(dealsData)
      }
    }
    if (tasksRes.data) setTasks(tasksRes.data)
    setLoading(false)
  }

  async function updateField(field: string, value: unknown) {
    if (!company) return
    const { error } = await supabase.from('companies').update({ [field]: value }).eq('id', company.id)
    if (!error) setCompany({ ...company, [field]: value })
  }

  async function deleteCompany() {
    if (!confirm('Delete this company? Associated leads will NOT be deleted.')) return
    await supabase.from('companies').delete().eq('id', companyId)
    router.push('/companies')
  }

  async function toggleTask(task: Task) {
    const newStatus = task.status === 'done' ? 'todo' : 'done'
    await supabase.from('tasks').update({ status: newStatus, completed_at: newStatus === 'done' ? new Date().toISOString() : null }).eq('id', task.id)
    loadCompany()
  }

  if (loading) {
    return (
      <AppShell title="Company">
        <div className="space-y-4"><div className="h-24 skeleton rounded-md" /><div className="h-40 skeleton rounded-md" /></div>
      </AppShell>
    )
  }

  if (!company) {
    return (
      <AppShell title="Company">
        <div className="text-center py-12"><p className="text-gray-9">Company not found</p></div>
      </AppShell>
    )
  }

  const totalDealValue = deals.reduce((sum, d) => sum + (d.value || 0), 0)

  const action = (
    <button onClick={deleteCompany} className="p-2 rounded-md hover:bg-red-50 text-gray-9 hover:text-red-600 transition-colors">
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
      </svg>
    </button>
  )

  const tabs: ['leads' | 'deals' | 'tasks', string][] = [['leads', 'Leads'], ['deals', 'Deals'], ['tasks', 'Tasks']]

  return (
    <AppShell title={company.name} subtitle={company.industry || undefined} action={action}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Header â editable */}
          <div className="p-5 rounded-md bg-gray-1 border border-gray-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-md bg-gray-4 flex items-center justify-center flex-shrink-0">
                <span className="text-base font-semibold text-gray-9">{getInitials(company.name)}</span>
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <EditableField
                  value={company.name}
                  placeholder="Company name"
                  onSave={(v) => updateField('name', v)}
                  displayClassName="text-lg font-semibold"
                />
                <EditableField
                  value={company.industry}
                  placeholder="Industry"
                  onSave={(v) => updateField('industry', v || null)}
                  displayClassName="text-sm text-gray-9"
                />
                <EditableField
                  value={company.website}
                  type="url"
                  placeholder="Website URL"
                  onSave={(v) => updateField('website', v || null)}
                  displayClassName="text-xs text-gray-9 hover:text-gray-12"
                />
              </div>
            </div>

            {/* Stats */}
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="text-center p-2.5 bg-gray-3 rounded-md">
                <p className="text-lg font-semibold text-gray-12">{leads.length}</p>
                <p className="text-2xs text-gray-9">Leads</p>
              </div>
              <div className="text-center p-2.5 bg-gray-3 rounded-md">
                <p className="text-lg font-semibold text-gray-12">{deals.length}</p>
                <p className="text-2xs text-gray-9">Deals</p>
              </div>
              <div className="text-center p-2.5 bg-gray-3 rounded-md">
                <p className="text-lg font-semibold text-gray-12">{formatCurrency(totalDealValue)}</p>
                <p className="text-2xs text-gray-9">Total Value</p>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-2">
            {tabs.map(([key, label]) => (
              <button key={key} onClick={() => setActiveTab(key)}
                className={cn('px-4 py-2 rounded-md text-xs font-medium transition-all border',
                  activeTab === key ? 'bg-gray-12 text-white border-gray-12' : 'bg-gray-1 text-gray-10 border-gray-5'
                )}>{label}</button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'leads' && (
            <div className="bg-gray-1 rounded-md border border-gray-5 divide-y divide-gray-5">
              {leads.length === 0 ? (
                <p className="text-xs text-gray-9 text-center py-6">No linked leads</p>
              ) : leads.map((lead) => (
                <Link key={lead.id} href={`/leads/${lead.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-3 transition-colors">
                  <div className="w-8 h-8 rounded-full bg-gray-4 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-medium text-gray-9">{getInitials(lead.full_name)}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-12 truncate">{lead.full_name}</p>
                    <p className="text-xs text-gray-9">{lead.company_role || lead.email}{lead.role && lead.role !== "other" && <span className="text-2xs px-1.5 py-0.5 rounded-md border bg-gray-4 text-gray-9 capitalize">{lead.role.replace("_", " ")}</span>}</p>
                  </div>
                  <span className={cn('text-2xs font-medium px-1.5 py-0.5 rounded-md border', getStageColor(lead.stage))}>
                    {getStageLabel(lead.stage)}
                  </span>
                </Link>
              ))}
            </div>
          )}

          {activeTab === 'deals' && (
            <div className="bg-gray-1 rounded-md border border-gray-5 divide-y divide-gray-5">
              {deals.length === 0 ? (
                <p className="text-xs text-gray-9 text-center py-6">No deals</p>
              ) : deals.map((deal) => (
                <div key={deal.id} className="px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-12">{deal.title}</p>
                    <span className="text-sm font-semibold text-gray-12">{deal.value ? formatCurrency(deal.value) : 'â'}</span>
                  </div>
                  <p className="text-xs text-gray-9 mt-0.5">{deal.stage} Â· {deal.probability}% prob.</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="bg-gray-1 rounded-md border border-gray-5 divide-y divide-gray-5">
              {tasks.length === 0 ? (
                <p className="text-xs text-gray-9 text-center py-6">No tasks</p>
              ) : tasks.map((task) => (
                <div key={task.id} className="flex items-center gap-2.5 px-4 py-3">
                  <button
                    onClick={() => toggleTask(task)}
                    className={cn(
                      'w-5 h-5 rounded-full border-2 flex-shrink-0 transition-all flex items-center justify-center',
                      task.status === 'done' ? 'bg-emerald-500 border-emerald-500' : 'border-gray-6 hover:border-gray-8'
                    )}
                  >
                    {task.status === 'done' && (
                      <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={cn('text-sm', task.status === 'done' ? 'text-gray-8 line-through' : 'text-gray-12 font-medium')}>{task.title}</p>
                    {task.due_date && <p className="text-2xs text-gray-9 mt-0.5">Due: {formatDate(task.due_date)}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right column â all editable */}
        <div className="space-y-6">
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <h3 className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-3">Details</h3>
            <div className="space-y-3">
              <EditableField value={company.domain} placeholder="Domain" onSave={(v) => updateField('domain', v || null)} label="Domain" />
              <EditableField value={company.size} type="select" options={SIZE_OPTIONS} onSave={(v) => updateField('size', v || null)} label="Size" />
              <EditableField value={company.revenue_range} type="select" options={REVENUE_OPTIONS} onSave={(v) => updateField('revenue_range', v || null)} label="Revenue" />
              <EditableField value={company.email} type="email" placeholder="Email" onSave={(v) => updateField('email', v || null)} label="Email" />
              <EditableField value={company.phone} type="tel" placeholder="Phone" onSave={(v) => updateField('phone', v || null)} label="Phone" />
              <EditableField value={company.city} placeholder="City" onSave={(v) => updateField('city', v || null)} label="City" />
              <EditableField value={company.country} placeholder="Country" onSave={(v) => updateField('country', v || null)} label="Country" />
              <EditableField value={company.address} placeholder="Address" onSave={(v) => updateField('address', v || null)} label="Address" />
              <EditableField value={company.linkedin_url} type="url" placeholder="LinkedIn URL" onSave={(v) => updateField('linkedin_url', v || null)} label="LinkedIn" />
              <EditableField value={company.twitter_url} type="url" placeholder="Twitter URL" onSave={(v) => updateField('twitter_url', v || null)} label="Twitter" />
            </div>
          </div>

          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <EditableField
              value={company.description}
              type="textarea"
              placeholder="Add description..."
              onSave={(v) => updateField('description', v || null)}
              label="Description"
            />
          </div>

          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <EditableField
              value={company.notes}
              type="textarea"
              placeholder="Add notes..."
              onSave={(v) => updateField('notes', v || null)}
              label="Notes"
            />
          </div>

          <div className="p-4 rounded-md bg-gray-1 border border-gray-5">
            <EditableField
              value={company.tags}
              type="tags"
              placeholder="tag1, tag2, tag3"
              onSave={(v) => updateField('tags', v)}
              label="Tags"
            />
          </div>
        </div>
      </div>
    </AppShell>
  )
}
