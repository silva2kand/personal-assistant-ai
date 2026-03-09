import { NextRequest, NextResponse } from 'next/server'
import { ensureAgentAutomationWorkerStarted } from '@/lib/agent-automation'
import { buildOpportunityFeed } from '@/lib/core-brain'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    ensureAgentAutomationWorkerStarted()
    const maxRaw = Number(req.nextUrl.searchParams.get('max') || 12)
    const max = Math.max(1, Math.min(Number.isFinite(maxRaw) ? maxRaw : 12, 30))
    const feed = await buildOpportunityFeed(max)
    return NextResponse.json({ ok: true, feed })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build opportunities feed' },
      { status: 500 }
    )
  }
}
