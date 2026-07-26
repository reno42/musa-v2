import { cn } from '@/lib/utils'

interface BadgeProps {
  children: React.ReactNode
  className?: string
  variant?: 'default' | 'outline'
}

export function Badge({ children, className, variant = 'default' }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-md text-2xs font-medium',
      variant === 'outline' ? 'border border-current' : 'bg-gray-4 text-gray-9',
      className
    )}>
      {children}
    </span>
  )
}
