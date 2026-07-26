'use client'

import { cn } from '@/lib/utils'
import { X, Trash2, Tag, ArrowRight } from 'lucide-react'

interface BulkActionsProps {
  selectedCount: number
  onClear: () => void
  onDelete?: () => void
  onStageChange?: (stage: string) => void
  stageOptions?: { value: string; label: string }[]
  className?: string
}

export function BulkActions({
  selectedCount,
  onClear,
  onDelete,
  onStageChange,
  stageOptions,
  className,
}: BulkActionsProps) {
  if (selectedCount === 0) return null

  return (
    <div className={cn(
      'flex items-center gap-3 px-4 py-2.5 bg-gray-12 text-white rounded-lg shadow-lg',
      'animate-in slide-in-from-bottom-2 duration-200',
      className
    )}>
      <button
        onClick={onClear}
        className="p-1 rounded-md hover:bg-white/10 transition-colors"
      >
        <X size={16} />
      </button>

      <span className="text-sm font-medium">
        {selectedCount} selected
      </span>

      <div className="h-4 w-px bg-white/20" />

      {/* Stage change */}
      {onStageChange && stageOptions && (
        <div className="flex items-center gap-1">
          <ArrowRight size={14} className="text-white/60" />
          {stageOptions.map(opt => (
            <button
              key={opt.value}
              onClick={() => onStageChange(opt.value)}
              className="px-2 py-0.5 rounded-md text-2xs font-medium bg-white/10 hover:bg-white/20 transition-colors"
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Delete */}
      {onDelete && (
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-2xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-200 transition-colors ml-auto"
        >
          <Trash2 size={12} />
          Delete
        </button>
      )}
    </div>
  )
}
