import { NextRequest, NextResponse } from 'next/server'
import { ensureAgentAutomationWorkerStarted, reclassifyAllEmails } from '@/lib/agent-automation'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    ensureAgentAutomationWorkerStarted()
    const body = await req.json().catch(() => ({}))

    const limit = Math.max(0, Math.min(Number(body?.limit || 0), 5000))
    const resetAll = body?.resetAll !== false

    const result = await reclassifyAllEmails({
      limit,
      resetAll,
    })

    return NextResponse.json({
      ok: true,
      ...result,
      resetAll,
      limit,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to reclassify emails' },
      { status: 500 }
    )
  }
}
