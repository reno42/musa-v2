'use client'

import { useState, useRef, useEffect } from 'react'
import { cn } from '@/lib/utils'

type FieldType = 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'select' | 'tags'

interface EditableFieldProps {
  value: string | string[] | null | undefined
  type?: FieldType
  placeholder?: string
  options?: { value: string; label: string }[]
  onSave: (newValue: string | string[]) => Promise<void> | void
  label?: string
  className?: string
  displayClassName?: string
  multiline?: boolean
  disabled?: boolean
}

export function EditableField({
  value,
  type = 'text',
  placeholder = 'Click to edit',
  options,
  onSave,
  label,
  className,
  displayClassName,
  disabled = false,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false)
  const [currentValue, setCurrentValue] = useState(
    Array.isArray(value) ? value.join(', ') : (value ?? '')
  )
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      if (inputRef.current instanceof HTMLInputElement || inputRef.current instanceof HTMLTextAreaElement) {
        inputRef.current.select()
      }
    }
  }, [editing])

  useEffect(() => {
    setCurrentValue(Array.isArray(value) ? value.join(', ') : (value ?? ''))
  }, [value])

  async function handleSave() {
    if (saving) return
    setSaving(true)
    try {
      let finalValue: string | string[]
      if (type === 'tags') {
        finalValue = currentValue
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      } else {
        finalValue = currentValue.trim()
      }

      const originalValue = Array.isArray(value) ? value.join(', ') : (value ?? '')
      if (finalValue !== originalValue && !(Array.isArray(finalValue) && Array.isArray(value) && JSON.stringify(finalValue) === JSON.stringify(value))) {
        await onSave(finalValue)
      }
    } catch (err) {
      console.error('Save failed:', err)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      setCurrentValue(Array.isArray(value) ? value.join(', ') : (value ?? ''))
      setEditing(false)
    }
    if (e.key === 'Enter' && !e.shiftKey && type !== 'textarea') {
      e.preventDefault()
      handleSave()
    }
  }

  const displayValue = Array.isArray(value)
    ? value.join(', ')
    : (value ?? '')

  const isEmpty = !displayValue

  if (disabled) {
    return (
      <div className={className}>
        {label && (
          <span className="text-2xs font-medium text-gray-9 uppercase tracking-wider">{label}</span>
        )}
        <p className={cn('text-sm text-gray-12', displayClassName)}>
          {displayValue || <span className="text-gray-8 italic">—</span>}
        </p>
      </div>
    )
  }

  if (editing) {
    const inputClasses = 'w-full px-2 py-1 -mx-2 -my-1 bg-white border border-gray-7 rounded-md text-sm focus:outline-none focus:border-gray-9 focus:ring-1 focus:ring-gray-9/10'

    return (
      <div className={className}>
        {label && (
          <span className="text-2xs font-medium text-gray-9 uppercase tracking-wider">{label}</span>
        )}
        <div className="mt-0.5">
          {type === 'textarea' ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={currentValue}
              onChange={(e) => setCurrentValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              rows={3}
              className={cn(inputClasses, 'resize-y')}
              placeholder={placeholder}
            />
          ) : type === 'select' && options ? (
            <select
              ref={inputRef as React.RefObject<HTMLSelectElement>}
              value={currentValue}
              onChange={(e) => { setCurrentValue(e.target.value); onSave(e.target.value); setEditing(false) }}
              onBlur={() => setEditing(false)}
              onKeyDown={handleKeyDown}
              className={cn(inputClasses, 'cursor-pointer')}
            >
              {options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              type={type === 'tags' ? 'text' : type}
              value={currentValue}
              onChange={(e) => setCurrentValue(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className={inputClasses}
              placeholder={placeholder}
            />
          )}
        </div>
        <p className="text-2xs text-gray-8 mt-1">Enter to save · Esc to cancel</p>
      </div>
    )
  }

  return (
    <div className={className}>
      {label && (
        <span className="text-2xs font-medium text-gray-9 uppercase tracking-wider">{label}</span>
      )}
      <p
        onClick={() => setEditing(true)}
        className={cn(
          'text-sm cursor-pointer rounded-md px-1 -mx-1 transition-colors min-h-[28px] flex items-center',
          isEmpty
            ? 'text-gray-8 italic hover:bg-gray-3'
            : 'text-gray-12 hover:bg-gray-3',
          displayClassName
        )}
        title="Click to edit"
      >
        {displayValue || placeholder}
      </p>
    </div>
  )
}
