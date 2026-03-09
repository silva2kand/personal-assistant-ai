import { NextRequest, NextResponse } from 'next/server'
import { ensureAgentAutomationWorkerStarted } from '@/lib/agent-automation'
import { buildWhatsNewBriefing } from '@/lib/core-brain'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    ensureAgentAutomationWorkerStarted()
    const maxRaw = Number(req.nextUrl.searchParams.get('max') || 7)
    const max = Math.max(1, Math.min(Number.isFinite(maxRaw) ? maxRaw : 7, 12))
    const briefing = await buildWhatsNewBriefing(max)
    return NextResponse.json({ ok: true, briefing })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build what-is-new briefing' },
      { status: 500 }
    )
  }
}
