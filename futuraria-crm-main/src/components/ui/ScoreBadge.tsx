import { cn } from '@/lib/utils'

interface ScoreBadgeProps {
  score: number
  size?: 'sm' | 'md'
}

export function ScoreBadge({ score, size = 'sm' }: ScoreBadgeProps) {
  const circumference = 2 * Math.PI * 8
  const strokeDashoffset = circumference - (score / 100) * circumference

  if (size === 'md') {
    return (
      <div className="relative w-14 h-14 flex items-center justify-center">
        <svg className="w-14 h-14 -rotate-90" viewBox="0 0 20 20">
          <circle cx="10" cy="10" r="8" fill="none" stroke="#EFEFEF" strokeWidth="2" />
          <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2"
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round"
            className={cn('transition-all duration-500', getScoreColor(score))} />
        </svg>
        <span className={cn('absolute text-sm font-semibold tabular-nums', getScoreColor(score))}>{score}</span>
      </div>
    )
  }

  return (
    <div className="relative w-8 h-8 flex items-center justify-center">
      <svg className="w-8 h-8 -rotate-90" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" fill="none" stroke="#EFEFEF" strokeWidth="2" />
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2"
          strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round"
          className={cn('transition-all duration-500', getScoreColor(score))} />
      </svg>
      <span className={cn('absolute text-2xs font-semibold tabular-nums', getScoreColor(score))}>{score}</span>
    </div>
  )
}

function getScoreColor(score: number): string {
  if (score >= 80) return 'text-emerald-600'
  if (score >= 60) return 'text-amber-600'
  if (score >= 40) return 'text-orange-600'
  return 'text-red-600'
}
