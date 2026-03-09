import { NextRequest, NextResponse } from 'next/server'
import { ensureAgentAutomationWorkerStarted } from '@/lib/agent-automation'
import { getCoreBrainMemory, refreshCoreBrainMemory } from '@/lib/core-brain'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    ensureAgentAutomationWorkerStarted()
    const refresh = req.nextUrl.searchParams.get('refresh') === '1'
    const state = refresh ? await refreshCoreBrainMemory() : await getCoreBrainMemory() || (await refreshCoreBrainMemory())
    return NextResponse.json({ ok: true, state })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load core brain state' },
      { status: 500 }
    )
  }
}
