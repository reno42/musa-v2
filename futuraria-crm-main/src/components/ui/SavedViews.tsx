'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/settings-context'
import { X, Plus, Star, StarOff } from 'lucide-react'

export interface ViewFilter {
  key: string
  value: string
  label: string
}

interface SavedView {
  id: string
  name: string
  filters: ViewFilter[]
  isDefault?: boolean
}

interface SavedViewsProps {
  entity: string // 'leads' | 'companies' | 'deals' | 'tasks'
  currentFilters: ViewFilter[]
  onViewSelect: (filters: ViewFilter[]) => void
  className?: string
}

export function SavedViews({ entity, currentFilters, onViewSelect, className }: SavedViewsProps) {
  const [views, setViews] = useState<SavedView[]>([])
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [newViewName, setNewViewName] = useState('')
  const t = useT()

  // Load views from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(`futuraria-views-${entity}`)
    if (saved) {
      try {
        setViews(JSON.parse(saved))
      } catch {}
    }
  }, [entity])

  function saveViews(updatedViews: SavedView[]) {
    setViews(updatedViews)
    localStorage.setItem(`futuraria-views-${entity}`, JSON.stringify(updatedViews))
  }

  function saveCurrentView() {
    if (!newViewName.trim()) return
    const newView: SavedView = {
      id: Date.now().toString(),
      name: newViewName.trim(),
      filters: currentFilters,
    }
    saveViews([...views, newView])
    setNewViewName('')
    setShowSaveForm(false)
    setActiveViewId(newView.id)
  }

  function deleteView(viewId: string) {
    const updated = views.filter(v => v.id !== viewId)
    saveViews(updated)
    if (activeViewId === viewId) setActiveViewId(null)
  }

  function selectView(view: SavedView) {
    setActiveViewId(view.id)
    onViewSelect(view.filters)
  }

  function clearView() {
    setActiveViewId(null)
    onViewSelect([])
  }

  const hasActiveFilters = currentFilters.length > 0

  return (
    <div className={cn('flex items-center gap-1.5 overflow-x-auto pipeline-scroll', className)}>
      {/* All / Clear */}
      <button
        onClick={clearView}
        className={cn(
          'flex-shrink-0 px-2.5 py-1 rounded-md text-2xs font-medium transition-all border',
          !activeViewId && !hasActiveFilters
            ? 'bg-gray-12 text-white border-gray-12'
            : 'bg-gray-1 text-gray-10 border-gray-5 hover:border-gray-7'
        )}
      >
        All
      </button>

      {/* Saved views */}
      {views.map((view) => (
        <div key={view.id} className="flex-shrink-0 flex items-center group">
          <button
            onClick={() => selectView(view)}
            className={cn(
              'px-2.5 py-1 rounded-l-md text-2xs font-medium transition-all border',
              activeViewId === view.id
                ? 'bg-gray-12 text-white border-gray-12'
                : 'bg-gray-1 text-gray-10 border-gray-5 hover:border-gray-7'
            )}
          >
            {view.name}
          </button>
          <button
            onClick={() => deleteView(view.id)}
            className="px-1 py-1 rounded-r-md border border-l-0 border-gray-5 bg-gray-1 text-gray-8 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
            title="Delete view"
          >
            <X size={10} />
          </button>
        </div>
      ))}

      {/* Save current filters as view */}
      {hasActiveFilters && !activeViewId && (
        <>
          {showSaveForm ? (
            <div className="flex-shrink-0 flex items-center gap-1">
              <input
                type="text"
                value={newViewName}
                onChange={e => setNewViewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveCurrentView(); if (e.key === 'Escape') setShowSaveForm(false) }}
                placeholder="View name"
                className="w-28 px-2 py-0.5 border border-gray-5 rounded-md text-2xs focus:outline-none focus:border-gray-7"
                autoFocus
              />
              <button
                onClick={saveCurrentView}
                disabled={!newViewName.trim()}
                className="px-2 py-0.5 rounded-md text-2xs font-medium bg-gray-12 text-white"
              >
                Save
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowSaveForm(true)}
              className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-md text-2xs text-gray-9 hover:text-gray-12 border border-dashed border-gray-5 hover:border-gray-7 transition-colors"
            >
              <Plus size={10} />
              Save View
            </button>
          )}
        </>
      )}
    </div>
  )
}
