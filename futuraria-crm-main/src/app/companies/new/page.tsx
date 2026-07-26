'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

const SIZE_OPTIONS = ['1-10', '11-50', '51-200', '201-500', '500+'] as const
const REVENUE_OPTIONS = ['<$1M', '$1M-$10M', '$10M-$50M', '$50M+'] as const

export default function NewCompanyPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    name: '', domain: '', industry: '', size: '', email: '', phone: '',
    address: '', city: '', country: '', linkedin_url: '', twitter_url: '',
    revenue_range: '', description: '', notes: '',
  })

  function updateField(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setError('Company name is required.'); return }
    setLoading(true); setError(null)
    const { data, error: insertError } = await supabase.from('companies').insert({
      name: form.name.trim(), domain: form.domain.trim() || null, industry: form.industry.trim() || null,
      size: form.size || null, email: form.email.trim() || null, phone: form.phone.trim() || null,
      address: form.address.trim() || null, city: form.city.trim() || null, country: form.country.trim() || null,
      linkedin_url: form.linkedin_url.trim() || null, twitter_url: form.twitter_url.trim() || null,
      revenue_range: form.revenue_range || null, description: form.description.trim() || null, notes: form.notes.trim() || null,
    }).select('id').single()
    setLoading(false)
    if (insertError) { setError(insertError.message); return }
    router.push(`/companies/${data.id}`)
  }

  return (
    <AppShell title="New Company">
      <div className="max-w-2xl">
        {error && (
          <div className="mb-6 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div>
        )}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <fieldset>
            <legend className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-3">Basic Information</legend>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-9">Company Name *</label>
                <input type="text" required value={form.name} onChange={(e) => updateField('name', e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" placeholder="Acme Corp" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-9">Domain / Website</label>
                  <input type="text" value={form.domain} onChange={(e) => updateField('domain', e.target.value)}
                    className="mt-1 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" placeholder="acme.com" />
                </div>
                <div>
                  <label className="text-xs text-gray-9">Industry</label>
                  <input type="text" value={form.industry} onChange={(e) => updateField('industry', e.target.value)}
                    className="mt-1 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" placeholder="Technology" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-9">Company Size</label>
                  <select value={form.size} onChange={(e) => updateField('size', e.target.value)}
                    className="mt-1 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7">
                    <option value="">Select size…</option>
                    {SIZE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-9">Revenue Range</label>
                  <select value={form.revenue_range} onChange={(e) => updateField('revenue_range', e.target.value)}
                    className="mt-1 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7">
                    <option value="">Select range…</option>
                    {REVENUE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </fieldset>

          {/* Contact */}
          <fieldset>
            <legend className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-3">Contact</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-9">Email</label>
                <input type="email" value={form.email} onChange={(e) => updateField('email', e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" placeholder="info@acme.com" />
              </div>
              <div>
                <label className="text-xs text-gray-9">Phone</label>
                <input type="tel" value={form.phone} onChange={(e) => updateField('phone', e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" placeholder="+1 (555) 000-0000" />
              </div>
            </div>
          </fieldset>

          {/* Address */}
          <fieldset>
            <legend className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-3">Address</legend>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-9">Street Address</label>
                <input type="text" value={form.address} onChange={(e) => updateField('address', e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" placeholder="123 Main St" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-9">City</label>
                  <input type="text" value={form.city} onChange={(e) => updateField('city', e.target.value)}
                    className="mt-1 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" placeholder="San Francisco" />
                </div>
                <div>
                  <label className="text-xs text-gray-9">Country</label>
                  <input type="text" value={form.country} onChange={(e) => updateField('country', e.target.value)}
                    className="mt-1 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" placeholder="United States" />
                </div>
              </div>
            </div>
          </fieldset>

          {/* Social */}
          <fieldset>
            <legend className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-3">Social</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-gray-9">LinkedIn URL</label>
                <input type="url" value={form.linkedin_url} onChange={(e) => updateField('linkedin_url', e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" placeholder="https://linkedin.com/company/acme" />
              </div>
              <div>
                <label className="text-xs text-gray-9">Twitter URL</label>
                <input type="url" value={form.twitter_url} onChange={(e) => updateField('twitter_url', e.target.value)}
                  className="mt-1 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7" placeholder="https://twitter.com/acme" />
              </div>
            </div>
          </fieldset>

          {/* Details */}
          <fieldset>
            <legend className="text-xs font-medium text-gray-9 uppercase tracking-wider mb-3">Details</legend>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-9">Description</label>
                <textarea value={form.description} onChange={(e) => updateField('description', e.target.value)} rows={3}
                  className="mt-1 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7 resize-y" placeholder="What does this company do?" />
              </div>
              <div>
                <label className="text-xs text-gray-9">Notes</label>
                <textarea value={form.notes} onChange={(e) => updateField('notes', e.target.value)} rows={3}
                  className="mt-1 w-full px-3 py-2.5 bg-gray-1 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7 resize-y" placeholder="Internal notes…" />
              </div>
            </div>
          </fieldset>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button type="button" onClick={() => router.back()}
              className="px-4 py-2.5 border border-gray-5 rounded-md text-sm font-medium text-gray-10 hover:bg-gray-3 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="px-4 py-2.5 bg-gray-12 text-white rounded-md text-sm font-medium hover:bg-gray-11 disabled:opacity-50 transition-colors">
              {loading ? 'Creating…' : 'Create Company'}
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  )
}
