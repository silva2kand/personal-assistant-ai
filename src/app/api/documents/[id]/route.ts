import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizeCategory, normalizeTags } from '@/lib/document-vault'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const patch: Record<string, unknown> = {}

    if (body?.title !== undefined) patch.title = String(body.title || '').trim()
    if (body?.category !== undefined) patch.category = normalizeCategory(String(body.category || 'general'))
    if (body?.summary !== undefined) patch.summary = String(body.summary || '').trim() || null
    if (body?.relatedEntity !== undefined) patch.relatedEntity = String(body.relatedEntity || '').trim() || null
    if (body?.tags !== undefined) {
      const tags = Array.isArray(body.tags) ? body.tags.map((v) => String(v || '')).join(',') : String(body.tags || '')
      patch.tagsJson = JSON.stringify(normalizeTags(tags))
    }
    if (body?.expiresAt !== undefined) {
      const raw = String(body.expiresAt || '').trim()
      if (!raw) patch.expiresAt = null
      else {
        const d = new Date(raw)
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json({ error: 'expiresAt is invalid date' }, { status: 400 })
        }
        patch.expiresAt = d
      }
    }

    const updated = await db.vaultDocument.update({
      where: { id },
      data: patch,
    })

    await db.vaultAccessLog.create({
      data: {
        documentId: id,
        action: 'metadata-update',
        actor: 'local-user',
      },
    })

    return NextResponse.json({ ok: true, document: updated })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update document' },
      { status: 500 }
    )
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const confirm = req.nextUrl.searchParams.get('confirm') || ''
    if (confirm !== 'YES') {
      return NextResponse.json(
        { error: 'Deletion requires explicit confirmation: ?confirm=YES' },
        { status: 400 }
      )
    }

    const updated = await db.vaultDocument.update({
      where: { id },
      data: { status: 'deleted' },
    })

    await db.vaultAccessLog.create({
      data: {
        documentId: id,
        action: 'delete',
        actor: 'local-user',
        note: 'soft delete with confirm=YES',
      },
    })

    return NextResponse.json({ ok: true, document: updated })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete document' },
      { status: 500 }
    )
  }
}
