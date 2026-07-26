'use client'

import { useState } from 'react'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'
import Image from 'next/image'
import { Plus, SlidersHorizontal, ArrowUpDown, MoreHorizontal, Search } from 'lucide-react'
import Link from 'next/link'

interface AppShellProps {
  children: React.ReactNode
  title?: string
  subtitle?: string
  icon?: React.ReactNode
  count?: number
  action?: React.ReactNode
  actionHref?: string
  actionLabel?: string
  filters?: React.ReactNode
}

export function AppShell({
  children,
  title,
  subtitle,
  icon,
  count,
  action,
  actionHref,
  actionLabel = 'New',
  filters,
}: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const defaultAction = actionHref ? (
    <Link
      href={actionHref}
      className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 transition-colors"
    >
      <Plus size={14} strokeWidth={2} />
      <span className="hidden sm:inline">{actionLabel}</span>
    </Link>
  ) : null

  return (
    <>
      {/* Desktop layout (≥1024px) */}
      <div className="hidden lg:flex min-h-screen">
        <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} />
        <div
          className={`flex-1 transition-all duration-200 ${sidebarCollapsed ? 'ml-[60px]' : 'ml-[220px]'}`}
        >
          {/* Top bar */}
          <header className="sticky top-0 z-30 bg-gray-1/80 backdrop-blur-md border-b border-gray-5">
            <div className="flex items-center justify-between h-14 px-6">
              <div className="flex items-center gap-2.5">
                {icon && <span className="text-gray-9">{icon}</span>}
                {title && (
                  <h1 className="text-lg font-semibold text-gray-12 tracking-tight">{title}</h1>
                )}
                {count !== undefined && (
                  <span className="text-sm text-gray-9 tabular-nums">{count}</span>
                )}
                {subtitle && <p className="text-xs text-gray-9 ml-1">{subtitle}</p>}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
                  className="p-2 rounded-md hover:bg-gray-3 text-gray-9 transition-colors"
                  title="Search (⌘K)"
                >
                  <Search size={16} />
                </button>
                <button className="p-2 rounded-md hover:bg-gray-3 text-gray-9 transition-colors">
                  <SlidersHorizontal size={16} />
                </button>
                <button className="p-2 rounded-md hover:bg-gray-3 text-gray-9 transition-colors">
                  <ArrowUpDown size={16} />
                </button>
                <button className="p-2 rounded-md hover:bg-gray-3 text-gray-9 transition-colors">
                  <MoreHorizontal size={16} />
                </button>
                {action || defaultAction}
              </div>
            </div>
            {filters && <div className="px-6 pb-3 border-b border-gray-5">{filters}</div>}
          </header>
          {/* Content */}
          <main className="p-6">{children}</main>
        </div>
      </div>

      {/* Mobile layout (<1024px) */}
      <div className="lg:hidden min-h-dvh bg-gray-2">
        <header className="sticky top-0 z-40 bg-gray-1/80 backdrop-blur-md border-b border-gray-5">
          <div className="flex items-center justify-between h-14 px-4">
            <div className="flex items-center gap-2.5">
              <Image
                src="/futuraria-logo.png"
                alt="Futuraria"
                width={28}
                height={28}
                className="rounded-md"
              />
              {title && (
                <h1 className="text-base font-semibold text-gray-12 tracking-tight">{title}</h1>
              )}
              {count !== undefined && (
                <span className="text-sm text-gray-9 tabular-nums">{count}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
                className="p-2 rounded-md hover:bg-gray-3 text-gray-9 transition-colors"
              >
                <Search size={16} />
              </button>
              {action || defaultAction}
            </div>
          </div>
          {filters && <div className="px-4 pb-3">{filters}</div>}
        </header>
        <main className="pb-20">{children}</main>
        <BottomNav />
      </div>
    </>
  )
}
