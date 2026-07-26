'use client'

import { useEffect, useState } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { EditableField } from '@/components/ui/EditableField'
import { supabase } from '@/lib/supabase'
import { cn, formatDate } from '@/lib/utils'
import { useT } from '@/lib/settings-context'
import type { Task, TaskStatus, TaskPriority } from '@/types/database'

const STATUS_TABS: { value: TaskStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
]

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const STATUS_OPTIONS = [
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
]

export default function TasksPage() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<TaskStatus | 'all'>('all')
  const [showNewForm, setShowNewForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newPriority, setNewPriority] = useState<TaskPriority>('medium')
  const [newDueDate, setNewDueDate] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const t = useT()

  useEffect(() => { loadTasks() }, [statusFilter])

  async function loadTasks() {
    setLoading(true)
    let query = supabase.from('tasks').select('*').order('due_date', { ascending: true, nullsFirst: false })
    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    const { data } = await query
    setTasks(data || [])
    setLoading(false)
  }

  async function createTask() {
    if (!newTitle.trim()) return
    await supabase.from('tasks').insert({
      title: newTitle.trim(),
      description: newDescription.trim() || null,
      priority: newPriority,
      due_date: newDueDate || null,
      status: 'todo',
    })
    setNewTitle(''); setNewPriority('medium'); setNewDueDate(''); setNewDescription(''); setShowNewForm(false); loadTasks()
  }

  async function toggleTask(task: Task) {
    const newStatus: TaskStatus = task.status === 'done' ? 'todo' : 'done'
    await supabase.from('tasks').update({ status: newStatus, completed_at: newStatus === 'done' ? new Date().toISOString() : null }).eq('id', task.id)
    loadTasks()
  }

  async function updateTaskField(taskId: string, field: string, value: unknown) {
    const { error } = await supabase.from('tasks').update({ [field]: value }).eq('id', taskId)
    if (!error) {
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, [field]: value } : t))
    }
  }

  async function deleteTask(taskId: string) {
    if (!confirm('Delete this task?')) return
    await supabase.from('tasks').delete().eq('id', taskId)
    loadTasks()
  }

  const overdueTasks = tasks.filter((t) => t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done' && t.status !== 'cancelled')

  const action = (
    <button
      onClick={() => setShowNewForm(!showNewForm)}
      className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-gray-12 text-white text-sm font-medium hover:bg-gray-11 transition-colors"
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
      </svg>
      <span className="hidden sm:inline">New Task</span>
    </button>
  )

  const filters = (
    <div className="flex gap-2 overflow-x-auto pipeline-scroll">
      {STATUS_TABS.map((s) => (
        <button
          key={s.value}
          onClick={() => setStatusFilter(s.value)}
          className={cn(
            'flex-shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-all border',
            statusFilter === s.value ? 'bg-gray-12 text-white border-gray-12' : 'bg-gray-1 text-gray-10 border-gray-5 hover:border-gray-7'
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  )

  return (
    <AppShell title="Tasks" action={action} filters={filters}>
      <div className="space-y-4">
        {/* New task form */}
        {showNewForm && (
          <div className="p-4 rounded-md bg-gray-1 border border-gray-5 space-y-3">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="What needs to be done?"
              className="w-full px-3 py-2 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7"
              autoFocus
            />
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={2}
              className="w-full px-3 py-2 border border-gray-5 rounded-md text-sm focus:outline-none focus:border-gray-7 resize-none"
            />
            <div className="flex gap-2 items-end">
              <select value={newPriority} onChange={(e) => setNewPriority(e.target.value as TaskPriority)} className="px-3 py-2 border border-gray-5 rounded-md text-xs bg-gray-1">
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
              <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} className="px-3 py-2 border border-gray-5 rounded-md text-xs" />
              <button onClick={createTask} disabled={!newTitle.trim()} className={cn('px-4 py-2 rounded-md text-xs font-medium', newTitle.trim() ? 'bg-gray-12 text-white' : 'bg-gray-4 text-gray-8')}>
                Create
              </button>
            </div>
          </div>
        )}

        {/* Overdue warning */}
        {overdueTasks.length > 0 && (
          <div className="p-3 rounded-md bg-red-50 border border-red-200">
            <p className="text-xs font-medium text-red-700">
              ⚠️ {overdueTasks.length} overdue task{overdueTasks.length > 1 ? 's' : ''}
            </p>
          </div>
        )}

        {/* Task list */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-12 skeleton rounded-md" />)}
          </div>
        ) : tasks.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-gray-9">No tasks</p>
            <button onClick={() => setShowNewForm(true)} className="text-xs text-gray-9 hover:text-gray-12 mt-1">+ Create task</button>
          </div>
        ) : (
          <div className="bg-gray-1 rounded-md border border-gray-5 divide-y divide-gray-5">
            {tasks.map((task) => {
              const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done' && task.status !== 'cancelled'
              return (
                <TaskRow
                  key={task.id}
                  task={task}
                  isOverdue={!!isOverdue}
                  onToggle={toggleTask}
                  onUpdate={updateTaskField}
                  onDelete={deleteTask}
                />
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}

function TaskRow({
  task,
  isOverdue,
  onToggle,
  onUpdate,
  onDelete,
}: {
  task: Task
  isOverdue: boolean
  onToggle: (task: Task) => void
  onUpdate: (id: string, field: string, value: unknown) => Promise<void>
  onDelete: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={cn('px-4 py-3', isOverdue && 'bg-red-50/30')}>
      <div className="flex items-start gap-3">
        <button
          onClick={() => onToggle(task)}
          className={cn(
            'w-5 h-5 rounded-full border-2 flex-shrink-0 mt-0.5 transition-all flex items-center justify-center',
            task.status === 'done' ? 'bg-emerald-500 border-emerald-500' : 'border-gray-6 hover:border-gray-8'
          )}
        >
          {task.status === 'done' && (
            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          )}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <EditableField
              value={task.title}
              placeholder="Task title"
              onSave={(v) => onUpdate(task.id, 'title', v)}
              displayClassName={cn('text-sm', task.status === 'done' ? 'text-gray-8 line-through' : 'font-medium')}
            />
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 rounded hover:bg-gray-3 text-gray-8 hover:text-gray-12 transition-colors flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            </button>
            <button
              onClick={() => onDelete(task.id)}
              className="p-1 rounded hover:bg-red-50 text-gray-8 hover:text-red-600 transition-colors flex-shrink-0"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {task.description && !expanded && (
            <p className="text-xs text-gray-9 mt-0.5 line-clamp-1">{task.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            {task.due_date && (
              <span className={cn('text-2xs px-1.5 py-0.5 rounded-md', isOverdue ? 'bg-red-100 text-red-600' : 'bg-gray-4 text-gray-9')}>
                {formatDate(task.due_date)}
              </span>
            )}
            <span className={cn(
              'text-2xs px-1.5 py-0.5 rounded-md',
              task.priority === 'urgent' ? 'bg-red-50 text-red-600' :
              task.priority === 'high' ? 'bg-orange-50 text-orange-600' :
              task.priority === 'medium' ? 'bg-blue-50 text-blue-600' :
              'bg-gray-4 text-gray-9'
            )}>
              {task.priority}
            </span>
            <span className={cn(
              'text-2xs px-1.5 py-0.5 rounded-md border',
              task.status === 'done' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
              task.status === 'in_progress' ? 'bg-blue-50 text-blue-700 border-blue-200' :
              task.status === 'cancelled' ? 'bg-gray-50 text-gray-500 border-gray-200' :
              'bg-gray-4 text-gray-9 border-gray-5'
            )}>
              {task.status === 'in_progress' ? 'In Progress' : task.status.charAt(0).toUpperCase() + task.status.slice(1)}
            </span>
          </div>
        </div>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="mt-3 ml-8 space-y-2 pb-2">
          <EditableField
            value={task.description}
            type="textarea"
            placeholder="Add description..."
            onSave={(v) => onUpdate(task.id, 'description', v || null)}
            label="Description"
          />
          <div className="grid grid-cols-2 gap-2">
            <EditableField
              value={task.priority}
              type="select"
              options={PRIORITY_OPTIONS}
              onSave={(v) => onUpdate(task.id, 'priority', v)}
              label="Priority"
            />
            <EditableField
              value={task.status}
              type="select"
              options={STATUS_OPTIONS}
              onSave={(v) => onUpdate(task.id, 'status', v)}
              label="Status"
            />
          </div>
          <div>
            <label className="text-2xs text-gray-9">Due date</label>
            <input
              type="date"
              defaultValue={task.due_date?.split('T')[0] ?? ''}
              onBlur={(e) => onUpdate(task.id, 'due_date', e.target.value || null)}
              className="w-full px-2 py-1 border border-gray-5 rounded-md text-xs"
            />
          </div>
          <EditableField
            value={task.tags}
            type="tags"
            placeholder="tag1, tag2"
            onSave={(v) => onUpdate(task.id, 'tags', v)}
            label="Tags"
          />
        </div>
      )}
    </div>
  )
}
