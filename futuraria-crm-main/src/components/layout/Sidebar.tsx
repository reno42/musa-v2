'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useSettings } from '@/lib/settings-context'
import {
  LayoutDashboard,
  Building2,
  Users,
  Target,
  CheckSquare,
  StickyNote,
  PieChart,
  GitBranch,
  Webhook,
  Settings,
  Plus,
  ChevronLeft,
  ChevronRight,
  Globe,
  Moon,
  Sun,
  Key,
  FileText,
  LogOut,
} from 'lucide-react'
import { useAuth } from '@/lib/auth-context'

interface SidebarProps {
  collapsed?: boolean
  onToggle?: () => void
}

export function Sidebar({ collapsed = false, onToggle }: SidebarProps) {
  const pathname = usePathname()
  const { locale, setLocale, theme, setTheme, t } = useSettings()

  const favoriteItems = [
    { label: t('nav.dashboard'), href: '/dashboard', icon: LayoutDashboard },
  ]

  const workspaceItems = [
    { label: t('nav.companies'), href: '/companies', icon: Building2 },
    { label: t('nav.opportunities'), href: '/opportunities', icon: Target },
    { label: t('nav.leads'), href: '/leads', icon: Users },
    { label: t('nav.tasks'), href: '/tasks', icon: CheckSquare },
    { label: t('nav.notes'), href: '/notes', icon: StickyNote },
    { label: t('nav.dashboards'), href: '/dashboard', icon: PieChart },
    { label: t('nav.workflows'), href: '/workflows', icon: GitBranch },
    { label: t('nav.webhooks'), href: '/webhooks', icon: Webhook },
    { label: t('nav.webhookLogs'), href: '/webhook-logs', icon: Webhook },
  ]

  const configItems = [
    { label: 'API Keys', href: '/api-keys', icon: Key },
    { label: 'Documentación', href: '/docs', icon: FileText },
  ]

  function renderNavGroup(items: typeof workspaceItems, label?: string) {
    return (
      <div className="mb-1">
        {label && !collapsed && (
          <p className="px-3 pt-4 pb-1 text-2xs font-medium text-gray-9 uppercase tracking-wider">
            {label}
          </p>
        )}
        {items.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + '/')
          const Icon = item.icon
          return (
            <Link
              key={item.href + item.label}
              href={item.href}
              className={cn(
                'flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-gray-4 text-gray-12 font-medium'
                  : 'text-gray-10 hover:bg-gray-3 hover:text-gray-12'
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon size={18} strokeWidth={1.5} className="flex-shrink-0" />
              {!collapsed && <span>{item.label}</span>}
            </Link>
          )
        })}
      </div>
    )
  }

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 h-full bg-gray-1 border-r border-gray-5 flex flex-col z-50 transition-all duration-200',
        collapsed ? 'w-[60px]' : 'w-[220px]'
      )}
    >
      {/* Logo + Collapse toggle */}
      <div className="h-14 flex items-center justify-between px-3 border-b border-gray-5">
        <div className="flex items-center gap-2.5 min-w-0">
          <Image
            src="/futuraria-logo.png"
            alt="Futuraria"
            width={28}
            height={28}
            className="rounded-md flex-shrink-0"
          />
          {!collapsed && (
            <span className="text-sm font-semibold text-gray-12 tracking-tight truncate">
              Futuraria
            </span>
          )}
        </div>
        {onToggle && (
          <button
            onClick={onToggle}
            className="p-1 rounded-md hover:bg-gray-3 text-gray-9 transition-colors flex-shrink-0"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-1 px-1.5 overflow-y-auto">
        {renderNavGroup(favoriteItems, t('sidebar.favorites'))}
        {renderNavGroup(workspaceItems, t('sidebar.workspace'))}
        {renderNavGroup(configItems, locale === 'es' ? 'Configuración' : 'Settings')}
      </nav>

      {/* Bottom section */}
      <div className="border-t border-gray-5 p-2 space-y-1">
        {/* Language + Theme toggles */}
        <div className={cn('flex gap-1 px-1 py-1', collapsed ? 'flex-col items-center' : 'items-center justify-between')}>
          {/* Language toggle */}
          <button
            onClick={() => setLocale(locale === 'es' ? 'en' : 'es')}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-gray-10 hover:bg-gray-3 hover:text-gray-12 transition-colors"
            title={locale === 'es' ? 'Switch to English' : 'Cambiar a EspaÃ±ol'}
          >
            <Globe size={14} strokeWidth={1.5} />
            {!collapsed && <span className="uppercase font-medium">{locale === 'es' ? 'ES' : 'EN'}</span>}
          </button>

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-gray-10 hover:bg-gray-3 hover:text-gray-12 transition-colors"
            title={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
          >
            {theme === 'light' ? <Moon size={14} strokeWidth={1.5} /> : <Sun size={14} strokeWidth={1.5} />}
            {!collapsed && <span className="font-medium">{theme === 'light' ? t('settings.dark') : t('settings.light')}</span>}
          </button>
        </div>

        {/* Logout */}
        <LogoutButton collapsed={collapsed} />

        {/* Settings */}
        <Link
          href="/settings"
          className={cn(
            'flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm transition-colors',
            pathname === '/settings'
              ? 'bg-gray-4 text-gray-12 font-medium'
              : 'text-gray-10 hover:bg-gray-3 hover:text-gray-12'
          )}
          title={collapsed ? t('sidebar.settings') : undefined}
        >
          <Settings size={18} strokeWidth={1.5} className="flex-shrink-0" />
          {!collapsed && <span>{t('sidebar.settings')}</span>}
        </Link>

        {/* New Lead button */}
        <Link
          href="/leads/new"
          className={cn(
            'flex items-center justify-center gap-2 w-full py-2 rounded-md text-sm font-medium transition-colors',
            'bg-gray-12 text-white hover:bg-gray-11'
          )}
        >
          <Plus size={16} strokeWidth={2} />
          {!collapsed && t('sidebar.newLead')}
        </Link>
      </div>
    </aside>
  )
}

function LogoutButton({ collapsed }: { collapsed: boolean }) {
  const { signOut } = useAuth()
  const { locale } = useSettings()
  return (
    <button
      onClick={signOut}
      className="flex items-center gap-2.5 px-3 py-1.5 rounded-md text-sm text-gray-10 hover:bg-gray-3 hover:text-red-600 transition-colors w-full"
      title={collapsed ? (locale === 'es' ? 'Cerrar sesión' : 'Log out') : undefined}
    >
      <LogOut size={18} strokeWidth={1.5} className="flex-shrink-0" />
      {!collapsed && <span>{locale === 'es' ? 'Cerrar sesión' : 'Log out'}</span>}
    </button>
  )
}
