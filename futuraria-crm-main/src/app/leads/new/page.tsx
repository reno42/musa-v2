'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'
import type { LeadSource, LeadPriority, ContactRole } from '@/types/database'

const SOURCES: [LeadSource, string][] = [
  ['website', 'Website'], ['linkedin', 'LinkedIn'], ['referral', 'Referral'],
  ['cold_outreach', 'Outreach'], ['event', 'Event'], ['social_media', 'Social'],
  ['organic', 'Organic'], ['partner', 'Partner'], ['other', 'Other'],
]

const PRIORITIES: [LeadPriority, string][] = [
  ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['urgent', 'Urgent'],
]

const ROLES: [ContactRole, string][] = [
  ['other', 'Other'], ['decision_maker', 'Decision Maker'], ['influencer', 'Influencer'],
  ['buyer', 'Buyer'], ['end_user', 'End User'], ['champion', 'Champion'], ['gatekeeper', 'Gatekeeper'],
]

export default function NewLeadPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [showNewCompany, setShowNewCompany] = useState(false)
  const [newCompanyName, setNewCompanyName] = useState('')
  const [form, setForm] = useState({
    full_name: '', email: '', phone: '', whatsapp: '',
    company_name: '', company_role: '', industry: '',
    source: 'other' as LeadSource, source_detail: '',
    priority: 'medium' as LeadPriority, role: 'other' as ContactRole,
    company_id: '' as string, notes: '',
  })

  useEffect(() => { loadCompanies() }, [])

  async function loadCompanies() {
    const { data } = await supabase.from('companies').select('id, name').order('name')
    if (data) setCompanies(data)
  }

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function createCompanyInline() {
    if (!newCompanyName.trim()) return null
    const { data, error } = await supabase.from('companies').insert({ name: newCompanyName.trim() }).select('id, name').single()
    if (error || !data) { toast('Error creating company', 'error'); return null }
    setCompanies(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setForm(prev => ({ ...prev, company_id: data.id, company_name: data.name }))
    setNewCompanyName('')
    setShowNewCompany(false)
    return data.id
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.full_name.trim()) return
    setSaving(true)
    try {
      let companyId = form.company_id || null
      if (showNewCompany && newCompanyName.trim()) {
        const newCo = await createCompanyInline()
        if (newCo) companyId = newCo
      }
      const companyName = form.company_id
        ? companies.find(c => c.id === form.company_id)?.name || form.company_name
        : form.company_name

      const { data, error } = await supabase.from('leads').insert({
        full_name: form.full_name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        whatsapp: form.whatsapp.trim() || null,
        company_name: companyName?.trim() || null,
        company_id: companyId,
        company_role: form.company_role.trim() || null,
        industry: form.industry.trim() || null,
        source: form.source, source_detail: form.source_detail.trim() || null,
        priority: form.priority, role: form.role,
        notes: form.notes.trim() || null,
        stage: 'new', score: 0,
      }).select('id').single()
      if (error) throw error
      router.push(`/leads/${data.id}`)
    } catch (err) {
      console.error('Error creating lead:', err)
      toast('Error creating lead', 'error')
    } finally { setSaving(false) }
  }

  return (
    <AppShell title="New Lead">
      <div className="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Name */}
          <div>
            <label className="text-xs font-medium text-gray-9 uppercase tracking-wider">Full Name *</label>
            <input type="text" value={form.full_name} onChange={(e) => updateField('full_name', e.target.value)} placeholder="John Doe" required
              className="mt-1.5 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" />
          </div>

          {/* Contact */}
          <fieldset>
            <legend className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-2">Contact</legend>
            <div className="space-y-3">
              <input type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)} placeholder="Email"
                className="w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" />
              <div className="grid grid-cols-2 gap-3">
                <input type="tel" value={form.phone} onChange={(e) => updateField('phone', e.target.value)} placeholder="Phone"
                  className="w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" />
                <input type="tel" value={form.whatsapp} onChange={(e) => updateField('whatsapp', e.target.value)} placeholder="WhatsApp"
                  className="w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" />
              </div>
            </div>
          </fieldset>

          {/* Role */}
          <fieldset>
            <legend className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-2">Role</legend>
            <select value={form.role} onChange={(e) => updateField('role', e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7">
              {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </fieldset>

          {/* Company */}
          <fieldset>
            <legend className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-2">Company</legend>
            <div className="space-y-2">
              <select value={form.company_id} onChange={(e) => {
                if (e.target.value === '__new__') { setShowNewCompany(true); updateField('company_id', '') }
                else { updateField('company_id', e.target.value); setShowNewCompany(false) }
              }}
                className="w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7">
                <option value="">Select company...</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                <option value="__new__">+ Add new company</option>
              </select>
              {showNewCompany && (
                <div className="flex gap-2">
                  <input type="text" value={newCompanyName} onChange={(e) => setNewCompanyName(e.target.value)}
                    placeholder="New company name"
                    className="flex-1 px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" />
                  <button type="button" onClick={createCompanyInline}
                    className="px-3 py-2.5 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 transition-colors">
                    Create
                  </button>
                </div>
              )}
            </div>
          </fieldset>

          {/* Company Role + Industry */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-9 uppercase tracking-wider">Job Title</label>
              <input type="text" value={form.company_role} onChange={(e) => updateField('company_role', e.target.value)} placeholder="CEO, CTO..."
                className="mt-1.5 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-9 uppercase tracking-wider">Industry</label>
              <input type="text" value={form.industry} onChange={(e) => updateField('industry', e.target.value)} placeholder="Tech, Retail..."
                className="mt-1.5 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" />
            </div>
          </div>

          {/* Source + Priority */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-9 uppercase tracking-wider">Source</label>
              <select value={form.source} onChange={(e) => updateField('source', e.target.value)}
                className="mt-1.5 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7">
                {SOURCES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-9 uppercase tracking-wider">Priority</label>
              <select value={form.priority} onChange={(e) => updateField('priority', e.target.value)}
                className="mt-1.5 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7">
                {PRIORITIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-medium text-gray-9 uppercase tracking-wider">Notes</label>
            <textarea value={form.notes} onChange={(e) => updateField('notes', e.target.value)} placeholder="Additional notes..." rows={3}
              className="mt-1.5 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7 resize-none" />
          </div>

          {/* Submit */}
          <div className="flex gap-3">
            <button type="submit" disabled={saving || !form.full_name.trim()}
              className={cn('px-6 py-2.5 rounded-md text-sm font-medium transition-colors',
                form.full_name.trim() ? 'bg-gray-12 text-white hover:bg-gray-11' : 'bg-gray-4 text-gray-8')}>
              {saving ? 'Creating...' : 'Create Lead'}
            </button>
            <button type="button" onClick={() => router.back()}
              className="px-6 py-2.5 rounded-md text-sm font-medium bg-gray-4 text-gray-10 hover:bg-gray-5 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
