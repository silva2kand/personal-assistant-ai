import { NextRequest, NextResponse } from 'next/server'
import {
  ensureAgentAutomationWorkerStarted,
  getHistoricalBackfillSnapshot,
  getAgentAutomationWorkerSnapshot,
  runAgentAutomationCycle,
} from '@/lib/agent-automation'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

export async function GET() {
  try {
    ensureAgentAutomationWorkerStarted()

    const [pendingEvents, entities, emails, updatedRecently] = await Promise.all([
      db.agentEvent.count({ where: { status: 'pending' } }),
      db.agentEntity.count(),
      db.emailMessage.count(),
      db.agentEntity.count({
        where: {
          lastUpdateAt: {
            gte: new Date(Date.now() - 5 * 60 * 1000),
          },
        },
      }),
    ])

    const snapshot = getAgentAutomationWorkerSnapshot()
    const backfill = getHistoricalBackfillSnapshot()

    return NextResponse.json({
      worker: snapshot.running ? 'running' : 'idle',
      running: snapshot.running,
      lastCycleAt: snapshot.lastCycleAt,
      lastCycleDurationMs: snapshot.lastCycleDurationMs,
      lastCycle: snapshot.stats,
      lastLogLine: snapshot.lastLogLine,
      pendingEvents,
      entities,
      emails,
      entitiesUpdatedLast5Minutes: updatedRecently,
      backfill,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch worker status' },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    ensureAgentAutomationWorkerStarted()
    const body = await req.json().catch(() => ({}))
    const runs = Math.min(Math.max(Number(body?.runs || 1), 1), 5)
    const out = []
    for (let i = 0; i < runs; i += 1) {
      out.push(await runAgentAutomationCycle())
    }
    return NextResponse.json({ runs: out, snapshot: getAgentAutomationWorkerSnapshot() })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to run worker cycle' },
      { status: 500 }
    )
  }
}
