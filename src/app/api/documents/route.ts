import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { extractDocumentText, listVaultDocuments, normalizeCategory, normalizeTags, saveVaultFile } from '@/lib/document-vault'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams.get('search') || ''
    const category = req.nextUrl.searchParams.get('category') || ''
    const includeExpired = req.nextUrl.searchParams.get('includeExpired') === '1'
    const max = Number(req.nextUrl.searchParams.get('max') || 200)
    const documents = await listVaultDocuments({ search, category, includeExpired, max })
    return NextResponse.json({ ok: true, documents })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to list documents' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 })
    }
    const title = String(form.get('title') || file.name || '').trim()
    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }

    const category = normalizeCategory(String(form.get('category') || 'general'))
    const tags = normalizeTags(String(form.get('tags') || ''))
    const summary = String(form.get('summary') || '').trim()
    const relatedEntity = String(form.get('relatedEntity') || '').trim()
    const expiresAtRaw = String(form.get('expiresAt') || '').trim()
    const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null
    if (expiresAtRaw && Number.isNaN(expiresAt?.getTime())) {
      return NextResponse.json({ error: 'expiresAt is invalid date' }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    const stored = await saveVaultFile({
      fileName: file.name || `${title}.bin`,
      bytes,
    })
    const extracted = extractDocumentText({
      bytes,
      mimeType: file.type || null,
      fileName: file.name || title,
    })

    const row = await db.vaultDocument.create({
      data: {
        title,
        category,
        tagsJson: JSON.stringify(tags),
        summary: summary || null,
        relatedEntity: relatedEntity || null,
        source: 'manual',
        storagePath: stored.storagePath,
        originalName: file.name || title,
        mimeType: file.type || null,
        sizeBytes: stored.sizeBytes,
        sha256: stored.sha256,
        extractedText: extracted.extractedText,
        extractionState: extracted.extractionState,
        expiresAt: expiresAt || null,
        uploadedBy: 'local-user',
        status: 'active',
      },
    })

    await db.vaultAccessLog.create({
      data: {
        documentId: row.id,
        action: 'upload',
        actor: 'local-user',
        note: `Uploaded ${row.originalName}`,
      },
    })

    return NextResponse.json({
      ok: true,
      document: {
        id: row.id,
        title: row.title,
        category: row.category,
        tags,
        summary: row.summary,
        relatedEntity: row.relatedEntity,
        originalName: row.originalName,
        mimeType: row.mimeType,
        sizeBytes: row.sizeBytes,
        extractionState: row.extractionState,
        expiresAt: row.expiresAt?.toISOString() || null,
        createdAt: row.createdAt.toISOString(),
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to upload document' },
      { status: 500 }
    )
  }
}
