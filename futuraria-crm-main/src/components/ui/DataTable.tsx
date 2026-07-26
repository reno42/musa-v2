'use client'

import { useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { Pagination } from './Pagination'

interface Column<T> {
  key: string
  label: string
  render?: (item: T) => React.ReactNode
  className?: string
  sortable?: boolean
}

interface DataTableProps<T> {
  data: T[]
  columns: Column<T>[]
  onRowClick?: (item: T) => void
  loading?: boolean
  emptyMessage?: string
  className?: string
  selectable?: boolean
  selectedIds?: Set<string>
  onSelectionChange?: (ids: Set<string>) => void
  pageSize?: number
}

export function DataTable<T extends { id: string }>({
  data,
  columns,
  onRowClick,
  loading = false,
  emptyMessage = 'No data',
  className,
  selectable = true,
  selectedIds: externalSelectedIds,
  onSelectionChange,
  pageSize = 50,
}: DataTableProps<T>) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)

  // Sync from external
  useEffect(() => {
    if (externalSelectedIds) setSelected(externalSelectedIds)
  }, [externalSelectedIds])

  // Clear selection on data change (don't notify parent to avoid re-render loops)
  useEffect(() => {
    setSelected(new Set())
    setPage(1)
  }, [data.length]) // eslint-disable-line

  function notify(next: Set<string>) {
    setSelected(next)
    onSelectionChange?.(next)
  }

  const allSelected = data.length > 0 && data.every((item) => selected.has(item.id))

  function toggleAll() {
    notify(allSelected ? new Set() : new Set(data.map((d) => d.id)))
  }

  function toggleOne(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    notify(next)
  }

  const totalPages = Math.ceil(data.length / pageSize)
  const paginatedData = data.slice((page - 1) * pageSize, page * pageSize)

  if (loading) {
    return (
      <div className={cn('bg-gray-1 rounded-md border border-gray-5 overflow-hidden', className)}>
        <div className="p-4 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 skeleton rounded-md" />
          ))}
        </div>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className={cn('bg-gray-1 rounded-md border border-gray-5 p-12 text-center', className)}>
        <p className="text-sm text-gray-9">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className={cn('bg-gray-1 rounded-md border border-gray-5 overflow-hidden overflow-x-auto', className)}>
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-5 bg-gray-3">
            {selectable && (
              <th className="w-10 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="w-3.5 h-3.5 rounded border-gray-6 accent-gray-12 cursor-pointer"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'text-left px-4 py-2.5 text-2xs font-medium text-gray-9 uppercase tracking-wider',
                  col.className
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {paginatedData.map((item) => {
            const isSelected = selected.has(item.id)
            return (
              <tr
                key={item.id}
                onClick={() => onRowClick?.(item)}
                className={cn(
                  'border-b border-gray-5 last:border-0 transition-colors',
                  onRowClick && 'cursor-pointer',
                  isSelected ? 'bg-gray-3' : 'hover:bg-gray-3'
                )}
              >
                {selectable && (
                  <td className="w-10 px-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(item.id)}
                      className="w-3.5 h-3.5 rounded border-gray-6 accent-gray-12 cursor-pointer"
                    />
                  </td>
                )}
                {columns.map((col) => (
                  <td key={col.key} className={cn('px-4 py-3 text-sm', col.className)}>
                    {col.render
                      ? col.render(item)
                      : (item as Record<string, unknown>)[col.key] as React.ReactNode}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      {data.length > pageSize && (
        <div className="px-4 py-2 border-t border-gray-5">
          <Pagination
            page={page}
            totalPages={totalPages}
            onPageChange={setPage}
            totalItems={data.length}
            pageSize={pageSize}
          />
        </div>
      )}
    </div>
  )
}
