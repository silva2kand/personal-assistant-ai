import { createHash } from 'crypto'
import { promises as fs } from 'fs'
import path from 'path'
import { db } from '@/lib/db'

export type VaultCategory = 'lease' | 'legal' | 'financial' | 'insurance' | 'contract' | 'general'

const STORAGE_DIR = path.join(process.cwd(), '.secure-documents')

function safeJsonParse<T>(value?: string | null, fallback?: T): T {
  if (!value) return fallback as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback as T
  }
}

export function normalizeCategory(input?: string | null): VaultCategory {
  const v = String(input || '').toLowerCase().trim()
  if (v === 'lease' || v === 'legal' || v === 'financial' || v === 'insurance' || v === 'contract') return v
  return 'general'
}

export function normalizeTags(input?: string | null): string[] {
  if (!input) return []
  return Array.from(
    new Set(
      input
        .split(',')
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean)
    )
  ).slice(0, 20)
}

export async function ensureVaultStorageDir() {
  await fs.mkdir(STORAGE_DIR, { recursive: true })
}

export function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
}

export async function saveVaultFile(input: {
  fileName: string
  bytes: Buffer
}): Promise<{ storagePath: string; sha256: string; sizeBytes: number }> {
  await ensureVaultStorageDir()
  const sha256 = createHash('sha256').update(input.bytes).digest('hex')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const safeName = sanitizeFileName(input.fileName || 'document.bin')
  const storedName = `${stamp}-${sha256.slice(0, 12)}-${safeName}`
  const storagePath = path.join(STORAGE_DIR, storedName)
  await fs.writeFile(storagePath, input.bytes)
  return { storagePath, sha256, sizeBytes: input.bytes.length }
}

export function extractDocumentText(input: {
  bytes: Buffer
  mimeType?: string | null
  fileName?: string
}): { extractedText: string | null; extractionState: 'none' | 'extracted' | 'pending_ocr' | 'failed' } {
  const mime = String(input.mimeType || '').toLowerCase()
  const fileName = String(input.fileName || '').toLowerCase()

  try {
    if (mime.startsWith('text/') || /\.(txt|md|csv|json|xml|log)$/i.test(fileName)) {
      const text = input.bytes.toString('utf8').trim()
      if (!text) return { extractedText: null, extractionState: 'none' }
      return { extractedText: text.slice(0, 20000), extractionState: 'extracted' }
    }

    if (mime === 'application/pdf' || /\.pdf$/i.test(fileName)) {
      // Best-effort PDF text probe without heavy deps: extract printable runs.
      const raw = input.bytes.toString('latin1')
      const chunks = raw.match(/[A-Za-z0-9 ,.;:()\-_/]{8,}/g) || []
      const text = chunks.join(' ').replace(/\s+/g, ' ').trim()
      if (!text) return { extractedText: null, extractionState: 'pending_ocr' }
      return { extractedText: text.slice(0, 20000), extractionState: 'extracted' }
    }

    if (mime.startsWith('image/') || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(fileName)) {
      return { extractedText: null, extractionState: 'pending_ocr' }
    }

    return { extractedText: null, extractionState: 'none' }
  } catch {
    return { extractedText: null, extractionState: 'failed' }
  }
}

export async function listVaultDocuments(options?: {
  search?: string
  category?: string
  includeExpired?: boolean
  max?: number
}) {
  const max = Math.max(1, Math.min(Number(options?.max || 200), 500))
  const search = String(options?.search || '').trim()
  const category = options?.category ? normalizeCategory(options.category) : undefined
  const now = new Date()

  const rows = await db.vaultDocument.findMany({
    where: {
      status: 'active',
      ...(category && category !== 'general' ? { category } : {}),
      ...(options?.includeExpired ? {} : { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }),
      ...(search
        ? {
            OR: [
              { title: { contains: search } },
              { summary: { contains: search } },
              { originalName: { contains: search } },
              { relatedEntity: { contains: search } },
              { tagsJson: { contains: search.toLowerCase() } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }],
    take: max,
  })

  return rows.map((row) => {
    const tags = safeJsonParse<string[]>(row.tagsJson, [])
    const isExpired = !!row.expiresAt && row.expiresAt.getTime() < Date.now()
    return {
      id: row.id,
      title: row.title,
      category: normalizeCategory(row.category),
      tags,
      summary: row.summary || '',
      relatedEntity: row.relatedEntity || '',
      source: row.source,
      sourceRef: row.sourceRef || '',
      originalName: row.originalName,
      mimeType: row.mimeType || '',
      sizeBytes: row.sizeBytes,
      extractionState: row.extractionState,
      expiresAt: row.expiresAt?.toISOString() || null,
      createdAt: row.createdAt.toISOString(),
      isExpired,
    }
  })
}

export async function getVaultDocumentFile(documentId: string): Promise<{
  title: string
  originalName: string
  mimeType: string
  bytes: Buffer
}> {
  const row = await db.vaultDocument.findFirst({
    where: { id: documentId, status: 'active' },
  })
  if (!row) throw new Error('Document not found')

  const bytes = await fs.readFile(row.storagePath)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (sha256 !== row.sha256) throw new Error('Document integrity check failed')

  await db.vaultAccessLog.create({
    data: {
      documentId: row.id,
      action: 'download',
      actor: 'api',
      note: 'download endpoint',
    },
  })

  return {
    title: row.title,
    originalName: row.originalName,
    mimeType: row.mimeType || 'application/octet-stream',
    bytes,
  }
}
