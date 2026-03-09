import { NextRequest, NextResponse } from 'next/server'
import { runOcrForPendingVaultDocuments } from '@/lib/document-ocr'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const limit = Math.max(1, Math.min(Number(body?.limit || 8), 50))
    const out = await runOcrForPendingVaultDocuments(limit)
    return NextResponse.json({ ok: true, ...out })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run OCR' },
      { status: 500 }
    )
  }
}
