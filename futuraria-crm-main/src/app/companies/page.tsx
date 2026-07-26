'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { DataTable } from '@/components/ui/DataTable'
import { supabase } from '@/lib/supabase'
import { cn, getInitials } from '@/lib/utils'
import { Building2, Plus, Download } from 'lucide-react'
import { useT } from '@/lib/settings-context'
import { exportToCSV } from '@/lib/export-csv'
import type { Company } from '@/types/database'

export default function CompaniesPage() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const t = useT()

  useEffect(() => {
    loadCompanies()
  }, [])

  async function loadCompanies() {
    setLoading(true)
    const { data } = await supabase.from('companies').select('*').order('name', { ascending: true })
    setCompanies(data || [])
    setLoading(false)
  }

  const filtered = companies.filter((c) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      c.name.toLowerCase().includes(q) ||
      c.industry?.toLowerCase().includes(q) ||
      c.domain?.toLowerCase().includes(q)
    )
  })

  function handleExport() {
    exportToCSV(filtered, [
      { key: 'name', label: 'Name' },
      { key: 'domain', label: 'Domain' },
      { key: 'industry', label: 'Industry' },
      { key: 'size', label: 'Size' },
      { key: 'city', label: 'City' },
      { key: 'country', label: 'Country' },
      { key: 'website', label: 'Website' },
      { key: 'created_at', label: 'Created' },
    ], 'futuraria-companies')
  }

  const action = (
    <div className="flex items-center gap-1.5">
      <button
        onClick={handleExport}
        className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-1 border border-gray-5 text-sm text-gray-10 hover:bg-gray-3 transition-colors"
        title="Export CSV"
      >
        <Download size={14} />
        <span className="hidden sm:inline">{t('common.exportCSV')}</span>
      </button>
      <Link
        href="/companies/new"
        className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 transition-colors"
      >
        <Plus size={14} strokeWidth={2} />
        <span className="hidden sm:inline">{t('companies.new')}</span>
      </Link>
    </div>
  )

  return (
    <AppShell title="Companies" icon={<Building2 size={20} />} count={filtered.length} action={action}>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <SearchBar
            value={search}
            onChange={setSearch}
            placeholder={t('companies.searchPlaceholder')}
            className="flex-1"
          />
          <span className="text-xs text-gray-9 whitespace-nowrap">
            {filtered.length} {t('companies.title').toLowerCase()}
          </span>
        </div>

        {/* Desktop: Table */}
        <div className="hidden md:block">
          <DataTable
            data={filtered}
            loading={loading}
            emptyMessage={t('companies.noCompanies')}
            onRowClick={(c) => router.push(`/companies/${c.id}`)}
            columns={[
              {
                key: 'name',
                label: 'Name',
                render: (c) => (
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-md bg-gray-4 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-semibold text-gray-9">
                        {getInitials(c.name).charAt(0)}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-12">{c.name}</p>
                      <p className="text-xs text-gray-9 truncate max-w-[200px]">
                        {c.domain || c.website || '—'}
                      </p>
                    </div>
                  </div>
                ),
              },
              {
                key: 'industry',
                label: 'Industry',
                render: (c) => <span className="text-sm text-gray-11">{c.industry || '—'}</span>,
              },
              {
                key: 'size',
                label: 'Size',
                render: (c) => <span className="status-pill">{c.size || '—'}</span>,
              },
              {
                key: 'city',
                label: 'Location',
                render: (c) => (
                  <span className="text-sm text-gray-11">
                    {[c.city, c.country].filter(Boolean).join(', ') || '—'}
                  </span>
                ),
              },
            ]}
          />
        </div>

        {/* Mobile: List */}
        <div className="md:hidden">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-14 skeleton rounded-md" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No companies"
              description="Companies are created from leads or here directly"
            />
          ) : (
            <div className="bg-gray-1 rounded-md border border-gray-5 divide-y divide-gray-5">
              {filtered.map((company) => (
                <Link
                  key={company.id}
                  href={`/companies/${company.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-3 transition-colors"
                >
                  <div className="w-9 h-9 rounded-md bg-gray-4 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-semibold text-gray-9">
                      {getInitials(company.name).charAt(0)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-12 truncate">{company.name}</p>
                    <p className="text-xs text-gray-9 truncate">
                      {company.industry || company.domain || '—'}
                    </p>
                  </div>
                  {company.size && (
                    <span className="text-2xs px-1.5 py-0.5 bg-gray-4 text-gray-9 rounded-md">
                      {company.size}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  )
}
