export function exportToCSV<T extends Record<string, any>>(
  data: T[],
  columns: { key: string; label: string; transform?: (item: T) => string }[],
  filename: string
) {
  const header = columns.map(c => `"${c.label}"`).join(',')
  const rows = data.map(item =>
    columns.map(c => {
      const val = c.transform ? c.transform(item) : (item[c.key] ?? '')
      return `"${String(val).replace(/"/g, '""')}"`
    }).join(',')
  )
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
