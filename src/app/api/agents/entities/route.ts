import { NextRequest, NextResponse } from 'next/server'
import { ensureAgentAutomationWorkerStarted, runAgentAutomationCycle } from '@/lib/agent-automation'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

function safeJsonParse<T>(value?: string | null, fallback?: T): T {
  if (!value) return fallback as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback as T
  }
}

export async function GET(req: NextRequest) {
  try {
    ensureAgentAutomationWorkerStarted()
    const sync = req.nextUrl.searchParams.get('sync')
    if (sync === '1') {
      await runAgentAutomationCycle()
    }

    const agentType = req.nextUrl.searchParams.get('agentType') || undefined
    const status = req.nextUrl.searchParams.get('status') || undefined
    const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get('limit') || 50), 1), 200)

    const where = {
      ...(agentType ? { agentType } : {}),
      ...(status ? { status } : {}),
    }

    const entities = await db.agentEntity.findMany({
      where,
      include: {
        state: true,
        _count: {
          select: {
            events: true,
            queue: true,
          },
        },
      },
      orderBy: { lastUpdateAt: 'desc' },
      take: limit,
    })

    const pendingRows = await db.agentEvent.groupBy({
      by: ['agentEntityId'],
      where: { status: 'pending' },
      _count: { _all: true },
    })
    const pendingMap = new Map<string, number>(
      pendingRows.map((r) => [r.agentEntityId, r._count._all])
    )

    return NextResponse.json({
      entities: entities.map((e) => ({
        id: e.id,
        agentType: e.agentType,
        entityKey: e.entityKey,
        title: e.title,
        status: e.status,
        lastUpdateAt: e.lastUpdateAt,
        createdAt: e.createdAt,
        eventsCount: e._count.events,
        queueCount: e._count.queue,
        pendingCount: pendingMap.get(e.id) || 0,
        state: safeJsonParse(e.state?.stateJson, {}),
      })),
    })
  } catch (error) {
    console.error('Failed to fetch agent entities:', error)
    return NextResponse.json({ entities: [] }, { status: 500 })
  }
}

