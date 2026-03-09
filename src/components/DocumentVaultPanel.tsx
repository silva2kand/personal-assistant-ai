'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Upload, Download, ShieldCheck, FileText, CalendarClock, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

type VaultDoc = {
  id: string
  title: string
  category: 'lease' | 'legal' | 'financial' | 'insurance' | 'contract' | 'general'
  tags: string[]
  summary: string
  relatedEntity: string
  source: string
  originalName: string
  mimeType: string
  sizeBytes: number
  extractionState?: string
  expiresAt: string | null
  createdAt: string
  isExpired: boolean
}

const categories: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'lease', label: 'Lease' },
  { id: 'legal', label: 'Legal' },
  { id: 'financial', label: 'Financial' },
  { id: 'insurance', label: 'Insurance' },
  { id: 'contract', label: 'Contract' },
]

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function toDate(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function DocumentVaultPanel() {
  const [documents, setDocuments] = useState<VaultDoc[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [ocrBusy, setOcrBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const query = new URLSearchParams()
      if (search.trim()) query.set('search', search.trim())
      if (category !== 'all') query.set('category', category)
      query.set('max', '300')
      const res = await fetch(`/api/documents?${query.toString()}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(data?.error || 'Failed to load documents'))
      setDocuments(Array.isArray(data?.documents) ? data.documents : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load documents')
    } finally {
      setLoading(false)
    }
  }, [category, search])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => documents, [documents])

  const handleUpload = async (fileList: FileList | null) => {
    const file = fileList?.[0]
    if (!file) return
    const title = window.prompt('Document title', file.name) || file.name
    const categoryInput = (window.prompt('Category: lease/legal/financial/insurance/contract/general', 'general') || 'general').trim()
    const tags = window.prompt('Tags (comma separated)', '') || ''
    const summary = window.prompt('Summary (optional)', '') || ''
    const relatedEntity = window.prompt('Related entity/property (optional)', '') || ''
    const expiresAt = window.prompt('Expiry date YYYY-MM-DD (optional)', '') || ''

    const form = new FormData()
    form.set('file', file)
    form.set('title', title)
    form.set('category', categoryInput)
    form.set('tags', tags)
    form.set('summary', summary)
    form.set('relatedEntity', relatedEntity)
    form.set('expiresAt', expiresAt)

    setUploading(true)
    setError('')
    try {
      const res = await fetch('/api/documents', { method: 'POST', body: form })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(data?.error || 'Upload failed'))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const download = async (id: string, fileName: string) => {
    const res = await fetch(`/api/documents/${encodeURIComponent(id)}/download`, { cache: 'no-store' })
    if (!res.ok) {
      setError('Download failed')
      return
    }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName || 'document'
    a.click()
    URL.revokeObjectURL(url)
  }

  const remove = async (id: string) => {
    if (!window.confirm('Delete this document? This requires explicit confirmation.')) return
    const res = await fetch(`/api/documents/${encodeURIComponent(id)}?confirm=YES`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      setError('Delete failed')
      return
    }
    await load()
  }

  const runOcrNow = async () => {
    setOcrBusy(true)
    setError('')
    try {
      const res = await fetch('/api/documents/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 20 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(String(data?.error || 'OCR failed'))
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'OCR failed')
    } finally {
      setOcrBusy(false)
    }
  }

  return (
    <div className="h-full overflow-auto bg-zinc-950 p-6 text-white">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Document Vault</h2>
              <p className="mt-1 text-sm text-zinc-400">
                <ShieldCheck className="mr-1 inline h-4 w-4" />
                {filtered.length} documents stored securely
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-800">
              <Upload className="h-4 w-4" />
              {uploading ? 'Uploading...' : 'Upload Document'}
              <input
                type="file"
                className="hidden"
                onChange={(e) => void handleUpload(e.target.files)}
                disabled={uploading}
              />
            </label>
          </div>

          <div className="mt-4 flex flex-col gap-3 md:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search documents..."
                className="border-zinc-700 bg-zinc-950 pl-9"
              />
            </div>
            <Button onClick={() => void load()} variant="outline" className="border-zinc-700">
              Refresh
            </Button>
            <Button onClick={() => void runOcrNow()} variant="outline" className="border-zinc-700" disabled={ocrBusy}>
              {ocrBusy ? 'Running OCR...' : 'Run OCR'}
            </Button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {categories.map((c) => (
              <Button
                key={c.id}
                size="sm"
                variant={category === c.id ? 'default' : 'outline'}
                className={category === c.id ? '' : 'border-zinc-700'}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
              </Button>
            ))}
          </div>
          {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
        </div>

        <div className="grid gap-3">
          {loading ? <p className="text-sm text-zinc-400">Loading documents...</p> : null}
          {!loading && filtered.length === 0 ? (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-5 text-sm text-zinc-400">
              No documents found.
            </div>
          ) : null}
          {!loading &&
            filtered.map((doc) => (
              <div key={doc.id} className="rounded-xl border border-zinc-800 bg-zinc-900/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-zinc-300" />
                      <h3 className="font-medium">{doc.title}</h3>
                      <Badge variant="outline" className="border-zinc-600 text-zinc-300">
                        {doc.category}
                      </Badge>
                    </div>
                    {doc.summary ? <p className="text-sm text-zinc-400">{doc.summary}</p> : null}
                    <div className="flex flex-wrap gap-1">
                      {doc.tags.map((tag) => (
                        <Badge key={`${doc.id}-${tag}`} variant="secondary" className="bg-zinc-800 text-zinc-200">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-xs text-zinc-500">
                      {doc.originalName} | {formatSize(doc.sizeBytes)} | Uploaded {toDate(doc.createdAt)}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Text extraction: {doc.extractionState || 'none'}
                    </p>
                    <p className={`text-xs ${doc.isExpired ? 'text-red-400' : 'text-zinc-500'}`}>
                      <CalendarClock className="mr-1 inline h-3.5 w-3.5" />
                      Expires: {toDate(doc.expiresAt)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-zinc-700"
                      onClick={() => void download(doc.id, doc.originalName)}
                    >
                      <Download className="mr-1 h-4 w-4" />
                      Download
                    </Button>
                    <Button size="sm" variant="outline" className="border-zinc-700" onClick={() => void remove(doc.id)}>
                      <Trash2 className="mr-1 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  )
}
