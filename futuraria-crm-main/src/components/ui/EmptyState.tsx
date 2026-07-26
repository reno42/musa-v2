import Link from 'next/link'

interface EmptyStateProps {
  title: string
  description?: string
  action?: { label: string; href: string }
  icon?: React.ReactNode
}

export function EmptyState({ title, description, action, icon }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {icon && <div className="mb-3 text-gray-8">{icon}</div>}
      <h3 className="text-sm font-medium text-gray-12">{title}</h3>
      {description && <p className="text-xs text-gray-9 mt-1 max-w-[240px]">{description}</p>}
      {action && (
        <Link href={action.href}
          className="mt-4 px-4 py-2 bg-gray-12 text-white text-sm font-medium rounded-md hover:bg-gray-11 transition-colors">
          {action.label}
        </Link>
      )}
    </div>
  )
}
