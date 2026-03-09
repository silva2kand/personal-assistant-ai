import { db } from '@/lib/db'
import { promises as fs } from 'fs'
import path from 'path'

type OcrResult = {
  ok: boolean
  text?: string
  provider: string
  error?: string
}

async function runOcrViaOcrSpace(input: { bytes: Buffer; fileName: string; mimeType?: string | null }): Promise<OcrResult> {
  const apiKey = process.env.OCR_SPACE_API_KEY
  if (!apiKey) return { ok: false, provider: 'ocrspace', error: 'OCR_SPACE_API_KEY not configured' }

  try {
    const form = new FormData()
    form.append('apikey', apiKey)
    form.append('language', process.env.OCR_SPACE_LANGUAGE || 'eng')
    form.append('isOverlayRequired', 'false')
    form.append('file', new Blob([input.bytes], { type: input.mimeType || 'application/octet-stream' }), input.fileName)

    const res = await fetch(process.env.OCR_SPACE_URL || 'https://api.ocr.space/parse/image', {
      method: 'POST',
      body: form,
    })
    if (!res.ok) {
      return { ok: false, provider: 'ocrspace', error: `HTTP ${res.status}` }
    }
    const data = await res.json().catch(() => ({} as any))
    const parsed = Array.isArray(data?.ParsedResults) ? data.ParsedResults : []
    const text = parsed
      .map((p: any) => String(p?.ParsedText || '').trim())
      .filter(Boolean)
      .join('\n')
      .trim()
    if (!text) {
      return { ok: false, provider: 'ocrspace', error: 'No OCR text returned' }
    }
    return { ok: true, provider: 'ocrspace', text: text.slice(0, 50000) }
  } catch (error) {
    return { ok: false, provider: 'ocrspace', error: error instanceof Error ? error.message : 'OCR request failed' }
  }
}

async function runOcrViaWebhook(input: { bytes: Buffer; fileName: string; mimeType?: string | null }): Promise<OcrResult> {
  const url = process.env.OCR_WEBHOOK_URL
  if (!url) return { ok: false, provider: 'webhook', error: 'OCR_WEBHOOK_URL not configured' }
  try {
    const form = new FormData()
    form.append('file', new Blob([input.bytes], { type: input.mimeType || 'application/octet-stream' }), input.fileName)
    const token = process.env.OCR_WEBHOOK_TOKEN
    const res = await fetch(url, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    })
    if (!res.ok) return { ok: false, provider: 'webhook', error: `HTTP ${res.status}` }
    const data = await res.json().catch(() => ({} as any))
    const text = String(data?.text || data?.result || '').trim()
    if (!text) return { ok: false, provider: 'webhook', error: 'No OCR text returned' }
    return { ok: true, provider: 'webhook', text: text.slice(0, 50000) }
  } catch (error) {
    return { ok: false, provider: 'webhook', error: error instanceof Error ? error.message : 'OCR webhook failed' }
  }
}

export async function runOcrForPendingVaultDocuments(limit = 8): Promise<{
  scanned: number
  extracted: number
  failed: number
  provider: string
}> {
  const provider = (process.env.OCR_PROVIDER || 'ocrspace').toLowerCase()
  const rows = await db.vaultDocument.findMany({
    where: {
      status: 'active',
      extractionState: 'pending_ocr',
    },
    orderBy: { updatedAt: 'asc' },
    take: Math.max(1, Math.min(limit, 50)),
  })

  let extracted = 0
  let failed = 0
  for (const row of rows) {
    try {
      const bytes = await fs.readFile(path.resolve(row.storagePath))
      const out =
        provider === 'webhook'
          ? await runOcrViaWebhook({ bytes, fileName: row.originalName, mimeType: row.mimeType })
          : await runOcrViaOcrSpace({ bytes, fileName: row.originalName, mimeType: row.mimeType })

      if (out.ok && out.text) {
        await db.vaultDocument.update({
          where: { id: row.id },
          data: {
            extractedText: out.text,
            extractionState: 'extracted',
          },
        })
        await db.vaultAccessLog.create({
          data: {
            documentId: row.id,
            action: 'metadata-update',
            actor: 'ocr-worker',
            note: `OCR extracted via ${out.provider}`,
          },
        })
        extracted += 1
      } else {
        await db.vaultDocument.update({
          where: { id: row.id },
          data: {
            extractionState: 'failed',
          },
        })
        await db.vaultAccessLog.create({
          data: {
            documentId: row.id,
            action: 'metadata-update',
            actor: 'ocr-worker',
            note: `OCR failed via ${out.provider}: ${out.error || 'unknown'}`,
          },
        })
        failed += 1
      }
    } catch {
      await db.vaultDocument.update({
        where: { id: row.id },
        data: {
          extractionState: 'failed',
        },
      })
      failed += 1
    }
  }

  return {
    scanned: rows.length,
    extracted,
    failed,
    provider,
  }
}
