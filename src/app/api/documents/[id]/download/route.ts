import { NextRequest, NextResponse } from 'next/server'
import { getVaultDocumentFile } from '@/lib/document-vault'

export const runtime = 'nodejs'

export async function GET(_: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const doc = await getVaultDocumentFile(id)
    return new NextResponse(doc.bytes, {
      status: 200,
      headers: {
        'Content-Type': doc.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${doc.originalName.replace(/"/g, '')}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to download document' },
      { status: 500 }
    )
  }
}
