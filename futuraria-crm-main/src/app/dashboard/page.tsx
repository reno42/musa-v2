'use client'

import { useEffect, useState, useMemo } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { supabase } from '@/lib/supabase'
import { cn, formatCurrency } from '@/lib/utils'
import { LayoutDashboard } from 'lucide-react'
import type { Lead } from '@/types/database'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import { Bar, Line, Doughnut } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
)

export default function DashboardPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [deals, setDeals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)
    const [leadsRes, dealsRes] = await Promise.all([
      supabase.from('leads').select('*').order('created_at', { ascending: false }),
      supabase.from('deals').select('*'),
    ])
    setLeads(leadsRes.data || [])
    setDeals(dealsRes.data || [])
    setLoading(false)
  }

  // KPI calculations
  const totalLeads = leads.length
  const pipelineValue = useMemo(() => {
    return deals
      .filter((d: any) => !['closed_won', 'closed_lost'].includes(d.stage))
      .reduce((sum: number, d: any) => sum + (d.value || 0), 0)
  }, [deals])

  const conversionRate = useMemo(() => {
    if (leads.length === 0) return 0
    const won = leads.filter((l) => l.stage === 'won').length
    return Math.round((won / leads.length) * 100)
  }, [leads])

  // Leads by stage (bar chart)
  const stageLabels = ['New', 'Researching', 'Contacted', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'Won', 'Lost', 'Nurturing']
  const stageKeys = ['new', 'researching', 'contacted', 'qualified', 'demo_scheduled', 'proposal_sent', 'negotiation', 'won', 'lost', 'nurturing']
  const stageCounts = stageKeys.map((s) => leads.filter((l) => l.stage === s).length)

  const barData = {
    labels: stageLabels,
    datasets: [
      {
        label: 'Leads',
        data: stageCounts,
        backgroundColor: [
          '#6366F1', '#8B5CF6', '#A78BFA', '#F59E0B', '#3B82F6',
          '#EC4899', '#F97316', '#22C55E', '#EF4444', '#6B7280',
        ],
        borderRadius: 4,
        barThickness: 20,
      },
    ],
  }

  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: '#333', titleFont: { size: 12 }, bodyFont: { size: 12 } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#999' } },
      y: { grid: { color: '#EFEFEF' }, ticks: { font: { size: 11 }, color: '#999', stepSize: 1 } },
    },
  }

  // Leads over time (line chart — last 7 days)
  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setDate(d.getDate() - (6 - i))
    return d.toISOString().slice(0, 10)
  })

  const leadsPerDay = last7Days.map((day) =>
    leads.filter((l) => l.created_at?.startsWith(day)).length
  )

  const lineData = {
    labels: last7Days.map((d) => {
      const date = new Date(d + 'T00:00:00')
      return date.toLocaleDateString('en', { month: 'short', day: 'numeric' })
    }),
    datasets: [
      {
        label: 'New Leads',
        data: leadsPerDay,
        borderColor: '#5B5FC7',
        backgroundColor: 'rgba(91, 95, 199, 0.08)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#5B5FC7',
      },
    ],
  }

  const lineOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: '#333', titleFont: { size: 12 }, bodyFont: { size: 12 } },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 }, color: '#999' } },
      y: { grid: { color: '#EFEFEF' }, ticks: { font: { size: 11 }, color: '#999', stepSize: 1 }, beginAtZero: true },
    },
  }

  // Leads by source (donut)
  const sourceMap = new Map<string, number>()
  leads.forEach((l) => {
    const src = l.source || 'other'
    sourceMap.set(src, (sourceMap.get(src) || 0) + 1)
  })
  const sourceLabels = Array.from(sourceMap.keys()).map((s) => s.replace('_', ' '))
  const sourceValues = Array.from(sourceMap.values())

  const donutData = {
    labels: sourceLabels,
    datasets: [
      {
        data: sourceValues,
        backgroundColor: ['#5B5FC7', '#7C5CFC', '#22C55E', '#F59E0B', '#EF4444', '#3B82F6', '#EC4899', '#F97316', '#6B7280'],
        borderWidth: 0,
        spacing: 2,
      },
    ],
  }

  const donutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: {
      legend: {
        position: 'right' as const,
        labels: { padding: 12, usePointStyle: true, pointStyle: 'circle', font: { size: 11 }, color: '#666' },
      },
      tooltip: { backgroundColor: '#333', titleFont: { size: 12 }, bodyFont: { size: 12 } },
    },
  }

  const kpis = [
    { label: 'Total Leads', value: totalLeads.toString() },
    { label: 'Pipeline Value', value: formatCurrency(pipelineValue) },
    { label: 'Conversion Rate', value: `${conversionRate}%` },
  ]

  return (
    <AppShell title="Sales Dashboard" icon={<LayoutDashboard size={20} />}>
      <div className="dashboard-container" style={{ padding: 0 }}>
        {/* Top row: KPIs + Bar chart */}
        <div className="dash-row flex-col lg:flex-row">
          <div className="dash-kpi-col lg:min-w-[240px]">
            {kpis.map((kpi) => (
              <div key={kpi.label} className="dash-card">
                <span className="kpi-title">{kpi.label}</span>
                {loading ? (
                  <div className="h-8 w-20 skeleton rounded-md" />
                ) : (
                  <span className="kpi-value">{kpi.value}</span>
                )}
              </div>
            ))}
          </div>
          <div className="dash-card flex-1 min-h-[280px]">
            <span className="kpi-title">Leads by Stage</span>
            <div className="flex-1 min-h-[220px]">
              {loading ? (
                <div className="h-full skeleton rounded-md" />
              ) : (
                <Bar data={barData} options={barOptions} />
              )}
            </div>
          </div>
        </div>

        {/* Bottom row: Line + Donut */}
        <div className="dash-row flex-col lg:flex-row">
          <div className="dash-card flex-1 min-h-[280px]">
            <span className="kpi-title">Leads Over Time (Last 7 Days)</span>
            <div className="flex-1 min-h-[220px]">
              {loading ? (
                <div className="h-full skeleton rounded-md" />
              ) : (
                <Line data={lineData} options={lineOptions} />
              )}
            </div>
          </div>
          <div className="dash-card lg:min-w-[320px] min-h-[280px]">
            <span className="kpi-title">Leads by Source</span>
            <div className="flex-1 min-h-[220px]">
              {loading ? (
                <div className="h-full skeleton rounded-md" />
              ) : (
                <Doughnut data={donutData} options={donutOptions} />
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
