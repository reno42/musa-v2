'use client'

import { useEffect, useState, useMemo } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { cn, formatCurrency, formatDate } from '@/lib/utils'
import { Target, Star, Plus } from 'lucide-react'
import Link from 'next/link'
import type { Deal } from '@/types/database'

const KANBAN_COLUMNS = [
  { key: 'discovery', label: 'Discovery', badgeClass: 'badge-pink' },
  { key: 'proposal', label: 'Proposal', badgeClass: 'badge-purple' },
  { key: 'negotiation', label: 'Negotiation', badgeClass: 'badge-blue' },
  { key: 'closed_won', label: 'Won', badgeClass: 'badge-green' },
] as const

function StarRating({ value }: { value: number }) {
  const stars = Math.min(5, Math.max(0, Math.round(value / 20)))
  return (
    <div className="star-rating">
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          size={12}
          fill={i < stars ? '#fbbf24' : 'none'}
          stroke={i < stars ? '#fbbf24' : '#D9D9D9'}
          strokeWidth={1.5}
        />
      ))}
    </div>
  )
}

export default function OpportunitiesPage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDeals()
  }, [])

  async function loadDeals() {
    const { data } = await supabase
      .from('deals')
      .select('*')
      .order('created_at', { ascending: false })
    setDeals(data || [])
    setLoading(false)
  }

  // Map deals to kanban columns — include closed_won in "Won" column
  const columns = useMemo(() => {
    return KANBAN_COLUMNS.map((col) => {
      const items = deals.filter((d) => d.stage === col.key)
      const total = items.reduce((s, d) => s + (d.value || 0), 0)
      return { ...col, items, total }
    })
  }, [deals])

  const action = (
    <Link
      href="/leads"
      className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 transition-colors"
    >
      <Plus size={14} strokeWidth={2} />
      <span className="hidden sm:inline">New Opportunity</span>
    </Link>
  )

  return (
    <AppShell title="Opportunities" icon={<Target size={20} />} action={action}>
      {loading ? (
        <div className="kanban-container">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="kanban-column">
              {Array.from({ length: 3 }).map((_, j) => (
                <div key={j} className="h-32 skeleton rounded-md" />
              ))}
            </div>
          ))}
        </div>
      ) : deals.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Target size={40} className="text-gray-6 mb-4" />
          <h3 className="text-sm font-medium text-gray-12 mb-1">No opportunities</h3>
          <p className="text-xs text-gray-9 mb-4">Opportunities are created from leads</p>
          <Link
            href="/leads"
            className="px-4 py-2 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 transition-colors"
          >
            View Leads
          </Link>
        </div>
      ) : (
        <div className="kanban-container" style={{ padding: 0 }}>
          {columns.map((col) => (
            <div key={col.key} className="kanban-column">
              {/* Column header */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className={cn('k-badge', col.badgeClass)}>{col.label}</span>
                  <span className="text-xs text-gray-9">{col.items.length}</span>
                </div>
                <span className="text-xs text-gray-9 tabular-nums">
                  {formatCurrency(col.total)}
                </span>
              </div>

              {/* Cards */}
              {col.items.length === 0 ? (
                <div className="p-4 rounded-md border border-dashed border-gray-5 text-center">
                  <p className="text-xs text-gray-8">No items</p>
                </div>
              ) : (
                col.items.map((deal) => (
                  <div key={deal.id} className="kanban-card cursor-pointer hover:border-gray-6 transition-colors">
                    <div className="flex items-start justify-between">
                      <p className="text-sm font-medium text-gray-12 line-clamp-1">
                        {deal.title}
                      </p>
                      <StarRating value={deal.probability} />
                    </div>
                    {deal.value && (
                      <p className="text-lg font-semibold text-gray-12 tabular-nums">
                        {formatCurrency(deal.value)}
                      </p>
                    )}
                    <div className="flex flex-col gap-1">
                      {deal.description && (
                        <p className="text-xs text-gray-9 line-clamp-1">{deal.description}</p>
                      )}
                      <div className="flex items-center justify-between">
                        <span className="text-2xs text-gray-9">
                          {deal.expected_close_date
                            ? formatDate(deal.expected_close_date)
                            : formatDate(deal.created_at)}
                        </span>
                        <span className="text-2xs text-gray-8 font-mono">
                          #{deal.id.slice(0, 6)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </AppShell>
  )
}
