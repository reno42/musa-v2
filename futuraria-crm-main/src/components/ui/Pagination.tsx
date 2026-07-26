'use client'

import { cn } from '@/lib/utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  totalItems?: number
  pageSize?: number
}

export function Pagination({ page, totalPages, onPageChange, totalItems, pageSize }: PaginationProps) {
  if (totalPages <= 1) return null

  const pages: (number | '...')[] = []
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
  } else {
    pages.push(1)
    if (page > 3) pages.push('...')
    for (let i = Math.max(2, page - 1); i <= Math.min(totalPages - 1, page + 1); i++) {
      pages.push(i)
    }
    if (page < totalPages - 2) pages.push('...')
    pages.push(totalPages)
  }

  return (
    <div className="flex items-center justify-between pt-3">
      {totalItems !== undefined && pageSize !== undefined && (
        <span className="text-xs text-gray-9">
          Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalItems)} of {totalItems}
        </span>
      )}
      <div className="flex items-center gap-1 ml-auto">
        <button
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1}
          className={cn(
            'p-1.5 rounded-md transition-colors',
            page === 1 ? 'text-gray-6 cursor-not-allowed' : 'text-gray-10 hover:bg-gray-3 hover:text-gray-12'
          )}
        >
          <ChevronLeft size={14} />
        </button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`dots-${i}`} className="px-1 text-gray-8 text-xs">…</span>
          ) : (
            <button
              key={p}
              onClick={() => onPageChange(p)}
              className={cn(
                'min-w-[28px] h-7 rounded-md text-xs font-medium transition-colors',
                p === page ? 'bg-gray-12 text-white' : 'text-gray-10 hover:bg-gray-3 hover:text-gray-12'
              )}
            >
              {p}
            </button>
          )
        )}
        <button
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages}
          className={cn(
            'p-1.5 rounded-md transition-colors',
            page === totalPages ? 'text-gray-6 cursor-not-allowed' : 'text-gray-10 hover:bg-gray-3 hover:text-gray-12'
          )}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  )
}
