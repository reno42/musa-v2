'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { cn, getInitials, getStageLabel, getStageColor } from '@/lib/utils'
import { useT } from '@/lib/settings-context'
import { Search, Users, Building2, Target, CheckSquare, ArrowRight, Plus, FileText } from 'lucide-react'

interface SearchResult {
  id: string
  type: 'lead' | 'company' | 'contact' | 'deal' | 'task'
  title: string
  subtitle: string
  stage?: string
  href: string
}

interface CommandAction {
  id: string
  label: string
  icon: React.ReactNode
  href: string
  shortcut?: string
}

export function CommandMenu() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const t = useT()

  const actions: CommandAction[] = [
    { id: 'new-lead', label: t('sidebar.newLead'), icon: <Plus size={16} />, href: '/leads/new' },
    { id: 'new-company', label: t('companies.new'), icon: <Plus size={16} />, href: '/companies/new' },
    { id: 'new-deal', label: t('deals.new'), icon: <Plus size={16} />, href: '/deals' },
    { id: 'new-task', label: t('tasks.new'), icon: <Plus size={16} />, href: '/tasks' },
    { id: 'leads', label: t('nav.leads'), icon: <Users size={16} />, href: '/leads' },
    { id: 'companies', label: t('nav.companies'), icon: <Building2 size={16} />, href: '/companies' },
    { id: 'pipeline', label: t('nav.pipeline'), icon: <Target size={16} />, href: '/deals' },
    { id: 'tasks', label: t('nav.tasks'), icon: <CheckSquare size={16} />, href: '/tasks' },
    { id: 'dashboard', label: t('nav.dashboard'), icon: <FileText size={16} />, href: '/dashboard' },
  ]

  // Global keyboard shortcut
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50)
      setQuery('')
      setResults([])
      setSelectedIndex(0)
    }
  }, [open])

  // Search across all entities
  const search = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      return
    }
    setLoading(true)
    const term = `%${q.trim()}%`

    const [leadsRes, companiesRes, contactsRes, dealsRes, tasksRes] = await Promise.all([
      supabase.from('leads').select('id, full_name, company_name, email, stage').or(`full_name.ilike.${term},company_name.ilike.${term},email.ilike.${term}`).limit(5),
      supabase.from('companies').select('id, name, industry, domain').or(`name.ilike.${term},industry.ilike.${term},domain.ilike.${term}`).limit(3),
      supabase.from('contacts').select('id, full_name, email, company_name, role').or(`full_name.ilike.${term},email.ilike.${term},company_name.ilike.${term}`).limit(3),
      supabase.from('deals').select('id, title, stage, value').or(`title.ilike.${term}`).limit(3),
      supabase.from('tasks').select('id, title, status, priority').or(`title.ilike.${term}`).limit(3),
    ])

    const allResults: SearchResult[] = []

    if (leadsRes.data) {
      allResults.push(...leadsRes.data.map(l => ({
        id: l.id,
        type: 'lead' as const,
        title: l.full_name,
        subtitle: l.company_name || l.email || '',
        stage: l.stage,
        href: `/leads/${l.id}`,
      })))
    }
    if (companiesRes.data) {
      allResults.push(...companiesRes.data.map(c => ({
        id: c.id,
        type: 'company' as const,
        title: c.name,
        subtitle: c.industry || c.domain || '',
        href: `/companies/${c.id}`,
      })))
    }
    if (contactsRes.data) {
      allResults.push(...contactsRes.data.map(c => ({
        id: c.id,
        type: 'contact' as const,
        title: c.full_name,
        subtitle: c.company_name || c.email || c.role || '',
        href: `/people/${c.id}`,
      })))
    }
    if (dealsRes.data) {
      allResults.push(...dealsRes.data.map(d => ({
        id: d.id,
        type: 'deal' as const,
        title: d.title,
        subtitle: d.value ? `$${d.value.toLocaleString()}` : '',
        stage: d.stage,
        href: `/deals`,
      })))
    }
    if (tasksRes.data) {
      allResults.push(...tasksRes.data.map(t => ({
        id: t.id,
        type: 'task' as const,
        title: t.title,
        subtitle: `${t.status} · ${t.priority}`,
        href: `/tasks`,
      })))
    }

    setResults(allResults)
    setSelectedIndex(0)
    setLoading(false)
  }, [])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => search(query), 200)
    return () => clearTimeout(timer)
  }, [query, search])

  function navigate(href: string) {
    router.push(href)
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const totalItems = query.trim() ? results.length : actions.length
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex(i => (i + 1) % Math.max(totalItems, 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex(i => (i - 1 + Math.max(totalItems, 1)) % Math.max(totalItems, 1))
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (query.trim() && results.length > 0) {
        navigate(results[selectedIndex].href)
      } else if (!query.trim() && actions.length > 0) {
        navigate(actions[selectedIndex].href)
      }
    }
  }

  const typeIcons: Record<string, React.ReactNode> = {
    lead: <Users size={14} className="text-indigo-500" />,
    company: <Building2 size={14} className="text-blue-500" />,
    contact: <Users size={14} className="text-emerald-500" />,
    deal: <Target size={14} className="text-orange-500" />,
    task: <CheckSquare size={14} className="text-purple-500" />,
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]" onClick={() => setOpen(false)}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px]" />

      {/* Modal */}
      <div
        className="relative w-full max-w-lg bg-gray-1 rounded-xl shadow-2xl border border-gray-5 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-5">
          <Search size={18} className="text-gray-8 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search leads, companies, contacts, deals..."
            className="flex-1 bg-transparent text-sm text-gray-12 placeholder:text-gray-8 outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-gray-4 text-2xs text-gray-9 font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[320px] overflow-y-auto py-1">
          {loading && (
            <div className="px-4 py-6 text-center text-xs text-gray-9">Searching...</div>
          )}

          {!loading && query.trim() && results.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-gray-9">No results</div>
          )}

          {/* Quick actions (when no query) */}
          {!query.trim() && (
            <div className="py-1">
              <p className="px-4 py-1.5 text-2xs font-medium text-gray-9 uppercase tracking-wider">Quick Actions</p>
              {actions.map((action, i) => (
                <button
                  key={action.id}
                  onClick={() => navigate(action.href)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={cn(
                    'flex items-center gap-3 w-full px-4 py-2 text-sm text-left transition-colors',
                    selectedIndex === i ? 'bg-gray-3 text-gray-12' : 'text-gray-10 hover:bg-gray-3'
                  )}
                >
                  <span className="text-gray-8">{action.icon}</span>
                  <span className="flex-1">{action.label}</span>
                  <ArrowRight size={12} className="text-gray-8" />
                </button>
              ))}
            </div>
          )}

          {/* Search results */}
          {query.trim() && results.length > 0 && (
            <div className="py-1">
              {results.map((result, i) => (
                <button
                  key={`${result.type}-${result.id}`}
                  onClick={() => navigate(result.href)}
                  onMouseEnter={() => setSelectedIndex(i)}
                  className={cn(
                    'flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors',
                    selectedIndex === i ? 'bg-gray-3' : 'hover:bg-gray-3'
                  )}
                >
                  <div className="w-7 h-7 rounded-full bg-gray-4 flex items-center justify-center flex-shrink-0">
                    {typeIcons[result.type]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-12 truncate">{result.title}</p>
                    <p className="text-2xs text-gray-9 truncate">{result.subtitle}</p>
                  </div>
                  {result.stage && (
                    <span className={cn('text-2xs font-medium px-1.5 py-0.5 rounded-md border', getStageColor(result.stage))}>
                      {getStageLabel(result.stage)}
                    </span>
                  )}
                  <span className="text-2xs text-gray-8 capitalize px-1.5 py-0.5 rounded bg-gray-4">
                    {result.type}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-gray-5 bg-gray-3">
          <span className="text-2xs text-gray-8 flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-gray-5 text-2xs font-mono">↑↓</kbd> navigate
          </span>
          <span className="text-2xs text-gray-8 flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-gray-5 text-2xs font-mono">↵</kbd> open
          </span>
          <span className="text-2xs text-gray-8 flex items-center gap-1">
            <kbd className="px-1 py-0.5 rounded bg-gray-5 text-2xs font-mono">esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}
