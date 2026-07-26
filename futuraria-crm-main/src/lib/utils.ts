import { type ClassValue, clsx } from 'clsx'

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs)
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('es', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date))
}

export function formatRelativeDate(date: string | Date): string {
  const now = new Date()
  const d = new Date(date)
  const diff = now.getTime() - d.getTime()
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (minutes < 1) return 'ahora'
  if (minutes < 60) return `hace ${minutes}m`
  if (hours < 24) return `hace ${hours}h`
  if (days < 7) return `hace ${days}d`
  return formatDate(date)
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function getStageColor(stage: string): string {
  const colors: Record<string, string> = {
    new: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    researching: 'bg-violet-50 text-violet-700 border-violet-200',
    contacted: 'bg-purple-50 text-purple-700 border-purple-200',
    qualified: 'bg-amber-50 text-amber-700 border-amber-200',
    demo_scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
    proposal_sent: 'bg-pink-50 text-pink-700 border-pink-200',
    negotiation: 'bg-orange-50 text-orange-700 border-orange-200',
    won: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    lost: 'bg-red-50 text-red-700 border-red-200',
    nurturing: 'bg-gray-50 text-gray-700 border-gray-200',
    discarded: 'bg-stone-50 text-stone-600 border-stone-200',
  }
  return colors[stage] || 'bg-gray-50 text-gray-700 border-gray-200'
}

export function getStageLabel(stage: string): string {
  const labels: Record<string, string> = {
    new: 'New',
    researching: 'Researching',
    contacted: 'Contacted',
    qualified: 'Qualified',
    demo_scheduled: 'Demo Scheduled',
    proposal_sent: 'Proposal Sent',
    negotiation: 'Negotiation',
    won: 'Won',
    lost: 'Lost',
    nurturing: 'Nurturing',
    discarded: 'Discarded',
  }
  return labels[stage] || stage
}

export function getPriorityColor(priority: string): string {
  const colors: Record<string, string> = {
    low: 'bg-gray-100 text-gray-600',
    medium: 'bg-blue-50 text-blue-600',
    high: 'bg-orange-50 text-orange-600',
    urgent: 'bg-red-50 text-red-600',
  }
  return colors[priority] || 'bg-gray-100 text-gray-600'
}

export function getScoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600'
  if (score >= 60) return 'text-amber-600'
  if (score >= 40) return 'text-orange-600'
  return 'text-red-600'
}

export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('es', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
  }).format(amount)
}
